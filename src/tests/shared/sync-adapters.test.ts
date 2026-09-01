// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from "vitest";

import {
  createFullNoRevisionAdapter,
  createFullWithRevisionAdapter,
  createPatchCollectionWithRevisionAdapter,
  createPatchWithRevisionAdapter,
  createWebDavSyncRemote,
} from "@/sync";
import { createStableJsonHash } from "@/shared/storage/hash-utils";
import type {
  RemoteAssetPutParams,
  RemoteAssetTombstoneParams,
  SyncAdapter,
  SyncAdapterResult,
  SyncAdapterScope,
  SyncEngineTransaction,
  SyncPlanItem,
  SyncPlanUpload,
  SyncRemoteSession,
  SyncResourceStat,
  SyncStorageClient,
  SyncTextFile,
  SyncWriteOptions,
} from "@/sync";

class MemoryStorageClient implements SyncStorageClient {
  public readonly rootPath = "/industrial-planner";
  public readonly files = new Map<string, string>();
  public readonly madeDirectories: string[] = [];
  public readonly readPaths: string[] = [];

  public async exists(relativePath: string): Promise<boolean> {
    return this.files.has(relativePath);
  }

  public async makeDirectory(relativePath: string): Promise<void> {
    this.madeDirectories.push(relativePath);
  }

  public async listDirectory(_relativePath: string): Promise<SyncResourceStat[]> {
    return [];
  }

  public async stat(_relativePath: string): Promise<SyncResourceStat | null> {
    return null;
  }

  public async readTextFile(relativePath: string): Promise<SyncTextFile | null> {
    this.readPaths.push(relativePath);
    const content = this.files.get(relativePath);

    return content === undefined
      ? null
      : {
        content,
        etag: null,
        lastModified: "2026-07-29T12:00:00.000Z",
      };
  }

  public async writeTextFile(
    relativePath: string,
    content: string,
    _options?: SyncWriteOptions,
  ): Promise<boolean> {
    this.files.set(relativePath, content);

    return true;
  }

  public async deleteResource(relativePath: string): Promise<void> {
    this.files.delete(relativePath);
  }
}

async function createSession(
  client: MemoryStorageClient,
  adapters: readonly SyncAdapter[],
): Promise<SyncRemoteSession> {
  return await createWebDavSyncRemote({ client }).beginSession({
    reason: "manual",
    collections: adapters.map((adapter) => adapter.collection),
  });
}

interface AdapterRunOutcome {
  readonly result: SyncAdapterResult;
  readonly items: readonly SyncPlanItem[];
  /** 与引擎一致的终局执行：提交上传、落地二段删除、写入暂存 touch。 */
  readonly finalize: () => Promise<void>;
}

interface AdapterRunControls {
  readonly session: SyncRemoteSession;
  readonly transaction: SyncEngineTransaction;
  readonly outcome: AdapterRunOutcome;
}

async function createAdapterRun(
  adapter: SyncAdapter,
  client: MemoryStorageClient,
  scope?: SyncAdapterScope,
): Promise<AdapterRunControls> {
  const session = await createSession(client, [adapter]);
  const uploads: SyncPlanUpload[] = [];
  const stagedTouches = new Map<string, string | null>();
  const stagedDeletions: Array<() => Promise<void>> = [];
  const items: SyncPlanItem[] = [];
  const writeBatch = session.beginWriteBatch();
  const transaction: SyncEngineTransaction = {
    writeBatch,
    stageTouch: (assetKey, contentHash) => {
      stagedTouches.set(assetKey, contentHash);
    },
    stageDeletion: (_adapterId, _assetId, apply) => {
      stagedDeletions.push(apply);
    },
    recordItem: (item) => {
      items.push(item);
    },
    recordUpload: (upload) => {
      uploads.push(upload);
    },
    assertDownloadAllowed: async () => undefined,
  };

  const result = await adapter.sync(session, { scope, transaction });
  let finalized = false;
  const finalize = async (): Promise<void> => {
    if (finalized) {
      return;
    }
    finalized = true;
    for (const upload of uploads) {
      if ("deletedAt" in upload.params) {
        writeBatch.putTombstone(upload.params as RemoteAssetTombstoneParams);
      } else {
        writeBatch.putAsset(upload.params as RemoteAssetPutParams);
      }
    }
    if (uploads.length > 0) {
      await writeBatch.commit();
    } else {
      await writeBatch.discard();
    }
    for (const apply of stagedDeletions) {
      await apply();
    }
    for (const [assetKey, contentHash] of stagedTouches) {
      await session.localState.setLastSyncedHash(assetKey, contentHash);
    }
    // AI-CORRECTION 2026-08-13: 与引擎一致，终局推进 markApplied（含 collection ETag），
    // 使后续同步的远端无变化快路径可用。
    if (result.remoteStateIncomplete !== true) {
      await session.markApplied({
        collection: adapter.collection,
        assetIds: result.changedAssetIds,
        scopeComplete: true,
        collectionRevision: result.collectionRevision ?? null,
        collectionEtag: uploads.length > 0
          ? null
          : result.collectionEtag ?? undefined,
      });
    }
  };

  return {
    session,
    transaction,
    outcome: { result, items, finalize },
  };
}

async function syncAdapter(
  adapter: SyncAdapter,
  client: MemoryStorageClient,
  scope?: SyncAdapterScope,
): Promise<SyncAdapterResult> {
  const run = await createAdapterRun(adapter, client, scope);
  // AI-CORRECTION 2026-08-13: 与引擎的无弹框纯上传流程一致——
  // upload 条目按“用我的”登记上传；download 已落地；conflict 保留不自动决议。
  for (const item of run.outcome.items) {
    if (item.kind === "upload") {
      await item.applyUpload();
    }
  }
  await run.outcome.finalize();

  return run.outcome.result;
}

describe("sync-adapters", () => {
  afterEach(() => {
    localStorage.clear();
  });

  it("clears local sync metadata after deleting the remote root", async () => {
    const client = new MemoryStorageClient();
    const remote = createWebDavSyncRemote({ client });
    localStorage.setItem("v3-sync-provider", "webdav");
    localStorage.setItem("v3-sync-metadata", JSON.stringify({
      contentHashes: { "blueprints:item-a": "hash-a" },
      remoteRevisions: {},
      remoteEtags: {},
    }));

    await remote.resetRemote?.();

    expect(localStorage.getItem("v3-sync-metadata")).toBeNull();
    remote.dispose?.();
  });

  it("does not advance WebDAV collection metadata for an incomplete scope", async () => {
    const client = new MemoryStorageClient();
    const adapter = createFullNoRevisionAdapter({
      id: "planner",
      remotePath: "assets/planner-state.json",
      readLocal: async () => null,
      writeLocal: async () => undefined,
    });
    const session = await createSession(client, [adapter]);
    await session.localState.setRemoteRevision(adapter.collection.stateKey, 3);
    await session.localState.setRemoteEtag(adapter.collection.stateKey, "etag-3");

    await session.markApplied({
      collection: adapter.collection,
      assetIds: ["single"],
      scopeComplete: false,
      collectionRevision: 4,
      collectionEtag: "etag-4",
    });

    await expect(session.localState.getRemoteRevision(adapter.collection.stateKey))
      .resolves.toBe(3);
    await expect(session.localState.getRemoteEtag(adapter.collection.stateKey))
      .resolves.toBe("etag-3");
    session.dispose?.();
  });

  it("uploads and downloads a full-no-revision value", async () => {
    const client = new MemoryStorageClient();
    let localValue: { count: number } | null = { count: 1 };
    const adapter = createFullNoRevisionAdapter({
      id: "planner",
      remotePath: "assets/planner-state.json",
      readLocal: async () => localValue,
      writeLocal: async (value) => {
        localValue = value;
      },
    });

    await expect(syncAdapter(adapter, client)).resolves.toMatchObject({ status: "uploaded" });
    expect(JSON.parse(client.files.get("assets/planner-state.json") ?? "null")).toEqual({ count: 1 });
    expect(client.madeDirectories).toContain("assets");

    localValue = { count: 1 };
    client.files.set("assets/planner-state.json", JSON.stringify({ count: 2 }));
    await expect(syncAdapter(adapter, client)).resolves.toMatchObject({ status: "downloaded" });
    expect(localValue).toEqual({ count: 2 });
  });

  it("fails closed instead of overwriting malformed remote JSON", async () => {
    const client = new MemoryStorageClient();
    client.files.set("assets/malformed.json", "{not-json");
    const adapter = createFullNoRevisionAdapter({
      id: "malformed-remote",
      remotePath: "assets/malformed.json",
      readLocal: async () => ({ count: 1 }),
      writeLocal: async () => undefined,
    });

    await expect(syncAdapter(adapter, client)).rejects.toThrow("contains invalid JSON");
    expect(client.files.get("assets/malformed.json")).toBe("{not-json");
  });

  it("uses the local value to overwrite the remote value after a conflict", async () => {
    const client = new MemoryStorageClient();
    let localValue: { count: number } | null = { count: 1 };
    const adapter = createFullNoRevisionAdapter({
      id: "conflict-use-local",
      remotePath: "assets/conflict-use-local.json",
      readLocal: async () => localValue,
      writeLocal: async (value) => {
        localValue = value;
      },
    });

    await expect(syncAdapter(adapter, client)).resolves.toMatchObject({ status: "uploaded" });
    localValue = { count: 2 };
    client.files.set("assets/conflict-use-local.json", JSON.stringify({ count: 3 }));

    // AI-CORRECTION 2026-08-13: 冲突登记为 SyncPlanItem，由引擎按决议执行。
    const run = await createAdapterRun(adapter, client);
    expect(run.outcome.items).toHaveLength(1);
    expect(run.outcome.items[0]).toMatchObject({ kind: "conflict" });
    await run.outcome.items[0]!.applyUpload();
    await run.outcome.finalize();
    expect(localValue).toEqual({ count: 2 });
    expect(JSON.parse(client.files.get("assets/conflict-use-local.json") ?? "null"))
      .toEqual({ count: 2 });
  });

  it("uses the remote value to discard the local value after a conflict", async () => {
    const client = new MemoryStorageClient();
    let localValue: { count: number } | null = { count: 1 };
    const adapter = createFullNoRevisionAdapter({
      id: "conflict-use-remote",
      remotePath: "assets/conflict-use-remote.json",
      readLocal: async () => localValue,
      writeLocal: async (value) => {
        localValue = value;
      },
    });

    await expect(syncAdapter(adapter, client)).resolves.toMatchObject({ status: "uploaded" });
    localValue = { count: 2 };
    client.files.set("assets/conflict-use-remote.json", JSON.stringify({ count: 3 }));

    // AI-CORRECTION 2026-08-13: 冲突登记为 SyncPlanItem，由引擎按决议执行。
    const run = await createAdapterRun(adapter, client);
    expect(run.outcome.items).toHaveLength(1);
    expect(run.outcome.items[0]).toMatchObject({ kind: "conflict" });
    await run.outcome.items[0]!.applyDownload();
    await run.outcome.finalize();
    expect(localValue).toEqual({ count: 3 });
    expect(JSON.parse(client.files.get("assets/conflict-use-remote.json") ?? "null"))
      .toEqual({ count: 3 });
  });

  it("syncs a full-with-revision collection through index.json", async () => {
    const client = new MemoryStorageClient();
    let entries = [{ id: "blueprint-a", value: { name: "A" }, deletedAt: null as string | null }];
    const adapter = createFullWithRevisionAdapter({
      id: "blueprints",
      indexPath: "assets/blueprints/index.json",
      entryPath: (id) => `assets/blueprints/${id}.json`,
      listLocal: async () => entries,
      writeLocal: async (entry) => {
        entries = [...entries.filter((candidate) => candidate.id !== entry.id), entry];
      },
    });

    await expect(syncAdapter(adapter, client)).resolves.toMatchObject({ status: "uploaded" });
    expect(client.madeDirectories).toContain("assets/blueprints");
    const index = JSON.parse(client.files.get("assets/blueprints/index.json") ?? "null") as {
      readonly revision: number;
      readonly entries: Record<string, {
        readonly deletedAt: string | null;
        readonly committedAt: string | null;
      }>;
    };
    expect(index.revision).toBe(1);
    expect(index.entries["blueprint-a"]?.deletedAt).toBeNull();
    expect(index.entries["blueprint-a"]?.committedAt).not.toBeNull();
    expect(client.files.has(
      "assets/blueprints/index-revisions/rev-000000000001.json",
    )).toBe(true);

    client.files.set("assets/blueprints/blueprint-b.json", JSON.stringify({ name: "B" }));
    client.files.set("assets/blueprints/index.json", JSON.stringify({
      revision: 2,
      entries: {
        ...index.entries,
        "blueprint-b": { contentHash: "remote-hash", deletedAt: null },
      },
    }));

    await expect(syncAdapter(adapter, client)).resolves.toMatchObject({ status: "downloaded" });
    expect(entries.find((entry) => entry.id === "blueprint-b")?.value).toEqual({ name: "B" });
  });

  it("rewrites a normalized legacy full-with-revision value with the current schema", async () => {
    type VersionedValue = {
      readonly schemaVersion?: number;
      readonly name: string;
    };
    const client = new MemoryStorageClient();
    const seedAdapter = createFullWithRevisionAdapter<VersionedValue>({
      id: "versioned-modules",
      indexPath: "assets/versioned-modules/index.json",
      entryPath: (id) => `assets/versioned-modules/${id}.json`,
      listLocal: async () => [{
        id: "module-a",
        value: { schemaVersion: 1, name: "A" },
        deletedAt: null,
      }],
      writeLocal: async () => undefined,
    });
    await expect(syncAdapter(seedAdapter, client)).resolves.toMatchObject({
      status: "uploaded",
    });
    localStorage.clear();

    const adapter = createFullWithRevisionAdapter<VersionedValue>({
      id: "versioned-modules",
      indexPath: "assets/versioned-modules/index.json",
      entryPath: (id) => `assets/versioned-modules/${id}.json`,
      listLocal: async () => [{
        id: "module-a",
        value: { schemaVersion: 2, name: "A" },
        deletedAt: null,
      }],
      writeLocal: async () => undefined,
      normalizeRemote: (value) => {
        if (
          typeof value !== "object"
          || value === null
          || typeof (value as { name?: unknown }).name !== "string"
        ) {
          return null;
        }
        return {
          schemaVersion: 2,
          name: (value as { name: string }).name,
        };
      },
    });

    await expect(syncAdapter(adapter, client)).resolves.toMatchObject({
      status: "uploaded",
    });
    expect(JSON.parse(
      client.files.get("assets/versioned-modules/module-a.json") ?? "null",
    )).toEqual({ schemaVersion: 2, name: "A" });
  });

  it("skips a future full-with-revision value without writing or advancing metadata", async () => {
    type VersionedValue = {
      readonly schemaVersion: number;
      readonly name: string;
    };
    const client = new MemoryStorageClient();
    const seedAdapter = createFullWithRevisionAdapter<VersionedValue>({
      id: "future-modules",
      indexPath: "assets/future-modules/index.json",
      entryPath: (id) => `assets/future-modules/${id}.json`,
      listLocal: async () => [{
        id: "module-a",
        value: { schemaVersion: 3, name: "Future" },
        deletedAt: null,
      }],
      writeLocal: async () => undefined,
    });
    await syncAdapter(seedAdapter, client);
    localStorage.clear();

    const writeLocal = vi.fn();
    const adapter = createFullWithRevisionAdapter<VersionedValue>({
      id: "future-modules",
      indexPath: "assets/future-modules/index.json",
      entryPath: (id) => `assets/future-modules/${id}.json`,
      listLocal: async () => [{
        id: "module-a",
        value: { schemaVersion: 2, name: "Current" },
        deletedAt: null,
      }],
      writeLocal,
      isRemoteVersionUnsupported: (value) => (
        typeof value === "object"
        && value !== null
        && (value as { schemaVersion?: unknown }).schemaVersion === 3
      ),
      normalizeRemote: (value) => (
        typeof value === "object"
        && value !== null
        && (value as { schemaVersion?: unknown }).schemaVersion === 2
        && typeof (value as { name?: unknown }).name === "string"
          ? value as VersionedValue
          : null
      ),
    });

    const run = await createAdapterRun(adapter, client);

    expect(run.outcome.result).toMatchObject({
      status: "skipped",
      changedAssetIds: [],
      remoteStateIncomplete: true,
    });
    expect(run.outcome.items).toHaveLength(0);
    expect(writeLocal).not.toHaveBeenCalled();
    expect(run.outcome.result).not.toHaveProperty("collectionRevision");
    const revisionBeforeFinalize = await run.session.localState.getRemoteRevision(
      adapter.collection.stateKey,
    );
    await run.outcome.finalize();
    await expect(run.session.localState.getLastSyncedHash(
      "future-modules:module-a",
    )).resolves.toBeNull();
    await expect(run.session.localState.getRemoteRevision(
      adapter.collection.stateKey,
    )).resolves.toBe(revisionBeforeFinalize);
    expect(JSON.parse(
      client.files.get("assets/future-modules/module-a.json") ?? "null",
    )).toEqual({ schemaVersion: 3, name: "Future" });
  });

  it("reuses persisted touch hashes for clean collection assets", async () => {
    const cleanValue = { name: "clean" };
    const dirtyValue = { name: "dirty" };
    const cleanHash = createStableJsonHash(cleanValue);
    const dirtyHash = createStableJsonHash(dirtyValue);
    const adapter = createFullWithRevisionAdapter({
      id: "dirty-hash-scan",
      indexPath: "assets/dirty-hash-scan/index.json",
      entryPath: (id) => `assets/dirty-hash-scan/${id}.json`,
      listLocal: async () => [
        { id: "clean", value: cleanValue, deletedAt: null },
        { id: "dirty", value: dirtyValue, deletedAt: null },
      ],
      writeLocal: async () => undefined,
    });
    const computeContentHashes = vi.fn<SyncRemoteSession["computeContentHashes"]>(
      async (requests) => requests.map((request) => createStableJsonHash(request.value)),
    );
    const readAsset = vi.fn<SyncRemoteSession["readAsset"]>(async () => null);
    const session: SyncRemoteSession = {
      localState: {
        getLastSyncedHash: async (assetKey) =>
          assetKey.endsWith(":clean") ? cleanHash : dirtyHash,
        setLastSyncedHash: async () => undefined,
        getRemoteRevision: async () => null,
        setRemoteRevision: async () => undefined,
        getRemoteEtag: async () => null,
        setRemoteEtag: async () => undefined,
      },
      computeContentHashes,
      prefetchIndexes: async () => undefined,
      readIndex: async () => ({
        revision: 1,
        entries: {
          clean: {
            revision: 1,
            contentHash: cleanHash,
            deletedAt: null,
            committedAt: null,
          },
          dirty: {
            revision: 1,
            contentHash: dirtyHash,
            deletedAt: null,
            committedAt: null,
          },
        },
        committedAt: null,
      }),
      readAsset,
      checkCollections: async () => ({ changedCollections: [] }),
      beginWriteBatch: () => ({
        putAsset: () => undefined,
        putTombstone: () => undefined,
        commit: async () => ({ writes: [] }),
        discard: async () => undefined,
      }),
      markApplied: async () => undefined,
    };
    const transaction: SyncEngineTransaction = {
      writeBatch: session.beginWriteBatch(),
      stageTouch: () => undefined,
      stageDeletion: () => undefined,
      recordItem: () => undefined,
      recordUpload: () => undefined,
      assertDownloadAllowed: async () => undefined,
      getLocalChangeState: (_adapterId, assetId) =>
        assetId === "dirty" ? "dirty" : "clean",
    };

    await expect(adapter.sync(session, { transaction }))
      .resolves.toMatchObject({ status: "idle" });

    expect(computeContentHashes).toHaveBeenCalledTimes(1);
    expect(computeContentHashes).toHaveBeenCalledWith([{
      algorithm: adapter.collection.hashAlgorithm,
      value: dirtyValue,
    }]);
    expect(readAsset).not.toHaveBeenCalled();
  });

  it("does not advance lastSyncedHash when a collection batch fails", async () => {
    const setLastSyncedHash = vi.fn(async () => undefined);
    const collection = createFullWithRevisionAdapter({
      id: "transactional-baseline",
      indexPath: "assets/transactional/index.json",
      entryPath: (id) => `assets/transactional/${id}.json`,
      listLocal: async () => [{ id: "item-a", value: { count: 1 }, deletedAt: null }],
      writeLocal: async () => undefined,
    });
    const session: SyncRemoteSession = {
      localState: {
        getLastSyncedHash: async () => null,
        setLastSyncedHash,
        getRemoteRevision: async () => null,
        setRemoteRevision: async () => undefined,
        getRemoteEtag: async () => null,
        setRemoteEtag: async () => undefined,
      },
      computeContentHashes: async (requests) => requests.map((request) =>
        createStableJsonHash(request.value)
      ),
      prefetchIndexes: async () => undefined,
      readIndex: async () => ({ revision: 0, entries: {}, committedAt: null }),
      readAsset: async () => null,
      checkCollections: async () => ({ changedCollections: [] }),
      beginWriteBatch: () => ({
        putAsset: () => undefined,
        putTombstone: () => undefined,
        commit: async () => { throw new Error("commit failed"); },
        discard: async () => undefined,
      }),
      markApplied: async () => undefined,
    };

    // AI-CORRECTION 2026-08-13: 上传 commit 由引擎统一执行（先下载、后上传、单次 commit）；
    // 这里用同一 session 的事务模拟引擎终局，验证 commit 失败时 touch 不落盘。
    const transaction: SyncEngineTransaction = {
      writeBatch: session.beginWriteBatch(),
      stageTouch: () => undefined,
      stageDeletion: () => undefined,
      recordItem: () => undefined,
      recordUpload: () => undefined,
      assertDownloadAllowed: async () => undefined,
    };
    const result = await collection.sync(session, { transaction });
    expect(result.status).toBe("uploaded");

    const commit = session.beginWriteBatch();
    await expect(commit.commit()).rejects.toThrow("commit failed");
    expect(setLastSyncedHash).not.toHaveBeenCalled();
  });

  it("uses the protocol hash instead of the comparison hash as the write base", async () => {
    const remoteValue = { count: 1 };
    const remoteComparisonHash = createStableJsonHash(remoteValue);
    const protocolHash = "sha256:server-authoritative";
    let capturedBaseContentHash: string | null | undefined;
    const adapter = createFullWithRevisionAdapter({
      id: "dual-hash-baseline",
      indexPath: "assets/dual-hash/index.json",
      entryPath: (id) => `assets/dual-hash/${id}.json`,
      listLocal: async () => [{ id: "item-a", value: { count: 2 }, deletedAt: null }],
      writeLocal: async () => undefined,
    });
    const session: SyncRemoteSession = {
      localState: {
        getLastSyncedHash: async () => remoteComparisonHash,
        setLastSyncedHash: async () => undefined,
        getRemoteRevision: async () => null,
        setRemoteRevision: async () => undefined,
        getRemoteEtag: async () => null,
        setRemoteEtag: async () => undefined,
      },
      computeContentHashes: async (requests) => requests.map((request) =>
        createStableJsonHash(request.value)
      ),
      prefetchIndexes: async () => undefined,
      readIndex: async () => ({
        revision: 1,
        entries: {
          "item-a": {
            revision: 1,
            contentHash: remoteComparisonHash,
            protocolContentHash: protocolHash,
            deletedAt: null,
            committedAt: null,
          },
        },
        committedAt: null,
      }),
      readAsset: async () => ({
        revision: 1,
        value: remoteValue,
        contentHash: protocolHash,
        committedAt: null,
      }),
      checkCollections: async () => ({ changedCollections: [adapter.id] }),
      beginWriteBatch: () => ({
        putAsset: (params) => {
          capturedBaseContentHash = params.baseContentHash;
        },
        putTombstone: () => undefined,
        commit: async () => ({ writes: [] }),
        discard: async () => undefined,
      }),
      markApplied: async () => undefined,
    };

    // AI-CORRECTION 2026-08-13: 上传登记由引擎通过 SyncPlanItem.applyUpload →
    // transaction.recordUpload 写入共享批次；这里模拟引擎的纯上传决议。
    const writeBatch = session.beginWriteBatch();
    let recordedItem: SyncPlanItem | undefined;
    await expect(adapter.sync(session, {
      transaction: {
        writeBatch,
        stageTouch: () => undefined,
        stageDeletion: () => undefined,
        recordItem: (item) => {
          recordedItem = item;
        },
        recordUpload: (upload) => {
          if (!("deletedAt" in upload.params)) {
            writeBatch.putAsset(upload.params);
          }
        },
        assertDownloadAllowed: async () => undefined,
      },
    })).resolves.toMatchObject({ status: "uploaded" });
    expect(recordedItem).toBeDefined();
    await recordedItem!.applyUpload();
    expect(capturedBaseContentHash).toBe(protocolHash);
  });

  it("classifies collection conflicts as plan items without mutating either side", async () => {
    const client = new MemoryStorageClient();
    let entries = [{
      id: "blueprint-a",
      value: { name: "initial" },
      deletedAt: null as string | null,
    }];
    const writeLocal = vi.fn(async (
      entry: (typeof entries)[number],
    ) => {
      entries = [entry];
    });
    const adapter = createFullWithRevisionAdapter({
      id: "blueprints",
      indexPath: "assets/blueprints/index.json",
      entryPath: (id) => `assets/blueprints/${id}.json`,
      listLocal: async () => entries,
      writeLocal,
    });
    await syncAdapter(adapter, client);
    writeLocal.mockClear();

    entries = [{
      id: "blueprint-a",
      value: { name: "local edit" },
      deletedAt: null,
    }];
    const remoteValue = { name: "remote edit" };
    const remoteHash = createStableJsonHash(remoteValue);
    const remoteUpdatedAt = "2026-07-29T12:34:56.000Z";
    client.files.set(
      "assets/blueprints/blueprint-a.json",
      JSON.stringify(remoteValue),
    );
    client.files.set("assets/blueprints/index.json", JSON.stringify({
      revision: 2,
      entries: {
        "blueprint-a": {
          contentHash: remoteHash,
          deletedAt: null,
          committedAt: remoteUpdatedAt,
        },
      },
    }));
    const filesBeforeInspection = new Map(client.files);

    // AI-CORRECTION 2026-08-13: 冲突不再由 inspectConflicts 事后探测，
    // 而是同步时登记为 SyncPlanItem（kind="conflict"），由引擎弹框决议。
    const run = await createAdapterRun(adapter, client, {
      includeAssetIds: ["blueprint-a"],
    });

    expect(run.outcome.items).toHaveLength(1);
    expect(run.outcome.items[0]).toMatchObject({
      adapterId: "blueprints",
      assetId: "blueprint-a",
      kind: "conflict",
      remoteHash,
      remoteUpdatedAt,
    });
    expect(writeLocal).not.toHaveBeenCalled();
    expect(entries[0]?.value).toEqual({ name: "local edit" });
    expect(client.files).toEqual(filesBeforeInspection);

    // 引擎按“用远端”决议执行下载后落地本地。
    const item = run.outcome.items[0];
    expect(item).toBeDefined();
    await item!.applyDownload();
    await run.outcome.finalize();
    expect(entries[0]?.value).toEqual(remoteValue);
  });

  it("stores patch-with-revision snapshots as full plus deltas", async () => {
    const client = new MemoryStorageClient();
    let localValue: { entities: Record<string, { x: number }> } | null = { entities: { a: { x: 1 } } };
    const adapter = createPatchWithRevisionAdapter({
      id: "document:main",
      directoryPath: "documents/main",
      readLocal: async () => localValue,
      writeLocal: async (value) => {
        localValue = value;
      },
      deltaThreshold: 5,
    });

    await expect(syncAdapter(adapter, client)).resolves.toMatchObject({ status: "uploaded" });
    expect(client.files.has("documents/main/meta.json")).toBe(true);
    expect(client.files.has(
      "documents/main/meta-revisions/rev-000000000001.json",
    )).toBe(true);

    localValue = { entities: { a: { x: 2 } } };
    await expect(syncAdapter(adapter, client)).resolves.toMatchObject({ status: "uploaded" });

    const meta = JSON.parse(client.files.get("documents/main/meta.json") ?? "null") as {
      readonly revision: number;
      readonly deltaChain: readonly string[];
    };
    expect(meta.revision).toBe(2);
    expect(meta.deltaChain).toHaveLength(1);
    expect(client.files.has(
      "documents/main/meta-revisions/rev-000000000002.json",
    )).toBe(true);
  });

  it("syncs a patch-with-revision collection through index.json", async () => {
    const client = new MemoryStorageClient();
    let entries = [{ id: "canvas-a", value: { stages: [{ id: "stage-a", count: 1 }] }, deletedAt: null as string | null }];
    const adapter = createPatchCollectionWithRevisionAdapter({
      id: "module-canvases",
      indexPath: "assets/module-canvases/index.json",
      directoryPath: (id) => `assets/module-canvases/${id}`,
      listLocal: async () => entries,
      writeLocal: async (entry) => {
        entries = [...entries.filter((candidate) => candidate.id !== entry.id), entry];
      },
      deltaThreshold: 5,
    });

    await expect(syncAdapter(adapter, client)).resolves.toMatchObject({ status: "uploaded" });
    expect(client.files.has("assets/module-canvases/canvas-a/meta.json")).toBe(true);
    const index = JSON.parse(client.files.get("assets/module-canvases/index.json") ?? "null") as {
      readonly revision: number;
      readonly entries: Record<string, { readonly deletedAt: string | null }>;
    };
    expect(index.revision).toBe(1);
    expect(index.entries["canvas-a"]?.deletedAt).toBeNull();
    expect(client.files.has(
      "assets/module-canvases/index-revisions/rev-000000000001.json",
    )).toBe(true);

    client.readPaths.length = 0;
    await expect(syncAdapter(adapter, client)).resolves.toMatchObject({ status: "idle" });
    expect(client.readPaths).toContain("assets/module-canvases/index.json");
    // AI-REMOVED 2026-07-29:
    // Reason: 未变化同步不再探测不存在的 next revision，测试应验证没有这次额外 GET。
    // Trigger: 真实 OwnCloud 相同画布检查被 404 revision 请求增加尾延迟。
    // Evidence: canonical index 自带 revision，成功同步后已经是完整权威快照。
    // Replacement: 下方 not.toContain 断言。
    // Risk: Low。
    // Human Review: Required
    //
    // Original code:
    // expect(client.readPaths).toContain(
    //   "assets/module-canvases/index-revisions/rev-000000000002.json",
    // );
    expect(client.readPaths).not.toContain(
      "assets/module-canvases/index-revisions/rev-000000000002.json",
    );
    expect(client.readPaths).not.toContain(
      "assets/module-canvases/index-revisions/rev-000000000001.json",
    );
    expect(client.readPaths.some((path) =>
      path.startsWith("assets/module-canvases/canvas-a/")
    )).toBe(false);

    entries = [{ id: "canvas-a", value: { stages: [{ id: "stage-a", count: 2 }] }, deletedAt: null }];
    await expect(syncAdapter(adapter, client)).resolves.toMatchObject({ status: "uploaded" });
    const meta = JSON.parse(client.files.get("assets/module-canvases/canvas-a/meta.json") ?? "null") as {
      readonly revision: number;
      readonly deltaChain: readonly string[];
    };
    expect(meta.revision).toBe(2);
    expect(meta.deltaChain).toHaveLength(1);
    expect(client.files.has(
      "assets/module-canvases/canvas-a/meta-revisions/rev-000000000002.json",
    )).toBe(true);
  });

  it("discards a local-only asset via applyDiscardLocal with two-phase deletion", async () => {
    // AI-CORRECTION 2026-08-14: 上传条目（本地有、远端没有）被决议为“用远端”时
    // 走 applyDiscardLocal：登记二段删除与 touch 清空；commit 成功后才真正删除本地。
    const client = new MemoryStorageClient();
    type DiscardEntry = {
      id: string;
      value: { stages: { id: string; count: number }[] };
      deletedAt: string | null;
    };
    let entries: DiscardEntry[] = [{
      id: "canvas-a",
      value: { stages: [{ id: "stage-a", count: 1 }] },
      deletedAt: null,
    }];
    const writeLocal = vi.fn(async (entry: DiscardEntry) => {
      entries = [
        ...entries.filter((candidate) => candidate.id !== entry.id),
        entry,
      ];
    });
    const adapter = createPatchCollectionWithRevisionAdapter({
      id: "module-canvases",
      indexPath: "assets/module-canvases/index.json",
      directoryPath: (id) => `assets/module-canvases/${id}`,
      listLocal: async () => entries,
      writeLocal,
      deltaThreshold: 5,
    });

    const run = await createAdapterRun(adapter, client);
    const uploadItem = run.outcome.items.find((item) => item.kind === "upload");
    expect(uploadItem).toBeDefined();
    const setLastSyncedHash = vi.spyOn(
      run.session.localState,
      "setLastSyncedHash",
    );

    await uploadItem!.applyDiscardLocal();

    // 二段式：决议阶段只登记删除与 touch，本地与同步状态均未落盘。
    expect(writeLocal).not.toHaveBeenCalled();
    expect(setLastSyncedHash).not.toHaveBeenCalled();

    await run.outcome.finalize();

    // commit 成功后执行删除落地（deletedAt 墓碑）与 touch 清空。
    expect(writeLocal).toHaveBeenCalledTimes(1);
    expect(writeLocal.mock.calls[0]?.[0]).toMatchObject({
      id: "canvas-a",
      deletedAt: expect.any(String) as unknown,
    });
    const clearedTouch = setLastSyncedHash.mock.calls.some(([assetKey, hash]) =>
      assetKey.includes("canvas-a") && hash === null
    );
    expect(clearedTouch).toBe(true);
  });

  it("does not read unchanged patch asset bodies during full plan classification", async () => {
    const client = new MemoryStorageClient();
    const originalReadTextFile = client.readTextFile.bind(client);
    client.readTextFile = vi.fn(async (relativePath: string) => {
      const file = await originalReadTextFile(relativePath);

      return file === null
        ? null
        : {
          ...file,
          etag: relativePath === "documents/index.json"
            ? "\"stable-index\""
            : file.etag,
        };
    });
    client.stat = vi.fn(async (relativePath: string) =>
      relativePath === "documents/index.json"
        ? {
          path: relativePath,
          basename: "index.json",
          type: "file" as const,
          etag: "\"stable-index\"",
          lastModified: "",
          size: client.files.get(relativePath)?.length ?? 0,
        }
        : null
    );
    const entries = [{
      id: "canvas-a",
      value: { entities: { a: { x: 1 } } },
      deletedAt: null,
    }];
    const adapter = createPatchCollectionWithRevisionAdapter({
      id: "world-documents",
      indexPath: "documents/index.json",
      directoryPath: (id) => `documents/${id}`,
      listLocal: async () => entries,
      writeLocal: vi.fn(async () => undefined),
    });

    await expect(syncAdapter(adapter, client)).resolves.toMatchObject({
      status: "uploaded",
    });
    await expect(syncAdapter(adapter, client)).resolves.toMatchObject({
      status: "idle",
    });
    const readCountAfterCacheWarmup = client.readPaths.length;

    await expect(syncAdapter(adapter, client)).resolves.toMatchObject({
      status: "idle",
    });

    // AI-REMOVED 2026-08-25:
    // Reason: adapter 级 WebDAV ETag 短路已被完整 plan 分类取代，是否 stat canonical index
    //   不再是公共同步引擎的行为契约。
    // Trigger: CF 每轮必须消费同一份完整 plan，WebDAV 本轮不作为兼容约束。
    // Evidence: 回归目标改为不读取未变化资产正文，避免把 provider 探测细节固化进 adapter 测试。
    // Replacement: 下方 readPaths 数量断言。
    // Risk: Low。
    // Human Review: Required
    //
    // Original code:
    // expect(client.stat).toHaveBeenCalledWith("documents/index.json");
    // AI-CORRECTION 2026-08-25: 完整 plan 分类需要读取一次 canonical index；
    // 回归约束是只读 index、不读取任何未变化资产正文。
    // AI-REMOVED 2026-08-25:
    // Reason: 完整分类会新增一次 index 读取，readPaths 总数不变不再成立。
    // Trigger: adapter 级 ETag 短路移除。
    // Evidence: 实际新增读取仅为 documents/index.json，没有 canvas 正文路径。
    // Replacement: 下方 newReadPaths 精确断言。
    // Risk: Low。
    // Human Review: Required
    //
    // Original code:
    // expect(client.readPaths).toHaveLength(readCountAfterCacheWarmup);
    const newReadPaths = client.readPaths.slice(readCountAfterCacheWarmup);
    expect(newReadPaths).toEqual(["documents/index.json"]);
  });

  it("repairs a legacy patch index after normalizing device-local fields", async () => {
    type Value = {
      readonly content: number;
      readonly viewportCenter: number;
    };
    const client = new MemoryStorageClient();
    let seedEntries = [{
      id: "canvas-a",
      value: { content: 1, viewportCenter: 12 },
      deletedAt: null as string | null,
    }];
    const seedAdapter = createPatchCollectionWithRevisionAdapter<Value>({
      id: "documents",
      indexPath: "documents/index.json",
      directoryPath: (id) => `documents/${id}`,
      listLocal: async () => seedEntries,
      writeLocal: async (entry) => {
        seedEntries = [entry];
      },
    });
    await expect(syncAdapter(seedAdapter, client)).resolves.toMatchObject({
      status: "uploaded",
    });
    localStorage.clear();

    let localEntries = [{
      id: "canvas-a",
      value: { content: 1, viewportCenter: 0 },
      deletedAt: null as string | null,
    }];
    const normalizedAdapter = createPatchCollectionWithRevisionAdapter<Value>({
      id: "documents",
      indexPath: "documents/index.json",
      directoryPath: (id) => `documents/${id}`,
      listLocal: async () => localEntries,
      writeLocal: async (entry) => {
        localEntries = [entry];
      },
      normalizeRemote: (value) => {
        if (
          typeof value !== "object"
          || value === null
          || typeof (value as { content?: unknown }).content !== "number"
        ) {
          return null;
        }

        return {
          content: (value as { content: number }).content,
          viewportCenter: 0,
        };
      },
    });

    await expect(syncAdapter(normalizedAdapter, client)).resolves.toMatchObject({
      status: "uploaded",
    });
    client.readPaths.length = 0;
    await expect(syncAdapter(normalizedAdapter, client)).resolves.toMatchObject({
      status: "idle",
    });
    expect(client.readPaths).toContain("documents/index.json");
    expect(client.readPaths.some((path) =>
      path.startsWith("documents/canvas-a/")
    )).toBe(false);
  });

  it("reports real patch collection protocol progress monotonically", async () => {
    const client = new MemoryStorageClient();
    const progress: number[] = [];
    const adapter = createPatchCollectionWithRevisionAdapter({
      id: "documents",
      indexPath: "documents/by-base/index.json",
      directoryPath: (baseId) => `documents/by-base/${baseId}`,
      listLocal: async () => [{
        id: "wuling_protocol_core",
        value: { count: 1 },
        deletedAt: null,
      }],
      writeLocal: async () => undefined,
    });

    await syncAdapter(adapter, client, {
      includeAssetIds: ["wuling_protocol_core"],
      onProgress: (value) => {
        progress.push(value);
      },
    });

    expect(progress[0]).toBe(0);
    expect(progress.at(-1)).toBe(100);
    expect(progress).toEqual([...progress].sort((left, right) => left - right));
    expect(progress).toContain(35);
    expect(progress).toContain(55);
    expect(progress).toContain(94);
  });

  it("lets a local full-collection edit restore a remotely deleted entry", async () => {
    const client = new MemoryStorageClient();
    let entries = [{
      id: "blueprint-a",
      value: { name: "initial" },
      deletedAt: null as string | null,
    }];
    const adapter = createFullWithRevisionAdapter({
      id: "blueprints",
      indexPath: "assets/blueprints/index.json",
      entryPath: (id) => `assets/blueprints/${id}.json`,
      listLocal: async () => entries,
      writeLocal: async (entry) => {
        entries = [entry];
      },
    });
    await syncAdapter(adapter, client);
    const initialIndex = JSON.parse(
      client.files.get("assets/blueprints/index.json") ?? "null",
    ) as {
      readonly entries: Record<string, {
        readonly contentHash: string;
        readonly deletedAt: string | null;
      }>;
    };
    entries = [{
      id: "blueprint-a",
      value: { name: "local edit" },
      deletedAt: null,
    }];
    client.files.set("assets/blueprints/index.json", JSON.stringify({
      revision: 2,
      entries: {
        "blueprint-a": {
          contentHash: initialIndex.entries["blueprint-a"]!.contentHash,
          deletedAt: "2026-07-29T11:00:00.000Z",
        },
      },
    }));

    // AI-CORRECTION 2026-08-13: 冲突登记为 SyncPlanItem，由引擎按决议执行；
    // adapter 不再消费 options.resolveConflict。
    const run = await createAdapterRun(adapter, client);
    expect(run.outcome.items).toHaveLength(1);
    expect(run.outcome.items[0]).toMatchObject({
      adapterId: "blueprints",
      assetId: "blueprint-a",
      kind: "conflict",
      remoteValue: null,
      remoteDeletedAt: "2026-07-29T11:00:00.000Z",
    });
    await run.outcome.items[0]!.applyUpload();
    await run.outcome.finalize();
    expect(JSON.parse(
      client.files.get("assets/blueprints/blueprint-a.json") ?? "null",
    )).toEqual({ name: "local edit" });
    const restoredIndex = JSON.parse(
      client.files.get("assets/blueprints/index.json") ?? "null",
    ) as {
      readonly entries: Record<string, {
        readonly deletedAt: string | null;
      }>;
    };
    expect(restoredIndex.entries["blueprint-a"]?.deletedAt).toBeNull();
  });

  it("lets a remote full-collection edit restore a locally deleted entry", async () => {
    const client = new MemoryStorageClient();
    let entries = [{
      id: "blueprint-a",
      value: { name: "initial" },
      deletedAt: null as string | null,
    }];
    const adapter = createFullWithRevisionAdapter({
      id: "blueprints",
      indexPath: "assets/blueprints/index.json",
      entryPath: (id) => `assets/blueprints/${id}.json`,
      listLocal: async () => entries,
      writeLocal: async (entry) => {
        entries = [entry];
      },
    });
    await syncAdapter(adapter, client);
    entries = [{
      id: "blueprint-a",
      value: { name: "initial" },
      deletedAt: "2026-07-29T11:01:00.000Z",
    }];
    const remoteValue = { name: "remote edit" };
    client.files.set(
      "assets/blueprints/blueprint-a.json",
      JSON.stringify(remoteValue),
    );
    client.files.set("assets/blueprints/index.json", JSON.stringify({
      revision: 2,
      entries: {
        "blueprint-a": {
          contentHash: createStableJsonHash(remoteValue),
          deletedAt: null,
        },
      },
    }));

    // AI-CORRECTION 2026-08-13: 冲突登记为 SyncPlanItem；“用远端”由引擎调 applyDownload。
    const run = await createAdapterRun(adapter, client);
    expect(run.outcome.items).toHaveLength(1);
    expect(run.outcome.items[0]).toMatchObject({
      kind: "conflict",
      remoteDeletedAt: null,
    });
    await run.outcome.items[0]!.applyDownload();
    await run.outcome.finalize();
    expect(entries).toEqual([{
      id: "blueprint-a",
      value: remoteValue,
      deletedAt: null,
    }]);
  });

  it("lets a remote tombstone discard a conflicting local patch edit", async () => {
    const client = new MemoryStorageClient();
    let entries = [{
      id: "canvas-a",
      value: { count: 1 },
      deletedAt: null as string | null,
    }];
    const adapter = createPatchCollectionWithRevisionAdapter({
      id: "module-canvases",
      indexPath: "assets/module-canvases/index.json",
      directoryPath: (id) => `assets/module-canvases/${id}`,
      listLocal: async () => entries,
      writeLocal: async (entry) => {
        entries = [entry];
      },
    });
    await syncAdapter(adapter, client);
    const initialHash = createStableJsonHash(entries[0]!.value);
    entries = [{
      id: "canvas-a",
      value: { count: 2 },
      deletedAt: null,
    }];
    client.files.set("assets/module-canvases/index.json", JSON.stringify({
      revision: 2,
      entries: {
        "canvas-a": {
          contentHash: initialHash,
          deletedAt: "2026-07-29T11:02:00.000Z",
        },
      },
    }));

    // AI-CORRECTION 2026-08-13: 冲突登记为 SyncPlanItem；“用远端”= 二段删除。
    const run = await createAdapterRun(adapter, client);
    expect(run.outcome.items).toHaveLength(1);
    expect(run.outcome.items[0]).toMatchObject({
      kind: "conflict",
      remoteValue: null,
      remoteDeletedAt: "2026-07-29T11:02:00.000Z",
    });
    await run.outcome.items[0]!.applyDownload();
    await run.outcome.finalize();
    expect(entries[0]).toMatchObject({
      value: { count: 2 },
      deletedAt: "2026-07-29T11:02:00.000Z",
    });
  });

  it("lets a local patch tombstone discard a conflicting remote edit", async () => {
    const client = new MemoryStorageClient();
    let entries = [{
      id: "canvas-a",
      value: { count: 1 },
      deletedAt: null as string | null,
    }];
    const adapter = createPatchCollectionWithRevisionAdapter({
      id: "module-canvases",
      indexPath: "assets/module-canvases/index.json",
      directoryPath: (id) => `assets/module-canvases/${id}`,
      listLocal: async () => entries,
      writeLocal: async (entry) => {
        entries = [entry];
      },
    });
    await syncAdapter(adapter, client);
    entries = [{
      id: "canvas-a",
      value: { count: 1 },
      deletedAt: "2026-07-29T11:03:00.000Z",
    }];
    const remoteValue = { count: 2 };
    const remoteHash = createStableJsonHash(remoteValue);
    client.files.set(
      `assets/module-canvases/canvas-a/full-${encodeURIComponent(remoteHash)}.json`,
      JSON.stringify(remoteValue),
    );
    client.files.set(
      "assets/module-canvases/canvas-a/meta.json",
      JSON.stringify({
        revision: 2,
        currentFullHash: remoteHash,
        deltaChain: [],
        deltaThreshold: 50,
      }),
    );
    client.files.set("assets/module-canvases/index.json", JSON.stringify({
      revision: 2,
      entries: {
        "canvas-a": {
          contentHash: remoteHash,
          deletedAt: null,
        },
      },
    }));

    // AI-CORRECTION 2026-08-13: 冲突登记为 SyncPlanItem；“用我的”= 墓碑上传。
    const run = await createAdapterRun(adapter, client);
    expect(run.outcome.items).toHaveLength(1);
    expect(run.outcome.items[0]).toMatchObject({ kind: "conflict" });
    await run.outcome.items[0]!.applyUpload();
    await run.outcome.finalize();
    const index = JSON.parse(
      client.files.get("assets/module-canvases/index.json") ?? "null",
    ) as {
      readonly entries: Record<string, {
        readonly deletedAt: string | null;
      }>;
    };
    expect(index.entries["canvas-a"]?.deletedAt)
      .toBe("2026-07-29T11:03:00.000Z");
  });
});
