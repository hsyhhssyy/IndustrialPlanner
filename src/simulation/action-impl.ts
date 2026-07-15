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
  createInitialSimulationTimelineState,
  type SimulationStateReadWrite,
} from "./state-impl";
import {
  DEFAULT_SIMULATION_SPEED,
  STANDARD_TICK_RATE_PER_SECOND,
} from "./tick-rate";
import type {
  CompiledSimulationTopology,
  SimulationStartResult,
  SimulationTickPullStatus,
  SimulationTopologyMigration,
  SimulationRuntimeExport,
  TickPerfHotPathDetails,
  TickPerfStage3Details,
} from "./types";
import type { SimulationWorkerResponse } from "./worker-protocol";
import type {
  TimelineWorkerResponse,
  TimelineWorkerStatus,
} from "./timeline-worker-protocol";

/** TPS 统计的累积窗口，毫秒 */
const TPS_WINDOW_MS = 1000;
const TIMELINE_TICK_DURATION_SECONDS = 0.5;
const TIMELINE_STEP_STANDARD_TICKS = STANDARD_TICK_RATE_PER_SECOND * TIMELINE_TICK_DURATION_SECONDS;
const TIMELINE_WINDOW_DURATION_SECONDS = 300;
const TIMELINE_RULER_DURATION_SECONDS = TIMELINE_WINDOW_DURATION_SECONDS;
const TIMELINE_CAPACITY_TICKS = TIMELINE_WINDOW_DURATION_SECONDS / TIMELINE_TICK_DURATION_SECONDS;
const TIMELINE_WINDOW_SPAN_TICKS = TIMELINE_CAPACITY_TICKS - 1;
const TIMELINE_HISTORY_WINDOW_MULTIPLIER = 3;
const TIMELINE_FUTURE_WINDOW_MULTIPLIER = 3;
const TIMELINE_MAX_HISTORY_TICKS = TIMELINE_CAPACITY_TICKS * TIMELINE_HISTORY_WINDOW_MULTIPLIER;
const TIMELINE_MAX_FUTURE_TICKS = TIMELINE_CAPACITY_TICKS * TIMELINE_FUTURE_WINDOW_MULTIPLIER;
const TIMELINE_SEEK_LEFT_EDGE_SCROLL_ANCHOR_OFFSET_TICKS = Math.round(TIMELINE_WINDOW_SPAN_TICKS * 0.1);
const TIMELINE_DEFAULT_PLAYBACK_ANCHOR_OFFSET_TICKS = Math.round(TIMELINE_WINDOW_SPAN_TICKS * 0.5);
const TIMELINE_SEEK_EDGE_SCROLL_ANCHOR_OFFSET_TICKS = Math.round(TIMELINE_WINDOW_SPAN_TICKS * 0.9);
const TIMELINE_STATUS_POLL_MS = 250;
const TIMELINE_EXPORT_LOOKBACK_STEPS = 18;

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
  exportRuntimeState(tickNumber?: number): Promise<Extract<
    SimulationWorkerResponse,
    { readonly type: "runtime-state-exported" }
  >>;
  importRuntimeState(runtimeExport: SimulationRuntimeExport): Promise<Extract<
    SimulationWorkerResponse,
    { readonly type: "runtime-state-imported" }
  >>;
  dispose(): void;
}

export interface TimelineWorkerBridge {
  loadTimeline(options: {
    runtimeExport: SimulationRuntimeExport;
    startTimelineTickNumber: number;
    retainedFromTimelineTickNumber?: number;
    targetTimelineTickNumber?: number;
    capacityTimelineTicks: number;
    stepStandardTicks: number;
  }): Promise<Extract<TimelineWorkerResponse, { readonly type: "timeline-loaded" }>>;
  retargetTimeline(options: {
    retainedFromTimelineTickNumber: number;
    targetTimelineTickNumber: number;
  }): Promise<Extract<TimelineWorkerResponse, { readonly type: "timeline-retargeted" }>>;
  getTimelineStatus(): Promise<Extract<TimelineWorkerResponse, { readonly type: "timeline-status" }>>;
  getTimelineCheckpoint(timelineTickNumber: number): Promise<Extract<TimelineWorkerResponse, { readonly type: "timeline-checkpoint-result" }>>;
  stopTimeline(): Promise<Extract<TimelineWorkerResponse, { readonly type: "timeline-stopped" }>>;
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
  createTimelineBridge?: () => TimelineWorkerBridge;
  getPerfEnabled?: () => boolean;
  getActiveActivityIds?: () => readonly string[];
}

interface TimelineCheckpointMetadata {
  readonly document: WorldDocument;
  readonly activitySignature: string;
}

interface TimelineRebaseRange {
  readonly retainedFromTimelineTickNumber: number;
  readonly targetTimelineTickNumber: number;
}

function createMissingTimelineWorkerBridge(): TimelineWorkerBridge {
  throw new Error("Timeline worker bridge is not configured.");
}

export class SimulationActionImpl
implements SimulationAction, SimulationInternalAction {
  private readonly workspace: WorkspaceContract;
  private readonly stateReadWrite: SimulationStateReadWrite;
  private readonly topology: SnapshotStoreReadWrite<CompiledSimulationTopology | null>;
  private readonly bridge: SimulationWorkerBridge;
  private readonly createTimelineBridge: () => TimelineWorkerBridge;
  private readonly getPerfEnabled: (() => boolean) | undefined;
  private readonly getActiveActivityIds: (() => readonly string[]) | undefined;
  private compiledDocument: WorldDocument | null = null;
  private compiledActivitySignature: string | null = null;
  private tpsAccumulatedTicks = 0;
  private tpsAccumulatedMs = 0;
  private nextPerfReportTick = 180;
  private playbackTickRequestInFlight = false;
  private timelineBridge: TimelineWorkerBridge | null = null;
  private timelineStatusTimerId: ReturnType<typeof setInterval> | null = null;
  private timelineSeekSerial = 0;
  private timelineSeekImportPromise: Promise<unknown> | null = null;
  private timelineRestartInFlight = false;
  private timelineWindowRetargetInFlight = false;
  private timelineWindowRetargetPending = false;
  private lastTimelineRetargetRange: TimelineRebaseRange | null = null;
  private timelinePlaybackAnchorOffsetTicks: number | null = null;
  private timelineMarkSerial = 1;
  private lastTimelineSafetySyncStandardTick: number | null = null;
  private readonly timelineCheckpointMetadataByTickNumber = new Map<number, TimelineCheckpointMetadata>();

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
    this.createTimelineBridge = options.createTimelineBridge ?? createMissingTimelineWorkerBridge;
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
      this.syncTimelineCursorFromPlayback();
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
    const shouldMarkTimelineDocumentChange =
      this.stateReadWrite.timeline.enabled
      && previousDocument !== null
      && previousTopology !== null;
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

    if (shouldMarkTimelineDocumentChange) {
      this.addTimelineMark("document-change");
      await this.restartTimelineFromCurrentSimulation();
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

    this.addTimelineMark("runtime-change");
    await this.restartTimelineFromCurrentSimulation();
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

    this.addTimelineMark("runtime-change");
    await this.restartTimelineFromCurrentSimulation();
  };

  public readonly enableTimeline: SimulationAction["enableTimeline"] = async () => {
    runInAction(() => {
      this.stateReadWrite.timeline.enabled = true;
      this.stateReadWrite.timeline.tickDurationSeconds = TIMELINE_TICK_DURATION_SECONDS;
      this.stateReadWrite.timeline.rulerDurationSeconds = TIMELINE_RULER_DURATION_SECONDS;
      this.stateReadWrite.timeline.isSeeking = false;
      this.syncTimelineCursorFromPlayback();
    });

    if (!this.stateReadWrite.hasStarted) {
      await this.start();
    }

    await this.restartTimelineFromCurrentSimulation();
    this.startTimelineStatusPolling();
  };

  public readonly disableTimeline: SimulationAction["disableTimeline"] = action(() => {
    this.stopTimelineWorker();
    Object.assign(this.stateReadWrite.timeline, createInitialSimulationTimelineState());
  });

  public readonly seekTimelineToTick: SimulationAction["seekTimelineToTick"] = async (timelineTickNumber) => {
    if (!this.stateReadWrite.timeline.enabled) {
      return false;
    }

    const bridge = this.timelineBridge;
    if (bridge === null) {
      return false;
    }

    const targetTimelineTickNumber = Math.max(0, Math.trunc(timelineTickNumber));
    const previousCursorTickNumber = this.stateReadWrite.timeline.cursorTickNumber;
    const serial = ++this.timelineSeekSerial;
    runInAction(() => {
      this.stateReadWrite.timeline.isSeeking = true;
    });

    try {
      const checkpoint = await bridge.getTimelineCheckpoint(targetTimelineTickNumber);
      const runtimeExport = checkpoint.runtimeExport;
      if (serial !== this.timelineSeekSerial || runtimeExport === null) {
        return false;
      }

      const checkpointMetadata = this.resolveTimelineCheckpointMetadata(
        targetTimelineTickNumber,
        runtimeExport,
      );
      const crossesTimelineMark = this.stateReadWrite.timeline.marks.some((mark) =>
        mark.tickNumber > targetTimelineTickNumber,
      );
      const imported = await this.importTimelineRuntimeStateForSeek(serial, runtimeExport);
      if (serial !== this.timelineSeekSerial || imported === null) {
        return false;
      }

      this.topology.setSnapshot(runtimeExport.topology);
      if (checkpointMetadata === null) {
        this.compiledDocument = null;
        this.compiledActivitySignature = null;
      } else {
        this.compiledDocument = cloneWorldDocument(checkpointMetadata.document);
        this.compiledActivitySignature = checkpointMetadata.activitySignature;
      }
      runInAction(() => {
        this.stateReadWrite.runtimeStatus = imported.status;
        if (imported.result.status.status === "ready") {
          this.stateReadWrite.currentSnapshot = imported.result.currentTick;
          this.stateReadWrite.currentPlaybackTickNumber =
            imported.result.currentTick?.tickNumber ?? runtimeExport.snapshot.tickNumber;
          this.stateReadWrite.timeline.cursorTickNumber = targetTimelineTickNumber;
          this.updateTimelineWindowForSeek(targetTimelineTickNumber, previousCursorTickNumber);
          if (crossesTimelineMark) {
            this.stateReadWrite.timeline.marks = this.stateReadWrite.timeline.marks.filter((mark) =>
              mark.tickNumber <= targetTimelineTickNumber,
            );
            this.stateReadWrite.timeline.availableToTickNumber = Math.min(
              this.stateReadWrite.timeline.availableToTickNumber,
              targetTimelineTickNumber,
            );
          }
        }
      });

      const ready = imported.result.status.status === "ready";
      if (ready && crossesTimelineMark) {
        await this.restartTimelineFromCurrentSimulation();
      } else if (ready) {
        this.requestTimelineWindowRetarget();
      }

      return ready;
    } finally {
      if (serial === this.timelineSeekSerial) {
        runInAction(() => {
          this.stateReadWrite.timeline.isSeeking = false;
        });
      }
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
        this.syncTimelineCursorFromPlayback();
      }
    });

    // Perf 轮询：每 180 tick 阈值追赶
    if (response.result.status.status === "ready" && this.getPerfEnabled?.()) {
      this.pollPerfReport(tickNumber);
    }

    if (response.result.status.status === "ready") {
      void this.checkTimelineSafetySync(tickNumber);
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
        this.syncTimelineCursorFromPlayback({ retargetWindow: false });
      });
      await this.restartTimelineAfterPlaybackRollbackIfNeeded();
      return;
    }

    const recoveryStatus = await this.syncToTick(recoveryTickNumber, recoveryTickNumber);
    if (recoveryStatus.status !== "ready") {
      runInAction(() => {
        this.stateReadWrite.currentPlaybackTickNumber = fallbackPlaybackTickNumber;
        this.syncTimelineCursorFromPlayback({ retargetWindow: false });
      });
    }
    await this.restartTimelineAfterPlaybackRollbackIfNeeded();
  }

  private async restartTimelineFromCurrentSimulation(): Promise<void> {
    if (!this.stateReadWrite.timeline.enabled || this.timelineRestartInFlight) {
      return;
    }

    this.timelineRestartInFlight = true;
    try {
      const currentStandardTickNumber = this.stateReadWrite.currentSnapshot?.tickNumber
        ?? Math.trunc(this.stateReadWrite.currentPlaybackTickNumber);
      const startTimelineTickNumber = Math.max(
        0,
        Math.floor(currentStandardTickNumber / TIMELINE_STEP_STANDARD_TICKS),
      );
      const exported = await this.exportLatestAlignedTimelineRuntimeState(startTimelineTickNumber);
      if (exported === null || !this.stateReadWrite.timeline.enabled) {
        return;
      }

      const shouldPreserveExistingCheckpoints = this.timelineBridge !== null;
      const rebaseRange = this.resolveTimelineRebaseRange(
        exported.startTimelineTickNumber,
        shouldPreserveExistingCheckpoints,
      );
      const bridge = this.timelineBridge ?? this.createTimelineBridge();
      this.timelineBridge = bridge;
      const loaded = await bridge.loadTimeline({
        runtimeExport: exported.response.runtimeExport,
        startTimelineTickNumber: exported.startTimelineTickNumber,
        retainedFromTimelineTickNumber: rebaseRange.retainedFromTimelineTickNumber,
        targetTimelineTickNumber: rebaseRange.targetTimelineTickNumber,
        capacityTimelineTicks: TIMELINE_CAPACITY_TICKS,
        stepStandardTicks: TIMELINE_STEP_STANDARD_TICKS,
      });
      if (!this.stateReadWrite.timeline.enabled) {
        return;
      }

      this.rebaseTimelineCheckpointMetadata({
        startTimelineTickNumber: exported.startTimelineTickNumber,
        retainedFromTimelineTickNumber: rebaseRange.retainedFromTimelineTickNumber,
        targetTimelineTickNumber: rebaseRange.targetTimelineTickNumber,
      });
      this.lastTimelineRetargetRange = rebaseRange;
      runInAction(() => {
        this.applyTimelineStatus(loaded.status);
        this.syncTimelineCursorFromPlayback();
      });
    } finally {
      this.timelineRestartInFlight = false;
    }
  }

  private resolveTimelineRebaseRange(
    startTimelineTickNumber: number,
    shouldPreserveExistingCheckpoints: boolean,
  ): TimelineRebaseRange {
    const startTickNumber = Math.max(0, Math.trunc(startTimelineTickNumber));
    const windowStartTickNumber = shouldPreserveExistingCheckpoints
      ? Math.max(0, Math.floor(this.stateReadWrite.timeline.windowStartTickNumber))
      : startTickNumber;
    let retainedFromTickNumber = shouldPreserveExistingCheckpoints
      ? this.resolveTimelineHistoryRetainedFrom(windowStartTickNumber)
      : startTickNumber;
    retainedFromTickNumber = Math.min(retainedFromTickNumber, startTickNumber);

    let targetTimelineTickNumber = Math.max(
      startTickNumber,
      this.resolveTimelinePredictionTarget(windowStartTickNumber),
    );
    if (targetTimelineTickNumber < startTickNumber) {
      targetTimelineTickNumber = startTickNumber;
      retainedFromTickNumber = Math.max(0, targetTimelineTickNumber - TIMELINE_CAPACITY_TICKS + 1);
    }

    return {
      retainedFromTimelineTickNumber: retainedFromTickNumber,
      targetTimelineTickNumber,
    };
  }

  private resolveTimelineHistoryRetainedFrom(windowStartTickNumber: number): number {
    return Math.max(0, Math.floor(windowStartTickNumber) - TIMELINE_MAX_HISTORY_TICKS);
  }

  private resolveTimelinePredictionTarget(windowStartTickNumber: number): number {
    return Math.floor(windowStartTickNumber) + TIMELINE_CAPACITY_TICKS - 1 + TIMELINE_MAX_FUTURE_TICKS;
  }

  private rebaseTimelineCheckpointMetadata(options: {
    readonly startTimelineTickNumber: number;
    readonly retainedFromTimelineTickNumber: number;
    readonly targetTimelineTickNumber: number;
  }): void {
    for (const timelineTickNumber of this.timelineCheckpointMetadataByTickNumber.keys()) {
      if (
        timelineTickNumber < options.retainedFromTimelineTickNumber
        || timelineTickNumber > options.startTimelineTickNumber
      ) {
        this.timelineCheckpointMetadataByTickNumber.delete(timelineTickNumber);
      }
    }

    if (this.compiledDocument === null || this.compiledActivitySignature === null) {
      return;
    }

    const metadata: TimelineCheckpointMetadata = {
      document: cloneWorldDocument(this.compiledDocument),
      activitySignature: this.compiledActivitySignature,
    };
    for (
      let timelineTickNumber = options.startTimelineTickNumber;
      timelineTickNumber <= options.targetTimelineTickNumber;
      timelineTickNumber += 1
    ) {
      this.timelineCheckpointMetadataByTickNumber.set(timelineTickNumber, metadata);
    }
  }

  private requestTimelineWindowRetarget(): void {
    if (!this.stateReadWrite.timeline.enabled || this.timelineBridge === null) {
      return;
    }

    const range = this.resolveCurrentTimelineWindowRange();
    if (
      !this.timelineWindowRetargetInFlight
      && this.lastTimelineRetargetRange !== null
      && this.lastTimelineRetargetRange.retainedFromTimelineTickNumber === range.retainedFromTimelineTickNumber
      && this.lastTimelineRetargetRange.targetTimelineTickNumber === range.targetTimelineTickNumber
    ) {
      return;
    }

    if (this.timelineWindowRetargetInFlight) {
      this.timelineWindowRetargetPending = true;
      return;
    }

    void this.retargetTimelineWindow(range);
  }

  private resolveCurrentTimelineWindowRange(): TimelineRebaseRange {
    const windowStartTickNumber = Math.max(
      0,
      Math.floor(this.stateReadWrite.timeline.windowStartTickNumber),
    );
    const retainedFromTimelineTickNumber = this.resolveTimelineHistoryRetainedFrom(windowStartTickNumber);

    return {
      retainedFromTimelineTickNumber,
      targetTimelineTickNumber: this.resolveTimelinePredictionTarget(windowStartTickNumber),
    };
  }

  private async retargetTimelineWindow(range: TimelineRebaseRange): Promise<void> {
    const bridge = this.timelineBridge;
    if (bridge === null || !this.stateReadWrite.timeline.enabled) {
      return;
    }

    this.timelineWindowRetargetInFlight = true;
    try {
      const response = await bridge.retargetTimeline({
        retainedFromTimelineTickNumber: range.retainedFromTimelineTickNumber,
        targetTimelineTickNumber: range.targetTimelineTickNumber,
      });
      if (!this.stateReadWrite.timeline.enabled || this.timelineBridge !== bridge) {
        return;
      }

      this.retargetTimelineCheckpointMetadata(range);
      this.lastTimelineRetargetRange = range;
      runInAction(() => {
        this.applyTimelineStatus(response.status);
      });
    } catch {
      // timeline-worker 是辅助预测缓存，窗口续算失败不应影响正式 sim-worker。
    } finally {
      this.timelineWindowRetargetInFlight = false;
      if (this.timelineWindowRetargetPending) {
        this.timelineWindowRetargetPending = false;
        this.requestTimelineWindowRetarget();
      }
    }
  }

  private retargetTimelineCheckpointMetadata(range: TimelineRebaseRange): void {
    for (const timelineTickNumber of this.timelineCheckpointMetadataByTickNumber.keys()) {
      if (
        timelineTickNumber < range.retainedFromTimelineTickNumber
        || timelineTickNumber > range.targetTimelineTickNumber
      ) {
        this.timelineCheckpointMetadataByTickNumber.delete(timelineTickNumber);
      }
    }

    if (this.compiledDocument === null || this.compiledActivitySignature === null) {
      return;
    }

    const metadata: TimelineCheckpointMetadata = {
      document: cloneWorldDocument(this.compiledDocument),
      activitySignature: this.compiledActivitySignature,
    };
    for (
      let timelineTickNumber = range.retainedFromTimelineTickNumber;
      timelineTickNumber <= range.targetTimelineTickNumber;
      timelineTickNumber += 1
    ) {
      if (!this.timelineCheckpointMetadataByTickNumber.has(timelineTickNumber)) {
        this.timelineCheckpointMetadataByTickNumber.set(timelineTickNumber, metadata);
      }
    }
  }

  private async restartTimelineAfterPlaybackRollbackIfNeeded(): Promise<void> {
    if (!this.stateReadWrite.timeline.enabled) {
      return;
    }

    const cursorTickNumber = this.stateReadWrite.timeline.cursorTickNumber;
    if (
      cursorTickNumber >= this.stateReadWrite.timeline.availableFromTickNumber
      && cursorTickNumber <= this.stateReadWrite.timeline.availableToTickNumber
    ) {
      return;
    }

    await this.restartTimelineFromCurrentSimulation();
  }

  private async exportLatestAlignedTimelineRuntimeState(
    startTimelineTickNumber: number,
  ): Promise<{
    readonly startTimelineTickNumber: number;
    readonly response: Extract<SimulationWorkerResponse, { readonly type: "runtime-state-exported" }> & {
      readonly runtimeExport: SimulationRuntimeExport;
    };
  } | null> {
    let candidateTimelineTickNumber = startTimelineTickNumber;
    const visitedTimelineTickNumbers = new Set<number>();
    for (
      let attempt = 0;
      attempt <= TIMELINE_EXPORT_LOOKBACK_STEPS && candidateTimelineTickNumber >= 0;
      attempt += 1
    ) {
      visitedTimelineTickNumbers.add(candidateTimelineTickNumber);
      const exportTickNumber = candidateTimelineTickNumber * TIMELINE_STEP_STANDARD_TICKS;
      const exported = await this.bridge.exportRuntimeState(exportTickNumber);
      if (exported.runtimeExport !== null) {
        return {
          startTimelineTickNumber: candidateTimelineTickNumber,
          response: exported as typeof exported & { readonly runtimeExport: SimulationRuntimeExport },
        };
      }

      const latestTickNumber = exported.status.latestTickNumber;
      const retainedFromTick = exported.status.retainedFromTick;
      let nextCandidateTimelineTickNumber = candidateTimelineTickNumber - 1;
      if (retainedFromTick !== null && retainedFromTick > exportTickNumber) {
        nextCandidateTimelineTickNumber = Math.ceil(retainedFromTick / TIMELINE_STEP_STANDARD_TICKS);
      }
      if (latestTickNumber !== null && latestTickNumber < exportTickNumber) {
        nextCandidateTimelineTickNumber = Math.min(
          candidateTimelineTickNumber - 1,
          Math.floor(latestTickNumber / TIMELINE_STEP_STANDARD_TICKS),
        );
      }

      if (visitedTimelineTickNumbers.has(nextCandidateTimelineTickNumber)) {
        nextCandidateTimelineTickNumber = candidateTimelineTickNumber - 1;
      }
      candidateTimelineTickNumber = nextCandidateTimelineTickNumber;
    }

    return null;
  }

  private async importTimelineRuntimeStateForSeek(
    serial: number,
    runtimeExport: SimulationRuntimeExport,
  ): Promise<Extract<SimulationWorkerResponse, { readonly type: "runtime-state-imported" }> | null> {
    const previousImport = this.timelineSeekImportPromise ?? Promise.resolve();
    const importPromise = previousImport
      .catch(() => undefined)
      .then(async () => {
        if (serial !== this.timelineSeekSerial) {
          return null;
        }

        return this.bridge.importRuntimeState(runtimeExport);
      });

    const trackedPromise: Promise<Extract<SimulationWorkerResponse, { readonly type: "runtime-state-imported" }> | null> = importPromise.finally(() => {
      if (this.timelineSeekImportPromise === trackedPromise) {
        this.timelineSeekImportPromise = null;
      }
    });
    this.timelineSeekImportPromise = trackedPromise;

    return importPromise;
  }

  private resolveTimelineCheckpointMetadata(
    timelineTickNumber: number,
    runtimeExport: SimulationRuntimeExport,
  ): TimelineCheckpointMetadata | null {
    const metadata = this.timelineCheckpointMetadataByTickNumber.get(timelineTickNumber) ?? null;
    if (metadata === null) {
      return null;
    }

    if (createSimulationDocumentHash(metadata.document) !== runtimeExport.topology.documentHash) {
      console.debug(
        `[TimelineWorker] checkpoint document mismatch at timelineTick=${timelineTickNumber}`,
      );
      return null;
    }

    return metadata;
  }

  private startTimelineStatusPolling(): void {
    if (this.timelineStatusTimerId !== null) {
      return;
    }

    this.timelineStatusTimerId = setInterval(() => {
      void this.refreshTimelineStatus();
    }, TIMELINE_STATUS_POLL_MS);
  }

  private async refreshTimelineStatus(): Promise<void> {
    if (!this.stateReadWrite.timeline.enabled) {
      return;
    }

    const bridge = this.timelineBridge;
    if (bridge === null) {
      await this.restartTimelineFromCurrentSimulation();
      return;
    }

    try {
      const response = await bridge.getTimelineStatus();
      runInAction(() => {
        this.applyTimelineStatus(response.status);
      });
    } catch {
      // timeline-worker 是辅助预测缓存，状态轮询失败不应影响正式仿真。
    }
  }

  private applyTimelineStatus(status: TimelineWorkerStatus): void {
    this.stateReadWrite.timeline.availableFromTickNumber =
      status.availableFromTimelineTickNumber ?? this.stateReadWrite.timeline.cursorTickNumber;
    this.stateReadWrite.timeline.availableToTickNumber =
      status.availableToTimelineTickNumber ?? this.stateReadWrite.timeline.cursorTickNumber;
  }

  private addTimelineMark(kind: "document-change" | "runtime-change" | "safety-resync"): void {
    if (!this.stateReadWrite.timeline.enabled) {
      return;
    }

    const tickNumber = Math.max(
      0,
      Math.trunc(this.stateReadWrite.currentPlaybackTickNumber / TIMELINE_STEP_STANDARD_TICKS),
    );
    this.stateReadWrite.timeline.marks.push({
      id: `timeline-mark:${this.timelineMarkSerial}`,
      tickNumber,
      kind,
    });
    this.timelineMarkSerial += 1;
    this.stateReadWrite.timeline.availableToTickNumber = Math.min(
      this.stateReadWrite.timeline.availableToTickNumber,
      tickNumber,
    );
  }

  private syncTimelineCursorFromPlayback(options: {
    readonly retargetWindow?: boolean;
  } = {}): void {
    if (!this.stateReadWrite.timeline.enabled) {
      return;
    }

    const cursorTickNumber = Math.max(
      0,
      this.stateReadWrite.currentPlaybackTickNumber / TIMELINE_STEP_STANDARD_TICKS,
    );
    this.stateReadWrite.timeline.cursorTickNumber = cursorTickNumber;
    if (this.updateTimelineWindowForCursor(cursorTickNumber) && options.retargetWindow !== false) {
      this.requestTimelineWindowRetarget();
    }
  }

  private async checkTimelineSafetySync(tickNumber: number): Promise<void> {
    const timelineBridge = this.timelineBridge;
    if (!this.stateReadWrite.timeline.enabled || timelineBridge === null) {
      return;
    }

    const standardTickNumber = Math.max(0, Math.trunc(tickNumber));
    const safetyIntervalTicks = STANDARD_TICK_RATE_PER_SECOND * 60;
    if (
      standardTickNumber === 0
      || standardTickNumber % safetyIntervalTicks !== 0
      || standardTickNumber % TIMELINE_STEP_STANDARD_TICKS !== 0
      || this.lastTimelineSafetySyncStandardTick === standardTickNumber
    ) {
      return;
    }

    this.lastTimelineSafetySyncStandardTick = standardTickNumber;
    const timelineTickNumber = standardTickNumber / TIMELINE_STEP_STANDARD_TICKS;
    try {
      const [officialExport, timelineCheckpoint] = await Promise.all([
        this.bridge.exportRuntimeState(standardTickNumber),
        timelineBridge.getTimelineCheckpoint(timelineTickNumber),
      ]);
      if (
        officialExport.runtimeExport === null
        || timelineCheckpoint.runtimeExport === null
      ) {
        return;
      }

      if (
        JSON.stringify(officialExport.runtimeExport.snapshot)
        === JSON.stringify(timelineCheckpoint.runtimeExport.snapshot)
      ) {
        return;
      }

      console.debug(
        `[TimelineWorker] safety resync at standardTick=${standardTickNumber} timelineTick=${timelineTickNumber}`,
      );
      runInAction(() => {
        this.addTimelineMark("safety-resync");
      });
      await this.restartTimelineFromCurrentSimulation();
    } catch {
      // 安全同步是兜底机制，失败时不影响正式 sim-worker 的播放。
    }
  }

  private updateTimelineWindowForCursor(cursorTickNumber: number): boolean {
    const anchorOffsetTicks =
      this.timelinePlaybackAnchorOffsetTicks ?? TIMELINE_DEFAULT_PLAYBACK_ANCHOR_OFFSET_TICKS;
    const currentWindowStart = this.stateReadWrite.timeline.windowStartTickNumber;
    if (cursorTickNumber > currentWindowStart + anchorOffsetTicks) {
      this.stateReadWrite.timeline.windowStartTickNumber = cursorTickNumber - anchorOffsetTicks;
      return true;
    }

    if (cursorTickNumber < currentWindowStart) {
      this.stateReadWrite.timeline.windowStartTickNumber = cursorTickNumber;
      return true;
    }

    return false;
  }

  private updateTimelineWindowForSeek(
    targetTimelineTickNumber: number,
    previousCursorTickNumber: number,
  ): void {
    const currentWindowStart = this.stateReadWrite.timeline.windowStartTickNumber;
    const relativeTickNumber = targetTimelineTickNumber - currentWindowStart;
    if (relativeTickNumber < TIMELINE_SEEK_LEFT_EDGE_SCROLL_ANCHOR_OFFSET_TICKS) {
      this.timelinePlaybackAnchorOffsetTicks = null;
      const retainedFromTickNumber = Math.max(
        0,
        Math.floor(this.stateReadWrite.timeline.availableFromTickNumber),
      );
      const targetWindowStart = Math.max(
        retainedFromTickNumber,
        targetTimelineTickNumber - TIMELINE_SEEK_LEFT_EDGE_SCROLL_ANCHOR_OFFSET_TICKS,
      );
      if (targetWindowStart < currentWindowStart) {
        this.stateReadWrite.timeline.windowStartTickNumber = targetWindowStart;
      }
      return;
    }

    if (
      targetTimelineTickNumber < previousCursorTickNumber
      || relativeTickNumber < TIMELINE_DEFAULT_PLAYBACK_ANCHOR_OFFSET_TICKS
    ) {
      this.timelinePlaybackAnchorOffsetTicks = null;
      if (targetTimelineTickNumber < currentWindowStart) {
        this.stateReadWrite.timeline.windowStartTickNumber = targetTimelineTickNumber;
      }
      return;
    }

    if (relativeTickNumber > TIMELINE_SEEK_EDGE_SCROLL_ANCHOR_OFFSET_TICKS) {
      this.timelinePlaybackAnchorOffsetTicks = TIMELINE_SEEK_EDGE_SCROLL_ANCHOR_OFFSET_TICKS;
      this.stateReadWrite.timeline.windowStartTickNumber = Math.max(
        0,
        targetTimelineTickNumber - TIMELINE_SEEK_EDGE_SCROLL_ANCHOR_OFFSET_TICKS,
      );
      return;
    }

    this.timelinePlaybackAnchorOffsetTicks = relativeTickNumber;
  }

  private stopTimelineWorker(): void {
    if (this.timelineStatusTimerId !== null) {
      clearInterval(this.timelineStatusTimerId);
      this.timelineStatusTimerId = null;
    }
    this.timelineSeekSerial += 1;
    this.lastTimelineSafetySyncStandardTick = null;
    this.timelineWindowRetargetInFlight = false;
    this.timelineWindowRetargetPending = false;
    this.lastTimelineRetargetRange = null;
    this.timelinePlaybackAnchorOffsetTicks = null;
    this.timelineCheckpointMetadataByTickNumber.clear();
    this.timelineBridge?.dispose();
    this.timelineBridge = null;
  }

  private clearPlaybackProgress(): void {
    this.stopTimelineWorker();
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
    Object.assign(this.stateReadWrite.timeline, createInitialSimulationTimelineState());
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
