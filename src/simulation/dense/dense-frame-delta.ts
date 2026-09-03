import type {
  RuntimeDeviceSnapshot,
  RuntimeDiagnosticSnapshot,
  RuntimeNodeSnapshot,
  RuntimeTickSnapshot,
  WarehouseItemStats,
} from "../types";
import type { SimulationPresentationProjection } from "../projection/presentation-projection";
import {
  DENSE_INDEX_NONE,
  DENSE_SIMULATION_PROTOCOL_VERSION,
  createDenseTopologyLookup,
  type DenseTopologyDictionary,
  type DenseTopologyLookup,
} from "./dense-topology";

const SLOT_FLAG_IGNORE_STOCK = 1;
const FRAME_STATUS_INITIAL = 0;
const FRAME_STATUS_RUNNING = 1;
const WAREHOUSE_UNCHANGED = 0;
const WAREHOUSE_CLEARED = 1;
const WAREHOUSE_PATCHED = 2;

export interface DenseFrameDelta {
  readonly protocolVersion: typeof DENSE_SIMULATION_PROTOCOL_VERSION;
  readonly sessionId: string;
  readonly topologyVersion: number;
  readonly topologyId: string;
  readonly documentHash: string;
  readonly frameSequence: number;
  readonly fromTickNumber: number;
  readonly tickNumber: number;
  readonly status: typeof FRAME_STATUS_INITIAL | typeof FRAME_STATUS_RUNNING;
  readonly debugData?: string;
  readonly totalPowerDemand: number;
  readonly currentPowerGeneration: number;
  readonly isPowerOutage: boolean;
  readonly baseBatteryJoules: number;
  readonly baseBatteryCapacity: number;
  readonly changedSlotIndexes: Uint32Array;
  readonly changedSlotItemIndexes: Int32Array;
  readonly changedSlotNumbers: Float64Array;
  readonly changedSlotFlags: Uint8Array;
  readonly changedDeviceIndexes: Uint32Array;
  readonly changedDevices: readonly RuntimeDeviceSnapshot[];
  readonly changedNodeIndexes: Uint32Array;
  readonly changedNodes: readonly RuntimeNodeSnapshot[];
  readonly routingCursorKeys: readonly string[];
  readonly routingCursorValues: Float64Array;
  readonly removedRoutingCursorKeys: readonly string[];
  readonly changedComponentIndexes: Uint32Array;
  readonly changedComponentItemIndexes: Int32Array;
  readonly transferEdgeIndexes: Uint32Array;
  readonly transferSourceSlotIndexes: Uint32Array;
  readonly transferTargetSlotIndexes: Uint32Array;
  readonly transferItemIndexes: Uint32Array;
  readonly transferAmounts: Float64Array;
  readonly diagnostics: readonly RuntimeDiagnosticSnapshot[];
  readonly gasSourceDeviceIndexes: Uint32Array;
  readonly gasItemIndexes: Uint32Array;
  readonly gasGridRects: Float64Array;
  readonly warehouseMode:
    | typeof WAREHOUSE_UNCHANGED
    | typeof WAREHOUSE_CLEARED
    | typeof WAREHOUSE_PATCHED;
  readonly warehouseStatsWindowReady: boolean;
  readonly changedWarehouseItemIndexes: Uint32Array;
  readonly changedWarehouseItemNumbers: Float64Array;
  readonly changedWarehouseItemFlags: Uint8Array;
  readonly removedWarehouseItemIndexes: Uint32Array;
}

export interface DenseProjectionReadModel extends SimulationPresentationProjection {
  readonly tickNumber: number | null;
  readonly frameSequence: number;
  materializeSnapshot(): RuntimeTickSnapshot;
}

export class DenseFrameDeltaEncoder {
  private readonly lookup: DenseTopologyLookup;
  private previous: RuntimeTickSnapshot | null = null;
  private nextFrameSequence = 1;

  public constructor(
    private readonly dictionary: DenseTopologyDictionary,
    private readonly session: {
      readonly sessionId: string;
      readonly topologyVersion: number;
    },
  ) {
    assertSessionIdentity(session);
    this.lookup = createDenseTopologyLookup(dictionary);
  }

  public encode(snapshot: RuntimeTickSnapshot): DenseFrameDelta {
    this.assertSnapshotIdentity(snapshot);
    const previous = this.previous;
    if (previous !== null && snapshot.tickNumber < previous.tickNumber) {
      throw new Error(
        `Dense frame encoder cannot move backwards from tick ${previous.tickNumber} to ${snapshot.tickNumber}.`,
      );
    }
    const changedSlotIndexes: number[] = [];
    const changedSlotItemIndexes: number[] = [];
    const changedSlotNumbers: number[] = [];
    const changedSlotFlags: number[] = [];

    for (let slotIndex = 0; slotIndex < this.dictionary.slotIds.length; slotIndex += 1) {
      const slotId = this.dictionary.slotIds[slotIndex]!;
      const value = snapshot.slots[slotId];
      if (value === undefined) {
        throw new Error(`Dense frame is missing slot "${slotId}".`);
      }
      if (previous !== null && areSlotSnapshotsEqual(value, previous.slots[slotId])) {
        continue;
      }

      changedSlotIndexes.push(slotIndex);
      changedSlotItemIndexes.push(this.resolveOptionalItemIndex(value.itemType));
      changedSlotNumbers.push(value.count, value.reserved);
      changedSlotFlags.push(value.ignoreStock ? SLOT_FLAG_IGNORE_STOCK : 0);
    }

    const changedDeviceIndexes: number[] = [];
    const changedDevices: RuntimeDeviceSnapshot[] = [];
    for (
      let deviceIndex = 0;
      deviceIndex < this.dictionary.deviceIds.length;
      deviceIndex += 1
    ) {
      const deviceId = this.dictionary.deviceIds[deviceIndex]!;
      const value = snapshot.devices[deviceId];
      if (value === undefined) {
        throw new Error(`Dense frame is missing device "${deviceId}".`);
      }
      if (previous !== null && areDeviceSnapshotsEqual(value, previous.devices[deviceId])) {
        continue;
      }
      changedDeviceIndexes.push(deviceIndex);
      changedDevices.push(value);
    }

    const changedNodeIndexes: number[] = [];
    const changedNodes: RuntimeNodeSnapshot[] = [];
    for (let nodeIndex = 0; nodeIndex < this.dictionary.nodeIds.length; nodeIndex += 1) {
      const nodeId = this.dictionary.nodeIds[nodeIndex]!;
      const value = snapshot.nodes[nodeId];
      if (value === undefined) {
        throw new Error(`Dense frame is missing node "${nodeId}".`);
      }
      if (previous !== null && areNodeSnapshotsEqual(value, previous.nodes[nodeId])) {
        continue;
      }
      changedNodeIndexes.push(nodeIndex);
      changedNodes.push(value);
    }

    const routingCursorKeys: string[] = [];
    const routingCursorValues: number[] = [];
    for (const key of Object.keys(snapshot.routingCursors).sort(compareStableIds)) {
      const value = snapshot.routingCursors[key]!;
      if (previous?.routingCursors[key] === value) {
        continue;
      }
      routingCursorKeys.push(key);
      routingCursorValues.push(value);
    }
    const removedRoutingCursorKeys = previous === null
      ? []
      : Object.keys(previous.routingCursors)
          .filter((key) => snapshot.routingCursors[key] === undefined)
          .sort(compareStableIds);

    const changedComponentIndexes: number[] = [];
    const changedComponentItemIndexes: number[] = [];
    for (
      let componentIndex = 0;
      componentIndex < this.dictionary.componentIds.length;
      componentIndex += 1
    ) {
      const componentId = this.dictionary.componentIds[componentIndex]!;
      const itemType = snapshot.transportComponentDomain[componentId] ?? null;
      if (
        previous !== null
        && (previous.transportComponentDomain[componentId] ?? null) === itemType
      ) {
        continue;
      }
      changedComponentIndexes.push(componentIndex);
      changedComponentItemIndexes.push(this.resolveOptionalItemIndex(itemType));
    }

    const transferEdgeIndexes: number[] = [];
    const transferSourceSlotIndexes: number[] = [];
    const transferTargetSlotIndexes: number[] = [];
    const transferItemIndexes: number[] = [];
    const transferAmounts: number[] = [];
    for (const transfer of snapshot.transfers) {
      transferEdgeIndexes.push(this.requireIndex(this.lookup.edgeIndexById, transfer.edgeId, "edge"));
      transferSourceSlotIndexes.push(
        this.requireIndex(this.lookup.slotIndexById, transfer.sourceSlotId, "slot"),
      );
      transferTargetSlotIndexes.push(
        this.requireIndex(this.lookup.slotIndexById, transfer.targetSlotId, "slot"),
      );
      transferItemIndexes.push(
        this.requireIndex(this.lookup.itemIndexById, transfer.itemType, "item"),
      );
      transferAmounts.push(transfer.amount);
    }

    const gasSourceDeviceIndexes: number[] = [];
    const gasItemIndexes: number[] = [];
    const gasGridRects: number[] = [];
    for (const diffusion of snapshot.gasDiffusions) {
      gasSourceDeviceIndexes.push(
        this.requireIndex(this.lookup.deviceIndexById, diffusion.sourceDeviceId, "device"),
      );
      gasItemIndexes.push(
        this.requireIndex(this.lookup.itemIndexById, diffusion.gasItemId, "item"),
      );
      gasGridRects.push(
        diffusion.gridRect.x,
        diffusion.gridRect.y,
        diffusion.gridRect.width,
        diffusion.gridRect.height,
      );
    }

    const warehouseDelta = encodeWarehouseDelta(snapshot, previous, this.lookup);
    const delta: DenseFrameDelta = {
      protocolVersion: DENSE_SIMULATION_PROTOCOL_VERSION,
      sessionId: this.session.sessionId,
      topologyVersion: this.session.topologyVersion,
      topologyId: snapshot.topologyId,
      documentHash: snapshot.documentHash,
      frameSequence: this.nextFrameSequence,
      fromTickNumber: previous === null
        ? snapshot.tickNumber
        : Math.min(snapshot.tickNumber, previous.tickNumber + 1),
      tickNumber: snapshot.tickNumber,
      status: snapshot.status === "initial" ? FRAME_STATUS_INITIAL : FRAME_STATUS_RUNNING,
      ...(snapshot.debugData === undefined ? {} : { debugData: snapshot.debugData }),
      totalPowerDemand: snapshot.totalPowerDemand,
      currentPowerGeneration: snapshot.currentPowerGeneration,
      isPowerOutage: snapshot.isPowerOutage,
      baseBatteryJoules: snapshot.baseBatteryJoules,
      baseBatteryCapacity: snapshot.baseBatteryCapacity,
      changedSlotIndexes: Uint32Array.from(changedSlotIndexes),
      changedSlotItemIndexes: Int32Array.from(changedSlotItemIndexes),
      changedSlotNumbers: Float64Array.from(changedSlotNumbers),
      changedSlotFlags: Uint8Array.from(changedSlotFlags),
      changedDeviceIndexes: Uint32Array.from(changedDeviceIndexes),
      changedDevices,
      changedNodeIndexes: Uint32Array.from(changedNodeIndexes),
      changedNodes,
      routingCursorKeys,
      routingCursorValues: Float64Array.from(routingCursorValues),
      removedRoutingCursorKeys,
      changedComponentIndexes: Uint32Array.from(changedComponentIndexes),
      changedComponentItemIndexes: Int32Array.from(changedComponentItemIndexes),
      transferEdgeIndexes: Uint32Array.from(transferEdgeIndexes),
      transferSourceSlotIndexes: Uint32Array.from(transferSourceSlotIndexes),
      transferTargetSlotIndexes: Uint32Array.from(transferTargetSlotIndexes),
      transferItemIndexes: Uint32Array.from(transferItemIndexes),
      transferAmounts: Float64Array.from(transferAmounts),
      diagnostics: snapshot.diagnostics,
      gasSourceDeviceIndexes: Uint32Array.from(gasSourceDeviceIndexes),
      gasItemIndexes: Uint32Array.from(gasItemIndexes),
      gasGridRects: Float64Array.from(gasGridRects),
      ...warehouseDelta,
    };

    this.previous = snapshot;
    this.nextFrameSequence += 1;
    return delta;
  }

  public reset(): void {
    this.previous = null;
    this.nextFrameSequence = 1;
  }

  private assertSnapshotIdentity(snapshot: RuntimeTickSnapshot): void {
    if (
      snapshot.topologyId !== this.dictionary.topologyId
      || snapshot.documentHash !== this.dictionary.documentHash
    ) {
      throw new Error(
        `Dense frame identity mismatch: expected ${this.dictionary.topologyId}/${this.dictionary.documentHash}, received ${snapshot.topologyId}/${snapshot.documentHash}.`,
      );
    }
  }

  private resolveOptionalItemIndex(itemId: string | null): number {
    return itemId === null
      ? DENSE_INDEX_NONE
      : this.requireIndex(this.lookup.itemIndexById, itemId, "item");
  }

  private requireIndex(index: ReadonlyMap<string, number>, id: string, kind: string): number {
    const value = index.get(id);
    if (value === undefined) {
      throw new Error(`Dense frame cannot resolve ${kind} id "${id}".`);
    }
    return value;
  }
}

export class DenseProjectionStore implements DenseProjectionReadModel {
  private readonly lookup: DenseTopologyLookup;
  private readonly slots: Array<RuntimeTickSnapshot["slots"][string] | null>;
  private readonly devices: Array<RuntimeDeviceSnapshot | null>;
  private readonly nodes: Array<RuntimeNodeSnapshot | null>;
  private readonly routingCursors: Record<string, number> = {};
  private readonly transportComponentDomain: Record<string, string | null> = {};
  private warehouseItems: Record<string, WarehouseItemStats> | null = null;
  private warehouseStatsWindowReady = false;
  private initialized = false;
  private currentFrameSequence = 0;
  private currentTickNumber = 0;
  private currentStatus: RuntimeTickSnapshot["status"] = "initial";
  private currentDebugData: string | undefined;
  private currentTotalPowerDemand = 0;
  private currentPowerGenerationValue = 0;
  private currentIsPowerOutage = false;
  private baseBatteryJoules = 0;
  private baseBatteryCapacity = 0;
  private transfers: RuntimeTickSnapshot["transfers"] = [];
  private diagnostics: RuntimeTickSnapshot["diagnostics"] = [];
  private gasDiffusions: RuntimeTickSnapshot["gasDiffusions"] = [];

  public constructor(
    private readonly dictionary: DenseTopologyDictionary,
    private readonly session: {
      readonly sessionId: string;
      readonly topologyVersion: number;
    },
  ) {
    assertSessionIdentity(session);
    this.lookup = createDenseTopologyLookup(dictionary);
    this.slots = Array.from({ length: dictionary.slotIds.length }, () => null);
    this.devices = Array.from({ length: dictionary.deviceIds.length }, () => null);
    this.nodes = Array.from({ length: dictionary.nodeIds.length }, () => null);
    for (const componentId of dictionary.componentIds) {
      this.transportComponentDomain[componentId] = null;
    }
  }

  public get tickNumber(): number | null {
    return this.initialized ? this.currentTickNumber : null;
  }

  public get frameSequence(): number {
    return this.currentFrameSequence;
  }

  public get status(): RuntimeTickSnapshot["status"] | null {
    return this.initialized ? this.currentStatus : null;
  }

  public get debugData(): string | undefined {
    return this.currentDebugData;
  }

  public get totalPowerDemand(): number | null {
    return this.initialized ? this.currentTotalPowerDemand : null;
  }

  public get currentPowerGeneration(): number | null {
    return this.initialized ? this.currentPowerGenerationValue : null;
  }

  public get isPowerOutage(): boolean {
    return this.currentIsPowerOutage;
  }

  public apply(delta: DenseFrameDelta): void {
    this.validateDelta(delta);
    this.applySlotChanges(delta);
    this.applyDeviceChanges(delta);
    this.applyNodeChanges(delta);
    this.applyRoutingCursorChanges(delta);
    this.applyComponentChanges(delta);
    this.applyWarehouseChanges(delta);

    this.currentFrameSequence = delta.frameSequence;
    this.currentTickNumber = delta.tickNumber;
    this.currentStatus = delta.status === FRAME_STATUS_INITIAL ? "initial" : "running";
    this.currentDebugData = delta.debugData;
    this.currentTotalPowerDemand = delta.totalPowerDemand;
    this.currentPowerGenerationValue = delta.currentPowerGeneration;
    this.currentIsPowerOutage = delta.isPowerOutage;
    this.baseBatteryJoules = delta.baseBatteryJoules;
    this.baseBatteryCapacity = delta.baseBatteryCapacity;
    this.transfers = decodeTransfers(delta, this.dictionary);
    this.diagnostics = delta.diagnostics.map((diagnostic) => ({ ...diagnostic }));
    this.gasDiffusions = decodeGasDiffusions(delta, this.dictionary);
    this.initialized = true;
  }

  public getSlot(slotId: string): RuntimeTickSnapshot["slots"][string] | null {
    const index = this.lookup.slotIndexById.get(slotId);
    return index === undefined ? null : this.slots[index] ?? null;
  }

  public getDevice(deviceId: string): RuntimeDeviceSnapshot | null {
    const index = this.lookup.deviceIndexById.get(deviceId);
    return index === undefined ? null : this.devices[index] ?? null;
  }

  public getNode(nodeId: string): RuntimeNodeSnapshot | null {
    const index = this.lookup.nodeIndexById.get(nodeId);
    return index === undefined ? null : this.nodes[index] ?? null;
  }

  public getTransportComponentItemType(componentId: string): string | null {
    return this.transportComponentDomain[componentId] ?? null;
  }

  public getTransfers(): RuntimeTickSnapshot["transfers"] {
    return this.transfers;
  }

  public getDiagnostics(): RuntimeTickSnapshot["diagnostics"] {
    return this.diagnostics;
  }

  public getGasDiffusions(): RuntimeTickSnapshot["gasDiffusions"] {
    return this.gasDiffusions;
  }

  public getWarehouseStats(): RuntimeTickSnapshot["warehouseStats"] {
    return this.warehouseItems === null
      ? null
      : {
          items: this.warehouseItems,
          statsWindowReady: this.warehouseStatsWindowReady,
        };
  }

  public materializeSnapshot(): RuntimeTickSnapshot {
    if (!this.initialized) {
      throw new Error("Dense projection store has not received an initial frame.");
    }

    return {
      topologyId: this.dictionary.topologyId,
      documentHash: this.dictionary.documentHash,
      tickNumber: this.currentTickNumber,
      status: this.currentStatus,
      ...(this.currentDebugData === undefined ? {} : { debugData: this.currentDebugData }),
      totalPowerDemand: this.currentTotalPowerDemand,
      currentPowerGeneration: this.currentPowerGenerationValue,
      isPowerOutage: this.currentIsPowerOutage,
      baseBatteryJoules: this.baseBatteryJoules,
      baseBatteryCapacity: this.baseBatteryCapacity,
      slots: materializeIndexedRecord(this.dictionary.slotIds, this.slots, "slot"),
      devices: materializeIndexedRecord(this.dictionary.deviceIds, this.devices, "device"),
      nodes: materializeIndexedRecord(this.dictionary.nodeIds, this.nodes, "node"),
      transfers: this.transfers.map((transfer) => ({ ...transfer })),
      routingCursors: { ...this.routingCursors },
      transportComponentDomain: { ...this.transportComponentDomain },
      diagnostics: this.diagnostics.map((diagnostic) => ({ ...diagnostic })),
      gasDiffusions: this.gasDiffusions.map((diffusion) => ({
        ...diffusion,
        gridRect: { ...diffusion.gridRect },
      })),
      warehouseStats: this.warehouseItems === null
        ? null
        : {
            items: Object.fromEntries(
              Object.entries(this.warehouseItems).map(([itemId, value]) => [
                itemId,
                { ...value },
              ]),
            ),
            statsWindowReady: this.warehouseStatsWindowReady,
          },
    };
  }

  private validateDelta(delta: DenseFrameDelta): void {
    if (delta.protocolVersion !== DENSE_SIMULATION_PROTOCOL_VERSION) {
      throw new Error(`Unsupported dense simulation protocol ${delta.protocolVersion}.`);
    }
    if (
      delta.sessionId !== this.session.sessionId
      || delta.topologyVersion !== this.session.topologyVersion
    ) {
      throw new Error("Dense projection session identity mismatch.");
    }
    if (
      delta.topologyId !== this.dictionary.topologyId
      || delta.documentHash !== this.dictionary.documentHash
    ) {
      throw new Error("Dense projection topology identity mismatch.");
    }
    if (delta.frameSequence !== this.currentFrameSequence + 1) {
      throw new Error(
        `Dense projection expected frame ${this.currentFrameSequence + 1}, received ${delta.frameSequence}.`,
      );
    }
    if (!Number.isSafeInteger(delta.tickNumber) || delta.tickNumber < 0) {
      throw new Error(`Dense projection received invalid tick ${delta.tickNumber}.`);
    }
    if (
      !Number.isSafeInteger(delta.fromTickNumber)
      || delta.fromTickNumber < 0
      || delta.fromTickNumber > delta.tickNumber
    ) {
      throw new Error(
        `Dense projection received invalid tick range ${delta.fromTickNumber}..${delta.tickNumber}.`,
      );
    }
    if (this.initialized && delta.tickNumber < this.currentTickNumber) {
      throw new Error(
        `Dense projection cannot move backwards from tick ${this.currentTickNumber} to ${delta.tickNumber}.`,
      );
    }
    assertParallelLengths(
      delta.changedSlotIndexes.length,
      delta.changedSlotItemIndexes.length,
      "slot item indexes",
    );
    assertParallelLengths(
      delta.changedSlotIndexes.length * 2,
      delta.changedSlotNumbers.length,
      "slot numbers",
    );
    assertParallelLengths(
      delta.changedSlotIndexes.length,
      delta.changedSlotFlags.length,
      "slot flags",
    );
    assertParallelLengths(
      delta.changedDeviceIndexes.length,
      delta.changedDevices.length,
      "devices",
    );
    assertParallelLengths(delta.changedNodeIndexes.length, delta.changedNodes.length, "nodes");
    assertParallelLengths(
      delta.routingCursorKeys.length,
      delta.routingCursorValues.length,
      "routing cursors",
    );
    assertParallelLengths(
      delta.changedComponentIndexes.length,
      delta.changedComponentItemIndexes.length,
      "component domains",
    );
    assertParallelLengths(
      delta.transferEdgeIndexes.length,
      delta.transferSourceSlotIndexes.length,
      "transfer source slots",
    );
    assertParallelLengths(
      delta.transferEdgeIndexes.length,
      delta.transferTargetSlotIndexes.length,
      "transfer target slots",
    );
    assertParallelLengths(
      delta.transferEdgeIndexes.length,
      delta.transferItemIndexes.length,
      "transfer items",
    );
    assertParallelLengths(
      delta.transferEdgeIndexes.length,
      delta.transferAmounts.length,
      "transfer amounts",
    );
    assertParallelLengths(
      delta.gasSourceDeviceIndexes.length,
      delta.gasItemIndexes.length,
      "gas items",
    );
    assertParallelLengths(
      delta.gasSourceDeviceIndexes.length * 4,
      delta.gasGridRects.length,
      "gas grid rects",
    );
    assertParallelLengths(
      delta.changedWarehouseItemIndexes.length * 4,
      delta.changedWarehouseItemNumbers.length,
      "warehouse numbers",
    );
    assertParallelLengths(
      delta.changedWarehouseItemIndexes.length,
      delta.changedWarehouseItemFlags.length,
      "warehouse flags",
    );
    assertUniqueIndexes(delta.changedSlotIndexes, this.dictionary.slotIds.length, "slot");
    assertUniqueIndexes(delta.changedDeviceIndexes, this.dictionary.deviceIds.length, "device");
    assertUniqueIndexes(delta.changedNodeIndexes, this.dictionary.nodeIds.length, "node");
    assertUniqueIndexes(
      delta.changedComponentIndexes,
      this.dictionary.componentIds.length,
      "component",
    );
    assertUniqueIndexes(
      delta.changedWarehouseItemIndexes,
      this.dictionary.itemIds.length,
      "warehouse item",
    );
    assertUniqueIndexes(
      delta.removedWarehouseItemIndexes,
      this.dictionary.itemIds.length,
      "removed warehouse item",
    );

    if (!this.initialized) {
      assertInitialFrameCoverage(
        delta.changedSlotIndexes,
        this.dictionary.slotIds.length,
        "slots",
      );
      assertInitialFrameCoverage(
        delta.changedDeviceIndexes,
        this.dictionary.deviceIds.length,
        "devices",
      );
      assertInitialFrameCoverage(
        delta.changedNodeIndexes,
        this.dictionary.nodeIds.length,
        "nodes",
      );
      assertInitialFrameCoverage(
        delta.changedComponentIndexes,
        this.dictionary.componentIds.length,
        "components",
      );
    }

    for (let offset = 0; offset < delta.changedSlotIndexes.length; offset += 1) {
      assertOptionalDictionaryIndex(
        delta.changedSlotItemIndexes[offset]!,
        this.dictionary.itemIds.length,
        "slot item",
      );
      assertFiniteNonNegative(delta.changedSlotNumbers[offset * 2]!, "slot count");
      assertFiniteNonNegative(delta.changedSlotNumbers[offset * 2 + 1]!, "slot reserved");
    }
    for (let offset = 0; offset < delta.changedDeviceIndexes.length; offset += 1) {
      const deviceIndex = delta.changedDeviceIndexes[offset]!;
      const expectedId = this.dictionary.deviceIds[deviceIndex]!;
      const value = delta.changedDevices[offset]!;
      if (value.deviceId !== expectedId) {
        throw new Error(
          `Dense device delta id mismatch at ${deviceIndex}: expected "${expectedId}", received "${value.deviceId}".`,
        );
      }
    }
    for (let offset = 0; offset < delta.changedNodeIndexes.length; offset += 1) {
      const nodeIndex = delta.changedNodeIndexes[offset]!;
      const expectedId = this.dictionary.nodeIds[nodeIndex]!;
      const value = delta.changedNodes[offset]!;
      if (value.nodeId !== expectedId) {
        throw new Error(
          `Dense node delta id mismatch at ${nodeIndex}: expected "${expectedId}", received "${value.nodeId}".`,
        );
      }
    }
    for (const itemIndex of delta.changedComponentItemIndexes) {
      assertOptionalDictionaryIndex(
        itemIndex,
        this.dictionary.itemIds.length,
        "component item",
      );
    }
    assertRoutingCursorDelta(delta);
    assertTransferDelta(delta, this.dictionary);
    assertGasDelta(delta, this.dictionary);
    assertWarehouseDelta(delta, this.dictionary);
    assertFiniteNonNegative(delta.totalPowerDemand, "total power demand");
    assertFiniteNonNegative(delta.currentPowerGeneration, "current power generation");
    assertFiniteNonNegative(delta.baseBatteryJoules, "base battery joules");
    assertFiniteNonNegative(delta.baseBatteryCapacity, "base battery capacity");
  }

  private applySlotChanges(delta: DenseFrameDelta): void {
    for (let offset = 0; offset < delta.changedSlotIndexes.length; offset += 1) {
      const slotIndex = delta.changedSlotIndexes[offset]!;
      const slotId = requireArrayEntry(this.dictionary.slotIds, slotIndex, "slot");
      const itemIndex = delta.changedSlotItemIndexes[offset]!;
      this.slots[slotIndex] = {
        slotId,
        itemType: itemIndex === DENSE_INDEX_NONE
          ? null
          : requireArrayEntry(this.dictionary.itemIds, itemIndex, "item"),
        count: delta.changedSlotNumbers[offset * 2]!,
        reserved: delta.changedSlotNumbers[offset * 2 + 1]!,
        ignoreStock: (delta.changedSlotFlags[offset]! & SLOT_FLAG_IGNORE_STOCK) !== 0,
      };
    }
  }

  private applyDeviceChanges(delta: DenseFrameDelta): void {
    for (let offset = 0; offset < delta.changedDeviceIndexes.length; offset += 1) {
      const deviceIndex = delta.changedDeviceIndexes[offset]!;
      const expectedId = requireArrayEntry(this.dictionary.deviceIds, deviceIndex, "device");
      const value = delta.changedDevices[offset]!;
      if (value.deviceId !== expectedId) {
        throw new Error(
          `Dense device delta id mismatch at ${deviceIndex}: expected "${expectedId}", received "${value.deviceId}".`,
        );
      }
      this.devices[deviceIndex] = value;
    }
  }

  private applyNodeChanges(delta: DenseFrameDelta): void {
    for (let offset = 0; offset < delta.changedNodeIndexes.length; offset += 1) {
      const nodeIndex = delta.changedNodeIndexes[offset]!;
      const expectedId = requireArrayEntry(this.dictionary.nodeIds, nodeIndex, "node");
      const value = delta.changedNodes[offset]!;
      if (value.nodeId !== expectedId) {
        throw new Error(
          `Dense node delta id mismatch at ${nodeIndex}: expected "${expectedId}", received "${value.nodeId}".`,
        );
      }
      this.nodes[nodeIndex] = value;
    }
  }

  private applyRoutingCursorChanges(delta: DenseFrameDelta): void {
    for (const key of delta.removedRoutingCursorKeys) {
      delete this.routingCursors[key];
    }
    for (let offset = 0; offset < delta.routingCursorKeys.length; offset += 1) {
      this.routingCursors[delta.routingCursorKeys[offset]!] = delta.routingCursorValues[offset]!;
    }
  }

  private applyComponentChanges(delta: DenseFrameDelta): void {
    for (let offset = 0; offset < delta.changedComponentIndexes.length; offset += 1) {
      const componentId = requireArrayEntry(
        this.dictionary.componentIds,
        delta.changedComponentIndexes[offset]!,
        "component",
      );
      const itemIndex = delta.changedComponentItemIndexes[offset]!;
      this.transportComponentDomain[componentId] = itemIndex === DENSE_INDEX_NONE
        ? null
        : requireArrayEntry(this.dictionary.itemIds, itemIndex, "item");
    }
  }

  private applyWarehouseChanges(delta: DenseFrameDelta): void {
    if (delta.warehouseMode === WAREHOUSE_UNCHANGED) {
      return;
    }
    if (delta.warehouseMode === WAREHOUSE_CLEARED) {
      this.warehouseItems = null;
      this.warehouseStatsWindowReady = false;
      return;
    }
    if (this.warehouseItems === null) {
      this.warehouseItems = {};
    }
    for (const itemIndex of delta.removedWarehouseItemIndexes) {
      delete this.warehouseItems[requireArrayEntry(this.dictionary.itemIds, itemIndex, "item")];
    }
    for (let offset = 0; offset < delta.changedWarehouseItemIndexes.length; offset += 1) {
      const itemId = requireArrayEntry(
        this.dictionary.itemIds,
        delta.changedWarehouseItemIndexes[offset]!,
        "item",
      );
      const numberOffset = offset * 4;
      this.warehouseItems[itemId] = {
        producedPerMinute: delta.changedWarehouseItemNumbers[numberOffset]!,
        consumedPerMinute: delta.changedWarehouseItemNumbers[numberOffset + 1]!,
        warehouseCount: delta.changedWarehouseItemNumbers[numberOffset + 2]!,
        lastChangedTick: delta.changedWarehouseItemNumbers[numberOffset + 3]!,
        infinite: delta.changedWarehouseItemFlags[offset] !== 0,
      };
    }
    this.warehouseStatsWindowReady = delta.warehouseStatsWindowReady;
  }
}

export function collectDenseFrameTransferables(delta: DenseFrameDelta): readonly ArrayBuffer[] {
  return [
    delta.changedSlotIndexes,
    delta.changedSlotItemIndexes,
    delta.changedSlotNumbers,
    delta.changedSlotFlags,
    delta.changedDeviceIndexes,
    delta.changedNodeIndexes,
    delta.routingCursorValues,
    delta.changedComponentIndexes,
    delta.changedComponentItemIndexes,
    delta.transferEdgeIndexes,
    delta.transferSourceSlotIndexes,
    delta.transferTargetSlotIndexes,
    delta.transferItemIndexes,
    delta.transferAmounts,
    delta.gasSourceDeviceIndexes,
    delta.gasItemIndexes,
    delta.gasGridRects,
    delta.changedWarehouseItemIndexes,
    delta.changedWarehouseItemNumbers,
    delta.changedWarehouseItemFlags,
    delta.removedWarehouseItemIndexes,
  ].map((view) => requireTransferableArrayBuffer(view));
}

function requireTransferableArrayBuffer(view: ArrayBufferView): ArrayBuffer {
  if (!(view.buffer instanceof ArrayBuffer)) {
    throw new Error("Dense simulation protocol does not support SharedArrayBuffer.");
  }
  return view.buffer;
}

function encodeWarehouseDelta(
  snapshot: RuntimeTickSnapshot,
  previous: RuntimeTickSnapshot | null,
  lookup: DenseTopologyLookup,
): Pick<
  DenseFrameDelta,
  | "warehouseMode"
  | "warehouseStatsWindowReady"
  | "changedWarehouseItemIndexes"
  | "changedWarehouseItemNumbers"
  | "changedWarehouseItemFlags"
  | "removedWarehouseItemIndexes"
> {
  if (snapshot.warehouseStats === null) {
    return {
      warehouseMode: previous?.warehouseStats === null ? WAREHOUSE_UNCHANGED : WAREHOUSE_CLEARED,
      warehouseStatsWindowReady: false,
      changedWarehouseItemIndexes: new Uint32Array(),
      changedWarehouseItemNumbers: new Float64Array(),
      changedWarehouseItemFlags: new Uint8Array(),
      removedWarehouseItemIndexes: new Uint32Array(),
    };
  }

  const changedItemIndexes: number[] = [];
  const changedItemNumbers: number[] = [];
  const changedItemFlags: number[] = [];
  const warehouseEntries = Object.entries(snapshot.warehouseStats.items)
    .sort(([leftId], [rightId]) => compareStableIds(leftId, rightId));
  for (const [itemId, stats] of warehouseEntries) {
    if (areWarehouseItemStatsEqual(stats, previous?.warehouseStats?.items[itemId])) {
      continue;
    }
    const itemIndex = lookup.itemIndexById.get(itemId);
    if (itemIndex === undefined) {
      throw new Error(`Dense warehouse delta cannot resolve item id "${itemId}".`);
    }
    changedItemIndexes.push(itemIndex);
    changedItemNumbers.push(
      stats.producedPerMinute,
      stats.consumedPerMinute,
      stats.warehouseCount,
      stats.lastChangedTick,
    );
    changedItemFlags.push(stats.infinite ? 1 : 0);
  }

  const removedItemIndexes: number[] = [];
  if (previous?.warehouseStats !== null && previous?.warehouseStats !== undefined) {
    for (const itemId of Object.keys(previous.warehouseStats.items).sort(compareStableIds)) {
      if (snapshot.warehouseStats.items[itemId] !== undefined) {
        continue;
      }
      const itemIndex = lookup.itemIndexById.get(itemId);
      if (itemIndex === undefined) {
        throw new Error(`Dense warehouse delta cannot resolve removed item id "${itemId}".`);
      }
      removedItemIndexes.push(itemIndex);
    }
  }

  const windowChanged = previous?.warehouseStats?.statsWindowReady
    !== snapshot.warehouseStats.statsWindowReady;
  const changed = previous?.warehouseStats === null
    || previous?.warehouseStats === undefined
    || windowChanged
    || changedItemIndexes.length > 0
    || removedItemIndexes.length > 0;
  return {
    warehouseMode: changed ? WAREHOUSE_PATCHED : WAREHOUSE_UNCHANGED,
    warehouseStatsWindowReady: snapshot.warehouseStats.statsWindowReady,
    changedWarehouseItemIndexes: Uint32Array.from(changedItemIndexes),
    changedWarehouseItemNumbers: Float64Array.from(changedItemNumbers),
    changedWarehouseItemFlags: Uint8Array.from(changedItemFlags),
    removedWarehouseItemIndexes: Uint32Array.from(removedItemIndexes),
  };
}

function decodeTransfers(
  delta: DenseFrameDelta,
  dictionary: DenseTopologyDictionary,
): RuntimeTickSnapshot["transfers"] {
  return Array.from({ length: delta.transferEdgeIndexes.length }, (_, offset) => ({
    edgeId: requireArrayEntry(dictionary.edgeIds, delta.transferEdgeIndexes[offset]!, "edge"),
    sourceSlotId: requireArrayEntry(
      dictionary.slotIds,
      delta.transferSourceSlotIndexes[offset]!,
      "slot",
    ),
    targetSlotId: requireArrayEntry(
      dictionary.slotIds,
      delta.transferTargetSlotIndexes[offset]!,
      "slot",
    ),
    itemType: requireArrayEntry(
      dictionary.itemIds,
      delta.transferItemIndexes[offset]!,
      "item",
    ),
    amount: delta.transferAmounts[offset]!,
  }));
}

function decodeGasDiffusions(
  delta: DenseFrameDelta,
  dictionary: DenseTopologyDictionary,
): RuntimeTickSnapshot["gasDiffusions"] {
  return Array.from({ length: delta.gasSourceDeviceIndexes.length }, (_, offset) => ({
    sourceDeviceId: requireArrayEntry(
      dictionary.deviceIds,
      delta.gasSourceDeviceIndexes[offset]!,
      "device",
    ),
    gasItemId: requireArrayEntry(dictionary.itemIds, delta.gasItemIndexes[offset]!, "item"),
    gridRect: {
      x: delta.gasGridRects[offset * 4]!,
      y: delta.gasGridRects[offset * 4 + 1]!,
      width: delta.gasGridRects[offset * 4 + 2]!,
      height: delta.gasGridRects[offset * 4 + 3]!,
    },
  }));
}

function materializeIndexedRecord<T>(
  ids: readonly string[],
  values: readonly (T | null)[],
  kind: string,
): Record<string, T> {
  const result: Record<string, T> = {};
  for (let index = 0; index < ids.length; index += 1) {
    const id = ids[index]!;
    const value = values[index];
    if (value === null || value === undefined) {
      throw new Error(`Dense projection has no ${kind} value for "${id}".`);
    }
    result[id] = value;
  }
  return result;
}

function requireArrayEntry<T>(
  values: readonly T[],
  index: number,
  kind: string,
): T {
  if (!Number.isSafeInteger(index) || index < 0 || index >= values.length) {
    throw new Error(`Dense ${kind} index ${index} is outside [0, ${Math.max(0, values.length - 1)}].`);
  }
  return values[index]!;
}

function assertParallelLengths(expected: number, actual: number, label: string): void {
  if (expected !== actual) {
    throw new Error(`Dense frame ${label} length ${actual} does not match ${expected}.`);
  }
}

function assertSessionIdentity(session: {
  readonly sessionId: string;
  readonly topologyVersion: number;
}): void {
  if (session.sessionId.length === 0) {
    throw new Error("Dense simulation session id cannot be empty.");
  }
  if (!Number.isSafeInteger(session.topologyVersion) || session.topologyVersion < 1) {
    throw new Error(
      `Dense simulation topology version must be a positive safe integer; received ${session.topologyVersion}.`,
    );
  }
}

function assertUniqueIndexes(
  indexes: Uint32Array,
  capacity: number,
  kind: string,
): void {
  const seen = new Uint8Array(capacity);
  for (const index of indexes) {
    assertDictionaryIndex(index, capacity, kind);
    if (seen[index] !== 0) {
      throw new Error(`Dense frame contains duplicate ${kind} index ${index}.`);
    }
    seen[index] = 1;
  }
}

function assertInitialFrameCoverage(
  indexes: Uint32Array,
  capacity: number,
  kind: string,
): void {
  if (indexes.length !== capacity) {
    throw new Error(
      `Dense initial frame must contain all ${capacity} ${kind}; received ${indexes.length}.`,
    );
  }
}

function assertOptionalDictionaryIndex(index: number, capacity: number, kind: string): void {
  if (index === DENSE_INDEX_NONE) {
    return;
  }
  assertDictionaryIndex(index, capacity, kind);
}

function assertDictionaryIndex(index: number, capacity: number, kind: string): void {
  if (!Number.isSafeInteger(index) || index < 0 || index >= capacity) {
    throw new Error(
      `Dense ${kind} index ${index} is outside [0, ${Math.max(0, capacity - 1)}].`,
    );
  }
}

function assertFiniteNonNegative(value: number, label: string): void {
  if (!Number.isFinite(value) || value < 0) {
    throw new Error(`Dense frame ${label} must be finite and non-negative; received ${value}.`);
  }
}

function assertRoutingCursorDelta(delta: DenseFrameDelta): void {
  const changedKeys = new Set<string>();
  for (let offset = 0; offset < delta.routingCursorKeys.length; offset += 1) {
    const key = delta.routingCursorKeys[offset]!;
    if (changedKeys.has(key)) {
      throw new Error(`Dense frame contains duplicate routing cursor key "${key}".`);
    }
    changedKeys.add(key);
    assertFiniteNonNegative(delta.routingCursorValues[offset]!, "routing cursor");
  }

  const removedKeys = new Set<string>();
  for (const key of delta.removedRoutingCursorKeys) {
    if (removedKeys.has(key)) {
      throw new Error(`Dense frame contains duplicate removed routing cursor key "${key}".`);
    }
    if (changedKeys.has(key)) {
      throw new Error(`Dense frame both changes and removes routing cursor key "${key}".`);
    }
    removedKeys.add(key);
  }
}

function assertTransferDelta(
  delta: DenseFrameDelta,
  dictionary: DenseTopologyDictionary,
): void {
  for (let offset = 0; offset < delta.transferEdgeIndexes.length; offset += 1) {
    requireArrayEntry(dictionary.edgeIds, delta.transferEdgeIndexes[offset]!, "edge");
    requireArrayEntry(
      dictionary.slotIds,
      delta.transferSourceSlotIndexes[offset]!,
      "source slot",
    );
    requireArrayEntry(
      dictionary.slotIds,
      delta.transferTargetSlotIndexes[offset]!,
      "target slot",
    );
    requireArrayEntry(dictionary.itemIds, delta.transferItemIndexes[offset]!, "transfer item");
    assertFiniteNonNegative(delta.transferAmounts[offset]!, "transfer amount");
  }
}

function assertGasDelta(
  delta: DenseFrameDelta,
  dictionary: DenseTopologyDictionary,
): void {
  for (let offset = 0; offset < delta.gasSourceDeviceIndexes.length; offset += 1) {
    requireArrayEntry(
      dictionary.deviceIds,
      delta.gasSourceDeviceIndexes[offset]!,
      "gas source device",
    );
    requireArrayEntry(dictionary.itemIds, delta.gasItemIndexes[offset]!, "gas item");
    for (let rectOffset = 0; rectOffset < 4; rectOffset += 1) {
      const value = delta.gasGridRects[offset * 4 + rectOffset]!;
      if (!Number.isFinite(value)) {
        throw new Error(`Dense frame gas grid rect must be finite; received ${value}.`);
      }
    }
  }
}

function assertWarehouseDelta(
  delta: DenseFrameDelta,
  dictionary: DenseTopologyDictionary,
): void {
  if (
    delta.warehouseMode !== WAREHOUSE_UNCHANGED
    && delta.warehouseMode !== WAREHOUSE_CLEARED
    && delta.warehouseMode !== WAREHOUSE_PATCHED
  ) {
    throw new Error(`Dense frame contains invalid warehouse mode ${delta.warehouseMode}.`);
  }
  if (
    delta.warehouseMode !== WAREHOUSE_PATCHED
    && (
      delta.changedWarehouseItemIndexes.length !== 0
      || delta.removedWarehouseItemIndexes.length !== 0
    )
  ) {
    throw new Error("Dense frame cannot carry warehouse changes without patched mode.");
  }

  const changedItems = new Set(delta.changedWarehouseItemIndexes);
  for (const itemIndex of delta.removedWarehouseItemIndexes) {
    if (changedItems.has(itemIndex)) {
      throw new Error(`Dense frame both changes and removes warehouse item index ${itemIndex}.`);
    }
  }
  for (let offset = 0; offset < delta.changedWarehouseItemIndexes.length; offset += 1) {
    requireArrayEntry(
      dictionary.itemIds,
      delta.changedWarehouseItemIndexes[offset]!,
      "warehouse item",
    );
    const numberOffset = offset * 4;
    assertFiniteNonNegative(
      delta.changedWarehouseItemNumbers[numberOffset]!,
      "warehouse produced per minute",
    );
    assertFiniteNonNegative(
      delta.changedWarehouseItemNumbers[numberOffset + 1]!,
      "warehouse consumed per minute",
    );
    assertFiniteNonNegative(
      delta.changedWarehouseItemNumbers[numberOffset + 2]!,
      "warehouse count",
    );
    assertFiniteNonNegative(
      delta.changedWarehouseItemNumbers[numberOffset + 3]!,
      "warehouse last changed tick",
    );
  }
}

function compareStableIds(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function areSlotSnapshotsEqual(
  left: RuntimeTickSnapshot["slots"][string],
  right: RuntimeTickSnapshot["slots"][string] | undefined,
): boolean {
  return right !== undefined
    && left.itemType === right.itemType
    && left.count === right.count
    && left.reserved === right.reserved
    && left.ignoreStock === right.ignoreStock;
}

function areDeviceSnapshotsEqual(
  left: RuntimeDeviceSnapshot,
  right: RuntimeDeviceSnapshot | undefined,
): boolean {
  return right !== undefined
    && left.block === right.block
    && areJsonCompatibleValuesEqual(left.recipe, right.recipe)
    && areJsonCompatibleValuesEqual(left.channelRecipes, right.channelRecipes)
    && areJsonCompatibleValuesEqual(left.admissionCounters, right.admissionCounters);
}

function areNodeSnapshotsEqual(
  left: RuntimeNodeSnapshot,
  right: RuntimeNodeSnapshot | undefined,
): boolean {
  return right !== undefined
    && left.result === right.result
    && left.resolveState === right.resolveState
    && left.blockReason === right.blockReason
    && areStringArraysEqual(left.acceptedInputEdgeIds, right.acceptedInputEdgeIds)
    && areStringArraysEqual(left.acceptedOutputEdgeIds, right.acceptedOutputEdgeIds);
}

function areWarehouseItemStatsEqual(
  left: WarehouseItemStats,
  right: WarehouseItemStats | undefined,
): boolean {
  return right !== undefined
    && left.producedPerMinute === right.producedPerMinute
    && left.consumedPerMinute === right.consumedPerMinute
    && left.warehouseCount === right.warehouseCount
    && left.infinite === right.infinite
    && left.lastChangedTick === right.lastChangedTick;
}

function areStringArraysEqual(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

function areJsonCompatibleValuesEqual(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}
