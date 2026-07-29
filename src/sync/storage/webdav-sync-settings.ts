import {
  readFromLocalStorage,
  saveToLocalStorage,
} from "@/shared/storage/browser-storage";

export const WEBDAV_SYNC_SETTINGS_LOCAL_STORAGE_KEY = "v3-webdav-sync-settings";

export interface WebDavSyncSettings {
  readonly enabled: boolean;
  readonly url: string;
  readonly username: string;
  readonly password: string;
}

export type WebDavSyncSettingsChangeListener = (settings: WebDavSyncSettings) => void;

const DEFAULT_WEBDAV_SYNC_SETTINGS: WebDavSyncSettings = {
  enabled: false,
  url: "",
  username: "",
  password: "",
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

export function readWebDavSyncSettings(): WebDavSyncSettings {
  return normalizeWebDavSyncSettings(
    readFromLocalStorage<unknown>(WEBDAV_SYNC_SETTINGS_LOCAL_STORAGE_KEY),
  );
}

export function writeWebDavSyncSettings(settings: WebDavSyncSettings): WebDavSyncSettings {
  const savedSettings = saveToLocalStorage(
    WEBDAV_SYNC_SETTINGS_LOCAL_STORAGE_KEY,
    normalizeWebDavSyncSettings(settings),
  );

  emitWebDavSyncSettingsChange(savedSettings);

  return savedSettings;
}

export function readWebDavSyncEnabled(): boolean {
  return readWebDavSyncSettings().enabled;
}

export function writeWebDavSyncEnabled(enabled: boolean): boolean {
  writeWebDavSyncSettings({
    ...readWebDavSyncSettings(),
    enabled,
  });

  return enabled;
}

export function readWebDavSyncUrl(): string {
  return readWebDavSyncSettings().url;
}

export function writeWebDavSyncUrl(url: string): string {
  writeWebDavSyncSettings({
    ...readWebDavSyncSettings(),
    url,
  });

  return url;
}

export function readWebDavSyncUsername(): string {
  return readWebDavSyncSettings().username;
}

export function writeWebDavSyncUsername(username: string): string {
  writeWebDavSyncSettings({
    ...readWebDavSyncSettings(),
    username,
  });

  return username;
}

export function readWebDavSyncPassword(): string {
  return readWebDavSyncSettings().password;
}

export function writeWebDavSyncPassword(password: string): string {
  writeWebDavSyncSettings({
    ...readWebDavSyncSettings(),
    password,
  });

  return password;
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
  };
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
