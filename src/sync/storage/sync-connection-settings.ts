import {
  readFromIndexedDb,
  saveToIndexedDb,
  type IndexedDbStorageLocation,
} from "@/shared/storage/browser-storage";

const SYNC_CONNECTION_SETTINGS_DATABASE_NAME = "v3-industrial-planner";
const SYNC_CONNECTION_SETTINGS_STORE_NAME = "sync-connection-settings";
const SYNC_CONNECTION_SETTINGS_KEY = "settings";

const SYNC_CONNECTION_SETTINGS_LOCATION: IndexedDbStorageLocation = {
  databaseName: SYNC_CONNECTION_SETTINGS_DATABASE_NAME,
  storeName: SYNC_CONNECTION_SETTINGS_STORE_NAME,
  key: SYNC_CONNECTION_SETTINGS_KEY,
};

export const DEFAULT_MAX_CONCURRENT_REQUESTS = 4;
export const MIN_MAX_CONCURRENT_REQUESTS = 1;
export const MAX_MAX_CONCURRENT_REQUESTS = 8;

export interface SyncConnectionSettings {
  readonly enabled: boolean;
  readonly url: string;
  readonly username: string;
  readonly password: string;
  readonly maxConcurrentRequests: number;
}

export type SyncConnectionSettingsChangeListener = (settings: SyncConnectionSettings) => void;

const DEFAULT_SYNC_CONNECTION_SETTINGS: SyncConnectionSettings = {
  enabled: false,
  url: "",
  username: "",
  password: "",
  maxConcurrentRequests: DEFAULT_MAX_CONCURRENT_REQUESTS,
};

const settingsChangeListeners = new Set<SyncConnectionSettingsChangeListener>();

export function subscribeToSyncConnectionSettingsChanges(
  listener: SyncConnectionSettingsChangeListener,
): () => void {
  settingsChangeListeners.add(listener);

  return () => {
    settingsChangeListeners.delete(listener);
  };
}

export async function readSyncConnectionSettings(): Promise<SyncConnectionSettings> {
  const raw = await readFromIndexedDb<unknown>(SYNC_CONNECTION_SETTINGS_LOCATION);

  return normalizeSyncConnectionSettings(raw);
}

export async function writeSyncConnectionSettings(
  settings: SyncConnectionSettings,
): Promise<SyncConnectionSettings> {
  const normalized = normalizeSyncConnectionSettings(settings);
  await saveToIndexedDb(SYNC_CONNECTION_SETTINGS_LOCATION, normalized);
  emitSyncConnectionSettingsChange(normalized);

  return normalized;
}

function normalizeSyncConnectionSettings(value: unknown): SyncConnectionSettings {
  if (!isRecord(value)) {
    return DEFAULT_SYNC_CONNECTION_SETTINGS;
  }

  return {
    enabled: value.enabled === true,
    url: typeof value.url === "string" ? value.url : DEFAULT_SYNC_CONNECTION_SETTINGS.url,
    username: typeof value.username === "string" ? value.username : DEFAULT_SYNC_CONNECTION_SETTINGS.username,
    password: typeof value.password === "string" ? value.password : DEFAULT_SYNC_CONNECTION_SETTINGS.password,
    maxConcurrentRequests: normalizeMaxConcurrentRequests(value.maxConcurrentRequests),
  };
}

function normalizeMaxConcurrentRequests(value: unknown): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return DEFAULT_MAX_CONCURRENT_REQUESTS;
  }

  return Math.min(
    MAX_MAX_CONCURRENT_REQUESTS,
    Math.max(MIN_MAX_CONCURRENT_REQUESTS, Math.round(value)),
  );
}

function emitSyncConnectionSettingsChange(settings: SyncConnectionSettings): void {
  for (const listener of settingsChangeListeners) {
    try {
      listener(settings);
    } catch {
      // 单个监听器失败不应影响设置写入。
    }
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
