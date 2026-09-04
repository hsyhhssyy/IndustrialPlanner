import { ADMISSION_RATE_WINDOWS_PER_MINUTE } from "@/domain/registry";
import type { RegistryContract } from "@/domain/registry/registry-contract";
import type {
  SimulationAdmissionCounterReset,
  SimulationRuntimeSlotPatch,
} from "@/domain/simulation/types/simulation-types";
import { areGridRectsContaining } from "@/shared/geometry/power-range";
import {
  getGridFootprintCenterCells,
  getRotatedGridFootprint,
} from "@/shared/geometry/grid";

import type {
  CompiledSimulationDevice,
  CompiledSimulationTopology,
  RuntimeDeviceRecipeSnapshot,
  RuntimeDeviceSnapshot,
  RuntimeGasDiffusionSnapshot,
} from "../types";
import type {
  RegionWarehouseDeposit,
  RegionalWarehouseOutletTable,
} from "../regional/types";
import { DenseIndexSet } from "./dense-index-set";
import { DenseRuntimeState } from "./dense-runtime-state";
import {
  DENSE_RECIPE_ITEM_ANY,
  DENSE_RECIPE_ITEM_DOMAIN,
  DENSE_RECIPE_ITEM_EXACT,
  DENSE_RECIPE_ITEM_SAME_AS_INPUT,
  compileDenseRecipePrograms,
  resolveDenseDeviceTransportPeriodTicks,
  type DenseRecipeChannelProgram,
  type DenseRecipeItemRule,
  type DenseRecipeProgram,
  type DenseRecipeProgramSet,
} from "./dense-recipe-program";
import {
  DENSE_INDEX_NONE,
  createDenseTopologyLookup,
  type DenseTopologyLayout,
  type DenseTopologyLookup,
} from "./dense-topology";

export interface DenseKernelTransferBatch {
  readonly edgeIndexes: Uint32Array;
  readonly sourceSlotIndexes: Uint32Array;
  readonly targetSlotIndexes: Uint32Array;
  readonly itemIndexes: Uint32Array;
  readonly amounts: Float64Array;
}

export interface DenseKernelTickResult {
  readonly tickNumber: number;
  readonly transfers: DenseKernelTransferBatch;
}

export interface DenseRegionalKernelOptions {
  readonly baseId: string;
  readonly table: RegionalWarehouseOutletTable;
  readonly initialWarehouseCounts: Readonly<Record<string, number>>;
}

export interface DenseRegionalGrantResult {
  readonly result: DenseKernelTickResult;
  readonly deposits: readonly RegionWarehouseDeposit[];
}

export interface DenseWarehouseStatsDelta {
  readonly statsWindowReady: boolean;
  readonly changedItemIndexes: Uint32Array;
  readonly changedItemNumbers: Float64Array;
  readonly changedItemFlags: Uint8Array;
  readonly removedItemIndexes: Uint32Array;
}

export interface DenseWarehouseStatsBucket {
  readonly tickNumber: number;
  readonly produced: readonly (readonly [itemIndex: number, amount: number])[];
  readonly consumed: readonly (readonly [itemIndex: number, amount: number])[];
}

export interface DenseKernelCheckpoint {
  readonly tickNumber: number;
  readonly slotItemIndexes: Int32Array;
  readonly slotCounts: Float64Array;
  readonly slotReserved: Float64Array;
  readonly slotFlags: Uint8Array;
  readonly componentItemIndexes: Int32Array;
  readonly deviceFlags: Uint8Array;
  readonly routingCursors: Uint32Array;
  readonly channelRecipeIndexes: Int32Array;
  readonly channelProgressTicks: Uint32Array;
  readonly channelStates: Uint8Array;
  readonly channelRunIds: Uint32Array;
  readonly channelReservations: Array<readonly DenseRecipeReservation[] | null>;
  readonly channelInputItems: Array<readonly DenseRecipeInputItem[] | null>;
  readonly admissionCounts: Float64Array;
  readonly admissionWindowCounts: Float64Array;
  readonly admissionWindowStartTicks: Float64Array;
  readonly admissionPastWindowCounts: readonly (readonly number[])[];
  readonly admissionMoveTicks: readonly (readonly number[])[];
  readonly powerMode: "real" | "infinite";
  readonly powerConsumptionOverride: number | undefined;
  readonly baseBatteryJoules: number;
  readonly nextRecipeRunId: number;
  readonly waterPurifierManualRemainders: Float64Array;
  readonly warehouseStatsBuckets: readonly DenseWarehouseStatsBucket[];
  readonly warehouseProducedTotals: Float64Array;
  readonly warehouseConsumedTotals: Float64Array;
  readonly warehouseLastChangedTicks: Float64Array;
}

interface DenseRecipeReservation {
  readonly slotIndex: number;
  readonly itemIndex: number;
  readonly amount: number;
  readonly ignoreStock: boolean;
}

interface DenseRecipeInputItem {
  readonly itemIndex: number;
  readonly amount: number;
}

interface DenseRecipeOutputPlacement {
  readonly slotIndex: number;
  readonly itemIndex: number;
  readonly amount: number;
}

interface DenseTransferAccumulator {
  readonly edgeIndexes: number[];
  readonly sourceSlotIndexes: number[];
  readonly targetSlotIndexes: number[];
  readonly itemIndexes: number[];
  readonly amounts: number[];
}

interface DenseAdmissionRuntime {
  readonly portIds: readonly string[];
  readonly portIndexesById: ReadonlyMap<string, number>;
  readonly deviceIndexes: Uint32Array;
  readonly itemIndexes: Int32Array;
  readonly limits: Float64Array;
  readonly perWindowLimits: Float64Array;
  readonly counts: Float64Array;
  readonly windowCounts: Float64Array;
  readonly windowStartTicks: Float64Array;
  readonly pastWindowCounts: Array<number[]>;
  readonly moveTicks: Array<number[]>;
  readonly edgeTargetIndexes: Int32Array;
  readonly edgeSourceIndexes: Int32Array;
}

const CHANNEL_IDLE = 0;
const CHANNEL_RUNNING = 1;
const CHANNEL_WAITING_OUTPUT = 2;
const BASE_POWER_GENERATION_KW = 200;
const BASE_BATTERY_CAPACITY_J = 100_000_000;

export class DenseSimulationKernel {
  public readonly state: DenseRuntimeState;
  private readonly recipePrograms: DenseRecipeProgramSet;
  private readonly lookup: DenseTopologyLookup;
  private readonly channelRecipeIndexes: Int32Array;
  private readonly channelProgressTicks: Uint32Array;
  private readonly channelStates: Uint8Array;
  private readonly channelRunIds: Uint32Array;
  private readonly channelReservations: Array<readonly DenseRecipeReservation[] | null>;
  private readonly channelInputItems: Array<readonly DenseRecipeInputItem[] | null>;
  private readonly deviceTransportPeriods: Uint32Array;
  private readonly edgePhysicalConnectionIndexes: Uint32Array;
  private readonly physicalConnectionCount: number;
  private readonly usedPhysicalConnectionFlags: Uint8Array;
  private readonly movedRoutingPortFlags: Uint8Array;
  private readonly routingBucketHeads: Int32Array;
  private readonly routingEdgeNextIndexes: Int32Array;
  private readonly maxRoutingGroupPortCount: number;
  private readonly warehouseSlotIndexesByItemIndex: Int32Array;
  private readonly warehouseItemIndexesByStorageIndex: Int32Array;
  private readonly warehouseStatsDirtyItemIndexes: DenseIndexSet;
  private readonly warehouseProducedTotals: Float64Array;
  private readonly warehouseConsumedTotals: Float64Array;
  private readonly warehouseLastChangedTicks: Float64Array;
  private readonly producerDeviceFlags: Uint8Array;
  private readonly warehouseStatsWindowCapacity: number;
  private readonly regionalOptions: DenseRegionalKernelOptions | null;
  private readonly regionalOutletIdsByEdgeIndex: readonly (string | null)[];
  private readonly regionalDeposits = new Map<number, number>();
  private regionalGateTransfers: DenseTransferAccumulator | null = null;
  private regionalGateEpochNumber: number | null = null;
  private readonly admission: DenseAdmissionRuntime;
  private readonly waterPurifierManualRemainders: Float64Array;
  private warehouseStatsBuckets: DenseWarehouseStatsBucket[] = [];
  private currentTickProduced = new Map<number, number>();
  private currentTickConsumed = new Map<number, number>();
  private activeGasDiffusions: readonly RuntimeGasDiffusionSnapshot[] = [];
  private powerMode: "real" | "infinite" = "infinite";
  private powerConsumptionOverride: number | undefined;
  private currentPowerGenerationValue = BASE_POWER_GENERATION_KW;
  private effectivePowerGeneration = BASE_POWER_GENERATION_KW;
  private powerOutage = false;
  private baseBatteryJoulesValue = BASE_BATTERY_CAPACITY_J;
  private nextRecipeRunId = 1;
  private currentTickNumber = 0;

  public constructor(
    public readonly topology: CompiledSimulationTopology,
    public readonly layout: DenseTopologyLayout,
    private readonly registry: RegistryContract,
    regionalOptions?: DenseRegionalKernelOptions,
  ) {
    assertDenseKernelTopologySupported(topology, regionalOptions);
    this.regionalOptions = regionalOptions ?? null;
    this.lookup = createDenseTopologyLookup(layout.dictionary);
    this.state = new DenseRuntimeState(layout);
    this.recipePrograms = compileDenseRecipePrograms(topology, layout, registry);
    this.channelRecipeIndexes = new Int32Array(this.recipePrograms.channels.length);
    this.channelRecipeIndexes.fill(DENSE_INDEX_NONE);
    this.channelProgressTicks = new Uint32Array(this.recipePrograms.channels.length);
    this.channelStates = new Uint8Array(this.recipePrograms.channels.length);
    this.channelRunIds = new Uint32Array(this.recipePrograms.channels.length);
    this.channelReservations = Array.from(
      { length: this.recipePrograms.channels.length },
      () => null,
    );
    this.channelInputItems = Array.from(
      { length: this.recipePrograms.channels.length },
      () => null,
    );
    this.deviceTransportPeriods = new Uint32Array(layout.dictionary.deviceIds.length);
    for (let deviceIndex = 0; deviceIndex < layout.dictionary.deviceIds.length; deviceIndex += 1) {
      const device = this.requireDevice(deviceIndex);
      this.deviceTransportPeriods[deviceIndex] = resolveDenseDeviceTransportPeriodTicks(
        topology,
        registry,
        device.definitionId,
      );
    }
    const physicalConnectionIndexById = new Map<string, number>();
    this.edgePhysicalConnectionIndexes = new Uint32Array(layout.dictionary.edgeIds.length);
    for (let edgeIndex = 0; edgeIndex < layout.dictionary.edgeIds.length; edgeIndex += 1) {
      const edgeId = layout.dictionary.edgeIds[edgeIndex]!;
      const physicalConnectionId = topology.transferEdges[edgeId]?.physicalConnectionId;
      if (physicalConnectionId === undefined) {
        throw new Error(`Dense kernel cannot resolve edge "${edgeId}".`);
      }
      let physicalIndex = physicalConnectionIndexById.get(physicalConnectionId);
      if (physicalIndex === undefined) {
        physicalIndex = physicalConnectionIndexById.size;
        physicalConnectionIndexById.set(physicalConnectionId, physicalIndex);
      }
      this.edgePhysicalConnectionIndexes[edgeIndex] = physicalIndex;
    }
    this.physicalConnectionCount = physicalConnectionIndexById.size;
    this.usedPhysicalConnectionFlags = new Uint8Array(this.physicalConnectionCount);
    this.movedRoutingPortFlags = new Uint8Array(
      layout.routingGroupConnectedFlags.length,
    );
    this.maxRoutingGroupPortCount = this.resolveMaxRoutingGroupPortCount();
    this.routingBucketHeads = new Int32Array(
      this.maxRoutingGroupPortCount * this.maxRoutingGroupPortCount,
    );
    this.routingEdgeNextIndexes = new Int32Array(layout.dictionary.edgeIds.length);
    this.warehouseSlotIndexesByItemIndex = this.compileWarehouseSlotIndexes();
    this.warehouseItemIndexesByStorageIndex = this.compileWarehouseItemIndexesByStorage();
    this.warehouseStatsDirtyItemIndexes = new DenseIndexSet(
      layout.dictionary.itemIds.length,
    );
    this.warehouseProducedTotals = new Float64Array(layout.dictionary.itemIds.length);
    this.warehouseConsumedTotals = new Float64Array(layout.dictionary.itemIds.length);
    this.warehouseLastChangedTicks = new Float64Array(layout.dictionary.itemIds.length);
    this.producerDeviceFlags = Uint8Array.from(
      layout.dictionary.deviceIds,
      (deviceId) => registry.queries
        .findEntityDefinition(topology.devices[deviceId]!.definitionId)
        ?.tags.includes("Producer") === true ? 1 : 0,
    );
    this.warehouseStatsWindowCapacity = Math.max(1, topology.standardTickRate * 60);
    this.regionalOutletIdsByEdgeIndex = this.compileRegionalOutletIdsByEdgeIndex();
    this.admission = this.compileAdmissionRuntime();
    this.waterPurifierManualRemainders = new Float64Array(
      layout.dictionary.deviceIds.length,
    );
    for (let componentIndex = 0; componentIndex < layout.dictionary.componentIds.length; componentIndex += 1) {
      this.refreshTransportComponent(componentIndex);
    }
    if (this.regionalOptions !== null) {
      this.setRegionalWarehouseCounts(this.regionalOptions.initialWarehouseCounts);
      this.state.clearDirtyState();
    }
  }

  public get tickNumber(): number {
    return this.currentTickNumber;
  }

  public get gasDiffusions(): readonly RuntimeGasDiffusionSnapshot[] {
    return this.activeGasDiffusions;
  }

  public get currentPowerGeneration(): number {
    return this.currentPowerGenerationValue;
  }

  public get isPowerOutage(): boolean {
    return this.powerOutage;
  }

  public get baseBatteryJoules(): number {
    return this.baseBatteryJoulesValue;
  }

  public get baseBatteryCapacity(): number {
    return BASE_BATTERY_CAPACITY_J;
  }

  public get effectiveTotalPowerDemand(): number {
    return this.powerConsumptionOverride ?? this.topology.totalPowerDemand;
  }

  public setPowerMode(powerMode: "real" | "infinite"): void {
    this.powerMode = powerMode;
    this.refreshPowerState(false);
  }

  public setPowerConsumptionOverride(powerConsumptionOverride: number | undefined): void {
    if (
      powerConsumptionOverride !== undefined
      && (!Number.isFinite(powerConsumptionOverride) || powerConsumptionOverride < 0)
    ) {
      throw new Error(`Dense power consumption override is invalid: ${powerConsumptionOverride}.`);
    }
    this.powerConsumptionOverride = powerConsumptionOverride;
    this.refreshPowerState(false);
  }

  public patchRuntimeSlot(patch: SimulationRuntimeSlotPatch): void {
    const compiledDeviceId = this.topology.devices[patch.entityId] !== undefined
      ? patch.entityId
      : this.topology.devices[`device:${patch.entityId}`] !== undefined
        ? `device:${patch.entityId}`
        : this.topology.ordering.deviceOrder.find((deviceId) =>
            this.topology.devices[deviceId]?.sourceEntityId === patch.entityId
          );
    if (compiledDeviceId === undefined) return;
    const deviceIndex = this.lookup.deviceIndexById.get(compiledDeviceId);
    if (deviceIndex === undefined) return;

    const targetSlotIndexes: number[] = [];
    const device = this.requireDevice(deviceIndex);
    for (const nodeId of device.nodeIds) {
      const node = this.topology.nodes[nodeId];
      if (node?.sourceStorageSlotGroupId !== patch.storageGroupId) continue;
      for (const slotId of node.slotIds) {
        const slot = this.topology.slots[slotId];
        const slotIndex = this.lookup.slotIndexById.get(slotId);
        if (slot?.sourceSlotId === patch.slotId && slotIndex !== undefined) {
          targetSlotIndexes.push(slotIndex);
        }
      }
    }
    if (targetSlotIndexes.length === 0) return;

    const itemIndex = patch.itemType === null
      ? DENSE_INDEX_NONE
      : this.lookup.itemIndexById.get(patch.itemType);
    if (itemIndex === undefined) return;
    if (
      itemIndex !== DENSE_INDEX_NONE
      && targetSlotIndexes.some((slotIndex) =>
        !this.canPatchSlotHoldItem(slotIndex, itemIndex)
      )
    ) {
      return;
    }

    const normalizedCount = itemIndex === DENSE_INDEX_NONE
      ? 0
      : Math.min(
          Math.max(0, Number.isFinite(patch.count) ? Math.trunc(patch.count) : 0),
          ...targetSlotIndexes.map((slotIndex) => this.resolvePatchCapacity(slotIndex)),
        );
    const normalizedIgnoreStock = itemIndex === DENSE_INDEX_NONE ? false : patch.ignoreStock;
    this.cancelDeviceRecipes(deviceIndex);
    for (const slotIndex of targetSlotIndexes) {
      this.state.writeSlot(slotIndex, {
        itemIndex,
        count: normalizedCount,
        reserved: 0,
        ignoreStock: normalizedIgnoreStock,
      });
      this.refreshTransportComponentForSlot(slotIndex);
    }
    this.updateDeviceBlockStates();
  }

  public resetAdmissionCounter(reset: SimulationAdmissionCounterReset): void {
    const compiledDeviceId = this.topology.devices[reset.entityId] !== undefined
      ? reset.entityId
      : this.topology.devices[`device:${reset.entityId}`] !== undefined
        ? `device:${reset.entityId}`
        : this.topology.ordering.deviceOrder.find((deviceId) =>
            this.topology.devices[deviceId]?.sourceEntityId === reset.entityId
          );
    if (compiledDeviceId === undefined) return;
    const device = this.topology.devices[compiledDeviceId];
    if (device === undefined) return;
    const portId = device.portIds.find((candidatePortId) => {
      const port = this.topology.ports[candidatePortId];
      return port?.admissionRule !== null
        && port?.admissionRule !== undefined
        && port.portGroupId === reset.portGroupId
        && port.portDefinitionId === reset.portId;
    });
    if (portId === undefined) return;
    const admissionIndex = this.admission.portIndexesById.get(portId);
    if (admissionIndex === undefined) return;
    if (reset.scope === "rate-window") {
      this.admission.windowCounts[admissionIndex] = 0;
      this.admission.windowStartTicks[admissionIndex] = this.resolveAdmissionWindowStartTick();
      this.admission.pastWindowCounts[admissionIndex] = [];
      this.admission.moveTicks[admissionIndex] = [];
    } else {
      this.admission.counts[admissionIndex] = 0;
    }
    const deviceIndex = this.lookup.deviceIndexById.get(compiledDeviceId);
    if (deviceIndex !== undefined) this.state.dirtyDeviceIndexes.add(deviceIndex);
  }

  public createCheckpoint(): DenseKernelCheckpoint {
    return {
      tickNumber: this.currentTickNumber,
      slotItemIndexes: this.state.slotItemIndexes.slice(),
      slotCounts: this.state.slotCounts.slice(),
      slotReserved: this.state.slotReserved.slice(),
      slotFlags: this.state.slotFlags.slice(),
      componentItemIndexes: this.state.componentItemIndexes.slice(),
      deviceFlags: this.state.deviceFlags.slice(),
      routingCursors: this.state.routingCursors.slice(),
      channelRecipeIndexes: this.channelRecipeIndexes.slice(),
      channelProgressTicks: this.channelProgressTicks.slice(),
      channelStates: this.channelStates.slice(),
      channelRunIds: this.channelRunIds.slice(),
      channelReservations: this.channelReservations.map((reservations) =>
        reservations?.map((reservation) => ({ ...reservation })) ?? null
      ),
      channelInputItems: this.channelInputItems.map((items) =>
        items?.map((item) => ({ ...item })) ?? null
      ),
      admissionCounts: this.admission.counts.slice(),
      admissionWindowCounts: this.admission.windowCounts.slice(),
      admissionWindowStartTicks: this.admission.windowStartTicks.slice(),
      admissionPastWindowCounts: this.admission.pastWindowCounts.map((counts) => [...counts]),
      admissionMoveTicks: this.admission.moveTicks.map((ticks) => [...ticks]),
      powerMode: this.powerMode,
      powerConsumptionOverride: this.powerConsumptionOverride,
      baseBatteryJoules: this.baseBatteryJoulesValue,
      nextRecipeRunId: this.nextRecipeRunId,
      waterPurifierManualRemainders: this.waterPurifierManualRemainders.slice(),
      warehouseStatsBuckets: this.warehouseStatsBuckets.map(cloneWarehouseStatsBucket),
      warehouseProducedTotals: this.warehouseProducedTotals.slice(),
      warehouseConsumedTotals: this.warehouseConsumedTotals.slice(),
      warehouseLastChangedTicks: this.warehouseLastChangedTicks.slice(),
    };
  }

  public restoreCheckpoint(checkpoint: DenseKernelCheckpoint): void {
    this.assertCheckpointShape(checkpoint);
    this.currentTickNumber = checkpoint.tickNumber;
    this.state.slotItemIndexes.set(checkpoint.slotItemIndexes);
    this.state.slotCounts.set(checkpoint.slotCounts);
    this.state.slotReserved.set(checkpoint.slotReserved);
    this.state.slotFlags.set(checkpoint.slotFlags);
    this.state.componentItemIndexes.set(checkpoint.componentItemIndexes);
    this.state.deviceFlags.set(checkpoint.deviceFlags);
    this.state.routingCursors.set(checkpoint.routingCursors);
    this.channelRecipeIndexes.set(checkpoint.channelRecipeIndexes);
    this.channelProgressTicks.set(checkpoint.channelProgressTicks);
    this.channelStates.set(checkpoint.channelStates);
    this.channelRunIds.set(checkpoint.channelRunIds);
    for (let index = 0; index < this.channelReservations.length; index += 1) {
      this.channelReservations[index] = checkpoint.channelReservations[index]
        ?.map((reservation) => ({ ...reservation })) ?? null;
      this.channelInputItems[index] = checkpoint.channelInputItems[index]
        ?.map((item) => ({ ...item })) ?? null;
    }
    this.admission.counts.set(checkpoint.admissionCounts);
    this.admission.windowCounts.set(checkpoint.admissionWindowCounts);
    this.admission.windowStartTicks.set(checkpoint.admissionWindowStartTicks);
    for (let index = 0; index < this.admission.portIds.length; index += 1) {
      this.admission.pastWindowCounts[index] = [
        ...(checkpoint.admissionPastWindowCounts[index] ?? []),
      ];
      this.admission.moveTicks[index] = [...(checkpoint.admissionMoveTicks[index] ?? [])];
    }
    this.powerMode = checkpoint.powerMode;
    this.powerConsumptionOverride = checkpoint.powerConsumptionOverride;
    this.baseBatteryJoulesValue = checkpoint.baseBatteryJoules;
    this.nextRecipeRunId = checkpoint.nextRecipeRunId;
    this.waterPurifierManualRemainders.set(checkpoint.waterPurifierManualRemainders);
    this.warehouseStatsBuckets = checkpoint.warehouseStatsBuckets.map(
      cloneWarehouseStatsBucket,
    );
    this.warehouseProducedTotals.set(checkpoint.warehouseProducedTotals);
    this.warehouseConsumedTotals.set(checkpoint.warehouseConsumedTotals);
    this.warehouseLastChangedTicks.set(checkpoint.warehouseLastChangedTicks);
    this.currentTickProduced = new Map();
    this.currentTickConsumed = new Map();
    this.warehouseStatsDirtyItemIndexes.clear();
    this.activeGasDiffusions = this.collectActiveGasDiffusions();
    this.refreshPowerState(false);
    this.state.clearDirtyState();
  }

  public restoreMigratedRuntime(
    previous: DenseSimulationKernel,
    resetDeviceIds: readonly string[],
  ): void {
    if (previous.topology.standardTickRate !== this.topology.standardTickRate) {
      throw new Error("Dense topology migration cannot change the standard tick rate.");
    }

    const resetDevices = new Set(resetDeviceIds);
    const preservedDeviceIds = new Set<string>();
    this.currentTickNumber = previous.currentTickNumber;
    this.baseBatteryJoulesValue = previous.baseBatteryJoulesValue;
    this.nextRecipeRunId = previous.nextRecipeRunId;

    for (let deviceIndex = 0; deviceIndex < this.layout.dictionary.deviceIds.length; deviceIndex += 1) {
      const deviceId = this.layout.dictionary.deviceIds[deviceIndex]!;
      const previousDeviceIndex = previous.lookup.deviceIndexById.get(deviceId);
      const device = this.topology.devices[deviceId];
      if (
        resetDevices.has(deviceId)
        || previousDeviceIndex === undefined
        || device === undefined
      ) {
        continue;
      }
      preservedDeviceIds.add(deviceId);
      this.state.deviceFlags[deviceIndex] = previous.state.deviceFlags[previousDeviceIndex]!;
      this.waterPurifierManualRemainders[deviceIndex] =
        previous.waterPurifierManualRemainders[previousDeviceIndex] ?? 0;

      for (const nodeId of device.nodeIds) {
        const node = this.topology.nodes[nodeId];
        if (node === undefined) continue;
        for (const slotId of node.slotIds) {
          const slotIndex = this.lookup.slotIndexById.get(slotId);
          const previousSlotIndex = previous.lookup.slotIndexById.get(slotId);
          if (slotIndex === undefined || previousSlotIndex === undefined) continue;
          const previousStorageIndex = previous.layout.slotStorageIndexes[previousSlotIndex]!;
          const previousOwnsStorage = previousStorageIndex === previousSlotIndex;
          const previousItemIndex = previousOwnsStorage
            ? previous.state.slotItemIndexes[previousSlotIndex]!
            : DENSE_INDEX_NONE;
          this.state.slotItemIndexes[slotIndex] = mapDenseItemIndex(
            previous.layout,
            this.lookup,
            previousItemIndex,
          );
          this.state.slotCounts[slotIndex] = previousOwnsStorage
            ? previous.state.slotCounts[previousSlotIndex]!
            : 0;
          this.state.slotReserved[slotIndex] = 0;
          this.state.slotFlags[slotIndex] = this.layout.slotInitialFlags[slotIndex]!;
        }
      }
    }

    this.normalizeMigratedSlotAliases();
    this.restoreMigratedRecipeChannels(previous, preservedDeviceIds);
    this.restoreMigratedAdmissionCounters(previous, preservedDeviceIds);
    this.restoreMigratedRoutingCursors(previous, preservedDeviceIds);
    this.resetConflictingMigratedTransportComponents();
    this.updateDeviceBlockStates();
    this.activeGasDiffusions = this.collectActiveGasDiffusions();
    this.refreshPowerState(false);
    this.state.clearDirtyState();
  }

  public createWarehouseStatsDelta(
    includeAll: boolean,
    changedStorageIndexes: readonly number[],
  ): DenseWarehouseStatsDelta {
    const changedItemIndexes = new DenseIndexSet(this.layout.dictionary.itemIds.length);
    if (includeAll) {
      for (let itemIndex = 0; itemIndex < this.layout.dictionary.itemIds.length; itemIndex += 1) {
        if (this.shouldPresentWarehouseItem(itemIndex)) changedItemIndexes.add(itemIndex);
      }
      this.warehouseStatsDirtyItemIndexes.clear();
    } else {
      this.warehouseStatsDirtyItemIndexes.drain((itemIndex) => {
        changedItemIndexes.add(itemIndex);
      });
      for (const storageIndex of changedStorageIndexes) {
        const itemIndex = this.warehouseItemIndexesByStorageIndex[storageIndex]!;
        if (itemIndex !== DENSE_INDEX_NONE) changedItemIndexes.add(itemIndex);
      }
    }

    const changed: number[] = [];
    changedItemIndexes.drain((itemIndex) => changed.push(itemIndex));
    changed.sort(compareNumbers);
    const patched: number[] = [];
    const numbers: number[] = [];
    const flags: number[] = [];
    const removed: number[] = [];
    const statsWindowReady = this.currentTickNumber >= this.warehouseStatsWindowCapacity;
    for (const itemIndex of changed) {
      if (!this.shouldPresentWarehouseItem(itemIndex)) {
        removed.push(itemIndex);
        continue;
      }
      const warehouse = this.readWarehouseItem(itemIndex);
      patched.push(itemIndex);
      numbers.push(
        statsWindowReady ? this.warehouseProducedTotals[itemIndex]! : 0,
        statsWindowReady ? this.warehouseConsumedTotals[itemIndex]! : 0,
        warehouse.count,
        this.warehouseLastChangedTicks[itemIndex]!,
      );
      flags.push(warehouse.infinite ? 1 : 0);
    }
    return {
      statsWindowReady,
      changedItemIndexes: Uint32Array.from(patched),
      changedItemNumbers: Float64Array.from(numbers),
      changedItemFlags: Uint8Array.from(flags),
      removedItemIndexes: Uint32Array.from(removed),
    };
  }

  public createDeviceSnapshot(deviceIndex: number): RuntimeDeviceSnapshot {
    const channelRecipes: Record<string, RuntimeDeviceRecipeSnapshot | null> = {};
    let firstRecipe: RuntimeDeviceRecipeSnapshot | null = null;
    const start = this.recipePrograms.deviceChannelOffsets[deviceIndex]!;
    const end = this.recipePrograms.deviceChannelOffsets[deviceIndex + 1]!;
    for (let offset = start; offset < end; offset += 1) {
      const channelIndex = this.recipePrograms.deviceChannelIndexes[offset]!;
      const channel = this.recipePrograms.channels[channelIndex]!;
      const recipe = this.createChannelRecipeSnapshot(channel);
      if (recipe !== null || this.channelRunIds[channelIndex] !== 0) {
        channelRecipes[channel.channelId] = recipe;
      }
      firstRecipe ??= recipe;
    }
    return {
      deviceId: this.layout.dictionary.deviceIds[deviceIndex]!,
      block: this.state.deviceFlags[deviceIndex] !== 0,
      recipe: firstRecipe,
      channelRecipes,
      admissionCounters: this.createAdmissionCounterSnapshots(deviceIndex),
    };
  }

  public advanceToTick(
    targetTickNumber: number,
    onCommittedTick?: (result: DenseKernelTickResult) => void,
  ): DenseKernelTickResult | null {
    if (!Number.isSafeInteger(targetTickNumber) || targetTickNumber < this.currentTickNumber) {
      throw new Error(
        `Dense kernel cannot advance from tick ${this.currentTickNumber} to ${targetTickNumber}.`,
      );
    }

    let latestResult: DenseKernelTickResult | null = null;
    while (this.currentTickNumber < targetTickNumber) {
      this.currentTickNumber += 1;
      latestResult = this.advanceOneTick();
      onCommittedTick?.(latestResult);
    }
    return latestResult;
  }

  public prepareRegionalEpoch(
    epochNumber: number,
    onCommittedTick?: (result: DenseKernelTickResult) => void,
  ): {
    readonly tickNumber: number;
    readonly demandedOutletIds: readonly string[];
  } {
    const regional = this.requireRegionalOptions();
    if (this.regionalGateTransfers !== null) {
      throw new Error(`Dense regional gate is already paused at epoch ${this.regionalGateEpochNumber}.`);
    }
    const gateTickNumber = resolveRegionalGateTick(epochNumber);
    if (gateTickNumber <= this.currentTickNumber) {
      throw new Error(`Dense regional epoch ${epochNumber} gate ${gateTickNumber} has already passed.`);
    }
    this.advanceToTick(gateTickNumber - 1, onCommittedTick);
    this.currentTickNumber = gateTickNumber;
    const transfers = createTransferAccumulator();
    this.beginTick(transfers);
    this.regionalGateTransfers = transfers;
    this.regionalGateEpochNumber = epochNumber;

    const demandedOutletIds: string[] = [];
    for (const outletId of regional.table.orderedOutletIds) {
      const outlet = regional.table.outletById[outletId];
      if (outlet?.baseId !== regional.baseId) continue;
      const edgeIndex = this.lookup.edgeIndexById.get(outlet.transferEdgeId);
      const itemIndex = this.lookup.itemIndexById.get(outlet.itemId);
      if (
        edgeIndex !== undefined
        && itemIndex !== undefined
        && this.canApplyRegionalOutlet(edgeIndex, itemIndex)
      ) {
        demandedOutletIds.push(outletId);
      }
    }
    return { tickNumber: gateTickNumber, demandedOutletIds };
  }

  public applyRegionalGrant(
    epochNumber: number,
    grantedOutletIds: readonly string[],
  ): DenseRegionalGrantResult {
    const regional = this.requireRegionalOptions();
    const transfers = this.regionalGateTransfers;
    if (transfers === null || this.regionalGateEpochNumber !== epochNumber) {
      throw new Error(`Dense regional gate is not paused at epoch ${epochNumber}.`);
    }
    for (const outletId of grantedOutletIds) {
      const outlet = regional.table.outletById[outletId];
      if (outlet?.baseId !== regional.baseId) {
        throw new Error(`Dense regional grant contains invalid outlet "${outletId}".`);
      }
      const edgeIndex = this.lookup.edgeIndexById.get(outlet.transferEdgeId);
      const itemIndex = this.lookup.itemIndexById.get(outlet.itemId);
      const sourceSlotIndex = this.lookup.slotIndexById.get(outlet.sourceCompiledSlotId);
      if (edgeIndex === undefined || itemIndex === undefined || sourceSlotIndex === undefined) {
        throw new Error(`Dense regional grant cannot resolve outlet "${outletId}".`);
      }
      const targetNodeIndex = this.layout.edgeTargetNodeIndexes[edgeIndex]!;
      const targetSlotIndex = this.selectTargetSlot(targetNodeIndex, itemIndex);
      if (targetSlotIndex === DENSE_INDEX_NONE || !this.canApplyRegionalOutlet(edgeIndex, itemIndex)) {
        throw new Error(`Dense regional grant cannot be applied to outlet "${outletId}".`);
      }
      this.state.produce(targetSlotIndex, itemIndex, 1);
      this.refreshTransportComponentForSlot(targetSlotIndex);
      this.markRoutingPortsMoved(edgeIndex);
      this.recordAdmissionMove(edgeIndex);
      transfers.edgeIndexes.push(edgeIndex);
      transfers.sourceSlotIndexes.push(sourceSlotIndex);
      transfers.targetSlotIndexes.push(targetSlotIndex);
      transfers.itemIndexes.push(itemIndex);
      transfers.amounts.push(1);
    }
    this.rotateRoutingCursors();
    this.finishTick();
    const deposits = [...this.regionalDeposits.entries()]
      .filter(([, amount]) => amount > 0)
      .sort(compareNumberEntries)
      .map(([itemIndex, amount]) => ({
        itemId: this.layout.dictionary.itemIds[itemIndex]!,
        amount,
      }));
    this.regionalDeposits.clear();
    return {
      result: createKernelTickResult(this.currentTickNumber, transfers),
      deposits,
    };
  }

  public finalizeRegionalEpoch(
    epochNumber: number,
    nextWarehouseCounts: Readonly<Record<string, number>>,
  ): void {
    if (this.regionalGateEpochNumber !== epochNumber || this.regionalGateTransfers === null) {
      throw new Error(`Dense regional gate is not ready to finalize epoch ${epochNumber}.`);
    }
    this.setRegionalWarehouseCounts(nextWarehouseCounts);
    this.regionalGateTransfers = null;
    this.regionalGateEpochNumber = null;
  }

  private advanceOneTick(): DenseKernelTickResult {
    const transfers = createTransferAccumulator();
    this.beginTick(transfers);
    this.finishTick();
    return createKernelTickResult(this.currentTickNumber, transfers);
  }

  private beginTick(transfers: DenseTransferAccumulator): void {
    this.currentTickProduced.clear();
    this.currentTickConsumed.clear();
    this.normalizeAdmissionWindows();
    this.refreshPowerState(true);
    this.activeGasDiffusions = this.collectActiveGasDiffusions();
    this.advanceRunningRecipes();
    this.applyWaterPurifierManualOutput();

    this.moveExternalTransfers(transfers);
  }

  private finishTick(): void {
    this.settleWaitingRecipes();
    this.activeGasDiffusions = this.collectActiveGasDiffusions();
    this.startIdleRecipes();
    this.applyBlockageAutoClearance();
    this.updateDeviceBlockStates();
    this.activeGasDiffusions = this.collectActiveGasDiffusions();
    this.commitWarehouseStatsTick();
  }

  private advanceRunningRecipes(): void {
    for (const channel of this.recipePrograms.channels) {
      if (this.channelStates[channel.index] !== CHANNEL_RUNNING) {
        continue;
      }
      const recipe = this.getRunningProgram(channel);
      if (
        (!channel.consumptionChannel && !this.hasDevicePower(channel.deviceIndex))
        || (recipe.requiredGasItemIndex !== DENSE_INDEX_NONE
          && !this.isDeviceCoveredByGas(channel.deviceIndex, recipe.requiredGasItemIndex))
      ) {
        continue;
      }

      this.channelProgressTicks[channel.index] =
        this.channelProgressTicks[channel.index]! + 1;
      this.state.dirtyDeviceIndexes.add(channel.deviceIndex);
      if (this.channelProgressTicks[channel.index]! < recipe.durationTicks) {
        continue;
      }

      this.channelProgressTicks[channel.index] = recipe.durationTicks;
      this.channelStates[channel.index] = CHANNEL_WAITING_OUTPUT;
      this.tryCompleteRecipe(channel, recipe);
    }
  }

  private settleWaitingRecipes(): void {
    for (const channel of this.recipePrograms.channels) {
      if (this.channelStates[channel.index] !== CHANNEL_WAITING_OUTPUT) {
        continue;
      }
      this.tryCompleteRecipe(channel, this.getRunningProgram(channel));
    }
  }

  private startIdleRecipes(): void {
    for (const channel of this.recipePrograms.channels) {
      if (
        this.channelStates[channel.index] !== CHANNEL_IDLE
        || !this.isDeviceTransferPhase(channel.deviceIndex)
        || (!channel.consumptionChannel && !this.hasDevicePower(channel.deviceIndex))
      ) {
        continue;
      }
      for (let recipeIndex = 0; recipeIndex < channel.candidates.length; recipeIndex += 1) {
        const recipe = channel.candidates[recipeIndex]!;
        if (
          (recipe.requiredGasItemIndex !== DENSE_INDEX_NONE
            && !this.isDeviceCoveredByGas(channel.deviceIndex, recipe.requiredGasItemIndex))
          || this.isRecipeAlreadyRunningOnSiblingChannel(channel, recipe.recipeId)
        ) {
          continue;
        }
        const reservations = this.selectRecipeInputs(channel, recipe);
        if (reservations === null) {
          continue;
        }
        this.commitRecipeStart(channel, recipeIndex, recipe, reservations);
        break;
      }
    }
  }

  private commitRecipeStart(
    channel: DenseRecipeChannelProgram,
    recipeIndex: number,
    recipe: DenseRecipeProgram,
    reservations: readonly DenseRecipeReservation[],
  ): void {
    const inputItems = aggregateInputItems(reservations);
    if (recipe.recipeType === "immediate-consume") {
      for (const reservation of reservations) {
        this.state.consume(
          reservation.slotIndex,
          reservation.itemIndex,
          reservation.amount,
          reservation.ignoreStock,
        );
        this.refreshTransportComponentForSlot(reservation.slotIndex);
      }
      this.channelReservations[channel.index] = [];
      if (channel.producer) this.recordWarehouseConsumption(inputItems);
    } else {
      for (const reservation of reservations) {
        if (!reservation.ignoreStock) {
          this.state.adjustReserved(reservation.slotIndex, reservation.amount);
        }
      }
      this.channelReservations[channel.index] = reservations;
    }
    this.channelInputItems[channel.index] = inputItems;
    this.channelRecipeIndexes[channel.index] = recipeIndex;
    this.channelProgressTicks[channel.index] = 0;
    this.channelStates[channel.index] = CHANNEL_RUNNING;
    this.channelRunIds[channel.index] = this.nextRecipeRunId;
    this.nextRecipeRunId += 1;
    this.state.dirtyDeviceIndexes.add(channel.deviceIndex);
  }

  private tryCompleteRecipe(
    channel: DenseRecipeChannelProgram,
    recipe: DenseRecipeProgram,
  ): boolean {
    if (!this.isDeviceTransferPhase(channel.deviceIndex)) {
      return false;
    }
    const reservations = this.channelReservations[channel.index] ?? [];
    const inputItems = this.channelInputItems[channel.index] ?? [];
    const placements = this.selectRecipeOutputs(
      channel,
      recipe,
      reservations,
      inputItems,
    );
    if (placements === null) {
      return false;
    }

    if (recipe.recipeType === "reserved-item") {
      for (const reservation of reservations) {
        if (!reservation.ignoreStock) {
          this.state.adjustReserved(reservation.slotIndex, -reservation.amount);
        }
        this.state.consume(
          reservation.slotIndex,
          reservation.itemIndex,
          reservation.amount,
          reservation.ignoreStock,
        );
        this.refreshTransportComponentForSlot(reservation.slotIndex);
      }
      if (channel.producer) this.recordWarehouseConsumption(inputItems);
    }
    for (const placement of placements) {
      this.state.produce(placement.slotIndex, placement.itemIndex, placement.amount);
      this.refreshTransportComponentForSlot(placement.slotIndex);
    }
    if (channel.producer) {
      for (const placement of placements) {
        this.recordWarehouseStat(this.currentTickProduced, placement.itemIndex, placement.amount);
      }
    }
    if (recipe.warehouseSubmit) {
      this.submitDeviceInventoryToWarehouse(channel.deviceIndex);
    }

    this.channelRecipeIndexes[channel.index] = DENSE_INDEX_NONE;
    this.channelProgressTicks[channel.index] = 0;
    this.channelStates[channel.index] = CHANNEL_IDLE;
    this.channelReservations[channel.index] = null;
    this.channelInputItems[channel.index] = null;
    this.state.dirtyDeviceIndexes.add(channel.deviceIndex);
    return true;
  }

  private selectRecipeInputs(
    channel: DenseRecipeChannelProgram,
    recipe: DenseRecipeProgram,
  ): readonly DenseRecipeReservation[] | null {
    const reservations: DenseRecipeReservation[] = [];
    const locallyTakenByStorageIndex = new Map<number, number>();
    for (const input of recipe.inputs) {
      let remaining = input.amount;
      for (const slotIndex of channel.ingredientSlotIndexes) {
        if (remaining <= 0) {
          break;
        }
        const storageIndex = this.layout.slotStorageIndexes[slotIndex]!;
        const itemIndex = this.state.slotItemIndexes[storageIndex]!;
        if (itemIndex === DENSE_INDEX_NONE || !this.recipeRuleMatches(input, itemIndex)) {
          continue;
        }
        const ignoreStock = this.state.slotFlags[slotIndex] !== 0;
        const available = ignoreStock
          ? Number.POSITIVE_INFINITY
          : this.state.slotCounts[storageIndex]!
            - this.state.slotReserved[storageIndex]!
            - (locallyTakenByStorageIndex.get(storageIndex) ?? 0);
        if (available <= 0) {
          continue;
        }
        const amount = Math.min(available, remaining);
        reservations.push({ slotIndex, itemIndex, amount, ignoreStock });
        locallyTakenByStorageIndex.set(
          storageIndex,
          (locallyTakenByStorageIndex.get(storageIndex) ?? 0) + amount,
        );
        remaining -= amount;
      }
      if (remaining > 0) {
        return null;
      }
    }
    return reservations;
  }

  private selectRecipeOutputs(
    channel: DenseRecipeChannelProgram,
    recipe: DenseRecipeProgram,
    reservations: readonly DenseRecipeReservation[],
    inputItems: readonly DenseRecipeInputItem[],
  ): readonly DenseRecipeOutputPlacement[] | null {
    const virtualItems = new Map<number, number>();
    const virtualCounts = new Map<number, number>();
    if (recipe.recipeType === "reserved-item") {
      for (const reservation of reservations) {
        if (reservation.ignoreStock) {
          continue;
        }
        const storageIndex = this.layout.slotStorageIndexes[reservation.slotIndex]!;
        const nextCount = this.readVirtualCount(storageIndex, virtualCounts)
          - reservation.amount;
        virtualCounts.set(storageIndex, nextCount);
        if (nextCount === 0) {
          virtualItems.set(storageIndex, DENSE_INDEX_NONE);
        }
      }
    }

    const placements: DenseRecipeOutputPlacement[] = [];
    const firstInputItemIndex = inputItems[0]?.itemIndex ?? DENSE_INDEX_NONE;
    for (const output of recipe.outputs) {
      const itemIndex = output.kind === DENSE_RECIPE_ITEM_SAME_AS_INPUT
        ? firstInputItemIndex
        : output.value;
      if (itemIndex === DENSE_INDEX_NONE) {
        return null;
      }
      for (let amount = 0; amount < output.amount; amount += 1) {
        const slotIndex = this.selectVirtualRecipeOutputSlot(
          channel.productSlotIndexes,
          itemIndex,
          virtualItems,
          virtualCounts,
        );
        if (slotIndex === DENSE_INDEX_NONE) {
          return null;
        }
        const storageIndex = this.layout.slotStorageIndexes[slotIndex]!;
        virtualItems.set(storageIndex, itemIndex);
        virtualCounts.set(
          storageIndex,
          this.readVirtualCount(storageIndex, virtualCounts) + 1,
        );
        placements.push({ slotIndex, itemIndex, amount: 1 });
      }
    }
    return placements;
  }

  private moveExternalTransfers(output: {
    readonly edgeIndexes: number[];
    readonly sourceSlotIndexes: number[];
    readonly targetSlotIndexes: number[];
    readonly itemIndexes: number[];
    readonly amounts: number[];
  }): void {
    this.usedPhysicalConnectionFlags.fill(0);
    this.movedRoutingPortFlags.fill(0);
    this.prepareRoutingBuckets();
    let movedInPass: boolean;
    do {
      movedInPass = false;
      for (
        let sourceRank = 0;
        sourceRank < this.maxRoutingGroupPortCount;
        sourceRank += 1
      ) {
        for (
          let targetRank = 0;
          targetRank < this.maxRoutingGroupPortCount;
          targetRank += 1
        ) {
          const bucketIndex = sourceRank * this.maxRoutingGroupPortCount + targetRank;
          for (
            let edgeIndex = this.routingBucketHeads[bucketIndex]!;
            edgeIndex !== DENSE_INDEX_NONE;
            edgeIndex = this.routingEdgeNextIndexes[edgeIndex]!
          ) {
            if (this.regionalOutletIdsByEdgeIndex[edgeIndex] !== null) {
              continue;
            }
            const physicalIndex = this.edgePhysicalConnectionIndexes[edgeIndex]!;
            if (
              this.usedPhysicalConnectionFlags[physicalIndex] !== 0
              || !this.canEdgeTransferAtCurrentPhase(edgeIndex)
            ) {
              continue;
            }
            const selection = this.selectTransfer(edgeIndex);
            if (selection === null) {
              continue;
            }
            const sourceStorageIndex = this.layout.slotStorageIndexes[
              selection.sourceSlotIndex
            ]!;
            const ignoreStock = this.state.slotFlags[selection.sourceSlotIndex] !== 0;
            this.state.consume(
              selection.sourceSlotIndex,
              selection.itemIndex,
              1,
              ignoreStock,
            );
            if (this.isRegionalWarehouseSlot(selection.targetSlotIndex)) {
              this.recordRegionalDeposit(selection.itemIndex, 1);
            } else {
              this.state.produce(selection.targetSlotIndex, selection.itemIndex, 1);
            }
            this.refreshTransportComponentForSlot(selection.sourceSlotIndex);
            this.refreshTransportComponentForSlot(selection.targetSlotIndex);
            if (
              !ignoreStock
              && this.state.slotCounts[sourceStorageIndex]!
                < this.state.slotReserved[sourceStorageIndex]!
            ) {
              throw new Error("Dense transfer consumed reserved recipe input.");
            }

            this.usedPhysicalConnectionFlags[physicalIndex] = 1;
            this.markRoutingPortsMoved(edgeIndex);
            this.recordAdmissionMove(edgeIndex);
            output.edgeIndexes.push(edgeIndex);
            output.sourceSlotIndexes.push(selection.sourceSlotIndex);
            output.targetSlotIndexes.push(selection.targetSlotIndex);
            output.itemIndexes.push(selection.itemIndex);
            output.amounts.push(1);
            movedInPass = true;
          }
        }
      }
    } while (movedInPass);
    this.rotateRoutingCursors();

    // AI-REMOVED 2026-09-03:
    // Reason: 同一 Node 的不同物理端口可以在同一 tick 各接收一次；Node 级互斥会错误压低多端口设备吞吐。
    // Trigger: 新版求解器与旧求解器 Blueprint 差分，确认旧 Stage 3 允许同 Node 多条独立连接完成搬运。
    // Evidence: dual-oven-xiranite 的多路设备需要依赖端口容量与物理连接约束，而非 usedTargetNodes 全局互斥。
    // Replacement: usedPhysicalConnectionFlags + 槽位/共享容量检查。
    // Risk: Medium - 后续 Blueprint 差分继续覆盖多输入汇聚和共享容量。
    // Human Review: Required
    //
    // Original code:
    // const usedTargetNodes = new Uint8Array(this.layout.dictionary.nodeIds.length);
    // || usedTargetNodes[targetNodeIndex] !== 0
    // usedTargetNodes[targetNodeIndex] = 1;
  }

  private prepareRoutingBuckets(): void {
    this.routingBucketHeads.fill(DENSE_INDEX_NONE);
    this.routingEdgeNextIndexes.fill(DENSE_INDEX_NONE);
    for (let edgeIndex = 0; edgeIndex < this.layout.dictionary.edgeIds.length; edgeIndex += 1) {
      const sourceRank = this.resolveEdgeRoutingRank(edgeIndex, true);
      const targetRank = this.resolveEdgeRoutingRank(edgeIndex, false);
      const bucketIndex = sourceRank * this.maxRoutingGroupPortCount + targetRank;
      this.routingEdgeNextIndexes[edgeIndex] = this.routingBucketHeads[bucketIndex]!;
      this.routingBucketHeads[bucketIndex] = edgeIndex;
    }
  }

  private resolveEdgeRoutingRank(edgeIndex: number, source: boolean): number {
    const groupIndex = source
      ? this.layout.edgeSourceRoutingGroupIndexes[edgeIndex]!
      : this.layout.edgeTargetRoutingGroupIndexes[edgeIndex]!;
    const portIndex = source
      ? this.layout.edgeSourceRoutingPortIndexes[edgeIndex]!
      : this.layout.edgeTargetRoutingPortIndexes[edgeIndex]!;
    const portCount = this.layout.routingGroupPortOffsets[groupIndex + 1]!
      - this.layout.routingGroupPortOffsets[groupIndex]!;
    const cursor = this.state.routingCursors[groupIndex]! % portCount;
    return (portIndex - cursor + portCount) % portCount;
  }

  private markRoutingPortsMoved(edgeIndex: number): void {
    const sourceGroupIndex = this.layout.edgeSourceRoutingGroupIndexes[edgeIndex]!;
    const targetGroupIndex = this.layout.edgeTargetRoutingGroupIndexes[edgeIndex]!;
    const sourceOffset = this.layout.routingGroupPortOffsets[sourceGroupIndex]!
      + this.layout.edgeSourceRoutingPortIndexes[edgeIndex]!;
    const targetOffset = this.layout.routingGroupPortOffsets[targetGroupIndex]!
      + this.layout.edgeTargetRoutingPortIndexes[edgeIndex]!;
    this.movedRoutingPortFlags[sourceOffset] = 1;
    this.movedRoutingPortFlags[targetOffset] = 1;
  }

  private rotateRoutingCursors(): void {
    for (
      let groupIndex = 0;
      groupIndex < this.layout.dictionary.routingCursorKeys.length;
      groupIndex += 1
    ) {
      const start = this.layout.routingGroupPortOffsets[groupIndex]!;
      const end = this.layout.routingGroupPortOffsets[groupIndex + 1]!;
      const portCount = end - start;
      const cursor = this.state.routingCursors[groupIndex]! % portCount;
      let anyMoved = false;
      for (let portIndex = start; portIndex < end; portIndex += 1) {
        if (this.movedRoutingPortFlags[portIndex] !== 0) {
          anyMoved = true;
          break;
        }
      }
      if (!anyMoved) {
        continue;
      }

      let skipped = 0;
      for (let rank = 0; rank < portCount; rank += 1) {
        const portOffset = start + ((cursor + rank) % portCount);
        if (
          this.layout.routingGroupConnectedFlags[portOffset] === 0
          || this.movedRoutingPortFlags[portOffset] !== 0
        ) {
          skipped += 1;
          continue;
        }
        break;
      }
      const nextCursor = (cursor + skipped) % portCount;
      if (nextCursor !== cursor) {
        this.state.routingCursors[groupIndex] = nextCursor;
        this.state.dirtyRoutingCursorIndexes.add(groupIndex);
      }
    }
  }

  private resolveMaxRoutingGroupPortCount(): number {
    let maximum = 1;
    for (
      let groupIndex = 0;
      groupIndex < this.layout.dictionary.routingCursorKeys.length;
      groupIndex += 1
    ) {
      maximum = Math.max(
        maximum,
        this.layout.routingGroupPortOffsets[groupIndex + 1]!
          - this.layout.routingGroupPortOffsets[groupIndex]!,
      );
    }
    return maximum;
  }

  private selectTransfer(edgeIndex: number): {
    readonly sourceSlotIndex: number;
    readonly targetSlotIndex: number;
    readonly itemIndex: number;
  } | null {
    const sourceNodeIndex = this.layout.edgeSourceNodeIndexes[edgeIndex]!;
    const targetNodeIndex = this.layout.edgeTargetNodeIndexes[edgeIndex]!;
    const sourceStart = this.layout.nodeSlotOffsets[sourceNodeIndex]!;
    const sourceEnd = this.layout.nodeSlotOffsets[sourceNodeIndex + 1]!;
    // AI-REMOVED 2026-09-03:
    // Reason: 目标槽选择已集中到 selectTargetSlot，避免绕过 Node 内同物品单槽互斥语义。
    // Trigger: 武陵电池 Blueprint 中共享输入 Node 被同一液体占满多个槽，导致双产物配方永久阻塞。
    // Evidence: dense 运行态显示 mix_pool_1 的四个槽同时被 item_liquid_sewage 占满；旧 findInputSlotForItem 禁止该状态。
    // Replacement: selectTargetSlot。
    // Risk: Low - 仅移除重复的范围局部变量。
    // Human Review: Required
    //
    // Original code:
    // const targetStart = this.layout.nodeSlotOffsets[targetNodeIndex]!;
    // const targetEnd = this.layout.nodeSlotOffsets[targetNodeIndex + 1]!;

    for (let sourceOffset = sourceStart; sourceOffset < sourceEnd; sourceOffset += 1) {
      const sourceSlotIndex = this.layout.nodeSlotIndexes[sourceOffset]!;
      const sourceStorageIndex = this.layout.slotStorageIndexes[sourceSlotIndex]!;
      const itemIndex = this.state.slotItemIndexes[sourceStorageIndex]!;
      const ignoreStock = this.state.slotFlags[sourceSlotIndex] !== 0;
      if (
        itemIndex === DENSE_INDEX_NONE
        || (!ignoreStock
          && this.state.slotCounts[sourceStorageIndex]!
            - this.state.slotReserved[sourceStorageIndex]! <= 0)
        || !this.edgeAcceptsItem(edgeIndex, itemIndex)
        || !this.canAdmitItem(edgeIndex, itemIndex)
        || !this.canReleaseAdmittedItem(edgeIndex, itemIndex)
      ) {
        continue;
      }

      if (this.layout.nodeWarehouseSinkFlags[targetNodeIndex] !== 0) {
        const warehouseSlotIndex = this.warehouseSlotIndexesByItemIndex[itemIndex]!;
        if (
          warehouseSlotIndex !== DENSE_INDEX_NONE
          && this.canTargetReceive(targetNodeIndex, warehouseSlotIndex, itemIndex)
        ) {
          return {
            sourceSlotIndex,
            targetSlotIndex: warehouseSlotIndex,
            itemIndex,
          };
        }
        continue;
      }

      const targetSlotIndex = this.selectTargetSlot(targetNodeIndex, itemIndex);
      if (targetSlotIndex !== DENSE_INDEX_NONE) {
        return { sourceSlotIndex, targetSlotIndex, itemIndex };
      }
    }
    return null;
  }

  private selectTargetSlot(targetNodeIndex: number, itemIndex: number): number {
    const start = this.layout.nodeSlotOffsets[targetNodeIndex]!;
    const end = this.layout.nodeSlotOffsets[targetNodeIndex + 1]!;
    let firstEmptySlotIndex = DENSE_INDEX_NONE;
    for (let offset = start; offset < end; offset += 1) {
      const slotIndex = this.layout.nodeSlotIndexes[offset]!;
      const storageIndex = this.layout.slotStorageIndexes[slotIndex]!;
      const currentItemIndex = this.state.slotItemIndexes[storageIndex]!;
      if (currentItemIndex === itemIndex) {
        return this.canTargetReceive(targetNodeIndex, slotIndex, itemIndex)
          ? slotIndex
          : DENSE_INDEX_NONE;
      }
      if (
        firstEmptySlotIndex === DENSE_INDEX_NONE
        && currentItemIndex === DENSE_INDEX_NONE
        && this.canTargetReceive(targetNodeIndex, slotIndex, itemIndex)
      ) {
        firstEmptySlotIndex = slotIndex;
      }
    }
    return firstEmptySlotIndex;
  }

  private selectVirtualRecipeOutputSlot(
    productSlotIndexes: Uint32Array,
    itemIndex: number,
    virtualItems: ReadonlyMap<number, number>,
    virtualCounts: ReadonlyMap<number, number>,
  ): number {
    let offset = 0;
    while (offset < productSlotIndexes.length) {
      const nodeIndex = this.layout.slotNodeIndexes[productSlotIndexes[offset]!]!;
      let existingSlotIndex = DENSE_INDEX_NONE;
      let firstEmptySlotIndex = DENSE_INDEX_NONE;
      while (
        offset < productSlotIndexes.length
        && this.layout.slotNodeIndexes[productSlotIndexes[offset]!] === nodeIndex
      ) {
        const slotIndex = productSlotIndexes[offset]!;
        const storageIndex = this.layout.slotStorageIndexes[slotIndex]!;
        const currentItemIndex = virtualItems.get(storageIndex)
          ?? this.state.slotItemIndexes[storageIndex]!;
        if (currentItemIndex === itemIndex) {
          existingSlotIndex = slotIndex;
        } else if (
          firstEmptySlotIndex === DENSE_INDEX_NONE
          && currentItemIndex === DENSE_INDEX_NONE
          && this.getVirtualRemainingCapacity(
            slotIndex,
            itemIndex,
            virtualItems,
            virtualCounts,
          ) > 0
        ) {
          firstEmptySlotIndex = slotIndex;
        }
        offset += 1;
      }
      if (existingSlotIndex !== DENSE_INDEX_NONE) {
        if (this.getVirtualRemainingCapacity(
          existingSlotIndex,
          itemIndex,
          virtualItems,
          virtualCounts,
        ) > 0) {
          return existingSlotIndex;
        }
        continue;
      }
      if (firstEmptySlotIndex !== DENSE_INDEX_NONE) {
        return firstEmptySlotIndex;
      }
    }
    return DENSE_INDEX_NONE;
  }

  private edgeAcceptsItem(edgeIndex: number, itemIndex: number): boolean {
    const excludeStart = this.layout.edgeExcludedItemOffsets[edgeIndex]!;
    const excludeEnd = this.layout.edgeExcludedItemOffsets[edgeIndex + 1]!;
    for (let offset = excludeStart; offset < excludeEnd; offset += 1) {
      if (this.layout.edgeExcludedItemIndexes[offset] === itemIndex) {
        return false;
      }
    }

    const kind = this.layout.edgeAcceptKinds[edgeIndex]!;
    const value = this.layout.edgeAcceptValues[edgeIndex]!;
    if (kind === 1) {
      return (this.layout.itemDomainFlags[itemIndex]! & value) !== 0;
    }
    return kind === 2 && value === itemIndex;
  }

  private canTargetReceive(
    _targetNodeIndex: number,
    targetSlotIndex: number,
    itemIndex: number,
  ): boolean {
    const targetStorageIndex = this.layout.slotStorageIndexes[targetSlotIndex]!;
    const lockItemIndex = this.layout.slotLockItemIndexes[targetSlotIndex]!;
    const currentItemIndex = this.state.slotItemIndexes[targetStorageIndex]!;
    if (
      (lockItemIndex !== DENSE_INDEX_NONE && lockItemIndex !== itemIndex)
      || (this.layout.slotDomainFlags[targetSlotIndex]!
        & this.layout.itemDomainFlags[itemIndex]!) === 0
      || (currentItemIndex !== DENSE_INDEX_NONE && currentItemIndex !== itemIndex)
      || this.getRemainingCapacity(targetSlotIndex) < 1
    ) {
      return false;
    }

    const componentIndex = this.layout.slotTransportComponentIndexes[targetSlotIndex]!;
    return componentIndex === DENSE_INDEX_NONE
      || this.state.componentItemIndexes[componentIndex] === DENSE_INDEX_NONE
      || this.state.componentItemIndexes[componentIndex] === itemIndex;
  }

  private getRemainingCapacity(slotIndex: number): number {
    const storageIndex = this.layout.slotStorageIndexes[slotIndex]!;
    const groupIndex = this.layout.slotCapacityGroupIndexes[storageIndex]!;
    if (groupIndex === DENSE_INDEX_NONE) {
      return Math.max(
        0,
        this.layout.slotCapacities[slotIndex]! - this.state.slotCounts[storageIndex]!,
      );
    }
    let occupied = 0;
    const start = this.layout.capacityGroupSlotOffsets[groupIndex]!;
    const end = this.layout.capacityGroupSlotOffsets[groupIndex + 1]!;
    for (let offset = start; offset < end; offset += 1) {
      occupied += this.state.slotCounts[this.layout.capacityGroupSlotIndexes[offset]!]!;
    }
    return Math.max(0, this.layout.capacityGroupLimits[groupIndex]! - occupied);
  }

  private getVirtualRemainingCapacity(
    slotIndex: number,
    itemIndex: number,
    virtualItems: ReadonlyMap<number, number>,
    virtualCounts: ReadonlyMap<number, number>,
  ): number {
    const storageIndex = this.layout.slotStorageIndexes[slotIndex]!;
    const currentItemIndex = virtualItems.get(storageIndex)
      ?? this.state.slotItemIndexes[storageIndex]!;
    if (
      (currentItemIndex !== DENSE_INDEX_NONE && currentItemIndex !== itemIndex)
      || (this.layout.slotLockItemIndexes[slotIndex] !== DENSE_INDEX_NONE
        && this.layout.slotLockItemIndexes[slotIndex] !== itemIndex)
      || (this.layout.slotDomainFlags[slotIndex]!
        & this.layout.itemDomainFlags[itemIndex]!) === 0
    ) {
      return 0;
    }
    const componentIndex = this.layout.slotTransportComponentIndexes[slotIndex]!;
    if (
      componentIndex !== DENSE_INDEX_NONE
      && this.state.componentItemIndexes[componentIndex] !== DENSE_INDEX_NONE
      && this.state.componentItemIndexes[componentIndex] !== itemIndex
    ) {
      return 0;
    }

    const groupIndex = this.layout.slotCapacityGroupIndexes[storageIndex]!;
    if (groupIndex === DENSE_INDEX_NONE) {
      return Math.max(
        0,
        this.layout.slotCapacities[slotIndex]!
          - this.readVirtualCount(storageIndex, virtualCounts),
      );
    }
    let occupied = 0;
    const start = this.layout.capacityGroupSlotOffsets[groupIndex]!;
    const end = this.layout.capacityGroupSlotOffsets[groupIndex + 1]!;
    for (let offset = start; offset < end; offset += 1) {
      occupied += this.readVirtualCount(
        this.layout.capacityGroupSlotIndexes[offset]!,
        virtualCounts,
      );
    }
    return Math.max(0, this.layout.capacityGroupLimits[groupIndex]! - occupied);
  }

  private readVirtualCount(
    storageIndex: number,
    virtualCounts: ReadonlyMap<number, number>,
  ): number {
    return virtualCounts.get(storageIndex) ?? this.state.slotCounts[storageIndex]!;
  }

  private recipeRuleMatches(rule: DenseRecipeItemRule, itemIndex: number): boolean {
    if (rule.kind === DENSE_RECIPE_ITEM_ANY) {
      return true;
    }
    if (rule.kind === DENSE_RECIPE_ITEM_DOMAIN) {
      return (this.layout.itemDomainFlags[itemIndex]! & rule.value) !== 0;
    }
    return rule.kind === DENSE_RECIPE_ITEM_EXACT && rule.value === itemIndex;
  }

  private getRunningProgram(channel: DenseRecipeChannelProgram): DenseRecipeProgram {
    const recipeIndex = this.channelRecipeIndexes[channel.index]!;
    const recipe = channel.candidates[recipeIndex];
    if (recipeIndex === DENSE_INDEX_NONE || recipe === undefined) {
      throw new Error(`Dense channel "${channel.channelId}" has invalid runtime recipe state.`);
    }
    return recipe;
  }

  private createChannelRecipeSnapshot(
    channel: DenseRecipeChannelProgram,
  ): RuntimeDeviceRecipeSnapshot | null {
    if (this.channelStates[channel.index] === CHANNEL_IDLE) {
      return null;
    }
    const recipe = this.getRunningProgram(channel);
    return {
      runId: `dense-recipe-run:${this.channelRunIds[channel.index]}`,
      recipeId: recipe.recipeId,
      recipeType: recipe.recipeType,
      progressTicks: this.channelProgressTicks[channel.index]!,
      durationTicks: recipe.durationTicks,
      state: this.channelStates[channel.index] === CHANNEL_RUNNING
        ? "running"
        : "waiting-output",
    };
  }

  private isRecipeAlreadyRunningOnSiblingChannel(
    channel: DenseRecipeChannelProgram,
    recipeId: string,
  ): boolean {
    const device = this.requireDevice(channel.deviceIndex);
    if (device.allowDuplicateRecipesAcrossChannels === true) {
      return false;
    }
    const start = this.recipePrograms.deviceChannelOffsets[channel.deviceIndex]!;
    const end = this.recipePrograms.deviceChannelOffsets[channel.deviceIndex + 1]!;
    for (let offset = start; offset < end; offset += 1) {
      const siblingIndex = this.recipePrograms.deviceChannelIndexes[offset]!;
      if (siblingIndex === channel.index || this.channelStates[siblingIndex] === CHANNEL_IDLE) {
        continue;
      }
      const sibling = this.recipePrograms.channels[siblingIndex]!;
      if (this.getRunningProgram(sibling).recipeId === recipeId) {
        return true;
      }
    }
    return false;
  }

  private isDeviceTransferPhase(deviceIndex: number): boolean {
    const period = this.deviceTransportPeriods[deviceIndex]!;
    return period === 0 || (this.currentTickNumber - 1) % period === 0;
  }

  private hasDevicePower(deviceIndex: number): boolean {
    const device = this.requireDevice(deviceIndex);
    return device.powerStatus !== "out-of-power-range"
      && !(
        this.powerMode === "real"
        && this.effectivePowerGeneration < this.effectiveTotalPowerDemand
        && device.requiresPower
      );
  }

  private canPatchSlotHoldItem(slotIndex: number, itemIndex: number): boolean {
    const lockItemIndex = this.layout.slotLockItemIndexes[slotIndex]!;
    return (lockItemIndex === DENSE_INDEX_NONE || lockItemIndex === itemIndex)
      && (this.layout.slotDomainFlags[slotIndex]!
        & this.layout.itemDomainFlags[itemIndex]!) !== 0;
  }

  private resolvePatchCapacity(slotIndex: number): number {
    const storageIndex = this.layout.slotStorageIndexes[slotIndex]!;
    const groupIndex = this.layout.slotCapacityGroupIndexes[storageIndex]!;
    if (groupIndex === DENSE_INDEX_NONE) {
      return this.layout.slotCapacities[slotIndex]!;
    }
    let occupiedByOtherSlots = 0;
    const start = this.layout.capacityGroupSlotOffsets[groupIndex]!;
    const end = this.layout.capacityGroupSlotOffsets[groupIndex + 1]!;
    for (let offset = start; offset < end; offset += 1) {
      const candidateStorageIndex = this.layout.capacityGroupSlotIndexes[offset]!;
      if (candidateStorageIndex !== storageIndex) {
        occupiedByOtherSlots += this.state.slotCounts[candidateStorageIndex]!;
      }
    }
    return Math.max(0, this.layout.capacityGroupLimits[groupIndex]! - occupiedByOtherSlots);
  }

  private cancelDeviceRecipes(deviceIndex: number): void {
    const start = this.recipePrograms.deviceChannelOffsets[deviceIndex]!;
    const end = this.recipePrograms.deviceChannelOffsets[deviceIndex + 1]!;
    for (let offset = start; offset < end; offset += 1) {
      const channelIndex = this.recipePrograms.deviceChannelIndexes[offset]!;
      const reservations = this.channelReservations[channelIndex] ?? [];
      for (const reservation of reservations) {
        if (!reservation.ignoreStock) {
          this.state.adjustReserved(reservation.slotIndex, -reservation.amount);
        }
      }
      this.channelRecipeIndexes[channelIndex] = DENSE_INDEX_NONE;
      this.channelProgressTicks[channelIndex] = 0;
      this.channelStates[channelIndex] = CHANNEL_IDLE;
      this.channelRunIds[channelIndex] = 0;
      this.channelReservations[channelIndex] = null;
      this.channelInputItems[channelIndex] = null;
    }
    this.state.dirtyDeviceIndexes.add(deviceIndex);
  }

  private normalizeMigratedSlotAliases(): void {
    for (let slotIndex = 0; slotIndex < this.layout.dictionary.slotIds.length; slotIndex += 1) {
      const storageIndex = this.layout.slotStorageIndexes[slotIndex]!;
      if (storageIndex === slotIndex) continue;
      const sourceCount = this.state.slotCounts[slotIndex]!;
      const sourceItemIndex = this.state.slotItemIndexes[slotIndex]!;
      if (sourceCount > 0 && sourceItemIndex !== DENSE_INDEX_NONE) {
        if (this.state.slotItemIndexes[storageIndex] === DENSE_INDEX_NONE) {
          this.state.slotItemIndexes[storageIndex] = sourceItemIndex;
        }
        this.state.slotCounts[storageIndex] = this.state.slotCounts[storageIndex]! + sourceCount;
      }
      this.state.slotItemIndexes[slotIndex] = DENSE_INDEX_NONE;
      this.state.slotCounts[slotIndex] = 0;
      this.state.slotReserved[slotIndex] = 0;
    }
  }

  private restoreMigratedRecipeChannels(
    previous: DenseSimulationKernel,
    preservedDeviceIds: ReadonlySet<string>,
  ): void {
    for (const channel of this.recipePrograms.channels) {
      const deviceId = this.layout.dictionary.deviceIds[channel.deviceIndex]!;
      if (!preservedDeviceIds.has(deviceId)) continue;
      const previousDeviceIndex = previous.lookup.deviceIndexById.get(deviceId);
      if (previousDeviceIndex === undefined) continue;
      const previousChannel = previous.findRecipeChannel(
        previousDeviceIndex,
        channel.channelId,
      );
      if (
        previousChannel === null
        || previous.channelStates[previousChannel.index] === CHANNEL_IDLE
      ) {
        continue;
      }

      const previousRecipe = previous.getRunningProgram(previousChannel);
      const recipeIndex = channel.candidates.findIndex((candidate) =>
        candidate.recipeId === previousRecipe.recipeId
        && candidate.recipeType === previousRecipe.recipeType
        && candidate.durationTicks === previousRecipe.durationTicks
      );
      if (recipeIndex < 0) continue;
      const reservations = this.mapMigratedReservations(
        previous,
        previous.channelReservations[previousChannel.index] ?? [],
      );
      const inputItems = this.mapMigratedInputItems(
        previous,
        previous.channelInputItems[previousChannel.index] ?? [],
      );
      if (reservations === null || inputItems === null) continue;

      const reservedByStorageIndex = new Map<number, number>();
      for (const reservation of reservations) {
        if (reservation.ignoreStock) continue;
        const storageIndex = this.layout.slotStorageIndexes[reservation.slotIndex]!;
        reservedByStorageIndex.set(
          storageIndex,
          (reservedByStorageIndex.get(storageIndex) ?? 0) + reservation.amount,
        );
      }
      if ([...reservedByStorageIndex].some(([storageIndex, amount]) =>
        this.state.slotReserved[storageIndex]! + amount
          > this.state.slotCounts[storageIndex]!
      )) {
        continue;
      }

      this.channelRecipeIndexes[channel.index] = recipeIndex;
      this.channelProgressTicks[channel.index] =
        previous.channelProgressTicks[previousChannel.index]!;
      this.channelStates[channel.index] = previous.channelStates[previousChannel.index]!;
      this.channelRunIds[channel.index] = previous.channelRunIds[previousChannel.index]!;
      this.channelReservations[channel.index] = reservations;
      this.channelInputItems[channel.index] = inputItems;
      for (const [storageIndex, amount] of reservedByStorageIndex) {
        this.state.slotReserved[storageIndex] =
          this.state.slotReserved[storageIndex]! + amount;
      }
    }
  }

  private findRecipeChannel(
    deviceIndex: number,
    channelId: string,
  ): DenseRecipeChannelProgram | null {
    const start = this.recipePrograms.deviceChannelOffsets[deviceIndex]!;
    const end = this.recipePrograms.deviceChannelOffsets[deviceIndex + 1]!;
    for (let offset = start; offset < end; offset += 1) {
      const channel = this.recipePrograms.channels[
        this.recipePrograms.deviceChannelIndexes[offset]!
      ];
      if (channel?.channelId === channelId) return channel;
    }
    return null;
  }

  private mapMigratedReservations(
    previous: DenseSimulationKernel,
    reservations: readonly DenseRecipeReservation[],
  ): readonly DenseRecipeReservation[] | null {
    const mapped: DenseRecipeReservation[] = [];
    for (const reservation of reservations) {
      const slotId = previous.layout.dictionary.slotIds[reservation.slotIndex];
      const slotIndex = slotId === undefined
        ? undefined
        : this.lookup.slotIndexById.get(slotId);
      const itemIndex = mapDenseItemIndex(
        previous.layout,
        this.lookup,
        reservation.itemIndex,
      );
      if (slotIndex === undefined || itemIndex === DENSE_INDEX_NONE) return null;
      mapped.push({
        slotIndex,
        itemIndex,
        amount: reservation.amount,
        ignoreStock: reservation.ignoreStock,
      });
    }
    return mapped;
  }

  private mapMigratedInputItems(
    previous: DenseSimulationKernel,
    inputItems: readonly DenseRecipeInputItem[],
  ): readonly DenseRecipeInputItem[] | null {
    const mapped: DenseRecipeInputItem[] = [];
    for (const item of inputItems) {
      const itemIndex = mapDenseItemIndex(previous.layout, this.lookup, item.itemIndex);
      if (itemIndex === DENSE_INDEX_NONE) return null;
      mapped.push({ itemIndex, amount: item.amount });
    }
    return mapped;
  }

  private restoreMigratedAdmissionCounters(
    previous: DenseSimulationKernel,
    preservedDeviceIds: ReadonlySet<string>,
  ): void {
    for (let index = 0; index < this.admission.portIds.length; index += 1) {
      const portId = this.admission.portIds[index]!;
      const port = this.topology.ports[portId];
      const previousPort = previous.topology.ports[portId];
      const previousIndex = previous.admission.portIndexesById.get(portId);
      if (
        port === undefined
        || previousPort === undefined
        || previousIndex === undefined
        || !preservedDeviceIds.has(port.deviceId)
        || port.admissionRule?.itemId !== previousPort.admissionRule?.itemId
      ) {
        continue;
      }
      this.admission.counts[index] = previous.admission.counts[previousIndex]!;
      this.admission.windowCounts[index] = previous.admission.windowCounts[previousIndex]!;
      this.admission.windowStartTicks[index] =
        previous.admission.windowStartTicks[previousIndex]!;
      this.admission.pastWindowCounts[index] = [
        ...(previous.admission.pastWindowCounts[previousIndex] ?? []),
      ];
      this.admission.moveTicks[index] = [
        ...(previous.admission.moveTicks[previousIndex] ?? []),
      ];
    }
  }

  private restoreMigratedRoutingCursors(
    previous: DenseSimulationKernel,
    preservedDeviceIds: ReadonlySet<string>,
  ): void {
    const previousIndexByKey = new Map(
      previous.layout.dictionary.routingCursorKeys.map((key, index) => [key, index]),
    );
    for (
      let index = 0;
      index < this.layout.dictionary.routingCursorKeys.length;
      index += 1
    ) {
      const key = this.layout.dictionary.routingCursorKeys[index]!;
      const nodeMarkerIndex = key.indexOf(":node:");
      const preservesDevice = nodeMarkerIndex > 0
        && preservedDeviceIds.has(key.slice(0, nodeMarkerIndex));
      const previousIndex = previousIndexByKey.get(key);
      if (!preservesDevice || previousIndex === undefined) continue;
      this.state.routingCursors[index] = previous.state.routingCursors[previousIndex]!;
    }
  }

  private resetConflictingMigratedTransportComponents(): void {
    for (
      let componentIndex = 0;
      componentIndex < this.layout.dictionary.componentIds.length;
      componentIndex += 1
    ) {
      const itemIndexes = new Set<number>();
      const slotStart = this.layout.componentSlotOffsets[componentIndex]!;
      const slotEnd = this.layout.componentSlotOffsets[componentIndex + 1]!;
      for (let offset = slotStart; offset < slotEnd; offset += 1) {
        const storageIndex = this.layout.componentSlotIndexes[offset]!;
        if (this.state.slotCounts[storageIndex]! > 0) {
          itemIndexes.add(this.state.slotItemIndexes[storageIndex]!);
        }
      }
      if (itemIndexes.size > 1) {
        const deviceStart = this.layout.componentDeviceOffsets[componentIndex]!;
        const deviceEnd = this.layout.componentDeviceOffsets[componentIndex + 1]!;
        for (let offset = deviceStart; offset < deviceEnd; offset += 1) {
          const deviceIndex = this.layout.componentDeviceIndexes[offset]!;
          this.cancelDeviceRecipes(deviceIndex);
          this.state.deviceFlags[deviceIndex] = 0;
        }
        for (let offset = slotStart; offset < slotEnd; offset += 1) {
          const storageIndex = this.layout.componentSlotIndexes[offset]!;
          this.state.slotItemIndexes[storageIndex] =
            this.layout.slotInitialItemIndexes[storageIndex]!;
          this.state.slotCounts[storageIndex] = this.layout.slotInitialCounts[storageIndex]!;
          this.state.slotReserved[storageIndex] = 0;
        }
      }
      this.refreshTransportComponent(componentIndex);
    }
  }

  private refreshPowerState(consumeBattery: boolean): void {
    let currentPowerGeneration = BASE_POWER_GENERATION_KW;
    for (const channel of this.recipePrograms.channels) {
      if (this.channelStates[channel.index] !== CHANNEL_RUNNING) {
        continue;
      }
      currentPowerGeneration += this.getRunningProgram(channel).powerOutput;
    }

    this.currentPowerGenerationValue = currentPowerGeneration;
    let effectiveGeneration = currentPowerGeneration;
    if (this.powerMode === "real") {
      const netPowerKilowatts = currentPowerGeneration - this.effectiveTotalPowerDemand;
      const netJoules = netPowerKilowatts * 1000 / this.topology.standardTickRate;
      if (consumeBattery && netJoules > 0) {
        this.baseBatteryJoulesValue = Math.min(
          BASE_BATTERY_CAPACITY_J,
          this.baseBatteryJoulesValue + netJoules,
        );
      } else if (netJoules < 0) {
        const deficit = -netJoules;
        if (this.baseBatteryJoulesValue >= deficit) {
          if (consumeBattery) {
            this.baseBatteryJoulesValue -= deficit;
          }
          effectiveGeneration = this.effectiveTotalPowerDemand;
        } else {
          if (consumeBattery) {
            this.baseBatteryJoulesValue = 0;
          }
        }
      }
    }
    this.effectivePowerGeneration = effectiveGeneration;
    this.powerOutage = this.powerMode === "real"
      && effectiveGeneration < this.effectiveTotalPowerDemand;
  }

  private canEdgeTransferAtCurrentPhase(edgeIndex: number): boolean {
    const sourceNodeIndex = this.layout.edgeSourceNodeIndexes[edgeIndex]!;
    const targetNodeIndex = this.layout.edgeTargetNodeIndexes[edgeIndex]!;
    return this.isDeviceTransferPhase(this.layout.nodeDeviceIndexes[sourceNodeIndex]!)
      && this.isDeviceTransferPhase(this.layout.nodeDeviceIndexes[targetNodeIndex]!);
  }

  private refreshTransportComponentForSlot(slotIndex: number): void {
    const componentIndex = this.layout.slotTransportComponentIndexes[slotIndex]!;
    if (componentIndex !== DENSE_INDEX_NONE) {
      this.refreshTransportComponent(componentIndex);
    }
  }

  private refreshTransportComponent(componentIndex: number): void {
    let itemIndex = DENSE_INDEX_NONE;
    const start = this.layout.componentSlotOffsets[componentIndex]!;
    const end = this.layout.componentSlotOffsets[componentIndex + 1]!;
    for (let offset = start; offset < end; offset += 1) {
      const storageIndex = this.layout.componentSlotIndexes[offset]!;
      if (this.state.slotCounts[storageIndex]! <= 0) {
        continue;
      }
      const candidate = this.state.slotItemIndexes[storageIndex]!;
      if (itemIndex !== DENSE_INDEX_NONE && itemIndex !== candidate) {
        throw new Error(`Dense transport component ${componentIndex} contains mixed items.`);
      }
      itemIndex = candidate;
    }
    if (this.state.componentItemIndexes[componentIndex] !== itemIndex) {
      this.state.componentItemIndexes[componentIndex] = itemIndex;
      this.state.dirtyComponentIndexes.add(componentIndex);
    }
  }

  private applyWaterPurifierManualOutput(): void {
    for (let deviceIndex = 0; deviceIndex < this.layout.dictionary.deviceIds.length; deviceIndex += 1) {
      const device = this.requireDevice(deviceIndex);
      const config = device.waterPurifierNode;
      if (
        config === undefined
        || config === null
        || config.outputMode !== "manual-rate"
        || config.manualOutputPerMinute <= 0
        || !this.hasDevicePower(deviceIndex)
      ) {
        continue;
      }
      const total = this.waterPurifierManualRemainders[deviceIndex]!
        + config.manualOutputPerMinute / (this.topology.standardTickRate * 60);
      const requestedAmount = Math.floor(total);
      this.waterPurifierManualRemainders[deviceIndex] = total - requestedAmount;
      if (requestedAmount <= 0) continue;
      const itemIndex = this.lookup.itemIndexById.get(config.outputItemId);
      if (itemIndex === undefined) continue;
      const slotIndex = this.findDeviceSourceSlotIndex(
        deviceIndex,
        config.outputStorageGroupId,
        config.outputSlotId,
      );
      if (slotIndex === DENSE_INDEX_NONE) continue;
      const acceptedAmount = Math.min(requestedAmount, this.getRemainingCapacity(slotIndex));
      if (acceptedAmount <= 0 || !this.canTargetReceive(
        this.layout.slotNodeIndexes[slotIndex]!,
        slotIndex,
        itemIndex,
      )) {
        continue;
      }
      this.state.produce(slotIndex, itemIndex, acceptedAmount);
      if (this.producerDeviceFlags[deviceIndex] !== 0) {
        this.recordWarehouseStat(this.currentTickProduced, itemIndex, acceptedAmount);
      }
      this.refreshTransportComponentForSlot(slotIndex);
    }
  }

  private applyBlockageAutoClearance(): void {
    for (let deviceIndex = 0; deviceIndex < this.layout.dictionary.deviceIds.length; deviceIndex += 1) {
      const device = this.requireDevice(deviceIndex);
      const clearance = device.blockageAutoClearance;
      if (clearance?.enabled !== true) continue;
      let blockedChannelCount = 0;
      const channelStart = this.recipePrograms.deviceChannelOffsets[deviceIndex]!;
      const channelEnd = this.recipePrograms.deviceChannelOffsets[deviceIndex + 1]!;
      for (let offset = channelStart; offset < channelEnd; offset += 1) {
        const channelIndex = this.recipePrograms.deviceChannelIndexes[offset]!;
        const channel = this.recipePrograms.channels[channelIndex]!;
        if (
          clearance.channelIds.includes(channel.channelId)
          && this.channelStates[channelIndex] === CHANNEL_WAITING_OUTPUT
        ) {
          blockedChannelCount += 1;
        }
      }
      if (blockedChannelCount < clearance.blockedChannelThreshold) continue;

      const clearedStorageIndexes = new Set<number>();
      for (const slotRef of clearance.slotRefs) {
        const slotIndexes = this.findDeviceSourceSlotIndexes(
          deviceIndex,
          slotRef.storageSlotGroupId,
          slotRef.slotId,
        );
        for (const slotIndex of slotIndexes) {
          if (this.state.slotFlags[slotIndex] !== 0) continue;
          const storageIndex = this.layout.slotStorageIndexes[slotIndex]!;
          if (clearedStorageIndexes.has(storageIndex)) continue;
          clearedStorageIndexes.add(storageIndex);
          this.state.writeSlot(slotIndex, {
            itemIndex: DENSE_INDEX_NONE,
            count: 0,
            reserved: 0,
            ignoreStock: false,
          });
          this.refreshTransportComponentForSlot(slotIndex);
        }
      }
    }
  }

  private findDeviceSourceSlotIndex(
    deviceIndex: number,
    storageGroupId: string,
    sourceSlotId: string | null,
  ): number {
    return this.findDeviceSourceSlotIndexes(deviceIndex, storageGroupId, sourceSlotId)[0]
      ?? DENSE_INDEX_NONE;
  }

  private findDeviceSourceSlotIndexes(
    deviceIndex: number,
    storageGroupId: string,
    sourceSlotId: string | null,
  ): number[] {
    const result: number[] = [];
    const nodeStart = this.layout.deviceNodeOffsets[deviceIndex]!;
    const nodeEnd = this.layout.deviceNodeOffsets[deviceIndex + 1]!;
    for (let nodeOffset = nodeStart; nodeOffset < nodeEnd; nodeOffset += 1) {
      const nodeIndex = this.layout.deviceNodeIndexes[nodeOffset]!;
      const nodeId = this.layout.dictionary.nodeIds[nodeIndex]!;
      const node = this.topology.nodes[nodeId];
      if (node?.sourceStorageSlotGroupId !== storageGroupId) continue;
      const slotStart = this.layout.nodeSlotOffsets[nodeIndex]!;
      const slotEnd = this.layout.nodeSlotOffsets[nodeIndex + 1]!;
      for (let slotOffset = slotStart; slotOffset < slotEnd; slotOffset += 1) {
        const slotIndex = this.layout.nodeSlotIndexes[slotOffset]!;
        const slot = this.topology.slots[this.layout.dictionary.slotIds[slotIndex]!];
        if (sourceSlotId === null || slot?.sourceSlotId === sourceSlotId) {
          result.push(slotIndex);
        }
      }
    }
    return result;
  }

  private compileAdmissionRuntime(): DenseAdmissionRuntime {
    const portIds = this.topology.ordering.portOrder.filter((portId) =>
      this.topology.ports[portId]?.admissionRule !== null
      && this.topology.ports[portId]?.admissionRule !== undefined
    );
    const portIndexesById = new Map(portIds.map((portId, index) => [portId, index]));
    const deviceIndexes = new Uint32Array(portIds.length);
    const itemIndexes = new Int32Array(portIds.length);
    const limits = new Float64Array(portIds.length);
    const perWindowLimits = new Float64Array(portIds.length);
    const windowStartTicks = new Float64Array(portIds.length);
    windowStartTicks.fill(1);
    for (let index = 0; index < portIds.length; index += 1) {
      const port = this.topology.ports[portIds[index]!]!;
      const rule = port.admissionRule!;
      const deviceIndex = this.lookup.deviceIndexById.get(port.deviceId);
      if (deviceIndex === undefined) {
        throw new Error(`Dense admission port "${port.id}" references an unknown device.`);
      }
      deviceIndexes[index] = deviceIndex;
      itemIndexes[index] = rule.itemId === null
        ? DENSE_INDEX_NONE
        : (this.lookup.itemIndexById.get(rule.itemId) ?? DENSE_INDEX_NONE);
      limits[index] = rule.limit ?? -1;
      perWindowLimits[index] = rule.perMinuteLimit === null
        ? -1
        : Math.floor(rule.perMinuteLimit / ADMISSION_RATE_WINDOWS_PER_MINUTE);
    }

    const admissionIndexByDeviceId = new Map<string, number>();
    for (let index = 0; index < portIds.length; index += 1) {
      const port = this.topology.ports[portIds[index]!]!;
      admissionIndexByDeviceId.set(port.deviceId, index);
    }
    const edgeTargetIndexes = new Int32Array(this.layout.dictionary.edgeIds.length);
    const edgeSourceIndexes = new Int32Array(this.layout.dictionary.edgeIds.length);
    edgeTargetIndexes.fill(DENSE_INDEX_NONE);
    edgeSourceIndexes.fill(DENSE_INDEX_NONE);
    for (let edgeIndex = 0; edgeIndex < this.layout.dictionary.edgeIds.length; edgeIndex += 1) {
      const edge = this.topology.transferEdges[this.layout.dictionary.edgeIds[edgeIndex]!];
      if (edge === undefined) continue;
      edgeTargetIndexes[edgeIndex] = portIndexesById.get(edge.targetPortId)
        ?? DENSE_INDEX_NONE;
      const sourceDeviceId = this.topology.ports[edge.sourcePortId]?.deviceId;
      edgeSourceIndexes[edgeIndex] = sourceDeviceId === undefined
        ? DENSE_INDEX_NONE
        : (admissionIndexByDeviceId.get(sourceDeviceId) ?? DENSE_INDEX_NONE);
    }
    return {
      portIds,
      portIndexesById,
      deviceIndexes,
      itemIndexes,
      limits,
      perWindowLimits,
      counts: new Float64Array(portIds.length),
      windowCounts: new Float64Array(portIds.length),
      windowStartTicks,
      pastWindowCounts: Array.from({ length: portIds.length }, () => []),
      moveTicks: Array.from({ length: portIds.length }, () => []),
      edgeTargetIndexes,
      edgeSourceIndexes,
    };
  }

  private normalizeAdmissionWindows(): void {
    const windowStartTick = this.resolveAdmissionWindowStartTick();
    const cutoff = this.currentTickNumber - this.topology.standardTickRate * 60;
    for (let index = 0; index < this.admission.portIds.length; index += 1) {
      if (this.admission.windowStartTicks[index] === windowStartTick) continue;
      const past = this.admission.pastWindowCounts[index]!;
      past.push(this.admission.windowCounts[index]!);
      if (past.length > ADMISSION_RATE_WINDOWS_PER_MINUTE) past.shift();
      this.admission.windowCounts[index] = 0;
      this.admission.windowStartTicks[index] = windowStartTick;
      this.admission.moveTicks[index] = this.admission.moveTicks[index]!
        .filter((tickNumber) => tickNumber > cutoff);
      this.state.dirtyDeviceIndexes.add(this.admission.deviceIndexes[index]!);
    }
  }

  private resolveAdmissionWindowStartTick(): number {
    const windowTicks = Math.max(1, this.topology.standardTickRate * 10);
    return 1 + Math.floor(Math.max(0, this.currentTickNumber - 1) / windowTicks) * windowTicks;
  }

  private canAdmitItem(edgeIndex: number, itemIndex: number): boolean {
    const admissionIndex = this.admission.edgeTargetIndexes[edgeIndex]!;
    if (admissionIndex === DENSE_INDEX_NONE) return true;
    const ruleItemIndex = this.admission.itemIndexes[admissionIndex]!;
    if (ruleItemIndex === DENSE_INDEX_NONE) return true;
    if (ruleItemIndex !== itemIndex) return false;
    const bufferedCount = this.countBufferedAdmissionItems(admissionIndex, itemIndex);
    const limit = this.admission.limits[admissionIndex]!;
    if (
      limit >= 0
      && this.admission.counts[admissionIndex]! + bufferedCount >= limit
    ) {
      return false;
    }
    const perWindowLimit = this.admission.perWindowLimits[admissionIndex]!;
    return perWindowLimit < 0
      || bufferedCount < Math.max(
        0,
        perWindowLimit - this.admission.windowCounts[admissionIndex]!,
      );
  }

  private canReleaseAdmittedItem(edgeIndex: number, itemIndex: number): boolean {
    const admissionIndex = this.admission.edgeSourceIndexes[edgeIndex]!;
    if (admissionIndex === DENSE_INDEX_NONE) return true;
    const ruleItemIndex = this.admission.itemIndexes[admissionIndex]!;
    if (ruleItemIndex === DENSE_INDEX_NONE) return true;
    if (ruleItemIndex !== itemIndex) return false;
    const limit = this.admission.limits[admissionIndex]!;
    const perWindowLimit = this.admission.perWindowLimits[admissionIndex]!;
    return (limit < 0 || this.admission.counts[admissionIndex]! < limit)
      && (perWindowLimit < 0
        || this.admission.windowCounts[admissionIndex]! < perWindowLimit);
  }

  private countBufferedAdmissionItems(admissionIndex: number, itemIndex: number): number {
    const deviceIndex = this.admission.deviceIndexes[admissionIndex]!;
    const visitedStorageIndexes = new Set<number>();
    let count = 0;
    const nodeStart = this.layout.deviceNodeOffsets[deviceIndex]!;
    const nodeEnd = this.layout.deviceNodeOffsets[deviceIndex + 1]!;
    for (let nodeOffset = nodeStart; nodeOffset < nodeEnd; nodeOffset += 1) {
      const nodeIndex = this.layout.deviceNodeIndexes[nodeOffset]!;
      const slotStart = this.layout.nodeSlotOffsets[nodeIndex]!;
      const slotEnd = this.layout.nodeSlotOffsets[nodeIndex + 1]!;
      for (let slotOffset = slotStart; slotOffset < slotEnd; slotOffset += 1) {
        const storageIndex = this.layout.slotStorageIndexes[
          this.layout.nodeSlotIndexes[slotOffset]!
        ]!;
        if (visitedStorageIndexes.has(storageIndex)) continue;
        visitedStorageIndexes.add(storageIndex);
        if (this.state.slotItemIndexes[storageIndex] === itemIndex) {
          count += Math.max(0, this.state.slotCounts[storageIndex]!);
        }
      }
    }
    return count;
  }

  private recordAdmissionMove(edgeIndex: number): void {
    const admissionIndex = this.admission.edgeSourceIndexes[edgeIndex]!;
    if (admissionIndex === DENSE_INDEX_NONE) return;
    this.admission.counts[admissionIndex] = this.admission.counts[admissionIndex]! + 1;
    this.admission.windowCounts[admissionIndex] =
      this.admission.windowCounts[admissionIndex]! + 1;
    this.admission.moveTicks[admissionIndex]!.push(this.currentTickNumber);
    this.state.dirtyDeviceIndexes.add(this.admission.deviceIndexes[admissionIndex]!);
  }

  private createAdmissionCounterSnapshots(
    deviceIndex: number,
  ): RuntimeDeviceSnapshot["admissionCounters"] {
    const result: RuntimeDeviceSnapshot["admissionCounters"] = {};
    for (let index = 0; index < this.admission.portIds.length; index += 1) {
      if (this.admission.deviceIndexes[index] !== deviceIndex) continue;
      const port = this.topology.ports[this.admission.portIds[index]!];
      const rule = port?.admissionRule;
      if (port === undefined || rule === null || rule === undefined) continue;
      result[`${port.portGroupId}:${port.portDefinitionId}`] = {
        portId: port.id,
        portGroupId: port.portGroupId,
        portDefinitionId: port.portDefinitionId,
        itemId: rule.itemId,
        limit: rule.limit,
        count: this.admission.counts[index]!,
        perMinuteLimit: rule.perMinuteLimit,
        rateWindowCount: this.admission.windowCounts[index]!,
        pastWindowCounts: [...this.admission.pastWindowCounts[index]!],
        moveTicks: [...this.admission.moveTicks[index]!],
      };
    }
    return result;
  }

  private assertCheckpointShape(checkpoint: DenseKernelCheckpoint): void {
    if (!Number.isSafeInteger(checkpoint.tickNumber) || checkpoint.tickNumber < 0) {
      throw new Error(`Dense checkpoint tick is invalid: ${checkpoint.tickNumber}.`);
    }
    const expectedLengths: ReadonlyArray<readonly [number, number, string]> = [
      [checkpoint.slotItemIndexes.length, this.state.slotItemIndexes.length, "slot items"],
      [checkpoint.slotCounts.length, this.state.slotCounts.length, "slot counts"],
      [checkpoint.slotReserved.length, this.state.slotReserved.length, "slot reservations"],
      [checkpoint.slotFlags.length, this.state.slotFlags.length, "slot flags"],
      [
        checkpoint.componentItemIndexes.length,
        this.state.componentItemIndexes.length,
        "component items",
      ],
      [checkpoint.deviceFlags.length, this.state.deviceFlags.length, "device flags"],
      [checkpoint.routingCursors.length, this.state.routingCursors.length, "routing cursors"],
      [checkpoint.channelStates.length, this.channelStates.length, "channel states"],
      [checkpoint.admissionCounts.length, this.admission.counts.length, "admission counts"],
      [
        checkpoint.waterPurifierManualRemainders.length,
        this.waterPurifierManualRemainders.length,
        "water purifier remainders",
      ],
      [
        checkpoint.warehouseProducedTotals.length,
        this.warehouseProducedTotals.length,
        "warehouse produced totals",
      ],
      [
        checkpoint.warehouseConsumedTotals.length,
        this.warehouseConsumedTotals.length,
        "warehouse consumed totals",
      ],
      [
        checkpoint.warehouseLastChangedTicks.length,
        this.warehouseLastChangedTicks.length,
        "warehouse last changed ticks",
      ],
    ];
    for (const [actual, expected, label] of expectedLengths) {
      if (actual !== expected) {
        throw new Error(
          `Dense checkpoint ${label} length mismatch: expected ${expected}, received ${actual}.`,
        );
      }
    }
  }

  private compileWarehouseSlotIndexes(): Int32Array {
    const indexes = new Int32Array(this.layout.dictionary.itemIds.length);
    indexes.fill(DENSE_INDEX_NONE);
    for (let slotIndex = 0; slotIndex < this.layout.dictionary.slotIds.length; slotIndex += 1) {
      const nodeIndex = this.layout.slotNodeIndexes[slotIndex]!;
      const device = this.requireDevice(this.layout.nodeDeviceIndexes[nodeIndex]!);
      const itemIndex = this.layout.slotLockItemIndexes[slotIndex]!;
      if (device.definitionId === "warehouse" && itemIndex !== DENSE_INDEX_NONE) {
        indexes[itemIndex] = slotIndex;
      }
    }
    return indexes;
  }

  private compileWarehouseItemIndexesByStorage(): Int32Array {
    const indexes = new Int32Array(this.layout.storageSlotViewOffsets.length - 1);
    indexes.fill(DENSE_INDEX_NONE);
    for (let itemIndex = 0; itemIndex < this.warehouseSlotIndexesByItemIndex.length; itemIndex += 1) {
      const slotIndex = this.warehouseSlotIndexesByItemIndex[itemIndex]!;
      if (slotIndex !== DENSE_INDEX_NONE) {
        indexes[this.layout.slotStorageIndexes[slotIndex]!] = itemIndex;
      }
    }
    return indexes;
  }

  private compileRegionalOutletIdsByEdgeIndex(): readonly (string | null)[] {
    const result = Array<string | null>(this.layout.dictionary.edgeIds.length).fill(null);
    const regional = this.regionalOptions;
    if (regional === null) return result;
    for (const outletId of regional.table.outletsByBaseId[regional.baseId] ?? []) {
      const outlet = regional.table.outletById[outletId];
      const edgeIndex = outlet === undefined
        ? undefined
        : this.lookup.edgeIndexById.get(outlet.transferEdgeId);
      if (edgeIndex === undefined) {
        throw new Error(`Dense regional outlet "${outletId}" has no compiled edge.`);
      }
      result[edgeIndex] = outletId;
    }
    return result;
  }

  private canApplyRegionalOutlet(edgeIndex: number, itemIndex: number): boolean {
    if (
      !this.canEdgeTransferAtCurrentPhase(edgeIndex)
      || !this.edgeAcceptsItem(edgeIndex, itemIndex)
      || !this.canAdmitItem(edgeIndex, itemIndex)
      || !this.canReleaseAdmittedItem(edgeIndex, itemIndex)
    ) {
      return false;
    }
    const targetNodeIndex = this.layout.edgeTargetNodeIndexes[edgeIndex]!;
    return this.selectTargetSlot(targetNodeIndex, itemIndex) !== DENSE_INDEX_NONE;
  }

  private isRegionalWarehouseSlot(slotIndex: number): boolean {
    return this.regionalOptions !== null
      && this.warehouseItemIndexesByStorageIndex[
        this.layout.slotStorageIndexes[slotIndex]!
      ] !== DENSE_INDEX_NONE;
  }

  private recordRegionalDeposit(itemIndex: number, amount: number): void {
    this.regionalDeposits.set(
      itemIndex,
      (this.regionalDeposits.get(itemIndex) ?? 0) + amount,
    );
  }

  private setRegionalWarehouseCounts(counts: Readonly<Record<string, number>>): void {
    for (let itemIndex = 0; itemIndex < this.warehouseSlotIndexesByItemIndex.length; itemIndex += 1) {
      const slotIndex = this.warehouseSlotIndexesByItemIndex[itemIndex]!;
      if (slotIndex === DENSE_INDEX_NONE) continue;
      const itemId = this.layout.dictionary.itemIds[itemIndex]!;
      this.state.writeSlot(slotIndex, {
        itemIndex,
        count: Math.max(0, counts[itemId] ?? 0),
        reserved: 0,
        ignoreStock: this.state.slotFlags[slotIndex] !== 0,
      });
    }
  }

  private requireRegionalOptions(): DenseRegionalKernelOptions {
    if (this.regionalOptions === null) {
      throw new Error("Dense regional runtime is not initialized.");
    }
    return this.regionalOptions;
  }

  private recordWarehouseConsumption(items: readonly DenseRecipeInputItem[]): void {
    for (const item of items) {
      this.recordWarehouseStat(this.currentTickConsumed, item.itemIndex, item.amount);
    }
  }

  private recordWarehouseStat(
    target: Map<number, number>,
    itemIndex: number,
    amount: number,
  ): void {
    if (amount <= 0) return;
    target.set(itemIndex, (target.get(itemIndex) ?? 0) + amount);
  }

  private commitWarehouseStatsTick(): void {
    if (this.currentTickProduced.size > 0 || this.currentTickConsumed.size > 0) {
      const produced = [...this.currentTickProduced.entries()].sort(compareNumberEntries);
      const consumed = [...this.currentTickConsumed.entries()].sort(compareNumberEntries);
      this.warehouseStatsBuckets.push({
        tickNumber: this.currentTickNumber,
        produced,
        consumed,
      });
      for (const [itemIndex, amount] of produced) {
        this.warehouseProducedTotals[itemIndex] =
          this.warehouseProducedTotals[itemIndex]! + amount;
        this.warehouseLastChangedTicks[itemIndex] = this.currentTickNumber;
        this.warehouseStatsDirtyItemIndexes.add(itemIndex);
      }
      for (const [itemIndex, amount] of consumed) {
        this.warehouseConsumedTotals[itemIndex] =
          this.warehouseConsumedTotals[itemIndex]! + amount;
        this.warehouseLastChangedTicks[itemIndex] = this.currentTickNumber;
        this.warehouseStatsDirtyItemIndexes.add(itemIndex);
      }
    }

    const cutoffTick = this.currentTickNumber - this.warehouseStatsWindowCapacity;
    while (
      this.warehouseStatsBuckets.length > 0
      && this.warehouseStatsBuckets[0]!.tickNumber <= cutoffTick
    ) {
      const removed = this.warehouseStatsBuckets.shift()!;
      for (const [itemIndex, amount] of removed.produced) {
        this.warehouseProducedTotals[itemIndex] = Math.max(
          0,
          this.warehouseProducedTotals[itemIndex]! - amount,
        );
        this.warehouseStatsDirtyItemIndexes.add(itemIndex);
      }
      for (const [itemIndex, amount] of removed.consumed) {
        this.warehouseConsumedTotals[itemIndex] = Math.max(
          0,
          this.warehouseConsumedTotals[itemIndex]! - amount,
        );
        this.warehouseStatsDirtyItemIndexes.add(itemIndex);
      }
    }
  }

  private shouldPresentWarehouseItem(itemIndex: number): boolean {
    const warehouse = this.readWarehouseItem(itemIndex);
    return warehouse.count > 0
      || warehouse.infinite
      || this.warehouseLastChangedTicks[itemIndex]! > 0;
  }

  private readWarehouseItem(
    itemIndex: number,
  ): { readonly count: number; readonly infinite: boolean } {
    const slotIndex = this.warehouseSlotIndexesByItemIndex[itemIndex]!;
    if (slotIndex === DENSE_INDEX_NONE) return { count: 0, infinite: false };
    const storageIndex = this.layout.slotStorageIndexes[slotIndex]!;
    return {
      count: this.state.slotCounts[storageIndex]!,
      infinite: this.state.slotFlags[slotIndex] !== 0,
    };
  }

  private submitDeviceInventoryToWarehouse(deviceIndex: number): void {
    const visitedStorageIndexes = new Set<number>();
    const nodeStart = this.layout.deviceNodeOffsets[deviceIndex]!;
    const nodeEnd = this.layout.deviceNodeOffsets[deviceIndex + 1]!;
    for (let nodeOffset = nodeStart; nodeOffset < nodeEnd; nodeOffset += 1) {
      const nodeIndex = this.layout.deviceNodeIndexes[nodeOffset]!;
      const slotStart = this.layout.nodeSlotOffsets[nodeIndex]!;
      const slotEnd = this.layout.nodeSlotOffsets[nodeIndex + 1]!;
      for (let slotOffset = slotStart; slotOffset < slotEnd; slotOffset += 1) {
        const slotIndex = this.layout.nodeSlotIndexes[slotOffset]!;
        const storageIndex = this.layout.slotStorageIndexes[slotIndex]!;
        if (visitedStorageIndexes.has(storageIndex)) {
          continue;
        }
        visitedStorageIndexes.add(storageIndex);
        const itemIndex = this.state.slotItemIndexes[storageIndex]!;
        const count = this.state.slotCounts[storageIndex]!;
        const warehouseSlotIndex = itemIndex === DENSE_INDEX_NONE
          ? DENSE_INDEX_NONE
          : this.warehouseSlotIndexesByItemIndex[itemIndex]!;
        if (
          itemIndex === DENSE_INDEX_NONE
          || count <= 0
          || warehouseSlotIndex === DENSE_INDEX_NONE
          || this.layout.slotStorageIndexes[warehouseSlotIndex] === storageIndex
          || this.state.slotFlags[slotIndex] !== 0
        ) {
          continue;
        }
        this.state.consume(slotIndex, itemIndex, count, false);
        if (this.regionalOptions === null) {
          this.state.produce(warehouseSlotIndex, itemIndex, count);
        } else {
          this.recordRegionalDeposit(itemIndex, count);
        }
        this.refreshTransportComponentForSlot(slotIndex);
      }
    }
  }

  private collectActiveGasDiffusions(): readonly RuntimeGasDiffusionSnapshot[] {
    const result: RuntimeGasDiffusionSnapshot[] = [];
    const seen = new Set<string>();
    for (const channel of this.recipePrograms.channels) {
      if (this.channelStates[channel.index] !== CHANNEL_RUNNING) {
        continue;
      }
      const output = this.getRunningProgram(channel).gasDiffusionOutput;
      if (output === null) {
        continue;
      }
      const device = this.requireDevice(channel.deviceIndex);
      const gridRect = resolveDeviceCenteredRangeRect(device, output.range);
      if (gridRect === null) {
        continue;
      }
      const key = `${channel.deviceIndex}:${output.itemIndex}:${output.range}`;
      if (seen.has(key)) {
        continue;
      }
      seen.add(key);
      result.push({
        sourceDeviceId: device.id,
        gasItemId: this.layout.dictionary.itemIds[output.itemIndex]!,
        gridRect,
      });
    }
    return result;
  }

  private isDeviceCoveredByGas(deviceIndex: number, gasItemIndex: number): boolean {
    const deviceRect = resolveDeviceGridRect(this.requireDevice(deviceIndex));
    if (deviceRect === null) {
      return false;
    }
    const gasItemId = this.layout.dictionary.itemIds[gasItemIndex]!;
    return this.activeGasDiffusions.some((diffusion) =>
      diffusion.gasItemId === gasItemId
      && areGridRectsContaining(diffusion.gridRect, deviceRect)
    );
  }

  private updateDeviceBlockStates(): void {
    for (let deviceIndex = 0; deviceIndex < this.layout.dictionary.deviceIds.length; deviceIndex += 1) {
      const start = this.recipePrograms.deviceChannelOffsets[deviceIndex]!;
      const end = this.recipePrograms.deviceChannelOffsets[deviceIndex + 1]!;
      if (start === end) {
        continue;
      }
      let hasRunning = false;
      let hasWaiting = false;
      for (let offset = start; offset < end; offset += 1) {
        const channelIndex = this.recipePrograms.deviceChannelIndexes[offset]!;
        hasRunning ||= this.channelStates[channelIndex] === CHANNEL_RUNNING;
        hasWaiting ||= this.channelStates[channelIndex] === CHANNEL_WAITING_OUTPUT;
      }
      this.state.setDeviceBlocked(deviceIndex, hasWaiting || !hasRunning);
    }
  }

  private requireDevice(deviceIndex: number): CompiledSimulationDevice {
    const deviceId = this.layout.dictionary.deviceIds[deviceIndex];
    const device = deviceId === undefined ? undefined : this.topology.devices[deviceId];
    if (device === undefined) {
      throw new Error(`Dense kernel cannot resolve device index ${deviceIndex}.`);
    }
    return device;
  }
}

function aggregateInputItems(
  reservations: readonly DenseRecipeReservation[],
): readonly DenseRecipeInputItem[] {
  const amountByItemIndex = new Map<number, number>();
  for (const reservation of reservations) {
    amountByItemIndex.set(
      reservation.itemIndex,
      (amountByItemIndex.get(reservation.itemIndex) ?? 0) + reservation.amount,
    );
  }
  return [...amountByItemIndex].map(([itemIndex, amount]) => ({ itemIndex, amount }));
}

function cloneWarehouseStatsBucket(
  bucket: DenseWarehouseStatsBucket,
): DenseWarehouseStatsBucket {
  return {
    tickNumber: bucket.tickNumber,
    produced: bucket.produced.map(([itemIndex, amount]) => [itemIndex, amount]),
    consumed: bucket.consumed.map(([itemIndex, amount]) => [itemIndex, amount]),
  };
}

function compareNumberEntries(
  left: readonly [number, number],
  right: readonly [number, number],
): number {
  return left[0] - right[0];
}

function compareNumbers(left: number, right: number): number {
  return left - right;
}

function createTransferAccumulator(): DenseTransferAccumulator {
  return {
    edgeIndexes: [],
    sourceSlotIndexes: [],
    targetSlotIndexes: [],
    itemIndexes: [],
    amounts: [],
  };
}

function createKernelTickResult(
  tickNumber: number,
  transfers: DenseTransferAccumulator,
): DenseKernelTickResult {
  return {
    tickNumber,
    transfers: {
      edgeIndexes: Uint32Array.from(transfers.edgeIndexes),
      sourceSlotIndexes: Uint32Array.from(transfers.sourceSlotIndexes),
      targetSlotIndexes: Uint32Array.from(transfers.targetSlotIndexes),
      itemIndexes: Uint32Array.from(transfers.itemIndexes),
      amounts: Float64Array.from(transfers.amounts),
    },
  };
}

function resolveRegionalGateTick(epochNumber: number): number {
  if (!Number.isSafeInteger(epochNumber) || epochNumber < 0) {
    throw new Error(`Dense regional epoch must be a non-negative safe integer: ${epochNumber}.`);
  }
  return 1 + epochNumber * 10;
}

function resolveDeviceGridRect(
  device: CompiledSimulationDevice,
): RuntimeGasDiffusionSnapshot["gridRect"] | null {
  if (device.position === null || device.rotation === null || device.footprint === null) {
    return null;
  }
  const footprint = getRotatedGridFootprint(device.footprint, device.rotation);
  return {
    x: device.position.x,
    y: device.position.y,
    width: footprint.width,
    height: footprint.height,
  };
}

function resolveDeviceCenteredRangeRect(
  device: CompiledSimulationDevice,
  range: number,
): RuntimeGasDiffusionSnapshot["gridRect"] | null {
  if (device.position === null || device.rotation === null || device.footprint === null) {
    return null;
  }
  const footprint = getRotatedGridFootprint(device.footprint, device.rotation);
  const center = getGridFootprintCenterCells(device.position, footprint);
  const halfRange = range / 2;
  return {
    x: center.x - halfRange,
    y: center.y - halfRange,
    width: range,
    height: range,
  };
}

function mapDenseItemIndex(
  previousLayout: DenseTopologyLayout,
  nextLookup: DenseTopologyLookup,
  previousItemIndex: number,
): number {
  if (previousItemIndex === DENSE_INDEX_NONE) return DENSE_INDEX_NONE;
  const itemId = previousLayout.dictionary.itemIds[previousItemIndex];
  if (itemId === undefined) return DENSE_INDEX_NONE;
  return nextLookup.itemIndexById.get(itemId) ?? DENSE_INDEX_NONE;
}

function assertDenseKernelTopologySupported(
  topology: CompiledSimulationTopology,
  regionalOptions: DenseRegionalKernelOptions | undefined,
): void {
  if (topology.simulationMode === "regional-multi-base" && regionalOptions === undefined) {
    throw new Error("Dense regional topology requires an explicit regional runtime configuration.");
  }
  if (topology.simulationMode === "single-base" && regionalOptions !== undefined) {
    throw new Error("Dense single-base topology cannot use a regional runtime configuration.");
  }

  const connectedDeviceIds = new Set<string>();
  for (const edgeId of topology.ordering.edgeOrder) {
    const edge = topology.transferEdges[edgeId];
    if (edge === undefined) {
      continue;
    }
    const sourceDeviceId = topology.nodes[edge.sourceNodeId]?.deviceId;
    const targetDeviceId = topology.nodes[edge.targetNodeId]?.deviceId;
    if (sourceDeviceId !== undefined) connectedDeviceIds.add(sourceDeviceId);
    if (targetDeviceId !== undefined) connectedDeviceIds.add(targetDeviceId);

    // AI-REMOVED 2026-09-03:
    // Reason: Dense kernel 已维护准入口总量、十秒窗口、输入预取与输出提交计数。
    // Trigger: ST2-RQ-023 要求覆盖 runtime action 与 admission counter Contract。
    // Evidence: compileAdmissionRuntime/canAdmitItem/canReleaseAdmittedItem/recordAdmissionMove。
    // Replacement: DenseAdmissionRuntime。
    // Risk: Medium；由准入口差分测试继续验证窗口边界。
    // Human Review: Required
    //
    // Original code:
    // const targetPort = topology.ports[edge.targetPortId];
    // if (targetPort?.admissionRule !== null && targetPort?.admissionRule !== undefined) {
    //   throw new Error("Dense kernel milestone 1 does not support admission rules.");
    // }
  }

  for (const deviceId of connectedDeviceIds) {
    const device = topology.devices[deviceId];
    if (device === undefined) {
      continue;
    }
    // AI-REMOVED 2026-09-03:
    // Reason: dense-v2 已拥有独立的配方程序编译器与运行时状态机，不再需要拒绝配方设备。
    // Trigger: 新版求解器运行完整 Blueprint project 时，全部生产蓝图在启动阶段被旧能力门禁拒绝。
    // Evidence: RUN_DIR .temp/full-check/runs/20260903-114639-1052621 的 Blueprint 日志。
    // Replacement: compileDenseRecipePrograms + DenseSimulationKernel recipe lifecycle。
    // Risk: Medium；后续 Blueprint 差分继续验证配方选择、物流相位和阻塞语义。
    // Human Review: Required
    //
    // Original code:
    // const requiresRecipeRuntime = device.recipeChannels.some(
    //   (channel) => !channel.manualRecipeOnly || channel.defaultRecipeId !== null,
    // );
    // if (requiresRecipeRuntime) {
    //   throw new Error(
    //     `Dense kernel milestone 1 does not support recipe device "${device.definitionId}".`,
    //   );
    // }
    // AI-REMOVED 2026-09-03:
    // Reason: Dense kernel 已实现净水器手动产出余数与堵塞自动清理行为。
    // Trigger: ST2-RQ-023 要求在开放实验选项前覆盖现有设备行为。
    // Evidence: applyWaterPurifierManualOutput/applyBlockageAutoClearance。
    // Replacement: DenseSimulationKernel 对应方法。
    // Risk: Medium；由设备行为差分测试验证容量与停电边界。
    // Human Review: Required
    //
    // Original code:
    // if (device.blockageAutoClearance?.enabled === true || device.waterPurifierNode != null) {
    //   throw new Error(
    //     `Dense kernel milestone 1 does not support active device behavior on "${device.definitionId}".`,
    //   );
    // }
  }
}
