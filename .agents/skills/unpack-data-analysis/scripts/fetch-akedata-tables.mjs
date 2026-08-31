import { rename, writeFile, mkdir, readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
  AKEDATA_MANIFEST_URL,
  assertTableName,
  parseUnpackJson,
  sha256,
} from "./unpack-table-source.mjs";

const PROJECT_ROOT = fileURLToPath(new URL("../../../../", import.meta.url));
const DEFAULT_OUTPUT_ROOT = resolve(PROJECT_ROOT, ".temp/unpack/akedata");

function parseArguments(args) {
  const options = {
    listVersions: false,
    outputRoot: DEFAULT_OUTPUT_ROOT,
    refresh: false,
    tables: [],
    versionId: null,
  };

  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    if (argument === "--help" || argument === "-h") return { ...options, help: true };
    if (argument === "--list-versions") {
      options.listVersions = true;
      continue;
    }
    if (argument === "--refresh") {
      options.refresh = true;
      continue;
    }
    if (argument === "--version" || argument === "--table" || argument === "--output") {
      const value = args[index + 1];
      if (value === undefined || value.startsWith("--")) {
        throw new Error(`${argument} 缺少参数值`);
      }
      index += 1;
      if (argument === "--version") options.versionId = value;
      if (argument === "--table") options.tables.push(assertTableName(value));
      if (argument === "--output") options.outputRoot = resolve(PROJECT_ROOT, value);
      continue;
    }
    throw new Error(`未知参数：${argument}`);
  }

  return { ...options, help: false };
}

function printHelp() {
  console.log(`用法：
  node .agents/skills/unpack-data-analysis/scripts/fetch-akedata-tables.mjs --list-versions
  node .agents/skills/unpack-data-analysis/scripts/fetch-akedata-tables.mjs \\
    --version <完整版本 ID> --table <TableName> [--table <TableName> ...] [--output <目录>] [--refresh]

版本必须显式指定，不能用 latest 代替固定版本。
默认输出根目录：.temp/unpack/akedata
每个版本写入：<输出根目录>/<版本 ID>/source-manifest.json 与 TableCfg/*.json`);
}

async function fetchRequired(url) {
  const response = await fetch(url, {
    headers: { "user-agent": "IndustrialPlanner-unpack-data-analysis/1" },
  });
  if (!response.ok) {
    throw new Error(`${url} 请求失败：HTTP ${response.status} ${response.statusText}`);
  }
  return Buffer.from(await response.arrayBuffer());
}

function readManifestRecord(value, label) {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${label} 必须是对象`);
  }
  return value;
}

async function readRemoteManifest() {
  const content = await fetchRequired(AKEDATA_MANIFEST_URL);
  const manifest = readManifestRecord(
    parseUnpackJson(content.toString("utf8"), AKEDATA_MANIFEST_URL),
    "AKEData manifest",
  );
  if (manifest.schemaVersion !== 1 || !Array.isArray(manifest.versions)) {
    throw new Error("AKEData manifest schema 不受支持");
  }
  return manifest;
}

function printVersions(manifest) {
  console.log("| version ID | game | hotfix | publishedAt |");
  console.log("| --- | --- | --- | --- |");
  for (const version of manifest.versions) {
    console.log(
      `| ${version.id} | ${version.gameVersion} | ${version.hotfixVersion} | ${version.publishedAt} |`,
    );
  }
}

async function readExistingManifest(manifestPath) {
  try {
    const text = await readFile(manifestPath, "utf8");
    return readManifestRecord(parseUnpackJson(text, manifestPath), manifestPath);
  } catch (error) {
    if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") {
      return null;
    }
    throw error;
  }
}

async function writeAtomically(filePath, content) {
  const temporaryPath = `${filePath}.tmp-${process.pid}`;
  await writeFile(temporaryPath, content);
  await rename(temporaryPath, filePath);
}

async function fetchTables(options, remoteManifest) {
  if (options.versionId === null) {
    throw new Error("必须通过 --version 显式指定 AKEData 完整版本 ID");
  }
  if (options.versionId === "latest") {
    throw new Error("禁止用 latest 执行分析；请先 --list-versions，再固定完整版本 ID");
  }
  if (options.tables.length === 0) {
    throw new Error("至少通过 --table 指定一张需要的 raw table");
  }

  const version = remoteManifest.versions.find((candidate) => candidate.id === options.versionId);
  if (version === undefined) {
    throw new Error(`AKEData manifest 不存在版本：${options.versionId}`);
  }
  const outputPath = resolve(options.outputRoot, version.id);
  const tableOutputPath = resolve(outputPath, "TableCfg");
  const manifestPath = resolve(outputPath, "source-manifest.json");
  await mkdir(tableOutputPath, { recursive: true });

  const existingManifest = await readExistingManifest(manifestPath);
  if (existingManifest !== null && existingManifest.sourceVersion !== version.id) {
    throw new Error(
      `输出目录已属于其他版本：${String(existingManifest.sourceVersion)}，当前为 ${version.id}`,
    );
  }
  const localManifest = {
    schemaVersion: 1,
    source: "akedata",
    sourceVersion: version.id,
    gameVersion: version.gameVersion,
    hotfixVersion: version.hotfixVersion,
    exportedAt: version.publishedAt,
    retrievedAt: new Date().toISOString(),
    sourceManifestUrl: AKEDATA_MANIFEST_URL,
    tableCfgPath: version.tableCfgPath,
    tables: { ...(existingManifest?.tables ?? {}) },
  };

  for (const tableName of [...new Set(options.tables)]) {
    const filePath = resolve(tableOutputPath, `${tableName}.json`);
    const existingEntry = localManifest.tables[tableName];
    if (!options.refresh && existingEntry !== undefined) {
      const existingContent = await readFile(filePath);
      const actualHash = sha256(existingContent);
      if (actualHash !== existingEntry.sha256) {
        throw new Error(
          `${tableName} 本地缓存 hash 不一致；使用 --refresh 明确重新获取`,
        );
      }
      console.log(`复用 ${tableName}：${actualHash}`);
      continue;
    }

    const tableUrl = new URL(
      `${version.tableCfgPath.replace(/\/$/, "")}/${tableName}.json`,
      "https://data.akedata.wiki/",
    );
    const content = await fetchRequired(tableUrl);
    parseUnpackJson(content.toString("utf8"), tableUrl.href);
    const contentHash = sha256(content);
    await writeAtomically(filePath, content);
    localManifest.tables[tableName] = {
      file: `TableCfg/${tableName}.json`,
      sha256: contentHash,
      fetchedAt: new Date().toISOString(),
      sourceUrl: tableUrl.href,
    };
    console.log(`获取 ${tableName}：${contentHash}`);
  }

  await writeAtomically(
    manifestPath,
    `${JSON.stringify(localManifest, null, 2)}\n`,
  );
  console.log(`来源目录：${outputPath}`);
}

export async function run(args = process.argv.slice(2)) {
  const options = parseArguments(args);
  if (options.help) {
    printHelp();
    return;
  }
  const manifest = await readRemoteManifest();
  if (options.listVersions) {
    printVersions(manifest);
    return;
  }
  await fetchTables(options, manifest);
}

const isDirectExecution = process.argv[1]
  && resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (isDirectExecution) {
  run().catch((error) => {
    console.error(`AKEData raw table 获取失败：${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  });
}

