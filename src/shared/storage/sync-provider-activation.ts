import {
  readFromLocalStorage,
  trySaveToLocalStorage,
} from "./browser-storage";

export type SyncProviderId = "none" | "webdav" | "cloudflare";
export type ActiveSyncProviderId = Exclude<SyncProviderId, "none">;

export type SyncProviderActivation =
  | {
      readonly schemaVersion: 1;
      readonly state: "disabled";
    }
  | {
      readonly schemaVersion: 1;
      readonly state: "pending";
      readonly provider: ActiveSyncProviderId;
    }
  | {
      readonly schemaVersion: 1;
      readonly state: "active";
      readonly provider: ActiveSyncProviderId;
      /** null 仅用于读取尚未迁移的 v3-sync-provider 旧记录。 */
      readonly confirmedTargetKey: string | null;
    };

export const SYNC_PROVIDER_STORAGE_KEY = "v3-sync-provider";
export const SYNC_PROVIDER_ACTIVATION_STORAGE_KEY = "v3-sync-provider-activation";

export type SyncProviderActivationChangeListener = (
  activation: SyncProviderActivation,
) => void;

const activationChangeListeners = new Set<SyncProviderActivationChangeListener>();

export function readSyncProviderActivation(): SyncProviderActivation {
  const stored = normalizeSyncProviderActivation(
    readFromLocalStorage<unknown>(SYNC_PROVIDER_ACTIVATION_STORAGE_KEY),
  );
  if (stored !== null) {
    return stored;
  }

  const legacyProvider = readLegacySyncProvider();
  return legacyProvider === "none"
    ? { schemaVersion: 1, state: "disabled" }
    : {
        schemaVersion: 1,
        state: "active",
        provider: legacyProvider,
        confirmedTargetKey: null,
      };
}

export function hasPersistedSyncProviderActivation(): boolean {
  return normalizeSyncProviderActivation(
    readFromLocalStorage<unknown>(SYNC_PROVIDER_ACTIVATION_STORAGE_KEY),
  ) !== null;
}

export function readSelectedSyncProvider(): SyncProviderId {
  const activation = readSyncProviderActivation();
  return activation.state === "disabled" ? "none" : activation.provider;
}

export function readActiveSyncProvider(): ActiveSyncProviderId | null {
  const activation = readSyncProviderActivation();
  return activation.state === "active" ? activation.provider : null;
}

/**
 * 记录用户准备配置的 provider。非 none 选择只进入 pending，不会激活同步。
 */
export function requestSyncProvider(provider: SyncProviderId): boolean {
  const activation: SyncProviderActivation = provider === "none"
    ? { schemaVersion: 1, state: "disabled" }
    : { schemaVersion: 1, state: "pending", provider };
  return persistSyncProviderActivation(activation);
}

/** 用户完成目标确认后，激活对应 provider。 */
export function activateSyncProvider(
  provider: ActiveSyncProviderId,
  confirmedTargetKey: string,
): boolean {
  const normalizedTargetKey = confirmedTargetKey.trim();
  if (normalizedTargetKey === "") {
    return false;
  }
  return persistSyncProviderActivation({
    schemaVersion: 1,
    state: "active",
    provider,
    confirmedTargetKey: normalizedTargetKey,
  });
}

export function isSyncProviderTargetActive(
  provider: ActiveSyncProviderId,
  targetKey: string,
): boolean {
  const activation = readSyncProviderActivation();
  return activation.state === "active"
    && activation.provider === provider
    && (
      activation.confirmedTargetKey === null
      || activation.confirmedTargetKey === targetKey
    );
}

export function createWebDavSyncTargetKey(settings: {
  readonly url: string;
  readonly username: string;
}): string {
  return JSON.stringify([
    "webdav",
    settings.url.trim().replace(/\/+$/u, ""),
    settings.username.trim(),
  ]);
}

export function createCloudflareAnonymousSyncTargetKey(options: {
  readonly apiBaseUrl: string;
  readonly spaceId: string;
}): string {
  return JSON.stringify([
    "cloudflare",
    "anonymous",
    options.apiBaseUrl.trim().replace(/\/+$/u, ""),
    options.spaceId.trim(),
  ]);
}

export function createCloudflareAccountSyncTargetKey(options: {
  readonly apiBaseUrl: string;
  readonly accountId: string;
  readonly spaceId: string;
}): string {
  return JSON.stringify([
    "cloudflare",
    "account",
    options.apiBaseUrl.trim().replace(/\/+$/u, ""),
    options.accountId.trim(),
    options.spaceId.trim(),
  ]);
}

export function subscribeToSyncProviderActivationChanges(
  listener: SyncProviderActivationChangeListener,
): () => void {
  activationChangeListeners.add(listener);
  const handleStorage = (event: StorageEvent) => {
    if (
      event.key === SYNC_PROVIDER_ACTIVATION_STORAGE_KEY
      || event.key === SYNC_PROVIDER_STORAGE_KEY
    ) {
      listener(readSyncProviderActivation());
    }
  };
  globalThis.addEventListener?.("storage", handleStorage);

  return () => {
    activationChangeListeners.delete(listener);
    globalThis.removeEventListener?.("storage", handleStorage);
  };
}

function persistSyncProviderActivation(
  activation: SyncProviderActivation,
): boolean {
  if (!trySaveToLocalStorage(SYNC_PROVIDER_ACTIVATION_STORAGE_KEY, activation)) {
    return false;
  }

  const provider = activation.state === "disabled" ? "none" : activation.provider;
  try {
    globalThis.localStorage?.setItem(SYNC_PROVIDER_STORAGE_KEY, provider);
  } catch {
    // 新激活记录是唯一真相；旧 provider key 只用于兼容尚未迁移的读取方。
  }
  emitSyncProviderActivationChange(activation);
  return true;
}

function readLegacySyncProvider(): SyncProviderId {
  try {
    const provider = globalThis.localStorage?.getItem(SYNC_PROVIDER_STORAGE_KEY);
    return provider === "webdav" || provider === "cloudflare" ? provider : "none";
  } catch {
    return "none";
  }
}

function normalizeSyncProviderActivation(
  value: unknown,
): SyncProviderActivation | null {
  if (!isRecord(value) || value.schemaVersion !== 1) {
    return null;
  }
  if (value.state === "disabled") {
    return { schemaVersion: 1, state: "disabled" };
  }
  if (
    (value.state === "pending" || value.state === "active")
    && (value.provider === "webdav" || value.provider === "cloudflare")
  ) {
    if (value.state === "pending") {
      return {
        schemaVersion: 1,
        state: "pending",
        provider: value.provider,
      };
    }
    return typeof value.confirmedTargetKey === "string"
      && value.confirmedTargetKey.trim() !== ""
      ? {
          schemaVersion: 1,
          state: "active",
          provider: value.provider,
          confirmedTargetKey: value.confirmedTargetKey,
        }
      : null;
  }
  return null;
}

function emitSyncProviderActivationChange(
  activation: SyncProviderActivation,
): void {
  for (const listener of activationChangeListeners) {
    try {
      listener(activation);
    } catch {
      // 单个监听器失败不影响 provider 激活状态持久化。
    }
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
