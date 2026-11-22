import type { CustomRegistryLibrary, CustomRegistryValidationIssue } from "@/domain/registry/types/custom-registry";
import { FluidDomain, ItemDomainFlag } from "@/domain/shared/item-domain-flags";

const UUID = /^[\da-f]{8}-[\da-f]{4}-[\da-f]{4}-[\da-f]{4}-[\da-f]{12}$/;
const ENTITY_ID = /^custom:entity:([\da-f-]{36}):([1-9]\d*)x([1-9]\d*)$/;
const SYSTEM_ID = /^[a-zA-Z0-9][\w.-]*$/;
// 放置、拾取及范围索引会枚举格子，限制单条网络定义可触发的工作量。
const MAX_FOOTPRINT_SIDE = 64;
const MAX_RANGE_SIDE = 128;
const MAX_RANGE_OFFSET = 1024;
const RANGE_VISUAL_IDS = ["power", "gas", "irrigation"];
const DOMAINS = [ItemDomainFlag.Solid, ItemDomainFlag.Liquid, ItemDomainFlag.Gas, FluidDomain];

class NetworkRegistryValidationError extends Error implements CustomRegistryValidationIssue {
  constructor(readonly path: string, message: string) {
    super(`${path}: ${message}`);
  }
}

export function invalid(path: string, message: string): never {
  throw new NetworkRegistryValidationError(path, message);
}

function object(value: unknown, path: string, keys?: string): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)
    || ![Object.prototype, null].includes(Object.getPrototypeOf(value))) {
    invalid(path, "必须是对象");
  }
  const record = value as Record<string, unknown>;
  if (keys !== undefined) {
    const allowed = new Set(keys.split(" "));
    for (const key of Object.keys(record)) if (!allowed.has(key)) invalid(`${path}.${key}`, "字段未开放");
  }
  return record;
}

function array(value: unknown, path: string): unknown[] {
  return Array.isArray(value) ? value : invalid(path, "必须是数组");
}

function text(value: unknown, path: string): string {
  return typeof value === "string" && value.trim() !== "" ? value : invalid(path, "必须是非空字符串");
}

function id(value: unknown, path: string): string {
  const result = text(value, path);
  if (result.trim() !== result || Object.hasOwn(Object.prototype, result) || result === "prototype") {
    invalid(path, "无效 ID");
  }
  return result;
}

function number(value: unknown, path: string, minimum: number, integer = false): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value < minimum
    || (integer && !Number.isSafeInteger(value))) invalid(path, "数值超出允许范围");
  return value;
}

function boundedInteger(value: unknown, path: string, minimum: number, maximum: number): number {
  const result = number(value, path, minimum, true);
  if (result > maximum) invalid(path, `不能大于 ${maximum}`);
  return result;
}

function choice<T>(value: unknown, path: string, values: readonly T[]): T {
  if (!values.includes(value as T)) invalid(path, "不支持的值");
  return value as T;
}

function entries(value: unknown, path: string, check: (value: unknown, path: string) => void) {
  array(value, path).forEach((entry, index) => check(entry, `${path}[${index}]`));
}

function uniqueIds(value: unknown, path: string, nonempty = false): string[] {
  const ids = array(value, path).map((entry, index) => id(entry, `${path}[${index}]`));
  if ((nonempty && ids.length === 0) || ids.length !== new Set(ids).size) invalid(path, "ID 必须唯一且满足数量要求");
  return ids;
}

function checkIdentity(entry: Record<string, unknown>, path: string) {
  if (!UUID.test(text(entry.uuid, `${path}.uuid`))) invalid(`${path}.uuid`, "无效 UUID");
  text(entry.name, `${path}.name`);
}

function checkPort(value: unknown, path: string, width: number, height: number) {
  const entry = object(value, path, "id localCellX localCellY edge acceptRule priorityGroup roundRobinSeed");
  id(entry.id, `${path}.id`);
  const x = number(entry.localCellX, `${path}.localCellX`, 0, true);
  const y = number(entry.localCellY, `${path}.localCellY`, 0, true);
  const edge = choice(entry.edge, `${path}.edge`, ["NORTH", "EAST", "SOUTH", "WEST"]);
  const onBoundary = { NORTH: y === 0, EAST: x === width - 1, SOUTH: y === height - 1, WEST: x === 0 };
  if (x >= width || y >= height || !onBoundary[edge as keyof typeof onBoundary]) invalid(path, "端口必须位于设备外轮廓");
  number(entry.priorityGroup, `${path}.priorityGroup`, 0, true);
  number(entry.roundRobinSeed, `${path}.roundRobinSeed`, 0, true);
  const rule = object(entry.acceptRule, `${path}.acceptRule`, "base exclude");
  uniqueIds(rule.exclude, `${path}.acceptRule.exclude`);
  const basePath = `${path}.acceptRule.base`;
  const kind = choice(object(rule.base, basePath).kind, `${basePath}.kind`, ["item", "domain", "none"]);
  if (kind === "item") id(object(rule.base, basePath, "kind itemId").itemId, `${basePath}.itemId`);
  if (kind === "domain") choice(object(rule.base, basePath, "kind flags").flags, `${basePath}.flags`, [0, 1, 2, 3, 4, 5, 6, 7]);
  if (kind === "none") object(rule.base, basePath, "kind");
}

function checkSlot(value: unknown, path: string, groupDomain: number) {
  const entry = object(value, path, "id capacity itemFilter itemFilterType lock initialItemType initialCount ignoreStock");
  id(entry.id, `${path}.id`);
  const capacity = number(entry.capacity, `${path}.capacity`, 1, true);
  choice(entry.itemFilter, `${path}.itemFilter`, ["type"]);
  const domain = choice(entry.itemFilterType, `${path}.itemFilterType`, DOMAINS);
  if ((groupDomain & domain) !== domain) invalid(`${path}.itemFilterType`, "槽位物品域必须包含于组域");
  choice(entry.lock, `${path}.lock`, [null]);
  if (entry.initialItemType !== null) id(entry.initialItemType, `${path}.initialItemType`);
  const count = number(entry.initialCount, `${path}.initialCount`, 0, true);
  if (count > capacity || (count > 0 && entry.initialItemType === null)) invalid(`${path}.initialCount`, "初始库存与容量或物品冲突");
  choice(entry.ignoreStock, `${path}.ignoreStock`, [false]);
}

function checkRange(value: unknown, path: string) {
  const entry = object(value, path, "id localRect coverage visualId interactionKind placementRule");
  id(entry.id, `${path}.id`);
  const rect = object(entry.localRect, `${path}.localRect`, "x y width height");
  for (const key of ["x", "y"]) boundedInteger(rect[key], `${path}.localRect.${key}`, -MAX_RANGE_OFFSET, MAX_RANGE_OFFSET);
  for (const key of ["width", "height"]) boundedInteger(rect[key], `${path}.localRect.${key}`, 1, MAX_RANGE_SIDE);
  choice(entry.coverage, `${path}.coverage`, ["intersects", "contains"]);
  choice(entry.visualId, `${path}.visualId`, RANGE_VISUAL_IDS);
  if (entry.interactionKind !== undefined) choice(entry.interactionKind, `${path}.interactionKind`, ["power", "gas", "irrigation"]);
  if (entry.placementRule === undefined) return;
  const rulePath = `${path}.placementRule`;
  const rule = object(entry.placementRule, rulePath, "groupId overlap allowedSegments");
  id(rule.groupId, `${rulePath}.groupId`);
  choice(rule.overlap, `${rulePath}.overlap`, ["disjoint-or-equal"]);
  uniqueIds(rule.allowedSegments, `${rulePath}.allowedSegments`).forEach((kind, index) => {
    choice(kind, `${rulePath}.allowedSegments[${index}]`, ["belt", "pipe"]);
  });
}

function checkEntity(value: unknown, path: string) {
  const entity = object(value, path, "uuid name overrideDefinitionId footprint powerDemand portGroups storageSlotGroups recipeChannels portStorageBindings ranges allowDuplicateRecipesAcrossChannels consumption periodicRangeConversion");
  checkIdentity(entity, path);
  if (entity.overrideDefinitionId !== undefined) id(entity.overrideDefinitionId, `${path}.overrideDefinitionId`);
  const footprint = object(entity.footprint, `${path}.footprint`, "width height");
  const width = boundedInteger(footprint.width, `${path}.footprint.width`, 1, MAX_FOOTPRINT_SIDE);
  const height = boundedInteger(footprint.height, `${path}.footprint.height`, 1, MAX_FOOTPRINT_SIDE);
  number(entity.powerDemand, `${path}.powerDemand`, 0);
  entries(entity.portGroups, `${path}.portGroups`, (value, path) => {
    const entry = object(value, path, "id kind isPipe direction ports");
    id(entry.id, `${path}.id`);
    const kind = choice(entry.kind, `${path}.kind`, DOMAINS);
    choice(entry.isPipe, `${path}.isPipe`, [kind !== ItemDomainFlag.Solid]);
    choice(entry.direction, `${path}.direction`, ["input", "output"]);
    entries(entry.ports, `${path}.ports`, (port, path) => checkPort(port, path, width, height));
  });
  entries(entity.storageSlotGroups, `${path}.storageSlotGroups`, (value, path) => {
    const entry = object(value, path, "id kind slots splitLinkType");
    id(entry.id, `${path}.id`);
    const kind = choice(entry.kind, `${path}.kind`, DOMAINS);
    if (entry.splitLinkType !== undefined) choice(entry.splitLinkType, `${path}.splitLinkType`, ["share-all", "share-cap"]);
    entries(entry.slots, `${path}.slots`, (slot, path) => checkSlot(slot, path, kind));
  });
  entries(entity.recipeChannels, `${path}.recipeChannels`, (value, path) => {
    const entry = object(value, path, "id type ingredientStorageGroupIds productStorageGroupIds manualRecipeOnly");
    id(entry.id, `${path}.id`);
    if (entry.type !== undefined) choice(entry.type, `${path}.type`, ["normal-channel"]);
    if (entry.manualRecipeOnly !== undefined) choice(entry.manualRecipeOnly, `${path}.manualRecipeOnly`, [false, true]);
    uniqueIds(entry.ingredientStorageGroupIds, `${path}.ingredientStorageGroupIds`);
    uniqueIds(entry.productStorageGroupIds, `${path}.productStorageGroupIds`);
  });
  entries(entity.portStorageBindings, `${path}.portStorageBindings`, (value, path) => {
    const entry = object(value, path, "id portGroupId storageSlotGroupId");
    for (const key of ["id", "portGroupId", "storageSlotGroupId"]) id(entry[key], `${path}.${key}`);
  });
  entries(entity.ranges, `${path}.ranges`, checkRange);
  choice(entity.allowDuplicateRecipesAcrossChannels, `${path}.allowDuplicateRecipesAcrossChannels`, [false, true]);
  if (entity.consumption !== undefined) {
    const entry = object(entity.consumption, `${path}.consumption`, "itemIds portGroupIds");
    uniqueIds(entry.itemIds, `${path}.consumption.itemIds`, true);
    uniqueIds(entry.portGroupIds, `${path}.consumption.portGroupIds`, true);
  }
  if (entity.periodicRangeConversion !== undefined) {
    const periodicPath = `${path}.periodicRangeConversion`;
    const entry = object(entity.periodicRangeConversion, periodicPath, "programId rangeIds phases");
    id(entry.programId, `${periodicPath}.programId`);
    uniqueIds(entry.rangeIds, `${periodicPath}.rangeIds`, true);
    const phases = array(entry.phases, `${periodicPath}.phases`);
    if (phases.length !== 2) invalid(`${periodicPath}.phases`, "必须声明两个相位");
    entries(phases, `${periodicPath}.phases`, (value, path) => {
      const phase = object(value, path, "uuid name side");
      checkIdentity(phase, path);
      choice(phase.side, `${path}.side`, [0, 1]);
    });
  }
}

function checkRecipe(value: unknown, path: string) {
  const recipe = object(value, path, "uuid name machineId durationSeconds inputs outputs recipeType probability requiredEnvironmentAnyOf environmentOutput");
  checkIdentity(recipe, path);
  id(recipe.machineId, `${path}.machineId`);
  const duration = number(recipe.durationSeconds, `${path}.durationSeconds`, Number.MIN_VALUE);
  if (!hasExactSimulationDuration(duration)) invalid(`${path}.durationSeconds`, "耗时无法在仿真时基上精确表示");
  choice(recipe.recipeType, `${path}.recipeType`, ["immediate-consume", "reserved-item"]);
  if (recipe.probability !== undefined) number(recipe.probability, `${path}.probability`, Number.MIN_VALUE);
  for (const key of ["inputs", "outputs"]) entries(recipe[key], `${path}.${key}`, (value, path) => {
    const entry = object(value, path, "itemId amount");
    id(entry.itemId, `${path}.itemId`);
    number(entry.amount, `${path}.amount`, 1, true);
  });
  if (recipe.requiredEnvironmentAnyOf !== undefined) uniqueIds(recipe.requiredEnvironmentAnyOf, `${path}.requiredEnvironmentAnyOf`, true);
  if (recipe.environmentOutput !== undefined) {
    const entry = object(recipe.environmentOutput, `${path}.environmentOutput`, "itemId rangeId");
    id(entry.itemId, `${path}.environmentOutput.itemId`);
    id(entry.rangeId, `${path}.environmentOutput.rangeId`);
  }
}

// Legacy 20 Hz、Dense 4 Hz 和 Dense 2 Hz 的共同精度为半秒。
function hasExactSimulationDuration(seconds: number): boolean {
  return Number.isSafeInteger(seconds * 2) && Number.isSafeInteger(seconds * 20);
}

function checkProgram(value: unknown, path: string) {
  const program = object(value, path, "id periodSeconds effects");
  id(program.id, `${path}.id`);
  const seconds = number(program.periodSeconds, `${path}.periodSeconds`, Number.MIN_VALUE);
  // 范围累计还需适配整数时间坐标。
  if (!hasExactSimulationDuration(seconds) || !Number.isSafeInteger(seconds * 3000)) {
    invalid(`${path}.periodSeconds`, "周期无法在仿真时基上精确表示");
  }
  const effects = array(program.effects, `${path}.effects`);
  if (effects.length !== 3) invalid(`${path}.effects`, "必须按单侧 0、单侧 1、双侧顺序声明三组效果");
  entries(effects, `${path}.effects`, (value, path) => {
    const effect = object(value, path, "probabilityByLayer outputItemByInputId");
    const probabilities = array(effect.probabilityByLayer, `${path}.probabilityByLayer`);
    if (probabilities.length === 0) invalid(`${path}.probabilityByLayer`, "至少需要声明一层概率");
    entries(probabilities, `${path}.probabilityByLayer`, (value, path) => {
      if (number(value, path, 0) > 1) invalid(path, "概率必须介于 0 和 1 之间");
    });
    const outputs = object(effect.outputItemByInputId, `${path}.outputItemByInputId`);
    for (const [input, output] of Object.entries(outputs)) {
      id(input, `${path}.outputItemByInputId`);
      id(output, `${path}.outputItemByInputId.${input}`);
    }
  });
}

export function readNetworkRegistryEntityMigrations(input: unknown): Readonly<Record<string, string>> {
  const data = object(input, "$").entityMigrations;
  if (data === undefined) return {};
  const path = "$.entityMigrations";
  const pairs = Object.entries(object(data, path)).map(([source, value]) => {
    const entryPath = `${path}.${source}`;
    const matched = ENTITY_ID.exec(source);
    if (!matched || !UUID.test(matched[1]!) || !matched.slice(2).every(size => Number.isSafeInteger(Number(size)))) {
      invalid(entryPath, "迁移来源必须是包含原始足印的独立自定义设备 ID");
    }
    const target = id(value, entryPath);
    if (!SYSTEM_ID.test(target)) invalid(entryPath, "无效系统设备 ID");
    return [source, target] as const;
  });
  return Object.fromEntries(pairs);
}

export function readNetworkRegistryLibrary(input: unknown): CustomRegistryLibrary {
  const library = object(input, "$", "formatVersion entities items recipes periodicRangeConversionPrograms entityMigrations");
  choice(library.formatVersion, "$.formatVersion", [1]);
  entries(library.entities, "$.entities", checkEntity);
  entries(library.items, "$.items", (value, path) => {
    const entry = object(value, path, "uuid name phase");
    checkIdentity(entry, path);
    choice(entry.phase, `${path}.phase`, ["solid", "liquid", "gas"]);
  });
  entries(library.recipes, "$.recipes", checkRecipe);
  if (library.periodicRangeConversionPrograms !== undefined) entries(library.periodicRangeConversionPrograms, "$.periodicRangeConversionPrograms", checkProgram);
  readNetworkRegistryEntityMigrations(library);
  return structuredClone(library) as unknown as CustomRegistryLibrary;
}
