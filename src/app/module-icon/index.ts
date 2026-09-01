export const MODULE_ICON_ITEM_COUNT_MIN = 1;
export const MODULE_ICON_ITEM_COUNT_MAX = 4;

/**
 * 解析正式模块图标字段。数组顺序决定图标中的 1～4 号位置。
 */
export function parseModuleIconItemIds(value: unknown): string[] | null {
  if (
    !Array.isArray(value)
    || value.length < MODULE_ICON_ITEM_COUNT_MIN
    || value.length > MODULE_ICON_ITEM_COUNT_MAX
  ) {
    return null;
  }

  const itemIds: string[] = [];
  const seen = new Set<string>();
  for (const entry of value) {
    if (typeof entry !== "string") {
      return null;
    }

    const itemId = entry.trim();
    if (itemId.length === 0 || seen.has(itemId)) {
      return null;
    }
    seen.add(itemId);
    itemIds.push(itemId);
  }

  return itemIds;
}

/**
 * 将历史单图标字段迁移为正式物品数组；新字段非法时不回退到历史字段。
 */
export function migrateModuleIconItemIds(
  iconItemIds: unknown,
  legacyIconId: unknown,
  inputItemIds: readonly string[],
  outputItemIds: readonly string[],
): string[] | null {
  if (iconItemIds !== undefined) {
    return parseModuleIconItemIds(iconItemIds);
  }

  if (typeof legacyIconId !== "string" || legacyIconId.trim().length === 0) {
    return null;
  }

  const normalizedLegacyIconId = legacyIconId.trim();
  const portItemIds = [...outputItemIds, ...inputItemIds];
  const migratedDeviceReference = migrateBlueprintDeviceReference(normalizedLegacyIconId);
  const isLegacyDeviceIcon = migratedDeviceReference !== null
    && (
      migratedDeviceReference.deviceId !== normalizedLegacyIconId
      || (!normalizedLegacyIconId.startsWith("item_") && !portItemIds.includes(normalizedLegacyIconId))
    );
  const migratedItemId = isLegacyDeviceIcon ? portItemIds[0] : normalizedLegacyIconId;

  return migratedItemId === undefined ? null : [migratedItemId];
}

export function collectDefaultModuleIconItemIds(
  preferredItemIds: readonly string[],
  fallbackItemIds: readonly string[] = [],
): string[] {
  const itemIds: string[] = [];
  const seen = new Set<string>();
  for (const itemId of [...preferredItemIds, ...fallbackItemIds]) {
    const normalizedItemId = itemId.trim();
    if (normalizedItemId.length === 0 || seen.has(normalizedItemId)) {
      continue;
    }
    seen.add(normalizedItemId);
    itemIds.push(normalizedItemId);
    if (itemIds.length === MODULE_ICON_ITEM_COUNT_MAX) {
      break;
    }
  }
  return itemIds;
}
import { migrateBlueprintDeviceReference } from "@/shared/blueprint-device-id-migration";
