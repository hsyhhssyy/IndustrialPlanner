import type { UiKey } from "@/shared/i18n";

/**
 * 同步后端标识符。
 * 未来新增后端只需在 SYNC_PROVIDER_CONFIGS 中添加一项即可。
 */
export type SyncProviderId = "none" | "webdav";

export interface SyncProviderConfig {
  readonly id: SyncProviderId;
  readonly labelKey: UiKey;
}

export const SYNC_PROVIDER_CONFIGS: readonly SyncProviderConfig[] = [
  { id: "none",   labelKey: "settingsOption.syncProvider.none" },
  { id: "webdav", labelKey: "settingsOption.syncProvider.webdav" },
];

/** 当前支持的非关闭同步 provider 列表（用于判断何时显示 provider 专属 UI）。 */
const ACTIVE_SYNC_PROVIDER_IDS: ReadonlySet<string> = new Set(
  SYNC_PROVIDER_CONFIGS.filter((c) => c.id !== "none").map((c) => c.id),
);

export function isActiveSyncProvider(id: string): boolean {
  return ACTIVE_SYNC_PROVIDER_IDS.has(id);
}

/** localStorage key，供 settings dialog 和 sync-host 共享读取。 */
export const SYNC_PROVIDER_STORAGE_KEY = "v3-sync-provider";
