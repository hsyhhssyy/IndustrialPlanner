import { createHash } from "node:crypto";
import { readFileSync, statSync } from "node:fs";
import { basename, dirname, extname, isAbsolute, relative, resolve } from "node:path";

export const AKEDATA_MANIFEST_URL = "https://data.akedata.wiki/manifest.json";

const TABLE_NAME_PATTERN = /^[A-Za-z][A-Za-z0-9_]*$/;
const SHA256_PATTERN = /^[a-f0-9]{64}$/;
const INTEGER_TOKEN_PATTERN = /^-?(?:0|[1-9][0-9]*)$/;

const LEGACY_TABLE_PATHS = Object.freeze({
  FactoryBuildingItemTable: ["buildings", "buildingItemTable"],
  FactoryBuildingTable: ["buildings", "buildingTable"],
});

function assertRecord(value, label) {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${label} 必须是对象`);
  }
  return value;
}

function readRequiredString(value, label) {
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(`${label} 必须是非空字符串`);
  }
  return value;
}

export function assertTableName(tableName) {
  if (!TABLE_NAME_PATTERN.test(tableName)) {
    throw new Error(`raw table 名称无效：${tableName}`);
  }
  return tableName;
}

export function sha256(content) {
  return createHash("sha256").update(content).digest("hex");
}

export function parseUnpackJson(text, label = "解包 JSON") {
  return JSON.parse(text, (_key, value, context) => {
    if (typeof value !== "number" || Number.isSafeInteger(value)) return value;

    const source = context?.source;
    if (typeof source !== "string") {
      throw new Error(
        `${label} 包含无法无损解析的 number；当前 Node.js 不支持 JSON.parse reviver context.source`,
      );
    }
    if (INTEGER_TOKEN_PATTERN.test(source) || !Number.isFinite(value)) return source;
    return value;
  });
}

function validateContainedPath(rootPath, relativePath, label) {
  if (isAbsolute(relativePath)) {
    throw new Error(`${label} 必须是来源目录内的相对路径`);
  }
  const filePath = resolve(rootPath, relativePath);
  const pathFromRoot = relative(rootPath, filePath);
  if (pathFromRoot === ".." || pathFromRoot.startsWith(`..${process.platform === "win32" ? "\\" : "/"}`)) {
    throw new Error(`${label} 越出来源目录：${relativePath}`);
  }
  return filePath;
}

function resolveRawSourceRoot(inputPath) {
  const stats = statSync(inputPath);
  if (stats.isDirectory()) return inputPath;
  if (stats.isFile() && basename(inputPath) === "source-manifest.json") {
    return dirname(inputPath);
  }
  return null;
}

function createRawTableSource(inputPath, readText) {
  const rootPath = resolveRawSourceRoot(inputPath);
  if (rootPath === null) return null;

  const manifestPath = resolve(rootPath, "source-manifest.json");
  let manifestText;
  try {
    manifestText = readText(manifestPath);
  } catch (error) {
    throw new Error(
      `raw-table 来源缺少 source-manifest.json：${manifestPath}；${error instanceof Error ? error.message : String(error)}`,
    );
  }
  const manifest = assertRecord(
    parseUnpackJson(manifestText, manifestPath),
    "source-manifest.json",
  );
  if (manifest.schemaVersion !== 1) {
    throw new Error(`不支持的 source manifest schemaVersion：${String(manifest.schemaVersion)}`);
  }
  const source = readRequiredString(manifest.source, "source-manifest.json.source");
  if (source !== "akedata" && source !== "local") {
    throw new Error(`source-manifest.json.source 只能是 akedata 或 local，收到：${source}`);
  }
  const sourceVersion = readRequiredString(
    manifest.sourceVersion,
    "source-manifest.json.sourceVersion",
  );
  const tables = assertRecord(manifest.tables, "source-manifest.json.tables");

  return Object.freeze({
    kind: source,
    authority: "raw-table",
    sourcePath: rootPath,
    sourceVersion,
    gameVersion: typeof manifest.gameVersion === "string" ? manifest.gameVersion : null,
    hotfixVersion: typeof manifest.hotfixVersion === "string" ? manifest.hotfixVersion : null,
    manifest,
    legacyRoot: null,
    readTable(tableName) {
      assertTableName(tableName);
      const entry = assertRecord(
        tables[tableName],
        `source-manifest.json.tables.${tableName}`,
      );
      const expectedFile = `TableCfg/${tableName}.json`;
      const tableFile = readRequiredString(entry.file, `${tableName}.file`);
      if (tableFile !== expectedFile) {
        throw new Error(
          `${tableName}.file 必须保持 AKEData raw table 路径 ${expectedFile}，收到：${tableFile}`,
        );
      }
      const expectedHash = readRequiredString(entry.sha256, `${tableName}.sha256`);
      if (!SHA256_PATTERN.test(expectedHash)) {
        throw new Error(`${tableName}.sha256 必须是 64 位小写十六进制`);
      }
      const tablePath = validateContainedPath(rootPath, tableFile, `${tableName}.file`);
      const tableText = readText(tablePath);
      const actualHash = sha256(tableText);
      if (actualHash !== expectedHash) {
        throw new Error(
          `${tableName} SHA-256 不一致：manifest=${expectedHash}，actual=${actualHash}`,
        );
      }
      return assertRecord(parseUnpackJson(tableText, tablePath), tableName);
    },
  });
}

function readLegacyPath(root, pathParts, tableName) {
  let current = root;
  for (const pathPart of pathParts) {
    current = assertRecord(current, `${tableName} legacy 映射父节点`)[pathPart];
  }
  return assertRecord(current, `${tableName} legacy 映射结果`);
}

function createLegacySource(inputPath, readText) {
  if (extname(inputPath).toLowerCase() !== ".json") {
    throw new Error(`解包来源既不是 raw-table 目录，也不是 legacy JSON：${inputPath}`);
  }
  const root = assertRecord(
    parseUnpackJson(readText(inputPath), inputPath),
    "legacy JSON 根节点",
  );
  assertRecord(root.buildings, "legacy JSON buildings");

  return Object.freeze({
    kind: "legacy-json-export",
    authority: "legacy-lossy",
    sourcePath: inputPath,
    sourceVersion: typeof root.meta?.version === "string" ? root.meta.version : "unknown",
    gameVersion: typeof root.meta?.version === "string" ? root.meta.version : null,
    hotfixVersion: null,
    manifest: null,
    legacyRoot: root,
    readTable(tableName) {
      assertTableName(tableName);
      const legacyPath = LEGACY_TABLE_PATHS[tableName];
      if (legacyPath === undefined) {
        throw new Error(
          `legacy json-export 不支持 raw table ${tableName}；请改用 AKEData 或本地 raw-table 来源`,
        );
      }
      return readLegacyPath(root, legacyPath, tableName);
    },
  });
}

export function openUnpackTableSource(
  sourcePath,
  readText = (filePath) => readFileSync(filePath, "utf8"),
) {
  const inputPath = resolve(sourcePath);
  const rawSource = createRawTableSource(inputPath, readText);
  return rawSource ?? createLegacySource(inputPath, readText);
}

export function describeUnpackTableSource(source) {
  return [
    `kind=${source.kind}`,
    `authority=${source.authority}`,
    `version=${source.sourceVersion}`,
    `path=${source.sourcePath}`,
  ].join(", ");
}

