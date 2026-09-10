import type { LegacyPlaybackController } from "./playback";
import { action, runInAction } from "mobx";
import type { SimulationAction } from "@/domain/simulation/simulation-action";

import type { WorldDocument } from "@/domain/document/world-document";
import { SIMULATION_MODE } from "@/domain/shared/simulation-mode";

import type { SnapshotStoreReadWrite } from "@/shared/snapshot/snapshot-store";

import { createSimulationDocumentHash } from "../topology";

import { createInitialSimulationTimelineState } from "../contracts";
import { STANDARD_TICK_RATE_PER_SECOND } from "../contracts";
import type { CompiledSimulationTopology, RuntimeTickSnapshot } from "../contracts";
import type { SimulationRuntimeExport } from "./runtime-export";
import type { SimulationWorkerResponse } from "./worker-protocol";
import type { TimelineWorkerStatus } from "./timeline-worker-protocol";

import type { LegacyPresentationState } from "./state";
import type { SimulationStateReadWrite } from "../contracts";
import type { SimulationWorkerBridge, TimelineWorkerBridge } from "./bridge-contract";
// AI-REMOVED 2026-09-09:
// Reason: 明确状态归属并清理重组产生的重复声明。
// Trigger: Host / legacy 控制器重构。
// Evidence: 公共 Query 与子控制器已接管对应职责，原 import 或状态入口不再需要。
// Replacement: 本文件中的 LegacyTimelineController 声明
// Risk: Low
// Human Review: Required
// Original code:
// import { LegacyTimelineController } from "./timeline";

import { cloneWorldDocument } from "./controller-support";

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

function resolveStandardTickNumberForTimelineTick(timelineTickNumber: number): number {
  return TIMELINE_ORIGIN_STANDARD_TICK
    + timelineTickNumber * TIMELINE_STEP_STANDARD_TICKS;
}

function resolveTimelineTickNumberForStandardTick(standardTickNumber: number): number {
  return (standardTickNumber - TIMELINE_ORIGIN_STANDARD_TICK)
    / TIMELINE_STEP_STANDARD_TICKS;
}

interface TimelineCheckpointMetadata {
  readonly document: WorldDocument;
  readonly activitySignature: string;
}

interface TimelineRebaseRange {
  readonly retainedFromTimelineTickNumber: number;
  readonly targetTimelineTickNumber: number;
}

interface TimelinePresentationSeekRequest {
  readonly targetTimelineTickNumber: number;
  readonly revision: number;
  readonly resolve: (applied: boolean) => void;
  readonly reject: (error: unknown) => void;
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

interface LegacyTimelineContext {
  readonly stateReadWrite: SimulationStateReadWrite;
  readonly presentation: LegacyPresentationState;
  readonly topology: SnapshotStoreReadWrite<CompiledSimulationTopology | null>;
  readonly bridge: SimulationWorkerBridge;
  readonly createTimelineBridge: () => TimelineWorkerBridge;
  readonly compiledSource: { document: WorldDocument | null; activitySignature: string | null };
  readonly playback: Pick<LegacyPlaybackController, "playbackTargetTickNumber" | "resetPlaybackHotQueue">;
  start(): Promise<void>;
}

export class LegacyTimelineController {
  public constructor(private readonly context: LegacyTimelineContext) {}

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

  public readonly enableTimeline: SimulationAction["enableTimeline"] = async () => {
    if (this.context.stateReadWrite.simulationMode === SIMULATION_MODE.regionalMultiBase) {
      return;
    }
    runInAction(() => {
      this.context.stateReadWrite.timeline.enabled = true;
      this.context.stateReadWrite.timeline.readiness = "preparing";
      this.context.stateReadWrite.timeline.tickDurationSeconds = TIMELINE_TICK_DURATION_SECONDS;
      this.context.stateReadWrite.timeline.rulerDurationSeconds = TIMELINE_RULER_DURATION_SECONDS;
      this.context.stateReadWrite.timeline.isSeeking = false;
      this.syncTimelineCursorFromPlayback();
    });

    if (!this.context.stateReadWrite.hasStarted) {
      await this.context.start();
    }

    await this.restartTimelineFromCurrentSimulation();
    this.startTimelineStatusPolling();
  };

  public readonly disableTimeline: SimulationAction["disableTimeline"] = action(() => {
    this.stopTimelineWorker();
    Object.assign(this.context.stateReadWrite.timeline, createInitialSimulationTimelineState());
  });

  public readonly seekTimelineToTick: SimulationAction["seekTimelineToTick"] = async (timelineTickNumber) => {
    if (
      !this.context.stateReadWrite.timeline.enabled
      || this.context.stateReadWrite.timeline.readiness !== "ready"
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
      this.context.stateReadWrite.timeline.isSeeking = true;
    });

    try {
      while (request !== null) {
        const currentRequest = request;
        try {
          const crossesTimelineMark = this.context.stateReadWrite.timeline.marks.some((mark) =>
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
          this.context.stateReadWrite.timeline.isSeeking = false;
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
    const previousCursorTickNumber = this.context.stateReadWrite.timeline.cursorTickNumber;
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
      this.context.compiledSource.document = null;
      this.context.compiledSource.activitySignature = null;
    } else {
      this.context.compiledSource.document = cloneWorldDocument(checkpointMetadata.document);
      this.context.compiledSource.activitySignature = checkpointMetadata.activitySignature;
    }

    this.context.playback.resetPlaybackHotQueue();
    runInAction(() => {
      this.context.presentation.currentSnapshot = snapshot;
      this.context.stateReadWrite.currentPlaybackTickNumber = snapshot.tickNumber;
      this.context.playback.playbackTargetTickNumber = snapshot.tickNumber;
      this.context.stateReadWrite.timeline.cursorTickNumber = targetTimelineTickNumber;
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

    const previousCursorTickNumber = this.context.stateReadWrite.timeline.cursorTickNumber;
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
    const crossesTimelineMark = this.context.stateReadWrite.timeline.marks.some((mark) =>
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

    this.context.topology.setSnapshot(runtimeExport.topology);
    if (checkpointMetadata === null) {
      this.context.compiledSource.document = null;
      this.context.compiledSource.activitySignature = null;
    } else {
      this.context.compiledSource.document = cloneWorldDocument(checkpointMetadata.document);
      this.context.compiledSource.activitySignature = checkpointMetadata.activitySignature;
    }
    runInAction(() => {
      this.context.stateReadWrite.runtimeStatus = imported.status;
      if (imported.result.status.status === "ready") {
        this.context.presentation.currentSnapshot = imported.result.currentTick;
        this.context.stateReadWrite.currentPlaybackTickNumber =
          imported.result.currentTick?.tickNumber ?? runtimeExport.snapshot.tickNumber;
        this.context.playback.playbackTargetTickNumber = this.context.stateReadWrite.currentPlaybackTickNumber;
        this.context.stateReadWrite.timeline.cursorTickNumber = targetTimelineTickNumber;
        this.updateTimelineWindowForSeek(targetTimelineTickNumber, previousCursorTickNumber);
        if (crossesTimelineMark) {
          this.context.stateReadWrite.timeline.marks = this.context.stateReadWrite.timeline.marks.filter((mark) =>
            mark.tickNumber <= targetTimelineTickNumber,
          );
          this.context.stateReadWrite.timeline.availableToTickNumber = Math.min(
            this.context.stateReadWrite.timeline.availableToTickNumber,
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
      this.context.stateReadWrite.timeline.isSeeking = true;
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
          this.context.stateReadWrite.timeline.isSeeking = false;
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
      if (this.context.stateReadWrite.runningState === "pause") {
        this.context.stateReadWrite.runningState = "start";
      }
    });
  }

  public async restartTimelineFromCurrentSimulation(): Promise<void> {
    if (!this.context.stateReadWrite.timeline.enabled || this.timelineRestartInFlight) {
      return;
    }

    this.timelineRestartInFlight = true;
    this.resetTimelinePresentationFrameCache();
    try {
      const currentStandardTickNumber = this.context.presentation.currentSnapshot?.tickNumber
        ?? Math.trunc(this.context.stateReadWrite.currentPlaybackTickNumber);
      const startTimelineTickNumber = Math.max(
        0,
        Math.floor(resolveTimelineTickNumberForStandardTick(currentStandardTickNumber)),
      );
      const exported = await this.exportLatestAlignedTimelineRuntimeState(startTimelineTickNumber);
      if (exported === null || !this.context.stateReadWrite.timeline.enabled) {
        return;
      }

      const shouldPreserveExistingCheckpoints = this.timelineBridge !== null;
      const rebaseRange = this.resolveTimelineRebaseRange(
        exported.startTimelineTickNumber,
        shouldPreserveExistingCheckpoints,
      );
      const bridge = this.timelineBridge ?? this.context.createTimelineBridge();
      this.timelineBridge = bridge;
      const loaded = await bridge.loadTimeline({
        runtimeExport: exported.response.runtimeExport,
        startTimelineTickNumber: exported.startTimelineTickNumber,
        retainedFromTimelineTickNumber: rebaseRange.retainedFromTimelineTickNumber,
        targetTimelineTickNumber: rebaseRange.targetTimelineTickNumber,
        capacityTimelineTicks: TIMELINE_CAPACITY_TICKS,
        stepStandardTicks: TIMELINE_STEP_STANDARD_TICKS,
      });
      if (!this.context.stateReadWrite.timeline.enabled) {
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
      ? Math.max(0, Math.floor(this.context.stateReadWrite.timeline.windowStartTickNumber))
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

    if (this.context.compiledSource.document === null || this.context.compiledSource.activitySignature === null) {
      return;
    }

    const metadata: TimelineCheckpointMetadata = {
      document: cloneWorldDocument(this.context.compiledSource.document),
      activitySignature: this.context.compiledSource.activitySignature,
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
    if (!this.context.stateReadWrite.timeline.enabled || this.timelineBridge === null) {
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
      Math.floor(this.context.stateReadWrite.timeline.windowStartTickNumber),
    );
    const retainedFromTimelineTickNumber = this.resolveTimelineHistoryRetainedFrom(windowStartTickNumber);

    return {
      retainedFromTimelineTickNumber,
      targetTimelineTickNumber: this.resolveTimelinePredictionTarget(windowStartTickNumber),
    };
  }

  private async retargetTimelineWindow(range: TimelineRebaseRange): Promise<void> {
    const bridge = this.timelineBridge;
    if (bridge === null || !this.context.stateReadWrite.timeline.enabled) {
      return;
    }

    this.timelineWindowRetargetInFlight = true;
    try {
      const response = await bridge.retargetTimeline({
        retainedFromTimelineTickNumber: range.retainedFromTimelineTickNumber,
        targetTimelineTickNumber: range.targetTimelineTickNumber,
      });
      if (!this.context.stateReadWrite.timeline.enabled || this.timelineBridge !== bridge) {
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

    if (this.context.compiledSource.document === null || this.context.compiledSource.activitySignature === null) {
      return;
    }

    const metadata: TimelineCheckpointMetadata = {
      document: cloneWorldDocument(this.context.compiledSource.document),
      activitySignature: this.context.compiledSource.activitySignature,
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

  public async restartTimelineAfterPlaybackRollbackIfNeeded(): Promise<void> {
    if (!this.context.stateReadWrite.timeline.enabled) {
      return;
    }

    const cursorTickNumber = this.context.stateReadWrite.timeline.cursorTickNumber;
    if (
      cursorTickNumber >= this.context.stateReadWrite.timeline.availableFromTickNumber
      && cursorTickNumber <= this.context.stateReadWrite.timeline.availableToTickNumber
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
      const exported = await this.context.bridge.exportRuntimeState(exportTickNumber);
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

        this.context.playback.resetPlaybackHotQueue();
        return this.context.bridge.importRuntimeState(runtimeExport);
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
      !this.context.stateReadWrite.timeline.enabled
      || this.context.stateReadWrite.timeline.isSeeking
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
      if (!this.context.stateReadWrite.timeline.enabled || this.timelineBridge !== bridge) {
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
    this.context.stateReadWrite.timeline.availableFromTickNumber =
      status.availableFromTimelineTickNumber ?? this.context.stateReadWrite.timeline.cursorTickNumber;
    this.context.stateReadWrite.timeline.availableToTickNumber =
      status.availableToTimelineTickNumber ?? this.context.stateReadWrite.timeline.cursorTickNumber;
  }

  private updateTimelineReadiness(status: TimelineWorkerStatus): void {
    if (
      !this.context.stateReadWrite.timeline.enabled
      || this.context.stateReadWrite.timeline.readiness === "ready"
    ) {
      return;
    }

    const hasFirstFrame =
      status.availableFromTimelineTickNumber !== null
      && status.availableToTimelineTickNumber !== null;
    if (!hasFirstFrame) {
      return;
    }

    if (this.context.stateReadWrite.timeline.readiness === "preparing") {
      this.context.stateReadWrite.timeline.readiness = "catching-up";
    }

    if (
      this.context.stateReadWrite.timeline.readiness === "catching-up"
      && this.context.stateReadWrite.timeline.availableToTickNumber
        >= Math.ceil(this.context.stateReadWrite.timeline.cursorTickNumber)
    ) {
      this.context.stateReadWrite.timeline.readiness = "ready";
    }
  }

  public addTimelineMark(kind: "document-change" | "runtime-change" | "safety-resync"): void {
    if (!this.context.stateReadWrite.timeline.enabled) {
      return;
    }

    const tickNumber = Math.max(
      0,
      Math.trunc(resolveTimelineTickNumberForStandardTick(
        this.context.stateReadWrite.currentPlaybackTickNumber,
      )),
    );
    this.context.stateReadWrite.timeline.marks.push({
      id: `timeline-mark:${this.timelineMarkSerial}`,
      tickNumber,
      kind,
    });
    this.timelineMarkSerial += 1;
    this.context.stateReadWrite.timeline.availableToTickNumber = Math.min(
      this.context.stateReadWrite.timeline.availableToTickNumber,
      tickNumber,
    );
  }

  public syncTimelineCursorFromPlayback(options: {
    readonly retargetWindow?: boolean;
  } = {}): void {
    if (!this.context.stateReadWrite.timeline.enabled) {
      return;
    }

    const cursorTickNumber = Math.max(
      0,
      resolveTimelineTickNumberForStandardTick(
        this.context.stateReadWrite.currentPlaybackTickNumber,
      ),
    );
    this.context.stateReadWrite.timeline.cursorTickNumber = cursorTickNumber;
    if (this.updateTimelineWindowForCursor(cursorTickNumber) && options.retargetWindow !== false) {
      this.requestTimelineWindowRetarget();
    }
  }

  public async checkTimelineSafetySync(tickNumber: number): Promise<void> {
    const timelineBridge = this.timelineBridge;
    if (!this.context.stateReadWrite.timeline.enabled || timelineBridge === null) {
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
        this.context.bridge.exportRuntimeState(standardTickNumber),
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
    const currentWindowStart = this.context.stateReadWrite.timeline.windowStartTickNumber;
    if (cursorTickNumber > currentWindowStart + anchorOffsetTicks) {
      this.context.stateReadWrite.timeline.windowStartTickNumber = cursorTickNumber - anchorOffsetTicks;
      return true;
    }

    if (cursorTickNumber < currentWindowStart) {
      this.context.stateReadWrite.timeline.windowStartTickNumber = cursorTickNumber;
      return true;
    }

    return false;
  }

  private updateTimelineWindowForSeek(
    targetTimelineTickNumber: number,
    previousCursorTickNumber: number,
  ): void {
    const currentWindowStart = this.context.stateReadWrite.timeline.windowStartTickNumber;
    const relativeTickNumber = targetTimelineTickNumber - currentWindowStart;
    if (relativeTickNumber < TIMELINE_SEEK_LEFT_EDGE_SCROLL_ANCHOR_OFFSET_TICKS) {
      this.timelinePlaybackAnchorOffsetTicks = null;
      const retainedFromTickNumber = Math.max(
        0,
        Math.floor(this.context.stateReadWrite.timeline.availableFromTickNumber),
      );
      const targetWindowStart = Math.max(
        retainedFromTickNumber,
        targetTimelineTickNumber - TIMELINE_SEEK_LEFT_EDGE_SCROLL_ANCHOR_OFFSET_TICKS,
      );
      if (targetWindowStart < currentWindowStart) {
        this.context.stateReadWrite.timeline.windowStartTickNumber = targetWindowStart;
      }
      return;
    }

    if (
      targetTimelineTickNumber < previousCursorTickNumber
      || relativeTickNumber < TIMELINE_DEFAULT_PLAYBACK_ANCHOR_OFFSET_TICKS
    ) {
      this.timelinePlaybackAnchorOffsetTicks = null;
      if (targetTimelineTickNumber < currentWindowStart) {
        this.context.stateReadWrite.timeline.windowStartTickNumber = targetTimelineTickNumber;
      }
      return;
    }

    if (relativeTickNumber > TIMELINE_SEEK_EDGE_SCROLL_ANCHOR_OFFSET_TICKS) {
      this.timelinePlaybackAnchorOffsetTicks = TIMELINE_SEEK_EDGE_SCROLL_ANCHOR_OFFSET_TICKS;
      this.context.stateReadWrite.timeline.windowStartTickNumber = Math.max(
        0,
        targetTimelineTickNumber - TIMELINE_SEEK_EDGE_SCROLL_ANCHOR_OFFSET_TICKS,
      );
      return;
    }

    this.timelinePlaybackAnchorOffsetTicks = relativeTickNumber;
  }

  public stopTimelineWorker(): void {
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
  public cancelPendingResume(): void { this.timelineResumeRequestedAfterCommit = false; }
  public resumePendingPresentation(): boolean {
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
      return true;
    }

    return false;
  }

}
