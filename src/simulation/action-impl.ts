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
import { createLogger } from "@/shared/logging/logger";
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
  RuntimeTickSnapshot,
  SimulationStartResult,
  SimulationTickPullStatus,
  SimulationTopologyMigration,
  SimulationRuntimeExport,
  SimulationRuntimeTransition,
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
const TIMELINE_ORIGIN_STANDARD_TICK = 1;
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
const TIMELINE_PRESENTATION_COMMIT_IDLE_MS = 1000;
const TIMELINE_PRESENTATION_CACHE_DIRECTION_TICKS = 1;
const TIMELINE_PRESENTATION_CACHE_OPPOSITE_TICKS = 0;
const TIMELINE_PRESENTATION_CACHE_CAPACITY = 80;
const PLAYBACK_HOT_QUEUE_CAPACITY = 20;
const PLAYBACK_HOT_QUEUE_LOW_WATER = 10;
const PLAYBACK_PREFETCH_RETRY_MS = 50;

const logger = createLogger("simulation-runtime");

function resolveStandardTickNumberForTimelineTick(timelineTickNumber: number): number {
  return TIMELINE_ORIGIN_STANDARD_TICK
    + timelineTickNumber * TIMELINE_STEP_STANDARD_TICKS;
}

function resolveTimelineTickNumberForStandardTick(standardTickNumber: number): number {
  return (standardTickNumber - TIMELINE_ORIGIN_STANDARD_TICK)
    / TIMELINE_STEP_STANDARD_TICKS;
}

function logTopologyRuntimeTransition(
  transition: SimulationRuntimeTransition | undefined,
): void {
  if (transition === undefined) {
    return;
  }

  const resetDevices = transition.resetDeviceIds.length === 0
    ? "none"
    : transition.resetDeviceIds.join(", ");
  const message = transition.kind === "topology-hot-swap"
    ? `Simulation topology hot-swapped at tick ${transition.baseTickNumber}. Reason: ${transition.reason}. Preserved unaffected device runtime state; reset devices: [${resetDevices}]. Future snapshots invalidated from tick ${transition.invalidatedFromTickNumber}.`
    : transition.kind === "full-reset"
      ? `Simulation runtime fully reset at tick ${transition.baseTickNumber}. Reason: ${transition.reason}. Reset devices: [${resetDevices}].`
      : transition.kind === "migration-rejected"
        ? `Simulation topology migration rejected at tick ${transition.baseTickNumber}. Reason: ${transition.reason}. Existing simulation runtime remains active.`
        : `Simulation runtime initialized at tick ${transition.baseTickNumber}. Reason: ${transition.reason}.`;

  if (transition.kind === "full-reset" || transition.kind === "migration-rejected") {
    logger.warn(message);
    return;
  }

  logger.info(message);
}

export interface SimulationWorkerBridge {
  loadTopology(topology: CompiledSimulationTopology, migration?: SimulationTopologyMigration, perfEnabled?: boolean, simulationSpeed?: number, debugDataEnabled?: boolean): Promise<Extract<
    SimulationWorkerResponse,
    { readonly type: "topology-loaded" }
  >>;
  getTickSnapshot(tickNumber: number, simulationSpeed?: number, retainTickNumber?: number): Promise<Extract<
    SimulationWorkerResponse,
    { readonly type: "tick-snapshot-result" }
  >>;
  getTickSnapshotRange(fromTickNumber: number, toTickNumber: number, generation: number, simulationSpeed?: number): Promise<Extract<
    SimulationWorkerResponse,
    { readonly type: "tick-snapshot-range-result" }
  >>;
  acknowledgePresentedTick(tickNumber: number, generation: number): Promise<Extract<
    SimulationWorkerResponse,
    { readonly type: "presented-tick-acknowledged" }
  >>;
  setDebugEnabled(value: boolean): Promise<Extract<
    SimulationWorkerResponse,
    { readonly type: "debug-enabled-set" }
  >>;
  setDebugDataEnabled(value: boolean): Promise<Extract<
    SimulationWorkerResponse,
    { readonly type: "debug-data-enabled-set" }
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
  getTimelinePresentationFrame(timelineTickNumber: number): Promise<Extract<TimelineWorkerResponse, { readonly type: "timeline-presentation-frame-result" }>>;
  getTimelinePresentationFrameRange(fromTimelineTickNumber: number, toTimelineTickNumber: number): Promise<Extract<
    TimelineWorkerResponse,
    { readonly type: "timeline-presentation-frame-range-result" }
  >>;
  getTimelineCheckpoint(timelineTickNumber: number): Promise<Extract<TimelineWorkerResponse, { readonly type: "timeline-checkpoint-result" }>>;
  stopTimeline(): Promise<Extract<TimelineWorkerResponse, { readonly type: "timeline-stopped" }>>;
  dispose(): void;
}

export interface SimulationInternalAction {
  refreshFromCurrentDocument(): Promise<SimulationStartResult>;
  syncToTick(tickNumber: number, playbackTickNumberOnReady?: number): Promise<SimulationTickPullStatus>;
  /** 同步轻量 Worker 性能统计；不会开启完整 debugData。 */
  setDebugEnabled(value: boolean): void;
  /** 单独控制完整 debugData 的构造与传输。 */
  setDebugDataEnabled(value: boolean): void;
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
  getDebugDataEnabled?: () => boolean;
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

interface TopologyPresentationBoundary {
  readonly maxPlaybackTickNumber: number;
  readonly reached: Promise<void>;
  readonly resolveReached: () => void;
}

interface TimelinePresentationSeekRequest {
  readonly targetTimelineTickNumber: number;
  readonly revision: number;
  readonly resolve: (applied: boolean) => void;
  readonly reject: (error: unknown) => void;
}

function createMissingTimelineWorkerBridge(): TimelineWorkerBridge {
  throw new Error("Timeline worker bridge is not configured.");
}

// === timeline safety sync 诊断辅助 ===

/** JSON.stringify replacer：对 object 按键名排序后再序列化，消除键迭代顺序差异。 */
function sortedKeysReplacer(_key: string, value: unknown): unknown {
  if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
    return Object.keys(value as Record<string, unknown>)
      .sort()
      .reduce<Record<string, unknown>>((acc, k) => {
        acc[k] = (value as Record<string, unknown>)[k];
        return acc;
      }, {});
  }
  return value;
}

/**
 * 深度比较两个快照对象，返回前 maxDiffs 条差异路径 + 值的描述。
 * 差异仅回溯对象/数组路径，不递归值的内容（避免海量输出）。
 */
function deepDiffSnapshots(
  a: unknown,
  b: unknown,
  path: string,
  maxDiffs: number,
): string[] {
  const diffs: string[] = [];
  walkDiff(a, b, path, diffs, maxDiffs);
  return diffs;
}

function walkDiff(
  a: unknown,
  b: unknown,
  path: string,
  diffs: string[],
  limit: number,
): void {
  if (diffs.length >= limit) return;

  if (a === b) return;

  if (a === null || b === null || typeof a !== typeof b) {
    diffs.push(`${path || '<root>'}: ${safeDiffString(a)} !== ${safeDiffString(b)}`);
    return;
  }

  if (Array.isArray(a) && Array.isArray(b)) {
    if (a.length !== b.length) {
      diffs.push(`${path}: lengths ${a.length} !== ${b.length}`);
      if (diffs.length >= limit) return;
    }
    const minLen = Math.min(a.length, b.length);
    for (let i = 0; i < minLen && diffs.length < limit; i++) {
      walkDiff(a[i], b[i], `${path}[${i}]`, diffs, limit);
    }
    return;
  }

  if (typeof a === 'object' && typeof b === 'object') {
    const aObj = a as Record<string, unknown>;
    const bObj = b as Record<string, unknown>;
    const allKeys = new Set([...Object.keys(aObj), ...Object.keys(bObj)]);
    for (const key of allKeys) {
      if (diffs.length >= limit) break;
      if (!(key in aObj)) {
        diffs.push(`${path}.${key}: missing in official, timeline=${safeDiffString(bObj[key])}`);
      } else if (!(key in bObj)) {
        diffs.push(`${path}.${key}: missing in timeline, official=${safeDiffString(aObj[key])}`);
      } else {
        walkDiff(aObj[key], bObj[key], `${path}.${key}`, diffs, limit);
      }
    }
    return;
  }

  // primitives
  diffs.push(`${path || '<root>'}: ${safeDiffString(a)} !== ${safeDiffString(b)}`);
}

/** 安全的差异值截断，对象/Math只打 type。 */
function safeDiffString(value: unknown): string {
  if (value === null) return 'null';
  if (value === undefined) return 'undefined';
  if (typeof value === 'object') {
    if (Array.isArray(value)) return `Array(${value.length})`;
    return `Object(keys=${Object.keys(value as Record<string, unknown>).length})`;
  }
  const s = String(value);
  return s.length > 80 ? s.slice(0, 77) + '...' : s;
}

export class SimulationActionImpl
implements SimulationAction, SimulationInternalAction {
  private readonly workspace: WorkspaceContract;
  private readonly stateReadWrite: SimulationStateReadWrite;
  private readonly topology: SnapshotStoreReadWrite<CompiledSimulationTopology | null>;
  private readonly bridge: SimulationWorkerBridge;
  private readonly createTimelineBridge: () => TimelineWorkerBridge;
  private readonly getPerfEnabled: (() => boolean) | undefined;
  private readonly getDebugDataEnabled: (() => boolean) | undefined;
  private readonly getActiveActivityIds: (() => readonly string[]) | undefined;
  private compiledDocument: WorldDocument | null = null;
  private compiledActivitySignature: string | null = null;
  private tpsAccumulatedTicks = 0;
  private tpsAccumulatedMs = 0;
  private nextPerfReportTick = 180;
  private playbackTickRequestInFlight = false;
  private playbackTickRequestCompletion: Promise<void> | null = null;
  private playbackTargetTickNumber = 0;
  private readonly playbackHotQueue = new Map<number, RuntimeTickSnapshot>();
  private playbackHotQueueGeneration = 0;
  private playbackPrefetchRetryAfterMs = 0;
  private playbackAckRequestInFlight = false;
  private pendingPlaybackAckTickNumber: number | null = null;
  private timelineBridge: TimelineWorkerBridge | null = null;
  private timelineStatusTimerId: ReturnType<typeof setInterval> | null = null;
  private timelineStatusRefreshInFlight = false;
  private timelineSeekSerial = 0;
  private timelineSeekImportPromise: Promise<unknown> | null = null;
  private timelinePresentationSeekRunning = false;
  private pendingTimelinePresentationSeek: TimelinePresentationSeekRequest | null = null;
  private timelinePresentationCommitTarget: number | null = null;
  private timelinePresentationCommitRevision = 0;
  private timelinePresentationCommitTimerId: ReturnType<typeof setTimeout> | null = null;
  private timelinePresentationCommitPromise: Promise<boolean> | null = null;
  private readonly timelinePresentationFrameCache = new Map<number, RuntimeTickSnapshot>();
  private timelineResumeRequestedAfterCommit = false;
  private timelineResumeAfterCommitPromise: Promise<void> | null = null;
  private timelineRestartInFlight = false;
  private timelineWindowRetargetInFlight = false;
  private timelineWindowRetargetPending = false;
  private lastTimelineRetargetRange: TimelineRebaseRange | null = null;
  private timelinePlaybackAnchorOffsetTicks: number | null = null;
  private timelineMarkSerial = 1;
  private lastTimelineSafetySyncStandardTick: number | null = null;
  private readonly timelineCheckpointMetadataByTickNumber = new Map<number, TimelineCheckpointMetadata>();
  private topologyRefreshQueue: Promise<void> | null = null;
  private topologyPresentationBoundary: TopologyPresentationBoundary | null = null;
  private topologyRevision = 0;
  private lastWorkerDebugEnabled: boolean | null = null;
  private lastWorkerDebugDataEnabled: boolean | null = null;

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
    this.getDebugDataEnabled = options.getDebugDataEnabled;
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
      this.ensurePlaybackHotQueue();
    }
  };

  public readonly pause: SimulationAction["pause"] = action(() => {
    this.timelineResumeRequestedAfterCommit = false;
    this.stateReadWrite.runningState = "pause";
    this.completeTopologyPresentationBoundary(true);
  });

  public readonly resume: SimulationAction["resume"] = action(() => {
    if (this.stateReadWrite.runningState !== "pause") {
      return;
    }

    if (
      this.timelinePresentationCommitTarget !== null
      || this.timelinePresentationCommitPromise !== null
    ) {
      this.timelineResumeRequestedAfterCommit = true;
      if (this.timelineResumeAfterCommitPromise === null) {
        const resumePromise = this.resumeAfterTimelinePresentationCommitted();
        const trackedResumePromise = resumePromise.finally(() => {
          if (this.timelineResumeAfterCommitPromise === trackedResumePromise) {
            this.timelineResumeAfterCommitPromise = null;
          }
        });
        this.timelineResumeAfterCommitPromise = trackedResumePromise;
      }
      return;
    }

    this.stateReadWrite.runningState = "start";
    this.ensurePlaybackHotQueue();
  });

  public readonly stop: SimulationAction["stop"] = action(() => {
    this.clearPlaybackProgress();
  });

  public readonly advancePlaybackByDeltaMs: SimulationAction["advancePlaybackByDeltaMs"] = async (
    deltaMs,
  ) => {
    // 诊断统计必须在调用点服从 debugMode 总开关，关闭时连每帧累计都不执行。
    if (this.getPerfEnabled?.() === true) {
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
    }

    if (this.stateReadWrite.runningState !== "start") {
      return;
    }

    this.ensurePlaybackHotQueue();

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
    // AI-CORRECTION 2026-07-15: 墙钟目标继续累计，但公开播放游标必须受已展示快照与本帧步长约束；
    // Worker 背压期间冻结在下一边界，恢复后逐步消费欠账，不能一次跳到最新墙钟目标。
    runInAction(() => {
      this.playbackTargetTickNumber = Math.max(
        this.playbackTargetTickNumber,
        this.stateReadWrite.currentPlaybackTickNumber,
      ) + tickDelta;
      const synchronizedTickNumber = this.stateReadWrite.currentSnapshot?.tickNumber
        ?? Math.min(
          Math.trunc(previousPlaybackTickNumber),
          this.stateReadWrite.runtimeStatus.latestTickNumber ?? 0,
        );
      const maxFrameStepTicks = Math.max(1, Math.ceil(Math.max(0, tickDelta)));
      const migrationBoundaryTickNumber = this.topologyPresentationBoundary?.maxPlaybackTickNumber
        ?? Number.POSITIVE_INFINITY;
      this.stateReadWrite.currentPlaybackTickNumber = Math.max(
        previousPlaybackTickNumber,
        Math.min(
          this.playbackTargetTickNumber,
          synchronizedTickNumber + maxFrameStepTicks,
          migrationBoundaryTickNumber,
        ),
      );
      this.syncTimelineCursorFromPlayback();
    });
    this.resolveReachedTopologyPresentationBoundary();

    const previousIntegerTickNumber = Math.trunc(previousPlaybackTickNumber);
    const nextIntegerTickNumber = Math.trunc(this.stateReadWrite.currentPlaybackTickNumber);

    // 计算本 delta 内实际获得的整数 tick 数，用于 TPS 统计
    let actualTicksProcessed = 0;

    const synchronizedTickNumber = this.stateReadWrite.currentSnapshot?.tickNumber
      ?? Math.min(
        previousIntegerTickNumber,
        this.stateReadWrite.runtimeStatus.latestTickNumber ?? 0,
      );
    if (synchronizedTickNumber >= nextIntegerTickNumber) {
      // 未跨越整数 tick 边界
      // AI-CORRECTION 2026-07-15: 此处同时覆盖“已经跨界且对应快照已同步”；是否拉取由播放目标与当前快照的差值决定。
      this.diagConsecutiveRollbacks = 0;
      this.accumulateTps(deltaMs, actualTicksProcessed);
      return;
    }

    this.diagCrossCount += 1;

    // bridge 在途时跳过本帧请求，但位置已推进；将位置回退到整数边界之下，
    // 确保 bridge 返回后下一帧再次跨越同一 tick 边界，不会丢 tick。
    // AI-CORRECTION 2026-07-15: 播放位置必须保持单调；请求完成或拓扑迁移结束后，按当前快照与最新播放目标的差值追赶。
    // AI-CORRECTION 2026-07-15: “追赶”必须受当前快照 + 本帧步长限制；在途期间公开游标停在待拉取边界，不能越过它累计可见欠账。
    // AI-CORRECTION 2026-07-17: 正常播放不再逐 Tick 等待 bridge；优先同步消费主线程热队列，
    // 仅在热队列缺口或拓扑刷新时冻结于边界，范围预取继续在后台补充。
    if (this.topologyRefreshQueue !== null) {
      this.diagInFlightSkipCount += 1;
      this.diagConsecutiveRollbacks += 1;
      this.diagMaxConsecutiveRollbacks = Math.max(this.diagMaxConsecutiveRollbacks, this.diagConsecutiveRollbacks);
      // AI-REMOVED 2026-07-15:
      // Reason: 在途请求或拓扑迁移期间回写整数边界会让连续播放游标倒退，并重复播放同一 tick 区间。
      // Trigger: 摆放或切换设备触发迁移时，画面出现顿挫和回退。
      // Evidence: currentPlaybackTickNumber 已按墙钟推进，但这里又覆盖为 nextIntegerTickNumber - 1e-9。
      // Replacement: 本分支保留单调播放目标；后续帧依据 synchronizedTickNumber 与最新目标主动追赶。
      // Risk: Low；Worker 落后时快照会短暂滞后，但游标不再倒退。
      // Human Review: Required
      //
      // Original code:
      // runInAction(() => {
      //   this.stateReadWrite.currentPlaybackTickNumber = nextIntegerTickNumber - 1e-9;
      // });
      this.accumulateTps(deltaMs, 0);
      return;
    }

    const prefetchedSnapshot = this.takePlaybackSnapshotThrough(
      synchronizedTickNumber + 1,
      nextIntegerTickNumber,
    );
    if (prefetchedSnapshot === null) {
      if (this.playbackTickRequestInFlight) {
        this.diagInFlightSkipCount += 1;
      } else {
        this.diagNotReadyCount += 1;
      }
      this.diagConsecutiveRollbacks += 1;
      this.diagMaxConsecutiveRollbacks = Math.max(
        this.diagMaxConsecutiveRollbacks,
        this.diagConsecutiveRollbacks,
      );
      this.ensurePlaybackHotQueue();
      this.accumulateTps(deltaMs, 0);
      return;
    }

    this.diagConsecutiveRollbacks = 0;
    this.publishPlaybackSnapshot(prefetchedSnapshot);
    actualTicksProcessed = Math.max(
      0,
      prefetchedSnapshot.tickNumber - synchronizedTickNumber,
    );
    this.diagTickConsumedCount += actualTicksProcessed;
    this.accumulateTps(deltaMs, actualTicksProcessed);
    this.acknowledgePresentedTick(prefetchedSnapshot.tickNumber);
    this.ensurePlaybackHotQueue();
  };

  /** 仅当目标区间完整存在时才原子消费，避免跨过缺失 Tick。 */
  /** AI-CORRECTION 2026-07-22: 现在消费截至首个缺口前的最长连续前缀，避免部分范围响应与低水位条件形成永久等待。 */
  private takePlaybackSnapshotThrough(
    fromTickNumber: number,
    toTickNumber: number,
  ): RuntimeTickSnapshot | null {
    let availableToTickNumber = fromTickNumber - 1;
    for (let tickNumber = fromTickNumber; tickNumber <= toTickNumber; tickNumber += 1) {
      if (!this.playbackHotQueue.has(tickNumber)) {
        break;
      }
      availableToTickNumber = tickNumber;
    }

    if (availableToTickNumber < fromTickNumber) {
      return null;
    }

    let snapshot: RuntimeTickSnapshot | null = null;
    for (let tickNumber = fromTickNumber; tickNumber <= availableToTickNumber; tickNumber += 1) {
      snapshot = this.playbackHotQueue.get(tickNumber) ?? null;
      this.playbackHotQueue.delete(tickNumber);
    }
    return snapshot;
  }

  private publishPlaybackSnapshot(snapshot: RuntimeTickSnapshot): void {
    runInAction(() => {
      this.stateReadWrite.currentSnapshot = snapshot;
      this.stateReadWrite.statistics = {
        ...this.stateReadWrite.statistics,
        baseBatteryJoules: snapshot.baseBatteryJoules,
        baseBatteryCapacity: snapshot.baseBatteryCapacity,
      };
      this.syncTimelineCursorFromPlayback();
    });

    if (this.getPerfEnabled?.()) {
      void this.pollPerfReport(snapshot.tickNumber);
    }
    void this.checkTimelineSafetySync(snapshot.tickNumber);
  }

  /** 低于低水位时补到容量上限；任意时刻最多一个范围请求在途。 */
  private ensurePlaybackHotQueue(): void {
    const currentSnapshot = this.stateReadWrite.currentSnapshot;
    if (
      currentSnapshot === null
      || this.stateReadWrite.runningState !== "start"
      || this.topologyRefreshQueue !== null
      || this.stateReadWrite.timeline.isSeeking
      || this.playbackTickRequestInFlight
      || this.playbackHotQueue.size >= PLAYBACK_HOT_QUEUE_LOW_WATER
      || performance.now() < this.playbackPrefetchRetryAfterMs
    ) {
      return;
    }

    const generation = this.playbackHotQueueGeneration;
    const fallbackPlaybackTickNumber = this.stateReadWrite.currentPlaybackTickNumber;
    const fromTickNumber = currentSnapshot.tickNumber + this.playbackHotQueue.size + 1;
    const requestCount = PLAYBACK_HOT_QUEUE_CAPACITY - this.playbackHotQueue.size;
    const toTickNumber = fromTickNumber + requestCount - 1;
    this.playbackTickRequestInFlight = true;

    const completion = this.bridge.getTickSnapshotRange(
      fromTickNumber,
      toTickNumber,
      generation,
      this.stateReadWrite.simulationSpeed,
    ).then(async (response) => {
      if (
        generation !== this.playbackHotQueueGeneration
        || response.result.generation !== generation
      ) {
        return;
      }

      runInAction(() => {
        this.stateReadWrite.runtimeStatus = response.status;
      });

      let expectedTickNumber = fromTickNumber;
      for (const snapshot of response.result.snapshots) {
        if (
          snapshot.tickNumber !== expectedTickNumber
          || snapshot.topologyId !== currentSnapshot.topologyId
          || snapshot.documentHash !== currentSnapshot.documentHash
        ) {
          break;
        }
        this.playbackHotQueue.set(snapshot.tickNumber, snapshot);
        expectedTickNumber += 1;
      }

      if (response.result.snapshots.length === 0) {
        this.playbackPrefetchRetryAfterMs = performance.now() + PLAYBACK_PREFETCH_RETRY_MS;
      }

      if (response.result.status.status === "not-found") {
        await this.recoverPlaybackFromUnavailableTick(
          response.result.status,
          fallbackPlaybackTickNumber,
        );
      }
    }).catch((error: unknown) => {
      if (generation === this.playbackHotQueueGeneration) {
        this.playbackPrefetchRetryAfterMs = performance.now() + PLAYBACK_PREFETCH_RETRY_MS;
        console.error("[SimHost] Failed to prefetch playback ticks.", error);
      }
    });

    const trackedCompletion = completion.finally(() => {
      if (this.playbackTickRequestCompletion === trackedCompletion) {
        this.playbackTickRequestInFlight = false;
        this.playbackTickRequestCompletion = null;
      }
    });
    this.playbackTickRequestCompletion = trackedCompletion;
  }

  /** ACK 只影响 Worker 清理进度，不阻塞当前帧；在途期间合并到最新 Tick。 */
  private acknowledgePresentedTick(tickNumber: number): void {
    this.pendingPlaybackAckTickNumber = Math.max(
      this.pendingPlaybackAckTickNumber ?? tickNumber,
      tickNumber,
    );
    this.flushPlaybackAcknowledgement();
  }

  private flushPlaybackAcknowledgement(): void {
    if (
      this.playbackAckRequestInFlight
      || this.pendingPlaybackAckTickNumber === null
    ) {
      return;
    }

    const generation = this.playbackHotQueueGeneration;
    const tickNumber = this.pendingPlaybackAckTickNumber;
    this.pendingPlaybackAckTickNumber = null;
    this.playbackAckRequestInFlight = true;
    void this.bridge.acknowledgePresentedTick(tickNumber, generation)
      .then((response) => {
        if (
          generation === this.playbackHotQueueGeneration
          && response.generation === generation
        ) {
          runInAction(() => {
            this.stateReadWrite.runtimeStatus = response.status;
          });
        }
      })
      .catch((error: unknown) => {
        if (generation === this.playbackHotQueueGeneration) {
          console.error("[SimHost] Failed to acknowledge presented tick.", error);
        }
      })
      .finally(() => {
        this.playbackAckRequestInFlight = false;
        this.flushPlaybackAcknowledgement();
      });
  }

  /** 使所有已缓存及在途范围响应失效；异步响应由 generation 检查丢弃。 */
  private resetPlaybackHotQueue(): void {
    this.playbackHotQueueGeneration += 1;
    this.playbackHotQueue.clear();
    this.playbackPrefetchRetryAfterMs = 0;
    this.pendingPlaybackAckTickNumber = null;
    this.playbackTickRequestInFlight = false;
    this.playbackTickRequestCompletion = null;
  }

  public readonly refreshFromCurrentDocument: SimulationInternalAction["refreshFromCurrentDocument"] = () => {
    const queuedRefresh = this.topologyRefreshQueue;
    const refresh = queuedRefresh === null
      ? this.refreshFromCurrentDocumentNow()
      : queuedRefresh.then(() => this.refreshFromCurrentDocumentNow());
    const completion = refresh.then(
      () => undefined,
      () => undefined,
    );
    this.topologyRefreshQueue = completion;
    void completion.then(() => {
      if (this.topologyRefreshQueue === completion) {
        this.topologyRefreshQueue = null;
      }
    });
    return refresh;
  };

  private readonly refreshFromCurrentDocumentNow = async (): Promise<SimulationStartResult> => {
    const playbackTickRequestCompletion = this.playbackTickRequestCompletion;
    if (playbackTickRequestCompletion !== null) {
      await playbackTickRequestCompletion;
    }

    const sourceDocument = this.workspace.editor?.document.getSnapshot();
    if (sourceDocument === undefined) {
      this.topology.setSnapshot(null);
      this.compiledDocument = null;
      this.compiledActivitySignature = null;
      runInAction(() => {
        this.stateReadWrite.currentSnapshot = null;
        this.stateReadWrite.currentPlaybackTickNumber = 0;
        this.playbackTargetTickNumber = 0;
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

    this.topologyRevision += 1;
    this.resetPlaybackHotQueue();
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
    const displayedTickNumber = this.stateReadWrite.currentSnapshot?.tickNumber ?? 0;
    const nextTickNumber = displayedTickNumber + 1;
    const canMigrateAtNextTick = previousDocument !== null
      && previousTopology !== null
      && this.stateReadWrite.runningState === "start"
      && this.stateReadWrite.simulationSpeed > 0
      && (this.stateReadWrite.runtimeStatus.latestTickNumber ?? displayedTickNumber) >= nextTickNumber;
    const baseTickNumber = canMigrateAtNextTick ? nextTickNumber : displayedTickNumber;
    // AI-REMOVED 2026-07-15:
    // Reason: 迁移开始时捕获的浮点播放游标会在异步迁移结束后变成旧值，不能再用于恢复播放位置。
    // Trigger: 设备拓扑迁移完成时画面回退。
    // Evidence: RAF 在 bridge.loadTopology 等待期间持续推进 currentPlaybackTickNumber。
    // Replacement: 迁移完成后直接读取最新 currentPlaybackTickNumber，并用新拓扑追赶其整数目标。
    // Risk: Low。
    // Human Review: Required
    //
    // Original code:
    // const playbackTickNumber = this.stateReadWrite.currentPlaybackTickNumber;
    // AI-CORRECTION 2026-07-15: 新实现不再在迁移完成时追赶最新游标；它冻结公开游标到迁移边界，私有墙钟目标由正常播放逐步消费。
    const migration = createSimulationTopologyMigration({
      previousDocument,
      nextDocument: document,
      previousTopology,
      nextTopology: compiledTopology,
      baseTickNumber,
    });
    const presentationBoundary = migration === null
      ? null
      : this.beginTopologyPresentationBoundary(
          canMigrateAtNextTick
            ? baseTickNumber
            : this.stateReadWrite.currentPlaybackTickNumber,
        );
    const perfEnabled = this.getPerfEnabled?.() ?? false;
    const debugDataEnabled = this.getDebugDataEnabled?.() ?? false;
    let response: Awaited<ReturnType<SimulationWorkerBridge["loadTopology"]>>;
    this.lastWorkerDebugEnabled = perfEnabled;
    this.lastWorkerDebugDataEnabled = debugDataEnabled;
    try {
      response = await this.bridge.loadTopology(
        compiledTopology,
        migration ?? undefined,
        perfEnabled,
        this.stateReadWrite.simulationSpeed,
        debugDataEnabled,
      );
    } catch (error) {
      if (this.lastWorkerDebugEnabled === perfEnabled) {
        this.lastWorkerDebugEnabled = null;
      }
      if (this.lastWorkerDebugDataEnabled === debugDataEnabled) {
        this.lastWorkerDebugDataEnabled = null;
      }
      this.releaseTopologyPresentationBoundary(presentationBoundary);
      throw error;
    }
    logTopologyRuntimeTransition(response.result.runtimeTransition);
    if (response.result.status !== "started") {
      this.releaseTopologyPresentationBoundary(presentationBoundary);
      runInAction(() => {
        this.stateReadWrite.runtimeStatus = response.status;
      });
      return response.result;
    }
    if (presentationBoundary !== null) {
      await presentationBoundary.reached;
    }
    this.topology.setSnapshot(compiledTopology);
    this.compiledDocument = cloneWorldDocument(document);
    this.compiledActivitySignature = nextActivitySignature;

    runInAction(() => {
      this.stateReadWrite.runtimeStatus = response.status;
    });

    const targetTickNumber = response.result.runtimeTransition?.baseTickNumber
      ?? migration?.baseTickNumber
      ?? 0;
    // AI-REMOVED 2026-07-15:
    // Reason: topology migration 不得把播放游标恢复为异步请求前的旧值。
    // Trigger: 迁移后重复等待并播放同一 tick 区间。
    // Evidence: migration 非空时 playbackTickNumber 可能落后当前墙钟目标多个 tick。
    // Replacement: 首次初始化仍归零；迁移先发布精确锚点快照，再追赶到完成时的最新播放目标。
    // Risk: Low。
    // Human Review: Required
    //
    // Original code:
    // const targetPlaybackTickNumber = migration === null ? 0 : playbackTickNumber;
    // AI-CORRECTION 2026-07-15: 迁移使用当前或已缓存的下一 tick 作为原子边界；完成后不额外跳到累计墙钟目标。
    const initialPlaybackTickNumber = migration === null ? 0 : undefined;
    let tickStatus: SimulationTickPullStatus;
    try {
      tickStatus = await this.syncToTick(targetTickNumber, initialPlaybackTickNumber);
    } finally {
      this.releaseTopologyPresentationBoundary(presentationBoundary);
    }
    if (tickStatus.status === "not-found") {
      await this.recoverPlaybackFromUnavailableTick(
        tickStatus,
        this.stateReadWrite.currentPlaybackTickNumber,
      );
    }

    // AI-REMOVED 2026-07-15:
    // Reason: 迁移完成后直接跳到累计墙钟目标会跨过中间展示快照，使传送带进度在配方周期边界产生可见“前进后退”。
    // Trigger: 拓扑迁移期间 RAF 累计多个 tick 后，部分设备出现卡带式回退。
    // Evidence: catchUpTickNumber 直接取异步迁移完成时的播放整数目标，可能远大于 targetTickNumber。
    // Replacement: advancePlaybackByDeltaMs 以当前快照 + 本帧步长逐步消费 playbackTargetTickNumber。
    // Risk: Low；算力不足时画面会停在边界而不是跳帧，实际 TPS 会如实下降。
    // Human Review: Required
    //
    // Original code:
    // if (migration !== null && tickStatus.status === "ready") {
    //   const latestPlaybackTickNumber = this.stateReadWrite.currentPlaybackTickNumber;
    //   const catchUpTickNumber = Math.trunc(latestPlaybackTickNumber);
    //   if (catchUpTickNumber > targetTickNumber) {
    //     const catchUpStatus = await this.syncToTick(catchUpTickNumber);
    //     if (catchUpStatus.status === "not-found") {
    //       await this.recoverPlaybackFromUnavailableTick(
    //         catchUpStatus,
    //         latestPlaybackTickNumber,
    //       );
    //     }
    //   }
    // }

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
    if (value === 0) {
      this.completeTopologyPresentationBoundary(true);
    }
    void this.bridge.setSimulationSpeed(value).catch(() => undefined);
  });

  public readonly patchRuntimeSlot: SimulationAction["patchRuntimeSlot"] = async (patch) => {
    if (this.stateReadWrite.runningState === "stop") {
      return;
    }

    this.resetPlaybackHotQueue();
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

    this.resetPlaybackHotQueue();
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
      this.stateReadWrite.timeline.readiness = "preparing";
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
    if (
      !this.stateReadWrite.timeline.enabled
      || this.stateReadWrite.timeline.readiness !== "ready"
    ) {
      return false;
    }

    if (this.timelineBridge === null) {
      return false;
    }

    const targetTimelineTickNumber = Math.max(0, Math.trunc(timelineTickNumber));
    const revision = ++this.timelinePresentationCommitRevision;
    if (this.timelinePresentationCommitTimerId !== null) {
      clearTimeout(this.timelinePresentationCommitTimerId);
      this.timelinePresentationCommitTimerId = null;
    }
    this.timelinePresentationCommitTarget = null;

    return new Promise<boolean>((resolve, reject) => {
      const request: TimelinePresentationSeekRequest = {
        targetTimelineTickNumber,
        revision,
        resolve,
        reject,
      };

      if (this.timelinePresentationSeekRunning) {
        this.pendingTimelinePresentationSeek?.resolve(false);
        this.pendingTimelinePresentationSeek = request;
        return;
      }

      this.timelinePresentationSeekRunning = true;
      void this.runTimelinePresentationSeekQueue(request);
    });
  };

  private async runTimelinePresentationSeekQueue(
    initialRequest: TimelinePresentationSeekRequest,
  ): Promise<void> {
    let request: TimelinePresentationSeekRequest | null = initialRequest;
    runInAction(() => {
      this.stateReadWrite.timeline.isSeeking = true;
    });

    try {
      while (request !== null) {
        const currentRequest = request;
        try {
          const crossesTimelineMark = this.stateReadWrite.timeline.marks.some((mark) =>
            mark.tickNumber > currentRequest.targetTimelineTickNumber,
          );
          const applied = crossesTimelineMark
            ? await this.commitTimelineSeekToTick(
              currentRequest.targetTimelineTickNumber,
              currentRequest.revision,
            )
            : await this.applyTimelinePresentationFrame(
              currentRequest.targetTimelineTickNumber,
              currentRequest.revision,
            );
          currentRequest.resolve(applied);
        } catch (error) {
          currentRequest.reject(error);
        }

        request = this.pendingTimelinePresentationSeek;
        this.pendingTimelinePresentationSeek = null;
      }
    } finally {
      this.timelinePresentationSeekRunning = false;
      if (this.timelinePresentationCommitPromise === null) {
        runInAction(() => {
          this.stateReadWrite.timeline.isSeeking = false;
        });
      }
    }
  }

  private async applyTimelinePresentationFrame(
    targetTimelineTickNumber: number,
    revision: number,
  ): Promise<boolean> {
    const bridge = this.timelineBridge;
    if (bridge === null) {
      return false;
    }

    const lifecycleSerial = this.timelineSeekSerial;
    const previousCursorTickNumber = this.stateReadWrite.timeline.cursorTickNumber;
    const snapshot = await this.resolveTimelinePresentationFrame(
      bridge,
      targetTimelineTickNumber,
      previousCursorTickNumber,
      lifecycleSerial,
    );
    if (
      lifecycleSerial !== this.timelineSeekSerial
      || snapshot === null
    ) {
      return false;
    }

    const checkpointMetadata = this.resolveTimelineCheckpointMetadataForDocumentHash(
      targetTimelineTickNumber,
      snapshot.documentHash,
    );
    if (checkpointMetadata === null) {
      this.compiledDocument = null;
      this.compiledActivitySignature = null;
    } else {
      this.compiledDocument = cloneWorldDocument(checkpointMetadata.document);
      this.compiledActivitySignature = checkpointMetadata.activitySignature;
    }

    this.resetPlaybackHotQueue();
    runInAction(() => {
      this.stateReadWrite.currentSnapshot = snapshot;
      this.stateReadWrite.currentPlaybackTickNumber = snapshot.tickNumber;
      this.playbackTargetTickNumber = snapshot.tickNumber;
      this.stateReadWrite.timeline.cursorTickNumber = targetTimelineTickNumber;
      this.updateTimelineWindowForSeek(targetTimelineTickNumber, previousCursorTickNumber);
    });
    this.requestTimelineWindowRetarget();
    this.scheduleTimelinePresentationCommit(targetTimelineTickNumber, revision);
    return true;
  }

  /**
   * 拖动期间优先从主线程呈现帧缓存取快照；缓存缺失时一次读取拖动方向上的小窗口。
   * Timeline Worker 仍然持有完整预测历史，主线程只保留邻近游标的轻量呈现快照。
   */
  private async resolveTimelinePresentationFrame(
    bridge: TimelineWorkerBridge,
    targetTimelineTickNumber: number,
    previousCursorTickNumber: number,
    lifecycleSerial: number,
  ): Promise<RuntimeTickSnapshot | null> {
    const cachedSnapshot = this.timelinePresentationFrameCache.get(targetTimelineTickNumber);
    if (cachedSnapshot !== undefined) {
      return cachedSnapshot;
    }

    const isForwardSeek = targetTimelineTickNumber >= previousCursorTickNumber;
    // availableToTickNumber 由低频状态轮询更新，拖动时可能暂时落后于游标。
    // 直接请求游标邻域，Timeline Worker 会只返回已经存在的检查点。
    const fromTimelineTickNumber = Math.max(
      0,
      targetTimelineTickNumber - (
        isForwardSeek
          ? TIMELINE_PRESENTATION_CACHE_OPPOSITE_TICKS
          : TIMELINE_PRESENTATION_CACHE_DIRECTION_TICKS
      ),
    );
    const toTimelineTickNumber = Math.max(
      fromTimelineTickNumber,
      targetTimelineTickNumber + (
        isForwardSeek
          ? TIMELINE_PRESENTATION_CACHE_DIRECTION_TICKS
          : TIMELINE_PRESENTATION_CACHE_OPPOSITE_TICKS
      ),
    );
    const response = await bridge.getTimelinePresentationFrameRange(
      fromTimelineTickNumber,
      toTimelineTickNumber,
    );
    if (
      lifecycleSerial !== this.timelineSeekSerial
      || this.timelineBridge !== bridge
    ) {
      return null;
    }

    for (const frame of response.frames) {
      this.timelinePresentationFrameCache.set(frame.timelineTickNumber, frame.snapshot);
    }
    this.pruneTimelinePresentationFrameCache(targetTimelineTickNumber);
    return this.timelinePresentationFrameCache.get(targetTimelineTickNumber) ?? null;
  }

  private pruneTimelinePresentationFrameCache(anchorTimelineTickNumber: number): void {
    if (this.timelinePresentationFrameCache.size <= TIMELINE_PRESENTATION_CACHE_CAPACITY) {
      return;
    }

    const retainedTickNumbers = new Set(
      [...this.timelinePresentationFrameCache.keys()]
        .sort((left, right) =>
          Math.abs(left - anchorTimelineTickNumber) - Math.abs(right - anchorTimelineTickNumber))
        .slice(0, TIMELINE_PRESENTATION_CACHE_CAPACITY),
    );
    for (const timelineTickNumber of this.timelinePresentationFrameCache.keys()) {
      if (!retainedTickNumbers.has(timelineTickNumber)) {
        this.timelinePresentationFrameCache.delete(timelineTickNumber);
      }
    }
  }

  private resetTimelinePresentationFrameCache(): void {
    this.timelinePresentationFrameCache.clear();
  }

  private async commitTimelineSeekToTick(
    targetTimelineTickNumber: number,
    revision: number,
  ): Promise<boolean> {
    const bridge = this.timelineBridge;
    if (bridge === null) {
      return false;
    }

    const previousCursorTickNumber = this.stateReadWrite.timeline.cursorTickNumber;
    const lifecycleSerial = this.timelineSeekSerial;
    const checkpoint = await bridge.getTimelineCheckpoint(targetTimelineTickNumber);
    const runtimeExport = checkpoint.runtimeExport;
    if (
      lifecycleSerial !== this.timelineSeekSerial
      || revision !== this.timelinePresentationCommitRevision
      || runtimeExport === null
    ) {
      return false;
    }

    const checkpointMetadata = this.resolveTimelineCheckpointMetadata(
      targetTimelineTickNumber,
      runtimeExport,
    );
    const crossesTimelineMark = this.stateReadWrite.timeline.marks.some((mark) =>
      mark.tickNumber > targetTimelineTickNumber,
    );
    const imported = await this.importTimelineRuntimeStateForSeek(lifecycleSerial, runtimeExport);
    if (
      lifecycleSerial !== this.timelineSeekSerial
      || revision !== this.timelinePresentationCommitRevision
      || imported === null
    ) {
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
        this.playbackTargetTickNumber = this.stateReadWrite.currentPlaybackTickNumber;
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
  }

  private scheduleTimelinePresentationCommit(
    targetTimelineTickNumber: number,
    revision: number,
  ): void {
    if (revision !== this.timelinePresentationCommitRevision) {
      return;
    }

    this.timelinePresentationCommitTarget = targetTimelineTickNumber;
    if (this.timelinePresentationCommitTimerId !== null) {
      clearTimeout(this.timelinePresentationCommitTimerId);
    }
    this.timelinePresentationCommitTimerId = setTimeout(() => {
      this.timelinePresentationCommitTimerId = null;
      const commitPromise = this.flushTimelinePresentationCommit();
      void commitPromise?.catch(() => undefined);
    }, TIMELINE_PRESENTATION_COMMIT_IDLE_MS);
  }

  private flushTimelinePresentationCommit(): Promise<boolean> | null {
    if (this.timelinePresentationCommitTimerId !== null) {
      clearTimeout(this.timelinePresentationCommitTimerId);
      this.timelinePresentationCommitTimerId = null;
    }
    if (this.timelinePresentationCommitPromise !== null) {
      return this.timelinePresentationCommitPromise;
    }

    const targetTimelineTickNumber = this.timelinePresentationCommitTarget;
    if (targetTimelineTickNumber === null) {
      return null;
    }

    this.timelinePresentationCommitTarget = null;
    const revision = this.timelinePresentationCommitRevision;
    runInAction(() => {
      this.stateReadWrite.timeline.isSeeking = true;
    });
    const commitPromise = this.commitTimelineSeekToTick(
      targetTimelineTickNumber,
      revision,
    );
    const trackedPromise = commitPromise.finally(() => {
      if (this.timelinePresentationCommitPromise === trackedPromise) {
        this.timelinePresentationCommitPromise = null;
      }
      if (!this.timelinePresentationSeekRunning) {
        runInAction(() => {
          this.stateReadWrite.timeline.isSeeking = false;
        });
      }
      if (this.timelinePresentationCommitTarget !== null) {
        this.scheduleTimelinePresentationCommit(
          this.timelinePresentationCommitTarget,
          this.timelinePresentationCommitRevision,
        );
      }
    });
    this.timelinePresentationCommitPromise = trackedPromise;
    return trackedPromise;
  }

  private async resumeAfterTimelinePresentationCommitted(): Promise<void> {
    while (this.timelineResumeRequestedAfterCommit) {
      const commitPromise = this.flushTimelinePresentationCommit();
      if (commitPromise === null) {
        break;
      }
      await commitPromise.catch(() => false);
    }

    if (!this.timelineResumeRequestedAfterCommit) {
      return;
    }
    this.timelineResumeRequestedAfterCommit = false;
    runInAction(() => {
      if (this.stateReadWrite.runningState === "pause") {
        this.stateReadWrite.runningState = "start";
      }
    });
  }

  public readonly reset: SimulationInternalAction["reset"] = action(() => {
    this.clearPlaybackProgress();
    this.stateReadWrite.simulationSpeed = DEFAULT_SIMULATION_SPEED;
  });

  public readonly syncToTick: SimulationInternalAction["syncToTick"] = async (
    tickNumber: number,
    playbackTickNumberOnReady?: number,
  ): Promise<SimulationTickPullStatus> => {
    this.resetPlaybackHotQueue();
    const requestTopologyRevision = this.topologyRevision;
    const retainTickNumber = this.stateReadWrite.currentSnapshot?.tickNumber;
    const response = await this.bridge.getTickSnapshot(
      tickNumber,
      this.stateReadWrite.simulationSpeed,
      retainTickNumber,
    );

    if (requestTopologyRevision !== this.topologyRevision) {
      return response.result.status;
    }

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
          this.playbackTargetTickNumber = playbackTickNumberOnReady;
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

  public readonly setDebugEnabled: SimulationInternalAction["setDebugEnabled"] = (debugEnabled) => {
    if (this.lastWorkerDebugEnabled === debugEnabled) {
      return;
    }

    this.lastWorkerDebugEnabled = debugEnabled;
    void this.bridge.setDebugEnabled(debugEnabled).catch(() => {
      if (this.lastWorkerDebugEnabled === debugEnabled) {
        this.lastWorkerDebugEnabled = null;
      }
    });
  };

  public readonly setDebugDataEnabled: SimulationInternalAction["setDebugDataEnabled"] = (debugDataEnabled) => {
    if (this.lastWorkerDebugDataEnabled === debugDataEnabled) {
      return;
    }

    this.lastWorkerDebugDataEnabled = debugDataEnabled;
    void this.bridge.setDebugDataEnabled(debugDataEnabled).catch(() => {
      if (this.lastWorkerDebugDataEnabled === debugDataEnabled) {
        this.lastWorkerDebugDataEnabled = null;
      }
    });
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
        this.playbackTargetTickNumber = fallbackPlaybackTickNumber;
        this.syncTimelineCursorFromPlayback({ retargetWindow: false });
      });
      await this.restartTimelineAfterPlaybackRollbackIfNeeded();
      return;
    }

    const recoveryStatus = await this.syncToTick(recoveryTickNumber, recoveryTickNumber);
    if (recoveryStatus.status !== "ready") {
      runInAction(() => {
        this.stateReadWrite.currentPlaybackTickNumber = fallbackPlaybackTickNumber;
        this.playbackTargetTickNumber = fallbackPlaybackTickNumber;
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
    this.resetTimelinePresentationFrameCache();
    try {
      const currentStandardTickNumber = this.stateReadWrite.currentSnapshot?.tickNumber
        ?? Math.trunc(this.stateReadWrite.currentPlaybackTickNumber);
      const startTimelineTickNumber = Math.max(
        0,
        Math.floor(resolveTimelineTickNumberForStandardTick(currentStandardTickNumber)),
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
        this.updateTimelineReadiness(loaded.status);
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
        this.updateTimelineReadiness(response.status);
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
      const exportTickNumber = resolveStandardTickNumberForTimelineTick(
        candidateTimelineTickNumber,
      );
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
        nextCandidateTimelineTickNumber = Math.ceil(
          resolveTimelineTickNumberForStandardTick(retainedFromTick),
        );
      }
      if (latestTickNumber !== null && latestTickNumber < exportTickNumber) {
        nextCandidateTimelineTickNumber = Math.min(
          candidateTimelineTickNumber - 1,
          Math.floor(resolveTimelineTickNumberForStandardTick(latestTickNumber)),
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

        this.resetPlaybackHotQueue();
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
    return this.resolveTimelineCheckpointMetadataForDocumentHash(
      timelineTickNumber,
      runtimeExport.topology.documentHash,
    );
  }

  private resolveTimelineCheckpointMetadataForDocumentHash(
    timelineTickNumber: number,
    documentHash: string,
  ): TimelineCheckpointMetadata | null {
    const metadata = this.timelineCheckpointMetadataByTickNumber.get(timelineTickNumber) ?? null;
    if (metadata === null) {
      return null;
    }

    if (createSimulationDocumentHash(metadata.document) !== documentHash) {
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
    if (
      !this.stateReadWrite.timeline.enabled
      || this.stateReadWrite.timeline.isSeeking
      || this.timelineStatusRefreshInFlight
    ) {
      return;
    }

    this.timelineStatusRefreshInFlight = true;
    try {
      const bridge = this.timelineBridge;
      if (bridge === null) {
        await this.restartTimelineFromCurrentSimulation();
        return;
      }

      const response = await bridge.getTimelineStatus();
      if (!this.stateReadWrite.timeline.enabled || this.timelineBridge !== bridge) {
        return;
      }
      runInAction(() => {
        this.applyTimelineStatus(response.status);
        this.updateTimelineReadiness(response.status);
      });
    } catch {
      // timeline-worker 是辅助预测缓存，状态轮询失败不应影响正式仿真。
    } finally {
      this.timelineStatusRefreshInFlight = false;
    }
  }

  private applyTimelineStatus(status: TimelineWorkerStatus): void {
    this.stateReadWrite.timeline.availableFromTickNumber =
      status.availableFromTimelineTickNumber ?? this.stateReadWrite.timeline.cursorTickNumber;
    this.stateReadWrite.timeline.availableToTickNumber =
      status.availableToTimelineTickNumber ?? this.stateReadWrite.timeline.cursorTickNumber;
  }

  private updateTimelineReadiness(status: TimelineWorkerStatus): void {
    if (
      !this.stateReadWrite.timeline.enabled
      || this.stateReadWrite.timeline.readiness === "ready"
    ) {
      return;
    }

    const hasFirstFrame =
      status.availableFromTimelineTickNumber !== null
      && status.availableToTimelineTickNumber !== null;
    if (!hasFirstFrame) {
      return;
    }

    if (this.stateReadWrite.timeline.readiness === "preparing") {
      this.stateReadWrite.timeline.readiness = "catching-up";
    }

    if (
      this.stateReadWrite.timeline.readiness === "catching-up"
      && this.stateReadWrite.timeline.availableToTickNumber
        >= Math.ceil(this.stateReadWrite.timeline.cursorTickNumber)
    ) {
      this.stateReadWrite.timeline.readiness = "ready";
    }
  }

  private addTimelineMark(kind: "document-change" | "runtime-change" | "safety-resync"): void {
    if (!this.stateReadWrite.timeline.enabled) {
      return;
    }

    const tickNumber = Math.max(
      0,
      Math.trunc(resolveTimelineTickNumberForStandardTick(
        this.stateReadWrite.currentPlaybackTickNumber,
      )),
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
      resolveTimelineTickNumberForStandardTick(
        this.stateReadWrite.currentPlaybackTickNumber,
      ),
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
    const elapsedStandardTicks = standardTickNumber - TIMELINE_ORIGIN_STANDARD_TICK;
    if (
      elapsedStandardTicks <= 0
      || elapsedStandardTicks % safetyIntervalTicks !== 0
      || elapsedStandardTicks % TIMELINE_STEP_STANDARD_TICKS !== 0
      || this.lastTimelineSafetySyncStandardTick === standardTickNumber
    ) {
      return;
    }

    this.lastTimelineSafetySyncStandardTick = standardTickNumber;
    const timelineTickNumber = resolveTimelineTickNumberForStandardTick(standardTickNumber);
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

      const officialSnapshot = officialExport.runtimeExport.snapshot;
      const timelineSnapshot = timelineCheckpoint.runtimeExport.snapshot;

      const officialRaw = JSON.stringify(officialSnapshot);
      const timelineRaw = JSON.stringify(timelineSnapshot);
      if (officialRaw === timelineRaw) {
        return;
      }

      // 诊断：先检查是否是键排序假阳性
      const officialSorted = JSON.stringify(officialSnapshot, sortedKeysReplacer);
      const timelineSorted = JSON.stringify(timelineSnapshot, sortedKeysReplacer);
      if (officialSorted === timelineSorted) {
        console.debug(
          `[TimelineWorker] safety sync SKIPPED (key-order false positive) ` +
          `standardTick=${standardTickNumber} timelineTick=${timelineTickNumber}`,
        );
        return;
      }

      // 实际语义不一致 → 打印深度差异
      const diffs = deepDiffSnapshots(officialSnapshot, timelineSnapshot, '', 30);
      console.debug(
        `[TimelineWorker] safety resync at standardTick=${standardTickNumber} timelineTick=${timelineTickNumber}\n` +
        `  Diffs (first 30):\n${diffs.map(d => `    ${d}`).join('\n')}`,
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
    this.timelinePresentationCommitRevision += 1;
    if (this.timelinePresentationCommitTimerId !== null) {
      clearTimeout(this.timelinePresentationCommitTimerId);
      this.timelinePresentationCommitTimerId = null;
    }
    this.timelinePresentationCommitTarget = null;
    this.pendingTimelinePresentationSeek?.resolve(false);
    this.pendingTimelinePresentationSeek = null;
    this.timelineResumeRequestedAfterCommit = false;
    this.lastTimelineSafetySyncStandardTick = null;
    this.timelineWindowRetargetInFlight = false;
    this.timelineWindowRetargetPending = false;
    this.lastTimelineRetargetRange = null;
    this.timelinePlaybackAnchorOffsetTicks = null;
    this.resetTimelinePresentationFrameCache();
    this.timelineCheckpointMetadataByTickNumber.clear();
    this.timelineBridge?.dispose();
    this.timelineBridge = null;
  }

  private beginTopologyPresentationBoundary(
    maxPlaybackTickNumber: number,
  ): TopologyPresentationBoundary {
    let hasResolved = false;
    let resolvePromise: (() => void) | null = null;
    const reached = new Promise<void>((resolve) => {
      resolvePromise = resolve;
    });
    const boundary: TopologyPresentationBoundary = {
      maxPlaybackTickNumber,
      reached,
      resolveReached: () => {
        if (hasResolved) {
          return;
        }
        hasResolved = true;
        resolvePromise?.();
      },
    };
    this.topologyPresentationBoundary = boundary;
    this.resolveReachedTopologyPresentationBoundary();
    return boundary;
  }

  private resolveReachedTopologyPresentationBoundary(): void {
    const boundary = this.topologyPresentationBoundary;
    if (
      boundary !== null
      && this.stateReadWrite.currentPlaybackTickNumber >= boundary.maxPlaybackTickNumber
    ) {
      boundary.resolveReached();
    }
  }

  private completeTopologyPresentationBoundary(snapToBoundary: boolean): void {
    const boundary = this.topologyPresentationBoundary;
    if (boundary === null) {
      return;
    }
    if (snapToBoundary) {
      this.stateReadWrite.currentPlaybackTickNumber = Math.max(
        this.stateReadWrite.currentPlaybackTickNumber,
        boundary.maxPlaybackTickNumber,
      );
      this.playbackTargetTickNumber = Math.max(
        this.playbackTargetTickNumber,
        boundary.maxPlaybackTickNumber,
      );
      this.syncTimelineCursorFromPlayback();
    }
    this.releaseTopologyPresentationBoundary(boundary);
  }

  private releaseTopologyPresentationBoundary(
    boundary: TopologyPresentationBoundary | null,
  ): void {
    if (boundary === null) {
      return;
    }
    boundary.resolveReached();
    if (this.topologyPresentationBoundary === boundary) {
      this.topologyPresentationBoundary = null;
    }
  }

  private clearPlaybackProgress(): void {
    this.topologyRevision += 1;
    this.completeTopologyPresentationBoundary(false);
    this.stopTimelineWorker();
    this.topology.setSnapshot(null);
    this.compiledDocument = null;
    this.stateReadWrite.runningState = "stop";
    this.stateReadWrite.hasStarted = false;
    this.stateReadWrite.runtimeStatus = createInitialSimulationRuntimeStatus();
    this.stateReadWrite.currentSnapshot = null;
    this.stateReadWrite.currentPlaybackTickNumber = 0;
    this.playbackTargetTickNumber = 0;
    this.stateReadWrite.statistics = { tickPerSecond: 0, targetTickPerSecond: 0, baseBatteryJoules: 0, baseBatteryCapacity: 0 };
    this.tpsAccumulatedTicks = 0;
    this.tpsAccumulatedMs = 0;
    this.nextPerfReportTick = 180;
    this.resetPlaybackHotQueue();
    this.lastWorkerDebugEnabled = null;
    this.lastWorkerDebugDataEnabled = null;
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
    if (this.getPerfEnabled?.() !== true || tickNumber < this.nextPerfReportTick) return;

    try {
      const response = await this.bridge.getPerfReport();
      if (this.getPerfEnabled?.() === true && response.report !== null) {
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
