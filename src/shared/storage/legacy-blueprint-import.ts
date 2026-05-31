import {
  BLUEPRINT_VERSION,
  createBlueprintDocument,
  type BlueprintDocument,
} from "@/domain/document/blueprint-document";
import type { GridPoint, GridRotation } from "@/domain/shared/grid";

const LEGACY_BLUEPRINT_SCHEMA = "industrial-planner-blueprint";
const LEGACY_BLUEPRINT_ID_PATTERN = /([0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})/i;
const LEGACY_BLUEPRINT_HASH_SEEDS = [
  0x811c9dc5,
  0x811c9dc7,
  0x811c9dcb,
  0x811c9dd1,
];
const LEGACY_DEVICE_REMAPPERS: Readonly<Record<string, {
  readonly definitionId: string;
  readonly rotationOffset: GridRotation;
}>> = {
  // AI-REMOVED 2026-05-10:
  // Reason: Blanket warehouse-unloader rotation remap is incorrect for the current
  //   legacy blueprint corpus.
  // Trigger: Rechecking the current two system blueprints showed their legacy
  //   sources already use the same functional direction as the migrated public
  //   assets.
  // Evidence: The premium capsule legacy source places item_port_unloader_1 at
  //   y=0 with rotation=180, and the migrated public asset preserves rotation=180
  //   while feeding belts at y=1 directly below; applying +180 here would flip
  //   those unloaders to 0 and break the topology.
  // Replacement: None
  // Risk: Low
  // Human Review: Required
  //
  // Original code:
  // item_port_unloader_1: {
  //   definitionId: "item_port_unloader_1",
  //   rotationOffset: 180,
  // },
  // AI-CORRECTION 2026-05-10: item_port_unloader_1 在当前 registry 中已改为
  //   rotation=0 时端口朝南，因此旧版蓝图导入需要重新补回 +180 度，才能保留
  //   旧资产的功能流向。
  item_port_unloader_1: {
    definitionId: "item_port_unloader_1",
    rotationOffset: 180,
  },
  belt_turn_cw_1x1: {
    definitionId: "belt_turn_ccw_1x1",
    rotationOffset: 0,
  },
  belt_turn_ccw_1x1: {
    definitionId: "belt_turn_cw_1x1",
    rotationOffset: 270,
  },
  pipe_turn_cw_1x1: {
    definitionId: "pipe_turn_ccw_1x1",
    rotationOffset: 0,
  },
  pipe_turn_ccw_1x1: {
    definitionId: "pipe_turn_cw_1x1",
    rotationOffset: 270,
  },
  // AI-CORRECTION 2026-05-18: 分流器/汇流器默认方向变更。
  //   - 分流器: 原 input=E → 现 input=N，需补 +90° 使旧 v2 蓝图的拓扑等价。
  //   - 汇流器: 原 output=W → 现 output=S，需补 +90° 使旧 v2 蓝图的拓扑等价。
  item_log_splitter: {
    definitionId: "item_log_splitter",
    rotationOffset: 90,
  },
  item_log_converger: {
    definitionId: "item_log_converger",
    rotationOffset: 90,
  },
  item_pipe_splitter: {
    definitionId: "item_pipe_splitter",
    rotationOffset: 90,
  },
  item_pipe_converger: {
    definitionId: "item_pipe_converger",
    rotationOffset: 90,
  },
};

export interface LegacyBlueprintJson {
  readonly schema: string;
  readonly id?: string;
  readonly version?: string | number;
  readonly blueprintVersion?: string | number;
  readonly name: string;
  readonly description?: string;
  readonly createdAt: string;
  readonly updatedAt?: string;
  readonly baseId: string;
  readonly devices: readonly LegacyBlueprintDeviceJson[];
  readonly links?: readonly LegacyBlueprintLinkJson[];
}

export interface LegacyBlueprintDeviceJson {
  readonly typeId: string;
  readonly rotation: GridRotation;
  readonly origin: GridPoint;
  readonly config?: Record<string, unknown>;
}

export interface LegacyBlueprintLinkJson {
  readonly kind: "dark_pipe";
  readonly sourceBlueprintInstanceId: string;
  readonly targetBlueprintInstanceId: string;
}

export interface ConvertLegacyBlueprintOptions {
  readonly blueprintId?: string;
  readonly entityIdPrefix?: string;
  readonly initialGridPoint?: GridPoint;
  readonly version?: string;
}

export function convertLegacyBlueprintJson(
  value: unknown,
  options: ConvertLegacyBlueprintOptions = {},
): BlueprintDocument | null {
  const legacyBlueprint = normalizeLegacyBlueprintJson(value);

  if (legacyBlueprint === null || (legacyBlueprint.links?.length ?? 0) > 0) {
    return null;
  }

  const blueprintId = resolveBlueprintId(legacyBlueprint, options);
  const entityIdPrefix = resolveEntityIdPrefix(blueprintId, options.entityIdPrefix);
  const entities: BlueprintDocument["entities"] = {};
  const entityOrder: string[] = [];

  for (const [deviceIndex, device] of legacyBlueprint.devices.entries()) {
    const entityId = `${entityIdPrefix}_${String(deviceIndex + 1).padStart(4, "0")}`;
    const normalizedDevice = remapLegacyDevice(device);

    entities[entityId] = {
      id: entityId,
      definitionId: normalizedDevice.typeId,
      position: {
        x: normalizedDevice.origin.x,
        y: normalizedDevice.origin.y,
      },
      rotation: normalizedDevice.rotation,
      config: convertLegacyDeviceConfig({
        definitionId: normalizedDevice.typeId,
        config: cloneJsonRecord(normalizedDevice.config ?? {}),
      }),
      tags: [],
    };
    entityOrder.push(entityId);
  }

  return createBlueprintDocument({
    blueprintId,
    version: normalizeOptionalString(options.version) ?? BLUEPRINT_VERSION,
    name: legacyBlueprint.name,
    description: legacyBlueprint.description,
    baseId: legacyBlueprint.baseId,
    initialGridPoint: options.initialGridPoint ?? resolveLegacyInitialGridPoint(legacyBlueprint.devices),
    entities,
    entityOrder,
    slotLinks: [],
    createdAt: legacyBlueprint.createdAt,
    updatedAt: legacyBlueprint.updatedAt ?? legacyBlueprint.createdAt,
  });
}

/**
 * 将旧版设备 config 转换为新版 config contract。
 *
 * 取货口（item_port_unloader_1）：
 *   旧：pickupItemId + pickupIgnoreInventory + protocolHubOutputs[0].ignoreInventory
 *   新：links[0]（完整 SlotLinkDefinition）+ storageSlotGroups[0].slots[0].ignoreStock
 *
 * 暗管出口（item_port_udpipe_unloader_1）：
 *   旧：pumpOutputItemId + darkPipeOutletMode
 *   新：links[0]（完整 SlotLinkDefinition）+ storageSlotGroups[0].slots[0].ignoreStock
 *   darkPipeOutletMode === "generate" → ignoreStock: true
 *
 * 存储箱（item_port_storager_1）：
 *   旧：submitToWarehouse = true
 *   新：storageSlotGroups[N].slots[0].submitMode = "every-tick"
 *
 * 反应池 / 扩容反应池（item_port_mix_pool_1 / item_port_mix_pool_large_1）：
 *   旧：reactorPool.selectedRecipeIds / solidOutputItemId / liquidOutputItemIdA / liquidOutputItemIdB
 *   新：channelRecipes + portGroups[N].ports[M].acceptRule
 *
 * 通用预置物品（preloadInputs）：
 *   旧：preloadInputs: [{ slotIndex, itemId, amount }]
 *   新：storageSlotGroups[0].slots[slotIndex].initialItemType / initialCount
 */
function convertLegacyDeviceConfig(options: {
  definitionId: string;
  config: Record<string, unknown>;
}): Record<string, unknown> {
  if (options.definitionId === "item_port_unloader_1") {
    return convertLegacyUnloaderConfig(options.config);
  }

  if (options.definitionId === "item_port_udpipe_unloader_1") {
    return convertLegacyDarkPipeUnloaderConfig(options.config);
  }

  if (options.definitionId === "item_port_storager_1") {
    return convertLegacyStoragerConfig(options.config);
  }

  if (options.definitionId === "item_port_mix_pool_1" || options.definitionId === "item_port_mix_pool_large_1") {
    return convertLegacyReactorPoolConfig(options.definitionId, options.config);
  }

  return convertLegacyPreloadInputs(options.config);
}

/**
 * 扩容反应池旧配方 ID → 新版 _large 配方 ID 映射。
 * 仅当迁移定义目标是 item_port_mix_pool_large_1 时应用。
 */
const LARGE_REACTOR_RECIPE_ID_BY_LEGACY_ID: Record<string, string> = {
  "r_chrono_mix_pool_xiranite_waste_liquids_from_liquid_xiranite_and_wastewater_basic":
    "r_chrono_mix_pool_xiranite_waste_liquids_from_liquid_xiranite_and_wastewater_basic_large",
  "r_chrono_mix_pool_inert_waste_liquid_water_slag_from_waste_liquid_and_iron_powder_basic":
    "r_chrono_mix_pool_inert_waste_liquid_water_slag_from_waste_liquid_and_iron_powder_basic_large",
  "r_mix_pool_liquid_xiranite_from_xiranite_powder_and_water_basic":
    "r_mix_pool_liquid_xiranite_from_xiranite_powder_and_water_basic_large",
};

/**
 * 将旧版反应池 config.reactorPool 转换为新版 channelRecipes + acceptRule。
 *
 * 反应池 / 扩容反应池（item_port_mix_pool_1 / item_port_mix_pool_large_1）：
 *   旧格式 config.reactorPool：
 *     selectedRecipeIds: string[]  → channelRecipes: { ch1, ch2, ... }
 *     solidOutputItemId: string    → portGroups[0].ports[*].acceptRule（item_output）
 *     liquidOutputItemIdA: string  → portGroups[2].ports[0].acceptRule（fluid_output_a）
 *     liquidOutputItemIdB: string  → portGroups[3].ports[0].acceptRule（fluid_output_b）
 *
 * 扩容反应池的旧配方 ID 不带 _large 后缀，迁移时通过 LARGE_REACTOR_RECIPE_ID_BY_LEGACY_ID 映射。
 */
function convertLegacyReactorPoolConfig(
  definitionId: string,
  config: Record<string, unknown>,
): Record<string, unknown> {
  const reactorPool = config.reactorPool;

  if (!isRecord(reactorPool)) {
    const nextConfig = { ...config };
    delete nextConfig.reactorPool;
    return convertLegacyPreloadInputs(nextConfig);
  }

  const nextConfig: Record<string, unknown> = { ...config };
  delete nextConfig.reactorPool;

  const isLarge = definitionId === "item_port_mix_pool_large_1";

  // 1. 配方：selectedRecipeIds → channelRecipes
  const rawRecipeIds = reactorPool.selectedRecipeIds;
  if (Array.isArray(rawRecipeIds) && rawRecipeIds.length > 0) {
    const channelRecipes: Record<string, string> = {};

    for (let i = 0; i < rawRecipeIds.length; i += 1) {
      const rawId = rawRecipeIds[i];
      if (typeof rawId !== "string" || rawId.trim().length === 0) {
        continue;
      }

      const mappedId = isLarge
        ? (LARGE_REACTOR_RECIPE_ID_BY_LEGACY_ID[rawId] ?? rawId)
        : rawId;
      channelRecipes[`ch${i + 1}`] = mappedId;
    }

    if (Object.keys(channelRecipes).length > 0) {
      nextConfig.channelRecipes = channelRecipes;
    }
  }

  // 2. 固体输出：solidOutputItemId → portGroups[0] = item_output
  //    item_port_mix_pool_1: 2 ports（out_n_1, out_n_3）
  //    item_port_mix_pool_large_1: 4 ports（out_n_1..out_n_4）
  const solidOutputItemId = reactorPool.solidOutputItemId;
  if (typeof solidOutputItemId === "string" && solidOutputItemId.trim().length > 0) {
    const portCount = isLarge ? 4 : 2;

    for (let i = 0; i < portCount; i += 1) {
      nextConfig[`portGroups[0].ports[${i}].acceptRule`] = {
        base: { kind: "item", itemId: solidOutputItemId },
        exclude: [],
      };
    }
  }

  // 3. 液体输出 A：liquidOutputItemIdA → portGroups[2] = fluid_output_a（out_w_1）
  const liquidOutputItemIdA = reactorPool.liquidOutputItemIdA;
  if (typeof liquidOutputItemIdA === "string" && liquidOutputItemIdA.trim().length > 0) {
    nextConfig["portGroups[2].ports[0].acceptRule"] = {
      base: { kind: "item", itemId: liquidOutputItemIdA },
      exclude: [],
    };
  }

  // 4. 液体输出 B：liquidOutputItemIdB → portGroups[3] = fluid_output_b（out_w_3）
  const liquidOutputItemIdB = reactorPool.liquidOutputItemIdB;
  if (typeof liquidOutputItemIdB === "string" && liquidOutputItemIdB.trim().length > 0) {
    nextConfig["portGroups[3].ports[0].acceptRule"] = {
      base: { kind: "item", itemId: liquidOutputItemIdB },
      exclude: [],
    };
  }

  // 5. 传递 preloadInputs 处理（反应池可能有预置输入）
  return convertLegacyPreloadInputs(nextConfig);
}

/**
 * 将旧版 preloadInputs 转换为新版 slot 初始物品配置。
 *
 * 旧格式：
 *   preloadInputs: [{ slotIndex: 0, itemId: "item_plant_grass_2", amount: 50 }]
 *
 * 新格式：
 *   storageSlotGroups[0].slots[0].initialItemType: "item_plant_grass_2"
 *   storageSlotGroups[0].slots[0].initialCount: 50
 *
 * slotIndex 映射到 storageSlotGroups[0]（输入缓存始终是第一组）。
 */
function convertLegacyPreloadInputs(
  config: Record<string, unknown>,
): Record<string, unknown> {
  const preloadInputs = config.preloadInputs;
  if (!Array.isArray(preloadInputs) || preloadInputs.length === 0) {
    return config;
  }

  const nextConfig: Record<string, unknown> = { ...config };
  delete nextConfig.preloadInputs;

  for (const entry of preloadInputs) {
    if (!isRecord(entry)) {
      continue;
    }

    const slotIndex = entry.slotIndex;
    const itemId = entry.itemId;
    const amount = entry.amount;

    if (typeof slotIndex !== "number" || typeof itemId !== "string" || itemId === "") {
      continue;
    }

    const count = typeof amount === "number" && Number.isFinite(amount) ? amount : 0;
    nextConfig[`storageSlotGroups[0].slots[${slotIndex}].initialItemType`] = itemId;
    nextConfig[`storageSlotGroups[0].slots[${slotIndex}].initialCount`] = count;
  }

  return nextConfig;
}

function convertLegacyUnloaderConfig(
  config: Record<string, unknown>,
): Record<string, unknown> {
  const itemId = config.pickupItemId;
  if (typeof itemId !== "string" || itemId === "") {
    return config;
  }

  // 取 ignoreStock：pickupIgnoreInventory 或 protocolHubOutputs[0].ignoreInventory
  const ignoreStock =
    config.pickupIgnoreInventory === true
    || (
      Array.isArray(config.protocolHubOutputs)
      && config.protocolHubOutputs.length > 0
      && isRecord(config.protocolHubOutputs[0])
      && config.protocolHubOutputs[0].ignoreInventory === true
    );

  const nextConfig: Record<string, unknown> = { ...config };

  // 移除旧 key
  delete nextConfig.pickupItemId;
  delete nextConfig.pickupIgnoreInventory;
  delete nextConfig.protocolHubOutputs;

  // 写入新格式 links[0]（完整 SlotLinkDefinition）
  nextConfig["links[0].id"] = "";
  nextConfig["links[0].linkType"] = "share-all";
  // source.entityId 留空，applyPlacementDraft 时由 rewriteEntityIdInConfig 处理
  nextConfig["links[0].source.entityId"] = "";
  nextConfig["links[0].source.storageSlotGroupId"] = "unloader_buffer";
  nextConfig["links[0].source.slotId"] = "slot_1";
  nextConfig["links[0].target.entityId"] = "warehouse";
  nextConfig["links[0].target.storageSlotGroupId"] = "warehouse";
  nextConfig["links[0].target.slotId"] = itemId;
  nextConfig["storageSlotGroups[0].slots[0].ignoreStock"] = ignoreStock;

  return nextConfig;
}

function convertLegacyDarkPipeUnloaderConfig(
  config: Record<string, unknown>,
): Record<string, unknown> {
  const itemId = config.pumpOutputItemId;
  if (typeof itemId !== "string" || itemId === "") {
    return config;
  }

  // darkPipeOutletMode === "generate" → 无限供应 → ignoreStock: true
  const ignoreStock = config.darkPipeOutletMode === "generate";

  const nextConfig: Record<string, unknown> = { ...config };

  // 移除旧 key
  delete nextConfig.pumpOutputItemId;
  delete nextConfig.darkPipeOutletMode;

  // 写入新格式 links[0]（完整 SlotLinkDefinition）
  // 结构与取货口完全一致，差异仅在于仓库侧的 slotId 是液体类型
  nextConfig["links[0].id"] = "";
  nextConfig["links[0].linkType"] = "share-all";
  nextConfig["links[0].source.entityId"] = "";
  nextConfig["links[0].source.storageSlotGroupId"] = "unloader_buffer";
  nextConfig["links[0].source.slotId"] = "slot_1";
  nextConfig["links[0].target.entityId"] = "warehouse";
  nextConfig["links[0].target.storageSlotGroupId"] = "warehouse";
  nextConfig["links[0].target.slotId"] = itemId;
  nextConfig["storageSlotGroups[0].slots[0].ignoreStock"] = ignoreStock;

  return nextConfig;
}

function convertLegacyStoragerConfig(
  config: Record<string, unknown>,
): Record<string, unknown> {
  if (config.submitToWarehouse !== true) {
    return config;
  }

  const nextConfig: Record<string, unknown> = { ...config };
  delete nextConfig.submitToWarehouse;

  // 存储箱有 6 个单槽储存组，全部设为 every-tick 提交
  for (let groupIndex = 0; groupIndex < 6; groupIndex += 1) {
    nextConfig[`storageSlotGroups[${groupIndex}].slots[0].submitMode`] = "every-tick";
  }

  return nextConfig;
}

export function normalizeLegacyBlueprintJson(value: unknown): LegacyBlueprintJson | null {
  if (!isRecord(value)) {
    return null;
  }

  if (
    value.schema !== LEGACY_BLUEPRINT_SCHEMA
    || !isNonEmptyString(value.name)
    || !isNonEmptyString(value.createdAt)
    || !isNonEmptyString(value.baseId)
    || !Array.isArray(value.devices)
    || value.devices.length === 0
  ) {
    return null;
  }

  const devices = value.devices
    .map((device) => normalizeLegacyBlueprintDevice(device))
    .flatMap((device) => (device === null ? [] : [device]));

  if (devices.length !== value.devices.length) {
    return null;
  }

  const linksValue = value.links;
  const links = linksValue === undefined
    ? []
    : Array.isArray(linksValue)
      ? linksValue
        .map((link) => normalizeLegacyBlueprintLink(link))
        .flatMap((link) => (link === null ? [] : [link]))
      : null;

  if (links === null) {
    return null;
  }

  if (Array.isArray(linksValue) && links.length !== linksValue.length) {
    return null;
  }

  return {
    schema: LEGACY_BLUEPRINT_SCHEMA,
    id: normalizeOptionalString(value.id) ?? undefined,
    version: normalizeOptionalStringOrNumber(value.version),
    blueprintVersion: normalizeOptionalStringOrNumber(value.blueprintVersion),
    name: value.name.trim(),
    description: normalizeOptionalString(value.description) ?? undefined,
    createdAt: value.createdAt,
    updatedAt: normalizeOptionalString(value.updatedAt) ?? undefined,
    baseId: value.baseId,
    devices,
    links,
  };
}

function normalizeLegacyBlueprintDevice(
  value: unknown,
): LegacyBlueprintDeviceJson | null {
  if (!isRecord(value) || !isNonEmptyString(value.typeId) || !isGridPoint(value.origin)) {
    return null;
  }

  if (!isGridRotation(value.rotation)) {
    return null;
  }

  const configValue = value.config;

  if (configValue !== undefined && !isRecord(configValue)) {
    return null;
  }

  return {
    typeId: value.typeId,
    rotation: value.rotation,
    origin: {
      x: value.origin.x,
      y: value.origin.y,
    },
    config: configValue === undefined ? undefined : cloneJsonRecord(configValue),
  };
}

function normalizeLegacyBlueprintLink(
  value: unknown,
): LegacyBlueprintLinkJson | null {
  if (
    !isRecord(value)
    || value.kind !== "dark_pipe"
    || !isNonEmptyString(value.sourceBlueprintInstanceId)
    || !isNonEmptyString(value.targetBlueprintInstanceId)
  ) {
    return null;
  }

  return {
    kind: "dark_pipe",
    sourceBlueprintInstanceId: value.sourceBlueprintInstanceId,
    targetBlueprintInstanceId: value.targetBlueprintInstanceId,
  };
}

function remapLegacyDevice(
  device: LegacyBlueprintDeviceJson,
): LegacyBlueprintDeviceJson {
  const remapper = LEGACY_DEVICE_REMAPPERS[device.typeId];

  if (remapper === undefined) {
    return device;
  }

  return {
    ...device,
    typeId: remapper.definitionId,
    rotation: rotateGridRotation(device.rotation, remapper.rotationOffset),
  };
}

function resolveBlueprintId(
  legacyBlueprint: LegacyBlueprintJson,
  options: ConvertLegacyBlueprintOptions,
): string {
  const explicitBlueprintId = normalizeOptionalString(options.blueprintId);

  if (explicitBlueprintId !== null) {
    return explicitBlueprintId;
  }

  const legacyBlueprintId = normalizeOptionalString(legacyBlueprint.id);
  const matchedLegacyBlueprintId = legacyBlueprintId?.match(LEGACY_BLUEPRINT_ID_PATTERN)?.[1]?.toLowerCase();

  if (matchedLegacyBlueprintId !== undefined) {
    return matchedLegacyBlueprintId;
  }

  return createDeterministicUuid(JSON.stringify({
    name: legacyBlueprint.name,
    createdAt: legacyBlueprint.createdAt,
    baseId: legacyBlueprint.baseId,
    devices: legacyBlueprint.devices,
  }));
}

function resolveEntityIdPrefix(
  blueprintId: string,
  explicitPrefix: string | undefined,
): string {
  const normalizedExplicitPrefix = normalizeOptionalString(explicitPrefix);

  if (normalizedExplicitPrefix !== null) {
    return normalizedExplicitPrefix;
  }

  return `legacy_${blueprintId.replace(/-/g, "").slice(0, 8)}`;
}

function resolveLegacyInitialGridPoint(
  devices: readonly LegacyBlueprintDeviceJson[],
): GridPoint {
  let minX = Number.POSITIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;

  for (const device of devices) {
    minX = Math.min(minX, device.origin.x);
    minY = Math.min(minY, device.origin.y);
    maxX = Math.max(maxX, device.origin.x);
    maxY = Math.max(maxY, device.origin.y);
  }

  // 旧版公开蓝图只暴露设备 origin，不带占地包围盒；默认用 origin 包围盒中心作为放置锚点。
  return {
    x: Math.round(minX + (maxX - minX + 1) / 2),
    y: Math.round(minY + (maxY - minY + 1) / 2),
  };
}

function createDeterministicUuid(input: string): string {
  const inputBytes = new TextEncoder().encode(input);
  const bytes = new Uint8Array(16);

  LEGACY_BLUEPRINT_HASH_SEEDS.forEach((seed, seedIndex) => {
    const hash = fnv1a32(inputBytes, seed);
    const offset = seedIndex * 4;

    bytes[offset] = (hash >>> 24) & 0xff;
    bytes[offset + 1] = (hash >>> 16) & 0xff;
    bytes[offset + 2] = (hash >>> 8) & 0xff;
    bytes[offset + 3] = hash & 0xff;
  });

  bytes[6] = ((bytes[6] ?? 0) & 0x0f) | 0x40;
  bytes[8] = ((bytes[8] ?? 0) & 0x3f) | 0x80;

  return formatUuidBytes(bytes);
}

function fnv1a32(bytes: Uint8Array, seed: number): number {
  let hash = seed >>> 0;

  for (const byte of bytes) {
    hash ^= byte;
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }

  return hash >>> 0;
}

function formatUuidBytes(bytes: Uint8Array): string {
  const hex = Array.from(bytes, (value) => value.toString(16).padStart(2, "0"));

  return [
    hex.slice(0, 4).join(""),
    hex.slice(4, 6).join(""),
    hex.slice(6, 8).join(""),
    hex.slice(8, 10).join(""),
    hex.slice(10, 16).join(""),
  ].join("-");
}

function cloneJsonRecord(
  value: Record<string, unknown>,
): Record<string, unknown> {
  return JSON.parse(JSON.stringify(value)) as Record<string, unknown>;
}

function rotateGridRotation(
  rotation: GridRotation,
  offset: GridRotation,
): GridRotation {
  const nextRotation = (rotation + offset) % 360;

  switch (nextRotation) {
    case 0:
    case 90:
    case 180:
    case 270:
      return nextRotation;
    default:
      return 0;
  }
}

function normalizeOptionalString(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

function normalizeOptionalStringOrNumber(value: unknown): string | number | undefined {
  if (typeof value === "string" && value.trim().length > 0) {
    return value;
  }

  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }

  return undefined;
}

function isGridPoint(value: unknown): value is GridPoint {
  return isRecord(value) && typeof value.x === "number" && typeof value.y === "number";
}

function isGridRotation(value: unknown): value is GridRotation {
  return value === 0 || value === 90 || value === 180 || value === 270;
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
