import type {
  CompiledSimulationSlot,
  CompiledSimulationTopology,
  RuntimeTickSnapshot,
  SimulationPerfReport,
  SimulationRuntimeExport,
  SimulationRuntimeTransition,
  SimulationTickPullStatus,
  SimulationTickSnapshotResult,
  SimulationRuntimeStatus,
  SimulationStartResult,
  SimulationTopologyMigration,
  TickPerfEntry,
  TickPerfHotPathDetails,
  TickPerfStage3Details,
} from "./types";
import type {
  SimulationAdmissionCounterReset,
  SimulationRuntimeSlotPatch,
} from "@/domain/simulation/types/simulation-types";
import type { RegistryContract } from "@/domain/registry/registry-contract";
import { SIMULATION_MODE, type SimulationMode } from "@/domain/shared/simulation-mode";
import type {
  SimulationTickSnapshotRangeResult,
  SimulationWorkerRequest,
  SimulationWorkerResponse,
} from "./worker-protocol";

import {
  createTickDebugData,
  createTickSnapshot,
} from "./runtime/create-tick-snapshot";
import {
  canAdjustDynamicTickRateAtTick,
  resolveDynamicTickRateSwitchIntervalTicks,
  resolveLegalDynamicTickRates,
} from "./runtime/phase-gating";
import { advanceDevices } from "./runtime/stage-1-advance-devices";
import { buildSolveGraph } from "./runtime/stage-2-build-solve-graph";
import { solveTransferGraph, type SolveTransferGraphPerf } from "./runtime/stage-3-layered-reverse-solve";
import { rotateRoutingCursors } from "./runtime/stage-4-rotate-routing-cursors";
import { settleRecipes } from "./runtime/stage-5-settle-recipes";
import { applyBlockageAutoClearance } from "./runtime/blockage-auto-clearance";
import {
  maintainTransportComponentDomains,
  rebuildExcludedItemTypesForTick,
  requireActiveItemDomain,
  resolveStorageSlotId,
} from "./runtime/runtime-slot-access";
import { computeActiveGasDiffusions } from "./runtime/gas-diffusion";
import { computeActiveConsumptionDeviceIds } from "./runtime/consumption-channel";
import { applyWaterPurifierManualOutput } from "./runtime/water-purifier-node";
import { applySingleBaseRegionalResourceSupply } from "./runtime/regional-resource-supply";
import {
  RegionWarehouseGate,
  resolveRegionalEpochGateTick,
} from "./runtime/regional-warehouse-gate";
import {
  arbitrateRegionalWarehouseEpoch,
  commitRegionalWarehouseEpoch,
  type RegionWarehouseAckBatch,
  type RegionWarehouseArbitrationResult,
  type RegionWarehouseAuthorityState,
  type RegionWarehouseCommitProposal,
  type RegionWarehouseDemandBatch,
  type RegionalWarehouseOutletTable,
} from "./regional";
// AI-REMOVED 2026-06-06:
// Reason: submitMode 全局扫描机制已删除；入仓必须走 WarehouseSink 或 r_warehouse_submit 配方。
// Trigger: 用户要求 submit mode 机制彻底删除，避免旧蓝图 submitMode 配置影响所有 slot。
// Evidence: RUN_ID 20260606-041337-509040 中全局扫描清空产线目标存储箱导致 blueprint 失败。
// Replacement: runtime-slot-access 动态 warehouse sink；stage-1 r_warehouse_submit 配方完成时调用 submitSlotsToWarehouse。
// Risk: Medium
// Human Review: Required
//
// Original code:
// import { submitSlotsBySubmitMode } from "./runtime/warehouse-submit";
import {
  cloneSimulationMutableRuntimeState,
  createEmptyTransientState,
  createMigratedSimulationMutableRuntimeState,
  createSimulationMutableRuntimeState,
  normalizeFixedWindowCountersForCurrentWindow,
  resetFixedWindowCounterForCurrentWindow,
  rollRecipeStatsWindow,
  BASE_BATTERY_CAPACITY_J,
  type SimulationMutableRuntimeState,
  type SimulationRuntimePerf,
} from "./runtime/runtime-state";
import {
  DEFAULT_SIMULATION_SPEED,
  resolveNextHigherDynamicTickRate,
  resolveNextLowerDynamicTickRate,
  resolveStandardStepTicks,
  STANDARD_TICK_RATE_PER_SECOND,
} from "./tick-rate";

const MAX_RETAINED_TICKS = 180;

function createTopologyRuntimeTransition(options: {
  readonly previousTopology: CompiledSimulationTopology | null;
  readonly migration: SimulationTopologyMigration | undefined;
  readonly previousBaseState: SimulationMutableRuntimeState | null;
  readonly requestedMigrationBaseTickNumber: number;
  readonly baseTickNumber: number;
  readonly cachedRuntimeStateTickNumbers: readonly number[];
}): SimulationRuntimeTransition {
  const resetDeviceIds = options.migration?.resetDeviceIds ?? [];
  const invalidatedFromTickNumber = options.baseTickNumber + 1;

  if (options.previousTopology === null) {
    return {
      kind: "initialization",
      reason: "no previous simulation topology is loaded",
      baseTickNumber: options.baseTickNumber,
      invalidatedFromTickNumber,
      resetDeviceIds,
    };
  }

  if (options.migration === undefined) {
    return {
      kind: "full-reset",
      reason: "topology migration metadata is unavailable",
      baseTickNumber: options.baseTickNumber,
      invalidatedFromTickNumber,
      resetDeviceIds,
    };
  }

  if (options.previousBaseState === null) {
    const cachedTicks = options.cachedRuntimeStateTickNumbers;
    const cachedTickDescription = cachedTicks.length === 0
      ? "no cached runtime states are available"
      : `cached runtime states cover ticks ${cachedTicks[0]} through ${cachedTicks[cachedTicks.length - 1]} (${cachedTicks.length} total)`;
    return {
      kind: "full-reset",
      reason: `runtime state at migration base tick ${options.baseTickNumber} is unavailable; ${cachedTickDescription}`,
      baseTickNumber: options.baseTickNumber,
      invalidatedFromTickNumber,
      resetDeviceIds,
    };
  }

  return {
    kind: "topology-hot-swap",
    reason: options.baseTickNumber === options.requestedMigrationBaseTickNumber
      ? "topology document changed and a runtime state exists at the migration base tick"
      : `topology document changed; requested migration base tick ${options.requestedMigrationBaseTickNumber} was no longer retained, so cached runtime state at tick ${options.baseTickNumber} was used`,
    baseTickNumber: options.baseTickNumber,
    invalidatedFromTickNumber,
    resetDeviceIds,
  };
}

function resolveMigrationBaseRuntimeState(options: {
  readonly requestedTickNumber: number;
  readonly tickRuntimeStates: ReadonlyMap<number, SimulationMutableRuntimeState>;
  readonly migrationAnchorTickNumber: number | null;
  readonly runtimeState: SimulationMutableRuntimeState | null;
}): SimulationMutableRuntimeState | null {
  const exactState = options.tickRuntimeStates.get(options.requestedTickNumber);
  if (exactState !== undefined) {
    return exactState;
  }

  return options.migrationAnchorTickNumber === options.requestedTickNumber
    && options.runtimeState?.tickNumber === options.requestedTickNumber
    ? options.runtimeState
    : null;
}

function createRuntimePerfCounters(): SimulationRuntimePerf {
  return {
    getReservedCalls: 0,
    canOutputProvideCalls: 0,
    findInputSlotCalls: 0,
    getRemainingCapacityCalls: 0,
    selectSourceCalls: 0,
    solveOutputEdgeChecks: 0,
    inputEdgeLookupCalls: 0,
    inputEdgeLookupMs: 0,
    outputEdgeLookupCalls: 0,
    outputEdgeLookupMs: 0,
    edgeIndexFallbackScans: 0,
    reservedLookupCalls: 0,
    reservedLookupMs: 0,
    reservedIndexBuilds: 0,
    reservedIndexBuildMs: 0,
    reservationAdjustCalls: 0,
    recipeFinishCalls: 0,
    recipeFinishSuccesses: 0,
    recipeFinishFailures: 0,
    recipeFinishPreflightMs: 0,
    recipeFinishCommitMs: 0,
    recipeFinishChangedSlots: 0,
  };
}

function createHotPathPerfDetails(perf: SimulationRuntimePerf): TickPerfHotPathDetails {
  return {
    inputEdgeLookupCalls: perf.inputEdgeLookupCalls,
    inputEdgeLookupMs: perf.inputEdgeLookupMs,
    outputEdgeLookupCalls: perf.outputEdgeLookupCalls,
    outputEdgeLookupMs: perf.outputEdgeLookupMs,
    edgeIndexFallbackScans: perf.edgeIndexFallbackScans,
    reservedLookupCalls: perf.reservedLookupCalls,
    reservedLookupMs: perf.reservedLookupMs,
    reservedIndexBuilds: perf.reservedIndexBuilds,
    reservedIndexBuildMs: perf.reservedIndexBuildMs,
    reservationAdjustCalls: perf.reservationAdjustCalls,
    recipeFinishCalls: perf.recipeFinishCalls,
    recipeFinishSuccesses: perf.recipeFinishSuccesses,
    recipeFinishFailures: perf.recipeFinishFailures,
    recipeFinishPreflightMs: perf.recipeFinishPreflightMs,
    recipeFinishCommitMs: perf.recipeFinishCommitMs,
    recipeFinishChangedSlots: perf.recipeFinishChangedSlots,
  };
}

export class SimulationWorkerRuntime {
  private topology: CompiledSimulationTopology | null = null;
  private runtimeState: SimulationMutableRuntimeState | null = null;
  private tickSnapshots = new Map<number, RuntimeTickSnapshot>();
  private tickRuntimeStates = new Map<number, SimulationMutableRuntimeState>();
  private nextTickNumber = 0;
  private retainedFromTick: number | null = null;
  private latestTickNumber: number | null = null;
  private mode: SimulationRuntimeStatus["mode"] = "idle";
  private error: string | null = null;
  private simulationSpeed = DEFAULT_SIMULATION_SPEED;
  private dynamicTickRate = STANDARD_TICK_RATE_PER_SECOND;
  private standardStepTicks = 1;
  private fixedDynamicTickRate: number | null = null;
  private lastRequestedTickNumber = 0;
  /** 主线程最后确认展示的状态，拓扑迁移只能从此精确 tick 接续。 */
  private migrationAnchorTickNumber: number | null = null;
  /** 当前主线程热队列生命周期；只接受同 generation 的呈现确认。 */
  private presentationGeneration: number | null = null;
  private lastDynamicRateAdjustmentTick: number | null = null;
  // AI-REMOVED 2026-07-15:
  // Reason: x1 粗粒度降级破坏了配方、气体与净水的精确 tick 语义。
  // Trigger: 完整测试出现 7 个确定性产量回归。
  // Evidence: gas-diffusion、power-system、production、water-purifier-node、xiranite-enr-chain 均在 x1 降级后失败。
  // Replacement: 保留 x1 的 20 TPS 精确运行；低性能时只允许播放背压与未来边界替换。
  // Risk: 性能极差机器无法维持实时速度时会平滑减速，但不会牺牲仿真准确性。
  // Human Review: Required
  //
  // Original code:
  // private forceHighestDynamicTickRateAtNextLegalPoint = false;
  private powerMode: "real" | "infinite" = "infinite";
  private regionalGate: RegionWarehouseGate | null = null;
  private pendingRegionalDemand: readonly string[] = [];
  private regionalGatePausedTick: number | null = null;
  /** 区域模式下不启动单基地后台填充定时器。 */
  private regionalRuntimeMode = false;

  private regionalTable: RegionalWarehouseOutletTable | null = null;
  private regionalExpectedBaseIds: readonly string[] = [];
  private regionalAuthorityState: RegionWarehouseAuthorityState | null = null;
  private regionalActiveArbitration: RegionWarehouseArbitrationResult | null = null;
  private regionalAdvancePerTick = false;
  private regionalGateStage1AdvanceResult:
    | ReturnType<typeof advanceDevices>
    | undefined = undefined;
  private regionalGateCurrentPowerGeneration = Infinity;
  private regionalGatePowerOutage = false;
  private regionalGateLastAdvancedTickNumber = 0;
  private regionalSnapshotCursor = 0;

  // 停止线：Worker 自主推进到该 tick 后暂停，等待外部拉取更新停止线。
  // 初始值 = 0 + MAX_RETAINED_TICKS，外部每次请求 tick N 时更新为 N + MAX_RETAINED_TICKS。
  private stopLineTick = 0;
  // 后台填充定时器 ID，用于取消和防重入。
  private fillTimerId: ReturnType<typeof setTimeout> | null = null;

  // Perf instrumentation：轻量性能统计与完整 debugData 必须独立控制。
  private perfEnabled = false;
  private debugDataEnabled = false;
  private perfEntries: TickPerfEntry[] = [];

  /** 手动覆盖总耗电（kW），undefined = 按编译期真实值。 */
  private powerConsumptionOverride: number | undefined = undefined;

  /** Worker 线程内异步路径（setTimeout 回调等）错误时的回调，由 simulation-worker.ts 注入。 */
  private onError: ((error: string, tickNumber: number | null) => void) | null = null;

  public constructor(
    private readonly registry: RegistryContract,
  ) {}

  public setOnError(callback: (error: string, tickNumber: number | null) => void): void {
    this.onError = callback;
  }

  public handleRequest(request: SimulationWorkerRequest): SimulationWorkerResponse {
    try {
      switch (request.type) {
        case "load-topology":
          this.perfEnabled = request.perfEnabled ?? false;
          this.debugDataEnabled = request.debugDataEnabled ?? false;
          this.setSimulationSpeedValue(request.simulationSpeed);
          return {
            type: "topology-loaded",
            requestId: request.requestId,
            result: this.loadTopology(request.topology, request.migration),
            status: this.getStatus(),
          };
        case "get-tick-snapshot":
          this.setSimulationSpeedValue(request.simulationSpeed);
          return {
            type: "tick-snapshot-result",
            requestId: request.requestId,
            result: this.getTickSnapshot(request.tickNumber, request.retainTickNumber),
            status: this.getStatus(),
          };
        case "get-tick-snapshot-range":
          this.setSimulationSpeedValue(request.simulationSpeed);
          return {
            type: "tick-snapshot-range-result",
            requestId: request.requestId,
            result: this.getTickSnapshotRange(
              request.fromTickNumber,
              request.toTickNumber,
              request.generation,
            ),
            status: this.getStatus(),
          };
        case "acknowledge-presented-tick":
          return {
            type: "presented-tick-acknowledged",
            requestId: request.requestId,
            generation: request.generation,
            acknowledgedTickNumber: this.acknowledgePresentedTick(
              request.tickNumber,
              request.generation,
            ),
            status: this.getStatus(),
          };
        case "set-simulation-speed":
          this.setSimulationSpeedValue(request.simulationSpeed);
          return {
            type: "simulation-speed-set",
            requestId: request.requestId,
            status: this.getStatus(),
          };
        case "set-debug-enabled":
          this.perfEnabled = request.debugEnabled;
          return {
            type: "debug-enabled-set",
            requestId: request.requestId,
            status: this.getStatus(),
          };
        case "set-debug-data-enabled":
          this.debugDataEnabled = request.debugDataEnabled;
          return {
            type: "debug-data-enabled-set",
            requestId: request.requestId,
            status: this.getStatus(),
          };
        case "patch-runtime-slot":
          this.patchRuntimeSlot(request.patch);
          return {
            type: "runtime-slot-patched",
            requestId: request.requestId,
            status: this.getStatus(),
          };
        case "reset-admission-counter":
          this.resetAdmissionCounter(request.reset);
          return {
            type: "admission-counter-reset",
            requestId: request.requestId,
            status: this.getStatus(),
          };
        case "get-perf-report":
          return {
            type: "perf-report",
            requestId: request.requestId,
            report: this.flushPerfReport(),
            status: this.getStatus(),
          };
        case "set-power-mode":
          this.setPowerMode(request.powerMode);
          return {
            type: "power-mode-set",
            requestId: request.requestId,
            status: this.getStatus(),
          };
        case "set-power-consumption-override":
          this.setPowerConsumptionOverride(request.powerConsumptionOverride);
          return {
            type: "power-consumption-override-set",
            requestId: request.requestId,
            status: this.getStatus(),
          };
        case "export-runtime-state":
          return {
            type: "runtime-state-exported",
            requestId: request.requestId,
            runtimeExport: this.exportRuntimeState(request.tickNumber),
            status: this.getStatus(),
          };
        case "import-runtime-state":
          return {
            type: "runtime-state-imported",
            requestId: request.requestId,
            result: this.importRuntimeState(request.runtimeExport),
            status: this.getStatus(),
          };
        case "load-regional-topology":
          return {
            type: "regional-topology-loaded",
            requestId: request.requestId,
            result: this.loadRegionalTopology({
              topology: request.topology,
              baseId: request.baseId,
              table: request.table,
              initialWarehouseCounts: request.initialWarehouseCounts,
              expectedBaseIds: request.expectedBaseIds,
              fixedDynamicTickRate: request.fixedDynamicTickRate,
              advanceMode: request.advanceMode,
            }),
            status: this.getStatus(),
          };
        case "prepare-regional-epoch":
          return {
            type: "regional-epoch-prepared",
            requestId: request.requestId,
            epochNumber: request.epochNumber,
            ...this.prepareRegionalEpochDemand(request.epochNumber),
            status: this.getStatus(),
          };
        case "apply-regional-epoch-grant":
          return {
            type: "regional-epoch-grant-applied",
            requestId: request.requestId,
            epochNumber: request.epochNumber,
            ...this.applyRegionalEpochGrant({
              epochNumber: request.epochNumber,
              grantedOutletIds: request.grantedOutletIds,
            }),
            status: this.getStatus(),
          };
        case "finalize-regional-epoch":
          return {
            type: "regional-epoch-finalized",
            requestId: request.requestId,
            epochNumber: request.epochNumber,
            ...this.finalizeRegionalEpoch({
              epochNumber: request.epochNumber,
              nextWarehouseCounts: request.nextWarehouseCounts,
              includeSnapshot: request.includeSnapshot,
              retainSnapshot: request.retainSnapshot,
            }),
            status: this.getStatus(),
          };
        case "regional-arbitrate":
          return {
            type: "regional-arbitrated",
            requestId: request.requestId,
            epochNumber: request.epochNumber,
            result: this.arbitrateRegionalEpoch(request.epochNumber, request.demands),
            status: this.getStatus(),
          };
        case "regional-commit":
          return {
            type: "regional-committed",
            requestId: request.requestId,
            epochNumber: request.epochNumber,
            result: this.commitRegionalEpoch(request.epochNumber, request.acks),
            status: this.getStatus(),
          };
        case "take-regional-snapshots":
          return {
            type: "regional-snapshots-taken",
            requestId: request.requestId,
            snapshots: this.takeRegionalSnapshots(),
            status: this.getStatus(),
          };
      }
    } catch (error) {
      this.mode = "error";
      this.error = error instanceof Error ? error.message : String(error);
      const status = this.getStatus();
      switch (request.type) {
        case "load-topology":
          return {
            type: "topology-loaded",
            requestId: request.requestId,
            result: { status: "failed", topologyId: null, diagnostics: [] },
            status,
          };
        case "get-tick-snapshot":
          return {
            type: "tick-snapshot-result",
            requestId: request.requestId,
            result: {
              status: createNotFoundStatus(0, "missing-topology", null, null, 0),
              currentTick: null,
            },
            status,
          };
        case "get-tick-snapshot-range":
          return {
            type: "tick-snapshot-range-result",
            requestId: request.requestId,
            result: {
              generation: request.generation,
              fromTickNumber: Math.max(0, Math.trunc(request.fromTickNumber)),
              toTickNumber: Math.max(0, Math.trunc(request.toTickNumber)),
              status: createNotFoundStatus(
                request.fromTickNumber,
                "missing-topology",
                this.retainedFromTick,
                this.latestTickNumber,
                this.tickSnapshots.size,
              ),
              snapshots: [],
            },
            status,
          };
        case "acknowledge-presented-tick":
          return {
            type: "presented-tick-acknowledged",
            requestId: request.requestId,
            generation: request.generation,
            acknowledgedTickNumber: null,
            status,
          };
        case "set-simulation-speed":
          return {
            type: "simulation-speed-set",
            requestId: request.requestId,
            status,
          };
        case "set-debug-enabled":
          return {
            type: "debug-enabled-set",
            requestId: request.requestId,
            status,
          };
        case "set-debug-data-enabled":
          return {
            type: "debug-data-enabled-set",
            requestId: request.requestId,
            status,
          };
        case "patch-runtime-slot":
          return {
            type: "runtime-slot-patched",
            requestId: request.requestId,
            status,
          };
        case "reset-admission-counter":
          return {
            type: "admission-counter-reset",
            requestId: request.requestId,
            status,
          };
        case "get-perf-report":
          return {
            type: "perf-report",
            requestId: request.requestId,
            report: null,
            status,
          };
        case "set-power-mode":
          return {
            type: "power-mode-set",
            requestId: request.requestId,
            status,
          };
        case "set-power-consumption-override":
          return {
            type: "power-consumption-override-set",
            requestId: request.requestId,
            status,
          };
        case "export-runtime-state":
          return {
            type: "runtime-state-exported",
            requestId: request.requestId,
            runtimeExport: null,
            status,
          };
        case "import-runtime-state":
          return {
            type: "runtime-state-imported",
            requestId: request.requestId,
            result: {
              status: createNotFoundStatus(0, "missing-topology", null, null, 0),
              currentTick: null,
            },
            status,
          };
        case "load-regional-topology":
          return {
            type: "regional-topology-loaded",
            requestId: request.requestId,
            result: { status: "failed", topologyId: null, diagnostics: [] },
            status,
          };
        case "prepare-regional-epoch":
          return {
            type: "regional-epoch-prepared",
            requestId: request.requestId,
            epochNumber: request.epochNumber,
            tickNumber: 0,
            demandedOutletIds: [],
            status,
          };
        case "apply-regional-epoch-grant":
          return {
            type: "regional-epoch-grant-applied",
            requestId: request.requestId,
            epochNumber: request.epochNumber,
            tickNumber: 0,
            deposits: [],
            status,
          };
        case "finalize-regional-epoch":
          return {
            type: "regional-epoch-finalized",
            requestId: request.requestId,
            epochNumber: request.epochNumber,
            tickNumber: 0,
            snapshot: null,
            status,
          };
        case "regional-arbitrate":
          return {
            type: "regional-arbitrated",
            requestId: request.requestId,
            epochNumber: request.epochNumber,
            result: {
              grantsByBaseId: {},
              provisionalCounts: {},
              provisionalCursorByItemId: {},
            },
            status,
          };
        case "regional-commit":
          return {
            type: "regional-committed",
            requestId: request.requestId,
            epochNumber: request.epochNumber,
            result: {
              sessionId: "error",
              epochNumber: request.epochNumber,
              parentWarehouseVersion: 0,
              nextWarehouseVersion: 1,
              warehouseCounts: {},
              cursorByItemId: {},
            },
            status,
          };
        case "take-regional-snapshots":
          return {
            type: "regional-snapshots-taken",
            requestId: request.requestId,
            snapshots: [],
            status,
          };
      }
    }
  }

  public getStatus(): SimulationRuntimeStatus {
    return {
      mode: this.mode,
      topologyId: this.topology?.topologyId ?? null,
      documentHash: this.topology?.documentHash ?? null,
      retainedFromTick: this.retainedFromTick,
      latestTickNumber: this.latestTickNumber,
      bufferSize: this.tickSnapshots.size,
      maxBufferSize: MAX_RETAINED_TICKS,
      dynamicTickRate: this.topology === null ? null : this.dynamicTickRate,
      error: this.error,
    };
  }

  public exportRuntimeState(tickNumber?: number): SimulationRuntimeExport | null {
    if (this.topology === null || this.runtimeState === null) {
      return null;
    }

    const targetTickNumber = tickNumber === undefined
      ? this.runtimeState.tickNumber
      : Math.max(0, Math.trunc(tickNumber));
    const runtimeState = this.tickRuntimeStates.get(targetTickNumber)
      ?? (this.runtimeState.tickNumber === targetTickNumber ? this.runtimeState : null);

    if (runtimeState === null) {
      return null;
    }

    const snapshot = this.tickSnapshots.get(targetTickNumber)
      ?? this.createSnapshotFromRuntimeState(runtimeState);

    return {
      topology: this.topology,
      runtimeState: cloneSimulationMutableRuntimeState(runtimeState),
      snapshot,
      powerMode: this.powerMode,
      powerConsumptionOverride: this.powerConsumptionOverride,
    };
  }

  public importRuntimeState(
    runtimeExport: SimulationRuntimeExport,
    options: { readonly scheduleBackgroundFill?: boolean } = {},
  ): SimulationTickSnapshotResult {
    if (this.fillTimerId !== null) {
      clearTimeout(this.fillTimerId);
      this.fillTimerId = null;
    }

    this.topology = runtimeExport.topology;
    this.runtimeState = cloneSimulationMutableRuntimeState(runtimeExport.runtimeState);
    this.powerMode = runtimeExport.powerMode;
    this.powerConsumptionOverride = runtimeExport.powerConsumptionOverride;
    this.tickSnapshots.clear();
    this.tickRuntimeStates.clear();

    const tickNumber = this.runtimeState.tickNumber;
    // AI-CORRECTION 2026-07-17: 导入检查点时必须保留导出端已经计算完成的展示帧；runtimeState 的 transient
    // 可能为节省历史缓存而被裁剪，重新从它构帧会让当前 tick 的 transfers 等瞬态展示状态消失。
    const snapshot = runtimeExport.snapshot;
    // AI-REMOVED 2026-07-17:
    // Reason: 从 runtimeState 重建导入帧会主动清空 transient，破坏检查点携带的精确展示语义。
    // Trigger: 平板端时间轴拖动停止并提交后，所有在途物品再次消失。
    // Evidence: tick 321 检查点快照含 4 个 transfers，而 importRuntimeState 返回的 currentTick 含 0 个。
    // Replacement: 直接使用 runtimeExport.snapshot；后续 tick 仍从导入的持久运行状态继续计算。
    // Risk: Low；导出协议已保证 snapshot 与 runtimeState 属于同一 tick。
    // Human Review: Required
    //
    // Original code:
    // const snapshot = this.createSnapshotFromRuntimeState(this.runtimeState);
    this.tickSnapshots.set(tickNumber, snapshot);
    // 后台 tick 只需缓存可迁移的持久状态；完整 transient 仅在 debugData 模式保留。
    this.tickRuntimeStates.set(
      tickNumber,
      cloneSimulationMutableRuntimeState(this.runtimeState, this.debugDataEnabled),
    );
    this.nextTickNumber = tickNumber + 1;
    this.retainedFromTick = tickNumber;
    this.latestTickNumber = tickNumber;
    this.lastRequestedTickNumber = tickNumber;
    this.migrationAnchorTickNumber = tickNumber;
    this.presentationGeneration = null;
    this.dynamicTickRate = this.topology.standardTickRate;
    this.standardStepTicks = 1;
    this.fixedDynamicTickRate = null;
    this.lastDynamicRateAdjustmentTick = null;
    // AI-REMOVED 2026-07-15:
    // Reason: 对应的 x1 粗粒度切换状态已因准确性回归撤销。
    // Trigger: 完整仿真测试 7 项失败。
    // Evidence: forceHighestDynamicTickRateAtNextLegalPoint 不再是有效运行状态。
    // Replacement: adjustDynamicTickRateAtLegalPoint 在 x1 固定选择最高合法粒度。
    // Risk: Low。
    // Human Review: Required
    //
    // Original code:
    // this.forceHighestDynamicTickRateAtNextLegalPoint = false;
    this.adjustDynamicTickRateAtLegalPoint(tickNumber);
    this.mode = "running";
    this.error = null;
    this.stopLineTick = this.nextTickNumber + MAX_RETAINED_TICKS;
    if (options.scheduleBackgroundFill !== false) {
      this.scheduleBackgroundFill();
    }

    return {
      status: {
        status: "ready",
        retainedFromTick: tickNumber,
        latestTickNumber: tickNumber,
        bufferSize: this.tickSnapshots.size,
      },
      currentTick: this.debugDataEnabled
        ? this.createDebugSnapshotReadModel(snapshot, this.runtimeState)
        : snapshot,
    };
  }

  public setFixedDynamicTickRate(dynamicTickRate: number | null): void {
    if (dynamicTickRate === null) {
      this.fixedDynamicTickRate = null;
      return;
    }

    if (this.topology === null || resolveStandardStepTicks(dynamicTickRate, this.topology.standardTickRate) === null) {
      return;
    }

    this.fixedDynamicTickRate = dynamicTickRate;
    this.setDynamicTickRate(dynamicTickRate);
  }

  public createSparseTickSnapshot(tickNumber: number): RuntimeTickSnapshot | null {
    if (this.topology === null || this.runtimeState === null) {
      return null;
    }

    const targetTickNumber = Math.max(this.runtimeState.tickNumber, Math.trunc(tickNumber));
    try {
      const snapshot = this.createNextTickSnapshot(targetTickNumber);
      this.tickSnapshots.set(targetTickNumber, snapshot);
      this.tickRuntimeStates.set(
        targetTickNumber,
        cloneSimulationMutableRuntimeState(this.runtimeState, this.debugDataEnabled),
      );
      this.latestTickNumber = targetTickNumber;
      this.retainedFromTick = Math.min(
        this.retainedFromTick ?? targetTickNumber,
        targetTickNumber,
      );
      this.nextTickNumber = targetTickNumber + 1;
      return snapshot;
    } catch (error) {
      this.mode = "error";
      this.error = error instanceof Error ? error.message : String(error);
      this.onError?.(this.error, targetTickNumber);
      return null;
    }
  }

  private createSnapshotFromRuntimeState(
    runtimeState: SimulationMutableRuntimeState,
  ): RuntimeTickSnapshot {
    if (this.topology === null) {
      throw new Error("Simulation runtime is not initialized.");
    }

    const state = cloneSimulationMutableRuntimeState(runtimeState);
    normalizeFixedWindowCountersForCurrentWindow(this.topology, state);
    state.transient = createEmptyTransientState();
    buildSolveGraph(this.topology, state);
    const currentPowerGeneration = computeCurrentPowerGeneration(this.registry, state);
    const isPowerOutage = computeEffectivePowerState(
      this.powerMode,
      currentPowerGeneration,
      this.effectiveTotalPowerDemand,
      state.persistent.baseBatteryJoules,
    );
    state.transient.isPowerOutage = isPowerOutage;
    state.transient.activeConsumptionDeviceIds =
      computeActiveConsumptionDeviceIds(this.topology, state);
    state.transient.activeGasDiffusions = computeActiveGasDiffusions(this.registry, this.topology, state);
    return createTickSnapshot(this.topology, state, isPowerOutage, currentPowerGeneration);
  }

  private patchRuntimeSlot(patch: SimulationRuntimeSlotPatch): void {
    if (this.topology === null || this.runtimeState === null) {
      return;
    }

    const compiledDeviceId = resolveCompiledDeviceId(this.topology, patch.entityId);
    if (compiledDeviceId === null) {
      return;
    }

    const slotIds = resolvePatchTargetSlotIds({
      topology: this.topology,
      compiledDeviceId,
      storageGroupId: patch.storageGroupId,
      slotId: patch.slotId,
    });
    if (slotIds.length === 0) {
      return;
    }

    if (this.fillTimerId !== null) {
      clearTimeout(this.fillTimerId);
      this.fillTimerId = null;
    }

    const nextTopology = patchSlotIgnoreStock(this.topology, slotIds, patch.ignoreStock);
    const patchTickNumber = this.resolvePatchBaseTickNumber();
    const baseState = this.tickRuntimeStates.get(patchTickNumber) ?? this.runtimeState;
    const nextState = cloneSimulationMutableRuntimeState(baseState);
    const normalizedItemType = normalizePatchItemType(nextTopology, slotIds, patch.itemType);
    const normalizedCount = normalizedItemType === null
      ? 0
      : clampRuntimePatchCount(patch.count, resolvePatchCapacity(nextTopology, slotIds));
    const normalizedIgnoreStock = normalizedItemType === null ? false : patch.ignoreStock;
    const effectiveTopology = normalizedIgnoreStock === patch.ignoreStock
      ? nextTopology
      : patchSlotIgnoreStock(nextTopology, slotIds, normalizedIgnoreStock);

    if (!canPatchSlotsHoldItem(this.registry, effectiveTopology, slotIds, normalizedItemType)) {
      return;
    }

    const patchedStorageSlotIds = new Set<string>();
    for (const slotId of slotIds) {
      const storageSlotId = resolveStorageSlotId(nextState, slotId);
      patchedStorageSlotIds.add(storageSlotId);
      nextState.persistent.slots[storageSlotId] = {
        itemType: normalizedItemType,
        count: normalizedCount,
      };
    }

    resetRuntimeRecipesAffectedByPatch(nextState, compiledDeviceId, patchedStorageSlotIds);
    nextState.tickNumber = patchTickNumber;
    nextState.lastAdvancedTickNumber = patchTickNumber;
    nextState.transient = createEmptyTransientState();
    maintainTransportComponentDomains(effectiveTopology, nextState);

    this.topology = effectiveTopology;
    this.runtimeState = nextState;
    this.clearTickCachesFrom(patchTickNumber);
    this.lastRequestedTickNumber = patchTickNumber;
    this.migrationAnchorTickNumber = patchTickNumber;
    this.stopLineTick = Math.max(this.stopLineTick, patchTickNumber + MAX_RETAINED_TICKS);
    this.scheduleBackgroundFill();
  }

  private resetAdmissionCounter(reset: SimulationAdmissionCounterReset): void {
    if (this.topology === null || this.runtimeState === null) {
      return;
    }

    const compiledDeviceId = resolveCompiledDeviceId(this.topology, reset.entityId);
    if (compiledDeviceId === null) {
      return;
    }

    const compiledPortId = resolveAdmissionCounterPortId({
      topology: this.topology,
      compiledDeviceId,
      portGroupId: reset.portGroupId,
      portId: reset.portId,
    });
    if (compiledPortId === null) {
      return;
    }

    if (this.fillTimerId !== null) {
      clearTimeout(this.fillTimerId);
      this.fillTimerId = null;
    }

    const patchTickNumber = this.resolvePatchBaseTickNumber();
    const baseState = this.tickRuntimeStates.get(patchTickNumber) ?? this.runtimeState;
    const nextState = cloneSimulationMutableRuntimeState(baseState);
    nextState.tickNumber = patchTickNumber;
    nextState.lastAdvancedTickNumber = patchTickNumber;
    if (reset.scope === "rate-window") {
      resetFixedWindowCounterForCurrentWindow(this.topology, nextState, compiledPortId);
    } else {
      nextState.persistent.admissionCounters[compiledPortId] = 0;
    }
    nextState.transient = createEmptyTransientState();

    this.runtimeState = nextState;
    this.clearTickCachesFrom(patchTickNumber);
    this.lastRequestedTickNumber = patchTickNumber;
    this.migrationAnchorTickNumber = patchTickNumber;
    this.stopLineTick = Math.max(this.stopLineTick, patchTickNumber + MAX_RETAINED_TICKS);
    this.scheduleBackgroundFill();
  }

  private resolvePatchBaseTickNumber(): number {
    const requestedTickNumber = Math.max(0, Math.trunc(this.lastRequestedTickNumber));
    if (this.tickRuntimeStates.has(requestedTickNumber)) {
      return requestedTickNumber;
    }
    if (this.runtimeState !== null) {
      return Math.max(0, Math.trunc(this.runtimeState.tickNumber));
    }
    return requestedTickNumber;
  }

  /**
   * 统一缓存作废入口：丢弃 tickNumber 及之后的所有预计算快照。
   * 调用方负责在适当时候调度后台填充。
   */
  private invalidateFrom(tickNumber: number): void {
    for (const cachedTickNumber of [...this.tickSnapshots.keys()]) {
      if (cachedTickNumber >= tickNumber) {
        this.tickSnapshots.delete(cachedTickNumber);
        this.tickRuntimeStates.delete(cachedTickNumber);
      }
    }

    const retainedTickNumbers = [...this.tickSnapshots.keys()].sort((left, right) => left - right);
    this.latestTickNumber = retainedTickNumbers[retainedTickNumbers.length - 1] ?? null;
    this.retainedFromTick = retainedTickNumbers[0] ?? null;
    if (this.migrationAnchorTickNumber !== null && this.migrationAnchorTickNumber >= tickNumber) {
      this.migrationAnchorTickNumber = null;
    }
    this.nextTickNumber = tickNumber;
  }

  private clearTickCachesFrom(tickNumber: number): void {
    this.invalidateFrom(tickNumber);
  }

  private loadTopology(
    topology: CompiledSimulationTopology,
    migration?: SimulationTopologyMigration,
    expectedSimulationMode: SimulationMode = SIMULATION_MODE.singleBase,
  ): SimulationStartResult {
    if (topology.simulationMode !== expectedSimulationMode) {
      return {
        status: "failed",
        topologyId: topology.topologyId,
        diagnostics: topology.diagnostics,
        error: `Topology simulation mode "${topology.simulationMode}" does not match worker route "${expectedSimulationMode}".`,
      };
    }
    if (expectedSimulationMode === SIMULATION_MODE.singleBase) {
      this.regionalRuntimeMode = false;
      this.regionalGate = null;
    }
    // 取消任何正在进行的后台填充
    if (this.fillTimerId !== null) {
      clearTimeout(this.fillTimerId);
      this.fillTimerId = null;
    }

    const previousTopology = this.topology;
    const migrationBaseTickNumber = migration === undefined
      ? 0
      : Math.max(0, Math.trunc(migration.baseTickNumber));
    const cachedRuntimeStateTickNumbers = [...this.tickRuntimeStates.keys()].sort((left, right) => left - right);
    const previousBaseState = migration === undefined
      ? null
      : resolveMigrationBaseRuntimeState({
          requestedTickNumber: migrationBaseTickNumber,
          tickRuntimeStates: this.tickRuntimeStates,
          migrationAnchorTickNumber: this.migrationAnchorTickNumber,
          runtimeState: this.runtimeState,
        });
    if (previousTopology !== null && migration !== undefined && previousBaseState === null) {
      const cachedTickDescription = cachedRuntimeStateTickNumbers.length === 0
        ? "no cached runtime states are available"
        : `cached runtime states cover ticks ${cachedRuntimeStateTickNumbers[0]} through ${cachedRuntimeStateTickNumbers[cachedRuntimeStateTickNumbers.length - 1]} (${cachedRuntimeStateTickNumbers.length} total)`;
      const reason = `exact migration anchor tick ${migrationBaseTickNumber} is unavailable; ${cachedTickDescription}`;
      return {
        status: "failed",
        topologyId: previousTopology.topologyId,
        diagnostics: topology.diagnostics,
        error: reason,
        runtimeTransition: {
          kind: "migration-rejected",
          reason,
          baseTickNumber: migrationBaseTickNumber,
          invalidatedFromTickNumber: migrationBaseTickNumber + 1,
          resetDeviceIds: migration.resetDeviceIds,
        },
      };
    }
    const canHotSwapTopology = previousTopology !== null
      && previousBaseState !== null
      && migration !== undefined;
    const nextRuntimeState = canHotSwapTopology
      ? createMigratedSimulationMutableRuntimeState({
          previousTopology,
          previousState: previousBaseState,
          topology,
          resetDeviceIds: migration.resetDeviceIds,
        })
      : createSimulationMutableRuntimeState(topology);
    if (previousBaseState === null && migration !== undefined) {
      nextRuntimeState.tickNumber = migrationBaseTickNumber;
      nextRuntimeState.lastAdvancedTickNumber = migrationBaseTickNumber;
    }

    const runtimeTransition = createTopologyRuntimeTransition({
      previousTopology,
      migration,
      previousBaseState,
      requestedMigrationBaseTickNumber: migrationBaseTickNumber,
      baseTickNumber: nextRuntimeState.tickNumber,
      cachedRuntimeStateTickNumbers,
    });

    this.topology = topology;
    this.runtimeState = nextRuntimeState;
    this.tickSnapshots.clear();
    this.tickRuntimeStates.clear();
    const baseTickNumber = this.runtimeState.tickNumber;
    const baseSnapshot = this.createSnapshotFromRuntimeState(this.runtimeState);
    this.tickSnapshots.set(baseTickNumber, baseSnapshot);
    this.tickRuntimeStates.set(
      baseTickNumber,
      cloneSimulationMutableRuntimeState(this.runtimeState, this.debugDataEnabled),
    );
    this.nextTickNumber = baseTickNumber + 1;
    this.retainedFromTick = baseTickNumber;
    this.latestTickNumber = baseTickNumber;
    this.lastRequestedTickNumber = baseTickNumber;
    this.migrationAnchorTickNumber = baseTickNumber;
    this.presentationGeneration = null;
    this.dynamicTickRate = topology.standardTickRate;
    this.standardStepTicks = 1;
    this.lastDynamicRateAdjustmentTick = null;
    this.adjustDynamicTickRateAtLegalPoint(baseTickNumber);
    this.mode = "running";
    this.error = null;

    // 启动停止线：初始预热到 0 + MAX_RETAINED_TICKS。
    // Worker 在后台自主推进，外部拉取时更新停止线，互不阻塞。
    this.stopLineTick = this.nextTickNumber + MAX_RETAINED_TICKS;
    this.scheduleBackgroundFill();

    return {
      status: "started",
      topologyId: topology.topologyId,
      diagnostics: topology.diagnostics,
      runtimeTransition,
    };
  }

  private getTickSnapshot(
    tickNumber: number,
    retainTickNumber?: number,
  ): SimulationTickSnapshotResult {
    if (this.topology === null || this.runtimeState === null) {
      return {
        status: createNotFoundStatus(tickNumber, "missing-topology", null, null, 0),
        currentTick: null,
      };
    }

    this.lastRequestedTickNumber = Math.max(0, Math.trunc(tickNumber));
    this.retainMigrationAnchor(retainTickNumber);

    // 始终更新停止线：外部请求 tick N → Worker 需要跑到 N + MAX_RETAINED_TICKS。
    // 即使当前 tick 未就绪也更新，确保 Worker 知道目标位置。
    this.stopLineTick = Math.max(this.stopLineTick, tickNumber + MAX_RETAINED_TICKS);

    if (this.latestTickNumber === null || tickNumber > this.latestTickNumber) {
      // 未就绪：立即返回，不等。Worker 在后台继续推进。
      this.scheduleBackgroundFill();
      return {
        status: {
          status: "not-ready",
          requestedTickNumber: tickNumber,
          retainedFromTick: this.retainedFromTick,
          latestTickNumber: this.latestTickNumber,
          bufferSize: this.tickSnapshots.size,
        },
        currentTick: null,
      };
    }

    if (this.retainedFromTick !== null && tickNumber < this.retainedFromTick) {
      return {
        status: createNotFoundStatus(
          tickNumber,
          "cleared",
          this.retainedFromTick,
          this.latestTickNumber,
          this.tickSnapshots.size,
        ),
        currentTick: null,
      };
    }

    const currentTick = this.tickSnapshots.get(tickNumber);
    if (currentTick === undefined) {
      return {
        status: createNotFoundStatus(
          tickNumber,
          "unknown",
          this.retainedFromTick,
          this.latestTickNumber,
          this.tickSnapshots.size,
        ),
        currentTick: null,
      };
    }

    for (const retainedTickNumber of [...this.tickSnapshots.keys()]) {
      if (
        retainedTickNumber < tickNumber
        && retainedTickNumber !== this.migrationAnchorTickNumber
      ) {
        this.tickSnapshots.delete(retainedTickNumber);
        this.tickRuntimeStates.delete(retainedTickNumber);
      }
    }
    this.retainedFromTick = [...this.tickSnapshots.keys()]
      .sort((left, right) => left - right)[0] ?? tickNumber;

    // 消费后缓冲区有空位，通知后台填充继续推进到停止线
    this.scheduleBackgroundFill();

    return {
      status: {
        status: "ready",
        retainedFromTick: this.retainedFromTick,
        latestTickNumber: this.latestTickNumber ?? tickNumber,
        bufferSize: this.tickSnapshots.size,
      },
      currentTick: this.debugDataEnabled
        ? this.createDebugSnapshotReadModel(
            currentTick,
            this.tickRuntimeStates.get(tickNumber) ?? this.runtimeState,
          )
        : currentTick,
    };
  }

  /**
   * 只读返回请求区间内从 fromTickNumber 开始的连续前缀。
   * AI-CORRECTION 2026-07-17: 范围预取不再复用 getTickSnapshot 的消费即清理语义；
   * 主线程尚未呈现的 checkpoint 必须保留到 acknowledgePresentedTick。
   */
  private getTickSnapshotRange(
    fromTickNumber: number,
    toTickNumber: number,
    generation: number,
  ): SimulationTickSnapshotRangeResult {
    const normalizedFromTickNumber = Math.max(0, Math.trunc(fromTickNumber));
    const normalizedToTickNumber = Math.max(
      normalizedFromTickNumber,
      Math.trunc(toTickNumber),
    );
    if (this.presentationGeneration === null || generation >= this.presentationGeneration) {
      this.presentationGeneration = generation;
    }

    if (this.topology === null || this.runtimeState === null) {
      return {
        generation,
        fromTickNumber: normalizedFromTickNumber,
        toTickNumber: normalizedToTickNumber,
        status: createNotFoundStatus(
          normalizedFromTickNumber,
          "missing-topology",
          null,
          null,
          0,
        ),
        snapshots: [],
      };
    }

    // AI-CORRECTION 2026-07-17: 预取范围只扩展到请求末端；未来 180 Tick 的停止线由呈现 ACK 推进，
    // 避免每次补充热队列都把计算窗口额外向前平移一个完整缓存长度。
    this.stopLineTick = Math.max(this.stopLineTick, normalizedToTickNumber);

    if (
      this.retainedFromTick !== null
      && normalizedFromTickNumber < this.retainedFromTick
    ) {
      return {
        generation,
        fromTickNumber: normalizedFromTickNumber,
        toTickNumber: normalizedToTickNumber,
        status: createNotFoundStatus(
          normalizedFromTickNumber,
          "cleared",
          this.retainedFromTick,
          this.latestTickNumber,
          this.tickSnapshots.size,
        ),
        snapshots: [],
      };
    }

    if (
      this.latestTickNumber === null
      || normalizedFromTickNumber > this.latestTickNumber
    ) {
      this.scheduleBackgroundFill();
      return {
        generation,
        fromTickNumber: normalizedFromTickNumber,
        toTickNumber: normalizedToTickNumber,
        status: {
          status: "not-ready",
          requestedTickNumber: normalizedFromTickNumber,
          retainedFromTick: this.retainedFromTick,
          latestTickNumber: this.latestTickNumber,
          bufferSize: this.tickSnapshots.size,
        },
        snapshots: [],
      };
    }

    const snapshots: RuntimeTickSnapshot[] = [];
    const availableToTickNumber = Math.min(
      normalizedToTickNumber,
      this.latestTickNumber,
    );
    for (
      let tickNumber = normalizedFromTickNumber;
      tickNumber <= availableToTickNumber;
      tickNumber += 1
    ) {
      const snapshot = this.tickSnapshots.get(tickNumber);
      if (snapshot === undefined) {
        if (snapshots.length === 0) {
          return {
            generation,
            fromTickNumber: normalizedFromTickNumber,
            toTickNumber: normalizedToTickNumber,
            status: createNotFoundStatus(
              normalizedFromTickNumber,
              "unknown",
              this.retainedFromTick,
              this.latestTickNumber,
              this.tickSnapshots.size,
            ),
            snapshots: [],
          };
        }
        break;
      }

      snapshots.push(
        this.debugDataEnabled
          ? this.createDebugSnapshotReadModel(
            snapshot,
            this.tickRuntimeStates.get(tickNumber) ?? this.runtimeState,
          )
          : snapshot,
      );
    }

    this.scheduleBackgroundFill();
    return {
      generation,
      fromTickNumber: normalizedFromTickNumber,
      toTickNumber: normalizedToTickNumber,
      status: {
        status: "ready",
        retainedFromTick: this.retainedFromTick ?? normalizedFromTickNumber,
        latestTickNumber: this.latestTickNumber,
        bufferSize: this.tickSnapshots.size,
      },
      snapshots,
    };
  }

  /** 主线程提交呈现进度后，才允许清理更早的快照与迁移 checkpoint。 */
  private acknowledgePresentedTick(
    tickNumber: number,
    generation: number,
  ): number | null {
    if (
      this.topology === null
      || this.runtimeState === null
      || this.presentationGeneration !== generation
    ) {
      return null;
    }

    const normalizedTickNumber = Math.max(0, Math.trunc(tickNumber));
    if (
      normalizedTickNumber < this.lastRequestedTickNumber
      || !this.tickRuntimeStates.has(normalizedTickNumber)
      || !this.tickSnapshots.has(normalizedTickNumber)
    ) {
      return null;
    }

    this.lastRequestedTickNumber = normalizedTickNumber;
    this.migrationAnchorTickNumber = normalizedTickNumber;
    for (const retainedTickNumber of [...this.tickSnapshots.keys()]) {
      if (retainedTickNumber < normalizedTickNumber) {
        this.tickSnapshots.delete(retainedTickNumber);
        this.tickRuntimeStates.delete(retainedTickNumber);
      }
    }
    this.retainedFromTick = [...this.tickSnapshots.keys()]
      .sort((left, right) => left - right)[0] ?? normalizedTickNumber;

    // AI-CORRECTION 2026-07-17: 正常播放停止线改由已呈现 Tick 推进；范围预取本身不改变消费锚点。
    this.stopLineTick = Math.max(
      this.stopLineTick,
      normalizedTickNumber + MAX_RETAINED_TICKS,
    );
    this.scheduleBackgroundFill();
    return normalizedTickNumber;
  }

  private createDebugSnapshotReadModel(
    snapshot: RuntimeTickSnapshot,
    runtimeState: SimulationMutableRuntimeState,
  ): RuntimeTickSnapshot {
    if (this.topology === null) {
      return snapshot;
    }

    return {
      ...snapshot,
      debugData: createTickDebugData({
        topology: this.topology,
        runtimeState,
        snapshot,
        workerRuntime: {
          nextTickNumber: this.nextTickNumber,
          retainedFromTick: this.retainedFromTick,
          latestTickNumber: this.latestTickNumber,
          mode: this.mode,
          error: this.error,
          simulationSpeed: this.simulationSpeed,
          dynamicTickRate: this.dynamicTickRate,
          standardStepTicks: this.standardStepTicks,
          fixedDynamicTickRate: this.fixedDynamicTickRate,
          lastRequestedTickNumber: this.lastRequestedTickNumber,
          migrationAnchorTickNumber: this.migrationAnchorTickNumber,
          lastDynamicRateAdjustmentTick: this.lastDynamicRateAdjustmentTick,
          powerMode: this.powerMode,
          powerConsumptionOverride: this.powerConsumptionOverride ?? null,
          effectiveTotalPowerDemand: this.effectiveTotalPowerDemand,
          stopLineTick: this.stopLineTick,
          fillScheduled: this.fillTimerId !== null,
          perfEnabled: this.perfEnabled,
          debugDataEnabled: this.debugDataEnabled,
          perfEntries: this.perfEntries,
          maxRetainedTicks: MAX_RETAINED_TICKS,
          cachedTickSnapshotNumbers: [...this.tickSnapshots.keys()].sort((left, right) => left - right),
          cachedRuntimeStateTickNumbers: [...this.tickRuntimeStates.keys()].sort((left, right) => left - right),
          errorCallbackRegistered: this.onError !== null,
        },
      }),
    };
  }

  private retainMigrationAnchor(retainTickNumber: number | undefined): void {
    if (retainTickNumber === undefined) {
      return;
    }

    const normalizedTickNumber = Math.max(0, Math.trunc(retainTickNumber));
    if (
      this.tickRuntimeStates.has(normalizedTickNumber)
      || this.runtimeState?.tickNumber === normalizedTickNumber
    ) {
      this.migrationAnchorTickNumber = normalizedTickNumber;
    }
  }

  /**
   * 后台自主填充循环：每次 setTimeout(0) 推进一个 tick，到停止线自动停。
   * 与外部 getTickSnapshot 完全解耦 — 外部拉取不触发推进，只更新停止线。
   */
  private scheduleBackgroundFill(): void {
    if (this.regionalRuntimeMode) return;
    // 已有定时器在排队
    if (this.fillTimerId !== null) return;
    // 已达停止线，无需推进
    if (this.nextTickNumber > this.stopLineTick) return;
    // 未初始化
    if (this.topology === null || this.runtimeState === null) return;

    this.fillTimerId = setTimeout(() => this.fillOneTick(), 0);
  }

  /**
   * 设置电力模式。不触发拓扑重编译，仅影响后续 tick 的门控行为。
   * 拓扑不变、持久运行时状态不变（设备/配方/电池均保留）。
   * 已缓存但尚未计算的未来 tick 作废，从下一个 tick 起按新模式重新推进。
   */
  public setPowerMode(powerMode: "real" | "infinite"): void {
    if (this.powerMode === powerMode) return;
    this.powerMode = powerMode;
    this.invalidateFrom(this.nextTickNumber);
  }

  /**
   * 设置手动覆盖总耗电（kW）。undefined = 清除覆盖，按编译期真实值。
   * 不触发拓扑重编译，仅影响后续 tick 的有效耗电计算。
   */
  public setPowerConsumptionOverride(powerConsumptionOverride: number | undefined): void {
    if (this.powerConsumptionOverride === powerConsumptionOverride) return;
    this.powerConsumptionOverride = powerConsumptionOverride;
    this.invalidateFrom(this.nextTickNumber);
  }

  /** 考虑手动覆盖后的有效总耗电。 */
  private get effectiveTotalPowerDemand(): number {
    const override = this.powerConsumptionOverride;
    if (typeof override === "number" && Number.isFinite(override) && override >= 0) {
      return override;
    }
    return this.topology?.totalPowerDemand ?? 0;
  }

  /**
   * 同步推进到目标 tick（Local 模式专用）。
   * 在没有事件循环的环境（测试/CLI）中，setTimeout 无法触发后台填充，
   * 需要调用方在 getTickSnapshot 前显式推进。
   * Browser 模式（Web Worker）不应调用此方法，依赖 setTimeout 解耦推进。
   */
  public advanceToTick(targetTickNumber: number): void {
    if (this.topology === null || this.runtimeState === null) return;

    // 更新停止线，确保推进目标被覆盖
    this.stopLineTick = Math.max(this.stopLineTick, targetTickNumber + MAX_RETAINED_TICKS);

    while (this.nextTickNumber <= targetTickNumber) {
      try {
        const currentTick = this.createNextTickSnapshot(this.nextTickNumber);
        this.tickSnapshots.set(this.nextTickNumber, currentTick);
        this.tickRuntimeStates.set(
          this.nextTickNumber,
          cloneSimulationMutableRuntimeState(this.runtimeState, this.debugDataEnabled),
        );
        this.latestTickNumber = this.nextTickNumber;
        this.retainedFromTick = Math.min(
          this.retainedFromTick ?? this.nextTickNumber,
          this.nextTickNumber,
        );
        this.nextTickNumber += 1;
      } catch (error) {
        this.mode = "error";
        this.error = error instanceof Error ? error.message : String(error);
        this.onError?.(this.error, this.nextTickNumber);
        return;
      }
    }
  }

  // === 区域多基地模式 ===

  /**
   * 加载一个基地的区域 Runtime。Authority 协议由 Worker 外部的区域会话驱动；
   * 本类只负责把 Stage 3 停在区域仓库门禁前、应用 grant，并生成该基地结果。
   */
  public loadRegionalTopology(options: {
    readonly topology: CompiledSimulationTopology;
    readonly baseId: string;
    readonly table: RegionalWarehouseOutletTable;
    readonly initialWarehouseCounts: Readonly<Record<string, number>>;
    readonly expectedBaseIds?: readonly string[];
    readonly fixedDynamicTickRate?: number;
    readonly advanceMode: "per-tick" | "coarse";
    readonly simulationSpeed?: number;
    readonly powerMode?: "real" | "infinite";
    readonly powerConsumptionOverride?: number;
  }): SimulationStartResult {
    if (options.topology.simulationMode !== SIMULATION_MODE.regionalMultiBase) {
      return {
        status: "failed",
        topologyId: options.topology.topologyId,
        diagnostics: options.topology.diagnostics,
        error: `Regional worker requires topology mode "${SIMULATION_MODE.regionalMultiBase}".`,
      };
    }
    this.regionalGate = createBaseRegionalGate({
      baseId: options.baseId,
      table: options.table,
      topology: options.topology,
    });
    this.regionalTable = options.table;
    this.regionalExpectedBaseIds = options.expectedBaseIds ?? [options.baseId];
    this.regionalAuthorityState = {
      warehouseVersion: 0,
      warehouseCounts: { ...options.initialWarehouseCounts },
      cursorByItemId: {},
    };
    this.regionalActiveArbitration = null;
    this.regionalSnapshotCursor = 0;
    this.pendingRegionalDemand = [];
    this.regionalGatePausedTick = null;
    this.regionalRuntimeMode = true;
    this.regionalAdvancePerTick = options.advanceMode === "per-tick";
    if (options.fixedDynamicTickRate !== undefined) {
      this.fixedDynamicTickRate = options.fixedDynamicTickRate;
    }
    if (options.simulationSpeed !== undefined) {
      this.simulationSpeed = options.simulationSpeed;
    }
    if (options.powerMode !== undefined) {
      this.powerMode = options.powerMode;
    }
    if (options.powerConsumptionOverride !== undefined) {
      this.powerConsumptionOverride = options.powerConsumptionOverride;
    }

    const result = this.loadTopology(
      options.topology,
      undefined,
      SIMULATION_MODE.regionalMultiBase,
    );
    if (result.status === "started" && this.runtimeState !== null && this.regionalGate !== null) {
      this.regionalGate.setWarehouseProjection(this.runtimeState, options.initialWarehouseCounts);
    }
    return result;
  }

  /**
   * 推进到 Epoch E 的门禁 tick 并冻结精确 demand。
   * 后台 coarse 模式直接跨 10 个标准 tick；前台 per-tick 模式保留中间快照。
   */
  public prepareRegionalEpochDemand(epochNumber: number): {
    readonly tickNumber: number;
    readonly demandedOutletIds: readonly string[];
  } {
    if (this.regionalGate === null || this.topology === null || this.runtimeState === null) {
      throw new Error("Regional runtime is not initialized.");
    }
    if (this.regionalGatePausedTick !== null) {
      throw new Error(`Regional gate already paused at tick ${this.regionalGatePausedTick}.`);
    }

    const gateTick = resolveRegionalEpochGateTick(epochNumber);
    if (gateTick < this.nextTickNumber) {
      throw new Error(`Regional epoch ${epochNumber} gate tick ${gateTick} has already been passed.`);
    }

    if (this.regionalAdvancePerTick) {
      while (this.nextTickNumber < gateTick) {
        const tickNumber = this.nextTickNumber;
        const snapshot = this.createNextTickSnapshot(tickNumber);
        this.cacheComputedTick(tickNumber, snapshot);
      }
    } else {
      // 后台粗步长：中间标准 tick 不生成展示快照，直接由门禁 tick 覆盖整段 10 tick。
      if (this.nextTickNumber < gateTick) {
        this.nextTickNumber = gateTick;
      }
    }

    return this.runRegionalGateStage3A(gateTick, epochNumber);
  }

  /**
   * 应用 grant、完成 Stage 4/5、封存 deposits，并把仓库投影更新为 W(E+1)。
   */
  public applyRegionalEpochGrant(options: {
    readonly epochNumber: number;
    readonly grantedOutletIds: readonly string[];
  }): {
    readonly tickNumber: number;
    readonly deposits: readonly { readonly itemId: string; readonly amount: number }[];
  } {
    if (this.regionalGate === null || this.topology === null || this.runtimeState === null) {
      throw new Error("Regional runtime is not initialized.");
    }
    const gateTick = resolveRegionalEpochGateTick(options.epochNumber);
    if (this.regionalGatePausedTick !== gateTick || this.runtimeState.tickNumber !== gateTick) {
      throw new Error(`Regional gate is not paused at epoch ${options.epochNumber}.`);
    }

    const tickNumber = gateTick;
    this.regionalGate.applyGrantBatch(this.registry, this.runtimeState, options.grantedOutletIds);
    rotateRoutingCursors(
      this.topology,
      this.runtimeState,
      this.regionalGate.createStage3Options().excludedEdgeIds,
    );
    settleRecipes(
      this.registry,
      this.topology,
      this.runtimeState,
      this.powerMode,
      this.regionalGateCurrentPowerGeneration,
      this.effectiveTotalPowerDemand,
      this.regionalGateStage1AdvanceResult,
      this.regionalGate.writeContext,
    );
    applyBlockageAutoClearance(this.topology, this.runtimeState);
    maintainTransportComponentDomains(this.topology, this.runtimeState);
    this.runtimeState.lastAdvancedTickNumber = tickNumber;

    rollRecipeStatsWindow(
      this.runtimeState.persistent.recipeStats,
      this.runtimeState.transient.recipeStatsDelta,
      tickNumber,
      tickNumber - this.regionalGateLastAdvancedTickNumber,
      resolveDynamicTickRateSwitchIntervalTicks(this.registry, this.topology),
    );
    this.runtimeState.transient.recipeStatsDelta = createEmptyTransientState().recipeStatsDelta;

    const deposits = this.regionalGate.takeDeposits();
    return { tickNumber, deposits };
  }

  /**
   * Authority 提交后，把 W(E+1) 写入本地只读投影并生成本基地边界结果。
   */
  public finalizeRegionalEpoch(options: {
    readonly epochNumber: number;
    readonly nextWarehouseCounts: Readonly<Record<string, number>>;
    readonly includeSnapshot: boolean;
    readonly retainSnapshot?: boolean;
  }): {
    readonly tickNumber: number;
    readonly snapshot: RuntimeTickSnapshot | null;
  } {
    if (this.regionalGate === null || this.topology === null || this.runtimeState === null) {
      throw new Error("Regional runtime is not initialized.");
    }
    const gateTick = resolveRegionalEpochGateTick(options.epochNumber);
    if (this.regionalGatePausedTick !== gateTick || this.runtimeState.tickNumber !== gateTick) {
      throw new Error(`Regional gate is not paused at epoch ${options.epochNumber}.`);
    }

    this.regionalGate.setWarehouseProjection(this.runtimeState, options.nextWarehouseCounts);
    const snapshot = options.includeSnapshot
      ? createTickSnapshot(
          this.topology,
          this.runtimeState,
          this.regionalGatePowerOutage,
          this.regionalGateCurrentPowerGeneration,
        )
      : null;
    if (snapshot !== null && options.retainSnapshot !== false) {
      this.cacheComputedTick(gateTick, snapshot);
    } else {
      // 后台基地不保留边界展示快照，但仍推进到 gate tick 之后。
      this.latestTickNumber = gateTick;
      this.retainedFromTick = Math.min(this.retainedFromTick ?? gateTick, gateTick);
      this.nextTickNumber = gateTick + 1;
    }
    this.regionalGatePausedTick = null;
    this.pendingRegionalDemand = [];
    this.regionalGateStage1AdvanceResult = undefined;
    if (snapshot !== null) {
      this.adjustDynamicTickRateAtLegalPoint(gateTick);
    }
    return { tickNumber: gateTick, snapshot };
  }

  public arbitrateRegionalEpoch(
    epochNumber: number,
    demands: readonly RegionWarehouseDemandBatch[],
  ): RegionWarehouseArbitrationResult {
    if (this.regionalTable === null || this.regionalAuthorityState === null) {
      throw new Error("Regional authority is not initialized.");
    }
    const arbitration = arbitrateRegionalWarehouseEpoch({
      sessionId: demands[0]?.sessionId ?? "regional-session",
      epochNumber,
      table: this.regionalTable,
      state: this.regionalAuthorityState,
      demands,
    });
    this.regionalActiveArbitration = arbitration;
    return arbitration;
  }

  public commitRegionalEpoch(
    epochNumber: number,
    acks: readonly RegionWarehouseAckBatch[],
  ): RegionWarehouseCommitProposal {
    if (
      this.regionalTable === null
      || this.regionalAuthorityState === null
      || this.regionalActiveArbitration === null
    ) {
      throw new Error("Regional authority has no active arbitration.");
    }
    const proposal = commitRegionalWarehouseEpoch({
      sessionId: acks[0]?.sessionId ?? "regional-session",
      epochNumber,
      table: this.regionalTable,
      state: this.regionalAuthorityState,
      expectedBaseIds: this.regionalExpectedBaseIds,
      arbitration: this.regionalActiveArbitration,
      acks,
    });
    this.regionalAuthorityState = {
      warehouseVersion: proposal.nextWarehouseVersion,
      warehouseCounts: proposal.warehouseCounts,
      cursorByItemId: proposal.cursorByItemId,
    };
    this.regionalActiveArbitration = null;
    // AI-CORRECTION 2026-08-17: 不再在 commit 时重置 regionalSnapshotCursor。
    // Trigger: 区域会话运行约 24 个 Epoch 后主线程播放死锁（PlaybackDiag notReady=100%、buff 恒定）。
    // Evidence: DEBUG-TRACE 显示 enqueue 每次塞入 count=231 的全量历史快照，导致 playbackHotQueue
    //   size 恒 ≥ 180，runRegionalSessionLoop 的背压检查永久冻结，播放等待 232+ 快照永不满足。
    // Replacement: cursor 由 takeRegionalSnapshots 尾部推进（latestTickNumber + 1），保持增量返回。
    // Risk: 若 authority 需重放历史快照，应在 loadRegionalTopology 处显式重置。
    // Human Review: Required
    return proposal;
  }

  public takeRegionalSnapshots(): readonly RuntimeTickSnapshot[] {
    if (this.regionalRuntimeMode === false) {
      return [];
    }
    const snapshots = [...this.tickSnapshots.entries()]
      .filter(([tickNumber]) => tickNumber >= this.regionalSnapshotCursor)
      .sort(([left], [right]) => left - right)
      .map(([, snapshot]) => snapshot);
    this.regionalSnapshotCursor = (this.latestTickNumber ?? 0) + 1;

    // AI-CORRECTION 2026-08-21: 区域快照被主线程取走后，淘汰旧快照与旧运行态，只保留最新迁移锚点。
    // Trigger: 四个武陵基地持续运行至约 tick 4811 后，Worker 因全量历史状态常驻而停止产出。
    // Evidence: 区域模式不走 acknowledgePresentedTick；原实现仅推进 cursor，tickSnapshots/tickRuntimeStates 永不删除。
    // Risk: 最新锚点之前的区域 Worker 内部状态不再可供历史回放；主线程已持有对应展示快照。
    const retainedAnchorTickNumber = this.latestTickNumber;
    for (const tickNumber of [...this.tickSnapshots.keys()]) {
      if (tickNumber !== retainedAnchorTickNumber) {
        this.tickSnapshots.delete(tickNumber);
      }
    }
    for (const tickNumber of [...this.tickRuntimeStates.keys()]) {
      if (tickNumber !== retainedAnchorTickNumber) {
        this.tickRuntimeStates.delete(tickNumber);
      }
    }
    this.retainedFromTick = retainedAnchorTickNumber;
    return snapshots;
  }

  private runRegionalGateStage3A(tickNumber: number, epochNumber: number): {
    readonly tickNumber: number;
    readonly demandedOutletIds: readonly string[];
  } {
    const topology = this.topology;
    const state = this.runtimeState;
    const gate = this.regionalGate;
    if (topology === null || state === null || gate === null) {
      throw new Error("Regional runtime is not initialized.");
    }

    const shouldAdvance = tickNumber > state.tickNumber;
    if (!shouldAdvance) {
      throw new Error(`Regional gate tick ${tickNumber} is not in the future.`);
    }
    state.tickNumber = tickNumber;
    normalizeFixedWindowCountersForCurrentWindow(topology, state);
    const runtimeStepTicks = tickNumber - state.lastAdvancedTickNumber;
    this.regionalGateLastAdvancedTickNumber = state.lastAdvancedTickNumber;

    const currentPowerGeneration = computeCurrentPowerGeneration(this.registry, state);
    let effectiveGeneration = currentPowerGeneration;
    if (this.powerMode === "real") {
      const netPowerKW = currentPowerGeneration - this.effectiveTotalPowerDemand;
      const joulesPerStandardTick = 1000 / topology.standardTickRate;
      const netJoules = netPowerKW * joulesPerStandardTick * runtimeStepTicks;
      if (netJoules > 0) {
        state.persistent.baseBatteryJoules = Math.min(
          BASE_BATTERY_CAPACITY_J,
          state.persistent.baseBatteryJoules + netJoules,
        );
      } else if (netJoules < 0) {
        const deficit = -netJoules;
        if (state.persistent.baseBatteryJoules >= deficit) {
          state.persistent.baseBatteryJoules -= deficit;
          effectiveGeneration = this.effectiveTotalPowerDemand;
        } else {
          state.persistent.baseBatteryJoules = 0;
        }
      }
    }

    const isPowerOutageRun = this.powerMode === "real"
      && effectiveGeneration < this.effectiveTotalPowerDemand;
    state.transient.isPowerOutage = isPowerOutageRun;
    state.transient.reservedAmountByStorageSlotId = null;
    state.transient.activeConsumptionDeviceIds =
      computeActiveConsumptionDeviceIds(topology, state);
    state.transient.activeGasDiffusions = computeActiveGasDiffusions(
      this.registry,
      topology,
      state,
    );
    rebuildExcludedItemTypesForTick(topology, state);

    const stage1AdvanceResult = advanceDevices(
      this.registry,
      topology,
      state,
      runtimeStepTicks,
      this.powerMode,
      effectiveGeneration,
      this.effectiveTotalPowerDemand,
      gate.writeContext,
    );
    applyWaterPurifierManualOutput(
      this.registry,
      topology,
      state,
      runtimeStepTicks,
      this.powerMode,
      effectiveGeneration,
      this.effectiveTotalPowerDemand,
    );
    buildSolveGraph(topology, state);
    solveTransferGraph(
      this.registry,
      topology,
      state,
      undefined,
      gate.createStage3Options(),
    );

    this.regionalGateCurrentPowerGeneration = currentPowerGeneration;
    this.regionalGatePowerOutage = isPowerOutageRun;
    this.regionalGateStage1AdvanceResult = stage1AdvanceResult;
    this.regionalGatePausedTick = tickNumber;
    this.pendingRegionalDemand = gate.collectDemandBatch(this.registry, state, epochNumber);
    return {
      tickNumber,
      demandedOutletIds: this.pendingRegionalDemand,
    };
  }

  private cacheComputedTick(tickNumber: number, snapshot: RuntimeTickSnapshot): void {
    if (this.runtimeState === null) {
      return;
    }
    this.tickSnapshots.set(tickNumber, snapshot);
    this.tickRuntimeStates.set(
      tickNumber,
      cloneSimulationMutableRuntimeState(this.runtimeState, this.debugDataEnabled),
    );
    this.latestTickNumber = tickNumber;
    this.retainedFromTick = Math.min(
      this.retainedFromTick ?? tickNumber,
      tickNumber,
    );
    this.nextTickNumber = tickNumber + 1;
  }

  private fillOneTick(): void {
    this.fillTimerId = null;

    if (this.topology === null || this.runtimeState === null) return;

    // 检查是否已达停止线
    if (this.nextTickNumber > this.stopLineTick) return;

    try {
      const currentTick = this.createNextTickSnapshot(this.nextTickNumber);
      this.tickSnapshots.set(this.nextTickNumber, currentTick);
      this.tickRuntimeStates.set(
        this.nextTickNumber,
        cloneSimulationMutableRuntimeState(this.runtimeState, this.debugDataEnabled),
      );
      this.latestTickNumber = this.nextTickNumber;
      this.retainedFromTick = Math.min(
        this.retainedFromTick ?? this.nextTickNumber,
        this.nextTickNumber,
      );
      this.nextTickNumber += 1;
    } catch (error) {
      this.mode = "error";
      this.error = error instanceof Error ? error.message : String(error);
      console.error(`[SimWorker] fillOneTick failed at tick ${this.nextTickNumber}:`, this.error);
      this.onError?.(this.error, this.nextTickNumber);
      return; // 出错后停止填充
    }

    // 未到停止线则继续调度下一 tick
    if (this.nextTickNumber <= this.stopLineTick) {
      this.fillTimerId = setTimeout(() => this.fillOneTick(), 0);
    }
  }

  /**
   * 根据发电量和电池缓冲计算当前 tick 是否停电。
   * 非运行时 tick 中不消耗电池，仅用于正确展示。
   */
  private resolveTickPowerOutage(currentPowerGeneration: number): boolean {
    return computeEffectivePowerState(
      this.powerMode,
      currentPowerGeneration,
      this.effectiveTotalPowerDemand,
      this.runtimeState?.persistent.baseBatteryJoules ?? 0,
    );
  }

  private createNextTickSnapshot(tickNumber: number): RuntimeTickSnapshot {
    if (this.topology === null || this.runtimeState === null) {
      throw new Error("Simulation runtime is not initialized.");
    }

    if (tickNumber < this.runtimeState.tickNumber) {
      throw new Error(`Cannot rewind simulation runtime from tick ${this.runtimeState.tickNumber} to ${tickNumber}.`);
    }

    const shouldAdvance = tickNumber > this.runtimeState.tickNumber;
    this.runtimeState.tickNumber = tickNumber;
    normalizeFixedWindowCountersForCurrentWindow(this.topology, this.runtimeState);
    const runtimeStepTicks = tickNumber - this.runtimeState.lastAdvancedTickNumber;
    // AI-CORRECTION 2026-07-17: 动态帧率与严格物流统一以 tick 1 为相位原点。
    // 粗步长 10 必须在 1、11、21... 执行；否则从时间轴 tick 301 导入后会在 311、321...
    // 运行仿真，却因严格物流仍等待 10、20... 相位而永久停止交付。
    const isDynamicStepBoundary = (tickNumber - 1) % this.standardStepTicks === 0;
    const shouldRunRuntime = shouldAdvance && isDynamicStepBoundary;
    // AI-REMOVED 2026-07-17:
    // Reason: 仅按 lastAdvancedTickNumber 累计步长会把动态帧率固定在 tick 0 相位。
    // Trigger: 严格物流相位改为 tick 1 后，正常动态帧率与时间轴粗步长必须使用同一相位原点。
    // Evidence: step=10、导入 tick 301 时目标运行帧应为 311；旧判断无法表达全局相位。
    // Replacement: 使用 (tickNumber - 1) % standardStepTicks === 0 判断动态运行帧。
    // Risk: 动态帧率切换后的首个区间可能短于完整步长，runtimeStepTicks 会传递真实区间长度。
    // Human Review: Required
    //
    // Original code:
    // const shouldRunRuntime = shouldAdvance && runtimeStepTicks >= this.standardStepTicks;

    const perfTiming = this.perfEnabled ? {
      tickNumber,
      start: performance.now(),
      stages: {} as Record<string, number>,
      stage3: undefined as TickPerfStage3Details | undefined,
      hotPath: undefined as TickPerfHotPathDetails | undefined,
    } : null;

    if (shouldAdvance && !shouldRunRuntime) {
      // 非运行时 tick：仿真未推进，但需正确反映当前电力状态（含电池缓冲）
      const currentPowerGeneration = computeCurrentPowerGeneration(this.registry, this.runtimeState);
      const isPowerOutage = this.resolveTickPowerOutage(currentPowerGeneration);
      this.runtimeState.transient = createEmptyTransientState();
      this.runtimeState.transient.isPowerOutage = isPowerOutage;
      this.runtimeState.transient.activeConsumptionDeviceIds =
        computeActiveConsumptionDeviceIds(this.topology, this.runtimeState);
      this.runtimeState.transient.activeGasDiffusions = computeActiveGasDiffusions(
        this.registry,
        this.topology,
        this.runtimeState,
      );
      const t0 = this.perfEnabled ? performance.now() : 0;
      const snapshot = createTickSnapshot(this.topology, this.runtimeState, isPowerOutage, currentPowerGeneration);
      if (this.perfEnabled) {
        perfTiming!.stages["createSnapshot"] = performance.now() - t0;
        this.perfEntries.push({
          tickNumber,
          totalMs: performance.now() - perfTiming!.start,
          stages: {
            advanceDevices: 0,
            buildSolveGraph: 0,
            solveTransferGraph: 0,
            rotateRoutingCursors: 0,
            settleRecipes: 0,
            maintainDomains: 0,
            createSnapshot: perfTiming!.stages["createSnapshot"] ?? 0,
          },
        });
      }
      this.adjustDynamicTickRateAtLegalPoint(tickNumber);
      return snapshot;
    }

    if (shouldRunRuntime) {
      // 在 Stage 1 之前计算动态发电量
      const currentPowerGeneration = computeCurrentPowerGeneration(
        this.registry,
        this.runtimeState,
      );

      // 真实电力模式下更新基地电池，并计算计入电池补足后的有效发电量
      let effectiveGeneration = currentPowerGeneration;
      if (this.powerMode === "real") {
        const netPowerKW = currentPowerGeneration - this.effectiveTotalPowerDemand;
        const joulesPerStandardTick = 1000 / this.topology.standardTickRate;
        const netJoules = netPowerKW * joulesPerStandardTick * runtimeStepTicks;
        if (netJoules > 0) {
          this.runtimeState.persistent.baseBatteryJoules = Math.min(
            BASE_BATTERY_CAPACITY_J,
            this.runtimeState.persistent.baseBatteryJoules + netJoules,
          );
        } else if (netJoules < 0) {
          const deficit = -netJoules;
          if (this.runtimeState.persistent.baseBatteryJoules >= deficit) {
            this.runtimeState.persistent.baseBatteryJoules -= deficit;
            effectiveGeneration = this.effectiveTotalPowerDemand; // 电池补足差额，视为电力充足
          } else {
            this.runtimeState.persistent.baseBatteryJoules = 0;
          }
        }
      }

      const isPowerOutageRun = this.powerMode === "real"
        && effectiveGeneration < this.effectiveTotalPowerDemand;
      this.runtimeState.transient.isPowerOutage = isPowerOutageRun;
      this.runtimeState.transient.reservedAmountByStorageSlotId = null;
      this.runtimeState.transient.activeConsumptionDeviceIds =
        computeActiveConsumptionDeviceIds(this.topology, this.runtimeState);
      this.runtimeState.transient.activeGasDiffusions = computeActiveGasDiffusions(
        this.registry,
        this.topology,
        this.runtimeState,
      );
      if (this.perfEnabled) {
        this.runtimeState.transient._perf = createRuntimePerfCounters();
      }

      // AI-CORRECTION 2026-07-31: 在 tick 开头统一重建 excludedItemTypes 快照，
      // 写入 transient.nodes。Stage 1 通过 finishRecipeIfPossible → createSlotOverlayState → 
      // findInputSlotForItem 可安全读取基于当前库存的正确值，无需每次配方完成时全拓扑扫描。
      rebuildExcludedItemTypesForTick(this.topology, this.runtimeState);
      applySingleBaseRegionalResourceSupply(this.topology, this.runtimeState);

      const t0 = this.perfEnabled ? performance.now() : 0;
      const stage1AdvanceResult = advanceDevices(
        this.registry,
        this.topology,
        this.runtimeState,
        runtimeStepTicks,
        this.powerMode,
        effectiveGeneration,
        this.effectiveTotalPowerDemand,
      );
      // AI-REMOVED 2026-07-23:
      // Reason: Stage1 结果是 advanceDevices 的返回值，不能作为尚未初始化的实参传入自身调用。
      // Trigger: 接入 Stage1 → Stage5 溢出交接时首次装配位置错误。
      // Evidence: TypeScript 会报告 stage1AdvanceResult 在声明前被使用。
      // Replacement: 下方 settleRecipes 的最后一个参数。
      // Risk: Low
      // Human Review: Required
      //
      // Original code:
      // stage1AdvanceResult,
      applyWaterPurifierManualOutput(
        this.registry,
        this.topology,
        this.runtimeState,
        runtimeStepTicks,
        this.powerMode,
        effectiveGeneration,
        this.effectiveTotalPowerDemand,
      );
      if (this.perfEnabled) { perfTiming!.stages["advanceDevices"] = performance.now() - t0; }

      const t1 = this.perfEnabled ? performance.now() : 0;
      buildSolveGraph(this.topology, this.runtimeState);
      if (this.perfEnabled) { perfTiming!.stages["buildSolveGraph"] = performance.now() - t1; }

      const t2 = this.perfEnabled ? performance.now() : 0;
      const stage3Perf: SolveTransferGraphPerf | undefined = this.perfEnabled
        ? { layerCount: 0, anchorCount: 0, outputNodeCount: 0, moveCount: 0, refreshBlockedMs: 0, refreshBlockedCalls: 0 }
        : undefined;
      solveTransferGraph(this.registry, this.topology, this.runtimeState, stage3Perf);
      if (this.perfEnabled) {
        perfTiming!.stages["solveTransferGraph"] = performance.now() - t2;
        const p = this.runtimeState.transient._perf!;
        perfTiming!.stage3 = {
          layerCount: stage3Perf!.layerCount,
          anchorCount: stage3Perf!.anchorCount,
          outputNodeCount: stage3Perf!.outputNodeCount,
          moveCount: stage3Perf!.moveCount,
          refreshBlockedMs: Math.round(stage3Perf!.refreshBlockedMs * 100) / 100,
          refreshBlockedCalls: stage3Perf!.refreshBlockedCalls,
          getReservedCalls: p.getReservedCalls,
          canOutputProvideCalls: p.canOutputProvideCalls,
          findInputSlotCalls: p.findInputSlotCalls,
          getRemainingCapacityCalls: p.getRemainingCapacityCalls,
          selectSourceCalls: p.selectSourceCalls,
          solveOutputEdgeChecks: p.solveOutputEdgeChecks,
        };
      }

      // AI-REMOVED 2026-06-06:
      // Reason: tick 末尾全局 submitMode 扫描会误消费所有旧 every-tick slot 配置。
      // Trigger: 用户要求 submit mode 机制彻底删除，未来都用 warehouse sink 或配方交货。
      // Evidence: RUN_ID 20260606-041337-509040 的 premium-capsule-line / wuling-battery-line 目标箱同 tick 被提交到仓库。
      // Replacement: WarehouseSink 动态入仓在 Stage 3 moveOneItem 路径内完成；协议存储箱提交由 r_warehouse_submit 驱动。
      // Risk: Medium - 依赖旧 submitMode 的蓝图需要通过迁移器转为 channelRecipes。
      // Human Review: Required
      //
      // Original code:
      // submitSlotsBySubmitMode(this.topology, this.runtimeState);

      const t3 = this.perfEnabled ? performance.now() : 0;
      rotateRoutingCursors(this.topology, this.runtimeState);
      if (this.perfEnabled) { perfTiming!.stages["rotateRoutingCursors"] = performance.now() - t3; }

      const t4 = this.perfEnabled ? performance.now() : 0;
      settleRecipes(
        this.registry,
        this.topology,
        this.runtimeState,
        this.powerMode,
        effectiveGeneration,
        this.effectiveTotalPowerDemand,
        stage1AdvanceResult,
      );
      applyBlockageAutoClearance(this.topology, this.runtimeState);
      if (this.perfEnabled) {
        perfTiming!.stages["settleRecipes"] = performance.now() - t4;
        perfTiming!.hotPath = createHotPathPerfDetails(this.runtimeState.transient._perf!);
        delete this.runtimeState.transient._perf;
      }

      const t5 = this.perfEnabled ? performance.now() : 0;
      maintainTransportComponentDomains(this.topology, this.runtimeState);
      if (this.perfEnabled) { perfTiming!.stages["maintainDomains"] = performance.now() - t5; }
      this.runtimeState.lastAdvancedTickNumber = tickNumber;

      // 将当前 tick 的配方统计增量滚入 1 分钟滑动窗口
      rollRecipeStatsWindow(
        this.runtimeState.persistent.recipeStats,
        this.runtimeState.transient.recipeStatsDelta,
        tickNumber,
        runtimeStepTicks,
        resolveDynamicTickRateSwitchIntervalTicks(this.registry, this.topology),
      );
      this.runtimeState.transient.recipeStatsDelta = createEmptyTransientState().recipeStatsDelta;

      const t6 = this.perfEnabled ? performance.now() : 0;
      const snapshot = createTickSnapshot(this.topology, this.runtimeState, isPowerOutageRun, currentPowerGeneration);
      if (this.perfEnabled) {
        perfTiming!.stages["createSnapshot"] = performance.now() - t6;
        const total = performance.now() - perfTiming!.start;
        this.perfEntries.push({
          tickNumber,
          totalMs: total,
          stages: {
            advanceDevices: perfTiming!.stages["advanceDevices"] ?? 0,
            buildSolveGraph: perfTiming!.stages["buildSolveGraph"] ?? 0,
            solveTransferGraph: perfTiming!.stages["solveTransferGraph"] ?? 0,
            rotateRoutingCursors: perfTiming!.stages["rotateRoutingCursors"] ?? 0,
            settleRecipes: perfTiming!.stages["settleRecipes"] ?? 0,
            maintainDomains: perfTiming!.stages["maintainDomains"] ?? 0,
            createSnapshot: perfTiming!.stages["createSnapshot"] ?? 0,
          },
          stage3: perfTiming!.stage3,
          hotPath: perfTiming!.hotPath,
        });
      }
      this.adjustDynamicTickRateAtLegalPoint(tickNumber);
      return snapshot;
    }

    // tick-0 或未推进 tick：只走 buildSolveGraph + createSnapshot
    const t0 = this.perfEnabled ? performance.now() : 0;
    buildSolveGraph(this.topology, this.runtimeState);
    if (this.perfEnabled) { perfTiming!.stages["buildSolveGraph"] = performance.now() - t0; }

    const currentPowerGenForSnapshot = computeCurrentPowerGeneration(this.registry, this.runtimeState);
    const isPowerOutageForSnapshot = this.resolveTickPowerOutage(currentPowerGenForSnapshot);
    this.runtimeState.transient.isPowerOutage = isPowerOutageForSnapshot;
    this.runtimeState.transient.activeConsumptionDeviceIds =
      computeActiveConsumptionDeviceIds(this.topology, this.runtimeState);
    this.runtimeState.transient.activeGasDiffusions = computeActiveGasDiffusions(
      this.registry,
      this.topology,
      this.runtimeState,
    );

    const t1 = this.perfEnabled ? performance.now() : 0;
    const snapshot = createTickSnapshot(this.topology, this.runtimeState, isPowerOutageForSnapshot, currentPowerGenForSnapshot);
    if (this.perfEnabled) {
      perfTiming!.stages["createSnapshot"] = performance.now() - t1;
      const total = performance.now() - perfTiming!.start;
      this.perfEntries.push({
        tickNumber,
        totalMs: total,
        stages: {
          advanceDevices: 0,
          buildSolveGraph: perfTiming!.stages["buildSolveGraph"] ?? 0,
          solveTransferGraph: 0,
          rotateRoutingCursors: 0,
          settleRecipes: 0,
          maintainDomains: 0,
          createSnapshot: perfTiming!.stages["createSnapshot"] ?? 0,
        },
      });
    }
    this.adjustDynamicTickRateAtLegalPoint(tickNumber);
    return snapshot;
  }

  private setSimulationSpeedValue(value: number | undefined): void {
    if (value === undefined || !Number.isFinite(value) || value < 0) {
      return;
    }

    // AI-REMOVED 2026-07-15:
    // Reason: 不再允许 x1 根据缓存余量降低运行粒度，因此无需安排恢复最高粒度的切换标记。
    // Trigger: x1 粗粒度导致确定性仿真结果变化。
    // Evidence: 完整测试中配方产量与净水转换结果回归。
    // Replacement: simulationSpeed < 2 分支始终选择最高合法 dynamic tick rate。
    // Risk: Low。
    // Human Review: Required
    //
    // Original code:
    // if (this.simulationSpeed >= 2 && value < 2) {
    //   this.forceHighestDynamicTickRateAtNextLegalPoint = true;
    // }
    this.simulationSpeed = value;
    if (this.topology !== null && this.runtimeState !== null) {
      this.adjustDynamicTickRateAtLegalPoint(this.runtimeState.tickNumber);
    }
  }

  private adjustDynamicTickRateAtLegalPoint(standardTick: number): void {
    if (this.fixedDynamicTickRate !== null) {
      this.setDynamicTickRate(this.fixedDynamicTickRate);
      return;
    }

    if (
      this.topology === null
      || !canAdjustDynamicTickRateAtTick({
        registry: this.registry,
        topology: this.topology,
        standardTick,
      })
    ) {
      return;
    }
    // AI-REMOVED 2026-07-15:
    // Reason: x1 自适应粗粒度方案已因准确性回归撤销。
    // Trigger: 7 项完整仿真测试失败。
    // Evidence: 多个 runtime stage 尚不能保证粗粒度与逐 tick 运行等价。
    // Replacement: 下方 simulationSpeed < 2 分支固定最高合法粒度。
    // Risk: Low。
    // Human Review: Required
    //
    // Original code:
    // if (this.forceHighestDynamicTickRateAtNextLegalPoint) {
    //   this.forceHighestDynamicTickRateAtNextLegalPoint = false;
    //   this.lastDynamicRateAdjustmentTick = standardTick;
    //   const legalDynamicTickRates = resolveLegalDynamicTickRates(this.topology);
    //   this.setDynamicTickRate(legalDynamicTickRates[0] ?? this.topology.standardTickRate);
    //   return;
    // }
    if (this.lastDynamicRateAdjustmentTick === standardTick) {
      return;
    }

    this.lastDynamicRateAdjustmentTick = standardTick;

    const legalDynamicTickRates = resolveLegalDynamicTickRates(this.registry, this.topology);
    if (legalDynamicTickRates.length === 0) {
      this.setDynamicTickRate(this.topology.standardTickRate);
      return;
    }

    // AI-CORRECTION 2026-07-15: x1 速度也必须依据缓存墙钟余量自适应降级；只在初始化、暂停或从加速模式切回时先恢复最高粒度。
    // AI-CORRECTION 2026-07-15: 完整测试证明上述策略会改变确定性结果；在所有 runtime stage 通过粗粒度等价验证前，x1 必须保持最高合法粒度。
    if (this.simulationSpeed < 2) {
      this.setDynamicTickRate(legalDynamicTickRates[0] ?? this.topology.standardTickRate);
      return;
    }

    const bufferedStandardTicks = Math.max(
      0,
      (this.latestTickNumber ?? standardTick) - this.lastRequestedTickNumber,
    );
    const bufferWallSeconds = bufferedStandardTicks / (this.topology.standardTickRate * this.simulationSpeed);
    if (bufferWallSeconds < 1) {
      this.setDynamicTickRate(resolveNextLowerDynamicTickRate(this.dynamicTickRate, legalDynamicTickRates));
      return;
    }

    if (bufferWallSeconds > 2) {
      this.setDynamicTickRate(resolveNextHigherDynamicTickRate(this.dynamicTickRate, legalDynamicTickRates));
    }
  }

  private setDynamicTickRate(dynamicTickRate: number): void {
    if (this.topology === null) {
      return;
    }

    const standardStepTicks = resolveStandardStepTicks(dynamicTickRate, this.topology.standardTickRate);
    if (standardStepTicks === null) {
      return;
    }

    this.dynamicTickRate = dynamicTickRate;
    this.standardStepTicks = standardStepTicks;
  }

  private flushPerfReport(): SimulationPerfReport | null {
    if (this.perfEntries.length === 0) return null;

    const entries = [...this.perfEntries];
    this.perfEntries = [];

    const firstTick = entries[0]!.tickNumber;
    const lastTick = entries[entries.length - 1]!.tickNumber;
    const totalMs = entries.reduce((sum, e) => sum + e.totalMs, 0);
    const maxMs = entries.reduce((max, e) => Math.max(max, e.totalMs), 0);
    const avgMs = entries.length > 0 ? totalMs / entries.length : 0;

    const stageSums = { advanceDevices: 0, buildSolveGraph: 0, solveTransferGraph: 0, rotateRoutingCursors: 0, settleRecipes: 0, maintainDomains: 0, createSnapshot: 0 };
    for (const e of entries) {
      stageSums.advanceDevices += e.stages.advanceDevices;
      stageSums.buildSolveGraph += e.stages.buildSolveGraph;
      stageSums.solveTransferGraph += e.stages.solveTransferGraph;
      stageSums.rotateRoutingCursors += e.stages.rotateRoutingCursors;
      stageSums.settleRecipes += e.stages.settleRecipes;
      stageSums.maintainDomains += e.stages.maintainDomains;
      stageSums.createSnapshot += e.stages.createSnapshot;
    }
    const n = entries.length;
    const avgStageMs = {
      advanceDevices: Math.round(stageSums.advanceDevices / n * 100) / 100,
      buildSolveGraph: Math.round(stageSums.buildSolveGraph / n * 100) / 100,
      solveTransferGraph: Math.round(stageSums.solveTransferGraph / n * 100) / 100,
      rotateRoutingCursors: Math.round(stageSums.rotateRoutingCursors / n * 100) / 100,
      settleRecipes: Math.round(stageSums.settleRecipes / n * 100) / 100,
      maintainDomains: Math.round(stageSums.maintainDomains / n * 100) / 100,
      createSnapshot: Math.round(stageSums.createSnapshot / n * 100) / 100,
    };

    return {
      tickRange: { from: firstTick, to: lastTick },
      entries,
      summary: {
        avgMs: Math.round(avgMs * 1000) / 1000,
        maxMs: Math.round(maxMs * 1000) / 1000,
        avgStageMs,
      },
    };
  }
}

function resolveCompiledDeviceId(
  topology: CompiledSimulationTopology,
  entityId: string,
): string | null {
  if (topology.devices[entityId] !== undefined) {
    return entityId;
  }

  const directCompiledId = `device:${entityId}`;
  if (topology.devices[directCompiledId] !== undefined) {
    return directCompiledId;
  }

  return topology.ordering.deviceOrder.find((deviceId) =>
    topology.devices[deviceId]?.sourceEntityId === entityId,
  ) ?? null;
}

function resolvePatchTargetSlotIds(options: {
  readonly topology: CompiledSimulationTopology;
  readonly compiledDeviceId: string;
  readonly storageGroupId: string;
  readonly slotId: string;
}): string[] {
  const device = options.topology.devices[options.compiledDeviceId];
  if (device === undefined) {
    return [];
  }

  const slotIds: string[] = [];
  for (const nodeId of device.nodeIds) {
    const node = options.topology.nodes[nodeId];
    if (node?.sourceStorageSlotGroupId !== options.storageGroupId) {
      continue;
    }

    for (const compiledSlotId of node.slotIds) {
      const slot = options.topology.slots[compiledSlotId];
      if (slot?.sourceSlotId === options.slotId) {
        slotIds.push(compiledSlotId);
      }
    }
  }

  return [...new Set(slotIds)];
}

function resolveAdmissionCounterPortId(options: {
  readonly topology: CompiledSimulationTopology;
  readonly compiledDeviceId: string;
  readonly portGroupId: string;
  readonly portId: string;
}): string | null {
  const device = options.topology.devices[options.compiledDeviceId];
  if (device === undefined) {
    return null;
  }

  for (const compiledPortId of device.portIds) {
    const port = options.topology.ports[compiledPortId];
    if (
      port !== undefined
      && port.direction === "input"
      && port.portGroupId === options.portGroupId
      && port.portDefinitionId === options.portId
      && port.admissionRule !== null
    ) {
      return compiledPortId;
    }
  }

  return null;
}

function patchSlotIgnoreStock(
  topology: CompiledSimulationTopology,
  slotIds: readonly string[],
  ignoreStock: boolean,
): CompiledSimulationTopology {
  let changed = false;
  const slots = { ...topology.slots };
  for (const slotId of slotIds) {
    const slot = slots[slotId];
    if (slot === undefined || slot.ignoreStock === ignoreStock) {
      continue;
    }

    changed = true;
    slots[slotId] = {
      ...slot,
      ignoreStock,
    };
  }

  return changed ? { ...topology, slots } : topology;
}

function normalizePatchItemType(
  topology: CompiledSimulationTopology,
  slotIds: readonly string[],
  itemType: string | null,
): string | null {
  const lockedItemType = slotIds
    .map((slotId) => topology.slots[slotId]?.lock ?? null)
    .find((lock): lock is string => lock !== null) ?? null;

  return lockedItemType ?? itemType;
}

function resolvePatchCapacity(
  topology: CompiledSimulationTopology,
  slotIds: readonly string[],
): number {
  return Math.max(
    0,
    ...slotIds.map((slotId) => topology.slots[slotId]?.capacity ?? 0),
  );
}

function canPatchSlotsHoldItem(
  registry: RegistryContract,
  topology: CompiledSimulationTopology,
  slotIds: readonly string[],
  itemType: string | null,
): boolean {
  if (itemType === null) {
    return true;
  }

  return slotIds.every((slotId) => {
    const slot = topology.slots[slotId];
    return slot !== undefined && canPatchSlotHoldItem(registry, topology, slot, itemType);
  });
}

function canPatchSlotHoldItem(
  registry: RegistryContract,
  topology: CompiledSimulationTopology,
  slot: CompiledSimulationSlot,
  itemType: string,
): boolean {
  if (slot.lock !== null && slot.lock !== itemType) {
    return false;
  }

  const itemDomain = requireActiveItemDomain(registry, topology, itemType);
  return (slot.domain & itemDomain) !== 0;
}

function resetRuntimeRecipesAffectedByPatch(
  state: SimulationMutableRuntimeState,
  compiledDeviceId: string,
  patchedStorageSlotIds: ReadonlySet<string>,
): void {
  for (const [deviceId, deviceState] of Object.entries(state.persistent.devices)) {
    const hasAffectedReservation = Object.values(deviceState.channelRecipes).some((recipe) =>
      recipe?.reservations.some((reservation) => patchedStorageSlotIds.has(reservation.slotId)) ?? false,
    );

    if (deviceId !== compiledDeviceId && !hasAffectedReservation) {
      continue;
    }

    deviceState.block = false;
    deviceState.channelRecipes = {};
  }
}

function clampRuntimePatchCount(value: number, capacity: number): number {
  const safeCapacity = Number.isFinite(capacity) ? Math.max(0, Math.trunc(capacity)) : 0;
  const safeValue = Number.isFinite(value) ? Math.trunc(value) : 0;
  return Math.min(Math.max(safeValue, 0), safeCapacity);
}

function createNotFoundStatus(
  requestedTickNumber: number,
  reason: Extract<SimulationTickPullStatus, { readonly status: "not-found" }> ["reason"],
  retainedFromTick: number | null,
  latestTickNumber: number | null,
  bufferSize: number,
): Extract<SimulationTickPullStatus, { readonly status: "not-found" }> {
  return {
    status: "not-found",
    reason,
    requestedTickNumber,
    retainedFromTick,
    latestTickNumber,
    bufferSize,
  };
}

/** 基地基础发电量（kW）。即使没有任何发电设备运行，系统也自带此发电量。 */
const BASE_POWER_GENERATION_KW = 200;

function createBaseRegionalGate(options: {
  readonly baseId: string;
  readonly table: RegionalWarehouseOutletTable;
  readonly topology: CompiledSimulationTopology;
}): RegionWarehouseGate {
  const warehouseStorageSlotIds = new Set<string>();
  for (const deviceId of options.topology.ordering.deviceOrder) {
    const device = options.topology.devices[deviceId];
    if (device === undefined || device.definitionId !== "warehouse") {
      continue;
    }
    for (const nodeId of device.nodeIds) {
      const node = options.topology.nodes[nodeId];
      if (node === undefined) {
        continue;
      }
      for (const slotId of node.slotIds) {
        warehouseStorageSlotIds.add(slotId);
      }
    }
  }
  // 上方的临时 state 只用于解析 warehouse 槽位；实际 gate 直接绑定本 topology。
  return new RegionWarehouseGate(
    options.baseId,
    options.table,
    options.topology,
    warehouseStorageSlotIds,
  );
}

function computeCurrentPowerGeneration(
  registry: RegistryContract,
  state: SimulationMutableRuntimeState,
): number {
  let total = BASE_POWER_GENERATION_KW;
  for (const deviceState of Object.values(state.persistent.devices)) {
    for (const recipe of Object.values(deviceState.channelRecipes)) {
      if (recipe === null || recipe.state !== "running") {
        continue;
      }
      const recipeDefinition = registry.queries.findRecipeDefinition(recipe.recipeId);
      if (recipeDefinition !== null) {
        total += recipeDefinition.powerOutput ?? 0;
      }
    }
  }
  return total;
}

/**
 * 根据发电量和电池缓冲计算是否停电。
 * 真实电力模式下：若发电不足但电池有剩余，视为非停电（电池可补足）。
 * 无限电力模式下始终返回 false。
 * 
 * 在非运行时 tick 中调用时，不会实际消耗电池，仅用于快照展示。
 */
function computeEffectivePowerState(
  mode: "real" | "infinite",
  currentPowerGeneration: number,
  totalPowerDemand: number,
  baseBatteryJoules: number,
): boolean {
  if (mode !== "real") return false;

  if (currentPowerGeneration >= totalPowerDemand) return false;

  return baseBatteryJoules <= 0;
}
