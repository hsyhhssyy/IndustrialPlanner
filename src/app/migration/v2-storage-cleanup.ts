import {
  V2_CLIPBOARD_BLUEPRINT_LOCAL_STORAGE_KEY,
  V2_LAST_CLIPBOARD_BLUEPRINT_LOCAL_STORAGE_KEY,
  V2_LAYOUT_HISTORY_BY_BASE_LOCAL_STORAGE_KEY,
  V2_LEGACY_CLIPBOARD_BLUEPRINT_LOCAL_STORAGE_KEY,
  V2_MODULE_BALANCING_RECENT_PICKER_ITEMS_LOCAL_STORAGE_KEY,
  V2_PUBLIC_BLUEPRINT_INDEX_CACHE_LOCAL_STORAGE_KEY,
} from "./v2-migration-keys";

const DISCARDABLE_V2_LOCAL_STORAGE_KEYS = [
  V2_LAYOUT_HISTORY_BY_BASE_LOCAL_STORAGE_KEY,
  V2_PUBLIC_BLUEPRINT_INDEX_CACHE_LOCAL_STORAGE_KEY,
  V2_CLIPBOARD_BLUEPRINT_LOCAL_STORAGE_KEY,
  V2_LEGACY_CLIPBOARD_BLUEPRINT_LOCAL_STORAGE_KEY,
  V2_LAST_CLIPBOARD_BLUEPRINT_LOCAL_STORAGE_KEY,
  V2_MODULE_BALANCING_RECENT_PICKER_ITEMS_LOCAL_STORAGE_KEY,
] as const;

export function cleanupDiscardableV2LocalStorageBeforeV3Boot(): string[] {
  const storage = getLocalStorage();

  if (storage === null) {
    return [];
  }

  const removedKeys: string[] = [];

  for (const key of DISCARDABLE_V2_LOCAL_STORAGE_KEYS) {
    try {
      if (storage.getItem(key) === null) {
        continue;
      }

      storage.removeItem(key);
      removedKeys.push(key);
    } catch {
      continue;
    }
  }

  return removedKeys;
}

function getLocalStorage(): Storage | null {
  try {
    return typeof globalThis.localStorage === "undefined"
      ? null
      : globalThis.localStorage;
  } catch {
    return null;
  }
}
