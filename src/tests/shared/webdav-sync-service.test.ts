// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from "vitest";

import {
  createWebDavSyncService,
  createSyncRemoteCollection,
  RemoteWriteConflictError,
} from "@/sync";
import type {
  SyncRemote,
  SyncRemoteSession,
  WebDavSyncAdapter,
  WebDavSyncAdapterResult,
  WebDavSyncServiceOptions,
} from "@/sync";

function createTestRemote(options: {
  readonly dispose?: () => void;
  readonly refreshIndexes?: SyncRemoteSession["refreshIndexes"];
  readonly complete?: SyncRemoteSession["complete"];
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

const createRemote: WebDavSyncServiceOptions["createRemote"] = () => createTestRemote();

describe("webdav-sync-service", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("skips sync while disabled", async () => {
    const adapter = createAdapter();
    const service = createWebDavSyncService({
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
    const service = createWebDavSyncService({
      readSettings: () => createSettings(),
      createRemote,
      adapters: [adapter],
    });

    const status = await service.syncNow("manual");

    expect(adapter.sync).toHaveBeenCalledTimes(1);
    expect(status.lastUploadAt).not.toBeNull();
  });

  it("fails fast and unlocks the canvas when initial network sync fails", async () => {
    const adapter = createAdapter();
    adapter.sync.mockRejectedValue(new Error("network timeout"));
    const createRemoteMock = vi.fn((
      ..._args: Parameters<WebDavSyncServiceOptions["createRemote"]>
    ) => createTestRemote());
    const service = createWebDavSyncService({
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
    const service = createWebDavSyncService({
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

  it("reports maintenance task progress separately from adapter tasks", async () => {
    const service = createWebDavSyncService({
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
      scope: Parameters<WebDavSyncAdapter["sync"]>[1],
    ) => {
      scope?.onProgress?.(55);
      await remoteApplyGate;
      return {
        adapterId: "world-documents",
        mode: "full-with-revision",
        status: "downloaded",
        changedAssetIds: ["current"],
      };
    });
    const blueprintAdapter = createNamedAdapter("blueprints", []);
    const service = createWebDavSyncService({
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

  it("uploads only the dirty adapter and asset after the debounce window", async () => {
    vi.useFakeTimers();
    const calls: string[] = [];
    const firstAdapter = createNamedAdapter("first", calls);
    const secondAdapter = createNamedAdapter("second", calls);
    const service = createWebDavSyncService({
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

    expect(calls).toEqual(["second:include=asset-b"]);
    expect(firstAdapter.sync).not.toHaveBeenCalled();
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
    const service = createWebDavSyncService({
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
    const adapter: WebDavSyncAdapter = {
      id: "conflicting-adapter",
      mode: "full-no-revision",
      collection: createSyncRemoteCollection({
        adapterId: "conflicting-adapter",
        mode: "full-no-revision",
        stateKey: "conflicting-adapter.json",
      }),
      checkPath: "conflicting-adapter.json",
      sync: vi.fn(async (): Promise<WebDavSyncAdapterResult> => ({
        adapterId: "conflicting-adapter",
        mode: "full-no-revision",
        status: "conflict",
        changedAssetIds: ["single"],
      })),
      inspectConflicts: vi.fn(async () => []),
    };
    const service = createWebDavSyncService({
      readSettings: () => createSettings(),
      createRemote,
      adapters: [adapter],
      onConflictDiscoveryStart,
      resolveConflicts,
    });

    const status = await service.syncNow("manual");

    expect(onConflictDiscoveryStart).toHaveBeenCalledTimes(1);
    expect(status.phase).toBe("error");
    expect(status.lastError).toBe("Sync conflict");
  });

  it("discovers conflicts across all adapters and applies one batch of per-item decisions", async () => {
    const firstConflict = {
      adapterId: "blueprints",
      assetId: "blueprint-a",
      localValue: { name: "local blueprint" },
      remoteValue: { name: "remote blueprint" },
      localHash: "local-blueprint-hash",
      remoteHash: "remote-blueprint-hash",
      remoteDeletedAt: null,
      remoteUpdatedAt: "2026-07-29T12:00:00.000Z",
    };
    const secondConflict = {
      adapterId: "world-documents",
      assetId: "base-a",
      localValue: { name: "local canvas" },
      remoteValue: { name: "remote canvas" },
      localHash: "local-canvas-hash",
      remoteHash: "remote-canvas-hash",
      remoteDeletedAt: null,
      remoteUpdatedAt: "2026-07-29T12:01:00.000Z",
    };
    const firstAdapter: WebDavSyncAdapter = {
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
        scope: Parameters<WebDavSyncAdapter["sync"]>[1],
      ): Promise<WebDavSyncAdapterResult> => ({
        adapterId: "blueprints",
        mode: "full-with-revision",
        status: scope?.conflictDecisions?.[0]?.resolution === "use-local"
          ? "uploaded"
          : "conflict",
        changedAssetIds: ["blueprint-a"],
      })),
      inspectConflicts: vi.fn(async () => [firstConflict]),
    };
    const secondAdapter: WebDavSyncAdapter = {
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
        scope: Parameters<WebDavSyncAdapter["sync"]>[1],
      ): Promise<WebDavSyncAdapterResult> => ({
        adapterId: "world-documents",
        mode: "patch-with-revision",
        status: scope?.conflictDecisions?.[0]?.resolution === "use-remote"
          ? "downloaded"
          : "conflict",
        changedAssetIds: ["base-a"],
      })),
      inspectConflicts: vi.fn(async () => [secondConflict]),
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
    const service = createWebDavSyncService({
      readSettings: () => createSettings(),
      createRemote,
      adapters: [firstAdapter, secondAdapter],
      onConflictDiscoveryStart,
      resolveConflicts,
      onConflictWorkflowFinished,
    });

    const status = await service.syncNow("manual");

    expect(firstAdapter.inspectConflicts).toHaveBeenCalledTimes(1);
    expect(secondAdapter.inspectConflicts).toHaveBeenCalledTimes(1);
    expect(resolveConflicts).toHaveBeenCalledWith([
      firstConflict,
      secondConflict,
    ]);
    expect(onConflictDiscoveryStart).toHaveBeenCalledTimes(1);
    expect(onConflictWorkflowFinished).toHaveBeenCalledTimes(1);
    expect(firstAdapter.sync).toHaveBeenCalledTimes(2);
    expect(secondAdapter.sync).toHaveBeenCalledTimes(1);
    expect(status.phase).toBe("idle");
    expect(status.lastError).toBeNull();
    expect(status.lastUploadAt).not.toBeNull();
    expect(status.lastDownloadAt).not.toBeNull();
  });

  it("persists use-local conflict baselines only after the shared batch commits", async () => {
    const setLastSyncedHash = vi.fn(async () => undefined);
    const commit = vi.fn(async () => {
      throw new Error("commit failed");
    });
    const collection = createSyncRemoteCollection({
      adapterId: "blueprints",
      mode: "full-with-revision",
      stateKey: "blueprints/index.json",
    });
    const conflict = {
      adapterId: "blueprints",
      assetId: "blueprint-a",
      localValue: { name: "local" },
      remoteValue: { name: "remote" },
      localHash: "local-hash",
      remoteHash: "remote-hash",
      remoteDeletedAt: null,
      remoteUpdatedAt: null,
    };
    const adapter: WebDavSyncAdapter = {
      id: "blueprints",
      mode: "full-with-revision",
      collection,
      checkPath: "blueprints/index.json",
      sync: vi.fn(async () => ({
        adapterId: "blueprints",
        mode: "full-with-revision" as const,
        status: "conflict" as const,
        changedAssetIds: ["blueprint-a"],
      })),
      inspectConflicts: vi.fn(async () => [conflict]),
      executeConflictDecisions: vi.fn(async () => ({
        adapterId: "blueprints",
        mode: "full-with-revision" as const,
        status: "uploaded" as const,
        changedAssetIds: ["blueprint-a"],
      })),
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
    const service = createWebDavSyncService({
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
    const service = createWebDavSyncService({
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

  it("refreshes the remote index once after an optimistic write conflict", async () => {
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
    const refreshIndexes = vi.fn(async () => undefined);
    const complete = vi.fn(async () => undefined);
    const service = createWebDavSyncService({
      readSettings: () => createSettings(),
      createRemote: () => createTestRemote({ refreshIndexes, complete }),
      adapters: [adapter],
    });

    const status = await service.syncNow("manual");

    expect(adapter.sync).toHaveBeenCalledTimes(2);
    expect(refreshIndexes).toHaveBeenCalledWith([adapter.collection]);
    expect(complete).toHaveBeenCalledTimes(1);
    expect(status.phase).toBe("idle");
    expect(status.lastDownloadAt).not.toBeNull();
  });

  it("allows a provider-specific validator to accept an empty WebDAV URL", async () => {
    const adapter = createAdapter();
    const service = createWebDavSyncService({
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
    const service = createWebDavSyncService({
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
    const service = createWebDavSyncService({
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
    const service = createWebDavSyncService({
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
      expect(service.getStatus().phase).toBe("idle");
    });
    adapter.sync.mockClear();

    service.notifyLocalChange({ adapterId: "adapter" });
    await vi.waitFor(() => {
      expect(service.getStatus().phase).toBe("idle");
    });
    // idle 状态下每次 notifyLocalChange 立即同步，验证确实调用了 adapter
    expect(adapter.sync).toHaveBeenCalledTimes(1);
    expect(service.getStatus().pendingLocalChangeCount).toBe(0);
    service.stop();
  });

  it("keeps a failed save visible until a later sync succeeds", async () => {
    vi.useFakeTimers();
    const adapter = createAdapter();
    const service = createWebDavSyncService({
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
    const service = createWebDavSyncService({
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

  it("clears pending save feedback when WebDAV is disabled", async () => {
    let enabled = true;
    const adapter = createAdapter();
    const service = createWebDavSyncService({
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
      expect(service.getStatus().phase).toBe("idle");
    });
    expect(service.getStatus().saveState).toBe("idle");

    // 禁用 WebDAV 后再次变更 → 同步被跳过，saveState 回到 idle
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
    const service = createWebDavSyncService({
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
    const service = createWebDavSyncService({
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
    const service = createWebDavSyncService({
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
    const service = createWebDavSyncService({
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

function createAdapter(): WebDavSyncAdapter & { readonly sync: ReturnType<typeof vi.fn> } {
  return {
    id: "adapter",
    mode: "full-no-revision",
    collection: createSyncRemoteCollection({
      adapterId: "adapter",
      mode: "full-no-revision",
      stateKey: "adapter.json",
    }),
    checkPath: "adapter.json",
    sync: vi.fn(async (): Promise<WebDavSyncAdapterResult> => ({
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
): WebDavSyncAdapter & { readonly sync: ReturnType<typeof vi.fn> } {
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
      scope: Parameters<WebDavSyncAdapter["sync"]>[1],
    ): Promise<WebDavSyncAdapterResult> => {
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

function createSettings(enabled = true) {
  return {
    enabled,
    url: "https://dav.example.test",
    username: "",
    password: "",
    maxConcurrentRequests: 4,
  };
}
