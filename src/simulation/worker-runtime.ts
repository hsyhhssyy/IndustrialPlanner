import type {
  CompiledSimulationSlot,
  CompiledSimulationTopology,
  RuntimeTickSnapshot,
  SimulationPerfReport,
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
import type {
  SimulationWorkerRequest,
  SimulationWorkerResponse,
} from "./worker-protocol";

import { createTickSnapshot } from "./runtime/create-tick-snapshot";
import {
  canAdjustDynamicTickRateAtTick,
  resolveLegalDynamicTickRates,
} from "./runtime/phase-gating";
import { advanceDevices } from "./runtime/stage-1-advance-devices";
import { buildSolveGraph } from "./runtime/stage-2-build-solve-graph";
import { solveTransferGraph, type SolveTransferGraphPerf } from "./runtime/stage-3-layered-reverse-solve";
import { rotateRoutingCursors } from "./runtime/stage-4-rotate-routing-cursors";
import { settleRecipes } from "./runtime/stage-5-settle-recipes";
import {
  getItemDomain,
  maintainTransportComponentDomains,
  resolveStorageSlotId,
} from "./runtime/runtime-slot-access";
import { computeActiveGasDiffusions } from "./runtime/gas-diffusion";
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
  normalizeAdmissionMinuteCountersForCurrentWindow,
  resetAdmissionMinuteCounterForCurrentWindow,
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
  private lastRequestedTickNumber = 0;
  private lastDynamicRateAdjustmentTick: number | null = null;
  private powerMode: "real" | "infinite" = "infinite";

  // 停止线：Worker 自主推进到该 tick 后暂停，等待外部拉取更新停止线。
  // 初始值 = 0 + MAX_RETAINED_TICKS，外部每次请求 tick N 时更新为 N + MAX_RETAINED_TICKS。
  private stopLineTick = 0;
  // 后台填充定时器 ID，用于取消和防重入。
  private fillTimerId: ReturnType<typeof setTimeout> | null = null;

  // Perf instrumentation
  private perfEnabled = false;
  private perfEntries: TickPerfEntry[] = [];

  /** 手动覆盖总耗电（kW），undefined = 按编译期真实值。 */
  private powerConsumptionOverride: number | undefined = undefined;

  /** Worker 线程内异步路径（setTimeout 回调等）错误时的回调，由 simulation-worker.ts 注入。 */
  private onError: ((error: string, tickNumber: number | null) => void) | null = null;

  public setOnError(callback: (error: string, tickNumber: number | null) => void): void {
    this.onError = callback;
  }

  public handleRequest(request: SimulationWorkerRequest): SimulationWorkerResponse {
    try {
      switch (request.type) {
        case "load-topology":
          this.perfEnabled = request.perfEnabled ?? false;
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
            result: this.getTickSnapshot(request.tickNumber),
            status: this.getStatus(),
          };
        case "set-simulation-speed":
          this.setSimulationSpeedValue(request.simulationSpeed);
          return {
            type: "simulation-speed-set",
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
        case "set-simulation-speed":
          return {
            type: "simulation-speed-set",
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

    if (!canPatchSlotsHoldItem(effectiveTopology, slotIds, normalizedItemType)) {
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
    if (reset.scope === "per-minute") {
      resetAdmissionMinuteCounterForCurrentWindow(this.topology, nextState, compiledPortId);
    } else {
      nextState.persistent.admissionCounters[compiledPortId] = 0;
    }
    nextState.transient = createEmptyTransientState();

    this.runtimeState = nextState;
    this.clearTickCachesFrom(patchTickNumber);
    this.lastRequestedTickNumber = patchTickNumber;
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
    this.nextTickNumber = tickNumber;
  }

  private clearTickCachesFrom(tickNumber: number): void {
    this.invalidateFrom(tickNumber);
  }

  private loadTopology(
    topology: CompiledSimulationTopology,
    migration?: SimulationTopologyMigration,
  ): SimulationStartResult {
    // 取消任何正在进行的后台填充
    if (this.fillTimerId !== null) {
      clearTimeout(this.fillTimerId);
      this.fillTimerId = null;
    }

    const previousTopology = this.topology;
    const previousBaseState = migration === undefined
      ? null
      : this.tickRuntimeStates.get(migration.baseTickNumber) ?? null;
    const nextRuntimeState = previousTopology !== null && previousBaseState !== null && migration !== undefined
      ? createMigratedSimulationMutableRuntimeState({
          previousTopology,
          previousState: previousBaseState,
          topology,
          resetDeviceIds: migration.resetDeviceIds,
        })
      : createSimulationMutableRuntimeState(topology);
    if (previousBaseState === null && migration !== undefined) {
      nextRuntimeState.tickNumber = Math.max(0, Math.trunc(migration.baseTickNumber));
    }

    this.topology = topology;
    this.runtimeState = nextRuntimeState;
    this.tickSnapshots.clear();
    this.tickRuntimeStates.clear();
    this.nextTickNumber = this.runtimeState.tickNumber;
    this.retainedFromTick = null;
    this.latestTickNumber = null;
    this.lastRequestedTickNumber = this.runtimeState.tickNumber;
    this.dynamicTickRate = topology.standardTickRate;
    this.standardStepTicks = 1;
    this.lastDynamicRateAdjustmentTick = null;
    this.adjustDynamicTickRateAtLegalPoint(this.runtimeState.tickNumber);
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
    };
  }

  private getTickSnapshot(tickNumber: number): SimulationTickSnapshotResult {
    if (this.topology === null || this.runtimeState === null) {
      return {
        status: createNotFoundStatus(tickNumber, "missing-topology", null, null, 0),
        currentTick: null,
      };
    }

    this.lastRequestedTickNumber = Math.max(0, Math.trunc(tickNumber));

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
      if (retainedTickNumber < tickNumber) {
        this.tickSnapshots.delete(retainedTickNumber);
        this.tickRuntimeStates.delete(retainedTickNumber);
      }
    }
    this.retainedFromTick = tickNumber;

    // 消费后缓冲区有空位，通知后台填充继续推进到停止线
    this.scheduleBackgroundFill();

    return {
      status: {
        status: "ready",
        retainedFromTick: this.retainedFromTick,
        latestTickNumber: this.latestTickNumber ?? tickNumber,
        bufferSize: this.tickSnapshots.size,
      },
      currentTick,
    };
  }

  /**
   * 后台自主填充循环：每次 setTimeout(0) 推进一个 tick，到停止线自动停。
   * 与外部 getTickSnapshot 完全解耦 — 外部拉取不触发推进，只更新停止线。
   */
  private scheduleBackgroundFill(): void {
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
          cloneSimulationMutableRuntimeState(this.runtimeState),
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
        cloneSimulationMutableRuntimeState(this.runtimeState),
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
    normalizeAdmissionMinuteCountersForCurrentWindow(this.topology, this.runtimeState);
    const runtimeStepTicks = tickNumber - this.runtimeState.lastAdvancedTickNumber;
    const shouldRunRuntime = shouldAdvance && runtimeStepTicks >= this.standardStepTicks;

    const perfTiming = this.perfEnabled ? {
      tickNumber,
      start: performance.now(),
      stages: {} as Record<string, number>,
      stage3: undefined as TickPerfStage3Details | undefined,
      hotPath: undefined as TickPerfHotPathDetails | undefined,
    } : null;

    if (shouldAdvance && !shouldRunRuntime) {
      // 非运行时 tick：仿真未推进，但需正确反映当前电力状态（含电池缓冲）
      const currentPowerGeneration = computeCurrentPowerGeneration(this.topology, this.runtimeState);
      const isPowerOutage = this.resolveTickPowerOutage(currentPowerGeneration);
      this.runtimeState.transient = createEmptyTransientState();
      this.runtimeState.transient.activeGasDiffusions = computeActiveGasDiffusions(this.topology, this.runtimeState);
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
        this.topology,
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

      this.runtimeState.transient.reservedAmountByStorageSlotId = null;
      this.runtimeState.transient.activeGasDiffusions = computeActiveGasDiffusions(
        this.topology,
        this.runtimeState,
      );
      if (this.perfEnabled) {
        this.runtimeState.transient._perf = createRuntimePerfCounters();
      }

      const t0 = this.perfEnabled ? performance.now() : 0;
      advanceDevices(
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
      solveTransferGraph(this.topology, this.runtimeState, stage3Perf);
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
        this.topology,
        this.runtimeState,
        this.powerMode,
        effectiveGeneration,
        this.effectiveTotalPowerDemand,
      );
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
        canAdjustDynamicTickRateAtTick({ topology: this.topology, standardTick: tickNumber }),
      );
      this.runtimeState.transient.recipeStatsDelta = createEmptyTransientState().recipeStatsDelta;

      const t6 = this.perfEnabled ? performance.now() : 0;
      const isPowerOutageRun = this.powerMode === "real"
        && effectiveGeneration < this.effectiveTotalPowerDemand;
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

    const currentPowerGenForSnapshot = computeCurrentPowerGeneration(this.topology, this.runtimeState);
    const isPowerOutageForSnapshot = this.resolveTickPowerOutage(currentPowerGenForSnapshot);
    this.runtimeState.transient.activeGasDiffusions = computeActiveGasDiffusions(this.topology, this.runtimeState);

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

    this.simulationSpeed = value;
    if (this.topology !== null && this.runtimeState !== null) {
      this.adjustDynamicTickRateAtLegalPoint(this.runtimeState.tickNumber);
    }
  }

  private adjustDynamicTickRateAtLegalPoint(standardTick: number): void {
    if (this.topology === null || !canAdjustDynamicTickRateAtTick({ topology: this.topology, standardTick })) {
      return;
    }
    if (this.lastDynamicRateAdjustmentTick === standardTick) {
      return;
    }

    this.lastDynamicRateAdjustmentTick = standardTick;

    const legalDynamicTickRates = resolveLegalDynamicTickRates(this.topology);
    if (legalDynamicTickRates.length === 0) {
      this.setDynamicTickRate(this.topology.standardTickRate);
      return;
    }

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
  topology: CompiledSimulationTopology,
  slotIds: readonly string[],
  itemType: string | null,
): boolean {
  if (itemType === null) {
    return true;
  }

  return slotIds.every((slotId) => {
    const slot = topology.slots[slotId];
    return slot !== undefined && canPatchSlotHoldItem(topology, slot, itemType);
  });
}

function canPatchSlotHoldItem(
  topology: CompiledSimulationTopology,
  slot: CompiledSimulationSlot,
  itemType: string,
): boolean {
  if (slot.lock !== null && slot.lock !== itemType) {
    return false;
  }

  const itemDomain = getItemDomain(topology, itemType);
  if (slot.domain === "any") {
    return true;
  }
  if (slot.domain === "fluid") {
    return itemDomain === "liquid" || itemDomain === "gas";
  }
  return itemDomain === slot.domain;
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

function computeCurrentPowerGeneration(
  topology: CompiledSimulationTopology,
  state: SimulationMutableRuntimeState,
): number {
  let total = BASE_POWER_GENERATION_KW;
  for (const deviceState of Object.values(state.persistent.devices)) {
    for (const recipe of Object.values(deviceState.channelRecipes)) {
      if (recipe === null || recipe.state !== "running") {
        continue;
      }
      const compiledRecipe = topology.recipeCatalog[recipe.recipeId];
      if (compiledRecipe !== undefined) {
        total += compiledRecipe.powerOutput;
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
