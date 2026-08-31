import { readFile } from "node:fs/promises";
import { dirname, extname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import ts from "typescript";

import {
  describeUnpackTableSource,
  openUnpackTableSource,
} from "../../.agents/skills/unpack-data-analysis/scripts/unpack-table-source.mjs";

const SCRIPT_DIRECTORY = dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = resolve(SCRIPT_DIRECTORY, "../..");
const DEFAULT_EXPORT_PATH = resolve(PROJECT_ROOT, ".temp/json-export.json");
const ENTITY_SOURCE_PATH = resolve(PROJECT_ROOT, "src/registry/entity-definition.ts");
const ZH_CN_SOURCE_PATH = resolve(PROJECT_ROOT, "src/shared/i18n/zh-cn/registry.ts");
const EN_US_SOURCE_PATH = resolve(PROJECT_ROOT, "src/shared/i18n/en-us/registry.ts");

const MODE_I18N = Object.freeze({
  normal: { zhCN: "", enUS: "" },
  gastrans: { zhCN: "气体", enUS: "Gas" },
  liquidtrans: { zhCN: "液体", enUS: "Liquid" },
  gas: { zhCN: "气体", enUS: "Gas" },
  liquid: { zhCN: "液体", enUS: "Liquid" },
  // recipes-export.json 当前还包含以下两种 mode；沿用项目已有领域含义。
  // AI-CORRECTION 2026-08-31: 当前输入已改为 raw TableCfg 或 legacy json-export；两种来源仍包含以下 mode，原领域含义不变。
  solidtrans: { zhCN: "固体", enUS: "Solid" },
  gasliquid: { zhCN: "气液", enUS: "Gas/Liquid" },
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

function parseTemplateId(templateId, declaredMode, buildingId) {
  const match = /^(.*)__([0-9]+)$/.exec(templateId);
  if (!match) {
    throw new Error(`设备 ${buildingId} 的 template ID 格式无效：${templateId}`);
  }

  const mode = readRequiredString(match[1], `${templateId} 的 mode`);
  if (mode !== declaredMode) {
    throw new Error(
      `设备 ${buildingId} 的 template ${templateId} 与 machineModeType=${declaredMode} 不一致`,
    );
  }

  return { mode, groupIndex: Number.parseInt(match[2], 10) };
}

function resolveBaseNames(exportData, buildingId, building) {
  const buildingI18n = exportData.i18n?.buildings?.[buildingId];
  const zhCN = building._name || buildingI18n?.cn;
  const enUS = building._nameEn || buildingI18n?.en;

  return {
    zhCN: readRequiredString(zhCN, `设备 ${buildingId} 的中文名`),
    enUS: readRequiredString(enUS, `设备 ${buildingId} 的英文名`),
  };
}

function readRawI18nText(reference, i18nTable, label) {
  const i18nReference = assertRecord(reference, `${label} i18n 引用`);
  const id = i18nReference.id;
  if (typeof id !== "string" && !Number.isSafeInteger(id)) {
    throw new Error(`${label} i18n ID 必须是无损字符串或安全整数`);
  }
  if (String(id) === "0") return null;
  return readRequiredString(i18nTable[String(id)], `${label} i18n 文本`);
}

export function buildDeviceAnalysisInput(source) {
  if (source.kind === "legacy-json-export") {
    return assertRecord(source.legacyRoot, "legacy json-export 根节点");
  }

  const buildingTable = assertRecord(
    source.readTable("FactoryBuildingTable"),
    "FactoryBuildingTable",
  );
  const buildingItemTable = assertRecord(
    source.readTable("FactoryBuildingItemTable"),
    "FactoryBuildingItemTable",
  );
  const zhCN = assertRecord(source.readTable("I18nTextTable_CN"), "I18nTextTable_CN");
  const enUS = assertRecord(source.readTable("I18nTextTable_EN"), "I18nTextTable_EN");
  const projectedBuildingTable = Object.fromEntries(
    Object.entries(buildingTable).map(([buildingId, rawBuilding]) => {
      const building = assertRecord(rawBuilding, `FactoryBuildingTable.${buildingId}`);
      const zhCNName = readRawI18nText(building.name, zhCN, `${buildingId}.name.zhCN`);
      const enUSName = readRawI18nText(building.name, enUS, `${buildingId}.name.enUS`);
      if (zhCNName === null && enUSName === null) return [buildingId, building];
      if (zhCNName === null || enUSName === null) {
        throw new Error(`${buildingId} 的中英文名称 ID 状态不一致`);
      }
      return [buildingId, {
        ...building,
        _name: zhCNName,
        _nameEn: enUSName,
      }];
    }),
  );
  const displayableBuildingItemTable = Object.fromEntries(
    Object.entries(buildingItemTable).filter(([itemId, rawMapping]) => {
      const buildingId = readRequiredString(
        assertRecord(rawMapping, `FactoryBuildingItemTable.${itemId}`).buildingId,
        `FactoryBuildingItemTable.${itemId}.buildingId`,
      );
      return typeof projectedBuildingTable[buildingId]?._name === "string";
    }),
  );

  return {
    buildings: {
      buildingItemTable: displayableBuildingItemTable,
      buildingTable: projectedBuildingTable,
    },
    i18n: { buildings: {} },
  };
}

export function generateDeviceI18n(baseNames, mode) {
  const suffix = MODE_I18N[mode];
  if (!suffix) {
    throw new Error(`未配置 mode=${mode} 的设备 i18n 生成规则`);
  }
  if (mode === "normal") return { ...baseNames };

  return {
    zhCN: `${baseNames.zhCN}(${suffix.zhCN})`,
    enUS: `${baseNames.enUS} (${suffix.enUS})`,
  };
}

function buildDeviceId(buildingId, mode, groupIndex, groupCount) {
  const modeSuffix = mode === "normal" ? "" : `_${mode}`;
  const groupSuffix = groupCount === 1 ? "" : `_${groupIndex}`;
  return `${buildingId}${modeSuffix}${groupSuffix}`;
}

function buildBuildingItemIndex(exportData) {
  const buildingItemTable = assertRecord(
    exportData.buildings?.buildingItemTable,
    "buildings.buildingItemTable",
  );
  const buildingIdByItemId = new Map();
  const itemMappedBuildingIds = new Set();

  for (const [tableKey, rawMapping] of Object.entries(buildingItemTable)) {
    const mapping = assertRecord(rawMapping, `buildingItemTable.${tableKey}`);
    const buildingId = readRequiredString(
      mapping.buildingId,
      `buildingItemTable.${tableKey}.buildingId`,
    );
    const itemId = readRequiredString(
      mapping.itemId ?? tableKey,
      `buildingItemTable.${tableKey}.itemId`,
    );
    buildingIdByItemId.set(tableKey, buildingId);
    buildingIdByItemId.set(itemId, buildingId);
    itemMappedBuildingIds.add(buildingId);
  }

  return { buildingIdByItemId, itemMappedBuildingIds };
}

export function buildExpectedDevices(exportData) {
  assertRecord(exportData, "导出文件根节点");
  const buildingTable = assertRecord(
    exportData.buildings?.buildingTable,
    "buildings.buildingTable",
  );
  const { buildingIdByItemId, itemMappedBuildingIds } = buildBuildingItemIndex(exportData);
  const devices = [];
  const templatesByBuildingId = new Map();

  for (const buildingId of [...itemMappedBuildingIds].sort()) {
    const building = assertRecord(buildingTable[buildingId], `buildingTable.${buildingId}`);
    const rendererTemplateMap = assertRecord(
      building.rendererTemplateMap,
      `buildingTable.${buildingId}.rendererTemplateMap`,
    );
    const templateEntries = [];

    for (const [templateId, rawTemplate] of Object.entries(rendererTemplateMap)) {
      const template = assertRecord(rawTemplate, `${buildingId}.${templateId}`);
      const declaredMode = readRequiredString(
        template.machineModeType,
        `${buildingId}.${templateId}.machineModeType`,
      );
      const { mode, groupIndex } = parseTemplateId(templateId, declaredMode, buildingId);
      templateEntries.push({ templateId, mode, groupIndex });
    }

    if (templateEntries.length === 0) continue;

    const baseNames = resolveBaseNames(exportData, buildingId, building);
    const groupCountByMode = new Map();
    for (const template of templateEntries) {
      groupCountByMode.set(template.mode, (groupCountByMode.get(template.mode) ?? 0) + 1);
    }

    const buildingTemplates = templateEntries
      .map((template) => {
        const names = generateDeviceI18n(baseNames, template.mode);
        return {
          id: buildDeviceId(
            buildingId,
            template.mode,
            template.groupIndex,
            groupCountByMode.get(template.mode),
          ),
          ...names,
          originalDeviceId: buildingId,
          mode: template.mode,
          templateId: template.templateId,
          isDefaultTemplate: building.defaultRendererTemplate === template.templateId,
        };
      })
      .sort(compareDeviceRows);

    templatesByBuildingId.set(buildingId, buildingTemplates);
    devices.push(...buildingTemplates);
  }

  const duplicateIds = findDuplicates(devices.map((device) => device.id));
  if (duplicateIds.length > 0) {
    throw new Error(`导出数据生成了重复设备 ID：${duplicateIds.join(", ")}`);
  }

  return {
    devices: devices.sort(compareDeviceRows),
    buildingIdByItemId,
    templatesByBuildingId,
  };
}

function findDuplicates(values) {
  const seen = new Set();
  const duplicates = new Set();
  for (const value of values) {
    if (seen.has(value)) duplicates.add(value);
    seen.add(value);
  }
  return [...duplicates].sort();
}

function readPropertyName(node) {
  if (ts.isIdentifier(node) || ts.isStringLiteralLike(node) || ts.isNumericLiteral(node)) {
    return node.text;
  }
  return undefined;
}

function findObjectProperty(objectLiteral, propertyName) {
  for (const property of objectLiteral.properties) {
    if (!ts.isPropertyAssignment(property)) continue;
    if (readPropertyName(property.name) === propertyName) return property.initializer;
  }
  return undefined;
}

function readLiteralString(node) {
  return node && ts.isStringLiteralLike(node) ? node.text : undefined;
}

function readLiteralStringArray(node) {
  if (!node || !ts.isArrayLiteralExpression(node)) return [];
  return node.elements.flatMap((element) => {
    const value = readLiteralString(element);
    return value === undefined ? [] : [value];
  });
}

export function extractCurrentEntities(sourceText, fileName = "entity-definition.ts") {
  const sourceFile = ts.createSourceFile(
    fileName,
    sourceText,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TS,
  );
  const entities = [];

  function visit(node) {
    if (
      ts.isCallExpression(node)
      && ts.isIdentifier(node.expression)
      && (node.expression.text === "createEntityDefinition"
        || node.expression.text === "createEmptyEntityDefinition")
    ) {
      const definition = node.arguments[0];
      if (definition && ts.isObjectLiteralExpression(definition)) {
        const id = readLiteralString(findObjectProperty(definition, "id"));
        const nameKey = readLiteralString(findObjectProperty(definition, "nameKey"));
        if (id && nameKey) {
          entities.push({
            id,
            nameKey,
            tags: readLiteralStringArray(findObjectProperty(definition, "tags")),
          });
        }
      }
    }
    ts.forEachChild(node, visit);
  }

  visit(sourceFile);
  const duplicateIds = findDuplicates(entities.map((entity) => entity.id));
  if (duplicateIds.length > 0) {
    throw new Error(`当前 registry 存在重复设备 ID：${duplicateIds.join(", ")}`);
  }
  return entities.sort((left, right) => left.id.localeCompare(right.id));
}

export function extractI18nRegistry(sourceText, fileName = "registry.ts") {
  const sourceFile = ts.createSourceFile(
    fileName,
    sourceText,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TS,
  );
  const translations = new Map();

  for (const statement of sourceFile.statements) {
    if (!ts.isVariableStatement(statement)) continue;
    for (const declaration of statement.declarationList.declarations) {
      if (!ts.isIdentifier(declaration.name) || declaration.name.text !== "REGISTRY") continue;
      if (!declaration.initializer || !ts.isObjectLiteralExpression(declaration.initializer)) {
        throw new Error(`${fileName} 的 REGISTRY 必须使用对象字面量`);
      }
      for (const property of declaration.initializer.properties) {
        if (!ts.isPropertyAssignment(property)) continue;
        const key = readPropertyName(property.name);
        const value = readLiteralString(property.initializer);
        if (key && value !== undefined) translations.set(key, value);
      }
    }
  }

  if (translations.size === 0) {
    throw new Error(`${fileName} 中没有找到 REGISTRY 翻译`);
  }
  return translations;
}

function resolveOriginalDeviceId(entity, expectedById, buildingIdByItemId, buildingIds) {
  const exactExpected = expectedById.get(entity.id);
  if (exactExpected) return exactExpected.originalDeviceId;

  const alterBase = entity.tags
    .find((tag) => tag.startsWith("alter:"))
    ?.slice("alter:".length);
  if (alterBase) {
    if (buildingIds.has(alterBase)) return alterBase;
    const mappedAlterBase = buildingIdByItemId.get(alterBase);
    if (mappedAlterBase) return mappedAlterBase;
  }

  if (buildingIds.has(entity.id)) return entity.id;
  return buildingIdByItemId.get(entity.id);
}

function resolveCurrentTemplate(entity, originalDeviceId, expectedById, templatesByBuildingId) {
  const exactExpected = expectedById.get(entity.id);
  if (exactExpected) return exactExpected;

  const candidates = templatesByBuildingId.get(originalDeviceId) ?? [];
  const taggedMode = entity.tags
    .find((tag) => tag.startsWith("alter-variant:"))
    ?.slice("alter-variant:".length);
  const defaultTemplate = candidates.find((candidate) => candidate.isDefaultTemplate);
  const mode = taggedMode ?? defaultTemplate?.mode;
  const modeCandidates = mode
    ? candidates.filter((candidate) => candidate.mode === mode)
    : candidates;

  if (taggedMode && modeCandidates.length === 0) {
    return {
      mode: taggedMode,
      templateId: "（解包来源中不存在）",
    };
  }
  if (modeCandidates.length === 1) return modeCandidates[0];
  if (mode && modeCandidates.length > 1) {
    const escapedMode = mode.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const indexMatch = new RegExp(`_${escapedMode}_([0-9]+)$`).exec(entity.id);
    if (indexMatch) {
      const templateId = `${mode}__${indexMatch[1]}`;
      const indexedTemplate = modeCandidates.find((candidate) => candidate.templateId === templateId);
      if (indexedTemplate) return indexedTemplate;
    }
  }

  return defaultTemplate ?? modeCandidates[0];
}

function currentEntityToRow(
  entity,
  expectedById,
  buildingIdByItemId,
  templatesByBuildingId,
  zhCN,
  enUS,
) {
  const buildingIds = new Set(templatesByBuildingId.keys());
  const originalDeviceId = resolveOriginalDeviceId(
    entity,
    expectedById,
    buildingIdByItemId,
    buildingIds,
  );
  if (!originalDeviceId) return undefined;

  const template = resolveCurrentTemplate(
    entity,
    originalDeviceId,
    expectedById,
    templatesByBuildingId,
  );
  if (!template) return undefined;

  return {
    id: entity.id,
    zhCN: zhCN.get(entity.nameKey) ?? "（缺少中文翻译）",
    enUS: enUS.get(entity.nameKey) ?? "(missing English translation)",
    originalDeviceId,
    mode: template.mode,
    templateId: template.templateId,
  };
}

function deviceRecordKey(device) {
  return JSON.stringify([
    device.id,
    device.zhCN,
    device.enUS,
    device.originalDeviceId,
    device.mode,
    device.templateId,
  ]);
}

function compareDeviceRows(left, right) {
  return left.id.localeCompare(right.id)
    || left.templateId.localeCompare(right.templateId)
    || left.mode.localeCompare(right.mode);
}

export function compareDeviceRecords({
  expectedData,
  currentEntities,
  zhCN,
  enUS,
  includeAllExported = false,
}) {
  const expectedById = new Map(expectedData.devices.map((device) => [device.id, device]));
  const representedBuildingIds = new Set();
  const buildingIds = new Set(expectedData.templatesByBuildingId.keys());

  for (const entity of currentEntities) {
    const originalDeviceId = resolveOriginalDeviceId(
      entity,
      expectedById,
      expectedData.buildingIdByItemId,
      buildingIds,
    );
    if (originalDeviceId) representedBuildingIds.add(originalDeviceId);
  }

  const scopedBuildingIds = includeAllExported ? buildingIds : representedBuildingIds;
  const expectedRows = expectedData.devices
    .filter((device) => scopedBuildingIds.has(device.originalDeviceId))
    .map(({ isDefaultTemplate: _isDefaultTemplate, ...device }) => device);
  const currentRows = currentEntities
    .map((entity) => currentEntityToRow(
      entity,
      expectedById,
      expectedData.buildingIdByItemId,
      expectedData.templatesByBuildingId,
      zhCN,
      enUS,
    ))
    .filter((device) => device && scopedBuildingIds.has(device.originalDeviceId));
  const expectedKeys = new Set(expectedRows.map(deviceRecordKey));
  const currentKeys = new Set(currentRows.map(deviceRecordKey));

  return {
    removals: currentRows.filter((device) => !expectedKeys.has(deviceRecordKey(device))).sort(compareDeviceRows),
    additions: expectedRows.filter((device) => !currentKeys.has(deviceRecordKey(device))).sort(compareDeviceRows),
    expectedCount: expectedRows.length,
    currentCount: currentRows.length,
    comparedBuildingCount: scopedBuildingIds.size,
    ignoredExportedBuildingCount: buildingIds.size - scopedBuildingIds.size,
    includeAllExported,
  };
}

function escapeMarkdownCell(value) {
  return String(value).replaceAll("|", "\\|").replaceAll("\n", "<br>");
}

function renderTable(rows) {
  if (rows.length === 0) return "（无）";
  const header = "| id | 中文 | 英文 | 原始设备 ID | mode | template ID |";
  const divider = "| --- | --- | --- | --- | --- | --- |";
  const body = rows.map((row) => [
    row.id,
    row.zhCN,
    row.enUS,
    row.originalDeviceId,
    row.mode,
    row.templateId,
  ].map(escapeMarkdownCell).join(" | "));
  return [header, divider, ...body.map((line) => `| ${line} |`)].join("\n");
}

export function renderComparisonReport(comparison, exportPath) {
  const consistent = comparison.removals.length === 0 && comparison.additions.length === 0;
  const scope = comparison.includeAllExported
    ? "全部具备 buildingItem 映射、renderer template 和可解析名称的解包设备"
    : "当前 registry 已覆盖的原始设备族";

  return [
    "# 设备解包数据对账",
    "",
    `- 解包来源：${exportPath}`,
    `- 对账范围：${scope}`,
    `- 原始设备族：${comparison.comparedBuildingCount}`,
    `- 当前设备记录：${comparison.currentCount}`,
    `- 期望设备记录：${comparison.expectedCount}`,
    `- 结果：${consistent ? "一致" : "不一致"}`,
    ...(comparison.includeAllExported || comparison.ignoredExportedBuildingCount === 0
      ? []
      : [`- 未纳入的解包设备族：${comparison.ignoredExportedBuildingCount}（使用 --all-exported 可全部对账）`]),
    "",
    `## 应移除的设备（${comparison.removals.length}）`,
    "",
    renderTable(comparison.removals),
    "",
    `## 应新增的设备（${comparison.additions.length}）`,
    "",
    renderTable(comparison.additions),
  ].join("\n");
}

function printHelp() {
  console.log(`用法：
  node src/scripts/compare-exported-devices.mjs <raw-table 来源目录 | legacy json-export 文件> [--all-exported]

必须显式选择来源；legacy 示例：${DEFAULT_EXPORT_PATH}
默认只对账当前 registry 已覆盖的原始设备族。
--all-exported  对账解包来源中全部具备 buildingItem 映射、renderer template 和可解析名称的设备。`);
}

function parseArguments(args) {
  let exportPath;
  let includeAllExported = false;

  for (const argument of args) {
    if (argument === "--help" || argument === "-h") return { help: true };
    if (argument === "--all-exported") {
      includeAllExported = true;
      continue;
    }
    if (argument.startsWith("-")) throw new Error(`未知参数：${argument}`);
    if (exportPath) throw new Error("只能指定一个导出文件路径");
    exportPath = resolve(PROJECT_ROOT, argument);
  }

  if (!exportPath) {
    throw new Error(`必须显式指定解包来源；legacy 示例：${DEFAULT_EXPORT_PATH}`);
  }
  return { exportPath, includeAllExported, help: false };
}

async function resolveJsonPath(path) {
  if (extname(path).toLowerCase() === ".json") return path;
  return path;
}

export async function runComparison(args = process.argv.slice(2)) {
  const options = parseArguments(args);
  if (options.help) {
    printHelp();
    return { consistent: true, help: true };
  }

  const exportPath = await resolveJsonPath(options.exportPath);
  const source = openUnpackTableSource(exportPath);
  const [entitySource, zhCNSource, enUSSource] = await Promise.all([
    readFile(ENTITY_SOURCE_PATH, "utf8"),
    readFile(ZH_CN_SOURCE_PATH, "utf8"),
    readFile(EN_US_SOURCE_PATH, "utf8"),
  ]);
  const exportData = buildDeviceAnalysisInput(source);
  const expectedData = buildExpectedDevices(exportData);
  const comparison = compareDeviceRecords({
    expectedData,
    currentEntities: extractCurrentEntities(entitySource, ENTITY_SOURCE_PATH),
    zhCN: extractI18nRegistry(zhCNSource, ZH_CN_SOURCE_PATH),
    enUS: extractI18nRegistry(enUSSource, EN_US_SOURCE_PATH),
    includeAllExported: options.includeAllExported,
  });
  console.log(renderComparisonReport(comparison, describeUnpackTableSource(source)));

  return {
    consistent: comparison.removals.length === 0 && comparison.additions.length === 0,
    help: false,
    comparison,
  };
}

const isDirectExecution = process.argv[1]
  && resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (isDirectExecution) {
  runComparison()
    .then((result) => {
      if (!result.consistent) process.exitCode = 1;
    })
    .catch((error) => {
      console.error(`设备导出对账失败：${error instanceof Error ? error.message : String(error)}`);
      process.exitCode = 2;
    });
}
