import type { SimulationContract } from "@/domain/contract/simulation-contract";
import type { WorkspaceContract } from "@/domain/contract/workspace-contract";
import type {
  SimulationBeltCargoReadModel,
  SimulationDeviceRuntimeReadModel,
  SimulationDeviceRuntimeSlotItemReadModel,
  SimulationReservedItemReadModel,
} from "@/domain/query/simulation-read-model";
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
import { SimulationWorkerRuntime } from "@/simulation/worker-runtime";
import type {
  SimulationWorkerRequest,
  SimulationWorkerResponse,
} from "./worker-protocol";
import type {
  CompiledSimulationTopology,
} from "./types";

export interface SimulationHost extends SimulationContract {
  workspace: WorkspaceContract;
  topology: SnapshotStoreReadWrite<CompiledSimulationTopology | null>;
  internalState: SimulationStateReadWrite;
  internalActions: SimulationInternalAction;
  dispose: () => void;
}

const BELT_INPUT_BUFFER_ID = "item_input_buffer";

type BeltDefinitionId =
  | "belt_straight_1x1"
  | "belt_turn_cw_1x1"
  | "belt_turn_ccw_1x1";

export function createSimulationHost(
  workspace: WorkspaceContract
): SimulationHost {
  const bridge = createSimulationWorkerBridge();
  const disposers: Array<() => void> = [];
  const topologyStore: SnapshotStoreReadWrite<CompiledSimulationTopology | null> = createSnapshotStore<CompiledSimulationTopology | null>(null);
  const internalState = createSimulationStateReadWrite();
  const actionImpl = new SimulationActionImpl({
    workspace,
    state: internalState,
    topology: topologyStore,
    bridge,
  });
  const actions: SimulationContract["actions"] = actionImpl;
  const internalActions: SimulationInternalAction = actionImpl;

  const host: SimulationHost = {
    workspace,
    internalState,
    internalActions,
    get state() {
      return internalState.state;
    },
    get simulationSpeed() {
      return internalState.simulationSpeed;
    },
    set simulationSpeed(value: number) {
      internalActions.setSimulationSpeed(value);
    },
    topology: topologyStore,
    queries: {
      getStatus: () => internalState.runtimeStatus,
      getCurrentTick: () => internalState.currentTickReadModel,
      getBeltCargoEntries: () => resolveBeltCargoEntries({
        topology: topologyStore.getSnapshot(),
        currentTickReadModel: internalState.currentTickReadModel,
      }),
      getDeviceRuntimeStatus: (deviceId) => resolveDeviceRuntimeStatus({
        topology: topologyStore.getSnapshot(),
        deviceId,
        currentTickReadModel: internalState.currentTickReadModel,
      }),
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

function resolveBeltCargoEntries(options: {
  topology: CompiledSimulationTopology | null;
  currentTickReadModel: SimulationHost["internalState"]["currentTickReadModel"];
}): readonly SimulationBeltCargoReadModel[] {
  if (options.topology === null || options.currentTickReadModel === null) {
    return [];
  }

  const entries: SimulationBeltCargoReadModel[] = [];
  for (const compiledDeviceId of options.topology.ordering.deviceOrder) {
    const device = options.topology.devices[compiledDeviceId];
    const beltShape = resolveBeltCargoShape(device?.definitionId ?? null);
    if (
      device === undefined
      || beltShape === null
      || device.sourceEntityId === null
      || device.position === null
      || device.rotation === null
    ) {
      continue;
    }

    const recipe = options.currentTickReadModel.devices[compiledDeviceId]?.recipe ?? null;
    if (recipe === null || recipe.durationTicks <= 0) {
      continue;
    }

    const inputSlotId = resolveDeviceInputSlotId(options.topology, device.cacheGroupIds);
    if (inputSlotId === null) {
      continue;
    }

    const reservationSlotId = resolveReservationSlotId(options.topology, inputSlotId);
    const itemId = resolveReservedItemId(
      options.currentTickReadModel,
      reservationSlotId,
      recipe.runId,
    );
    if (itemId === null) {
      continue;
    }

    entries.push({
      beltShape,
      position: device.position,
      rotation: device.rotation,
      itemId,
      progress: clamp01(recipe.progressTicks / recipe.durationTicks),
    });
  }

  return entries;
}

function resolveBeltCargoShape(definitionId: string | null): SimulationBeltCargoReadModel["beltShape"] | null {
  switch (definitionId as BeltDefinitionId | null) {
    case "belt_straight_1x1":
      return "straight";
    case "belt_turn_cw_1x1":
      return "turn-cw";
    case "belt_turn_ccw_1x1":
      return "turn-ccw";
    default:
      return null;
  }
}

function resolveDeviceInputSlotId(
  topology: CompiledSimulationTopology,
  cacheGroupIds: readonly string[],
): string | null {
  for (const cacheGroupId of cacheGroupIds) {
    const cacheGroup = topology.cacheGroups[cacheGroupId];
    if (cacheGroup?.sourceStorageSlotGroupId !== BELT_INPUT_BUFFER_ID) {
      continue;
    }

    return cacheGroup.slotIds[0] ?? null;
  }

  return null;
}

function resolveReservationSlotId(
  topology: CompiledSimulationTopology,
  sourceSlotId: string,
): string {
  for (const link of Object.values(topology.links)) {
    if (link.linkType !== "share-all") {
      continue;
    }

    const targetSlotId = link.targetSlotIdBySourceSlotId[sourceSlotId];
    if (targetSlotId !== undefined) {
      return targetSlotId;
    }
  }

  return sourceSlotId;
}

function resolveReservedItemId(
  currentTickReadModel: NonNullable<SimulationHost["internalState"]["currentTickReadModel"]>,
  reservationSlotId: string,
  recipeRunId: string,
): string | null {
  const slotReadModel = currentTickReadModel.slots[reservationSlotId];
  const reservation = slotReadModel?.reserved.find((entry) => entry.recipeRunId === recipeRunId);
  return reservation?.itemType ?? null;
}

function resolveDeviceRuntimeStatus(options: {
  topology: CompiledSimulationTopology | null;
  deviceId: string;
  currentTickReadModel: SimulationHost["internalState"]["currentTickReadModel"];
}): SimulationDeviceRuntimeReadModel | null {
  if (options.topology === null || options.currentTickReadModel === null) {
    return null;
  }

  const compiledDeviceId = options.topology.ordering.deviceOrder.find((topologyDeviceId) =>
    options.topology?.devices[topologyDeviceId]?.sourceEntityId === options.deviceId
  );
  if (compiledDeviceId === undefined) {
    return null;
  }

  const deviceReadModel = options.currentTickReadModel.devices[compiledDeviceId];
  if (deviceReadModel === undefined) {
    return null;
  }

  return {
    recipeId: deviceReadModel.recipe?.recipeId ?? null,
    progressSeconds: deviceReadModel.recipe === null
      ? null
      : convertSimulationTicksToSeconds(deviceReadModel.recipe.progressTicks),
    desiredSeconds: deviceReadModel.recipe === null
      ? null
      : convertSimulationTicksToSeconds(deviceReadModel.recipe.durationTicks),
    slotItems: resolveDeviceRuntimeSlotItems({
      topology: options.topology,
      compiledDeviceId,
      currentTickReadModel: options.currentTickReadModel,
    }),
  };
}

function resolveDeviceRuntimeSlotItems(options: {
  topology: CompiledSimulationTopology;
  compiledDeviceId: string;
  currentTickReadModel: NonNullable<SimulationHost["internalState"]["currentTickReadModel"]>;
}): SimulationDeviceRuntimeSlotItemReadModel[] {
  const device = options.topology.devices[options.compiledDeviceId];
  if (device === undefined) {
    return [];
  }

  const slotItemsByRealSlotKey = new Map<string, SimulationDeviceRuntimeSlotItemReadModel>();
  for (const cacheGroupId of device.cacheGroupIds) {
    const cacheGroup = options.topology.cacheGroups[cacheGroupId];
    if (cacheGroup === undefined) {
      continue;
    }

    for (const compiledSlotId of cacheGroup.slotIds) {
      const compiledSlot = options.topology.slots[compiledSlotId];
      const slotReadModel = options.currentTickReadModel.slots[compiledSlotId];
      if (compiledSlot === undefined || slotReadModel === undefined) {
        continue;
      }

      const storageGroupId = cacheGroup.sourceStorageSlotGroupId;
      const slotId = compiledSlot.sourceSlotId ?? compiledSlot.id;
      const realSlotKey = `${storageGroupId ?? "<synthetic>"}:${slotId}`;
      const existing = slotItemsByRealSlotKey.get(realSlotKey);
      const reserved = mergeReservedItems([
        ...(existing?.reserved ?? []),
        ...slotReadModel.reserved,
      ]);

      slotItemsByRealSlotKey.set(realSlotKey, {
        storageGroupId,
        slotId,
        itemType: existing?.itemType ?? slotReadModel.itemType,
        count: (existing?.count ?? 0) + slotReadModel.count,
        reserved,
      });
    }
  }

  return [...slotItemsByRealSlotKey.values()];
}

function mergeReservedItems(
  reservedItems: readonly SimulationReservedItemReadModel[],
): SimulationReservedItemReadModel[] {
  const reservedByKey = new Map<string, SimulationReservedItemReadModel>();
  for (const reservedItem of reservedItems) {
    const key = `${reservedItem.recipeRunId}:${reservedItem.itemType}`;
    const existing = reservedByKey.get(key);
    if (existing === undefined) {
      reservedByKey.set(key, { ...reservedItem });
      continue;
    }

    reservedByKey.set(key, {
      ...existing,
      amount: existing.amount + reservedItem.amount,
    });
  }

  return [...reservedByKey.values()];
}

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}

function createSimulationWorkerBridge(): SimulationWorkerBridge {
  if (typeof Worker === "function") {
    return new BrowserSimulationWorkerBridge();
  }

  return new LocalSimulationWorkerBridge();
}

class BrowserSimulationWorkerBridge implements SimulationWorkerBridge {
  private readonly worker: Worker;
  private nextRequestId = 1;
  private readonly pending = new Map<
    number,
    (response: SimulationWorkerResponse) => void
  >();

  public constructor() {
    this.worker = new Worker(new URL("./simulation-worker.ts", import.meta.url), {
      type: "module",
    });
    this.worker.addEventListener("message", (event: MessageEvent<SimulationWorkerResponse>) => {
      const resolve = this.pending.get(event.data.requestId);
      if (resolve === undefined) {
        return;
      }

      this.pending.delete(event.data.requestId);
      resolve(event.data);
    });
  }

  public loadTopology(topology: CompiledSimulationTopology): Promise<Extract<
    SimulationWorkerResponse,
    { readonly type: "topology-loaded" }
  >> {
    return this.request({
      type: "load-topology",
      requestId: this.createRequestId(),
      topology,
    }, "topology-loaded");
  }

  public getTickReadModel(tickNumber: number): Promise<Extract<
    SimulationWorkerResponse,
    { readonly type: "tick-read-model-result" }
  >> {
    return this.request({
      type: "get-tick-read-model",
      requestId: this.createRequestId(),
      tickNumber,
    }, "tick-read-model-result");
  }

  public dispose(): void {
    this.pending.clear();
    this.worker.terminate();
  }

  private request<TType extends SimulationWorkerResponse["type"]>(
    request: SimulationWorkerRequest,
    expectedType: TType,
  ): Promise<Extract<SimulationWorkerResponse, { readonly type: TType }>> {
    return new Promise((resolve) => {
      this.pending.set(request.requestId, (response) => {
        if (response.type !== expectedType) {
          throw new Error(`Unexpected simulation worker response "${response.type}".`);
        }
        resolve(response as Extract<SimulationWorkerResponse, { readonly type: TType }>);
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

  public loadTopology(topology: CompiledSimulationTopology): Promise<Extract<
    SimulationWorkerResponse,
    { readonly type: "topology-loaded" }
  >> {
    const response = this.runtime.handleRequest({
      type: "load-topology",
      requestId: this.createRequestId(),
      topology,
    });
    if (response.type !== "topology-loaded") {
      throw new Error(`Unexpected simulation worker response "${response.type}".`);
    }
    return Promise.resolve(response);
  }

  public getTickReadModel(tickNumber: number): Promise<Extract<
    SimulationWorkerResponse,
    { readonly type: "tick-read-model-result" }
  >> {
    const response = this.runtime.handleRequest({
      type: "get-tick-read-model",
      requestId: this.createRequestId(),
      tickNumber,
    });
    if (response.type !== "tick-read-model-result") {
      throw new Error(`Unexpected simulation worker response "${response.type}".`);
    }
    return Promise.resolve(response);
  }

  public dispose(): void {
    // Local runtime has no external resources.
  }

  private createRequestId(): number {
    const requestId = this.nextRequestId;
    this.nextRequestId += 1;
    return requestId;
  }
}
