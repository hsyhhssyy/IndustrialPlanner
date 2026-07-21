import { reaction } from "mobx";
import type { SimulationContract } from "@/domain/simulation/simulation-contract";
import type { WorkspaceContract } from "@/domain/document/workspace-contract";
import type {
  SimulationAdmissionCounterReset,
  SimulationDeviceRuntimeChannelRecipeStatus,
  SimulationDeviceRuntimeSlotItemReadModel,
  SimulationDeviceRuntimeStatusReadModel,
  WarehouseStatsReadModel,
} from "@/domain/simulation/types/simulation-types";
import {
  createSnapshotStore,
  type SnapshotStoreReadWrite,
} from "@/shared/snapshot/snapshot-store";
import { buildDeviceGasCoverage } from "./runtime/gas-diffusion";

import {
  SimulationActionImpl,
  type SimulationInternalAction,
  type TimelineWorkerBridge,
  type SimulationWorkerBridge,
} from "./action-impl";
import { convertSimulationTicksToSeconds } from "./tick-rate";
import {
  createSimulationStateReadWrite,
  type SimulationStateReadWrite,
} from "./state-impl";
import { SimulationWorkerRuntime } from "./worker-runtime";
import type {
  SimulationWorkerErrorNotification,
  SimulationWorkerRequest,
  SimulationWorkerResponse,
} from "./worker-protocol";
import type {
  TimelineWorkerRequest,
  TimelineWorkerResponse,
} from "./timeline-worker-protocol";
import { TimelineWorkerRuntime } from "./timeline-worker-runtime";
import type {
  CompiledSimulationTopology,
  SimulationRuntimeExport,
  RuntimeTickSnapshot,
  SimulationTopologyMigration,
} from "./types";

export interface SimulationHost extends SimulationContract {
  workspace: WorkspaceContract;
  topology: SnapshotStoreReadWrite<CompiledSimulationTopology | null>;
  internalState: SimulationStateReadWrite;
  internalActions: SimulationInternalAction;
  dispose: () => void;
}

export type SimulationHostWorkerMode = "auto" | "runtime";

export interface CreateSimulationHostOptions {
  readonly workerMode?: SimulationHostWorkerMode;
  /** 调试模式下的轻量性能统计开关。 */
  readonly getPerfEnabled?: () => boolean;
  /** 完整 Worker debugData 快照开关；应由调用方同时应用调试模式总开关。 */
  readonly getDebugDataEnabled?: () => boolean;
  readonly getActiveActivityIds?: () => readonly string[];
}

export function createSimulationHost(
  workspace: WorkspaceContract,
  options: CreateSimulationHostOptions = {},
): SimulationHost {
  const bridge = createSimulationWorkerBridge(options.workerMode ?? "auto");
  const disposers: Array<() => void> = [];
  const topologyStore: SnapshotStoreReadWrite<CompiledSimulationTopology | null> = createSnapshotStore<CompiledSimulationTopology | null>(null);
  const internalState = createSimulationStateReadWrite();
  const actionImpl = new SimulationActionImpl({
    workspace,
    state: internalState,
    topology: topologyStore,
    bridge,
    createTimelineBridge: () => createTimelineWorkerBridge(options.workerMode ?? "auto"),
    getPerfEnabled: options.getPerfEnabled,
    getDebugDataEnabled: options.getDebugDataEnabled,
    getActiveActivityIds: options.getActiveActivityIds,
  });
  const actions: SimulationContract["actions"] = actionImpl;
  const internalActions: SimulationInternalAction = actionImpl;
  let currentTickDebugRefreshInFlight = false;

  if (options.getPerfEnabled !== undefined) {
    disposers.push(reaction(
      options.getPerfEnabled,
      (debugEnabled) => internalActions.setDebugEnabled(debugEnabled),
    ));
  }

  if (options.getDebugDataEnabled !== undefined) {
    disposers.push(reaction(
      options.getDebugDataEnabled,
      (debugDataEnabled) => internalActions.setDebugDataEnabled(debugDataEnabled),
    ));
  }

  const requestPausedCurrentTickDebugRefresh = (): void => {
    const currentSnapshot = internalState.currentSnapshot;
    if (
      options.getDebugDataEnabled?.() !== true
      || internalState.runningState !== "pause"
      || currentSnapshot === null
      || currentSnapshot.debugData !== undefined
      || currentTickDebugRefreshInFlight
    ) {
      return;
    }

    currentTickDebugRefreshInFlight = true;
    void internalActions.syncToTick(currentSnapshot.tickNumber)
      .catch((error: unknown) => {
        console.error("[SimHost] Failed to refresh current tick debug data.", error);
      })
      .finally(() => {
        currentTickDebugRefreshInFlight = false;
      });
  };

  // 监听 documentSettings.powerMode 变化，自动同步到 worker。
  // editor.document 在 createSimulationHost 调用时已可用（main.tsx 中先创建 editor 再创建 simulation）。
  const editorDocument = workspace.editor?.document;
  if (editorDocument !== undefined) {
    let previousPowerMode = editorDocument.getSnapshot().documentSettings.powerMode ?? "infinite";
    let previousPowerConsumptionOverride: number | undefined =
      editorDocument.getSnapshot().documentSettings.powerConsumptionOverride;
    const unsubscribe = editorDocument.subscribe((doc) => {
      const currentPowerMode = doc.documentSettings.powerMode ?? "infinite";
      if (currentPowerMode !== previousPowerMode) {
        previousPowerMode = currentPowerMode;
        void bridge.setPowerMode(currentPowerMode).catch(() => undefined);
      }
      const currentOverride = doc.documentSettings.powerConsumptionOverride;
      if (currentOverride !== previousPowerConsumptionOverride) {
        previousPowerConsumptionOverride = currentOverride;
        void bridge.setPowerConsumptionOverride(
          typeof currentOverride === "number" && Number.isFinite(currentOverride) && currentOverride >= 0
            ? currentOverride
            : undefined,
        ).catch(() => undefined);
      }
    });
    disposers.push(unsubscribe);
  }

  const host: SimulationHost = {
    workspace,
    internalState,
    internalActions,
    get state() {
      return internalState;
    },
    topology: topologyStore,
    queries: {
      getStatusRuntimeJson: () => {
        requestPausedCurrentTickDebugRefresh();
        return JSON.stringify({
          state: {
            runningState: internalState.runningState,
            simulationSpeed: internalState.simulationSpeed,
            currentPlaybackTickNumber: internalState.currentPlaybackTickNumber,
          },
          runtimeStatus: internalState.runtimeStatus,
          currentTick: internalState.currentSnapshot === null
            ? null
            : {
                tickNumber: internalState.currentSnapshot.tickNumber,
                status: internalState.currentSnapshot.status,
                totalPowerDemand: internalState.currentSnapshot.totalPowerDemand,
                transferCount: internalState.currentSnapshot.transfers.length,
                diagnosticCount: internalState.currentSnapshot.diagnostics.length,
                ...(options.getDebugDataEnabled?.() === true
                  && internalState.currentSnapshot.debugData !== undefined
                  ? { debugData: internalState.currentSnapshot.debugData }
                  : {}),
              },
        });
      },
      getDocumentRuntimeStatus: () => {
        const topology = topologyStore.getSnapshot();
        if (topology === null) return null;
        const override = workspace.editor?.document?.getSnapshot().documentSettings.powerConsumptionOverride;
        const effectiveTotalPowerDemand =
          typeof override === "number" && Number.isFinite(override) && override >= 0
            ? override
            : topology.totalPowerDemand;
        return {
          tickNumber: internalState.currentSnapshot?.tickNumber ?? null,
          totalPowerDemand: effectiveTotalPowerDemand,
          currentPowerGeneration: internalState.currentSnapshot?.currentPowerGeneration ?? null,
          isPowerOutage: internalState.currentSnapshot?.isPowerOutage ?? false,
        };
      },
      getDeviceRuntimeStatus: (() => {
        // 帧级缓存：topology 在同一帧内引用不变，shareCapSlotIds 只需计算一次。
        // BeltCargoDecoration 等 decoration 每帧对多个 entity 调用此方法时命中缓存。
        let cachedTopology: CompiledSimulationTopology | null = null;
        let cachedShareCapSlotIds: Set<string> | null = null;

        return (deviceId: string) => {
          const topology = topologyStore.getSnapshot();
          if (topology !== cachedTopology) {
            cachedTopology = topology;
            cachedShareCapSlotIds = topology === null
              ? null
              : resolveShareCapSlotIds(topology);
          }

          return resolveDeviceRuntimeStatus({
            topology,
            deviceId,
            snapshot: internalState.currentSnapshot,
            shareCapSlotIds: cachedShareCapSlotIds,
          });
        };
      })(),
      getPipeFluidItemId: (deviceId: string) => resolvePipeFluidItemId({
        runningState: internalState.runningState,
        topology: topologyStore.getSnapshot(),
        deviceId,
        snapshot: internalState.currentSnapshot,
      }),
      isPipeDeviceSlotOccupied: (deviceId: string) => {
        const topology = topologyStore.getSnapshot();
        const snapshot = internalState.currentSnapshot;
        if (internalState.runningState === "stop" || topology === null || snapshot === null) {
          return false;
        }

        const compiledId = resolveCompiledDeviceId(topology, deviceId);
        if (compiledId === null) {
          return false;
        }

        const device = topology.devices[compiledId];
        if (device === undefined || device.transportClass !== "strict-pipe") {
          return false;
        }

        // 遍历设备节点的 slot，有任意一个非空即视为占用。
        for (const nodeId of device.nodeIds) {
          const node = topology.nodes[nodeId];
          if (node === undefined) {
            continue;
          }
          for (const slotId of node.slotIds) {
            const slotSnapshot = snapshot.slots[slotId];
            if (slotSnapshot !== undefined && slotSnapshot.itemType !== null) {
              return true;
            }
          }
        }

        return false;
      },
      getActiveGasDiffusionRanges: () =>
        (internalState.currentSnapshot?.gasDiffusions ?? []).map((diffusion) => ({
          sourceDeviceId: diffusion.sourceDeviceId,
          gasItemId: diffusion.gasItemId,
          gridRect: { ...diffusion.gridRect },
        })),
      getDeviceActiveGasItemIds: (deviceId: string): readonly string[] | null => {
        const snapshot = internalState.currentSnapshot;
        const topology = topologyStore.getSnapshot();
        if (snapshot === null || topology === null) return null;
        const diffusions = snapshot.gasDiffusions;
        if (diffusions.length === 0) return null;
        const coverage = buildDeviceGasCoverage(topology, diffusions);
        const itemIds = coverage.get(deviceId);
        return itemIds !== undefined ? [...itemIds] : null;
      },
      getWarehouseStats: (): WarehouseStatsReadModel | null => {
        const snapshot = internalState.currentSnapshot;
        if (snapshot === null || snapshot.warehouseStats === null) {
          return null;
        }
        return {
          items: Object.fromEntries(
            Object.entries(snapshot.warehouseStats.items).map(([itemType, stats]) => [
              itemType,
              {
                producedPerMinute: stats.producedPerMinute,
                consumedPerMinute: stats.consumedPerMinute,
                warehouseCount: stats.warehouseCount,
                lastChangedTick: stats.lastChangedTick,
              },
            ]),
          ),
        };
      },
    },
    actions,
    dispose: () => {
      while (disposers.length > 0) {
        disposers.pop()?.();
      }
      internalActions.reset();
      bridge.dispose();
    },
  };

  workspace.simulation = host;

  const document = workspace.editor?.document;
  if (document !== undefined) {
    disposers.push(document.subscribe(() => {
      if (internalState.hasStarted) {
        void internalActions.refreshFromCurrentDocument();
      }
    }));
  }

  return host;
}

function resolvePipeFluidItemId(options: {
  runningState: SimulationStateReadWrite["runningState"];
  topology: CompiledSimulationTopology | null;
  deviceId: string;
  snapshot: RuntimeTickSnapshot | null;
}): string | null {
  if (options.runningState === "stop" || options.topology === null || options.snapshot === null) {
    return null;
  }

  const device = options.topology.devices[options.deviceId]
    ?? options.topology.devices[`device:${options.deviceId}`];
  if (device === undefined || device.transportClass !== "strict-pipe") {
    return null;
  }

  const componentId = device.transportComponentId;
  if (componentId === null) {
    return null;
  }

  return options.snapshot.transportComponentDomain[componentId] ?? null;
}

function resolveDeviceRuntimeStatus(options: {
  topology: CompiledSimulationTopology | null;
  deviceId: string;
  snapshot: RuntimeTickSnapshot | null;
  shareCapSlotIds: Set<string> | null;
}): SimulationDeviceRuntimeStatusReadModel | null {
  if (options.topology === null || options.snapshot === null) {
    return null;
  }

  const compiledDeviceId = resolveCompiledDeviceId(options.topology, options.deviceId);
  if (compiledDeviceId === null) {
    return null;
  }

  const deviceSnapshot = options.snapshot.devices[compiledDeviceId];
  if (deviceSnapshot === undefined) {
    return null;
  }

  // AI-CORRECTION 2026-05-29: 新增 channelRecipes 映射所有 channel 运行时状态。
  const channelRecipes: Record<string, SimulationDeviceRuntimeChannelRecipeStatus | null> = {};
  if (deviceSnapshot.channelRecipes) {
    for (const [chId, chRecipe] of Object.entries(deviceSnapshot.channelRecipes)) {
      channelRecipes[chId] = chRecipe === null
        ? null
        : {
            channelId: chId,
            recipeId: chRecipe.recipeId,
            progressSeconds: convertSimulationTicksToSeconds(chRecipe.progressTicks),
            desiredSeconds: convertSimulationTicksToSeconds(chRecipe.durationTicks),
            state: chRecipe.state,
          };
    }
  }

  // AI-REMOVED 2026-05-30:
  // Reason: recipeId/progressSeconds/desiredSeconds 已从 SimulationDeviceRuntimeStatusReadModel 中移除。
  // Trigger: 接口字段迁移到 channelRecipes。
  // Evidence: 接口中已删除，所有调用方已迁移到 channelRecipes。
  // Replacement: channelRecipes
  // Risk: Low
  // Human Review: Not Required
  //
  // Original code:
  //   recipeId: deviceSnapshot.recipe?.recipeId ?? null,
  //   progressSeconds: deviceSnapshot.recipe === null
  //     ? null
  //     : convertSimulationTicksToSeconds(deviceSnapshot.recipe.progressTicks),
  //   desiredSeconds: deviceSnapshot.recipe === null
  //     ? null
  //     : convertSimulationTicksToSeconds(deviceSnapshot.recipe.durationTicks),
  return {
    channelRecipes,
    meteredConsumption: deviceSnapshot.meteredConsumption === null
      ? null
      : {
          currentWindowCount: deviceSnapshot.meteredConsumption.currentCount,
          currentWindowItemId: deviceSnapshot.meteredConsumption.currentItemId,
          previousWindowCount: deviceSnapshot.meteredConsumption.previousWindowCount,
          previousWindowItemId: deviceSnapshot.meteredConsumption.previousWindowItemId
            ?? (deviceSnapshot.meteredConsumption.previousWindowCount > 0
              ? deviceSnapshot.meteredConsumption.activeEffectItemId
              : null)
            ?? null,
        },
    admissionCounters: Object.fromEntries(
      Object.entries(deviceSnapshot.admissionCounters ?? {}).map(([portRef, counter]) => [
        portRef,
        {
          portGroupId: counter.portGroupId,
          portId: counter.portDefinitionId,
          itemType: counter.itemId,
          limit: counter.limit,
          count: counter.count,
          perMinuteLimit: counter.perMinuteLimit,
          perMinuteCount: counter.perMinuteCount,
        },
      ]),
    ),
    powerStatus: options.topology.devices[compiledDeviceId]?.powerStatus ?? null,
    slotItems: resolveDeviceRuntimeSlotItems({
      topology: options.topology,
      compiledDeviceId,
      snapshot: options.snapshot,
      shareCapSlotIds: options.shareCapSlotIds,
    }),
  };
}

function resolveCompiledDeviceId(
  topology: CompiledSimulationTopology,
  deviceId: string,
): string | null {
  if (topology.devices[deviceId] !== undefined) {
    return deviceId;
  }

  const directCompiledId = `device:${deviceId}`;
  if (topology.devices[directCompiledId] !== undefined) {
    return directCompiledId;
  }

  return topology.ordering.deviceOrder.find((topologyDeviceId) =>
    topology.devices[topologyDeviceId]?.sourceEntityId === deviceId,
  ) ?? null;
}

function resolveShareCapSlotIds(
  topology: CompiledSimulationTopology,
): Set<string> {
  return new Set(
    Object.values(topology.links)
      .filter((link) => link.linkType === "share-cap")
      .flatMap((link) => [...link.sourceSlotIds, ...link.targetSlotIds]),
  );
}

function resolveDeviceRuntimeSlotItems(options: {
  topology: CompiledSimulationTopology;
  compiledDeviceId: string;
  snapshot: RuntimeTickSnapshot;
  shareCapSlotIds: Set<string> | null;
}): SimulationDeviceRuntimeSlotItemReadModel[] {
  const device = options.topology.devices[options.compiledDeviceId];
  if (device === undefined) {
    return [];
  }

  const shareCapSlotIds = options.shareCapSlotIds ?? new Set<string>();
  const slotItemsByRealSlotKey = new Map<string, SimulationDeviceRuntimeSlotItemReadModel>();
  for (const nodeId of device.nodeIds) {
    const node = options.topology.nodes[nodeId];
    if (node === undefined) {
      continue;
    }

    for (const compiledSlotId of node.slotIds) {
      const compiledSlot = options.topology.slots[compiledSlotId];
      const slotSnapshot = options.snapshot.slots[compiledSlotId];
      if (compiledSlot === undefined || slotSnapshot === undefined) {
        continue;
      }

      const isShareCapSlot = shareCapSlotIds.has(compiledSlotId);
      const storageGroupId = compiledSlot.sourceStorageSlotGroupId ?? "synthetic";
      const sourceSlotId = compiledSlot.sourceSlotId ?? compiledSlot.id;
      const realSlotKey = isShareCapSlot
        ? compiledSlotId
        : `${storageGroupId}:${sourceSlotId}`;
      const existing = slotItemsByRealSlotKey.get(realSlotKey);
      slotItemsByRealSlotKey.set(realSlotKey, {
        // AI-CORRECTION 2026-05-13: slotType removed. viewRole alone determines slot role for display.
        storageGroupId,
        slotId: sourceSlotId,
        viewRole: isShareCapSlot ? node.viewRole : "single-view",
        itemType: existing?.itemType ?? slotSnapshot.itemType,
        count: Math.max(existing?.count ?? 0, slotSnapshot.count),
        reserved: Math.max(existing?.reserved ?? 0, slotSnapshot.reserved),
        ignoreStock: (existing?.ignoreStock ?? false) || slotSnapshot.ignoreStock,
      });
    }
  }

  return [...slotItemsByRealSlotKey.values()];
}

function createSimulationWorkerBridge(workerMode: SimulationHostWorkerMode): SimulationWorkerBridge {
  if (workerMode === "auto" && typeof Worker === "function") {
    return new BrowserSimulationWorkerBridge();
  }

  return new LocalSimulationWorkerBridge();
}

function createTimelineWorkerBridge(workerMode: SimulationHostWorkerMode): TimelineWorkerBridge {
  if (workerMode === "auto" && typeof Worker === "function") {
    return new BrowserTimelineWorkerBridge();
  }

  return new LocalTimelineWorkerBridge();
}

class BrowserTimelineWorkerBridge implements TimelineWorkerBridge {
  private readonly worker: Worker;
  private nextRequestId = 1;
  private readonly pending = new Map<
    number,
    {
      resolve: (response: TimelineWorkerResponse) => void;
      reject: (error: Error) => void;
    }
  >();

  public constructor() {
    this.worker = new Worker(new URL("./timeline-worker.ts", import.meta.url), {
      type: "module",
    });
    this.worker.addEventListener("message", (event: MessageEvent<TimelineWorkerResponse>) => {
      const handlers = this.pending.get(event.data.requestId);
      if (handlers === undefined) {
        return;
      }

      this.pending.delete(event.data.requestId);
      handlers.resolve(event.data);
    });
    this.worker.addEventListener("error", (event) => {
      const message = event.message || "Unknown timeline worker error";
      const error = new Error(`Timeline worker crashed: ${message}`);
      for (const handlers of this.pending.values()) {
        handlers.reject(error);
      }
      this.pending.clear();
    });
  }

  public loadTimeline(options: Parameters<TimelineWorkerBridge["loadTimeline"]>[0]): Promise<Extract<
    TimelineWorkerResponse,
    { readonly type: "timeline-loaded" }
  >> {
    return this.request({
      type: "load-timeline",
      requestId: this.createRequestId(),
      ...options,
    }, "timeline-loaded");
  }

  public getTimelineStatus(): Promise<Extract<
    TimelineWorkerResponse,
    { readonly type: "timeline-status" }
  >> {
    return this.request({
      type: "get-timeline-status",
      requestId: this.createRequestId(),
    }, "timeline-status");
  }

  public retargetTimeline(options: Parameters<TimelineWorkerBridge["retargetTimeline"]>[0]): Promise<Extract<
    TimelineWorkerResponse,
    { readonly type: "timeline-retargeted" }
  >> {
    return this.request({
      type: "retarget-timeline",
      requestId: this.createRequestId(),
      ...options,
    }, "timeline-retargeted");
  }

  public getTimelineCheckpoint(timelineTickNumber: number): Promise<Extract<
    TimelineWorkerResponse,
    { readonly type: "timeline-checkpoint-result" }
  >> {
    return this.request({
      type: "get-timeline-checkpoint",
      requestId: this.createRequestId(),
      timelineTickNumber,
    }, "timeline-checkpoint-result");
  }

  public getTimelinePresentationFrame(timelineTickNumber: number): Promise<Extract<
    TimelineWorkerResponse,
    { readonly type: "timeline-presentation-frame-result" }
  >> {
    return this.request({
      type: "get-timeline-presentation-frame",
      requestId: this.createRequestId(),
      timelineTickNumber,
    }, "timeline-presentation-frame-result");
  }

  public getTimelinePresentationFrameRange(fromTimelineTickNumber: number, toTimelineTickNumber: number): Promise<Extract<
    TimelineWorkerResponse,
    { readonly type: "timeline-presentation-frame-range-result" }
  >> {
    return this.request({
      type: "get-timeline-presentation-frame-range",
      requestId: this.createRequestId(),
      fromTimelineTickNumber,
      toTimelineTickNumber,
    }, "timeline-presentation-frame-range-result");
  }

  public stopTimeline(): Promise<Extract<
    TimelineWorkerResponse,
    { readonly type: "timeline-stopped" }
  >> {
    return this.request({
      type: "stop-timeline",
      requestId: this.createRequestId(),
    }, "timeline-stopped");
  }

  public dispose(): void {
    const error = new Error("Timeline worker disposed");
    for (const handlers of this.pending.values()) {
      handlers.reject(error);
    }
    this.pending.clear();
    this.worker.terminate();
  }

  private request<TType extends TimelineWorkerResponse["type"]>(
    request: TimelineWorkerRequest,
    expectedType: TType,
  ): Promise<Extract<TimelineWorkerResponse, { readonly type: TType }>> {
    return new Promise((resolve, reject) => {
      this.pending.set(request.requestId, {
        resolve: (response) => {
          if (response.type !== expectedType) {
            reject(new Error(`Unexpected timeline worker response "${response.type}".`));
            return;
          }
          resolve(response as Extract<TimelineWorkerResponse, { readonly type: TType }>);
        },
        reject,
      });
      this.worker.postMessage(request);
    });
  }

  private createRequestId(): number {
    const requestId = this.nextRequestId;
    this.nextRequestId += 1;
    return requestId;
  }
}

class LocalTimelineWorkerBridge implements TimelineWorkerBridge {
  private readonly runtime = new TimelineWorkerRuntime();
  private nextRequestId = 1;

  public loadTimeline(options: Parameters<TimelineWorkerBridge["loadTimeline"]>[0]): Promise<Extract<
    TimelineWorkerResponse,
    { readonly type: "timeline-loaded" }
  >> {
    const response = this.runtime.handleRequest({
      type: "load-timeline",
      requestId: this.createRequestId(),
      ...options,
    });
    if (response.type !== "timeline-loaded") {
      throw new Error(`Unexpected timeline worker response "${response.type}".`);
    }
    return Promise.resolve(response);
  }

  public getTimelineStatus(): Promise<Extract<
    TimelineWorkerResponse,
    { readonly type: "timeline-status" }
  >> {
    const response = this.runtime.handleRequest({
      type: "get-timeline-status",
      requestId: this.createRequestId(),
    });
    if (response.type !== "timeline-status") {
      throw new Error(`Unexpected timeline worker response "${response.type}".`);
    }
    return Promise.resolve(response);
  }

  public retargetTimeline(options: Parameters<TimelineWorkerBridge["retargetTimeline"]>[0]): Promise<Extract<
    TimelineWorkerResponse,
    { readonly type: "timeline-retargeted" }
  >> {
    const response = this.runtime.handleRequest({
      type: "retarget-timeline",
      requestId: this.createRequestId(),
      ...options,
    });
    if (response.type !== "timeline-retargeted") {
      throw new Error(`Unexpected timeline worker response "${response.type}".`);
    }
    return Promise.resolve(response);
  }

  public getTimelineCheckpoint(timelineTickNumber: number): Promise<Extract<
    TimelineWorkerResponse,
    { readonly type: "timeline-checkpoint-result" }
  >> {
    const response = this.runtime.handleRequest({
      type: "get-timeline-checkpoint",
      requestId: this.createRequestId(),
      timelineTickNumber,
    });
    if (response.type !== "timeline-checkpoint-result") {
      throw new Error(`Unexpected timeline worker response "${response.type}".`);
    }
    return Promise.resolve(response);
  }

  public getTimelinePresentationFrame(timelineTickNumber: number): Promise<Extract<
    TimelineWorkerResponse,
    { readonly type: "timeline-presentation-frame-result" }
  >> {
    const response = this.runtime.handleRequest({
      type: "get-timeline-presentation-frame",
      requestId: this.createRequestId(),
      timelineTickNumber,
    });
    if (response.type !== "timeline-presentation-frame-result") {
      throw new Error(`Unexpected timeline worker response "${response.type}".`);
    }
    return Promise.resolve(response);
  }

  public getTimelinePresentationFrameRange(fromTimelineTickNumber: number, toTimelineTickNumber: number): Promise<Extract<
    TimelineWorkerResponse,
    { readonly type: "timeline-presentation-frame-range-result" }
  >> {
    const response = this.runtime.handleRequest({
      type: "get-timeline-presentation-frame-range",
      requestId: this.createRequestId(),
      fromTimelineTickNumber,
      toTimelineTickNumber,
    });
    if (response.type !== "timeline-presentation-frame-range-result") {
      throw new Error(`Unexpected timeline worker response "${response.type}".`);
    }
    return Promise.resolve(response);
  }

  public stopTimeline(): Promise<Extract<
    TimelineWorkerResponse,
    { readonly type: "timeline-stopped" }
  >> {
    const response = this.runtime.handleRequest({
      type: "stop-timeline",
      requestId: this.createRequestId(),
    });
    if (response.type !== "timeline-stopped") {
      throw new Error(`Unexpected timeline worker response "${response.type}".`);
    }
    return Promise.resolve(response);
  }

  public dispose(): void {
    this.runtime.stop();
  }

  private createRequestId(): number {
    const requestId = this.nextRequestId;
    this.nextRequestId += 1;
    return requestId;
  }
}

class BrowserSimulationWorkerBridge implements SimulationWorkerBridge {
  private readonly worker: Worker;
  private nextRequestId = 1;
  private readonly pending = new Map<
    number,
    {
      resolve: (response: SimulationWorkerResponse) => void;
      reject: (error: Error) => void;
    }
  >();

  public constructor() {
    this.worker = new Worker(new URL("./simulation-worker.ts", import.meta.url), {
      type: "module",
    });
    this.worker.addEventListener("message", (event: MessageEvent<SimulationWorkerResponse | SimulationWorkerErrorNotification>) => {
      if (event.data.type === "worker-error") {
        // Worker 异步路径（fillOneTick/advanceToTick setTimeout 回调）中捕获的错误，
        // 主动推送到主线程，通过 console.error 输出以纳入 debug-log 窗口。
        const notification = event.data;
        const tickInfo = notification.tickNumber !== null ? ` at tick ${notification.tickNumber}` : "";
        console.error(`[SimWorker] ${notification.error}${tickInfo}`);
        return;
      }

      const handlers = this.pending.get(event.data.requestId);
      if (handlers === undefined) {
        return;
      }

      this.pending.delete(event.data.requestId);
      handlers.resolve(event.data);
    });
    this.worker.addEventListener("error", (event) => {
      const message = event.message || "Unknown worker error";
      console.error(`[SimWorker] ${message}`, event.filename, event.lineno);
      const error = new Error(`Simulation worker crashed: ${message}`);
      for (const handlers of this.pending.values()) {
        handlers.reject(error);
      }
      this.pending.clear();
    });
  }

  public loadTopology(topology: CompiledSimulationTopology, migration?: SimulationTopologyMigration, perfEnabled?: boolean, simulationSpeed?: number, debugDataEnabled?: boolean): Promise<Extract<
    SimulationWorkerResponse,
    { readonly type: "topology-loaded" }
  >> {
    return this.request({
      type: "load-topology",
      requestId: this.createRequestId(),
      topology,
      migration,
      perfEnabled,
      debugDataEnabled,
      simulationSpeed,
    }, "topology-loaded");
  }

  public getTickSnapshot(tickNumber: number, simulationSpeed?: number, retainTickNumber?: number): Promise<Extract<
    SimulationWorkerResponse,
    { readonly type: "tick-snapshot-result" }
  >> {
    return this.request({
      type: "get-tick-snapshot",
      requestId: this.createRequestId(),
      tickNumber,
      retainTickNumber,
      simulationSpeed,
    }, "tick-snapshot-result");
  }

  public getTickSnapshotRange(fromTickNumber: number, toTickNumber: number, generation: number, simulationSpeed?: number): Promise<Extract<
    SimulationWorkerResponse,
    { readonly type: "tick-snapshot-range-result" }
  >> {
    return this.request({
      type: "get-tick-snapshot-range",
      requestId: this.createRequestId(),
      fromTickNumber,
      toTickNumber,
      generation,
      simulationSpeed,
    }, "tick-snapshot-range-result");
  }

  public acknowledgePresentedTick(tickNumber: number, generation: number): Promise<Extract<
    SimulationWorkerResponse,
    { readonly type: "presented-tick-acknowledged" }
  >> {
    return this.request({
      type: "acknowledge-presented-tick",
      requestId: this.createRequestId(),
      tickNumber,
      generation,
    }, "presented-tick-acknowledged");
  }

  public setDebugEnabled(value: boolean): Promise<Extract<
    SimulationWorkerResponse,
    { readonly type: "debug-enabled-set" }
  >> {
    return this.request({
      type: "set-debug-enabled",
      requestId: this.createRequestId(),
      debugEnabled: value,
    }, "debug-enabled-set");
  }

  public setDebugDataEnabled(value: boolean): Promise<Extract<
    SimulationWorkerResponse,
    { readonly type: "debug-data-enabled-set" }
  >> {
    return this.request({
      type: "set-debug-data-enabled",
      requestId: this.createRequestId(),
      debugDataEnabled: value,
    }, "debug-data-enabled-set");
  }

  public setSimulationSpeed(value: number): Promise<Extract<
    SimulationWorkerResponse,
    { readonly type: "simulation-speed-set" }
  >> {
    return this.request({
      type: "set-simulation-speed",
      requestId: this.createRequestId(),
      simulationSpeed: value,
    }, "simulation-speed-set");
  }

  public patchRuntimeSlot(patch: Parameters<SimulationWorkerBridge["patchRuntimeSlot"]>[0]): Promise<Extract<
    SimulationWorkerResponse,
    { readonly type: "runtime-slot-patched" }
  >> {
    return this.request({
      type: "patch-runtime-slot",
      requestId: this.createRequestId(),
      patch,
    }, "runtime-slot-patched");
  }

  public resetAdmissionCounter(reset: SimulationAdmissionCounterReset): Promise<Extract<
    SimulationWorkerResponse,
    { readonly type: "admission-counter-reset" }
  >> {
    return this.request({
      type: "reset-admission-counter",
      requestId: this.createRequestId(),
      reset,
    }, "admission-counter-reset");
  }

  public getPerfReport(): Promise<Extract<
    SimulationWorkerResponse,
    { readonly type: "perf-report" }
  >> {
    return this.request({
      type: "get-perf-report",
      requestId: this.createRequestId(),
    }, "perf-report");
  }

  public exportRuntimeState(tickNumber?: number): Promise<Extract<
    SimulationWorkerResponse,
    { readonly type: "runtime-state-exported" }
  >> {
    return this.request({
      type: "export-runtime-state",
      requestId: this.createRequestId(),
      tickNumber,
    }, "runtime-state-exported");
  }

  public importRuntimeState(runtimeExport: SimulationRuntimeExport): Promise<Extract<
    SimulationWorkerResponse,
    { readonly type: "runtime-state-imported" }
  >> {
    return this.request({
      type: "import-runtime-state",
      requestId: this.createRequestId(),
      runtimeExport,
    }, "runtime-state-imported");
  }

  public setPowerMode(powerMode: "real" | "infinite"): Promise<Extract<
    SimulationWorkerResponse,
    { readonly type: "power-mode-set" }
  >> {
    return this.request({
      type: "set-power-mode",
      requestId: this.createRequestId(),
      powerMode,
    }, "power-mode-set");
  }

  public setPowerConsumptionOverride(powerConsumptionOverride: number | undefined): Promise<Extract<
    SimulationWorkerResponse,
    { readonly type: "power-consumption-override-set" }
  >> {
    return this.request({
      type: "set-power-consumption-override",
      requestId: this.createRequestId(),
      powerConsumptionOverride,
    }, "power-consumption-override-set");
  }

  public dispose(): void {
    const error = new Error("Simulation worker disposed");
    for (const handlers of this.pending.values()) {
      handlers.reject(error);
    }
    this.pending.clear();
    this.worker.terminate();
  }

  private request<TType extends SimulationWorkerResponse["type"]>(
    request: SimulationWorkerRequest,
    expectedType: TType,
  ): Promise<Extract<SimulationWorkerResponse, { readonly type: TType }>> {
    return new Promise((resolve, reject) => {
      this.pending.set(request.requestId, {
        resolve: (response) => {
          if (response.type !== expectedType) {
            reject(new Error(`Unexpected simulation worker response "${response.type}".`));
            return;
          }
          resolve(response as Extract<SimulationWorkerResponse, { readonly type: TType }>);
        },
        reject,
      });
      this.worker.postMessage(request);
    });
  }

  private createRequestId(): number {
    const requestId = this.nextRequestId;
    this.nextRequestId += 1;
    return requestId;
  }
}

class LocalSimulationWorkerBridge implements SimulationWorkerBridge {
  private readonly runtime = new SimulationWorkerRuntime();
  private nextRequestId = 1;

  public loadTopology(topology: CompiledSimulationTopology, migration?: SimulationTopologyMigration, perfEnabled?: boolean, simulationSpeed?: number, debugDataEnabled?: boolean): Promise<Extract<
    SimulationWorkerResponse,
    { readonly type: "topology-loaded" }
  >> {
    const response = this.runtime.handleRequest({
      type: "load-topology",
      requestId: this.createRequestId(),
      topology,
      migration,
      perfEnabled,
      debugDataEnabled,
      simulationSpeed,
    });
    if (response.type !== "topology-loaded") {
      throw new Error(`Unexpected simulation worker response "${response.type}".`);
    }
    return Promise.resolve(response);
  }

  public getTickSnapshot(tickNumber: number, simulationSpeed?: number, retainTickNumber?: number): Promise<Extract<
    SimulationWorkerResponse,
    { readonly type: "tick-snapshot-result" }
  >> {
    // Local 模式无事件循环，setTimeout 不触发，需同步推进到目标 tick。
    const initialResponse = this.runtime.handleRequest({
      type: "get-tick-snapshot",
      requestId: this.createRequestId(),
      tickNumber,
      retainTickNumber,
      simulationSpeed,
    });
    if (initialResponse.type !== "tick-snapshot-result") {
      throw new Error(`Unexpected simulation worker response "${initialResponse.type}".`);
    }
    if (initialResponse.result.status.status === "ready") {
      return Promise.resolve(initialResponse);
    }

    this.runtime.advanceToTick(tickNumber);
    const response = this.runtime.handleRequest({
      type: "get-tick-snapshot",
      requestId: this.createRequestId(),
      tickNumber,
      retainTickNumber,
      simulationSpeed,
    });
    if (response.type !== "tick-snapshot-result") {
      throw new Error(`Unexpected simulation worker response "${response.type}".`);
    }
    return Promise.resolve(response);
  }

  public getTickSnapshotRange(fromTickNumber: number, toTickNumber: number, generation: number, simulationSpeed?: number): Promise<Extract<
    SimulationWorkerResponse,
    { readonly type: "tick-snapshot-range-result" }
  >> {
    // Local 模式没有后台事件循环；同步推进仅用于保持与 Browser Worker 相同的可用范围语义。
    this.runtime.advanceToTick(toTickNumber);
    const response = this.runtime.handleRequest({
      type: "get-tick-snapshot-range",
      requestId: this.createRequestId(),
      fromTickNumber,
      toTickNumber,
      generation,
      simulationSpeed,
    });
    if (response.type !== "tick-snapshot-range-result") {
      throw new Error(`Unexpected simulation worker response "${response.type}".`);
    }
    return Promise.resolve(response);
  }

  public acknowledgePresentedTick(tickNumber: number, generation: number): Promise<Extract<
    SimulationWorkerResponse,
    { readonly type: "presented-tick-acknowledged" }
  >> {
    const response = this.runtime.handleRequest({
      type: "acknowledge-presented-tick",
      requestId: this.createRequestId(),
      tickNumber,
      generation,
    });
    if (response.type !== "presented-tick-acknowledged") {
      throw new Error(`Unexpected simulation worker response "${response.type}".`);
    }
    return Promise.resolve(response);
  }

  public setDebugEnabled(value: boolean): Promise<Extract<
    SimulationWorkerResponse,
    { readonly type: "debug-enabled-set" }
  >> {
    const response = this.runtime.handleRequest({
      type: "set-debug-enabled",
      requestId: this.createRequestId(),
      debugEnabled: value,
    });
    if (response.type !== "debug-enabled-set") {
      throw new Error(`Unexpected simulation worker response "${response.type}".`);
    }
    return Promise.resolve(response);
  }

  public setDebugDataEnabled(value: boolean): Promise<Extract<
    SimulationWorkerResponse,
    { readonly type: "debug-data-enabled-set" }
  >> {
    const response = this.runtime.handleRequest({
      type: "set-debug-data-enabled",
      requestId: this.createRequestId(),
      debugDataEnabled: value,
    });
    if (response.type !== "debug-data-enabled-set") {
      throw new Error(`Unexpected simulation worker response "${response.type}".`);
    }
    return Promise.resolve(response);
  }

  public setSimulationSpeed(value: number): Promise<Extract<
    SimulationWorkerResponse,
    { readonly type: "simulation-speed-set" }
  >> {
    const response = this.runtime.handleRequest({
      type: "set-simulation-speed",
      requestId: this.createRequestId(),
      simulationSpeed: value,
    });
    if (response.type !== "simulation-speed-set") {
      throw new Error(`Unexpected simulation worker response "${response.type}".`);
    }
    return Promise.resolve(response);
  }

  public patchRuntimeSlot(patch: Parameters<SimulationWorkerBridge["patchRuntimeSlot"]>[0]): Promise<Extract<
    SimulationWorkerResponse,
    { readonly type: "runtime-slot-patched" }
  >> {
    const response = this.runtime.handleRequest({
      type: "patch-runtime-slot",
      requestId: this.createRequestId(),
      patch,
    });
    if (response.type !== "runtime-slot-patched") {
      throw new Error(`Unexpected simulation worker response "${response.type}".`);
    }
    return Promise.resolve(response);
  }

  public resetAdmissionCounter(reset: SimulationAdmissionCounterReset): Promise<Extract<
    SimulationWorkerResponse,
    { readonly type: "admission-counter-reset" }
  >> {
    const response = this.runtime.handleRequest({
      type: "reset-admission-counter",
      requestId: this.createRequestId(),
      reset,
    });
    if (response.type !== "admission-counter-reset") {
      throw new Error(`Unexpected simulation worker response "${response.type}".`);
    }
    return Promise.resolve(response);
  }

  public getPerfReport(): Promise<Extract<
    SimulationWorkerResponse,
    { readonly type: "perf-report" }
  >> {
    const response = this.runtime.handleRequest({
      type: "get-perf-report",
      requestId: this.createRequestId(),
    });
    if (response.type !== "perf-report") {
      throw new Error(`Unexpected simulation worker response "${response.type}".`);
    }
    return Promise.resolve(response);
  }

  public exportRuntimeState(tickNumber?: number): Promise<Extract<
    SimulationWorkerResponse,
    { readonly type: "runtime-state-exported" }
  >> {
    const response = this.runtime.handleRequest({
      type: "export-runtime-state",
      requestId: this.createRequestId(),
      tickNumber,
    });
    if (response.type !== "runtime-state-exported") {
      throw new Error(`Unexpected simulation worker response "${response.type}".`);
    }
    return Promise.resolve(response);
  }

  public importRuntimeState(runtimeExport: SimulationRuntimeExport): Promise<Extract<
    SimulationWorkerResponse,
    { readonly type: "runtime-state-imported" }
  >> {
    const response = this.runtime.handleRequest({
      type: "import-runtime-state",
      requestId: this.createRequestId(),
      runtimeExport,
    });
    if (response.type !== "runtime-state-imported") {
      throw new Error(`Unexpected simulation worker response "${response.type}".`);
    }
    return Promise.resolve(response);
  }

  public setPowerMode(powerMode: "real" | "infinite"): Promise<Extract<
    SimulationWorkerResponse,
    { readonly type: "power-mode-set" }
  >> {
    const response = this.runtime.handleRequest({
      type: "set-power-mode",
      requestId: this.createRequestId(),
      powerMode,
    });
    if (response.type !== "power-mode-set") {
      throw new Error(`Unexpected simulation worker response "${response.type}".`);
    }
    return Promise.resolve(response);
  }

  public setPowerConsumptionOverride(powerConsumptionOverride: number | undefined): Promise<Extract<
    SimulationWorkerResponse,
    { readonly type: "power-consumption-override-set" }
  >> {
    const response = this.runtime.handleRequest({
      type: "set-power-consumption-override",
      requestId: this.createRequestId(),
      powerConsumptionOverride,
    });
    if (response.type !== "power-consumption-override-set") {
      throw new Error(`Unexpected simulation worker response "${response.type}".`);
    }
    return Promise.resolve(response);
  }

  public dispose(): void {
  }

  private createRequestId(): number {
    const requestId = this.nextRequestId;
    this.nextRequestId += 1;
    return requestId;
  }
}
