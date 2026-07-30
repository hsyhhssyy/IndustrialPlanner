import {
  readFromIndexedDb,
  saveToIndexedDb,
  type IndexedDbStorageLocation,
} from "@/shared/storage/browser-storage";

const WEBDAV_SYNC_SETTINGS_DATABASE_NAME = "v3-industrial-planner";
const WEBDAV_SYNC_SETTINGS_STORE_NAME = "webdav-sync-settings";
const WEBDAV_SYNC_SETTINGS_KEY = "settings";

const WEBDAV_SYNC_SETTINGS_LOCATION: IndexedDbStorageLocation = {
  databaseName: WEBDAV_SYNC_SETTINGS_DATABASE_NAME,
  storeName: WEBDAV_SYNC_SETTINGS_STORE_NAME,
  key: WEBDAV_SYNC_SETTINGS_KEY,
};

export const DEFAULT_WEBDAV_MAX_CONCURRENT_REQUESTS = 4;
export const MIN_WEBDAV_MAX_CONCURRENT_REQUESTS = 1;
export const MAX_WEBDAV_MAX_CONCURRENT_REQUESTS = 8;

export interface WebDavSyncSettings {
  readonly enabled: boolean;
  readonly url: string;
  readonly username: string;
  readonly password: string;
  readonly maxConcurrentRequests: number;
}

export type WebDavSyncSettingsChangeListener = (settings: WebDavSyncSettings) => void;

const DEFAULT_WEBDAV_SYNC_SETTINGS: WebDavSyncSettings = {
  enabled: false,
  url: "",
  username: "",
  password: "",
  maxConcurrentRequests: DEFAULT_WEBDAV_MAX_CONCURRENT_REQUESTS,
};

const settingsChangeListeners = new Set<WebDavSyncSettingsChangeListener>();

export function subscribeToWebDavSyncSettingsChanges(
  listener: WebDavSyncSettingsChangeListener,
): () => void {
  settingsChangeListeners.add(listener);

  return () => {
    settingsChangeListeners.delete(listener);
  };
}

export async function readWebDavSyncSettings(): Promise<WebDavSyncSettings> {
  const raw = await readFromIndexedDb<unknown>(WEBDAV_SYNC_SETTINGS_LOCATION);

  return normalizeWebDavSyncSettings(raw);
}

export async function writeWebDavSyncSettings(
  settings: WebDavSyncSettings,
): Promise<WebDavSyncSettings> {
  const normalized = normalizeWebDavSyncSettings(settings);
  await saveToIndexedDb(WEBDAV_SYNC_SETTINGS_LOCATION, normalized);
  emitWebDavSyncSettingsChange(normalized);

  return normalized;
}

function normalizeWebDavSyncSettings(value: unknown): WebDavSyncSettings {
  if (!isRecord(value)) {
    return DEFAULT_WEBDAV_SYNC_SETTINGS;
  }

  return {
    enabled: value.enabled === true,
    url: typeof value.url === "string" ? value.url : DEFAULT_WEBDAV_SYNC_SETTINGS.url,
    username: typeof value.username === "string" ? value.username : DEFAULT_WEBDAV_SYNC_SETTINGS.username,
    password: typeof value.password === "string" ? value.password : DEFAULT_WEBDAV_SYNC_SETTINGS.password,
    maxConcurrentRequests: normalizeMaxConcurrentRequests(value.maxConcurrentRequests),
  };
}

function normalizeMaxConcurrentRequests(value: unknown): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return DEFAULT_WEBDAV_MAX_CONCURRENT_REQUESTS;
  }

  return Math.min(
    MAX_WEBDAV_MAX_CONCURRENT_REQUESTS,
    Math.max(MIN_WEBDAV_MAX_CONCURRENT_REQUESTS, Math.round(value)),
  );
}

function emitWebDavSyncSettingsChange(settings: WebDavSyncSettings): void {
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
