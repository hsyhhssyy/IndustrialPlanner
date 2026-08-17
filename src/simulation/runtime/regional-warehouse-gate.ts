import type { RegistryContract } from "@/domain/registry/registry-contract";
import type {
  RegionWarehouseDeposit,
  RegionalWarehouseOutlet,
  RegionalWarehouseOutletTable,
} from "../regional";
import type {
  CompiledSimulationTopology,
  RegionalWarehouseStage3Options,
  RegionalWarehouseWriteContext,
} from "../types";
import {
  acceptsItem,
  findInputSlotForItem,
  resolveStorageSlotId,
} from "./runtime-slot-access";
import type { SimulationMutableRuntimeState } from "./runtime-state";
import {
  canAdmitItemThroughTargetPort,
  canReleaseItemThroughSourcePort,
  recordAdmissionMove,
} from "./stage-3-layered-reverse-solve";
import { canDeviceTransferAtCurrentPhase } from "./phase-gating";

const REGION_EPOCH_STANDARD_TICKS = 10;

export class RegionalWarehouseGateInvariantError extends Error {
  public constructor(message: string) {
    super(message);
    this.name = "RegionalWarehouseGateInvariantError";
  }
}

/**
 * 单个基地 Runtime 的区域仓库门禁。
 *
 * Stage 1/3/5 通过同一个 writeContext 写 deposit journal；
 * Stage 3 先排除区域出口边完成本地求解，再生成 demand，最后按 grant 应用延迟边。
 */
export class RegionWarehouseGate {
  private readonly outletByEdgeId = new Map<string, RegionalWarehouseOutlet>();
  private readonly journal = new Map<string, number>();
  private readonly outletIdsForBase: readonly string[];

  public constructor(
    private readonly baseId: string,
    private readonly table: RegionalWarehouseOutletTable,
    private readonly topology: CompiledSimulationTopology,
    private readonly warehouseStorageSlotIds: ReadonlySet<string>,
  ) {
    this.outletIdsForBase = table.orderedOutletIds.filter((outletId) => {
      const outlet = table.outletById[outletId];
      if (outlet?.baseId !== baseId) {
        return false;
      }
      this.outletByEdgeId.set(outlet.transferEdgeId, outlet);
      return true;
    });
  }

  public get baseOutletIds(): readonly string[] {
    return this.outletIdsForBase;
  }

  public createStage3Options(): RegionalWarehouseStage3Options {
    return {
      excludedEdgeIds: new Set(this.outletByEdgeId.keys()),
      writeContext: this.writeContext,
    };
  }

  public get writeContext(): RegionalWarehouseWriteContext {
    return {
      isWarehouseStorageSlotId: (storageSlotId) => this.warehouseStorageSlotIds.has(storageSlotId),
      deposit: (itemType, amount) => this.deposit(itemType, amount),
    };
  }

  public deposit(itemType: string, amount: number): void {
    if (!Number.isFinite(amount) || amount < 0 || !Number.isInteger(amount)) {
      throw new RegionalWarehouseGateInvariantError(`Invalid regional deposit amount ${amount}.`);
    }
    if (amount === 0) {
      return;
    }
    this.journal.set(itemType, (this.journal.get(itemType) ?? 0) + amount);
  }

  public sealDeposits(): readonly RegionWarehouseDeposit[] {
    return [...this.journal.entries()]
      .filter(([, amount]) => amount > 0)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([itemId, amount]) => ({ itemId, amount }));
  }

  /** 封存并清空当前 Epoch journal；新 Epoch 从空 journal 开始。 */
  public takeDeposits(): readonly RegionWarehouseDeposit[] {
    const deposits = this.sealDeposits();
    this.journal.clear();
    return deposits;
  }

  public setWarehouseProjection(
    state: SimulationMutableRuntimeState,
    counts: Readonly<Record<string, number>>,
  ): void {
    for (const slotId of this.warehouseStorageSlotIds) {
      const slotState = state.persistent.slots[slotId];
      const slot = this.topology.slots[slotId];
      if (slotState === undefined || slot === undefined || slot.sourceSlotId === null) {
        continue;
      }
      slotState.count = Math.max(0, counts[slot.sourceSlotId] ?? 0);
      slotState.itemType = slot.sourceSlotId;
    }
  }

  public collectDemandBatch(
    registry: RegistryContract,
    state: SimulationMutableRuntimeState,
    _epochNumber: number,
  ): readonly string[] {
    const tickNumber = state.tickNumber;
    if (!isRegionalEpochGateTick(tickNumber)) {
      return [];
    }

    const demandedOutletIds: string[] = [];
    for (const outletId of this.outletIdsForBase) {
      const outlet = this.table.outletById[outletId];
      if (outlet === undefined) {
        throw new RegionalWarehouseGateInvariantError(`Unknown outlet ${outletId}.`);
      }
      if (this.canOutletAcceptAtGate(registry, state, outlet)) {
        demandedOutletIds.push(outletId);
      }
    }
    return demandedOutletIds;
  }

  public applyGrantBatch(
    registry: RegistryContract,
    state: SimulationMutableRuntimeState,
    grantedOutletIds: readonly string[],
  ): void {
    for (const outletId of grantedOutletIds) {
      const outlet = this.table.outletById[outletId];
      if (outlet === undefined || outlet.baseId !== this.baseId) {
        throw new RegionalWarehouseGateInvariantError(`Invalid grant outlet ${outletId} for base ${this.baseId}.`);
      }
      this.applyGrantedOutlet(registry, state, outlet);
    }
  }

  private canOutletAcceptAtGate(
    registry: RegistryContract,
    state: SimulationMutableRuntimeState,
    outlet: RegionalWarehouseOutlet,
  ): boolean {
    const topology = this.topology;
    const edge = topology.transferEdges[outlet.transferEdgeId];
    if (edge === undefined) {
      return false;
    }
    const sourceNode = topology.nodes[edge.sourceNodeId];
    const targetNode = topology.nodes[edge.targetNodeId];
    const sourceDevice = sourceNode === undefined ? undefined : topology.devices[sourceNode.deviceId];
    const targetDevice = targetNode === undefined ? undefined : topology.devices[targetNode.deviceId];
    if (sourceNode === undefined || targetNode === undefined || sourceDevice === undefined || targetDevice === undefined) {
      return false;
    }

    if (!acceptsItem(registry, topology, edge.acceptRule, outlet.itemId)) {
      return false;
    }
    if (!canDeviceTransferAtCurrentPhase(registry, topology, state, targetDevice)) {
      return false;
    }
    if (!canDeviceTransferAtCurrentPhase(registry, topology, state, sourceDevice)) {
      return false;
    }
    if (!canAdmitItemThroughTargetPort(topology, state, edge.targetPortId, outlet.itemId)) {
      return false;
    }
    if (!canReleaseItemThroughSourcePort(topology, state, edge.sourcePortId, outlet.itemId)) {
      return false;
    }
    return findInputSlotForItem({
      registry,
      topology,
      state,
      node: targetNode,
      itemType: outlet.itemId,
    }) !== null;
  }

  private applyGrantedOutlet(
    registry: RegistryContract,
    state: SimulationMutableRuntimeState,
    outlet: RegionalWarehouseOutlet,
  ): void {
    const topology = this.topology;
    const edge = topology.transferEdges[outlet.transferEdgeId];
    if (edge === undefined) {
      throw new RegionalWarehouseGateInvariantError(`Missing transfer edge for outlet ${outlet.outletId}.`);
    }
    const sourceNode = topology.nodes[edge.sourceNodeId];
    const targetNode = topology.nodes[edge.targetNodeId];
    const targetDevice = targetNode === undefined ? undefined : topology.devices[targetNode.deviceId];
    if (sourceNode === undefined || targetNode === undefined || targetDevice === undefined) {
      throw new RegionalWarehouseGateInvariantError(`Missing graph nodes for outlet ${outlet.outletId}.`);
    }
    if (!canDeviceTransferAtCurrentPhase(registry, topology, state, targetDevice)) {
      throw new RegionalWarehouseGateInvariantError(`Target phase mismatch for outlet ${outlet.outletId}.`);
    }
    if (!canAdmitItemThroughTargetPort(topology, state, edge.targetPortId, outlet.itemId)) {
      throw new RegionalWarehouseGateInvariantError(`Target admission mismatch for outlet ${outlet.outletId}.`);
    }
    if (!canReleaseItemThroughSourcePort(topology, state, edge.sourcePortId, outlet.itemId)) {
      throw new RegionalWarehouseGateInvariantError(`Source release mismatch for outlet ${outlet.outletId}.`);
    }

    const targetSlotId = findInputSlotForItem({
      registry,
      topology,
      state,
      node: targetNode,
      itemType: outlet.itemId,
    });
    if (targetSlotId === null) {
      throw new RegionalWarehouseGateInvariantError(`Grant cannot be applied to outlet ${outlet.outletId}.`);
    }

    const targetStorageSlotId = resolveStorageSlotId(state, targetSlotId);
    const targetSlotState = state.persistent.slots[targetStorageSlotId];
    if (targetSlotState === undefined) {
      throw new RegionalWarehouseGateInvariantError(`Missing target storage slot for outlet ${outlet.outletId}.`);
    }
    if (targetSlotState.itemType !== null && targetSlotState.itemType !== outlet.itemId) {
      throw new RegionalWarehouseGateInvariantError(`Target item type conflict for outlet ${outlet.outletId}.`);
    }

    const edgeState = state.transient.edges[edge.id];
    const sourceNodeState = state.transient.nodes[sourceNode.id];
    const targetNodeState = state.transient.nodes[targetNode.id];
    if (edgeState === undefined || sourceNodeState === undefined || targetNodeState === undefined) {
      throw new RegionalWarehouseGateInvariantError(`Missing transient solve state for outlet ${outlet.outletId}.`);
    }

    // 除“不扣本地仓库源槽、不推进本地路由游标”外，副作用与成功 moveOneItem 等价。
    edgeState.sourceSlotId = outlet.sourceCompiledSlotId;
    edgeState.targetSlotId = targetSlotId;
    edgeState.itemType = outlet.itemId;
    edgeState.shadowPush = "accept";
    edgeState.amount += 1;
    recordAdmissionMove(topology, state, edge.sourcePortId, outlet.itemId);
    edgeState.shadowPull = "moved";
    edgeState.shadowPush = "moved";
    pushUnique(sourceNodeState.acceptedOutputEdgeIds, edge.id);
    pushUnique(targetNodeState.acceptedInputEdgeIds, edge.id);
    targetNodeState.result = "solved-run";
    state.transient.transfers.push({
      edgeId: edge.id,
      sourceSlotId: outlet.sourceCompiledSlotId,
      targetSlotId,
      itemType: outlet.itemId,
      amount: 1,
    });

    targetSlotState.itemType = targetSlotState.itemType ?? outlet.itemId;
    targetSlotState.count += 1;
  }
}

export function isRegionalEpochGateTick(tickNumber: number): boolean {
  return Number.isSafeInteger(tickNumber)
    && tickNumber >= 0
    && (tickNumber - 1) % REGION_EPOCH_STANDARD_TICKS === 0;
}

export function resolveRegionalEpochGateTick(epochNumber: number): number {
  if (!Number.isSafeInteger(epochNumber) || epochNumber < 0) {
    throw new Error(`Regional epochNumber must be a non-negative safe integer, received ${epochNumber}.`);
  }
  return 1 + epochNumber * REGION_EPOCH_STANDARD_TICKS;
}

function pushUnique(target: string[], value: string): void {
  if (!target.includes(value)) {
    target.push(value);
  }
}
