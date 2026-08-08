import {
  readFromLocalStorage,
  saveToLocalStorage,
} from "@/shared/storage/browser-storage";

export const WEBDAV_SYNC_METADATA_LOCAL_STORAGE_KEY = "v3-webdav-sync-metadata";

interface WebDavSyncMetadataState {
  readonly contentHashes: Record<string, string>;
  readonly remoteRevisions: Record<string, number>;
  readonly remoteEtags: Record<string, string>;
}

const EMPTY_METADATA: WebDavSyncMetadataState = {
  contentHashes: {},
  remoteRevisions: {},
  remoteEtags: {},
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
    remoteEtags: state.remoteEtags,
  });

  return contentHash;
}

export function clearWebDavLastSyncedContentHash(assetKey: string): void {
  const state = readWebDavSyncMetadataState();
  const { [assetKey]: _removed, ...contentHashes } = state.contentHashes;

  saveToLocalStorage<WebDavSyncMetadataState>(WEBDAV_SYNC_METADATA_LOCAL_STORAGE_KEY, {
    contentHashes,
    remoteRevisions: state.remoteRevisions,
    remoteEtags: state.remoteEtags,
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
    remoteEtags: state.remoteEtags,
  });

  return revision;
}

export function clearWebDavLastSeenRemoteRevision(remoteStateKey: string): void {
  const state = readWebDavSyncMetadataState();
  const { [remoteStateKey]: _removed, ...remoteRevisions } = state.remoteRevisions;

  saveToLocalStorage<WebDavSyncMetadataState>(WEBDAV_SYNC_METADATA_LOCAL_STORAGE_KEY, {
    contentHashes: state.contentHashes,
    remoteRevisions,
    remoteEtags: state.remoteEtags,
  });
}

export function readWebDavLastSeenRemoteEtag(remoteStateKey: string): string | null {
  return readWebDavSyncMetadataState().remoteEtags[remoteStateKey] ?? null;
}

export function writeWebDavLastSeenRemoteEtag(
  remoteStateKey: string,
  etag: string,
): string {
  const state = readWebDavSyncMetadataState();
  saveToLocalStorage<WebDavSyncMetadataState>(WEBDAV_SYNC_METADATA_LOCAL_STORAGE_KEY, {
    contentHashes: state.contentHashes,
    remoteRevisions: state.remoteRevisions,
    remoteEtags: {
      ...state.remoteEtags,
      [remoteStateKey]: etag,
    },
  });

  return etag;
}

export function clearWebDavLastSeenRemoteEtag(remoteStateKey: string): void {
  const state = readWebDavSyncMetadataState();
  const { [remoteStateKey]: _removed, ...remoteEtags } = state.remoteEtags;

  saveToLocalStorage<WebDavSyncMetadataState>(WEBDAV_SYNC_METADATA_LOCAL_STORAGE_KEY, {
    contentHashes: state.contentHashes,
    remoteRevisions: state.remoteRevisions,
    remoteEtags,
  });
}

export function clearWebDavSyncMetadata(): void {
  try {
    globalThis.localStorage?.removeItem(WEBDAV_SYNC_METADATA_LOCAL_STORAGE_KEY);
  } catch (error) {
    throw new Error("Failed to clear WebDAV sync metadata.", { cause: error });
  }
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
  // AI-CORRECTION 2026-07-29: 元数据现在包含内容哈希、revision 游标和 canonical ETag；
  // 三个字段继续分别容错，历史客户端缺少 remoteEtags 时不得丢弃已有同步元数据。
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
  const remoteEtags = Object.fromEntries(
    Object.entries(
      isRecord(rawState.remoteEtags) ? rawState.remoteEtags : {},
    ).flatMap(([remoteStateKey, etag]) =>
      typeof etag === "string" && etag.length > 0
        ? [[remoteStateKey, etag]]
        : []
    ),
  );

  return { contentHashes, remoteRevisions, remoteEtags };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
