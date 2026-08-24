import type { UiKey } from "@/shared/i18n";
import {
  readSelectedSyncProvider,
  requestSyncProvider,
  SYNC_PROVIDER_STORAGE_KEY,
  type SyncProviderId,
} from "@/shared/storage/sync-provider-activation";

export type { SyncProviderId } from "@/shared/storage/sync-provider-activation";

// AI-REMOVED 2026-08-24:
// Reason: provider 标识需要由 app、sync 与 shared 存储共同使用，继续定义在 sync 模块会迫使 app 跨模块引用。
// Trigger: 用户要求同步 provider 选择与激活拆分为共享两阶段状态。
// Evidence: src/app/shell/state/settings-dialog-state.ts 与 workbench-app.tsx 原本直接引用 src/sync/sync-providers.ts。
// Replacement: src/shared/storage/sync-provider-activation.ts。
// Risk: Low。
// Human Review: Required
//
// Original code:
// /**
//  * 同步后端标识符。
//  * 未来新增后端只需在 SYNC_PROVIDER_CONFIGS 中添加一项即可。
//  */
// export type SyncProviderId = "none" | "webdav" | "cloudflare";

export interface SyncProviderConfig {
  readonly id: SyncProviderId;
  readonly labelKey: UiKey;
}

export const SYNC_PROVIDER_CONFIGS: readonly SyncProviderConfig[] = [
  { id: "none",      labelKey: "settingsOption.syncProvider.none" },
  { id: "webdav",    labelKey: "settingsOption.syncProvider.webdav" },
  { id: "cloudflare", labelKey: "settingsOption.syncProvider.cloudflare" },
];

/** 当前支持的非关闭同步 provider 列表（用于判断何时显示 provider 专属 UI）。 */
const ACTIVE_SYNC_PROVIDER_IDS: ReadonlySet<string> = new Set(
  SYNC_PROVIDER_CONFIGS.filter((c) => c.id !== "none").map((c) => c.id),
);

export function isActiveSyncProvider(id: string): boolean {
  return ACTIVE_SYNC_PROVIDER_IDS.has(id);
}

/** localStorage key，供 settings dialog 和 sync-host 共享读取。 */
// AI-CORRECTION 2026-08-24: 该 key 仅保留旧读取方兼容；激活真相位于 v3-sync-provider-activation。
export { SYNC_PROVIDER_STORAGE_KEY };

/** 从 localStorage 读取当前 sync provider。不可用时返回 "none"。 */
export function readSyncProvider(): string {
  return readSelectedSyncProvider();
}

/** 将 sync provider 写入 localStorage。不可用时静默失败。 */
export function writeSyncProvider(id: string): void {
  // AI-CORRECTION 2026-08-24: 非 none 写入现在只表达待配置选择，不再直接激活同步。
  requestSyncProvider(
    id === "webdav" || id === "cloudflare" ? id : "none",
  );
}
