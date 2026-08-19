// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from "vitest";

import { createStableJsonHash } from "@/shared/storage/hash-utils";

import {
  createFullWithRevisionAdapter,
  createPatchCollectionWithRevisionAdapter,
  createSyncRemoteCollection,
  createSyncService,
  RemoteDownloadStaleError,
  RemoteWriteConflictError,
} from "@/sync";
import type {
  SyncAdapter,
  SyncAdapterResult,
  SyncEngineTransaction,
  SyncPlanItem,
  SyncPlanUpload,
  SyncRemote,
  SyncRemoteSession,
  SyncService,
  SyncServiceOptions,
} from "@/sync";

// ============================================================================
// 先下载、后上传、单次 commit：引擎编排与 409 重启语义
// ============================================================================

function createTestRemote(options: {
  readonly onSession?: (session: SyncRemoteSession) => void;
  readonly dispose?: () => void;
} = {}): SyncRemote {
  const session: SyncRemoteSession = {
    localState: {
      getLastSyncedHash: async () => null,
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
    readIndex: async () => ({ revision: 0, entries: {}, committedAt: null }),
    readAsset: async () => null,
    checkCollections: async () => ({ changedCollections: [] }),
    beginWriteBatch: () => ({
      putAsset: () => undefined,
      putTombstone: () => undefined,
      commit: async () => ({ writes: [] }),
      discard: async () => undefined,
    }),
    markApplied: async () => undefined,
  };
  options.onSession?.(session);

  return {
    localState: session.localState,
    beginSession: async () => session,
    dispose: options.dispose,
  };
}

function createSettings(enabled = true) {
  return {
    enabled,
    url: "https://dav.example.test",
    username: "",
    password: "",
    maxConcurrentRequests: 4,
  };
}

function createPlanItemStub(
  adapterId: string,
  assetId: string,
  kind: SyncPlanItem["kind"],
  applyUpload = vi.fn(async () => undefined),
  applyDownload = vi.fn(async () => undefined),
  applyLocalRestore = vi.fn(async () => undefined),
  applyDiscardLocal = vi.fn(async () => undefined),
): SyncPlanItem & {
  readonly applyUpload: ReturnType<typeof vi.fn>;
  readonly applyDownload: ReturnType<typeof vi.fn>;
  readonly applyLocalRestore: ReturnType<typeof vi.fn>;
  readonly applyDiscardLocal: ReturnType<typeof vi.fn>;
} {
  return {
    adapterId,
    assetId,
    kind,
    localValue: { name: "local" },
    remoteValue: kind === "download" ? { name: "remote" } : null,
    localHash: "local-hash",
    remoteHash: kind === "upload" ? null : "remote-hash",
    remoteDeletedAt: null,
    remoteUpdatedAt: null,
    applyUpload,
    applyDownload,
    applyLocalRestore,
    applyDiscardLocal,
  };
}

function createStubAdapter(
  sync: SyncAdapter["sync"],
): SyncAdapter & { readonly sync: ReturnType<typeof vi.fn> } {
  return {
    id: "adapter",
    mode: "full-no-revision",
    collection: createSyncRemoteCollection({
      adapterId: "adapter",
      mode: "full-no-revision",
      stateKey: "adapter.json",
    }),
    checkPath: "adapter.json",
    sync: vi.fn(sync),
  };
}

function createUploadAdapter(
  id: string,
  events: string[],
): SyncAdapter & { readonly sync: ReturnType<typeof vi.fn> } {
  return {
    id,
    mode: "full-no-revision",
    collection: createSyncRemoteCollection({
      adapterId: id,
      mode: "full-no-revision",
      stateKey: `${id}.json`,
    }),
    checkPath: `${id}.json`,
    sync: vi.fn(async (
      _session: SyncRemoteSession,
      options: Parameters<SyncAdapter["sync"]>[1],
    ): Promise<SyncAdapterResult> => {
      events.push(`${id}.sync`);
      const item = createPlanItemStub(id, "single", "upload");
      item.applyUpload.mockImplementation(async () => {
        // 模拟真实 adapter 的 applyUpload：向引擎事务登记上传 mutation。
        options.transaction.recordUpload({
          adapterId: id,
          assetId: "single",
          params: {
            collection: createSyncRemoteCollection({
              adapterId: id,
              mode: "full-no-revision",
              stateKey: `${id}.json`,
            }),
            assetId: "single",
            value: { name: "local" },
            contentHash: "local-hash",
            baseRevision: null,
            baseContentHash: null,
          },
        });
      });
      options.transaction.recordItem(item);
      return {
        adapterId: id,
        mode: "full-no-revision",
        status: "uploaded",
        changedAssetIds: ["single"],
      };
    }),
  };
}

describe("sync-engine-download-first", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("runs every adapter before materializing uploads and commits once", async () => {
    const events: string[] = [];
    const putAsset = vi.fn(() => {
      events.push("putAsset");
    });
    const commit = vi.fn(async () => {
      events.push("commit");
      return { writes: [] };
    });
    const firstAdapter = createUploadAdapter("first", events);
    const secondAdapter = createUploadAdapter("second", events);
    const session: SyncRemoteSession = {
      localState: {
        getLastSyncedHash: async () => null,
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
      readIndex: async () => ({ revision: 0, entries: {}, committedAt: null }),
      readAsset: async () => null,
      checkCollections: async () => ({ changedCollections: [] }),
      beginWriteBatch: () => ({
        putAsset,
        putTombstone: () => undefined,
        commit,
        discard: async () => undefined,
      }),
      markApplied: async () => undefined,
    };
    const service = createSyncService({
      readSettings: () => createSettings(),
      createRemote: () => ({
        localState: session.localState,
        beginSession: async () => session,
      }),
      adapters: [firstAdapter, secondAdapter],
      retryDelaysMs: [],
    });

    const status = await service.syncNow("manual");

    expect(status.phase).toBe("idle");
    // 上传 mutation 在全部 adapter 结束后才写入共享批次，且只提交一次。
    expect(events).toEqual([
      "first.sync",
      "second.sync",
      "putAsset",
      "putAsset",
      "commit",
    ]);
  });

  it("commits uploads only after every adapter has finished downloading", async () => {
    const events: string[] = [];
    const putAsset = vi.fn(() => {
      events.push("putAsset");
    });
    const commit = vi.fn(async () => {
      events.push("commit");
      return { writes: [] };
    });
    const downloadItem = createPlanItemStub("downloader", "single", "download");
    const downloader: SyncAdapter = {
      id: "downloader",
      mode: "full-no-revision",
      collection: createSyncRemoteCollection({
        adapterId: "downloader",
        mode: "full-no-revision",
        stateKey: "downloader.json",
      }),
      checkPath: "downloader.json",
      sync: vi.fn(async (
        _session: SyncRemoteSession,
        options: Parameters<SyncAdapter["sync"]>[1],
      ): Promise<SyncAdapterResult> => {
        events.push("downloader.sync");
        options.transaction.recordItem(downloadItem);
        return {
          adapterId: "downloader",
          mode: "full-no-revision",
          status: "downloaded",
          changedAssetIds: ["single"],
        };
      }),
    };
    const session: SyncRemoteSession = {
      localState: {
        getLastSyncedHash: async () => null,
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
      readIndex: async () => ({ revision: 0, entries: {}, committedAt: null }),
      readAsset: async () => null,
      checkCollections: async () => ({ changedCollections: [] }),
      beginWriteBatch: () => ({
        putAsset,
        putTombstone: () => undefined,
        commit,
        discard: async () => undefined,
      }),
      markApplied: async () => undefined,
    };
    const service = createSyncService({
      readSettings: () => createSettings(),
      createRemote: () => ({
        localState: session.localState,
        beginSession: async () => session,
      }),
      adapters: [downloader],
      retryDelaysMs: [],
    });

    const status = await service.syncNow("manual");

    expect(status.phase).toBe("idle");
    expect(events).toEqual(["downloader.sync"]);
    expect(putAsset).not.toHaveBeenCalled();
    expect(commit).not.toHaveBeenCalled();
  });

  it("restarts the whole run from a fresh plan when a download goes stale", async () => {
    const downloadStale = new RemoteDownloadStaleError(
      "world-documents",
      "base-a",
      "download ticket expired",
    );
    const adapter = createStubAdapter(async () => ({
      adapterId: "adapter",
      mode: "full-no-revision",
      status: "downloaded",
      changedAssetIds: ["single"],
    }));
    adapter.sync.mockRejectedValueOnce(downloadStale);
    const createRemoteMock = vi.fn<SyncServiceOptions["createRemote"]>(
      () => createTestRemote(),
    );
    const service = createSyncService({
      readSettings: () => createSettings(),
      createRemote: createRemoteMock,
      adapters: [adapter],
    });

    const status = await service.syncNow("manual");

    expect(adapter.sync).toHaveBeenCalledTimes(2);
    expect(createRemoteMock).toHaveBeenCalledTimes(2);
    expect(status.phase).toBe("idle");
    expect(status.lastError).toBeNull();
    expect(status.lastDownloadAt).not.toBeNull();
  });

  it("gives up after repeated stale restarts instead of looping forever", async () => {
    const adapter = createStubAdapter(async () => ({
      adapterId: "adapter",
      mode: "full-no-revision",
      status: "idle",
      changedAssetIds: [],
    }));
    adapter.sync.mockRejectedValue(
      new RemoteWriteConflictError([{
        assetType: "planner-state",
        assetId: "single",
        reason: "revision-mismatch",
        expectedRevision: 1,
        actualRevision: 2,
        expectedHash: null,
        actualHash: null,
      }]),
    );
    const service = createSyncService({
      readSettings: () => createSettings(),
      createRemote: () => createTestRemote(),
      adapters: [adapter],
    });

    const status = await service.syncNow("manual");

    expect(status.phase).toBe("error");
    expect(status.lastError).toContain("Remote write conflict");
    // 1 + 5 次重启上限
    expect(adapter.sync).toHaveBeenCalledTimes(6);
  });
});

// ============================================================================
// Hash 口径 fallback：不得误判不等，回传分支必须跳过
// ============================================================================

describe("sync-engine-fallback-hash", () => {
  it("does not re-upload a patch collection when the index hash is protocol-fallback", async () => {
    const localValue = { content: 42 };
    const localHash = createStableJsonHash(localValue);
    const putAsset = vi.fn(() => undefined);
    let recordedUploads = 0;

    const adapter = createPatchCollectionWithRevisionAdapter<{
      readonly content: number;
    }>({
      id: "module-canvases",
      indexPath: "assets/module-canvases/index.json",
      directoryPath: (id) => `assets/module-canvases/${id}`,
      listLocal: async () => [{
        id: "canvas-a",
        value: localValue,
        deletedAt: null,
      }],
      writeLocal: async () => undefined,
    });

    const session: SyncRemoteSession = {
      localState: {
        getLastSyncedHash: async () => localHash,
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
        revision: 3,
        entries: {
          "canvas-a": {
            revision: 3,
            contentHash: "sha256:protocol-value-never-equal-to-fnv",
            protocolContentHash: "sha256:protocol-value-never-equal-to-fnv",
            // fallback 口径：未映射/未知 → 与本地口径比较不得得出“不等”结论
            contentHashCaliber: "protocol-fallback",
            deletedAt: null,
            committedAt: null,
          },
        },
        committedAt: null,
      }),
      readAsset: async () => ({
        revision: 3,
        value: localValue,
        contentHash: "sha256:protocol-value-never-equal-to-fnv",
        committedAt: null,
      }),
      checkCollections: async () => ({ changedCollections: [] }),
      beginWriteBatch: () => ({
        putAsset,
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
      recordUpload: () => {
        recordedUploads += 1;
      },
      assertDownloadAllowed: async () => undefined,
    };

    const result = await adapter.sync(session, { transaction });

    expect(result.status).toBe("idle");
    expect(result.changedAssetIds).toEqual([]);
    // 消除 echo upload：索引 hash 与归一化正文 hash 的“不等”比较在 fallback 口径下必须跳过。
    expect(recordedUploads).toBe(0);
    expect(putAsset).not.toHaveBeenCalled();
  });

  it("persists normalized patch content when the fallback index hides a schema migration", async () => {
    type Value = {
      readonly schemaVersion: 5;
      readonly content: number;
    };
    const protocolHash = "sha256:protocol-schema-4";
    const remoteValue = { schemaVersion: 4, content: 42 };
    const localValue: Value = { schemaVersion: 5, content: 42 };
    const recordedItems: SyncPlanItem[] = [];
    const recordedUploads: SyncPlanUpload[] = [];
    const adapter = createPatchCollectionWithRevisionAdapter<Value>({
      id: "world-documents",
      indexPath: "assets/world-documents/index.json",
      directoryPath: (id) => `assets/world-documents/${id}`,
      listLocal: async () => [{
        id: "canvas-a",
        value: localValue,
        deletedAt: null,
      }],
      writeLocal: async () => undefined,
      normalizeRemote: (value) => {
        if (
          typeof value !== "object"
          || value === null
          || typeof (value as { content?: unknown }).content !== "number"
        ) {
          return null;
        }
        return {
          schemaVersion: 5,
          content: (value as { content: number }).content,
        };
      },
    });
    const session: SyncRemoteSession = {
      localState: {
        getLastSyncedHash: async () => createStableJsonHash(remoteValue),
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
        revision: 3,
        entries: {
          "canvas-a": {
            revision: 3,
            contentHash: protocolHash,
            protocolContentHash: protocolHash,
            contentHashCaliber: "protocol-fallback",
            deletedAt: null,
            committedAt: null,
          },
        },
        committedAt: null,
      }),
      readAsset: async () => ({
        revision: 3,
        value: remoteValue,
        contentHash: protocolHash,
        committedAt: null,
      }),
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
      recordItem: (item) => {
        recordedItems.push(item);
      },
      recordUpload: (upload) => {
        recordedUploads.push(upload);
      },
      assertDownloadAllowed: async () => undefined,
    };

    const result = await adapter.sync(session, { transaction });

    expect(result).toMatchObject({
      status: "uploaded",
      changedAssetIds: ["canvas-a"],
    });
    expect(recordedItems).toHaveLength(1);
    expect(recordedItems[0]?.kind).toBe("upload");
    await recordedItems[0]?.applyUpload();
    expect(recordedUploads).toHaveLength(1);
    expect(recordedUploads[0]?.params).toMatchObject({
      value: localValue,
      baseRevision: 3,
      baseContentHash: protocolHash,
    });
  });
});

// ============================================================================
// 远端墓碑（CF plan 不含已删除资产）：二段删除 + 复活修复
// ============================================================================

describe("sync-engine-remote-tombstone", () => {
  it("downloads a remote tombstone via two-phase deletion after a synced asset disappears", async () => {
    const localValue = { name: "local" };
    const localHash = createStableJsonHash(localValue);
    const deletions: Array<() => Promise<void>> = [];
    let localEntries = [{
      id: "blueprint-a",
      value: localValue,
      deletedAt: null as string | null,
    }];
    const adapter = createFullWithRevisionAdapter({
      id: "blueprints",
      indexPath: "assets/blueprints/index.json",
      entryPath: (id) => `assets/blueprints/${id}.json`,
      listLocal: async () => localEntries,
      writeLocal: async (entry) => {
        localEntries = [entry];
      },
    });
    const session: SyncRemoteSession = {
      localState: {
        getLastSyncedHash: async () => localHash,
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
        revision: 4,
        entries: {},
        committedAt: "2026-08-13T10:00:00.000Z",
      }),
      readAsset: async () => null,
      checkCollections: async () => ({ changedCollections: [] }),
      beginWriteBatch: () => ({
        putAsset: () => undefined,
        putTombstone: () => undefined,
        commit: async () => ({ writes: [] }),
        discard: async () => undefined,
      }),
      markApplied: async () => undefined,
    };

    let recordedItem: SyncPlanItem | undefined;
    const transaction: SyncEngineTransaction = {
      writeBatch: session.beginWriteBatch(),
      stageTouch: () => undefined,
      stageDeletion: (_adapterId, _assetId, apply) => {
        deletions.push(apply);
      },
      recordItem: (item) => {
        recordedItem = item;
      },
      recordUpload: () => undefined,
      assertDownloadAllowed: async () => undefined,
    };

    const result = await adapter.sync(session, { transaction });

    // 曾同步过 + 远端消失 → 远端墓碑下载（而非上传复活）。
    expect(result.status).toBe("downloaded");
    expect(recordedItem).toBeDefined();
    expect(recordedItem).toMatchObject({
      kind: "download",
      remoteValue: null,
      remoteDeletedAt: expect.any(String),
    });
    // 二段删除：adapter 在分类阶段已调用 applyDownload，只暂存删除句柄、不落地。
    expect(deletions).toHaveLength(1);
    expect(localEntries[0]?.deletedAt).toBeNull();
    // commit 成功后才真正删除（引擎 finalize 调用暂存句柄）。
    for (const apply of deletions) {
      await apply();
    }
    expect(localEntries[0]?.deletedAt).toBe("2026-08-13T10:00:00.000Z");
  });

  it("classifies a never-synced local asset as a fresh upload", async () => {
    let recordedItem: SyncPlanItem | undefined;
    const adapter = createFullWithRevisionAdapter({
      id: "blueprints",
      indexPath: "assets/blueprints/index.json",
      entryPath: (id) => `assets/blueprints/${id}.json`,
      listLocal: async () => [{
        id: "blueprint-a",
        value: { name: "fresh" },
        deletedAt: null,
      }],
      writeLocal: async () => undefined,
    });
    const session: SyncRemoteSession = {
      localState: {
        getLastSyncedHash: async () => null,
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
      readIndex: async () => ({ revision: 0, entries: {}, committedAt: null }),
      readAsset: async () => null,
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
      recordItem: (item) => {
        recordedItem = item;
      },
      recordUpload: () => undefined,
      assertDownloadAllowed: async () => undefined,
    };

    const result = await adapter.sync(session, { transaction });

    expect(result.status).toBe("uploaded");
    expect(recordedItem).toMatchObject({
      kind: "upload",
      remoteDeletedAt: null,
    });
  });
});

// ============================================================================
// 脏标代际：上传容忍二代脏标；下载不容忍 → 中止、锁画布、重跑转冲突
// ============================================================================

describe("sync-engine-dirty-generations", () => {
  it("tolerates second-generation edits during upload and keeps the dirty flag", async () => {
    // eslint-disable-next-line prefer-const -- 适配器闭包在服务构造前引用，需先声明后赋值。
    let serviceUnderTest: SyncService;
    const adapter = createStubAdapter(async (
      _session: SyncRemoteSession,
      options: Parameters<SyncAdapter["sync"]>[1],
    ): Promise<SyncAdapterResult> => {
      options.transaction.recordItem(
        createPlanItemStub("adapter", "single", "upload"),
      );
      // 上传途中发生第二代编辑。
      serviceUnderTest.notifyLocalChange({ adapterId: "adapter" });
      return {
        adapterId: "adapter",
        mode: "full-no-revision",
        status: "uploaded",
        changedAssetIds: ["single"],
      };
    });
    serviceUnderTest = createSyncService({
      readSettings: () => createSettings(),
      createRemote: () => createTestRemote(),
      adapters: [adapter],
      retryDelaysMs: [],
    });
    serviceUnderTest.start();
    await vi.waitFor(() => {
      expect(serviceUnderTest.getStatus().phase).toBe("idle");
    });
    adapter.sync.mockClear();

    const status = await serviceUnderTest.syncNow("manual");

    expect(status.phase).toBe("idle");
    // 第二代脏标保留：pending 计数不减，等待下一轮重新上传。
    expect(serviceUnderTest.getStatus().pendingLocalChangeCount).toBe(1);
    expect(serviceUnderTest.getStatus().saveState).toBe("pending");
    serviceUnderTest.stop();
  });

  it("aborts, locks the canvas and re-runs into a conflict when a download is edited mid-sync", async () => {
    // eslint-disable-next-line prefer-const -- 适配器闭包在服务构造前引用，需先声明后赋值。
    let serviceUnderTest: SyncService;
    let pass = 0;
    const seenStatuses: Array<{ readonly canvasLocked: boolean }> = [];
    const adapter = createStubAdapter(async (
      _session: SyncRemoteSession,
      options: Parameters<SyncAdapter["sync"]>[1],
    ): Promise<SyncAdapterResult> => {
      pass += 1;
      if (pass === 1) {
        options.transaction.recordItem(
          createPlanItemStub("adapter", "single", "download"),
        );
        // 模拟真实 adapter：下载落地前检查二代脏标。
        serviceUnderTest.notifyLocalChange({
          adapterId: "adapter",
          assetId: "single",
        });
        await options.transaction.assertDownloadAllowed("adapter", "single");
        return {
          adapterId: "adapter",
          mode: "full-no-revision",
          status: "downloaded",
          changedAssetIds: ["single"],
        };
      }
      // 重跑：该资产“本地脏 + 远端变” → 转冲突。
      options.transaction.recordItem(
        createPlanItemStub("adapter", "single", "conflict"),
      );
      return {
        adapterId: "adapter",
        mode: "full-no-revision",
        status: "conflict",
        changedAssetIds: ["single"],
      };
    });
    const resolveConflicts = vi.fn(async () => []);
    serviceUnderTest = createSyncService({
      readSettings: () => createSettings(),
      createRemote: () => createTestRemote(),
      adapters: [adapter],
      retryDelaysMs: [],
      resolveConflicts,
      onStatusChange: (next) => {
        seenStatuses.push({ canvasLocked: next.canvasLocked });
      },
    });
    serviceUnderTest.start();
    await vi.waitFor(() => {
      expect(serviceUnderTest.getStatus().phase).toBe("error");
    });

    const status = serviceUnderTest.getStatus();

    // 第一轮被下载不容忍中止，整轮重跑后进入冲突弹框
    // （同步期间的本地编辑还会排队后续 pass，因此使用宽松计数）。
    expect(adapter.sync.mock.calls.length).toBeGreaterThanOrEqual(2);
    expect(resolveConflicts.mock.calls.length).toBeGreaterThanOrEqual(1);
    expect(seenStatuses.some((entry) => entry.canvasLocked)).toBe(true);
    expect(status.lastError).toBe("Sync conflict");
    serviceUnderTest.stop();
  });

  it("clears the dirty flag only when the frozen snapshot did not change", async () => {
    const adapter = createStubAdapter(async (
      _session: SyncRemoteSession,
      options: Parameters<SyncAdapter["sync"]>[1],
    ): Promise<SyncAdapterResult> => {
      options.transaction.recordItem(
        createPlanItemStub("adapter", "single", "upload"),
      );
      return {
        adapterId: "adapter",
        mode: "full-no-revision",
        status: "uploaded",
        changedAssetIds: ["single"],
      };
    });
    const serviceUnderTest = createSyncService({
      readSettings: () => createSettings(),
      createRemote: () => createTestRemote(),
      adapters: [adapter],
      retryDelaysMs: [],
    });

    serviceUnderTest.notifyLocalChange({ adapterId: "adapter" });
    const status = await serviceUnderTest.syncNow("manual");

    expect(status.phase).toBe("idle");
    expect(serviceUnderTest.getStatus().pendingLocalChangeCount).toBe(0);
    expect(serviceUnderTest.getStatus().saveState).toBe("idle");
  });
});
