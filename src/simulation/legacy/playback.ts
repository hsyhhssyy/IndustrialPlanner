import { runInAction } from "mobx";
import type { SimulationAction } from "@/domain/simulation/simulation-action";

import type { SnapshotStoreReadWrite } from "@/shared/snapshot/snapshot-store";

import { STANDARD_TICK_RATE_PER_SECOND } from "../contracts";
import type {
  CompiledSimulationTopology,
  RuntimeTickSnapshot,
  SimulationTickPullStatus,
} from "../contracts";

// AI-REMOVED 2026-09-09:
// Reason: 明确状态归属并清理重组产生的重复声明。
// Trigger: Host / legacy 控制器重构。
// Evidence: 公共 Query 与子控制器已接管对应职责，原 import 或状态入口不再需要。
// Replacement: LegacyPlaybackContext.isRegionalActive
// Risk: Low
// Human Review: Required
// Original code:
// import { RegionalSimulationSession } from "./regional-session";

import type { LegacyPresentationState } from "./state";
import type { SimulationStateReadWrite } from "../contracts";
import type { SimulationWorkerBridge } from "./bridge-contract";

// AI-REMOVED 2026-09-09:
// Reason: 明确状态归属并清理重组产生的重复声明。
// Trigger: Host / legacy 控制器重构。
// Evidence: 公共 Query 与子控制器已接管对应职责，原 import 或状态入口不再需要。
// Replacement: 本文件中的 LegacyPlaybackController 声明
// Risk: Low
// Human Review: Required
// Original code:
// import { LegacyPlaybackController } from "./playback";

import { PLAYBACK_HOT_QUEUE_CAPACITY, PLAYBACK_HOT_QUEUE_LOW_WATER } from "./controller-support";

/** TPS 统计的累积窗口，毫秒 */
const TPS_WINDOW_MS = 1000;

const PLAYBACK_PREFETCH_RETRY_MS = 50;

interface TopologyPresentationBoundary {
  readonly maxPlaybackTickNumber: number;
  readonly reached: Promise<void>;
  readonly resolveReached: () => void;
}

interface LegacyPlaybackContext {
  readonly stateReadWrite: SimulationStateReadWrite;
  readonly presentation: LegacyPresentationState;
  readonly topology: SnapshotStoreReadWrite<CompiledSimulationTopology | null>;
  readonly bridge: SimulationWorkerBridge;
  readonly getPerfEnabled: (() => boolean) | undefined;
  isRegionalActive(): boolean;
  isTopologyRefreshing(): boolean;
  syncTimelineCursorFromPlayback(options?: { retargetWindow?: boolean }): void;
  checkTimelineSafetySync(tickNumber: number): Promise<void>;
  restartTimelineAfterPlaybackRollbackIfNeeded(): Promise<void>;
  syncToTick(tickNumber: number, playbackTickNumberOnReady?: number): Promise<SimulationTickPullStatus>;
  pollPerfReport(tickNumber: number): Promise<void>;
}

export class LegacyPlaybackController {
  public constructor(private readonly context: LegacyPlaybackContext) {}

  public get pendingRequest(): Promise<void> | null { return this.playbackTickRequestCompletion; }
  public get bufferedSize(): number { return this.playbackHotQueue.size; }
  public get latestBufferedTick(): number {
    let latest = 0;
    for (const snapshot of this.playbackHotQueue.values()) latest = Math.max(latest, snapshot.tickNumber);
    return latest;
  }
  public enqueueSnapshot(snapshot: RuntimeTickSnapshot): void {
    this.playbackHotQueue.set(snapshot.tickNumber, snapshot);
  }
  public resetStatistics(): void {
    this.tpsAccumulatedTicks = 0;
    this.tpsAccumulatedMs = 0;
  }

  private tpsAccumulatedTicks = 0;

  private tpsAccumulatedMs = 0;

  private playbackTickRequestInFlight = false;

  private playbackTickRequestCompletion: Promise<void> | null = null;

  public playbackTargetTickNumber = 0;

  private readonly playbackHotQueue = new Map<number, RuntimeTickSnapshot>();

  private playbackHotQueueGeneration = 0;

  private playbackPrefetchRetryAfterMs = 0;

  private playbackAckRequestInFlight = false;

  private pendingPlaybackAckTickNumber: number | null = null;

  private topologyPresentationBoundary: TopologyPresentationBoundary | null = null;

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

  public readonly advancePlaybackByDeltaMs: SimulationAction["advancePlaybackByDeltaMs"] = async (
    deltaMs,
  ) => {
    // 诊断统计必须在调用点服从 debugMode 总开关，关闭时连每帧累计都不执行。
    if (this.context.getPerfEnabled?.() === true) {
      this.diagFrameCount += 1;
      this.diagTotalDeltaMs += deltaMs;

      if (this.diagFrameCount - this.diagLastLogFrame >= 600) {
        const intervalFrames = this.diagFrameCount - this.diagLastLogFrame;
        const avgDeltaMs = this.diagTotalDeltaMs / intervalFrames;
        const avgTickDelta = avgDeltaMs * STANDARD_TICK_RATE_PER_SECOND * this.context.stateReadWrite.simulationSpeed / 1000;
        const playbackProgress = this.context.stateReadWrite.currentPlaybackTickNumber - this.diagLastLogPlaybackTick;
        const inFlightRate = intervalFrames > 0 ? (this.diagInFlightSkipCount / intervalFrames * 100).toFixed(1) : '0';
        const notReadyRate = intervalFrames > 0 ? (this.diagNotReadyCount / intervalFrames * 100).toFixed(1) : '0';
        console.debug(
          `[PlaybackDiag] +${intervalFrames}f avgMs=${avgDeltaMs.toFixed(2)} tickΔ=${avgTickDelta.toFixed(4)} ` +
          `crosses=${this.diagCrossCount} consumed=${this.diagTickConsumedCount} ` +
          `inFlightSkip=${this.diagInFlightSkipCount}(${inFlightRate}%) notReady=${this.diagNotReadyCount}(${notReadyRate}%) ` +
          `rollbackMaxConsec=${this.diagMaxConsecutiveRollbacks} ` +
          `playbackΔ=${playbackProgress.toFixed(2)} ` +
          `tps=${this.context.stateReadWrite.statistics.tickPerSecond} buff=${this.context.stateReadWrite.runtimeStatus.bufferSize}`,
        );

        this.diagLastLogFrame = this.diagFrameCount;
        this.diagLastLogPlaybackTick = this.context.stateReadWrite.currentPlaybackTickNumber;
        this.diagTotalDeltaMs = 0;
        this.diagCrossCount = 0;
        this.diagInFlightSkipCount = 0;
        this.diagNotReadyCount = 0;
        this.diagTickConsumedCount = 0;
        this.diagMaxConsecutiveRollbacks = 0;
      }
    }

    if (this.context.stateReadWrite.runningState !== "start") {
      return;
    }

    this.ensurePlaybackHotQueue();

    const previousPlaybackTickNumber = this.context.stateReadWrite.currentPlaybackTickNumber;
    // simulationSpeed 有且仅有这一处可以参与运算：它只影响 add time 的推进速度。
    // AI-CORRECTION 2026-05-19: worker 也会接收 simulationSpeed，但只用于缓存余量的墙钟秒估算，不参与 runtime 物理时间推进。
    // 任何其他场合都不得使用该倍率做 tick/second 换算；换算只能依赖 standard tick rate。
    const standardTickRate = this.context.presentation.currentSnapshot?.standardTickRate
      ?? this.context.topology.getSnapshot()?.standardTickRate
      ?? STANDARD_TICK_RATE_PER_SECOND;
    const tickDelta = deltaMs
      * standardTickRate
      * this.context.stateReadWrite.simulationSpeed
      / 1000;

    // 位置始终按墙钟推进，不受 Worker bridge 在途状态影响。
    // playbackTickRequestInFlight 仅阻止并发请求，不冻结动画。
    // AI-CORRECTION 2026-07-15: 墙钟目标继续累计，但公开播放游标必须受已展示快照与本帧步长约束；
    // Worker 背压期间冻结在下一边界，恢复后逐步消费欠账，不能一次跳到最新墙钟目标。
    runInAction(() => {
      this.playbackTargetTickNumber = Math.max(
        this.playbackTargetTickNumber,
        this.context.stateReadWrite.currentPlaybackTickNumber,
      ) + tickDelta;
      const synchronizedTickNumber = this.context.presentation.currentSnapshot?.tickNumber
        ?? Math.min(
          Math.trunc(previousPlaybackTickNumber),
          this.context.stateReadWrite.runtimeStatus.latestTickNumber ?? 0,
        );
      const maxFrameStepTicks = Math.max(1, Math.ceil(Math.max(0, tickDelta)));
      // AI-REMOVED 2026-09-04:
      // Reason: 真实 tick 区间只限制旧快照的 progress 展示外推，不限制墙钟播放目标。
      // Trigger: 高倍速且当前 tickRate 较高时，逐真实 tick 限制会让 60 FPS 播放永久追不上 runtime。
      // Evidence: playback-backpressure x16 用例的墙钟目标为 32；稀疏队列应直接选择不晚于目标的最新真实快照。
      // Replacement: maxFrameStepTicks 继续按本帧墙钟增量限制公开游标；progress 由 resolvePresentedRecipeProgressSeconds 钳制单区间。
      // Risk: Worker 背压时游标可领先当前快照，但所有离散展示仍只读取 currentSnapshot。
      // Human Review: Required
      //
      // Original code:
      // const currentSnapshot = this.stateReadWrite.currentSnapshot;
      // const currentRealTickInterval = currentSnapshot === null
      //   ? 1
      //   : currentSnapshot.standardTickRate / currentSnapshot.tickRate;
      const migrationBoundaryTickNumber = this.topologyPresentationBoundary?.maxPlaybackTickNumber
        ?? Number.POSITIVE_INFINITY;
      this.context.stateReadWrite.currentPlaybackTickNumber = Math.max(
        previousPlaybackTickNumber,
        Math.min(
          this.playbackTargetTickNumber,
          synchronizedTickNumber + maxFrameStepTicks,
          migrationBoundaryTickNumber,
        ),
      );
      this.context.syncTimelineCursorFromPlayback();
    });
    this.resolveReachedTopologyPresentationBoundary();

    const previousIntegerTickNumber = Math.trunc(previousPlaybackTickNumber);
    const nextIntegerTickNumber = Math.trunc(this.context.stateReadWrite.currentPlaybackTickNumber);

    // 计算本 delta 内实际获得的整数 tick 数，用于 TPS 统计
    let actualTicksProcessed = 0;

    const synchronizedTickNumber = this.context.presentation.currentSnapshot?.tickNumber
      ?? Math.min(
        previousIntegerTickNumber,
        this.context.stateReadWrite.runtimeStatus.latestTickNumber ?? 0,
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
    if (this.context.isTopologyRefreshing()) {
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
  /** AI-CORRECTION 2026-09-04: ST2-RQ-024 后缓存键是稀疏标准 tick；现返回区间内不晚于播放游标的最新真实 tick。 */
  private takePlaybackSnapshotThrough(
    fromTickNumber: number,
    toTickNumber: number,
  ): RuntimeTickSnapshot | null {
    const availableTickNumbers = [...this.playbackHotQueue.keys()]
      .filter((tickNumber) => tickNumber >= fromTickNumber && tickNumber <= toTickNumber)
      .sort((left, right) => left - right);
    if (availableTickNumbers.length === 0) {
      return null;
    }

    let snapshot: RuntimeTickSnapshot | null = null;
    for (const tickNumber of availableTickNumbers) {
      snapshot = this.playbackHotQueue.get(tickNumber) ?? null;
      this.playbackHotQueue.delete(tickNumber);
    }
    // AI-REMOVED 2026-09-04:
    // Reason: 连续整数前缀算法会把合法的稀疏真实 tick 误判为缓存缺口。
    // Trigger: ST2-RQ-024 要求 Legacy 只缓存真实运行 tick。
    // Evidence: dynamic tick rate 低于 standard tick rate 时，相邻真实快照的标准 tickNumber 不连续。
    // Replacement: 上方 availableTickNumbers 排序与范围消费。
    // Risk: Low；返回值仍是范围内最新快照。
    // Human Review: Required
    //
    // Original code:
    // let availableToTickNumber = fromTickNumber - 1;
    // for (let tickNumber = fromTickNumber; tickNumber <= toTickNumber; tickNumber += 1) {
    //   if (!this.playbackHotQueue.has(tickNumber)) {
    //     break;
    //   }
    //   availableToTickNumber = tickNumber;
    // }
    //
    // if (availableToTickNumber < fromTickNumber) {
    //   return null;
    // }
    //
    // let snapshot: RuntimeTickSnapshot | null = null;
    // for (let tickNumber = fromTickNumber; tickNumber <= availableToTickNumber; tickNumber += 1) {
    //   snapshot = this.playbackHotQueue.get(tickNumber) ?? null;
    //   this.playbackHotQueue.delete(tickNumber);
    // }
    return snapshot;
  }

  private publishPlaybackSnapshot(snapshot: RuntimeTickSnapshot): void {
    runInAction(() => {
      this.context.presentation.currentSnapshot = snapshot;
      this.context.stateReadWrite.statistics = {
        ...this.context.stateReadWrite.statistics,
        baseBatteryJoules: snapshot.baseBatteryJoules,
        baseBatteryCapacity: snapshot.baseBatteryCapacity,
      };
      this.context.syncTimelineCursorFromPlayback();
    });

    if (this.context.getPerfEnabled?.()) {
      void this.context.pollPerfReport(snapshot.tickNumber);
    }
    void this.context.checkTimelineSafetySync(snapshot.tickNumber);
  }

  /** 低于低水位时补到容量上限；任意时刻最多一个范围请求在途。 */
  public ensurePlaybackHotQueue(): void {
    if (this.context.isRegionalActive()) {
      return;
    }
    const currentSnapshot = this.context.presentation.currentSnapshot;
    if (
      currentSnapshot === null
      || this.context.stateReadWrite.runningState !== "start"
      || this.context.isTopologyRefreshing()
      || this.context.stateReadWrite.timeline.isSeeking
      || this.playbackTickRequestInFlight
      || this.playbackHotQueue.size >= PLAYBACK_HOT_QUEUE_LOW_WATER
      || performance.now() < this.playbackPrefetchRetryAfterMs
    ) {
      return;
    }

    const generation = this.playbackHotQueueGeneration;
    const fallbackPlaybackTickNumber = this.context.stateReadWrite.currentPlaybackTickNumber;
    const queuedTickNumbers = [...this.playbackHotQueue.keys()];
    const fromTickNumber = Math.max(
      currentSnapshot.tickNumber,
      queuedTickNumbers.length === 0
        ? currentSnapshot.tickNumber
        : Math.max(...queuedTickNumbers),
    ) + 1;
    const requestCount = PLAYBACK_HOT_QUEUE_CAPACITY - this.playbackHotQueue.size;
    const toTickNumber = fromTickNumber + requestCount - 1;
    this.playbackTickRequestInFlight = true;

    const completion = this.context.bridge.getTickSnapshotRange(
      fromTickNumber,
      toTickNumber,
      generation,
      this.context.stateReadWrite.simulationSpeed,
    ).then(async (response) => {
      if (
        generation !== this.playbackHotQueueGeneration
        || response.result.generation !== generation
      ) {
        return;
      }

      runInAction(() => {
        this.context.stateReadWrite.runtimeStatus = response.status;
      });

      let previousTickNumber = fromTickNumber - 1;
      for (const snapshot of response.result.snapshots) {
        if (
          snapshot.tickNumber <= previousTickNumber
          || snapshot.tickNumber > toTickNumber
          || snapshot.topologyId !== currentSnapshot.topologyId
          || snapshot.documentHash !== currentSnapshot.documentHash
        ) {
          break;
        }
        this.playbackHotQueue.set(snapshot.tickNumber, snapshot);
        previousTickNumber = snapshot.tickNumber;
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
    if (this.context.isRegionalActive()) {
      // 区域快照由区域会话管理缓存；没有单基地 Worker 呈现确认可回传。
      this.pendingPlaybackAckTickNumber = null;
      return;
    }

    const generation = this.playbackHotQueueGeneration;
    const tickNumber = this.pendingPlaybackAckTickNumber;
    this.pendingPlaybackAckTickNumber = null;
    this.playbackAckRequestInFlight = true;
    void this.context.bridge.acknowledgePresentedTick(tickNumber, generation)
      .then((response) => {
        if (
          generation === this.playbackHotQueueGeneration
          && response.generation === generation
        ) {
          runInAction(() => {
            this.context.stateReadWrite.runtimeStatus = response.status;
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
  public resetPlaybackHotQueue(): void {
    this.playbackHotQueueGeneration += 1;
    this.playbackHotQueue.clear();
    this.playbackPrefetchRetryAfterMs = 0;
    this.pendingPlaybackAckTickNumber = null;
    this.playbackTickRequestInFlight = false;
    this.playbackTickRequestCompletion = null;
  }

  public async recoverPlaybackFromUnavailableTick(
    status: Extract<SimulationTickPullStatus, { readonly status: "not-found" }>,
    fallbackPlaybackTickNumber: number,
  ): Promise<void> {
    const recoveryTickNumber = status.retainedFromTick
      ?? this.context.presentation.currentSnapshot?.tickNumber
      ?? status.latestTickNumber;
    if (recoveryTickNumber === null || recoveryTickNumber === undefined) {
      runInAction(() => {
        this.context.stateReadWrite.currentPlaybackTickNumber = fallbackPlaybackTickNumber;
        this.playbackTargetTickNumber = fallbackPlaybackTickNumber;
        this.context.syncTimelineCursorFromPlayback({ retargetWindow: false });
      });
      await this.context.restartTimelineAfterPlaybackRollbackIfNeeded();
      return;
    }

    const recoveryStatus = await this.context.syncToTick(recoveryTickNumber, recoveryTickNumber);
    if (recoveryStatus.status !== "ready") {
      runInAction(() => {
        this.context.stateReadWrite.currentPlaybackTickNumber = fallbackPlaybackTickNumber;
        this.playbackTargetTickNumber = fallbackPlaybackTickNumber;
        this.context.syncTimelineCursorFromPlayback({ retargetWindow: false });
      });
    }
    await this.context.restartTimelineAfterPlaybackRollbackIfNeeded();
  }

  public beginTopologyPresentationBoundary(
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
      && this.context.stateReadWrite.currentPlaybackTickNumber >= boundary.maxPlaybackTickNumber
    ) {
      boundary.resolveReached();
    }
  }

  public completeTopologyPresentationBoundary(snapToBoundary: boolean): void {
    const boundary = this.topologyPresentationBoundary;
    if (boundary === null) {
      return;
    }
    if (snapToBoundary) {
      this.context.stateReadWrite.currentPlaybackTickNumber = Math.max(
        this.context.stateReadWrite.currentPlaybackTickNumber,
        boundary.maxPlaybackTickNumber,
      );
      this.playbackTargetTickNumber = Math.max(
        this.playbackTargetTickNumber,
        boundary.maxPlaybackTickNumber,
      );
      this.context.syncTimelineCursorFromPlayback();
    }
    this.releaseTopologyPresentationBoundary(boundary);
  }

  public releaseTopologyPresentationBoundary(
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

  /** 累积 tick 和时间，每 TPS_WINDOW_MS 刷新一次 TPS 统计 */
  private accumulateTps(deltaMs: number, actualTicks: number): void {
    this.tpsAccumulatedTicks += actualTicks;
    this.tpsAccumulatedMs += deltaMs;

    if (this.tpsAccumulatedMs >= TPS_WINDOW_MS) {
      const tps = this.tpsAccumulatedMs > 0
        ? this.tpsAccumulatedTicks / (this.tpsAccumulatedMs / 1000)
        : 0;

      const dynamicTickRate = this.context.stateReadWrite.runtimeStatus.dynamicTickRate ?? STANDARD_TICK_RATE_PER_SECOND;
      const targetTps = this.context.stateReadWrite.simulationSpeed * dynamicTickRate;

      runInAction(() => {
        this.context.stateReadWrite.statistics = {
          ...this.context.stateReadWrite.statistics,
          tickPerSecond: Math.round(tps * 10) / 10,
          targetTickPerSecond: targetTps,
        };
      });

      this.tpsAccumulatedTicks = 0;
      this.tpsAccumulatedMs = 0;
    }
  }
}
