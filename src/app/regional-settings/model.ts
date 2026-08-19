import type { ItemDefinition } from "@/domain/registry/types/item-definition";

export const REGIONAL_SETTINGS_SCHEMA_VERSION = 1 as const;
export const REGIONAL_SETTINGS_ASSET_ID = "default";

export type RegionalResourceSupplyMode = "infinite" | "rate";

export interface RegionalResourceSetting {
  readonly itemId: string;
  readonly mode: RegionalResourceSupplyMode;
  /** infinite 模式下保留最近一次有限编辑值，不参与仿真。 */
  readonly perMinute: number;
}

export interface RegionalResourceConfig {
  readonly resources: readonly RegionalResourceSetting[];
}

export interface RegionalSettingsAsset {
  readonly schemaVersion: typeof REGIONAL_SETTINGS_SCHEMA_VERSION;
  readonly multiBaseEnabled: boolean;
  readonly regions: Readonly<Record<string, RegionalResourceConfig>>;
}

export function createDefaultRegionalSettingsAsset(): RegionalSettingsAsset {
  return {
    schemaVersion: REGIONAL_SETTINGS_SCHEMA_VERSION,
    multiBaseEnabled: false,
    regions: {},
  };
}

export function resolveConfigurableRegionalResourceItems(
  itemDefinitions: readonly ItemDefinition[],
): readonly ItemDefinition[] {
  return [...itemDefinitions]
    .filter((item) => (
      item.tags.includes("自然资源")
      && !item.tags.includes("无限供应")
    ))
    .sort(compareItemDefinitions);
}

export function resolveFixedInfiniteRegionalResourceItemIds(
  itemDefinitions: readonly ItemDefinition[],
): readonly string[] {
  return [...itemDefinitions]
    .filter((item) => (
      item.tags.includes("自然资源")
      && item.tags.includes("无限供应")
    ))
    .sort(compareItemDefinitions)
    .map((item) => item.id);
}

export function createInfiniteRegionalResourceSettings(
  itemDefinitions: readonly ItemDefinition[],
): readonly RegionalResourceSetting[] {
  return resolveConfigurableRegionalResourceItems(itemDefinitions).map((item) => ({
    itemId: item.id,
    mode: "infinite",
    perMinute: 10,
  }));
}

export function resolveRegionalResourceSettings(
  asset: RegionalSettingsAsset,
  regionTag: string,
  itemDefinitions: readonly ItemDefinition[],
): readonly RegionalResourceSetting[] {
  const configured = asset.regions[regionTag];
  return configured === undefined
    ? createInfiniteRegionalResourceSettings(itemDefinitions)
    : configured.resources.map(cloneRegionalResourceSetting);
}

export function normalizeRegionalSettingsAsset(
  value: unknown,
  itemDefinitions: readonly ItemDefinition[],
): RegionalSettingsAsset | null {
  if (!isRecord(value)) {
    return null;
  }

  const schemaVersion = value.schemaVersion;
  if (schemaVersion !== REGIONAL_SETTINGS_SCHEMA_VERSION) {
    return null;
  }

  const configurableItemIds = new Set(
    resolveConfigurableRegionalResourceItems(itemDefinitions).map((item) => item.id),
  );
  const regionsValue = isRecord(value.regions) ? value.regions : {};
  const regions: Record<string, RegionalResourceConfig> = {};

  for (const [rawRegionTag, rawConfig] of Object.entries(regionsValue)) {
    const regionTag = rawRegionTag.trim();
    if (regionTag.length === 0 || !isRecord(rawConfig) || !Array.isArray(rawConfig.resources)) {
      continue;
    }

    const seenItemIds = new Set<string>();
    const resources = rawConfig.resources.flatMap((rawResource) => {
      const resource = normalizeRegionalResourceSetting(rawResource, configurableItemIds);
      if (resource === null || seenItemIds.has(resource.itemId)) {
        return [];
      }
      seenItemIds.add(resource.itemId);
      return [resource];
    });
    resources.sort((left, right) => left.itemId.localeCompare(right.itemId));
    regions[regionTag] = { resources };
  }

  return {
    schemaVersion: REGIONAL_SETTINGS_SCHEMA_VERSION,
    multiBaseEnabled: value.multiBaseEnabled === true,
    regions: Object.fromEntries(
      Object.entries(regions).sort(([left], [right]) => left.localeCompare(right)),
    ),
  };
}

export function cloneRegionalSettingsAsset(
  asset: RegionalSettingsAsset,
): RegionalSettingsAsset {
  return {
    schemaVersion: REGIONAL_SETTINGS_SCHEMA_VERSION,
    multiBaseEnabled: asset.multiBaseEnabled,
    regions: Object.fromEntries(
      Object.entries(asset.regions).map(([regionTag, config]) => [
        regionTag,
        { resources: config.resources.map(cloneRegionalResourceSetting) },
      ]),
    ),
  };
}

export function normalizeRegionalPerMinute(value: number): number {
  if (!Number.isFinite(value)) {
    return 10;
  }
  return Math.max(10, Math.round(value / 10) * 10);
}

function normalizeRegionalResourceSetting(
  value: unknown,
  configurableItemIds: ReadonlySet<string>,
): RegionalResourceSetting | null {
  if (!isRecord(value) || typeof value.itemId !== "string") {
    return null;
  }

  const itemId = value.itemId.trim();
  if (!configurableItemIds.has(itemId)) {
    return null;
  }

  const mode = value.mode === "infinite" || value.mode === "rate"
    ? value.mode
    : null;
  if (mode === null) {
    return null;
  }

  if (
    mode === "rate"
    && (
      typeof value.perMinute !== "number"
      || !Number.isSafeInteger(value.perMinute)
      || value.perMinute < 10
      || value.perMinute % 10 !== 0
    )
  ) {
    return null;
  }

  const perMinute = typeof value.perMinute === "number"
    ? normalizeRegionalPerMinute(value.perMinute)
    : 10;
  return { itemId, mode, perMinute };
}

function cloneRegionalResourceSetting(
  setting: RegionalResourceSetting,
): RegionalResourceSetting {
  return {
    itemId: setting.itemId,
    mode: setting.mode,
    perMinute: setting.perMinute,
  };
}

function compareItemDefinitions(left: ItemDefinition, right: ItemDefinition): number {
  return left.displayOrder - right.displayOrder || left.id.localeCompare(right.id);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
