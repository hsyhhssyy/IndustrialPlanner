import { readFile } from "node:fs/promises";
import { dirname, extname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import ts from "typescript";

import {
  describeUnpackTableSource,
  openUnpackTableSource,
} from "../../.agents/skills/unpack-data-analysis/scripts/unpack-table-source.mjs";
import {
  resolveRawBuildingAlias,
} from "../../.agents/skills/unpack-data-analysis/scripts/device-building-aliases.mjs";

const SCRIPT_DIRECTORY = dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = resolve(SCRIPT_DIRECTORY, "../..");
const DEFAULT_EXPORT_PATH = resolve(PROJECT_ROOT, ".temp/json-export.json");
const ENTITY_SOURCE_PATH = resolve(PROJECT_ROOT, "src/registry/entity-definition.ts");
const RECIPE_SOURCE_PATH = resolve(PROJECT_ROOT, "src/registry/recipe-definition.ts");
const ZH_CN_SOURCE_PATH = resolve(PROJECT_ROOT, "src/shared/i18n/zh-cn/registry.ts");
const EN_US_SOURCE_PATH = resolve(PROJECT_ROOT, "src/shared/i18n/en-us/registry.ts");

const APPROVED_NAME_EXCEPTIONS = Object.freeze({
  log_hongs_bus: Object.freeze({
    currentZhCN: "存取线基段",
    rawZhCN: "仓库存取线基段",
    reason: "raw 中文建筑名称超过 5 个字，需要特殊审阅；用户已明确将项目显示名压缩为 5 个字。",
  }),
  log_hongs_bus_source: Object.freeze({
    currentZhCN: "存取线源桩",
    rawZhCN: "仓库存取线源桩",
    reason: "raw 中文建筑名称超过 5 个字，需要特殊审阅；用户已明确将项目显示名压缩为 5 个字。",
  }),
});

// AI-REMOVED 2026-08-31:
// Reason: raw i18n 只提供 building 级名称；按 mode 人工拼接名称会把项目显示策略伪装成解包事实。
// Trigger: 用户要求按“单个 raw building 转换为多个项目变体”的既有机制修正技能和对账脚本。
// Evidence: FactoryMachineCrafterTable.modeMap 提供变体映射，但 FactoryBuildingTable.name 不提供变体名称。
// Replacement: generateDeviceI18n 直接保留 raw building 名称；变体身份由 modeMap 与 registry tag 对账。
// Risk: Low
// Human Review: Required
//
// Original code:
// const MODE_I18N = Object.freeze({
//   normal: { zhCN: "", enUS: "" },
//   gastrans: { zhCN: "气体", enUS: "Gas" },
//   liquidtrans: { zhCN: "液体", enUS: "Liquid" },
//   gas: { zhCN: "气体", enUS: "Gas" },
//   liquid: { zhCN: "液体", enUS: "Liquid" },
//   // recipes-export.json 当前还包含以下两种 mode；沿用项目已有领域含义。
//   // AI-CORRECTION 2026-08-31: 当前输入已改为 raw TableCfg 或 legacy json-export；两种来源仍包含以下 mode，原领域含义不变。
//   solidtrans: { zhCN: "固体", enUS: "Solid" },
//   gasliquid: { zhCN: "气液", enUS: "Gas/Liquid" },
// });

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
  const machineCrafterTable = assertRecord(
    source.readTable("FactoryMachineCrafterTable"),
    "FactoryMachineCrafterTable",
  );
  const machineCraftTable = assertRecord(
    source.readTable("FactoryMachineCraftTable"),
    "FactoryMachineCraftTable",
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
      machineCrafterTable,
    },
    recipes: machineCraftTable,
    i18n: { buildings: {} },
  };
}

export function generateDeviceI18n(baseNames) {
  return { ...baseNames };
}

function buildRawVariantKey(buildingId, mode) {
  return JSON.stringify([buildingId, mode]);
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

function buildFormulaIdsByGroup(machineCraftTable) {
  const formulaIdsByGroup = new Map();
  for (const [tableKey, rawFormula] of Object.entries(machineCraftTable)) {
    const formula = assertRecord(rawFormula, `machineCraftTable.${tableKey}`);
    const formulaId = readRequiredString(
      formula.id ?? tableKey,
      `machineCraftTable.${tableKey}.id`,
    );
    const formulaGroupId = readRequiredString(
      formula.formulaGroupId,
      `machineCraftTable.${tableKey}.formulaGroupId`,
    );
    const formulaIds = formulaIdsByGroup.get(formulaGroupId) ?? [];
    formulaIds.push(formulaId);
    formulaIdsByGroup.set(formulaGroupId, formulaIds);
  }
  for (const formulaIds of formulaIdsByGroup.values()) formulaIds.sort();
  return formulaIdsByGroup;
}

function collectRawVariantEvidence(
  buildingId,
  building,
  machineCrafterTable,
  formulaIdsByGroup,
) {
  const evidenceByMode = new Map();
  const ensureEvidence = (mode) => {
    const existing = evidenceByMode.get(mode);
    if (existing) return existing;
    const evidence = {
      mode,
      formulaGroupIds: new Set(),
      rendererTemplateIds: new Set(),
      isEnvironmentMode: false,
      isDefaultRendererMode: false,
    };
    evidenceByMode.set(mode, evidence);
    return evidence;
  };

  const rawCrafter = machineCrafterTable[buildingId];
  if (rawCrafter !== undefined) {
    const crafter = assertRecord(rawCrafter, `machineCrafterTable.${buildingId}`);
    if (!Array.isArray(crafter.modeMap)) {
      throw new Error(`machineCrafterTable.${buildingId}.modeMap 必须是数组`);
    }
    for (const [index, rawMode] of crafter.modeMap.entries()) {
      const modeEntry = assertRecord(rawMode, `machineCrafterTable.${buildingId}.modeMap.${index}`);
      const mode = readRequiredString(
        modeEntry.modeName,
        `machineCrafterTable.${buildingId}.modeMap.${index}.modeName`,
      );
      const groupName = modeEntry.groupName;
      if (typeof groupName !== "string") {
        throw new Error(
          `machineCrafterTable.${buildingId}.modeMap.${index}.groupName 必须是字符串`,
        );
      }
      const evidence = ensureEvidence(mode);
      if (groupName.length > 0) evidence.formulaGroupIds.add(groupName);
      if (modeEntry.isEnvMode === true) evidence.isEnvironmentMode = true;
    }
  }

  const hasSemanticModes = evidenceByMode.size > 0;
  const rendererTemplateMap = assertRecord(
    building.rendererTemplateMap,
    `buildingTable.${buildingId}.rendererTemplateMap`,
  );
  for (const [templateId, rawTemplate] of Object.entries(rendererTemplateMap)) {
    const template = assertRecord(rawTemplate, `${buildingId}.${templateId}`);
    const declaredMode = readRequiredString(
      template.machineModeType,
      `${buildingId}.${templateId}.machineModeType`,
    );
    const { mode } = parseTemplateId(templateId, declaredMode, buildingId);
    const evidence = hasSemanticModes ? evidenceByMode.get(mode) : ensureEvidence(mode);
    if (evidence === undefined) continue;
    evidence.rendererTemplateIds.add(templateId);
    if (building.defaultRendererTemplate === templateId) {
      evidence.isDefaultRendererMode = true;
    }
  }

  return [...evidenceByMode.values()]
    .map((evidence) => ({
      mode: evidence.mode,
      formulaGroupIds: [...evidence.formulaGroupIds].sort(),
      formulaIds: [...evidence.formulaGroupIds]
        .flatMap((formulaGroupId) => formulaIdsByGroup.get(formulaGroupId) ?? [])
        .sort(),
      rendererTemplateIds: [...evidence.rendererTemplateIds].sort(),
      isEnvironmentMode: evidence.isEnvironmentMode,
      isDefaultRendererMode: evidence.isDefaultRendererMode,
    }))
    .sort((left, right) => left.mode.localeCompare(right.mode));
}

export function buildRawDeviceVariants(exportData) {
  assertRecord(exportData, "导出文件根节点");
  const buildingTable = assertRecord(
    exportData.buildings?.buildingTable,
    "buildings.buildingTable",
  );
  const machineCrafterTable = assertRecord(
    exportData.buildings?.machineCrafterTable,
    "buildings.machineCrafterTable",
  );
  const machineCraftTable = assertRecord(exportData.recipes, "recipes");
  const formulaIdsByGroup = buildFormulaIdsByGroup(machineCraftTable);
  const { buildingIdByItemId, itemMappedBuildingIds } = buildBuildingItemIndex(exportData);
  const rawVariants = [];
  const variantsByBuildingId = new Map();

  for (const buildingId of [...itemMappedBuildingIds].sort()) {
    const building = assertRecord(buildingTable[buildingId], `buildingTable.${buildingId}`);
    const baseNames = resolveBaseNames(exportData, buildingId, building);
    const names = generateDeviceI18n(baseNames);
    const buildingVariants = collectRawVariantEvidence(
      buildingId,
      building,
      machineCrafterTable,
      formulaIdsByGroup,
    ).map((evidence) => ({
      variantKey: buildRawVariantKey(buildingId, evidence.mode),
      ...names,
      originalDeviceId: buildingId,
      ...evidence,
    }));

    if (buildingVariants.length === 0) continue;
    variantsByBuildingId.set(buildingId, buildingVariants);
    rawVariants.push(...buildingVariants);
  }

  const duplicateVariantKeys = findDuplicates(rawVariants.map((variant) => variant.variantKey));
  if (duplicateVariantKeys.length > 0) {
    throw new Error(`解包数据生成了重复变体键：${duplicateVariantKeys.join(", ")}`);
  }

  return {
    rawVariants: rawVariants.sort(compareRawVariantRows),
    buildingIdByItemId,
    variantsByBuildingId,
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

export function extractCurrentRecipeAssignments(
  sourceText,
  fileName = "recipe-definition.ts",
) {
  const sourceFile = ts.createSourceFile(
    fileName,
    sourceText,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TS,
  );
  const assignments = new Map();

  for (const statement of sourceFile.statements) {
    if (!ts.isVariableStatement(statement)) continue;
    for (const declaration of statement.declarationList.declarations) {
      if (!ts.isIdentifier(declaration.name) || declaration.name.text !== "RECIPE_DEFINITIONS") {
        continue;
      }
      if (!declaration.initializer || !ts.isArrayLiteralExpression(declaration.initializer)) {
        throw new Error(`${fileName} 的 RECIPE_DEFINITIONS 必须使用数组字面量`);
      }
      for (const element of declaration.initializer.elements) {
        if (!ts.isObjectLiteralExpression(element)) continue;
        const formulaId = readLiteralString(findObjectProperty(element, "id"));
        const machineId = readLiteralString(findObjectProperty(element, "machineId"));
        if (formulaId === undefined || machineId === undefined) continue;
        if (assignments.has(formulaId)) {
          throw new Error(`当前 registry 存在重复配方 ID：${formulaId}`);
        }
        assignments.set(formulaId, machineId);
      }
    }
  }

  if (assignments.size === 0) {
    throw new Error(`${fileName} 中没有找到 RECIPE_DEFINITIONS 配方归属`);
  }
  return assignments;
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

function resolveOriginalDeviceId(entity, buildingIdByItemId, buildingIds) {
  const alterBase = entity.tags
    .find((tag) => tag.startsWith("alter:"))
    ?.slice("alter:".length);
  if (alterBase) {
    const aliasedAlterBase = resolveRawBuildingAlias(alterBase);
    if (buildingIds.has(aliasedAlterBase)) return aliasedAlterBase;
    const mappedAlterBase = buildingIdByItemId.get(alterBase);
    if (mappedAlterBase) return mappedAlterBase;
  }

  const aliasedEntityId = resolveRawBuildingAlias(entity.id);
  if (buildingIds.has(aliasedEntityId)) return aliasedEntityId;
  return buildingIdByItemId.get(entity.id);
}

function resolveCurrentVariant(entity, originalDeviceId, variantsByBuildingId) {
  const candidates = variantsByBuildingId.get(originalDeviceId) ?? [];
  const taggedMode = entity.tags
    .find((tag) => tag.startsWith("alter-variant:"))
    ?.slice("alter-variant:".length);
  if (taggedMode) {
    return {
      mode: taggedMode,
      rawVariant: candidates.find((candidate) => candidate.mode === taggedMode) ?? null,
      resolution: "tag",
    };
  }

  if (candidates.length === 1) {
    return {
      mode: candidates[0].mode,
      rawVariant: candidates[0],
      resolution: "single-variant",
    };
  }

  const defaultRendererVariants = candidates.filter((candidate) =>
    candidate.isDefaultRendererMode
  );
  if (defaultRendererVariants.length === 1) {
    return {
      mode: defaultRendererVariants[0].mode,
      rawVariant: defaultRendererVariants[0],
      resolution: "default-renderer",
    };
  }
  return {
    mode: null,
    rawVariant: null,
    resolution: "unresolved",
    reason: `raw building ${originalDeviceId} 有 ${candidates.length} 个变体，但实体没有 alter-variant tag，且默认 renderer mode 不唯一`,
  };
}

function currentEntityToRow(
  entity,
  originalDeviceId,
  variantsByBuildingId,
  zhCN,
  enUS,
) {
  const resolvedVariant = resolveCurrentVariant(
    entity,
    originalDeviceId,
    variantsByBuildingId,
  );
  if (resolvedVariant.mode === null) {
    return {
      unresolved: true,
      id: entity.id,
      originalDeviceId,
      reason: resolvedVariant.reason,
    };
  }

  const rawNames = (variantsByBuildingId.get(originalDeviceId) ?? [])[0];
  const rawVariant = resolvedVariant.rawVariant;

  return {
    unresolved: false,
    id: entity.id,
    currentZhCN: zhCN.get(entity.nameKey) ?? "（缺少中文翻译）",
    currentEnUS: enUS.get(entity.nameKey) ?? "(missing English translation)",
    rawZhCN: rawNames?.zhCN ?? "（解包来源中不存在）",
    rawEnUS: rawNames?.enUS ?? "(missing from unpack source)",
    originalDeviceId,
    mode: resolvedVariant.mode,
    variantKey: buildRawVariantKey(originalDeviceId, resolvedVariant.mode),
    formulaGroupIds: rawVariant?.formulaGroupIds ?? [],
    rendererTemplateIds: rawVariant?.rendererTemplateIds ?? [],
    rawVariantExists: rawVariant !== null,
    resolution: resolvedVariant.resolution,
  };
}

function deviceRecordKey(device) {
  return device.variantKey;
}

function compareRawVariantRows(left, right) {
  return left.originalDeviceId.localeCompare(right.originalDeviceId)
    || left.mode.localeCompare(right.mode);
}

function compareDeviceRows(left, right) {
  return left.originalDeviceId.localeCompare(right.originalDeviceId)
    || left.mode.localeCompare(right.mode)
    || left.id.localeCompare(right.id);
}

export function compareDeviceRecords({
  rawData,
  currentEntities,
  currentRecipeMachineIdById = new Map(),
  zhCN,
  enUS,
  includeAllExported = false,
}) {
  const representedBuildingIds = new Set();
  const buildingIds = new Set(rawData.variantsByBuildingId.keys());
  const originalDeviceIdByEntityId = new Map();
  const unresolvedCurrentMappings = [];

  for (const entity of currentEntities) {
    const originalDeviceId = resolveOriginalDeviceId(
      entity,
      rawData.buildingIdByItemId,
      buildingIds,
    );
    if (originalDeviceId) {
      representedBuildingIds.add(originalDeviceId);
      originalDeviceIdByEntityId.set(entity.id, originalDeviceId);
      continue;
    }

    const alterBase = entity.tags
      .find((tag) => tag.startsWith("alter:"))
      ?.slice("alter:".length);
    if (alterBase) {
      unresolvedCurrentMappings.push({
        id: entity.id,
        originalDeviceId: alterBase,
        reason: `alter:${alterBase} 无法映射到 FactoryBuildingTable 或 FactoryBuildingItemTable`,
      });
    }
  }

  const scopedBuildingIds = includeAllExported ? buildingIds : representedBuildingIds;
  const rawVariantRows = rawData.rawVariants
    .filter((variant) => scopedBuildingIds.has(variant.originalDeviceId));
  const currentRows = [];
  for (const entity of currentEntities) {
    const originalDeviceId = originalDeviceIdByEntityId.get(entity.id);
    if (!originalDeviceId || !scopedBuildingIds.has(originalDeviceId)) continue;
    const primaryRow = currentEntityToRow(
      entity,
      originalDeviceId,
      rawData.variantsByBuildingId,
      zhCN,
      enUS,
    );
    const rowsByVariantKey = new Map();
    if (!primaryRow.unresolved) {
      rowsByVariantKey.set(primaryRow.variantKey, primaryRow);
    }

    const candidates = rawData.variantsByBuildingId.get(originalDeviceId) ?? [];
    for (const rawVariant of candidates) {
      const isCoveredByProjectRecipes = (rawVariant.formulaIds ?? []).some((formulaId) =>
        currentRecipeMachineIdById.get(formulaId) === entity.id
      );
      if (!isCoveredByProjectRecipes) continue;
      rowsByVariantKey.set(rawVariant.variantKey, {
        unresolved: false,
        id: entity.id,
        currentZhCN: zhCN.get(entity.nameKey) ?? "（缺少中文翻译）",
        currentEnUS: enUS.get(entity.nameKey) ?? "(missing English translation)",
        rawZhCN: rawVariant.zhCN,
        rawEnUS: rawVariant.enUS,
        originalDeviceId,
        mode: rawVariant.mode,
        variantKey: rawVariant.variantKey,
        formulaGroupIds: rawVariant.formulaGroupIds,
        rendererTemplateIds: rawVariant.rendererTemplateIds,
        rawVariantExists: true,
        resolution: "recipe-assignment",
      });
    }

    if (primaryRow.unresolved && rowsByVariantKey.size === 0) {
      unresolvedCurrentMappings.push(primaryRow);
      continue;
    }
    currentRows.push(...rowsByVariantKey.values());
  }

  const matchedCurrentRows = currentRows.filter((row) => row.rawVariantExists);
  const matchedRowsByVariantKey = new Map();
  for (const row of matchedCurrentRows) {
    const rows = matchedRowsByVariantKey.get(deviceRecordKey(row)) ?? [];
    rows.push(row);
    matchedRowsByVariantKey.set(deviceRecordKey(row), rows);
  }

  const duplicateProjectVariants = [...matchedRowsByVariantKey.entries()]
    .filter(([, rows]) => rows.length > 1)
    .map(([variantKey, rows]) => ({
      variantKey,
      originalDeviceId: rows[0].originalDeviceId,
      mode: rows[0].mode,
      projectEntityIds: rows.map((row) => row.id).sort(),
    }))
    .sort(compareRawVariantRows);
  const missingProjectVariants = rawVariantRows
    .filter((variant) => !matchedRowsByVariantKey.has(deviceRecordKey(variant)))
    .sort(compareRawVariantRows);
  const unsupportedProjectVariants = currentRows
    .filter((row) => !row.rawVariantExists)
    .sort(compareDeviceRows);
  const approvedNameExceptions = [];
  const nameModifications = [];
  const comparedNameEntityIds = new Set();
  for (const row of matchedCurrentRows) {
    if (comparedNameEntityIds.has(row.id)) continue;
    comparedNameEntityIds.add(row.id);
    const approvedException = APPROVED_NAME_EXCEPTIONS[row.id];
    const isApprovedZhDifference = approvedException !== undefined
      && row.currentZhCN === approvedException.currentZhCN
      && row.rawZhCN === approvedException.rawZhCN;
    if (isApprovedZhDifference) {
      approvedNameExceptions.push({ ...row, reason: approvedException.reason });
    }

    const hasUnapprovedZhDifference = row.currentZhCN !== row.rawZhCN
      && !isApprovedZhDifference;
    const hasEnglishDifference = row.currentEnUS !== row.rawEnUS;
    if (hasUnapprovedZhDifference || hasEnglishDifference) {
      nameModifications.push(row);
    }
  }
  approvedNameExceptions.sort(compareDeviceRows);
  nameModifications.sort(compareDeviceRows);

  return {
    nameModifications,
    approvedNameExceptions,
    missingProjectVariants,
    unsupportedProjectVariants,
    duplicateProjectVariants,
    unresolvedCurrentMappings: unresolvedCurrentMappings.sort((left, right) =>
      left.id.localeCompare(right.id)
    ),
    rawVariantCount: rawVariantRows.length,
    currentCount: currentRows.length,
    matchedVariantCount: matchedRowsByVariantKey.size,
    comparedBuildingCount: scopedBuildingIds.size,
    ignoredExportedBuildingCount: buildingIds.size - scopedBuildingIds.size,
    includeAllExported,
  };
}

function escapeMarkdownCell(value) {
  return String(value).replaceAll("|", "\\|").replaceAll("\n", "<br>");
}

function renderTable(headers, rows) {
  if (rows.length === 0) return "（无）";
  const header = `| ${headers.map(escapeMarkdownCell).join(" | ")} |`;
  const divider = `| ${headers.map(() => "---").join(" | ")} |`;
  const body = rows.map((cells) =>
    `| ${cells.map(escapeMarkdownCell).join(" | ")} |`
  );
  return [header, divider, ...body].join("\n");
}

function formatEvidenceIds(values) {
  return values.length > 0 ? values.join(", ") : "（无）";
}

function isComparisonConsistent(comparison) {
  return comparison.nameModifications.length === 0
    && comparison.missingProjectVariants.length === 0
    && comparison.unsupportedProjectVariants.length === 0
    && comparison.duplicateProjectVariants.length === 0
    && comparison.unresolvedCurrentMappings.length === 0;
}

export function renderComparisonReport(comparison, exportPath) {
  const consistent = isComparisonConsistent(comparison);
  const scope = comparison.includeAllExported
    ? "全部具备 buildingItem 映射、变体证据和可解析名称的解包设备"
    : "当前 registry 已覆盖的原始设备族";

  return [
    "# 设备解包数据对账",
    "",
    `- 解包来源：${exportPath}`,
    `- 对账范围：${scope}`,
    `- 原始设备族：${comparison.comparedBuildingCount}`,
    `- raw 语义变体：${comparison.rawVariantCount}`,
    `- 当前项目变体映射：${comparison.currentCount}`,
    `- 已匹配语义变体：${comparison.matchedVariantCount}`,
    `- 结果：${consistent ? "一致" : "不一致"}`,
    ...(comparison.includeAllExported || comparison.ignoredExportedBuildingCount === 0
      ? []
      : [`- 未纳入的解包设备族：${comparison.ignoredExportedBuildingCount}（使用 --all-exported 可全部对账）`]),
    "",
    `## 名称修改（${comparison.nameModifications.length}）`,
    "",
    renderTable(
      ["项目实体 ID", "raw building ID", "mode", "当前中文", "raw 中文", "当前英文", "raw 英文"],
      comparison.nameModifications.map((row) => [
        row.id,
        row.originalDeviceId,
        row.mode,
        row.currentZhCN,
        row.rawZhCN,
        row.currentEnUS,
        row.rawEnUS,
      ]),
    ),
    "",
    `## 已审阅名称例外（${comparison.approvedNameExceptions.length}）`,
    "",
    renderTable(
      ["项目实体 ID", "raw building ID", "当前中文", "raw 中文", "审阅说明"],
      comparison.approvedNameExceptions.map((row) => [
        row.id,
        row.originalDeviceId,
        row.currentZhCN,
        row.rawZhCN,
        row.reason,
      ]),
    ),
    "",
    `## 项目缺少的 raw 变体（${comparison.missingProjectVariants.length}）`,
    "",
    renderTable(
      ["raw building ID", "mode", "formula group", "renderer template", "环境模式"],
      comparison.missingProjectVariants.map((row) => [
        row.originalDeviceId,
        row.mode,
        formatEvidenceIds(row.formulaGroupIds),
        formatEvidenceIds(row.rendererTemplateIds),
        row.isEnvironmentMode ? "是" : "否",
      ]),
    ),
    "",
    `## 缺少 raw 证据的项目变体（${comparison.unsupportedProjectVariants.length}）`,
    "",
    renderTable(
      ["项目实体 ID", "raw building ID", "mode"],
      comparison.unsupportedProjectVariants.map((row) => [
        row.id,
        row.originalDeviceId,
        row.mode,
      ]),
    ),
    "",
    `## 重复映射的项目变体（${comparison.duplicateProjectVariants.length}）`,
    "",
    renderTable(
      ["raw building ID", "mode", "项目实体 ID"],
      comparison.duplicateProjectVariants.map((row) => [
        row.originalDeviceId,
        row.mode,
        row.projectEntityIds.join(", "),
      ]),
    ),
    "",
    `## 无法解析的项目映射（${comparison.unresolvedCurrentMappings.length}）`,
    "",
    renderTable(
      ["项目实体 ID", "目标 raw building ID", "原因"],
      comparison.unresolvedCurrentMappings.map((row) => [
        row.id,
        row.originalDeviceId,
        row.reason,
      ]),
    ),
  ].join("\n");
}

function printHelp() {
  console.log(`用法：
  node src/scripts/compare-exported-devices.mjs <raw-table 来源目录 | legacy json-export 文件> [--all-exported]

必须显式选择来源；legacy 示例：${DEFAULT_EXPORT_PATH}
默认只对账当前 registry 已覆盖的原始设备族。
--all-exported  对账解包来源中全部具备 buildingItem 映射、变体证据和可解析名称的设备。`);
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
  const [entitySource, recipeSource, zhCNSource, enUSSource] = await Promise.all([
    readFile(ENTITY_SOURCE_PATH, "utf8"),
    readFile(RECIPE_SOURCE_PATH, "utf8"),
    readFile(ZH_CN_SOURCE_PATH, "utf8"),
    readFile(EN_US_SOURCE_PATH, "utf8"),
  ]);
  const exportData = buildDeviceAnalysisInput(source);
  const rawData = buildRawDeviceVariants(exportData);
  const comparison = compareDeviceRecords({
    rawData,
    currentEntities: extractCurrentEntities(entitySource, ENTITY_SOURCE_PATH),
    currentRecipeMachineIdById: extractCurrentRecipeAssignments(
      recipeSource,
      RECIPE_SOURCE_PATH,
    ),
    zhCN: extractI18nRegistry(zhCNSource, ZH_CN_SOURCE_PATH),
    enUS: extractI18nRegistry(enUSSource, EN_US_SOURCE_PATH),
    includeAllExported: options.includeAllExported,
  });
  console.log(renderComparisonReport(comparison, describeUnpackTableSource(source)));

  return {
    consistent: isComparisonConsistent(comparison),
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
