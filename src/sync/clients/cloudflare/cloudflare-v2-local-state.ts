import {
  applyIndexedDbStoreMutations,
  listFromIndexedDb,
  readFromIndexedDb,
  type IndexedDbMutationOperation,
  type IndexedDbStorageLocation,
  type IndexedDbStoreLocation,
} from "@/shared/storage/browser-storage";
import { CLOUDFLARE_SYNC_TOMBSTONE_STORE_NAME } from "@/shared/storage/sync-tombstone-storage";

export const CF_V2_DATABASE_NAME = "v3-industrial-planner";
const CF_STATE_STORE = "cf-sync-state";
const CF_ASSETS_STORE = "cf-sync-assets";
const CF_STATE_KEY_PREFIX = "state";
const CF_COLLECTION_ETAG_PREFIX = "col-etag";

export async function hasPersistedCloudflareV2LocalState(
  apiBase: string,
  spaceId: string,
): Promise<boolean> {
  const normalizedApiBase = apiBase.replace(/\/$/, "");
  const normalizedSpaceId = spaceId.trim();

  if (normalizedSpaceId === "") {
    return false;
  }

  const scopeKey = `${normalizedApiBase}\u0000${normalizedSpaceId}`;
  const stored = await readFromIndexedDb<unknown>({
    databaseName: CF_V2_DATABASE_NAME,
    storeName: CF_STATE_STORE,
    key: `${CF_STATE_KEY_PREFIX}\u0000${scopeKey}`,
  });

  return normalizeState(stored, normalizedSpaceId) !== null;
}

export async function readCloudflareV2LocalRevision(
  apiBase: string,
  spaceId: string,
): Promise<string | null> {
  const normalizedApiBase = apiBase.replace(/\/$/, "");
  const normalizedSpaceId = spaceId.trim();

  if (normalizedSpaceId === "") {
    return null;
  }

  const scopeKey = `${normalizedApiBase}\u0000${normalizedSpaceId}`;
  const stored = await readFromIndexedDb<unknown>({
    databaseName: CF_V2_DATABASE_NAME,
    storeName: CF_STATE_STORE,
    key: `${CF_STATE_KEY_PREFIX}\u0000${scopeKey}`,
  });

  return normalizeState(stored, normalizedSpaceId)?.revision ?? "0";
}

interface CfLocalStateRecord {
  readonly schemaVersion: 3;
  readonly spaceId: string;
  readonly revision: string;
}

interface CfAssetStateRecord {
  readonly scopeKey?: string;
  readonly assetKey: string;
  readonly remoteRevision: number | null;
  readonly lastSyncedContentHash: string | null;
  readonly remoteProtocolContentHash: string | null;
  readonly remoteAdapterContentHash: string | null;
}

interface CfCollectionEtagRecord {
  readonly scopeKey?: string;
  readonly stateKey?: string;
  readonly etag: string | null;
}

export class CloudflareV2LocalStateStore {
  private cachedState: CfLocalStateRecord | null = null;
  private readonly pendingAdapterHashStorageKeys = new Set<string>();
  private readonly scopeKey: string;
  private readonly stateLocation: IndexedDbStorageLocation;
  private readonly assetsLocation: IndexedDbStoreLocation;

  public constructor(
    private readonly apiBase: string,
    private readonly spaceId: string,
  ) {
    this.scopeKey = `${apiBase}\u0000${spaceId}`;
    this.stateLocation = {
      databaseName: CF_V2_DATABASE_NAME,
      storeName: CF_STATE_STORE,
      key: `${CF_STATE_KEY_PREFIX}\u0000${this.scopeKey}`,
    };
    this.assetsLocation = {
      databaseName: CF_V2_DATABASE_NAME,
      storeName: CF_ASSETS_STORE,
    };
  }

  public async readAppliedRevision(): Promise<string> {
    return (await this.readState()).revision;
  }

  public async writeAppliedRevision(revision: string): Promise<void> {
    const state = await this.readState();
    if (state.revision === revision) {
      return;
    }
    await this.writeState({ ...state, revision });
  }

  public async getLastSyncedHash(assetKey: string): Promise<string | null> {
    return (await this.readAssetState(assetKey))?.lastSyncedContentHash ?? null;
  }

  public async setLastSyncedHash(assetKey: string, hash: string | null): Promise<void> {
    const storageKey = this.createAssetStorageKey(assetKey);
    const existing = normalizeAssetState(await this.readAssetState(assetKey), assetKey, this.scopeKey);
    await this.applyAssetMutations([{
      type: "put",
      key: storageKey,
      value: {
        ...existing,
        lastSyncedContentHash: hash,
        remoteAdapterContentHash: this.pendingAdapterHashStorageKeys.has(storageKey)
          ? hash
          : existing.remoteAdapterContentHash,
      },
    }]);
    this.pendingAdapterHashStorageKeys.delete(storageKey);
  }

  public async getRemoteRevision(key: string): Promise<number | null> {
    return (await this.readAssetState(key))?.remoteRevision ?? null;
  }

  public async setRemoteRevision(key: string, revision: number | null): Promise<void> {
    const storageKey = this.createAssetStorageKey(key);
    if (revision === null) {
      await this.applyAssetMutations([{ type: "delete", key: storageKey }]);
      return;
    }
    const existing = normalizeAssetState(await this.readAssetState(key), key, this.scopeKey);
    await this.applyAssetMutations([{
      type: "put",
      key: storageKey,
      value: { ...existing, remoteRevision: revision },
    }]);
  }

  public async getRemoteEtag(key: string): Promise<string | null> {
    const storageKey = this.createCollectionEtagStorageKey(key);
    let record = await readFromIndexedDb<CfCollectionEtagRecord>({
      databaseName: CF_V2_DATABASE_NAME,
      storeName: CF_STATE_STORE,
      key: storageKey,
    });
    if (record === null) {
      // 兼容旧版未按远端 scope 编址的记录；读取后立即迁移。
      record = await readFromIndexedDb<CfCollectionEtagRecord>({
        databaseName: CF_V2_DATABASE_NAME,
        storeName: CF_STATE_STORE,
        key: `${CF_COLLECTION_ETAG_PREFIX}\u0000${key}`,
      });
      if (record !== null) {
        await this.setRemoteEtag(key, record.etag);
        await applyIndexedDbStoreMutations(
          { databaseName: CF_V2_DATABASE_NAME, storeName: CF_STATE_STORE },
          [{ type: "delete", key: `${CF_COLLECTION_ETAG_PREFIX}\u0000${key}` }],
        );
      }
    }
    return record?.etag ?? null;
  }

  public async setRemoteEtag(key: string, etag: string | null): Promise<void> {
    const storageKey = this.createCollectionEtagStorageKey(key);
    const saved = await applyIndexedDbStoreMutations(
      {
        databaseName: CF_V2_DATABASE_NAME,
        storeName: CF_STATE_STORE,
      },
      etag === null
        ? [{ type: "delete", key: storageKey }]
        : [{
            type: "put",
            key: storageKey,
            value: { scopeKey: this.scopeKey, stateKey: key, etag },
          }],
    );
    if (!saved) {
      throw new Error("Failed to persist Cloudflare collection revision.");
    }
  }

  public async readComparableHashes(
    assets: readonly {
      readonly assetKey: string;
      readonly protocolContentHash: string;
    }[],
  ): Promise<readonly (string | null)[]> {
    return await Promise.all(assets.map(async (asset) => {
      const record = await this.readAssetState(asset.assetKey);
      return record?.remoteProtocolContentHash === asset.protocolContentHash
        ? record.remoteAdapterContentHash
        : null;
    }));
  }

  public async noteRemoteHash(
    assetKey: string,
    protocolContentHash: string,
    adapterContentHash?: string,
  ): Promise<void> {
    const storageKey = this.createAssetStorageKey(assetKey);
    const existing = normalizeAssetState(await this.readAssetState(assetKey), assetKey, this.scopeKey);
    const protocolUnchanged = existing.remoteProtocolContentHash === protocolContentHash;
    await this.applyAssetMutations([{
      type: "put",
      key: storageKey,
      value: {
        ...existing,
        remoteProtocolContentHash: protocolContentHash,
        remoteAdapterContentHash: adapterContentHash
          ?? (protocolUnchanged ? existing.remoteAdapterContentHash : null),
      },
    }]);
    if (adapterContentHash === undefined) {
      this.pendingAdapterHashStorageKeys.add(storageKey);
    } else {
      this.pendingAdapterHashStorageKeys.delete(storageKey);
    }
  }

  public async reset(): Promise<void> {
    this.cachedState = null;
    this.pendingAdapterHashStorageKeys.clear();

    const [assetRecords, etagRecords, tombstoneRecords] = await Promise.all([
      listFromIndexedDb<CfAssetStateRecord>(this.assetsLocation),
      listFromIndexedDb<CfCollectionEtagRecord>({
        databaseName: CF_V2_DATABASE_NAME,
        storeName: CF_STATE_STORE,
      }),
      listFromIndexedDb<{
        readonly scopeKey?: string;
        readonly adapterId?: string;
        readonly assetId?: string;
      }>({
        databaseName: CF_V2_DATABASE_NAME,
        storeName: CLOUDFLARE_SYNC_TOMBSTONE_STORE_NAME,
      }),
    ]);

    const stateOperations: IndexedDbMutationOperation<unknown>[] = [
      { type: "delete", key: this.stateLocation.key },
      ...etagRecords.flatMap((record) =>
        record.scopeKey === this.scopeKey && typeof record.stateKey === "string"
          ? [{ type: "delete" as const, key: this.createCollectionEtagStorageKey(record.stateKey) }]
          : []
      ),
    ];
    const assetOperations: IndexedDbMutationOperation<unknown>[] = assetRecords.flatMap((record) =>
      record.scopeKey === this.scopeKey
        ? [{ type: "delete" as const, key: this.createAssetStorageKey(record.assetKey) }]
        : []
    );
    const tombstoneOperations: IndexedDbMutationOperation<unknown>[] = tombstoneRecords.flatMap((record) =>
      record.scopeKey === this.scopeKey
        && typeof record.adapterId === "string"
        && typeof record.assetId === "string"
        ? [{
            type: "delete" as const,
            key: `${record.scopeKey}\u0000${record.adapterId}\u0000${record.assetId}`,
          }]
        : []
    );

    const results = await Promise.all([
      applyIndexedDbStoreMutations(
        { databaseName: CF_V2_DATABASE_NAME, storeName: CF_STATE_STORE },
        stateOperations,
      ),
      applyIndexedDbStoreMutations(this.assetsLocation, assetOperations),
      applyIndexedDbStoreMutations(
        {
          databaseName: CF_V2_DATABASE_NAME,
          storeName: CLOUDFLARE_SYNC_TOMBSTONE_STORE_NAME,
        },
        tombstoneOperations,
      ),
    ]);
    if (results.some((result) => !result)) {
      throw new Error("Failed to clear Cloudflare sync metadata.");
    }
  }

  private async readState(): Promise<CfLocalStateRecord> {
    if (this.cachedState !== null) {
      return this.cachedState;
    }
    const stored = await readFromIndexedDb<unknown>(this.stateLocation);
    const normalized = normalizeState(stored, this.spaceId) ?? {
      schemaVersion: 3,
      spaceId: this.spaceId,
      revision: "0",
    };
    this.cachedState = normalized;
    if (stored === null) {
      await this.writeState(normalized);
    }
    return normalized;
  }

  private async writeState(state: CfLocalStateRecord): Promise<void> {
    const saved = await applyIndexedDbStoreMutations(this.stateLocation, [{
      type: "put",
      key: this.stateLocation.key,
      value: state,
    }]);
    if (!saved) {
      throw new Error("Failed to persist Cloudflare sync state.");
    }
    this.cachedState = state;
  }

  private async readAssetState(assetKey: string): Promise<CfAssetStateRecord | null> {
    const storageKey = this.createAssetStorageKey(assetKey);
    let record = await readFromIndexedDb<CfAssetStateRecord>({
      ...this.assetsLocation,
      key: storageKey,
    });
    if (record === null) {
      // 旧实现使用未隔离的 assetKey；迁移后不再让不同空间互相污染。
      record = await readFromIndexedDb<CfAssetStateRecord>({
        ...this.assetsLocation,
        key: assetKey,
      });
      if (record !== null) {
        await this.applyAssetMutations([
          {
            type: "put",
            key: storageKey,
            value: normalizeAssetState(record, assetKey, this.scopeKey),
          },
          { type: "delete", key: assetKey },
        ]);
      }
    }
    return record;
  }

  private createAssetStorageKey(assetKey: string): string {
    return `${this.scopeKey}\u0000${assetKey}`;
  }

  private createCollectionEtagStorageKey(key: string): string {
    return `${CF_COLLECTION_ETAG_PREFIX}\u0000${this.scopeKey}\u0000${key}`;
  }

  private async applyAssetMutations(
    operations: readonly IndexedDbMutationOperation<CfAssetStateRecord>[],
  ): Promise<void> {
    const saved = await applyIndexedDbStoreMutations(this.assetsLocation, operations);
    if (!saved) {
      throw new Error("Failed to persist Cloudflare asset sync metadata.");
    }
  }
}

function normalizeState(value: unknown, spaceId: string): CfLocalStateRecord | null {
  if (typeof value !== "object" || value === null) {
    return null;
  }
  const candidate = value as Partial<CfLocalStateRecord>;
  return candidate.schemaVersion === 3
    && candidate.spaceId === spaceId
    && typeof candidate.revision === "string"
    ? candidate as CfLocalStateRecord
    : null;
}

function normalizeAssetState(
  value: CfAssetStateRecord | null,
  assetKey: string,
  scopeKey: string,
): CfAssetStateRecord {
  return {
    scopeKey,
    assetKey,
    remoteRevision: value?.remoteRevision ?? null,
    lastSyncedContentHash: value?.lastSyncedContentHash ?? null,
    remoteProtocolContentHash: value?.remoteProtocolContentHash ?? null,
    remoteAdapterContentHash: value?.remoteAdapterContentHash ?? null,
  };
}
