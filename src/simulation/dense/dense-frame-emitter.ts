import type {
  CompiledSimulationTopology,
  RuntimeDeviceSnapshot,
  RuntimeNodeSnapshot,
} from "../types";
// AI-REMOVED 2026-09-03:
// Reason: Dense 帧必须读取 dense kernel 自己的电力真相，不能引用 legacy Runtime 常量并伪造满电状态。
// Trigger: ST2-RQ-023 电力 Contract 差分接入。
// Evidence: DenseSimulationKernel 已维护发电量、停电状态与电池电量。
// Replacement: DenseSimulationKernel power getters。
// Risk: Low。
// Human Review: Required
//
// Original code:
// import { BASE_BATTERY_CAPACITY_J } from "../runtime";
import type {
  DenseKernelTickResult,
  DenseSimulationKernel,
} from "./dense-simulation-kernel";
import {
  FRAME_STATUS_INITIAL,
  FRAME_STATUS_RUNNING,
  WAREHOUSE_CLEARED,
  WAREHOUSE_PATCHED,
  WAREHOUSE_UNCHANGED,
  type DenseFrameDelta,
} from "./dense-frame-delta";
import type { DenseRuntimeState } from "./dense-runtime-state";
import {
  // AI-REMOVED 2026-09-03:
  // Reason: Frame emitter 直接复制 runtime 中已编码的 item index，不需要空索引常量。
  // Trigger: TypeScript/ESLint 实现审计发现该导入无消费点。
  // Evidence: createFrame 只读取 componentItemIndexes 与 slotItemIndexes。
  // Replacement: None
  // Risk: Low
  // Human Review: Required
  //
  // Original code:
  // DENSE_INDEX_NONE,
  DENSE_SIMULATION_PROTOCOL_VERSION,
  createDenseTopologyLookup,
  type DenseTopologyLayout,
  type DenseTopologyLookup,
} from "./dense-topology";

export class DenseFrameEmitter {
  private nextFrameSequence = 1;
  private readonly lookup: DenseTopologyLookup;

  public constructor(
    private readonly topology: CompiledSimulationTopology,
    private readonly layout: DenseTopologyLayout,
    private readonly session: {
      readonly sessionId: string;
      readonly topologyVersion: number;
    },
  ) {
    if (
      topology.topologyId !== layout.dictionary.topologyId
      || topology.documentHash !== layout.dictionary.documentHash
    ) {
      throw new Error("Dense frame emitter topology identity mismatch.");
    }
    this.lookup = createDenseTopologyLookup(layout.dictionary);
  }

  public emitInitial(kernel: DenseSimulationKernel): DenseFrameDelta {
    const state = kernel.state;
    const slotIndexes = Uint32Array.from(
      { length: this.layout.dictionary.slotIds.length },
      (_, index) => index,
    );
    const componentIndexes = Uint32Array.from(
      { length: this.layout.dictionary.componentIds.length },
      (_, index) => index,
    );
    const delta = this.createFrame({
      state,
      tickNumber: 0,
      status: FRAME_STATUS_INITIAL,
      kernel,
      slotIndexes,
      componentIndexes,
      routingCursorIndexes: Uint32Array.from(
        { length: this.layout.dictionary.routingCursorKeys.length },
        (_, index) => index,
      ),
      deviceIndexes: Uint32Array.from(
        { length: this.layout.dictionary.deviceIds.length },
        (_, index) => index,
      ),
      transfers: createEmptyTransfers(),
      includeStaticPresentation: true,
      warehouseMode: WAREHOUSE_PATCHED,
      changedStorageIndexes: [],
    });
    state.clearDirtyState();
    return delta;
  }

  public emitTick(kernel: DenseSimulationKernel, result: DenseKernelTickResult): DenseFrameDelta {
    const state = kernel.state;
    const dirtyStorageIndexes: number[] = [];
    state.dirtySlotIndexes.drain((index) => dirtyStorageIndexes.push(index));
    const slotIndexes: number[] = [];
    for (const storageIndex of dirtyStorageIndexes) {
      const start = this.layout.storageSlotViewOffsets[storageIndex]!;
      const end = this.layout.storageSlotViewOffsets[storageIndex + 1]!;
      for (let offset = start; offset < end; offset += 1) {
        slotIndexes.push(this.layout.storageSlotViewIndexes[offset]!);
      }
    }
    slotIndexes.sort(compareNumbers);

    const componentIndexes: number[] = [];
    state.dirtyComponentIndexes.drain((index) => componentIndexes.push(index));
    componentIndexes.sort(compareNumbers);
    const deviceIndexes: number[] = [];
    state.dirtyDeviceIndexes.drain((index) => deviceIndexes.push(index));
    deviceIndexes.sort(compareNumbers);
    state.activeDeviceIndexes.clear();
    const routingCursorIndexes: number[] = [];
    state.dirtyRoutingCursorIndexes.drain((index) => routingCursorIndexes.push(index));
    routingCursorIndexes.sort(compareNumbers);

    return this.createFrame({
      state,
      tickNumber: result.tickNumber,
      status: FRAME_STATUS_RUNNING,
      kernel,
      slotIndexes: Uint32Array.from(slotIndexes),
      componentIndexes: Uint32Array.from(componentIndexes),
      routingCursorIndexes: Uint32Array.from(routingCursorIndexes),
      deviceIndexes: Uint32Array.from(deviceIndexes),
      transfers: result.transfers,
      includeStaticPresentation: false,
      warehouseMode: WAREHOUSE_PATCHED,
      changedStorageIndexes: dirtyStorageIndexes,
    });
  }

  public emitCheckpoint(kernel: DenseSimulationKernel): DenseFrameDelta {
    const state = kernel.state;
    const delta = this.createFrame({
      state,
      tickNumber: kernel.tickNumber,
      status: kernel.tickNumber === 0 ? FRAME_STATUS_INITIAL : FRAME_STATUS_RUNNING,
      kernel,
      slotIndexes: Uint32Array.from(
        { length: this.layout.dictionary.slotIds.length },
        (_, index) => index,
      ),
      componentIndexes: Uint32Array.from(
        { length: this.layout.dictionary.componentIds.length },
        (_, index) => index,
      ),
      routingCursorIndexes: Uint32Array.from(
        { length: this.layout.dictionary.routingCursorKeys.length },
        (_, index) => index,
      ),
      deviceIndexes: Uint32Array.from(
        { length: this.layout.dictionary.deviceIds.length },
        (_, index) => index,
      ),
      transfers: createEmptyTransfers(),
      includeStaticPresentation: true,
      warehouseMode: WAREHOUSE_PATCHED,
      changedStorageIndexes: [],
    });
    state.clearDirtyState();
    return delta;
  }

  private createFrame(options: {
    readonly state: DenseRuntimeState;
    readonly tickNumber: number;
    readonly status: typeof FRAME_STATUS_INITIAL | typeof FRAME_STATUS_RUNNING;
    readonly kernel: DenseSimulationKernel;
    readonly slotIndexes: Uint32Array;
    readonly componentIndexes: Uint32Array;
    readonly routingCursorIndexes: Uint32Array;
    readonly deviceIndexes: Uint32Array;
    readonly transfers: DenseKernelTickResult["transfers"];
    readonly includeStaticPresentation: boolean;
    readonly warehouseMode:
      | typeof WAREHOUSE_CLEARED
      | typeof WAREHOUSE_UNCHANGED
      | typeof WAREHOUSE_PATCHED;
    readonly changedStorageIndexes: readonly number[];
  }): DenseFrameDelta {
    const warehouseDelta = options.kernel.createWarehouseStatsDelta(
      options.includeStaticPresentation,
      options.changedStorageIndexes,
    );
    const slotItemIndexes = new Int32Array(options.slotIndexes.length);
    const slotNumbers = new Float64Array(options.slotIndexes.length * 2);
    const slotFlags = new Uint8Array(options.slotIndexes.length);
    for (let offset = 0; offset < options.slotIndexes.length; offset += 1) {
      const viewIndex = options.slotIndexes[offset]!;
      const storageIndex = this.layout.slotStorageIndexes[viewIndex]!;
      slotItemIndexes[offset] = options.state.slotItemIndexes[storageIndex]!;
      slotNumbers[offset * 2] = options.state.slotCounts[storageIndex]!;
      slotNumbers[offset * 2 + 1] = options.state.slotReserved[storageIndex]!;
      slotFlags[offset] = options.state.slotFlags[viewIndex]!;
    }

    const componentItemIndexes = new Int32Array(options.componentIndexes.length);
    for (let offset = 0; offset < options.componentIndexes.length; offset += 1) {
      componentItemIndexes[offset] = options.state.componentItemIndexes[
        options.componentIndexes[offset]!
      ]!;
    }

    const deviceIndexes = options.deviceIndexes;
    const nodeIndexes = options.includeStaticPresentation
      ? Uint32Array.from(
          { length: this.layout.dictionary.nodeIds.length },
          (_, index) => index,
        )
      : new Uint32Array();
    const frameSequence = this.nextFrameSequence;
    this.nextFrameSequence += 1;

    return {
      protocolVersion: DENSE_SIMULATION_PROTOCOL_VERSION,
      sessionId: this.session.sessionId,
      topologyVersion: this.session.topologyVersion,
      topologyId: this.layout.dictionary.topologyId,
      documentHash: this.layout.dictionary.documentHash,
      frameSequence,
      fromTickNumber: options.tickNumber,
      tickNumber: options.tickNumber,
      status: options.status,
      totalPowerDemand: options.kernel.effectiveTotalPowerDemand,
      currentPowerGeneration: options.kernel.currentPowerGeneration,
      isPowerOutage: options.kernel.isPowerOutage,
      baseBatteryJoules: options.kernel.baseBatteryJoules,
      baseBatteryCapacity: options.kernel.baseBatteryCapacity,
      changedSlotIndexes: options.slotIndexes,
      changedSlotItemIndexes: slotItemIndexes,
      changedSlotNumbers: slotNumbers,
      changedSlotFlags: slotFlags,
      changedDeviceIndexes: deviceIndexes,
      changedDevices: Array.from(
        deviceIndexes,
        (index) => this.createDeviceSnapshot(options.kernel, index),
      ),
      changedNodeIndexes: nodeIndexes,
      changedNodes: Array.from(nodeIndexes, (index) => this.createNodeSnapshot(index)),
      routingCursorKeys: Array.from(
        options.routingCursorIndexes,
        (index) => this.layout.dictionary.routingCursorKeys[index]!,
      ),
      routingCursorValues: Float64Array.from(
        options.routingCursorIndexes,
        (index) => options.state.routingCursors[index]!,
      ),
      removedRoutingCursorKeys: [],
      changedComponentIndexes: options.componentIndexes,
      changedComponentItemIndexes: componentItemIndexes,
      transferEdgeIndexes: options.transfers.edgeIndexes,
      transferSourceSlotIndexes: options.transfers.sourceSlotIndexes,
      transferTargetSlotIndexes: options.transfers.targetSlotIndexes,
      transferItemIndexes: options.transfers.itemIndexes,
      transferAmounts: options.transfers.amounts,
      diagnostics: [],
      ...this.createGasDiffusionDelta(options.kernel),
      warehouseMode: options.warehouseMode,
      warehouseStatsWindowReady: warehouseDelta.statsWindowReady,
      changedWarehouseItemIndexes: warehouseDelta.changedItemIndexes,
      changedWarehouseItemNumbers: warehouseDelta.changedItemNumbers,
      changedWarehouseItemFlags: warehouseDelta.changedItemFlags,
      removedWarehouseItemIndexes: warehouseDelta.removedItemIndexes,
    };
  }

  private createDeviceSnapshot(
    kernel: DenseSimulationKernel,
    deviceIndex: number,
  ): RuntimeDeviceSnapshot {
    return kernel.createDeviceSnapshot(deviceIndex);
  }

  private createGasDiffusionDelta(kernel: DenseSimulationKernel): Pick<
    DenseFrameDelta,
    "gasSourceDeviceIndexes" | "gasItemIndexes" | "gasGridRects"
  > {
    const sourceDeviceIndexes: number[] = [];
    const itemIndexes: number[] = [];
    const gridRects: number[] = [];
    for (const diffusion of kernel.gasDiffusions) {
      const deviceIndex = this.lookup.deviceIndexById.get(diffusion.sourceDeviceId);
      const itemIndex = this.lookup.itemIndexById.get(diffusion.gasItemId);
      if (deviceIndex === undefined || itemIndex === undefined) {
        throw new Error("Dense gas diffusion references an unknown dictionary entry.");
      }
      sourceDeviceIndexes.push(deviceIndex);
      itemIndexes.push(itemIndex);
      gridRects.push(
        diffusion.gridRect.x,
        diffusion.gridRect.y,
        diffusion.gridRect.width,
        diffusion.gridRect.height,
      );
    }
    return {
      gasSourceDeviceIndexes: Uint32Array.from(sourceDeviceIndexes),
      gasItemIndexes: Uint32Array.from(itemIndexes),
      gasGridRects: Float64Array.from(gridRects),
    };
  }

  private createNodeSnapshot(nodeIndex: number): RuntimeNodeSnapshot {
    return {
      nodeId: this.layout.dictionary.nodeIds[nodeIndex]!,
      result: "uncertain",
      resolveState: "unresolved",
      acceptedInputEdgeIds: [],
      acceptedOutputEdgeIds: [],
    };
  }
}

function createEmptyTransfers(): DenseKernelTickResult["transfers"] {
  return {
    edgeIndexes: new Uint32Array(),
    sourceSlotIndexes: new Uint32Array(),
    targetSlotIndexes: new Uint32Array(),
    itemIndexes: new Uint32Array(),
    amounts: new Float64Array(),
  };
}

function compareNumbers(left: number, right: number): number {
  return left - right;
}
