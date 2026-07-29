import {
  readFromLocalStorage,
  saveToLocalStorage,
} from "@/shared/storage/browser-storage";

export const WEBDAV_SYNC_METADATA_LOCAL_STORAGE_KEY = "v3-webdav-sync-metadata";

interface WebDavSyncMetadataState {
  readonly contentHashes: Record<string, string>;
}

const EMPTY_METADATA: WebDavSyncMetadataState = {
  contentHashes: {},
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
  });

  return contentHash;
}

export function clearWebDavLastSyncedContentHash(assetKey: string): void {
  const state = readWebDavSyncMetadataState();
  const { [assetKey]: _removed, ...contentHashes } = state.contentHashes;

  saveToLocalStorage<WebDavSyncMetadataState>(WEBDAV_SYNC_METADATA_LOCAL_STORAGE_KEY, {
    contentHashes,
  });
}

function readWebDavSyncMetadataState(): WebDavSyncMetadataState {
  const rawState = readFromLocalStorage<unknown>(WEBDAV_SYNC_METADATA_LOCAL_STORAGE_KEY);

  if (!isRecord(rawState) || !isRecord(rawState.contentHashes)) {
    return EMPTY_METADATA;
  }

  const contentHashes = Object.fromEntries(
    Object.entries(rawState.contentHashes).flatMap(([assetKey, contentHash]) => {
      if (typeof contentHash !== "string") {
        return [];
      }

      return [[assetKey, contentHash]];
    }),
  );

  return { contentHashes };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
