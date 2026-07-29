import {
  readFromLocalStorage,
  saveToLocalStorage,
} from "@/shared/storage/browser-storage";

export const WEBDAV_SYNC_METADATA_LOCAL_STORAGE_KEY = "v3-webdav-sync-metadata";

interface WebDavSyncMetadataState {
  readonly contentHashes: Record<string, string>;
  readonly remoteRevisions: Record<string, number>;
}

const EMPTY_METADATA: WebDavSyncMetadataState = {
  contentHashes: {},
  remoteRevisions: {},
};

export function readWebDavLastSyncedContentHash(assetKey: string): string | null {
  return readWebDavSyncMetadataState().contentHashes[assetKey] ?? null;
}

export function writeWebDavLastSyncedContentHash(assetKey: string, contentHash: string): string {
  const state = readWebDavSyncMetadataState();
  saveToLocalStorage<WebDavSyncMetadataState>(WEBDAV_SYNC_METADATA_LOCAL_STORAGE_KEY, {
    contentHashes: {
      ...state.contentHashes,
      [assetKey]: contentHash,
    },
    remoteRevisions: state.remoteRevisions,
  });

  return contentHash;
}

export function clearWebDavLastSyncedContentHash(assetKey: string): void {
  const state = readWebDavSyncMetadataState();
  const { [assetKey]: _removed, ...contentHashes } = state.contentHashes;

  saveToLocalStorage<WebDavSyncMetadataState>(WEBDAV_SYNC_METADATA_LOCAL_STORAGE_KEY, {
    contentHashes,
    remoteRevisions: state.remoteRevisions,
  });
}

export function readWebDavLastSeenRemoteRevision(remoteStateKey: string): number | null {
  return readWebDavSyncMetadataState().remoteRevisions[remoteStateKey] ?? null;
}

export function writeWebDavLastSeenRemoteRevision(
  remoteStateKey: string,
  revision: number,
): number {
  const state = readWebDavSyncMetadataState();
  saveToLocalStorage<WebDavSyncMetadataState>(WEBDAV_SYNC_METADATA_LOCAL_STORAGE_KEY, {
    contentHashes: state.contentHashes,
    remoteRevisions: {
      ...state.remoteRevisions,
      [remoteStateKey]: revision,
    },
  });

  return revision;
}

function readWebDavSyncMetadataState(): WebDavSyncMetadataState {
  const rawState = readFromLocalStorage<unknown>(WEBDAV_SYNC_METADATA_LOCAL_STORAGE_KEY);

  if (!isRecord(rawState)) {
    return EMPTY_METADATA;
  }

  // AI-REMOVED 2026-07-29:
  // Reason: 元数据现同时保存内容哈希和远端 revision 游标，旧校验会在任一字段缺失时丢弃另一字段。
  // Trigger: 同内容二次检查应直接探测下一 revision，避免每次枚举 revision 目录。
  // Evidence: 历史 v3-webdav-sync-metadata 只含 contentHashes，必须继续兼容。
  // Replacement: 下方两个字段分别容错归一化。
  // Risk: Low。
  // Human Review: Required
  //
  // Original code:
  // if (!isRecord(rawState) || !isRecord(rawState.contentHashes)) {
  //   return EMPTY_METADATA;
  // }
  const contentHashes = Object.fromEntries(
    Object.entries(
      isRecord(rawState.contentHashes) ? rawState.contentHashes : {},
    ).flatMap(([assetKey, contentHash]) => {
      if (typeof contentHash !== "string") {
        return [];
      }

      return [[assetKey, contentHash]];
    }),
  );
  const remoteRevisions = Object.fromEntries(
    Object.entries(
      isRecord(rawState.remoteRevisions) ? rawState.remoteRevisions : {},
    ).flatMap(([remoteStateKey, revision]) =>
      typeof revision === "number"
      && Number.isSafeInteger(revision)
      && revision >= 0
        ? [[remoteStateKey, revision]]
        : []
    ),
  );

  return { contentHashes, remoteRevisions };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
