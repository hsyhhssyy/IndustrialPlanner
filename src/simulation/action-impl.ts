import { action, runInAction } from "mobx";

import type { SimulationAction } from "@/domain/simulation/simulation-action";
import type {
  SimulationAdmissionCounterReset,
  SimulationRuntimeSlotPatch,
} from "@/domain/simulation/types/simulation-types";
import type { WorkspaceContract } from "@/domain/document/workspace-contract";
import type { WorldDocument, WorldEntity } from "@/domain/document/world-document";
import { EntityCollectionType } from "@/domain/editor/types/editor-types";
import { resolveBaseBuiltinEntities } from "@/domain/registry/types/base-definition";
import type { SnapshotStoreReadWrite } from "@/shared/snapshot/snapshot-store";
import {
  areGridRectsIntersecting,
  resolveEntityGridRect,
  resolvePowerRangeGridRect,
} from "@/shared/geometry/power-range";

import {
  compileSimulationTopology,
  createSimulationDocumentHash,
} from "./topology-compiler";
import { createSimulationTopologyMigration } from "./topology-migration";
import {
  createInitialSimulationRuntimeStatus,
  type SimulationStateReadWrite,
} from "./state-impl";
import {
  DEFAULT_SIMULATION_SPEED,
  STANDARD_TICK_RATE_PER_SECOND,
} from "./tick-rate";

/** TPS 统计的累积窗口，毫秒 */
const TPS_WINDOW_MS = 1000;
import type {
  CompiledSimulationTopology,
  SimulationStartResult,
  SimulationTickPullStatus,
  SimulationTopologyMigration,
  TickPerfHotPathDetails,
  TickPerfStage3Details,
} from "./types";
import type { SimulationWorkerResponse } from "./worker-protocol";

export interface SimulationWorkerBridge {
  loadTopology(topology: CompiledSimulationTopology, migration?: SimulationTopologyMigration, perfEnabled?: boolean, simulationSpeed?: number): Promise<Extract<
    SimulationWorkerResponse,
    { readonly type: "topology-loaded" }
  >>;
  getTickSnapshot(tickNumber: number, simulationSpeed?: number): Promise<Extract<
    SimulationWorkerResponse,
    { readonly type: "tick-snapshot-result" }
  >>;
  setSimulationSpeed(value: number): Promise<Extract<
    SimulationWorkerResponse,
    { readonly type: "simulation-speed-set" }
  >>;
  setPowerMode(powerMode: "real" | "infinite"): Promise<Extract<
    SimulationWorkerResponse,
    { readonly type: "power-mode-set" }
  >>;
  setPowerConsumptionOverride(powerConsumptionOverride: number | undefined): Promise<Extract<
    SimulationWorkerResponse,
    { readonly type: "power-consumption-override-set" }
  >>;
  patchRuntimeSlot(patch: SimulationRuntimeSlotPatch): Promise<Extract<
    SimulationWorkerResponse,
    { readonly type: "runtime-slot-patched" }
  >>;
  resetAdmissionCounter(reset: SimulationAdmissionCounterReset): Promise<Extract<
    SimulationWorkerResponse,
    { readonly type: "admission-counter-reset" }
  >>;
  getPerfReport(): Promise<Extract<
    SimulationWorkerResponse,
    { readonly type: "perf-report" }
  >>;
  dispose(): void;
}

export interface SimulationInternalAction {
  refreshFromCurrentDocument(): Promise<SimulationStartResult>;
  syncToTick(tickNumber: number, playbackTickNumberOnReady?: number): Promise<SimulationTickPullStatus>;
  setSimulationSpeed(value: number): void;
  reset(): void;
}

interface SimulationActionImplOptions {
  workspace: WorkspaceContract;
  state: SimulationStateReadWrite;
  topology: SnapshotStoreReadWrite<CompiledSimulationTopology | null>;
  bridge: SimulationWorkerBridge;
  getPerfEnabled?: () => boolean;
  getActiveActivityIds?: () => readonly string[];
}

export class SimulationActionImpl
implements SimulationAction, SimulationInternalAction {
  private readonly workspace: WorkspaceContract;
  private readonly stateReadWrite: SimulationStateReadWrite;
  private readonly topology: SnapshotStoreReadWrite<CompiledSimulationTopology | null>;
  private readonly bridge: SimulationWorkerBridge;
  private readonly getPerfEnabled: (() => boolean) | undefined;
  private readonly getActiveActivityIds: (() => readonly string[]) | undefined;
  private compiledDocument: WorldDocument | null = null;
  private compiledActivitySignature: string | null = null;
  private tpsAccumulatedTicks = 0;
  private tpsAccumulatedMs = 0;
  private nextPerfReportTick = 180;
  private playbackTickRequestInFlight = false;

  // === 诊断计数器：10 秒输出一次 ===
  private diagFrameCount = 0;
  private diagCrossCount = 0;
  private diagInFlightSkipCount = 0;
  private diagNotReadyCount = 0;
  private diagTickConsumedCount = 0;
  private diagTotalDeltaMs = 0;
  private diagLastLogFrame = 0;
  private diagLastLogPlaybackTick = 0;
  private diagConsecutiveRollbacks = 0;
  private diagMaxConsecutiveRollbacks = 0;

  public constructor(options: SimulationActionImplOptions) {
    this.workspace = options.workspace;
    this.stateReadWrite = options.state;
    this.topology = options.topology;
    this.bridge = options.bridge;
    this.getPerfEnabled = options.getPerfEnabled;
    this.getActiveActivityIds = options.getActiveActivityIds;
  }

  public readonly start: SimulationAction["start"] = async () => {
    runInAction(() => {
      this.stateReadWrite.hasStarted = true;
    });

    const result = await this.refreshFromCurrentDocument();
    if (result.status === "started") {
      runInAction(() => {
        this.stateReadWrite.runningState = "start";
      });
    }
  };

  public readonly pause: SimulationAction["pause"] = action(() => {
    this.stateReadWrite.runningState = "pause";
  });

  public readonly resume: SimulationAction["resume"] = action(() => {
    if (this.stateReadWrite.runningState !== "pause") {
      return;
    }

    this.stateReadWrite.runningState = "start";
  });

  public readonly stop: SimulationAction["stop"] = action(() => {
    this.clearPlaybackProgress();
  });

  public readonly advancePlaybackByDeltaMs: SimulationAction["advancePlaybackByDeltaMs"] = async (
    deltaMs,
  ) => {
    // === 诊断：每 ~600 帧（约 10 秒）输出统计 ===
    this.diagFrameCount += 1;
    this.diagTotalDeltaMs += deltaMs;

    if (this.diagFrameCount - this.diagLastLogFrame >= 600) {
      const intervalFrames = this.diagFrameCount - this.diagLastLogFrame;
      const avgDeltaMs = this.diagTotalDeltaMs / intervalFrames;
      const avgTickDelta = avgDeltaMs * STANDARD_TICK_RATE_PER_SECOND * this.stateReadWrite.simulationSpeed / 1000;
      const playbackProgress = this.stateReadWrite.currentPlaybackTickNumber - this.diagLastLogPlaybackTick;
      const inFlightRate = intervalFrames > 0 ? (this.diagInFlightSkipCount / intervalFrames * 100).toFixed(1) : '0';
      const notReadyRate = intervalFrames > 0 ? (this.diagNotReadyCount / intervalFrames * 100).toFixed(1) : '0';
      console.debug(
        `[PlaybackDiag] +${intervalFrames}f avgMs=${avgDeltaMs.toFixed(2)} tickΔ=${avgTickDelta.toFixed(4)} ` +
        `crosses=${this.diagCrossCount} consumed=${this.diagTickConsumedCount} ` +
        `inFlightSkip=${this.diagInFlightSkipCount}(${inFlightRate}%) notReady=${this.diagNotReadyCount}(${notReadyRate}%) ` +
        `rollbackMaxConsec=${this.diagMaxConsecutiveRollbacks} ` +
        `playbackΔ=${playbackProgress.toFixed(2)} ` +
        `tps=${this.stateReadWrite.statistics.tickPerSecond} buff=${this.stateReadWrite.runtimeStatus.bufferSize}`,
      );

      this.diagLastLogFrame = this.diagFrameCount;
      this.diagLastLogPlaybackTick = this.stateReadWrite.currentPlaybackTickNumber;
      this.diagTotalDeltaMs = 0;
      this.diagCrossCount = 0;
      this.diagInFlightSkipCount = 0;
      this.diagNotReadyCount = 0;
      this.diagTickConsumedCount = 0;
      this.diagMaxConsecutiveRollbacks = 0;
    }

    if (this.stateReadWrite.runningState !== "start") {
      return;
    }

    const previousPlaybackTickNumber = this.stateReadWrite.currentPlaybackTickNumber;
    // simulationSpeed 有且仅有这一处可以参与运算：它只影响 add time 的推进速度。
    // AI-CORRECTION 2026-05-19: worker 也会接收 simulationSpeed，但只用于缓存余量的墙钟秒估算，不参与 runtime 物理时间推进。
    // 任何其他场合都不得使用该倍率做 tick/second 换算；换算只能依赖 standard tick rate。
    const tickDelta = deltaMs
      * STANDARD_TICK_RATE_PER_SECOND
      * this.stateReadWrite.simulationSpeed
      / 1000;

    // 位置始终按墙钟推进，不受 Worker bridge 在途状态影响。
    // playbackTickRequestInFlight 仅阻止并发请求，不冻结动画。
    runInAction(() => {
      this.stateReadWrite.currentPlaybackTickNumber += tickDelta;
    });

    const previousIntegerTickNumber = Math.trunc(previousPlaybackTickNumber);
    const nextIntegerTickNumber = Math.trunc(this.stateReadWrite.currentPlaybackTickNumber);

    // 计算本 delta 内实际获得的整数 tick 数，用于 TPS 统计
    let actualTicksProcessed = 0;

    if (previousIntegerTickNumber === nextIntegerTickNumber) {
      // 未跨越整数 tick 边界
      this.diagConsecutiveRollbacks = 0;
      this.accumulateTps(deltaMs, actualTicksProcessed);
      return;
    }

    this.diagCrossCount += 1;

    // bridge 在途时跳过本帧请求，但位置已推进；将位置回退到整数边界之下，
    // 确保 bridge 返回后下一帧再次跨越同一 tick 边界，不会丢 tick。
    if (this.playbackTickRequestInFlight) {
      this.diagInFlightSkipCount += 1;
      this.diagConsecutiveRollbacks += 1;
      this.diagMaxConsecutiveRollbacks = Math.max(this.diagMaxConsecutiveRollbacks, this.diagConsecutiveRollbacks);
      runInAction(() => {
        this.stateReadWrite.currentPlaybackTickNumber = nextIntegerTickNumber - 1e-9;
      });
      this.accumulateTps(deltaMs, 0);
      return;
    }

    this.diagConsecutiveRollbacks = 0;

    this.playbackTickRequestInFlight = true;
    try {
      const result = await this.syncToTick(nextIntegerTickNumber);
      if (result.status === "not-ready") {
        // worker 尚未就绪（buffer 耗尽），本 delta 未实际获得 tick，回滚到请求发起时的位置
        this.accumulateTps(deltaMs, actualTicksProcessed);
        runInAction(() => {
          this.stateReadWrite.currentPlaybackTickNumber = previousPlaybackTickNumber;
        });
        return;
      }

      // tick 获取成功
      actualTicksProcessed = nextIntegerTickNumber - previousIntegerTickNumber;
      this.diagTickConsumedCount += actualTicksProcessed;
      this.accumulateTps(deltaMs, actualTicksProcessed);

      if (result.status === "not-found") {
        await this.recoverPlaybackFromUnavailableTick(result, previousPlaybackTickNumber);
      }
    } finally {
      this.playbackTickRequestInFlight = false;
    }
  };

  public readonly refreshFromCurrentDocument: SimulationInternalAction["refreshFromCurrentDocument"] = async () => {
    const sourceDocument = this.workspace.editor?.document.getSnapshot();
    if (sourceDocument === undefined) {
      this.topology.setSnapshot(null);
      this.compiledDocument = null;
      this.compiledActivitySignature = null;
      runInAction(() => {
        this.stateReadWrite.currentSnapshot = null;
        this.stateReadWrite.currentPlaybackTickNumber = 0;
      });
      runInAction(() => {
        this.stateReadWrite.runtimeStatus = {
          ...this.stateReadWrite.runtimeStatus,
          mode: "error",
          error: "Simulation cannot start before editor document is available.",
        };
      });

      return {
        status: "failed",
        topologyId: null,
        diagnostics: [],
        error: this.stateReadWrite.runtimeStatus.error ?? undefined,
      };
    }

    const document = resolveSimulationCompileDocument({
      document: sourceDocument,
      workspace: this.workspace,
    });
    const previousTopology = this.topology.getSnapshot();
    const nextDocumentHash = createSimulationDocumentHash(document);
    const activeActivityIds = normalizeActiveActivityIds(this.getActiveActivityIds?.() ?? []);
    const nextActivitySignature = JSON.stringify(activeActivityIds);
    if (
      this.compiledDocument !== null
      && previousTopology !== null
      && this.stateReadWrite.runtimeStatus.mode !== "error"
      && previousTopology.documentHash === nextDocumentHash
      && this.compiledActivitySignature === nextActivitySignature
    ) {
      return {
        status: "started",
        topologyId: previousTopology.topologyId,
        diagnostics: previousTopology.diagnostics,
      };
    }

    runInAction(() => {
      this.stateReadWrite.runtimeStatus = {
        ...this.stateReadWrite.runtimeStatus,
        mode: "starting",
        error: null,
      };
    });

    const compiledTopology = compileSimulationTopology({
      document,
      registry: this.workspace.registry,
      poweredEntityIds: computePoweredEntityIds({
        document,
        registry: this.workspace.registry,
      }),
      activeActivityIds,
    });
    const previousDocument = this.compiledDocument;
    const baseTickNumber = this.stateReadWrite.currentSnapshot?.tickNumber ?? 0;
    const playbackTickNumber = this.stateReadWrite.currentPlaybackTickNumber;
    const migration = createSimulationTopologyMigration({
      previousDocument,
      nextDocument: document,
      previousTopology,
      nextTopology: compiledTopology,
      baseTickNumber,
    });
    const perfEnabled = this.getPerfEnabled?.() ?? false;
    const response = await this.bridge.loadTopology(
      compiledTopology,
      migration ?? undefined,
      perfEnabled,
      this.stateReadWrite.simulationSpeed,
    );
    this.topology.setSnapshot(compiledTopology);
    this.compiledDocument = cloneWorldDocument(document);
    this.compiledActivitySignature = nextActivitySignature;

    runInAction(() => {
      this.stateReadWrite.runtimeStatus = response.status;
    });

    if (response.result.status === "started") {
      const targetTickNumber = migration?.baseTickNumber ?? 0;
      const targetPlaybackTickNumber = migration === null ? 0 : playbackTickNumber;
      const tickStatus = await this.syncToTick(targetTickNumber, targetPlaybackTickNumber);
      if (tickStatus.status === "not-found") {
        await this.recoverPlaybackFromUnavailableTick(tickStatus, targetPlaybackTickNumber);
      }
    }

    return response.result;
  };

  public readonly setSimulationSpeed: SimulationInternalAction["setSimulationSpeed"] = action((value) => {
    if (!Number.isFinite(value) || value < 0) {
      return;
    }

    this.stateReadWrite.simulationSpeed = value;
    void this.bridge.setSimulationSpeed(value).catch(() => undefined);
  });

  public readonly patchRuntimeSlot: SimulationAction["patchRuntimeSlot"] = async (patch) => {
    if (this.stateReadWrite.runningState === "stop") {
      return;
    }

    const response = await this.bridge.patchRuntimeSlot(patch);
    runInAction(() => {
      this.stateReadWrite.runtimeStatus = response.status;
    });

    const targetTickNumber = Math.trunc(this.stateReadWrite.currentPlaybackTickNumber);
    const status = await this.syncToTick(targetTickNumber);
    if (status.status === "not-found") {
      await this.recoverPlaybackFromUnavailableTick(status, targetTickNumber);
    }
  };

  public readonly resetAdmissionCounter: SimulationAction["resetAdmissionCounter"] = async (reset) => {
    if (this.stateReadWrite.runningState === "stop") {
      return;
    }

    const response = await this.bridge.resetAdmissionCounter(reset);
    runInAction(() => {
      this.stateReadWrite.runtimeStatus = response.status;
    });

    const targetTickNumber = Math.trunc(this.stateReadWrite.currentPlaybackTickNumber);
    const status = await this.syncToTick(targetTickNumber);
    if (status.status === "not-found") {
      await this.recoverPlaybackFromUnavailableTick(status, targetTickNumber);
    }
  };

  public readonly reset: SimulationInternalAction["reset"] = action(() => {
    this.clearPlaybackProgress();
    this.stateReadWrite.simulationSpeed = DEFAULT_SIMULATION_SPEED;
  });

  public readonly syncToTick: SimulationInternalAction["syncToTick"] = async (
    tickNumber: number,
    playbackTickNumberOnReady?: number,
  ): Promise<SimulationTickPullStatus> => {
    const response = await this.bridge.getTickSnapshot(tickNumber, this.stateReadWrite.simulationSpeed);

    runInAction(() => {
      this.stateReadWrite.runtimeStatus = response.status;

      if (response.status.mode === "error") {
        console.error(`[SimHost] Worker in error mode: ${response.status.error ?? "unknown"}`);
      }

      if (response.result.status.status === "ready") {
        this.stateReadWrite.currentSnapshot = response.result.currentTick;
        const snap = response.result.currentTick;
        if (snap !== null) {
          this.stateReadWrite.statistics = {
            ...this.stateReadWrite.statistics,
            baseBatteryJoules: snap.baseBatteryJoules,
            baseBatteryCapacity: snap.baseBatteryCapacity,
          };
        }
        if (playbackTickNumberOnReady !== undefined) {
          this.stateReadWrite.currentPlaybackTickNumber = playbackTickNumberOnReady;
        }
      }
    });

    // Perf 轮询：每 180 tick 阈值追赶
    if (response.result.status.status === "ready" && this.getPerfEnabled?.()) {
      this.pollPerfReport(tickNumber);
    }

    return response.result.status;
  };

  private async recoverPlaybackFromUnavailableTick(
    status: Extract<SimulationTickPullStatus, { readonly status: "not-found" }>,
    fallbackPlaybackTickNumber: number,
  ): Promise<void> {
    const recoveryTickNumber = status.retainedFromTick
      ?? this.stateReadWrite.currentSnapshot?.tickNumber
      ?? status.latestTickNumber;
    if (recoveryTickNumber === null || recoveryTickNumber === undefined) {
      runInAction(() => {
        this.stateReadWrite.currentPlaybackTickNumber = fallbackPlaybackTickNumber;
      });
      return;
    }

    const recoveryStatus = await this.syncToTick(recoveryTickNumber, recoveryTickNumber);
    if (recoveryStatus.status !== "ready") {
      runInAction(() => {
        this.stateReadWrite.currentPlaybackTickNumber = fallbackPlaybackTickNumber;
      });
    }
  }

  private clearPlaybackProgress(): void {
    this.topology.setSnapshot(null);
    this.compiledDocument = null;
    this.stateReadWrite.runningState = "stop";
    this.stateReadWrite.hasStarted = false;
    this.stateReadWrite.runtimeStatus = createInitialSimulationRuntimeStatus();
    this.stateReadWrite.currentSnapshot = null;
    this.stateReadWrite.currentPlaybackTickNumber = 0;
    this.stateReadWrite.statistics = { tickPerSecond: 0, targetTickPerSecond: 0, baseBatteryJoules: 0, baseBatteryCapacity: 0 };
    this.tpsAccumulatedTicks = 0;
    this.tpsAccumulatedMs = 0;
    this.nextPerfReportTick = 180;
    this.playbackTickRequestInFlight = false;
  }

  /** 累积 tick 和时间，每 TPS_WINDOW_MS 刷新一次 TPS 统计 */
  private accumulateTps(deltaMs: number, actualTicks: number): void {
    this.tpsAccumulatedTicks += actualTicks;
    this.tpsAccumulatedMs += deltaMs;

    if (this.tpsAccumulatedMs >= TPS_WINDOW_MS) {
      const tps = this.tpsAccumulatedMs > 0
        ? this.tpsAccumulatedTicks / (this.tpsAccumulatedMs / 1000)
        : 0;

      const dynamicTickRate = this.stateReadWrite.runtimeStatus.dynamicTickRate ?? STANDARD_TICK_RATE_PER_SECOND;
      const targetTps = this.stateReadWrite.simulationSpeed * dynamicTickRate;

      runInAction(() => {
        this.stateReadWrite.statistics = {
          ...this.stateReadWrite.statistics,
          tickPerSecond: Math.round(tps * 10) / 10,
          targetTickPerSecond: targetTps,
        };
      });

      this.tpsAccumulatedTicks = 0;
      this.tpsAccumulatedMs = 0;
    }
  }

  /** 每 180 tick 阈值追赶：从 Worker 拉取 perf 报告并打印到 console */
  private async pollPerfReport(tickNumber: number): Promise<void> {
    if (tickNumber < this.nextPerfReportTick) return;

    try {
      const response = await this.bridge.getPerfReport();
      if (response.report !== null) {
        const s = response.report.summary;
        const r = response.report.tickRange;
        const st = s.avgStageMs;
        const logPayload: Record<string, unknown> = {
          tickRange: { from: r.from, to: r.to },
          avgMs: s.avgMs,
          maxMs: s.maxMs,
          targetMs: Math.round(1000 / 20),
          stages: {
            advanceDevices: st.advanceDevices,
            buildSolveGraph: st.buildSolveGraph,
            solveTransferGraph: st.solveTransferGraph,
            rotateRoutingCursors: st.rotateRoutingCursors,
            settleRecipes: st.settleRecipes,
            maintainDomains: st.maintainDomains,
            createSnapshot: st.createSnapshot,
          },
        };

        // Stage 3 细分汇总
        const s3s = response.report.entries
          .filter((e) => e.stage3 !== undefined)
          .map((e) => e.stage3!);
        if (s3s.length > 0) {
          const avg = <T extends keyof TickPerfStage3Details>(key: T) =>
            Math.round(s3s.reduce((sum, s3) => sum + (s3[key] as number), 0) / s3s.length * 100) / 100;
          logPayload.stage3 = {
            layers: avg("layerCount"),
            anchors: avg("anchorCount"),
            outNodes: avg("outputNodeCount"),
            moves: avg("moveCount"),
            refreshBlockedMs: avg("refreshBlockedMs"),
            refreshBlockedCalls: Math.round(avg("refreshBlockedCalls")),
            selectSourceCalls: Math.round(avg("selectSourceCalls")),
            canOutputProvideCalls: Math.round(avg("canOutputProvideCalls")),
            findInputSlotCalls: Math.round(avg("findInputSlotCalls")),
            getRemainingCapacityCalls: Math.round(avg("getRemainingCapacityCalls")),
            getReservedCalls: Math.round(avg("getReservedCalls")),
            solveOutputEdgeChecks: Math.round(avg("solveOutputEdgeChecks")),
          };
        }

        const hotPaths = response.report.entries
          .filter((entry) => entry.hotPath !== undefined)
          .map((entry) => entry.hotPath!);
        if (hotPaths.length > 0) {
          const avgHotPath = <T extends keyof TickPerfHotPathDetails>(key: T) =>
            Math.round(
              hotPaths.reduce((sum, details) => sum + (details[key] as number), 0)
                / hotPaths.length
                * 100,
            ) / 100;
          logPayload.hotPath = {
            inputEdgeLookupCalls: Math.round(avgHotPath("inputEdgeLookupCalls")),
            inputEdgeLookupMs: avgHotPath("inputEdgeLookupMs"),
            outputEdgeLookupCalls: Math.round(avgHotPath("outputEdgeLookupCalls")),
            outputEdgeLookupMs: avgHotPath("outputEdgeLookupMs"),
            edgeIndexFallbackScans: Math.round(avgHotPath("edgeIndexFallbackScans")),
            reservedLookupCalls: Math.round(avgHotPath("reservedLookupCalls")),
            reservedLookupMs: avgHotPath("reservedLookupMs"),
            reservedIndexBuilds: avgHotPath("reservedIndexBuilds"),
            reservedIndexBuildMs: avgHotPath("reservedIndexBuildMs"),
            reservationAdjustCalls: Math.round(avgHotPath("reservationAdjustCalls")),
            recipeFinishCalls: Math.round(avgHotPath("recipeFinishCalls")),
            recipeFinishSuccesses: Math.round(avgHotPath("recipeFinishSuccesses")),
            recipeFinishFailures: Math.round(avgHotPath("recipeFinishFailures")),
            recipeFinishPreflightMs: avgHotPath("recipeFinishPreflightMs"),
            recipeFinishCommitMs: avgHotPath("recipeFinishCommitMs"),
            recipeFinishChangedSlots: avgHotPath("recipeFinishChangedSlots"),
          };
        }

        console.debug(`[SimWorkerPerf] ${JSON.stringify(logPayload)}`);
      }
    } catch {
      // perf 失败不影响主流程
    }

    // 追赶：跳到下一个 ≥ tickNumber 的 180 倍
    this.nextPerfReportTick = Math.ceil((tickNumber + 1) / 180) * 180;
  }
}

function cloneWorldDocument(document: WorldDocument): WorldDocument {
  return JSON.parse(JSON.stringify(document)) as WorldDocument;
}

function computePoweredEntityIds(options: {
  readonly document: WorldDocument;
  readonly registry: WorkspaceContract["registry"];
}): Set<string> {
  const definitionMap = new Map(
    options.registry.entityDefinitions.map((definition) => [
      definition.id,
      definition,
    ]),
  );
  const entities = resolveOrderedDocumentEntities(options.document);
  const powerRangeRects = entities.flatMap((entity) => {
    const definition = definitionMap.get(entity.definitionId);
    if (definition === undefined) {
      return [];
    }

    const gridRect = resolvePowerRangeGridRect({
      entity,
      definition,
    });

    return gridRect === null ? [] : [gridRect];
  });

  if (powerRangeRects.length === 0) {
    return new Set();
  }

  return new Set(entities.flatMap((entity) => {
    const definition = definitionMap.get(entity.definitionId);
    if (definition === undefined) {
      return [];
    }

    const entityGridRect = resolveEntityGridRect({
      entity,
      definition,
    });
    return powerRangeRects.some((powerRangeRect) =>
      areGridRectsIntersecting(entityGridRect, powerRangeRect),
    ) ? [entity.id] : [];
  }));
}

function resolveOrderedDocumentEntities(document: WorldDocument): WorldEntity[] {
  return document.entityOrder.flatMap((entityId) => {
    const entity = document.entities[entityId];

    return entity === undefined ? [] : [entity];
  });
}

function normalizeActiveActivityIds(activityIds: readonly string[]): string[] {
  return [...new Set(activityIds)]
    .filter((activityId) => activityId.length > 0)
    .sort();
}

function resolveSimulationCompileDocument(options: {
  document: WorldDocument;
  workspace: WorkspaceContract;
}): WorldDocument {
  const invalidPlacementCollection =
    options.workspace.editor?.state?.collections?.[EntityCollectionType.invalidPlacement];
  if (invalidPlacementCollection === undefined || invalidPlacementCollection.length === 0) {
    return appendBaseBuiltinEntitiesToDocument({
      document: options.document,
      workspace: options.workspace,
    });
  }

  const invalidEntityIds = new Set(
    invalidPlacementCollection.filter((entityId) =>
      options.document.entities[entityId] !== undefined,
    ),
  );
  if (invalidEntityIds.size === 0) {
    return appendBaseBuiltinEntitiesToDocument({
      document: options.document,
      workspace: options.workspace,
    });
  }

  const nextEntities = { ...options.document.entities };
  for (const entityId of invalidEntityIds) {
    delete nextEntities[entityId];
  }

  return appendBaseBuiltinEntitiesToDocument({
    workspace: options.workspace,
    document: {
      ...options.document,
      entities: nextEntities,
      entityOrder: options.document.entityOrder.filter((entityId) =>
        !invalidEntityIds.has(entityId),
      ),
      slotLinks: options.document.slotLinks.filter((slotLink) =>
        !invalidEntityIds.has(slotLink.source.entityId)
        && !invalidEntityIds.has(slotLink.target.entityId),
      ),
    },
  });
}

function appendBaseBuiltinEntitiesToDocument(options: {
  document: WorldDocument;
  workspace: WorkspaceContract;
}): WorldDocument {
  const builtinEntities = resolveBaseBuiltinEntities({
    baseDefinitions: options.workspace.registry.baseDefinitions,
    baseId: options.document.baseId,
  });
  if (builtinEntities.length === 0) {
    return options.document;
  }

  const builtinEntityIds = new Set(builtinEntities.map((entity) => entity.id));
  const nextEntities = { ...options.document.entities };
  for (const entity of builtinEntities) {
    nextEntities[entity.id] = entity;
  }

  return {
    ...options.document,
    entities: nextEntities,
    entityOrder: [
      ...builtinEntities.map((entity) => entity.id),
      ...options.document.entityOrder.filter((entityId) => !builtinEntityIds.has(entityId)),
    ],
  };
}
