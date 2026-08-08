import {
  deleteFromIndexedDb,
  readFromIndexedDb,
  trySaveToIndexedDb,
  type IndexedDbStorageLocation,
} from "./browser-storage";

const CLOUDFLARE_SYNC_SETTINGS_LOCATION: IndexedDbStorageLocation = {
  databaseName: "v3-industrial-planner",
  storeName: "cloudflare-sync-settings",
  key: "settings",
};

export const DEFAULT_CLOUDFLARE_SPACE_NAME = "default";
export const MAX_CLOUDFLARE_SPACE_NAME_LENGTH = 64;

export interface CloudflareSyncSettings {
  readonly spaceName: string;
}

export type CloudflareSyncSettingsChangeListener = (
  settings: CloudflareSyncSettings,
) => void;

const DEFAULT_CLOUDFLARE_SYNC_SETTINGS: CloudflareSyncSettings = {
  spaceName: DEFAULT_CLOUDFLARE_SPACE_NAME,
};

const settingsChangeListeners = new Set<CloudflareSyncSettingsChangeListener>();

export function subscribeToCloudflareSyncSettingsChanges(
  listener: CloudflareSyncSettingsChangeListener,
): () => void {
  settingsChangeListeners.add(listener);

  return () => {
    settingsChangeListeners.delete(listener);
  };
}

export async function readCloudflareSyncSettings(): Promise<CloudflareSyncSettings> {
  const rawSettings = await readFromIndexedDb<unknown>(
    CLOUDFLARE_SYNC_SETTINGS_LOCATION,
  );

  return normalizeCloudflareSyncSettings(rawSettings);
}

export async function writeCloudflareSyncSettings(
  settings: CloudflareSyncSettings,
): Promise<CloudflareSyncSettings> {
  const normalized = normalizeCloudflareSyncSettings(settings);
  const saved = await trySaveToIndexedDb(
    CLOUDFLARE_SYNC_SETTINGS_LOCATION,
    normalized,
  );

  if (!saved) {
    throw new Error("Failed to persist Cloudflare sync settings.");
  }

  emitCloudflareSyncSettingsChange(normalized);

  return normalized;
}

export function resolveCloudflareSpaceId(
  settings: CloudflareSyncSettings,
): string {
  return normalizeCloudflareSyncSettings(settings).spaceName;
}

export async function clearCloudflareSyncSettings(): Promise<void> {
  const cleared = await deleteFromIndexedDb(CLOUDFLARE_SYNC_SETTINGS_LOCATION);

  if (!cleared) {
    throw new Error("Failed to clear Cloudflare sync settings.");
  }

  emitCloudflareSyncSettingsChange(DEFAULT_CLOUDFLARE_SYNC_SETTINGS);
}

function normalizeCloudflareSyncSettings(value: unknown): CloudflareSyncSettings {
  if (!isRecord(value)) {
    return DEFAULT_CLOUDFLARE_SYNC_SETTINGS;
  }

  const spaceName = typeof value.spaceName === "string"
    ? value.spaceName.trim().slice(0, MAX_CLOUDFLARE_SPACE_NAME_LENGTH)
    : "";

  return {
    spaceName: spaceName || DEFAULT_CLOUDFLARE_SPACE_NAME,
  };
}

function emitCloudflareSyncSettingsChange(settings: CloudflareSyncSettings): void {
  for (const listener of settingsChangeListeners) {
    try {
      listener(settings);
    } catch {
      // 单个监听器失败不应影响设置写入或清理。
    }
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
