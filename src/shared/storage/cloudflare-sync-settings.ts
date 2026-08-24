import { createUuid } from "@/domain/shared/uuid";

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
const RANDOM_CLOUDFLARE_SPACE_NAME_PREFIX = "space-";

export interface CloudflareSyncSettings {
  readonly spaceName: string;
  readonly remoteMode: CloudflareRemoteMode;
}

export type CloudflareRemoteMode = "anonymous" | "account";

export interface InitializeCloudflareSyncSettingsOptions {
  readonly preserveImplicitDefault: boolean;
}

export type CloudflareSyncSettingsChangeListener = (
  settings: CloudflareSyncSettings,
) => void;

const DEFAULT_CLOUDFLARE_SYNC_SETTINGS: CloudflareSyncSettings = {
  // AI-CORRECTION 2026-08-24: 未配置状态必须保持空目标；default 只用于迁移已使用旧空间。
  spaceName: "",
  remoteMode: "anonymous",
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

  return normalizeCloudflareSyncSettings(rawSettings)
    ?? DEFAULT_CLOUDFLARE_SYNC_SETTINGS;
}

export async function initializeCloudflareSyncSettings(
  options: InitializeCloudflareSyncSettingsOptions,
): Promise<CloudflareSyncSettings> {
  const rawSettings = await readFromIndexedDb<unknown>(
    CLOUDFLARE_SYNC_SETTINGS_LOCATION,
  );
  const existingSettings = normalizeCloudflareSyncSettings(rawSettings);

  if (existingSettings !== null) {
    return existingSettings;
  }

  // AI-REMOVED 2026-08-24:
  // Reason: 同步宿主初始化不得替尚未确认同步方式的用户生成并持久化随机 Space ID。
  // Trigger: 用户要求切换 Cloudflare 后必须明确选择账户或匿名 Space ID 才能生效。
  // Evidence: provider 选择现进入 pending；随机目标只应由显式配置动作产生。
  // Replacement: 下方未配置返回空目标；旧 active default 用户仍走 preserveImplicitDefault 分支。
  // Risk: Low。
  // Human Review: Required
  //
  // Original code:
  // return await writeCloudflareSyncSettings({
  //   spaceName: options.preserveImplicitDefault
  //     ? DEFAULT_CLOUDFLARE_SPACE_NAME
  //     : createRandomCloudflareSpaceName(),
  //   remoteMode: "anonymous",
  // });
  if (!options.preserveImplicitDefault) {
    return DEFAULT_CLOUDFLARE_SYNC_SETTINGS;
  }

  return await writeCloudflareSyncSettings({
    spaceName: DEFAULT_CLOUDFLARE_SPACE_NAME,
    remoteMode: "anonymous",
  });
}

export async function writeCloudflareSyncSettings(
  settings: CloudflareSyncSettings,
): Promise<CloudflareSyncSettings> {
  const normalized = normalizeCloudflareSyncSettings(settings);

  if (normalized === null) {
    throw new Error("Cloudflare space name must not be empty.");
  }

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
  const normalized = normalizeCloudflareSyncSettings(settings);

  if (normalized === null) {
    throw new Error("Cloudflare space name must not be empty.");
  }

  return normalized.spaceName;
}

export function createRandomCloudflareSpaceName(): string {
  return `${RANDOM_CLOUDFLARE_SPACE_NAME_PREFIX}${createUuid()}`;
}

export function isRandomCloudflareSpaceName(value: string): boolean {
  return /^space-[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u
    .test(value.trim());
}

export async function clearCloudflareSyncSettings(): Promise<void> {
  const cleared = await deleteFromIndexedDb(CLOUDFLARE_SYNC_SETTINGS_LOCATION);

  if (!cleared) {
    throw new Error("Failed to clear Cloudflare sync settings.");
  }

  emitCloudflareSyncSettingsChange(DEFAULT_CLOUDFLARE_SYNC_SETTINGS);
}

function normalizeCloudflareSyncSettings(value: unknown): CloudflareSyncSettings | null {
  if (!isRecord(value)) {
    return null;
  }

  const spaceName = typeof value.spaceName === "string"
    ? value.spaceName.trim().slice(0, MAX_CLOUDFLARE_SPACE_NAME_LENGTH)
    : "";

  const remoteMode: CloudflareRemoteMode = value.remoteMode === "account"
    ? "account"
    : "anonymous";

  return spaceName === "" && remoteMode === "anonymous"
    ? null
    : { spaceName, remoteMode };
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
