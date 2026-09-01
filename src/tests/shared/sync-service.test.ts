// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from "vitest";

import { getLogLevel, setLogLevel } from "@/shared/logging/logger";
import { createStableJsonHash } from "@/shared/storage/hash-utils";

import {
  createSyncService,
  createSyncRemoteCollection,
  RemoteWriteConflictError,
} from "@/sync";
import type {
  SyncAdapter,
  SyncAdapterResult,
  SyncPlanItem,
  SyncRemote,
  SyncRemoteSession,
  SyncServiceOptions,
} from "@/sync";

function createTestRemote(options: {
  readonly dispose?: () => void;
  readonly refreshIndexes?: SyncRemoteSession["refreshIndexes"];
  readonly complete?: SyncRemoteSession["complete"];
  readonly markApplied?: SyncRemoteSession["markApplied"];
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
    markApplied: options.markApplied ?? (async () => undefined),
    ...(options.refreshIndexes === undefined
      ? {}
      : { refreshIndexes: options.refreshIndexes }),
    ...(options.complete === undefined ? {} : { complete: options.complete }),
  };

  return {
    localState: session.localState,
    beginSession: async () => session,
    dispose: options.dispose,
  };
}

const createRemote: SyncServiceOptions["createRemote"] = () => createTestRemote();

describe("sync-service", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("skips sync while disabled", async () => {
    const adapter = createAdapter();
    const service = createSyncService({
      readSettings: () => createSettings(false),
      createRemote,
      adapters: [adapter],
    });

    await service.syncNow("manual");

    expect(adapter.sync).not.toHaveBeenCalled();
    expect(service.getStatus().phase).toBe("idle");
  });

  it("runs adapters when enabled", async () => {
    const adapter = createAdapter();
    const service = createSyncService({
      readSettings: () => createSettings(),
      createRemote,
      adapters: [adapter],
    });

    const status = await service.syncNow("manual");

    expect(adapter.sync).toHaveBeenCalledTimes(1);
    expect(status.lastUploadAt).not.toBeNull();
  });

  it("does not enter downloading while an interval pass only classifies an unchanged plan", async () => {
    const observedPhases: string[] = [];
    const adapter = createAdapter();
    adapter.sync.mockResolvedValue({
      adapterId: "adapter",
      mode: "full-no-revision",
      status: "idle",
      changedAssetIds: [],
    });
    const service = createSyncService({
      readSettings: () => createSettings(),
      createRemote,
      adapters: [adapter],
      onStatusChange: (status) => {
        if (status.currentRunReason === "interval") {
          observedPhases.push(status.phase);
        }
      },
    });

    await service.syncNow("interval");

    expect(observedPhases).toContain("idle");
    expect(observedPhases).not.toContain("downloading");
  });

  it("enters downloading only when an adapter begins applying remote content", async () => {
    const observedPhases: string[] = [];
    const adapter = createNamedAdapter("adapter", []);
    adapter.sync.mockImplementation(async (_session, syncOptions) => {
      syncOptions.transaction.beginDownload?.();
      return {
        adapterId: "adapter",
        mode: "full-no-revision",
        status: "downloaded",
        changedAssetIds: ["single"],
      };
    });
    const service = createSyncService({
      readSettings: () => createSettings(),
      createRemote,
      adapters: [adapter],
      onStatusChange: (status) => {
        if (status.currentRunReason === "interval") {
          observedPhases.push(status.phase);
        }
      },
    });

    await service.syncNow("interval");

    expect(observedPhases).toContain("downloading");
  });

  it("fails fast and unlocks the canvas when initial network sync fails", async () => {
    const adapter = createAdapter();
    adapter.sync.mockRejectedValue(new Error("network timeout"));
    const createRemoteMock = vi.fn((
      ..._args: Parameters<SyncServiceOptions["createRemote"]>
    ) => createTestRemote());
    const service = createSyncService({
      readSettings: () => createSettings(),
      createRemote: createRemoteMock,
      adapters: [adapter],
    });

    const status = await service.syncNow("startup");

    expect(adapter.sync).toHaveBeenCalledTimes(1);
    expect(createRemoteMock).toHaveBeenCalledTimes(1);
    expect(createRemoteMock.mock.calls[0]?.[2]).toEqual({
      requestTimeoutMs: 8_000,
    });
    expect(status).toMatchObject({
      phase: "error",
      initialSyncStage: "ready",
      currentRunReason: null,
      lastError: "network timeout",
    });
  });

  it("unlocks initial sync stages in priority order before background documents", async () => {
    const calls: string[] = [];
    const stages: string[] = [];
    const adapters = [
      createNamedAdapter("world-documents", calls),
      createNamedAdapter("blueprints", calls),
      createNamedAdapter("modules", calls),
      createNamedAdapter("toolbox", calls),
    ];
    const service = createSyncService({
      readSettings: () => ({
        enabled: true,
        url: "https://dav.example.test",
        username: "",
        password: "",
        maxConcurrentRequests: 4,
      }),
      createRemote,
      adapters,
      createInitialSyncPlan: () => ({
        batches: [
          {
            stage: "canvas",
            requests: [{
              adapterId: "world-documents",
              scope: { includeAssetIds: ["current"] },
            }],
          },
          {
            stage: "blueprints",
            requests: [{ adapterId: "blueprints" }],
          },
          {
            stage: "modules",
            requests: [{ adapterId: "modules" }],
          },
          {
            stage: "toolbox",
            requests: [{ adapterId: "toolbox" }],
          },
        ],
        backgroundRequests: [{
          adapterId: "world-documents",
          scope: { excludeAssetIds: ["current"] },
        }],
      }),
      onStatusChange: (status) => {
        if (stages.at(-1) !== status.initialSyncStage) {
          stages.push(status.initialSyncStage);
        }
      },
    });

    const status = await service.syncNow("startup");

    expect(calls).toEqual([
      "world-documents:include=current",
      "blueprints:all",
      "modules:all",
      "toolbox:all",
      "world-documents:exclude=current",
    ]);
    expect(stages).toEqual([
      "canvas",
      "blueprints",
      "modules",
      "toolbox",
      "ready",
    ]);
    expect(status.initialSyncStage).toBe("ready");
    expect(status.currentRunReason).toBeNull();
    expect(Object.fromEntries(status.tasks.map((task) => [
      task.kind,
      task.phase,
    ]))).toMatchObject({
      canvas: "success",
      blueprints: "success",
      modules: "success",
      toolbox: "success",
      "background-documents": "success",
    });
  });

  it("marks complementary current and background scopes as complete collection coverage", async () => {
    const markApplied = vi.fn<SyncRemoteSession["markApplied"]>(async () => undefined);
    const adapter = createNamedAdapter("world-documents", []);
    const service = createSyncService({
      readSettings: () => createSettings(),
      createRemote: () => createTestRemote({ markApplied }),
      adapters: [adapter],
      createInitialSyncPlan: () => ({
        batches: [{
          stage: "canvas",
          requests: [{
            adapterId: "world-documents",
            scope: { includeAssetIds: ["current"] },
          }],
        }],
        backgroundRequests: [{
          adapterId: "world-documents",
          scope: { excludeAssetIds: ["current"] },
        }],
      }),
    });

    await service.syncNow("startup");

    expect(markApplied).toHaveBeenCalledTimes(2);
    expect(markApplied.mock.calls.map(([result]) => result.scopeComplete)).toEqual([
      true,
      true,
    ]);
  });

  it("does not advance collection or provider cursors after skipping a future schema", async () => {
    const markApplied = vi.fn<SyncRemoteSession["markApplied"]>(async () => undefined);
    const complete = vi.fn<NonNullable<SyncRemoteSession["complete"]>>(
      async () => undefined,
    );
    const adapter = createNamedAdapter("custom-modules", []);
    adapter.sync.mockResolvedValue({
      adapterId: "custom-modules",
      mode: "full-with-revision",
      status: "skipped",
      changedAssetIds: [],
      remoteStateIncomplete: true,
    });
    const service = createSyncService({
      readSettings: () => createSettings(),
      createRemote: () => createTestRemote({ markApplied, complete }),
      adapters: [adapter],
    });

    const status = await service.syncNow("manual");

    expect(status.phase).toBe("idle");
    expect(markApplied).not.toHaveBeenCalled();
    expect(complete).toHaveBeenCalledWith({ advanceAppliedRevision: false });
  });

  it("classifies every adapter on local change and marks the pass complete", async () => {
    vi.useFakeTimers();
    const markApplied = vi.fn<SyncRemoteSession["markApplied"]>(async () => undefined);
    const calls: string[] = [];
    const worldDocuments = createNamedAdapter("world-documents", calls);
    const blueprints = createNamedAdapter("blueprints", calls);
    const service = createSyncService({
      readSettings: () => createSettings(),
      createRemote: () => createTestRemote({ markApplied }),
      adapters: [worldDocuments, blueprints],
      intervalMs: 60_000,
    });

    service.start();
    await vi.waitFor(() => {
      expect(worldDocuments.sync).toHaveBeenCalledTimes(1);
      expect(blueprints.sync).toHaveBeenCalledTimes(1);
    });
    markApplied.mockClear();
    worldDocuments.sync.mockClear();
    blueprints.sync.mockClear();
    calls.length = 0;

    service.notifyLocalChange({
      adapterId: "world-documents",
      assetId: "current",
    });
    await vi.advanceTimersByTimeAsync(5_000);
    await vi.waitFor(() => {
      expect(worldDocuments.sync).toHaveBeenCalledTimes(1);
      expect(blueprints.sync).toHaveBeenCalledTimes(1);
    });

    expect(calls).toEqual([
      "world-documents:all",
      "blueprints:all",
    ]);
    expect(markApplied).toHaveBeenCalledTimes(2);
    expect(markApplied.mock.calls.map(([result]) => result.scopeComplete))
      .toEqual([true, true]);
    service.stop();
  });

  it("reports maintenance task progress separately from adapter tasks", async () => {
    const service = createSyncService({
      readSettings: () => createSettings(),
      createRemote,
      adapters: [createAdapter()],
      maintenanceTasks: [
        {
          kind: "directory-maintenance",
          run: vi.fn(async () => undefined),
        },
        // AI-REMOVED 2026-07-29:
        // Reason: 设备注册与枚举已退出同步维护任务。
        // Trigger: 用户确认设备列表没有业务意义。
        // Evidence: SyncTaskKind 不再包含 device-registration / remote-devices。
        // Replacement: directory-maintenance 是唯一维护任务。
        // Risk: Low。
        // Human Review: Required
        //
        // Original code:
        // { kind: "device-registration", run: vi.fn(async () => undefined) },
        // { kind: "remote-devices", run: vi.fn(async () => undefined) },
      ],
    });

    const status = await service.syncNow("startup");
    const taskPhases = Object.fromEntries(status.tasks.map((task) => [
      task.kind,
      task.phase,
    ]));

    expect(taskPhases).toMatchObject({
      canvas: "success",
      "directory-maintenance": "success",
    });
  });

  it("keeps the canvas stage locked until remote conflict resolution has applied", async () => {
    let releaseRemoteApply!: () => void;
    const remoteApplyGate = new Promise<void>((resolve) => {
      releaseRemoteApply = resolve;
    });
    const canvasAdapter = createNamedAdapter("world-documents", []);
    canvasAdapter.sync.mockImplementationOnce(async (
      _session: SyncRemoteSession,
      options: Parameters<SyncAdapter["sync"]>[1],
    ) => {
      options.scope?.onProgress?.(55);
      await remoteApplyGate;
      return {
        adapterId: "world-documents",
        mode: "full-with-revision",
        status: "downloaded",
        changedAssetIds: ["current"],
      };
    });
    const blueprintAdapter = createNamedAdapter("blueprints", []);
    const service = createSyncService({
      readSettings: () => ({
        enabled: true,
        url: "https://dav.example.test",
        username: "",
        password: "",
        maxConcurrentRequests: 4,
      }),
      createRemote,
      adapters: [canvasAdapter, blueprintAdapter],
      createInitialSyncPlan: () => ({
        batches: [
          {
            stage: "canvas",
            requests: [{ adapterId: "world-documents" }],
          },
          {
            stage: "blueprints",
            requests: [{ adapterId: "blueprints" }],
          },
        ],
      }),
    });

    const syncPromise = service.syncNow("startup");
    await vi.waitFor(() => {
      expect(canvasAdapter.sync).toHaveBeenCalledTimes(1);
    });
    expect(service.getStatus().initialSyncStage).toBe("canvas");
    expect(blueprintAdapter.sync).not.toHaveBeenCalled();
    expect(service.getStatus().tasks.find(
      (task) => task.kind === "canvas",
    )).toMatchObject({
      phase: "running",
      completedUnitCount: 55,
      totalUnitCount: 100,
    });

    releaseRemoteApply();
    const status = await syncPromise;

    expect(blueprintAdapter.sync).toHaveBeenCalledTimes(1);
    expect(status.initialSyncStage).toBe("ready");
    expect(status.tasks.find((task) => task.kind === "canvas")).toMatchObject({
      phase: "success",
      completedUnitCount: 100,
      totalUnitCount: 100,
    });
  });

  it("uses dirty notifications without limiting local-change plan coverage", async () => {
    vi.useFakeTimers();
    const calls: string[] = [];
    const firstAdapter = createNamedAdapter("first", calls);
    const secondAdapter = createNamedAdapter("second", calls);
    const service = createSyncService({
      readSettings: () => ({
        enabled: true,
        url: "https://dav.example.test",
        username: "",
        password: "",
        maxConcurrentRequests: 4,
      }),
      createRemote,
      adapters: [firstAdapter, secondAdapter],
      intervalMs: 60_000,
    });

    service.start();
    await vi.waitFor(() => {
      expect(secondAdapter.sync).toHaveBeenCalledTimes(1);
    });
    calls.length = 0;
    firstAdapter.sync.mockClear();
    secondAdapter.sync.mockClear();

    service.notifyLocalChange({
      adapterId: "second",
      assetId: "asset-b",
    });
    await vi.advanceTimersByTimeAsync(5_000);
    await vi.waitFor(() => {
      expect(service.getStatus().saveState).toBe("idle");
    });

    expect(calls).toEqual(["first:all", "second:all"]);
    expect(firstAdapter.sync).toHaveBeenCalledTimes(1);
    expect(secondAdapter.sync).toHaveBeenCalledTimes(1);
    service.stop();
  });

  it("does not show save feedback for periodic downloads or empty periodic passes", async () => {
    const observedSaveStates: string[] = [];
    const adapter = createAdapter();
    adapter.sync
      .mockResolvedValueOnce({
        adapterId: "adapter",
        mode: "full-no-revision",
        status: "downloaded",
        changedAssetIds: ["single"],
      })
      .mockResolvedValueOnce({
        adapterId: "adapter",
        mode: "full-no-revision",
        status: "idle",
        changedAssetIds: [],
      });
    const service = createSyncService({
      readSettings: () => ({
        enabled: true,
        url: "https://dav.example.test",
        username: "",
        password: "",
        maxConcurrentRequests: 4,
      }),
      createRemote,
      adapters: [adapter],
      onStatusChange: (status) => {
        observedSaveStates.push(status.saveState);
      },
    });

    await service.syncNow("interval");
    await service.syncNow("interval");

    expect(observedSaveStates).not.toContain("pending");
    expect(observedSaveStates).not.toContain("saving");
    expect(service.getStatus().saveState).toBe("idle");
  });

  it("reports conflicts", async () => {
    const onConflictDiscoveryStart = vi.fn();
    const resolveConflicts = vi.fn(async () => []);
    const adapter: SyncAdapter = {
      id: "conflicting-adapter",
      mode: "full-no-revision",
      collection: createSyncRemoteCollection({
        adapterId: "conflicting-adapter",
        mode: "full-no-revision",
        stateKey: "conflicting-adapter.json",
      }),
      checkPath: "conflicting-adapter.json",
      sync: vi.fn(async (
        _session: SyncRemoteSession,
        options: Parameters<SyncAdapter["sync"]>[1],
      ): Promise<SyncAdapterResult> => {
        // AI-CORRECTION 2026-08-13: 冲突以 SyncPlanItem 登记，引擎统一弹框决议。
        options.transaction.recordItem(
          createPlanItemStub("conflicting-adapter", "single", "conflict"),
        );
        return {
          adapterId: "conflicting-adapter",
          mode: "full-no-revision",
          status: "conflict",
          changedAssetIds: ["single"],
        };
      }),
    };
    const service = createSyncService({
      readSettings: () => createSettings(),
      createRemote,
      adapters: [adapter],
      onConflictDiscoveryStart,
      resolveConflicts,
    });

    const status = await service.syncNow("manual");

    expect(onConflictDiscoveryStart).toHaveBeenCalledTimes(1);
    expect(resolveConflicts).toHaveBeenCalledTimes(1);
    expect(status.phase).toBe("error");
    expect(status.lastError).toBe("Sync conflict");
  });

  it("shows one dialog for mixed uploads and conflicts and applies per-item decisions", async () => {
    const firstUpload = createPlanItemStub(
      "blueprints",
      "blueprint-a",
      "upload",
      vi.fn(async () => undefined),
    );
    const secondConflict = createPlanItemStub(
      "world-documents",
      "base-a",
      "conflict",
      vi.fn(async () => undefined),
    );
    const firstAdapter: SyncAdapter = {
      id: "blueprints",
      mode: "full-with-revision",
      collection: createSyncRemoteCollection({
        adapterId: "blueprints",
        mode: "full-with-revision",
        stateKey: "blueprints/index.json",
      }),
      checkPath: "blueprints/index.json",
      sync: vi.fn(async (
        _session: SyncRemoteSession,
        options: Parameters<SyncAdapter["sync"]>[1],
      ): Promise<SyncAdapterResult> => {
        options.transaction.recordItem(firstUpload);
        return {
          adapterId: "blueprints",
          mode: "full-with-revision",
          status: "uploaded",
          changedAssetIds: ["blueprint-a"],
        };
      }),
    };
    const secondAdapter: SyncAdapter = {
      id: "world-documents",
      mode: "patch-with-revision",
      collection: createSyncRemoteCollection({
        adapterId: "world-documents",
        mode: "patch-with-revision",
        stateKey: "world-documents/meta.json",
      }),
      checkPath: "world-documents/meta.json",
      sync: vi.fn(async (
        _session: SyncRemoteSession,
        options: Parameters<SyncAdapter["sync"]>[1],
      ): Promise<SyncAdapterResult> => {
        options.transaction.recordItem(secondConflict);
        return {
          adapterId: "world-documents",
          mode: "patch-with-revision",
          status: "conflict",
          changedAssetIds: ["base-a"],
        };
      }),
    };
    const onConflictDiscoveryStart = vi.fn();
    const onConflictWorkflowFinished = vi.fn();
    const resolveConflicts = vi.fn(async () => [
      {
        adapterId: "blueprints",
        assetId: "blueprint-a",
        resolution: "use-local" as const,
      },
      {
        adapterId: "world-documents",
        assetId: "base-a",
        resolution: "use-remote" as const,
      },
    ]);
    const service = createSyncService({
      readSettings: () => createSettings(),
      createRemote,
      adapters: [firstAdapter, secondAdapter],
      onConflictDiscoveryStart,
      resolveConflicts,
      onConflictWorkflowFinished,
    });

    const status = await service.syncNow("manual");

    expect(resolveConflicts).toHaveBeenCalledTimes(1);
    expect(resolveConflicts).toHaveBeenCalledWith([
      expect.objectContaining({
        adapterId: "blueprints",
        assetId: "blueprint-a",
        kind: "upload",
      }),
      expect.objectContaining({
        adapterId: "world-documents",
        assetId: "base-a",
        kind: "conflict",
      }),
    ]);
    expect(firstUpload.applyUpload).toHaveBeenCalledTimes(1);
    expect(secondConflict.applyDownload).toHaveBeenCalledTimes(1);
    expect(onConflictDiscoveryStart).toHaveBeenCalledTimes(1);
    expect(onConflictWorkflowFinished).toHaveBeenCalledTimes(1);
    expect(status.phase).toBe("idle");
    expect(status.lastError).toBeNull();
  });

  it("discards local additions when an upload item is resolved as use-remote", async () => {
    // AI-CORRECTION 2026-08-14: 上传条目（本地有、远端没有）被决议为“用远端”时，
    // 语义为放弃本地新增：调用 applyDiscardLocal 走二段删除，而不是 applyDownload
    // 的“远端资产不存在 → skipping”静默路径（原路径不上传也不删除，却推进同步状态，
    // 制造“已同步”假象）。
    const uploadItem = createPlanItemStub(
      "blueprints",
      "blueprint-a",
      "upload",
    );
    const conflictItem = createPlanItemStub(
      "world-documents",
      "base-a",
      "conflict",
    );
    const firstAdapter: SyncAdapter = {
      id: "blueprints",
      mode: "full-with-revision",
      collection: createSyncRemoteCollection({
        adapterId: "blueprints",
        mode: "full-with-revision",
        stateKey: "blueprints/index.json",
      }),
      checkPath: "blueprints/index.json",
      sync: vi.fn(async (
        _session: SyncRemoteSession,
        options: Parameters<SyncAdapter["sync"]>[1],
      ): Promise<SyncAdapterResult> => {
        options.transaction.recordItem(uploadItem);
        return {
          adapterId: "blueprints",
          mode: "full-with-revision",
          status: "uploaded",
          changedAssetIds: ["blueprint-a"],
        };
      }),
    };
    const secondAdapter: SyncAdapter = {
      id: "world-documents",
      mode: "patch-with-revision",
      collection: createSyncRemoteCollection({
        adapterId: "world-documents",
        mode: "patch-with-revision",
        stateKey: "world-documents/meta.json",
      }),
      checkPath: "world-documents/meta.json",
      sync: vi.fn(async (
        _session: SyncRemoteSession,
        options: Parameters<SyncAdapter["sync"]>[1],
      ): Promise<SyncAdapterResult> => {
        options.transaction.recordItem(conflictItem);
        return {
          adapterId: "world-documents",
          mode: "patch-with-revision",
          status: "conflict",
          changedAssetIds: ["base-a"],
        };
      }),
    };
    const resolveConflicts = vi.fn(async () => [
      {
        adapterId: "blueprints",
        assetId: "blueprint-a",
        resolution: "use-remote" as const,
      },
      {
        adapterId: "world-documents",
        assetId: "base-a",
        resolution: "use-remote" as const,
      },
    ]);
    const service = createSyncService({
      readSettings: () => createSettings(),
      createRemote,
      adapters: [firstAdapter, secondAdapter],
      resolveConflicts,
    });

    const status = await service.syncNow("manual");

    expect(uploadItem.applyDiscardLocal).toHaveBeenCalledTimes(1);
    expect(uploadItem.applyUpload).not.toHaveBeenCalled();
    expect(uploadItem.applyDownload).not.toHaveBeenCalled();
    expect(conflictItem.applyDownload).toHaveBeenCalledTimes(1);
    expect(status.phase).toBe("idle");
    expect(status.lastError).toBeNull();
  });

  it("persists conflict baselines only after the shared batch commits", async () => {
    const setLastSyncedHash = vi.fn(async () => undefined);
    const commit = vi.fn(async () => {
      throw new Error("commit failed");
    });
    const collection = createSyncRemoteCollection({
      adapterId: "blueprints",
      mode: "full-with-revision",
      stateKey: "blueprints/index.json",
    });
    const adapter: SyncAdapter = {
      id: "blueprints",
      mode: "full-with-revision",
      collection,
      checkPath: "blueprints/index.json",
      sync: vi.fn(async (
        _session: SyncRemoteSession,
        options: Parameters<SyncAdapter["sync"]>[1],
      ): Promise<SyncAdapterResult> => {
        const transaction = options.transaction;
        options.transaction.recordItem({
          ...createPlanItemStub("blueprints", "blueprint-a", "conflict"),
          applyUpload: vi.fn(async () => {
            transaction.recordUpload({
              adapterId: "blueprints",
              assetId: "blueprint-a",
              params: {
                collection,
                assetId: "blueprint-a",
                value: { name: "local" },
                contentHash: "local-hash",
                baseRevision: null,
                baseContentHash: null,
              },
            });
          }),
        });
        return {
          adapterId: "blueprints",
          mode: "full-with-revision" as const,
          status: "conflict" as const,
          changedAssetIds: ["blueprint-a"],
        };
      }),
    };
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
      adapters: [adapter],
      retryDelaysMs: [],
      resolveConflicts: async () => [{
        adapterId: "blueprints",
        assetId: "blueprint-a",
        resolution: "use-local",
      }],
    });

    const status = await service.syncNow("manual");

    expect(commit).toHaveBeenCalledTimes(1);
    expect(setLastSyncedHash).not.toHaveBeenCalled();
    expect(status.lastError).toBe("commit failed");
  });

  it("retries transient sync failures", async () => {
    vi.useFakeTimers();
    const adapter = createAdapter();
    adapter.sync
      .mockRejectedValueOnce(new Error("temporary outage"))
      .mockResolvedValueOnce({
        adapterId: "adapter",
        mode: "full-no-revision",
        status: "uploaded",
        changedAssetIds: ["single"],
      });
    const service = createSyncService({
      readSettings: () => createSettings(),
      createRemote,
      adapters: [adapter],
      retryDelaysMs: [10],
    });

    const syncPromise = service.syncNow("manual");
    await vi.advanceTimersByTimeAsync(10);
    const status = await syncPromise;

    expect(adapter.sync).toHaveBeenCalledTimes(2);
    expect(status.phase).toBe("idle");
    expect(status.lastError).toBeNull();
  });

  it("restarts the whole run after an optimistic write conflict", async () => {
    const adapter = createAdapter();
    adapter.sync
      .mockRejectedValueOnce(new RemoteWriteConflictError([{
        assetType: "planner-state",
        assetId: "single",
        reason: "revision-mismatch",
        expectedRevision: 1,
        actualRevision: 2,
        expectedHash: "old",
        actualHash: "new",
      }]))
      .mockResolvedValueOnce({
        adapterId: "adapter",
        mode: "full-no-revision",
        status: "downloaded",
        changedAssetIds: ["single"],
      });
    const complete = vi.fn(async () => undefined);
    const createRemoteMock = vi.fn(() =>
      createTestRemote({ complete })
    );
    const service = createSyncService({
      readSettings: () => createSettings(),
      createRemote: createRemoteMock,
      adapters: [adapter],
    });

    const status = await service.syncNow("manual");

    // AI-CORRECTION 2026-08-13: 写 409 丢弃整轮从头开始（新 remote/session + 重新拉 plan），
    // 不再做“刷新索引后原地重试单 adapter”。
    expect(adapter.sync).toHaveBeenCalledTimes(2);
    expect(createRemoteMock).toHaveBeenCalledTimes(2);
    expect(complete).toHaveBeenCalledTimes(1);
    expect(status.phase).toBe("idle");
    expect(status.lastDownloadAt).not.toBeNull();
  });

  it("allows a provider-specific validator to accept an empty WebDAV URL", async () => {
    const adapter = createAdapter();
    const service = createSyncService({
      readSettings: () => ({ ...createSettings(), url: "" }),
      validateSettings: () => null,
      createRemote,
      adapters: [adapter],
    });

    const status = await service.syncNow("manual");

    expect(adapter.sync).toHaveBeenCalledTimes(1);
    expect(status.phase).toBe("idle");
  });

  it("allows the next local edit to upload immediately after a download", async () => {
    const adapter = createAdapter();
    adapter.sync.mockResolvedValueOnce({
      adapterId: "adapter",
      mode: "full-no-revision",
      status: "downloaded",
      changedAssetIds: ["single"],
    });
    const service = createSyncService({
      readSettings: () => createSettings(),
      createRemote,
      adapters: [adapter],
      intervalMs: 60_000,
    });

    service.start();
    await vi.waitFor(() => {
      expect(service.getStatus().phase).toBe("idle");
    });
    adapter.sync.mockClear();

    service.notifyLocalChange({ adapterId: "adapter" });
    await vi.waitFor(() => {
      expect(adapter.sync).toHaveBeenCalledTimes(1);
    });

    expect(service.getStatus().currentRunReason).toBeNull();
    expect(service.getStatus().pendingLocalChangeCount).toBe(0);
    service.stop();
  });

  it("runs before and after hooks around adapters", async () => {
    const calls: string[] = [];
    const adapter = createAdapter();
    const service = createSyncService({
      readSettings: () => createSettings(),
      createRemote,
      adapters: [adapter],
      beforeSync: () => { calls.push("before"); },
      afterSync: () => { calls.push("after"); },
    });

    await service.syncNow("manual");

    expect(calls).toEqual(["before", "after"]);
  });

  it("debounces local changes", async () => {
    vi.useFakeTimers();
    const adapter = createAdapter();
    const service = createSyncService({
      readSettings: () => createSettings(),
      createRemote,
      adapters: [adapter],
      intervalMs: 60_000,
    });

    service.start();
    await vi.waitFor(() => {
      expect(adapter.sync).toHaveBeenCalledTimes(1);
    });
    await vi.waitFor(() => {
      expect(service.getStatus().phase).toBe("idle");
    });

    // AI-CORRECTION 2026-07-30: idle 状态下 notifyLocalChange 立即触发上传；
    // 上传完成后 syncSuppressImmediate 随 pendingLocalChangeCount=0 复位。
    // 后续在同步进行中连续调用 notifyLocalChange 才会走 5s / 30s 防抖。
    service.notifyLocalChange({ adapterId: "adapter" });
    await vi.waitFor(() => {
      expect(adapter.sync).toHaveBeenCalledTimes(2);
      expect(service.getStatus().saveState).toBe("idle");
    });
    adapter.sync.mockClear();

    service.notifyLocalChange({ adapterId: "adapter" });
    await vi.waitFor(() => {
      expect(adapter.sync).toHaveBeenCalledTimes(1);
      expect(service.getStatus().saveState).toBe("idle");
    });
    // idle 状态下每次 notifyLocalChange 立即同步，验证确实调用了 adapter
    expect(adapter.sync).toHaveBeenCalledTimes(1);
    expect(service.getStatus().pendingLocalChangeCount).toBe(0);
    service.stop();
  });

  it("clears a previous sync failure after an unchanged interval check succeeds", async () => {
    vi.useFakeTimers();
    const adapter = createAdapter();
    adapter.sync.mockRejectedValueOnce(new Error("temporary outage"));
    const service = createSyncService({
      readSettings: () => createSettings(),
      createRemote,
      adapters: [adapter],
      retryDelaysMs: [],
      intervalMs: 60_000,
    });

    service.start();
    await vi.waitFor(() => {
      expect(service.getStatus()).toMatchObject({
        phase: "error",
        saveState: "idle",
        lastError: "temporary outage",
      });
    });

    await vi.advanceTimersByTimeAsync(60_000);
    await vi.waitFor(() => {
      expect(service.getStatus()).toMatchObject({
        phase: "idle",
        saveState: "idle",
        pendingLocalChangeCount: 0,
        saveError: null,
        lastError: null,
      });
    });

    expect(adapter.sync).toHaveBeenCalledTimes(1);
    expect(service.getStatus().tasks.find(
      (task) => task.kind === "update-check",
    )).toMatchObject({
      phase: "success",
      completedUnitCount: 1,
      totalUnitCount: 1,
      lastError: null,
    });
    service.stop();
  });

  it("emits scheduler diagnostics only while debug logging is enabled", async () => {
    vi.useFakeTimers();
    const previousLogLevel = getLogLevel();
    const debugSpy = vi.spyOn(console, "debug").mockImplementation(() => undefined);
    const infoSpy = vi.spyOn(console, "info").mockImplementation(() => undefined);
    const adapter = createAdapter();
    const service = createSyncService({
      readSettings: () => createSettings(),
      createRemote,
      adapters: [adapter],
      intervalMs: 60_000,
    });

    try {
      setLogLevel("debug");
      service.start();
      await vi.waitFor(() => {
        expect(service.getStatus().phase).toBe("idle");
      });
      debugSpy.mockClear();

      await vi.advanceTimersByTimeAsync(60_000);
      await vi.waitFor(() => {
        expect(service.getStatus().lastUpdateCheckAt).not.toBeNull();
      });

      const messages = debugSpy.mock.calls
        .map(([message]) => String(message))
        .join("\n");
      expect(messages).toContain(
        "update check timer fired — generation=1 tick=1",
      );
      expect(messages).toContain(
        "driftMs=0 runnable=true syncing=false updateCheckRunning=false " +
        "phase=idle currentRunReason=none decision=run",
      );
      expect(messages).toContain(
        "update check started — generation=1 tick=1",
      );
      expect(messages).toContain(
        "update check probe completed — generation=1 tick=1 unchanged=true",
      );
      expect(messages).toContain(
        "update check finished — generation=1 tick=1 outcome=remote-unchanged",
      );

      const previousUpdateCheckAt = service.getStatus().lastUpdateCheckAt;
      debugSpy.mockClear();
      setLogLevel("warn");
      await vi.advanceTimersByTimeAsync(60_000);
      await vi.waitFor(() => {
        expect(service.getStatus().lastUpdateCheckAt).not.toBe(previousUpdateCheckAt);
      });
      expect(debugSpy).not.toHaveBeenCalled();
    } finally {
      service.stop();
      setLogLevel(previousLogLevel);
      debugSpy.mockRestore();
      infoSpy.mockRestore();
    }
  });

  it("records an interval tick as discarded while a sync is running", async () => {
    vi.useFakeTimers();
    const previousLogLevel = getLogLevel();
    const debugSpy = vi.spyOn(console, "debug").mockImplementation(() => undefined);
    const infoSpy = vi.spyOn(console, "info").mockImplementation(() => undefined);
    let releaseStartupSync!: () => void;
    const startupSyncGate = new Promise<void>((resolve) => {
      releaseStartupSync = resolve;
    });
    const adapter = createAdapter();
    adapter.sync.mockImplementation(async (): Promise<SyncAdapterResult> => {
      await startupSyncGate;
      return {
        adapterId: "adapter",
        mode: "full-no-revision",
        status: "idle",
        changedAssetIds: [],
      };
    });
    const service = createSyncService({
      readSettings: () => createSettings(),
      createRemote,
      adapters: [adapter],
      intervalMs: 60_000,
    });

    try {
      setLogLevel("debug");
      service.start();
      await vi.waitFor(() => {
        expect(service.getStatus()).toMatchObject({
          phase: "downloading",
          currentRunReason: "startup",
        });
      });
      debugSpy.mockClear();

      await vi.advanceTimersByTimeAsync(60_000);

      const messages = debugSpy.mock.calls
        .map(([message]) => String(message))
        .join("\n");
      expect(messages).toContain(
        "syncing=true updateCheckRunning=false phase=downloading " +
        "currentRunReason=startup decision=discard-syncing",
      );
      expect(messages).not.toContain("update check started");
    } finally {
      releaseStartupSync();
      await vi.waitFor(() => {
        expect(service.getStatus().phase).toBe("idle");
      });
      service.stop();
      setLogLevel(previousLogLevel);
      debugSpy.mockRestore();
      infoSpy.mockRestore();
    }
  });

  it("keeps a failed save visible until a later sync succeeds", async () => {
    vi.useFakeTimers();
    const adapter = createAdapter();
    const service = createSyncService({
      readSettings: () => createSettings(),
      createRemote,
      adapters: [adapter],
      retryDelaysMs: [],
      intervalMs: 60_000,
    });

    service.start();
    await vi.waitFor(() => {
      expect(adapter.sync).toHaveBeenCalledTimes(1);
    });
    adapter.sync.mockClear();
    adapter.sync.mockRejectedValueOnce(new Error("server unavailable"));

    service.notifyLocalChange({ adapterId: "adapter" });
    await vi.advanceTimersByTimeAsync(5_000);
    await vi.waitFor(() => {
      expect(service.getStatus().saveState).toBe("error");
    });
    expect(service.getStatus().pendingLocalChangeCount).toBe(1);
    expect(service.getStatus().saveError).toBe("server unavailable");

    let releaseSuccessfulSync!: () => void;
    const successfulSyncGate = new Promise<void>((resolve) => {
      releaseSuccessfulSync = resolve;
    });
    adapter.sync.mockImplementationOnce(async () => {
      await successfulSyncGate;
      return {
        adapterId: "adapter",
        mode: "full-no-revision",
        status: "uploaded",
        changedAssetIds: ["single"],
      };
    });

    const successfulSync = service.syncNow("manual");
    expect(service.getStatus().saveState).toBe("error");
    releaseSuccessfulSync();
    await successfulSync;

    expect(service.getStatus().saveState).toBe("idle");
    expect(service.getStatus().pendingLocalChangeCount).toBe(0);
    expect(service.getStatus().saveError).toBeNull();
    service.stop();
  });

  it("does not acknowledge a newer local change with an older in-flight snapshot", async () => {
    vi.useFakeTimers();
    const adapter = createAdapter();
    const service = createSyncService({
      readSettings: () => createSettings(),
      createRemote,
      adapters: [adapter],
      retryDelaysMs: [],
      intervalMs: 60_000,
    });

    service.start();
    await vi.waitFor(() => {
      expect(adapter.sync).toHaveBeenCalledTimes(1);
    });
    adapter.sync.mockClear();

    let releaseFirstSave!: () => void;
    const firstSaveGate = new Promise<void>((resolve) => {
      releaseFirstSave = resolve;
    });
    adapter.sync.mockImplementationOnce(async () => {
      await firstSaveGate;
      return {
        adapterId: "adapter",
        mode: "full-no-revision",
        status: "uploaded",
        changedAssetIds: ["single"],
      };
    });

    service.notifyLocalChange({ adapterId: "adapter" });
    await vi.advanceTimersByTimeAsync(5_000);
    await vi.waitFor(() => {
      expect(adapter.sync).toHaveBeenCalledTimes(1);
    });
    service.notifyLocalChange({ adapterId: "adapter" });
    releaseFirstSave();
    await vi.waitFor(() => {
      expect(service.getStatus().pendingLocalChangeCount).toBe(1);
    });

    await vi.advanceTimersByTimeAsync(5_000);
    await vi.waitFor(() => {
      expect(adapter.sync).toHaveBeenCalledTimes(2);
    });
    await vi.waitFor(() => {
      expect(service.getStatus().saveState).toBe("idle");
    });
    expect(service.getStatus().pendingLocalChangeCount).toBe(0);
    service.stop();
  });

  it("flushes a pending local change immediately when the page goes to background", async () => {
    vi.useFakeTimers();
    const adapter = createAdapter();
    const service = createSyncService({
      readSettings: () => createSettings(),
      createRemote,
      adapters: [adapter],
      retryDelaysMs: [],
      intervalMs: 60_000,
    });

    service.start();
    await vi.waitFor(() => {
      expect(adapter.sync).toHaveBeenCalledTimes(1);
    });
    adapter.sync.mockClear();

    let releaseFirstSave!: () => void;
    const firstSaveGate = new Promise<void>((resolve) => {
      releaseFirstSave = resolve;
    });
    adapter.sync.mockImplementationOnce(async () => {
      await firstSaveGate;
      return {
        adapterId: "adapter",
        mode: "full-no-revision",
        status: "uploaded",
        changedAssetIds: ["single"],
      };
    });

    // 首次编辑立即上传；上传挂起期间再编辑一次 → 进入 5s 空闲去抖期。
    service.notifyLocalChange({ adapterId: "adapter" });
    await vi.waitFor(() => {
      expect(adapter.sync).toHaveBeenCalledTimes(1);
    });
    service.notifyLocalChange({ adapterId: "adapter" });
    releaseFirstSave();
    await vi.waitFor(() => {
      expect(service.getStatus().pendingLocalChangeCount).toBe(1);
    });
    expect(service.getStatus().saveState).toBe("pending");
    adapter.sync.mockClear();

    // 去抖期未满 5s：flush 应立即触发上传，而不是等待 idle 定时器。
    service.flushPendingChanges();
    await vi.waitFor(() => {
      expect(adapter.sync).toHaveBeenCalledTimes(1);
    });
    await vi.waitFor(() => {
      expect(service.getStatus().saveState).toBe("idle");
    });
    expect(service.getStatus().pendingLocalChangeCount).toBe(0);
    service.stop();
  });

  it("does not trigger an upload when flushing without pending local changes", async () => {
    vi.useFakeTimers();
    const adapter = createAdapter();
    const service = createSyncService({
      readSettings: () => createSettings(),
      createRemote,
      adapters: [adapter],
      intervalMs: 60_000,
    });

    service.start();
    await vi.waitFor(() => {
      expect(adapter.sync).toHaveBeenCalledTimes(1);
    });
    adapter.sync.mockClear();

    service.flushPendingChanges();
    await vi.advanceTimersByTimeAsync(6_000);
    expect(adapter.sync).not.toHaveBeenCalled();
    expect(service.getStatus().saveState).toBe("idle");
    service.stop();
  });

  it("clears pending save feedback when sync is disabled", async () => {
    let enabled = true;
    const adapter = createAdapter();
    const service = createSyncService({
      readSettings: () => createSettings(enabled),
      createRemote,
      adapters: [adapter],
    });

    service.start();
    await vi.waitFor(() => {
      expect(service.getStatus().initialSyncStage).toBe("ready");
    });
    await vi.waitFor(() => {
      expect(service.getStatus().phase).toBe("idle");
    });

    // AI-CORRECTION 2026-07-30: idle 状态每次 notifyLocalChange 立即同步。
    // 先触发一次上传并等待完成，确认正常路径 saveState 回到 idle。
    service.notifyLocalChange({ adapterId: "adapter" });
    await vi.waitFor(() => {
      expect(adapter.sync).toHaveBeenCalledTimes(2);
      expect(service.getStatus().saveState).toBe("idle");
    });
    expect(service.getStatus().saveState).toBe("idle");

    // 禁用同步后再次变更 → 同步被跳过，saveState 回到 idle
    enabled = false;
    service.notifyLocalChange({ adapterId: "adapter" });
    await service.syncNow("settings-change");

    expect(service.getStatus().saveState).toBe("idle");
    expect(service.getStatus().pendingLocalChangeCount).toBe(0);
    service.stop();
  });

  it("queues a new pass when a local change arrives during an active sync", async () => {
    let releaseFirstSync!: () => void;
    const firstSyncGate = new Promise<void>((resolve) => {
      releaseFirstSync = resolve;
    });
    const adapter = createAdapter();
    adapter.sync.mockImplementationOnce(async () => {
      await firstSyncGate;
      return {
        adapterId: "adapter",
        mode: "full-no-revision",
        status: "uploaded",
        changedAssetIds: ["single"],
      };
    });
    const dispose = vi.fn();
    const service = createSyncService({
      readSettings: () => createSettings(),
      createRemote: () => createTestRemote({ dispose }),
      adapters: [adapter],
      intervalMs: 60_000,
    });

    service.start();
    await vi.waitFor(() => {
      expect(adapter.sync).toHaveBeenCalledTimes(1);
    });
    service.notifyLocalChange({ adapterId: "adapter" });
    void service.syncNow("local-change");
    releaseFirstSync();

    await vi.waitFor(() => {
      expect(adapter.sync).toHaveBeenCalledTimes(2);
    });
    expect(dispose).toHaveBeenCalledTimes(2);
    service.stop();
  });

  it("does not chain periodic passes behind a long active sync", async () => {
    let releaseFirstSync!: () => void;
    const firstSyncGate = new Promise<void>((resolve) => {
      releaseFirstSync = resolve;
    });
    const adapter = createAdapter();
    adapter.sync.mockImplementationOnce(async () => {
      await firstSyncGate;
      return {
        adapterId: "adapter",
        mode: "full-no-revision",
        status: "downloaded",
        changedAssetIds: ["single"],
      };
    });
    const service = createSyncService({
      readSettings: () => ({
        enabled: true,
        url: "https://dav.example.test",
        username: "",
        password: "",
        maxConcurrentRequests: 4,
      }),
      createRemote,
      adapters: [adapter],
      intervalMs: 60_000,
    });

    service.start();
    await vi.waitFor(() => {
      expect(adapter.sync).toHaveBeenCalledTimes(1);
    });

    await service.syncNow("interval");
    releaseFirstSync();
    await vi.waitFor(() => {
      expect(service.getStatus().phase).toBe("idle");
    });

    expect(adapter.sync).toHaveBeenCalledTimes(1);
    service.stop();
  });

  it("coalesces foreground visibility events during an active initial sync", async () => {
    let releaseInitialSync!: () => void;
    const initialSyncGate = new Promise<void>((resolve) => {
      releaseInitialSync = resolve;
    });
    const adapter = createAdapter();
    adapter.sync.mockImplementationOnce(async () => {
      await initialSyncGate;
      return {
        adapterId: "adapter",
        mode: "full-no-revision",
        status: "downloaded",
        changedAssetIds: ["single"],
      };
    });
    const service = createSyncService({
      readSettings: () => createSettings(),
      createRemote,
      adapters: [adapter],
      intervalMs: 60_000,
    });

    service.start();
    await vi.waitFor(() => {
      expect(adapter.sync).toHaveBeenCalledTimes(1);
    });
    await service.syncNow("foreground");
    releaseInitialSync();
    await vi.waitFor(() => {
      expect(service.getStatus().phase).toBe("idle");
    });

    expect(adapter.sync).toHaveBeenCalledTimes(1);
    service.stop();
  });

  it("locks the canvas only when a queued foreground pass actually starts", async () => {
    const adapter = createAdapter();
    const service = createSyncService({
      readSettings: () => createSettings(),
      createRemote,
      adapters: [adapter],
      intervalMs: 60_000,
    });
    service.start();
    await vi.waitFor(() => {
      expect(service.getStatus().phase).toBe("idle");
    });
    adapter.sync.mockClear();

    let releaseManualSync!: () => void;
    const manualSyncGate = new Promise<void>((resolve) => {
      releaseManualSync = resolve;
    });
    let releaseForegroundSync!: () => void;
    const foregroundSyncGate = new Promise<void>((resolve) => {
      releaseForegroundSync = resolve;
    });
    adapter.sync
      .mockImplementationOnce(async () => {
        await manualSyncGate;
        return {
          adapterId: "adapter",
          mode: "full-no-revision",
          status: "downloaded",
          changedAssetIds: ["single"],
        };
      })
      .mockImplementationOnce(async () => {
        await foregroundSyncGate;
        return {
          adapterId: "adapter",
          mode: "full-no-revision",
          status: "downloaded",
          changedAssetIds: ["single"],
        };
      });

    const manualSyncPromise = service.syncNow("manual");
    await vi.waitFor(() => {
      expect(adapter.sync).toHaveBeenCalledTimes(1);
    });
    await service.syncNow("foreground");
    expect(service.getStatus().initialSyncStage).toBe("ready");

    releaseManualSync();
    await manualSyncPromise;
    await vi.waitFor(() => {
      expect(adapter.sync).toHaveBeenCalledTimes(2);
    });
    expect(service.getStatus().initialSyncStage).toBe("canvas");

    releaseForegroundSync();
    await vi.waitFor(() => {
      expect(service.getStatus()).toMatchObject({
        phase: "idle",
        initialSyncStage: "ready",
      });
    });
    service.stop();
  });
});

function createAdapter(): SyncAdapter & { readonly sync: ReturnType<typeof vi.fn> } {
  return {
    id: "adapter",
    mode: "full-no-revision",
    collection: createSyncRemoteCollection({
      adapterId: "adapter",
      mode: "full-no-revision",
      stateKey: "adapter.json",
    }),
    checkPath: "adapter.json",
    sync: vi.fn(async (): Promise<SyncAdapterResult> => ({
      adapterId: "adapter",
      mode: "full-no-revision",
      status: "uploaded",
      changedAssetIds: ["single"],
    })),
  };
}

function createNamedAdapter(
  id: string,
  calls: string[],
): SyncAdapter & { readonly sync: ReturnType<typeof vi.fn> } {
  return {
    id,
    mode: "full-with-revision",
    collection: createSyncRemoteCollection({
      adapterId: id,
      mode: "full-with-revision",
      stateKey: `${id}/index.json`,
    }),
    checkPath: `${id}/index.json`,
    sync: vi.fn(async (
      _session: SyncRemoteSession,
      options: Parameters<SyncAdapter["sync"]>[1],
    ): Promise<SyncAdapterResult> => {
      const scope = options.scope;
      const scopeText = scope?.includeAssetIds !== undefined
        ? `include=${scope.includeAssetIds.join(",")}`
        : scope?.excludeAssetIds !== undefined
          ? `exclude=${scope.excludeAssetIds.join(",")}`
          : "all";
      calls.push(`${id}:${scopeText}`);

      return {
        adapterId: id,
        mode: "full-with-revision",
        status: "idle",
        changedAssetIds: [],
      };
    }),
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

function createSettings(enabled = true) {
  return {
    enabled,
    url: "https://dav.example.test",
    username: "",
    password: "",
    maxConcurrentRequests: 4,
  };
}
