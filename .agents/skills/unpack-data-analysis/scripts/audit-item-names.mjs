import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import ts from "typescript";

import {
  describeUnpackTableSource,
  openUnpackTableSource,
} from "./unpack-table-source.mjs";

const SCRIPT_DIRECTORY = dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = resolve(SCRIPT_DIRECTORY, "../../../..");
const ITEM_SOURCE_PATH = resolve(PROJECT_ROOT, "src/registry/item-definition.ts");
const ZH_CN_SOURCE_PATH = resolve(PROJECT_ROOT, "src/shared/i18n/zh-cn/registry.ts");
const EN_US_SOURCE_PATH = resolve(PROJECT_ROOT, "src/shared/i18n/en-us/registry.ts");

const CONTAINER_TAG_PREFIX = "container:";
const CONTAINER_ITEM_TAG_PREFIX = "container-item:";

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

export function extractCurrentItems(sourceText, fileName = "item-definition.ts") {
  const sourceFile = ts.createSourceFile(
    fileName,
    sourceText,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TS,
  );
  const items = [];

  for (const statement of sourceFile.statements) {
    if (!ts.isVariableStatement(statement)) continue;
    for (const declaration of statement.declarationList.declarations) {
      if (!ts.isIdentifier(declaration.name) || declaration.name.text !== "ITEM_DEFINITIONS") {
        continue;
      }
      if (!declaration.initializer || !ts.isArrayLiteralExpression(declaration.initializer)) {
        throw new Error(`${fileName} 的 ITEM_DEFINITIONS 必须使用数组字面量`);
      }
      for (const element of declaration.initializer.elements) {
        if (!ts.isObjectLiteralExpression(element)) continue;
        const id = readLiteralString(findObjectProperty(element, "id"));
        const nameKey = readLiteralString(findObjectProperty(element, "nameKey"));
        if (id === undefined || nameKey === undefined) continue;
        items.push({
          id,
          nameKey,
          tags: readLiteralStringArray(findObjectProperty(element, "tags")),
        });
      }
    }
  }

  if (items.length === 0) {
    throw new Error(`${fileName} 中没有找到 ITEM_DEFINITIONS`);
  }
  const duplicateIds = findDuplicates(items.map((item) => item.id));
  if (duplicateIds.length > 0) {
    throw new Error(`当前 registry 存在重复物品 ID：${duplicateIds.join(", ")}`);
  }
  return items.sort((left, right) => left.id.localeCompare(right.id));
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

function readFormulaItems(value, label) {
  if (!Array.isArray(value)) throw new Error(`${label} 必须是数组`);
  const items = [];
  for (const [groupIndex, rawGroup] of value.entries()) {
    const group = assertRecord(rawGroup, `${label}.${groupIndex}`);
    if (!Array.isArray(group.group)) {
      throw new Error(`${label}.${groupIndex}.group 必须是数组`);
    }
    for (const [itemIndex, rawItem] of group.group.entries()) {
      const item = assertRecord(rawItem, `${label}.${groupIndex}.group.${itemIndex}`);
      items.push({
        id: readRequiredString(item.id, `${label}.${groupIndex}.group.${itemIndex}.id`),
        count: item.count,
      });
    }
  }
  return items;
}

function buildContainerPairKey(itemIds) {
  return JSON.stringify([...itemIds].sort());
}

function addMapSetValue(map, key, value) {
  const values = map.get(key) ?? new Set();
  values.add(value);
  map.set(key, values);
}

export function buildRawContainerItemIdsByPair(machineCraftTable) {
  const fillingCandidatesByPair = new Map();
  const dismantlePairsByFilledItemId = new Map();

  for (const [tableKey, rawFormula] of Object.entries(machineCraftTable)) {
    const formula = assertRecord(rawFormula, `FactoryMachineCraftTable.${tableKey}`);
    const ingredients = readFormulaItems(
      formula.ingredients,
      `FactoryMachineCraftTable.${tableKey}.ingredients`,
    );
    const outcomes = readFormulaItems(
      formula.outcomes,
      `FactoryMachineCraftTable.${tableKey}.outcomes`,
    );

    if (ingredients.length === 2 && outcomes.length === 1) {
      addMapSetValue(
        fillingCandidatesByPair,
        buildContainerPairKey(ingredients.map((item) => item.id)),
        outcomes[0].id,
      );
    }
    if (ingredients.length === 1 && outcomes.length === 2) {
      addMapSetValue(
        dismantlePairsByFilledItemId,
        ingredients[0].id,
        buildContainerPairKey(outcomes.map((item) => item.id)),
      );
    }
  }

  return new Map(
    [...fillingCandidatesByPair.entries()].map(([pairKey, candidateIds]) => [
      pairKey,
      [...candidateIds]
        .filter((itemId) => dismantlePairsByFilledItemId.get(itemId)?.has(pairKey))
        .sort(),
    ]),
  );
}

function readRawI18nText(reference, i18nTable, label) {
  const i18nReference = assertRecord(reference, `${label} i18n 引用`);
  const id = i18nReference.id;
  if (typeof id !== "string" && !Number.isSafeInteger(id)) {
    throw new Error(`${label} i18n ID 必须是无损字符串或安全整数`);
  }
  if (String(id) === "0") return null;
  const text = i18nTable[String(id)];
  if (typeof text !== "string") {
    throw new Error(`${label} 缺少 i18n 文本：${String(id)}`);
  }
  return text;
}

export function buildRawItemRecords(itemTable, zhCN, enUS) {
  const items = new Map();
  for (const [tableKey, rawItem] of Object.entries(itemTable)) {
    const item = assertRecord(rawItem, `ItemTable.${tableKey}`);
    const declaredId = readRequiredString(item.id ?? tableKey, `ItemTable.${tableKey}.id`);
    items.set(tableKey, {
      id: tableKey,
      declaredId,
      zhCN: readRawI18nText(item.name, zhCN, `ItemTable.${tableKey}.name.zhCN`),
      enUS: readRawI18nText(item.name, enUS, `ItemTable.${tableKey}.name.enUS`),
    });
  }
  return items;
}

function readSingleTagValue(tags, prefix, itemId) {
  const values = tags
    .filter((tag) => tag.startsWith(prefix))
    .map((tag) => tag.slice(prefix.length));
  if (values.length > 1) {
    throw new Error(`物品 ${itemId} 存在多个 ${prefix} tag：${values.join(", ")}`);
  }
  return values[0] ?? null;
}

function compareLocaleNames({
  item,
  rawItem,
  locale,
  currentName,
  rawName,
  nameModifications,
}) {
  if (currentName === undefined || rawName === null || currentName === rawName) return;
  nameModifications.push({
    id: item.id,
    rawItemId: rawItem.id,
    locale,
    currentName,
    rawName,
  });
}

function validateComposedLocale({
  item,
  container,
  content,
  locale,
  translations,
  openParenthesis,
  closeParenthesis,
  invalidComposedNames,
}) {
  const currentName = translations.get(item.nameKey);
  const containerName = translations.get(container.nameKey);
  const contentName = translations.get(content.nameKey);
  if (currentName === undefined || containerName === undefined || contentName === undefined) {
    return false;
  }
  const expectedName = `${containerName}${openParenthesis}${contentName}${closeParenthesis}`;
  if (currentName !== expectedName) {
    invalidComposedNames.push({
      id: item.id,
      containerId: container.id,
      contentId: content.id,
      locale,
      currentName,
      expectedName,
    });
  }
  return true;
}

export function compareItemNames({
  currentItems,
  zhCN,
  enUS,
  rawItems,
  rawContainerItemIdsByPair,
}) {
  const currentItemsById = new Map(currentItems.map((item) => [item.id, item]));
  const nameModifications = [];
  const invalidComposedNames = [];
  const unresolvedContainerMappings = [];
  const missingRawItems = [];
  const missingTranslations = [];
  const validatedComposedItems = [];
  let ordinaryItemCount = 0;
  let composedItemCount = 0;

  for (const item of currentItems) {
    const missingLocales = [];
    if (!zhCN.has(item.nameKey)) missingLocales.push("zh-CN");
    if (!enUS.has(item.nameKey)) missingLocales.push("en-US");
    if (missingLocales.length > 0) {
      missingTranslations.push({ id: item.id, nameKey: item.nameKey, locales: missingLocales });
    }

    const containerId = readSingleTagValue(item.tags, CONTAINER_TAG_PREFIX, item.id);
    const contentId = readSingleTagValue(item.tags, CONTAINER_ITEM_TAG_PREFIX, item.id);
    if ((containerId === null) !== (contentId === null)) {
      unresolvedContainerMappings.push({
        id: item.id,
        containerId,
        contentId,
        reason: "container 与 container-item tag 必须同时存在",
      });
      continue;
    }

    if (containerId === null || contentId === null) {
      ordinaryItemCount += 1;
      const rawItem = rawItems.get(item.id);
      if (rawItem === undefined) {
        missingRawItems.push({ id: item.id });
        continue;
      }
      compareLocaleNames({
        item,
        rawItem,
        locale: "zh-CN",
        currentName: zhCN.get(item.nameKey),
        rawName: rawItem.zhCN,
        nameModifications,
      });
      compareLocaleNames({
        item,
        rawItem,
        locale: "en-US",
        currentName: enUS.get(item.nameKey),
        rawName: rawItem.enUS,
        nameModifications,
      });
      continue;
    }

    composedItemCount += 1;
    const container = currentItemsById.get(containerId);
    const content = currentItemsById.get(contentId);
    if (container === undefined || content === undefined) {
      unresolvedContainerMappings.push({
        id: item.id,
        containerId,
        contentId,
        reason: "container 或 container-item 未在当前 ITEM_DEFINITIONS 中定义",
      });
      continue;
    }

    const pairKey = buildContainerPairKey([containerId, contentId]);
    const rawItemIds = rawContainerItemIdsByPair.get(pairKey) ?? [];
    if (rawItemIds.length !== 1) {
      unresolvedContainerMappings.push({
        id: item.id,
        containerId,
        contentId,
        rawItemIds,
        reason: rawItemIds.length === 0
          ? "raw 灌装与拆解配方未提供可逆容器映射"
          : "同一容器与内容物组合映射到多个 raw 成品",
      });
      continue;
    }
    const rawItemId = rawItemIds[0];
    if (!rawItems.has(rawItemId)) {
      unresolvedContainerMappings.push({
        id: item.id,
        containerId,
        contentId,
        rawItemIds,
        reason: `raw 成品 ${rawItemId} 不存在于 ItemTable`,
      });
      continue;
    }

    const checkedLocales = [];
    const invalidComposedNameCountBeforeValidation = invalidComposedNames.length;
    if (validateComposedLocale({
      item,
      container,
      content,
      locale: "zh-CN",
      translations: zhCN,
      openParenthesis: "（",
      closeParenthesis: "）",
      invalidComposedNames,
    })) {
      checkedLocales.push("zh-CN");
    }
    if (validateComposedLocale({
      item,
      container,
      content,
      locale: "en-US",
      translations: enUS,
      openParenthesis: " (",
      closeParenthesis: ")",
      invalidComposedNames,
    })) {
      checkedLocales.push("en-US");
    }
    if (
      checkedLocales.length > 0
      && invalidComposedNames.length === invalidComposedNameCountBeforeValidation
    ) {
      validatedComposedItems.push({
        id: item.id,
        rawItemId,
        containerId,
        contentId,
        checkedLocales,
      });
    }
  }

  nameModifications.sort((left, right) =>
    left.id.localeCompare(right.id) || left.locale.localeCompare(right.locale)
  );
  invalidComposedNames.sort((left, right) =>
    left.id.localeCompare(right.id) || left.locale.localeCompare(right.locale)
  );
  unresolvedContainerMappings.sort((left, right) => left.id.localeCompare(right.id));
  missingRawItems.sort((left, right) => left.id.localeCompare(right.id));
  missingTranslations.sort((left, right) => left.id.localeCompare(right.id));
  validatedComposedItems.sort((left, right) => left.id.localeCompare(right.id));

  return {
    nameModifications,
    invalidComposedNames,
    unresolvedContainerMappings,
    missingRawItems,
    missingTranslations,
    validatedComposedItems,
    currentItemCount: currentItems.length,
    ordinaryItemCount,
    composedItemCount,
  };
}

function printRows(title, rows) {
  console.log(`${title}: ${rows.length}`);
  for (const row of rows) console.log(`  ${JSON.stringify(row)}`);
}

function printHumanReport(source, result, includeAll) {
  console.log(`来源: ${describeUnpackTableSource(source)}`);
  console.log(
    `项目物品: ${result.currentItemCount}；普通物品: ${result.ordinaryItemCount}；项目组合命名物品: ${result.composedItemCount}`,
  );
  printRows("名称修改（仅普通物品与 raw 名称比较）", result.nameModifications);
  printRows("项目组合命名不一致", result.invalidComposedNames);
  printRows("无法解析的容器映射", result.unresolvedContainerMappings);
  printRows("缺少 raw 证据的项目物品", result.missingRawItems);
  printRows("缺少直接 registry 翻译", result.missingTranslations);
  console.log(`项目组合命名验证通过: ${result.validatedComposedItems.length}`);
  if (includeAll) printRows("项目组合命名明细", result.validatedComposedItems);
}

function parseArguments(args) {
  const options = { sourcePath: null, includeAll: false, json: false, help: false };
  for (const argument of args) {
    if (argument === "--all") options.includeAll = true;
    else if (argument === "--json") options.json = true;
    else if (argument === "--help" || argument === "-h") options.help = true;
    else if (argument.startsWith("--")) throw new Error(`未知参数：${argument}`);
    else if (options.sourcePath === null) options.sourcePath = argument;
    else throw new Error(`只能指定一个解包来源，收到额外参数：${argument}`);
  }
  return options;
}

function printHelp() {
  console.log("用法: audit-item-names.mjs <raw-table 来源目录> [--all] [--json]");
}

async function main() {
  const options = parseArguments(process.argv.slice(2));
  if (options.help) {
    printHelp();
    return;
  }
  if (options.sourcePath === null) {
    printHelp();
    throw new Error("必须显式指定已固定版本的 raw-table 来源目录");
  }

  const source = openUnpackTableSource(options.sourcePath);
  if (source.authority !== "raw-table") {
    throw new Error("物品名称对账需要 ItemTable 与 i18n raw table，不支持 legacy json-export");
  }
  const itemTable = assertRecord(source.readTable("ItemTable"), "ItemTable");
  const machineCraftTable = assertRecord(
    source.readTable("FactoryMachineCraftTable"),
    "FactoryMachineCraftTable",
  );
  const rawZhCN = assertRecord(source.readTable("I18nTextTable_CN"), "I18nTextTable_CN");
  const rawEnUS = assertRecord(source.readTable("I18nTextTable_EN"), "I18nTextTable_EN");
  const [itemSource, zhCNSource, enUSSource] = await Promise.all([
    readFile(ITEM_SOURCE_PATH, "utf8"),
    readFile(ZH_CN_SOURCE_PATH, "utf8"),
    readFile(EN_US_SOURCE_PATH, "utf8"),
  ]);

  const result = compareItemNames({
    currentItems: extractCurrentItems(itemSource, ITEM_SOURCE_PATH),
    zhCN: extractI18nRegistry(zhCNSource, ZH_CN_SOURCE_PATH),
    enUS: extractI18nRegistry(enUSSource, EN_US_SOURCE_PATH),
    rawItems: buildRawItemRecords(itemTable, rawZhCN, rawEnUS),
    rawContainerItemIdsByPair: buildRawContainerItemIdsByPair(machineCraftTable),
  });

  if (options.json) {
    console.log(JSON.stringify({
      source: {
        kind: source.kind,
        authority: source.authority,
        sourceVersion: source.sourceVersion,
        gameVersion: source.gameVersion,
        hotfixVersion: source.hotfixVersion,
        sourcePath: source.sourcePath,
      },
      ...result,
    }, null, 2));
  } else {
    printHumanReport(source, result, options.includeAll);
  }

  const hasIssues = result.nameModifications.length > 0
    || result.invalidComposedNames.length > 0
    || result.unresolvedContainerMappings.length > 0
    || result.missingRawItems.length > 0
    || result.missingTranslations.length > 0;
  if (hasIssues) process.exitCode = 1;
}

const isDirectExecution = process.argv[1]
  && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isDirectExecution) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
