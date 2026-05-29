import type { SimulationContract } from "@/domain/simulation/simulation-contract";
import type { WorkspaceContract } from "@/domain/document/workspace-contract";
import type {
  SimulationDeviceRuntimeChannelRecipeStatus,
  SimulationDeviceRuntimeSlotItemReadModel,
  SimulationDeviceRuntimeStatusReadModel,
} from "@/domain/simulation/types/simulation-types";
import {
  createSnapshotStore,
  type SnapshotStoreReadWrite,
} from "@/shared/snapshot/snapshot-store";

import {
  SimulationActionImpl,
  type SimulationInternalAction,
  type SimulationWorkerBridge,
} from "./action-impl";
import { convertSimulationTicksToSeconds } from "./tick-rate";
import {
  createSimulationStateReadWrite,
  type SimulationStateReadWrite,
} from "./state-impl";
import { SimulationWorkerRuntime } from "./worker-runtime";
import type {
  SimulationWorkerRequest,
  SimulationWorkerResponse,
} from "./worker-protocol";
import type {
  CompiledSimulationTopology,
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
  readonly getPerfEnabled?: () => boolean;
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
    getPerfEnabled: options.getPerfEnabled,
  });
  const actions: SimulationContract["actions"] = actionImpl;
  const internalActions: SimulationInternalAction = actionImpl;

  // 监听 documentSettings.powerMode 变化，自动同步到 worker。
  // editor.document 在 createSimulationHost 调用时已可用（main.tsx 中先创建 editor 再创建 simulation）。
  const editorDocument = workspace.editor?.document;
  if (editorDocument !== undefined) {
    let previousPowerMode = editorDocument.getSnapshot().documentSettings.powerMode ?? "infinite";
    const unsubscribe = editorDocument.subscribe((doc) => {
      const currentPowerMode = doc.documentSettings.powerMode ?? "infinite";
      if (currentPowerMode !== previousPowerMode) {
        previousPowerMode = currentPowerMode;
        void bridge.setPowerMode(currentPowerMode).catch(() => undefined);
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
      getStatusRuntimeJson: () => JSON.stringify({
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
            },
      }),
      getDocumentRuntimeStatus: () => {
        const topology = topologyStore.getSnapshot();
        if (topology === null) return null;
        return {
          tickNumber: internalState.currentSnapshot?.tickNumber ?? null,
          totalPowerDemand: topology.totalPowerDemand,
          currentPowerGeneration: internalState.currentSnapshot?.currentPowerGeneration ?? null,
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
          };
    }
  }

  return {
    recipeId: deviceSnapshot.recipe?.recipeId ?? null,
    progressSeconds: deviceSnapshot.recipe === null
      ? null
      : convertSimulationTicksToSeconds(deviceSnapshot.recipe.progressTicks),
    desiredSeconds: deviceSnapshot.recipe === null
      ? null
      : convertSimulationTicksToSeconds(deviceSnapshot.recipe.durationTicks),
    channelRecipes,
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
    this.worker.addEventListener("message", (event: MessageEvent<SimulationWorkerResponse>) => {
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

  public loadTopology(topology: CompiledSimulationTopology, migration?: SimulationTopologyMigration, perfEnabled?: boolean, simulationSpeed?: number): Promise<Extract<
    SimulationWorkerResponse,
    { readonly type: "topology-loaded" }
  >> {
    return this.request({
      type: "load-topology",
      requestId: this.createRequestId(),
      topology,
      migration,
      perfEnabled,
      simulationSpeed,
    }, "topology-loaded");
  }

  public getTickSnapshot(tickNumber: number, simulationSpeed?: number): Promise<Extract<
    SimulationWorkerResponse,
    { readonly type: "tick-snapshot-result" }
  >> {
    return this.request({
      type: "get-tick-snapshot",
      requestId: this.createRequestId(),
      tickNumber,
      simulationSpeed,
    }, "tick-snapshot-result");
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

  public getPerfReport(): Promise<Extract<
    SimulationWorkerResponse,
    { readonly type: "perf-report" }
  >> {
    return this.request({
      type: "get-perf-report",
      requestId: this.createRequestId(),
    }, "perf-report");
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

  public loadTopology(topology: CompiledSimulationTopology, migration?: SimulationTopologyMigration, perfEnabled?: boolean, simulationSpeed?: number): Promise<Extract<
    SimulationWorkerResponse,
    { readonly type: "topology-loaded" }
  >> {
    const response = this.runtime.handleRequest({
      type: "load-topology",
      requestId: this.createRequestId(),
      topology,
      migration,
      perfEnabled,
      simulationSpeed,
    });
    if (response.type !== "topology-loaded") {
      throw new Error(`Unexpected simulation worker response "${response.type}".`);
    }
    return Promise.resolve(response);
  }

  public getTickSnapshot(tickNumber: number, simulationSpeed?: number): Promise<Extract<
    SimulationWorkerResponse,
    { readonly type: "tick-snapshot-result" }
  >> {
    // Local 模式无事件循环，setTimeout 不触发，需同步推进到目标 tick。
    const initialResponse = this.runtime.handleRequest({
      type: "get-tick-snapshot",
      requestId: this.createRequestId(),
      tickNumber,
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
      simulationSpeed,
    });
    if (response.type !== "tick-snapshot-result") {
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

  public dispose(): void {
  }

  private createRequestId(): number {
    const requestId = this.nextRequestId;
    this.nextRequestId += 1;
    return requestId;
  }
}
