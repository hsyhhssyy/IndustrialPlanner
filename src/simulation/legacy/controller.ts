import { action, runInAction } from "mobx";
import type { SimulationAction } from "@/domain/simulation/simulation-action";
import type { SimulationPerformanceDiagnosticsReadModel } from "@/domain/simulation";

import type { WorkspaceContract } from "@/domain/document/workspace-contract";
import type { WorldDocument } from "@/domain/document/world-document";
import { SIMULATION_MODE } from "@/domain/shared/simulation-mode";

import { isRegionalSimulationSpeed } from "@/shared/regional-simulation-speed";
import type { SnapshotStoreReadWrite } from "@/shared/snapshot/snapshot-store";

import { compileSimulationTopology, createSimulationDocumentHash } from "../topology";
import { prepareCurrentSimulationDocument } from "../topology";
import { createSimulationTopologyMigration } from "../topology";
import { createInitialSimulationRuntimeStatus, createInitialSimulationTimelineState } from "../contracts";
import { DEFAULT_SIMULATION_SPEED, STANDARD_TICK_RATE_PER_SECOND } from "../contracts";
import type {
  CompiledSimulationTopology,
  SimulationStartResult,
  SimulationTickPullStatus,
  SimulationRuntimeTransition,
  TickPerfHotPathDetails,
  TickPerfStage3Details,
} from "../contracts";

import type { SimulationInternalAction } from "@/simulation/contracts";
import type { LegacyPresentationState } from "./state";
import type { SimulationStateReadWrite } from "../contracts";
import type { SimulationWorkerBridge, TimelineWorkerBridge } from "./bridge-contract";
import { LegacyTimelineController } from "./timeline";
import { LegacyPlaybackController } from "./playback";
import { LegacyRegionalController } from "./regional";
import {
  logger,
  cloneWorldDocument,
  computePoweredEntityIds,
  normalizeActiveActivityIds,
  normalizeRegionalResourceSettings,
} from "./controller-support";

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

// AI-REMOVED 2026-08-28:
// Reason: 该代码仅服务已归档的 Playwright 区域蓝图 Runner，新 Blueprint Runner 直接驱动区域仿真 session。
// Trigger: 用户明确要求当前及未来此类用例归入 Blueprint 测试组。
// Evidence: 两种报告类型仅被已归档浏览器 Runner 使用。
// Replacement: src/tests/simulation/regional-blueprint-runner.ts 中的 RegionalBlueprintSimulationCapture
// Risk: Low
// Human Review: Required
//
// Original code:
// export interface RegionalSimulationBaseTickSummary {
//   readonly tickNumber: number;
//   readonly totalPowerDemand: number;
//   readonly warehouseStats: RuntimeTickSnapshot["warehouseStats"];
// }
//
// export interface RegionalSimulationTickSyncResult {
//   readonly requestedTickNumber: number;
//   readonly committedTickNumber: number;
//   readonly committedEpochNumber: number;
//   readonly warehouseVersion: number;
//   readonly warehouseCounts: Readonly<Record<string, number>>;
//   readonly warehouseStats: RuntimeTickSnapshot["warehouseStats"];
//   readonly baseSummaries: Readonly<Record<string, RegionalSimulationBaseTickSummary>>;
// }
//
interface SimulationActionImplOptions {
  workspace: WorkspaceContract;
  state: SimulationStateReadWrite;
  presentation: LegacyPresentationState;
  topology: SnapshotStoreReadWrite<CompiledSimulationTopology | null>;
  bridge: SimulationWorkerBridge;
  createTimelineBridge?: () => TimelineWorkerBridge;
  getPerfEnabled?: () => boolean;
  getDebugDataEnabled?: () => boolean;
  getActiveActivityIds?: () => readonly string[];
  getRegionalResourceSettings?: (regionTag: string) => readonly import("../contracts").RegionalResourceSupplySetting[];
  regionalWorkerMode?: "auto" | "runtime";
}

function createMissingTimelineWorkerBridge(): TimelineWorkerBridge {
  throw new Error("Timeline worker bridge is not configured.");
}

export class SimulationActionImpl implements SimulationAction, SimulationInternalAction {
  private readonly timeline: LegacyTimelineController;
  private readonly playback: LegacyPlaybackController;
  private readonly regional: LegacyRegionalController;

  private readonly workspace: WorkspaceContract;

  private readonly stateReadWrite: SimulationStateReadWrite;
  private readonly presentation: LegacyPresentationState;

  private readonly topology: SnapshotStoreReadWrite<CompiledSimulationTopology | null>;

  private readonly bridge: SimulationWorkerBridge;

  private readonly createTimelineBridge: () => TimelineWorkerBridge;

  private readonly getPerfEnabled: (() => boolean) | undefined;

  private readonly getDebugDataEnabled: (() => boolean) | undefined;

  private readonly getActiveActivityIds: (() => readonly string[]) | undefined;

  private readonly getRegionalResourceSettings: SimulationActionImplOptions["getRegionalResourceSettings"];

  private readonly regionalWorkerMode: "auto" | "runtime";

  // AI-REMOVED 2026-08-28:
  // Reason: 该代码仅服务已归档的 Playwright 区域蓝图 Runner，新 Blueprint Runner 直接驱动区域仿真 session。
  // Trigger: 用户明确要求当前及未来此类用例归入 Blueprint 测试组。
  // Evidence: 两个字段仅被已归档同步动作读取。
  // Replacement: None；现有 regionalPreviousBaseSnapshots 足以服务应用运行路径。
  // Risk: Low
  // Human Review: Required
  //
  // Original code:
  // private regionalPreviousSnapshotsByBaseId: Readonly<Record<string, RuntimeTickSnapshot | null>> = {};
  // private regionalTickSyncInFlight: Promise<RegionalSimulationTickSyncResult> | null = null;
// AI-REMOVED 2026-09-09:
// Reason: 明确状态归属并清理重组产生的重复声明。
// Trigger: Host / legacy 控制器重构。
// Evidence: 公共 Query 与子控制器已接管对应职责，原 import 或状态入口不再需要。
// Replacement: Legacy controller.compiledSource
// Risk: Low
// Human Review: Required
// Original code:
//   private compiledDocument: WorldDocument | null = null;

// AI-REMOVED 2026-09-09:
// Reason: 明确状态归属并清理重组产生的重复声明。
// Trigger: Host / legacy 控制器重构。
// Evidence: 公共 Query 与子控制器已接管对应职责，原 import 或状态入口不再需要。
// Replacement: Legacy controller.compiledSource
// Risk: Low
// Human Review: Required
// Original code:
//   private compiledActivitySignature: string | null = null;

  private readonly compiledSource = { document: null as WorldDocument | null, activitySignature: null as string | null };

  private compiledRegionalResourceSignature: string | null = null;

  private nextPerfReportTick = 180;

  private topologyRefreshQueue: Promise<void> | null = null;

  private topologyRevision = 0;

  private lastWorkerDebugEnabled: boolean | null = null;

  private lastWorkerDebugDataEnabled: boolean | null = null;

  public constructor(options: SimulationActionImplOptions) {
    this.workspace = options.workspace;
    this.stateReadWrite = options.state;
    this.presentation = options.presentation;
    this.topology = options.topology;
    this.bridge = options.bridge;
    this.createTimelineBridge = options.createTimelineBridge ?? createMissingTimelineWorkerBridge;
    this.getPerfEnabled = options.getPerfEnabled;
    this.getDebugDataEnabled = options.getDebugDataEnabled;
    this.getActiveActivityIds = options.getActiveActivityIds;
    this.getRegionalResourceSettings = options.getRegionalResourceSettings;
    this.regionalWorkerMode = options.regionalWorkerMode ?? "auto";
// AI-REMOVED 2026-09-09:
// Reason: 明确状态归属并清理重组产生的重复声明。
// Trigger: Host / legacy 控制器重构。
// Evidence: 公共 Query 与子控制器已接管对应职责，原 import 或状态入口不再需要。
// Replacement: 显式上下文回调
// Risk: Low
// Human Review: Required
// Original code:
//     const controller = this;

    this.playback = new LegacyPlaybackController({
      stateReadWrite: this.stateReadWrite, presentation: this.presentation, topology: this.topology, bridge: this.bridge,
      getPerfEnabled: this.getPerfEnabled,
      isRegionalActive: () => this.regional.active,
      isTopologyRefreshing: () => this.topologyRefreshQueue !== null,
      syncTimelineCursorFromPlayback: (options) => this.timeline.syncTimelineCursorFromPlayback(options),
      checkTimelineSafetySync: (tick) => this.timeline.checkTimelineSafetySync(tick),
      restartTimelineAfterPlaybackRollbackIfNeeded: () => this.timeline.restartTimelineAfterPlaybackRollbackIfNeeded(),
      syncToTick: (tick, playbackTick) => this.syncToTick(tick, playbackTick),
      pollPerfReport: (tick) => this.pollPerfReport(tick),
    });
    this.timeline = new LegacyTimelineController({
      stateReadWrite: this.stateReadWrite, presentation: this.presentation, topology: this.topology, bridge: this.bridge,
      createTimelineBridge: this.createTimelineBridge, start: () => this.start(),
      compiledSource: this.compiledSource, playback: this.playback,
    });
    this.regional = new LegacyRegionalController({
      workspace: this.workspace, stateReadWrite: this.stateReadWrite, presentation: this.presentation, topology: this.topology,
      getRegionalResourceSettings: this.getRegionalResourceSettings, getActiveActivityIds: this.getActiveActivityIds,
      regionalWorkerMode: this.regionalWorkerMode, playback: this.playback,
      recoverFromStartFailure: (error) => this.recoverFromStartFailure(error),
    });
  }

  public getPerformanceDiagnostics(): SimulationPerformanceDiagnosticsReadModel {
    const dynamicTickRate = this.stateReadWrite.runtimeStatus.dynamicTickRate
      ?? this.topology.getSnapshot()?.standardTickRate
      ?? STANDARD_TICK_RATE_PER_SECOND;
    return {
      tickPerSecond: this.playback.tickPerSecond,
      targetTickPerSecond: this.stateReadWrite.runningState === "start"
        ? this.stateReadWrite.simulationSpeed * dynamicTickRate
        : 0,
      playbackBufferedFrameCount:
        this.playback.bufferedSize + (this.presentation.currentSnapshot === null ? 0 : 1),
      runtimeRetainedStateCount: this.stateReadWrite.runtimeStatus.bufferSize,
      timelineRetainedFrameCount: this.timeline.retainedFrameCount,
      timelineGeneratedFramePerSecond: this.timeline.generatedFramePerSecond,
    };
  }

  public readonly start: SimulationAction["start"] = async () => {
    // 启动互斥：启动中重复调用直接忽略。顶部控制按钮在 starting 期间已禁用，
    // 这里是 gesture 等非 UI 路径的兜底。
    if (this.stateReadWrite.runningState === "starting") {
      return;
    }
    runInAction(() => {
      this.stateReadWrite.hasStarted = true;
      this.stateReadWrite.runningState = "starting";
    });

    try {
      if (this.stateReadWrite.simulationMode === SIMULATION_MODE.regionalMultiBase) {
        await this.regional.startRegionalSimulation();
      } else {
        const result = await this.refreshFromCurrentDocument();
        if (result.status === "started") {
          runInAction(() => {
            this.stateReadWrite.runningState = "start";
          });
          this.playback.ensurePlaybackHotQueue();
        } else {
          this.recoverFromStartFailure();
        }
      }
    } catch (error) {
      console.error("[Simulation] Failed to start simulation.", error);
      this.recoverFromStartFailure(error);
    }
  };

  public readonly setRegionalMultiBaseEnabled: SimulationAction["setRegionalMultiBaseEnabled"] = action((enabled) => {
    const simulationMode = enabled
      ? SIMULATION_MODE.regionalMultiBase
      : SIMULATION_MODE.singleBase;
    if (simulationMode === this.stateReadWrite.simulationMode) {
      return;
    }
    if (this.stateReadWrite.runningState !== "stop") {
      return;
    }
    if (enabled && this.stateReadWrite.timeline.enabled) {
      return;
    }
    if (enabled && !isRegionalSimulationSpeed(this.stateReadWrite.simulationSpeed)) {
      this.setSimulationSpeed(DEFAULT_SIMULATION_SPEED);
    }
    this.stateReadWrite.simulationMode = simulationMode;
  });

  public readonly pause: SimulationAction["pause"] = action(() => {
    this.timeline.cancelPendingResume();
    this.stateReadWrite.runningState = "pause";
    this.playback.completeTopologyPresentationBoundary(true);
    if (this.regional.active) {
      this.regional.pause();
    }
  });

  public readonly resume: SimulationAction["resume"] = action(() => {
    if (this.stateReadWrite.runningState !== "pause") {
      return;
    }

    if (this.timeline.resumePendingPresentation()) return;

    this.stateReadWrite.runningState = "start";
    if (this.regional.active) {
      this.regional.resume();
    } else {
      this.playback.ensurePlaybackHotQueue();
    }
  });

  public readonly stop: SimulationAction["stop"] = action(() => {
    this.clearPlaybackProgress();
  });

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
    if (this.regional.active) {
      const topology = this.topology.getSnapshot();
      return {
        status: "started",
        topologyId: topology?.topologyId ?? null,
        diagnostics: topology?.diagnostics ?? [],
      };
    }
    const playbackTickRequestCompletion = this.playback.pendingRequest;
    if (playbackTickRequestCompletion !== null) {
      await playbackTickRequestCompletion;
    }

    const sourceDocument = this.workspace.editor?.document.getSnapshot();
    if (sourceDocument === undefined) {
      this.topology.setSnapshot(null);
      this.compiledSource.document = null;
      this.compiledSource.activitySignature = null;
      this.compiledRegionalResourceSignature = null;
      runInAction(() => {
        this.presentation.currentSnapshot = null;
        this.stateReadWrite.currentPlaybackTickNumber = 0;
        this.playback.playbackTargetTickNumber = 0;
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

    const document = prepareCurrentSimulationDocument({
      document: sourceDocument,
      workspace: this.workspace,
    });
    const previousTopology = this.topology.getSnapshot();
    const nextDocumentHash = createSimulationDocumentHash(document);
    const activeActivityIds = normalizeActiveActivityIds(this.getActiveActivityIds?.() ?? []);
    const nextActivitySignature = JSON.stringify(activeActivityIds);
    const currentBase = this.workspace.registry.baseDefinitions.find(
      (definition) => definition.id === document.baseId,
    );
    const regionalResources = currentBase === undefined || this.getRegionalResourceSettings === undefined
      ? undefined
      : normalizeRegionalResourceSettings(this.getRegionalResourceSettings(currentBase.tag));
    const nextRegionalResourceSignature = regionalResources === undefined
      ? "legacy-device-policy"
      : JSON.stringify(regionalResources);
    if (
      this.compiledSource.document !== null
      && previousTopology !== null
      && this.stateReadWrite.runtimeStatus.mode !== "error"
      && previousTopology.documentHash === nextDocumentHash
      && this.compiledSource.activitySignature === nextActivitySignature
      && this.compiledRegionalResourceSignature === nextRegionalResourceSignature
    ) {
      return {
        status: "started",
        topologyId: previousTopology.topologyId,
        diagnostics: previousTopology.diagnostics,
      };
    }

    this.topologyRevision += 1;
    this.playback.resetPlaybackHotQueue();
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
      simulationMode: this.stateReadWrite.simulationMode,
      poweredEntityIds: computePoweredEntityIds({
        document,
        registry: this.workspace.registry,
      }),
      activeActivityIds,
      regionalResources,
    });
    const compileError = compiledTopology.diagnostics.find(
      (diagnostic) => diagnostic.severity === "error",
    );
    if (compileError !== undefined) {
      runInAction(() => {
        this.stateReadWrite.runtimeStatus = {
          ...this.stateReadWrite.runtimeStatus,
          mode: "error",
          error: compileError.message,
        };
      });
      return {
        status: "failed",
        topologyId: compiledTopology.topologyId,
        diagnostics: compiledTopology.diagnostics,
        error: compileError.message,
      };
    }
    const previousDocument = this.compiledSource.document;
    const shouldMarkTimelineDocumentChange =
      this.stateReadWrite.timeline.enabled
      && previousDocument !== null
      && previousTopology !== null;
    const displayedSnapshot = this.presentation.currentSnapshot;
    const displayedTickNumber = displayedSnapshot?.tickNumber ?? 0;
    const nextTickNumber = displayedTickNumber + (
      displayedSnapshot === null
        ? 1
        : displayedSnapshot.standardTickRate / displayedSnapshot.tickRate
    );
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
      : this.playback.beginTopologyPresentationBoundary(
          canMigrateAtNextTick
            ? baseTickNumber
            : this.stateReadWrite.currentPlaybackTickNumber,
        );
    const perfEnabled = this.getPerfEnabled?.() ?? false;
    const debugDataEnabled = this.getDebugDataEnabled?.() ?? false;
    const powerMode = document.documentSettings.powerMode ?? "infinite";
    const configuredPowerConsumptionOverride =
      document.documentSettings.powerConsumptionOverride;
    const powerConsumptionOverride = typeof configuredPowerConsumptionOverride === "number"
        && Number.isFinite(configuredPowerConsumptionOverride)
        && configuredPowerConsumptionOverride >= 0
      ? configuredPowerConsumptionOverride
      : undefined;
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
        powerMode,
        powerConsumptionOverride,
      );
    } catch (error) {
      if (this.lastWorkerDebugEnabled === perfEnabled) {
        this.lastWorkerDebugEnabled = null;
      }
      if (this.lastWorkerDebugDataEnabled === debugDataEnabled) {
        this.lastWorkerDebugDataEnabled = null;
      }
      this.playback.releaseTopologyPresentationBoundary(presentationBoundary);
      throw error;
    }
    logTopologyRuntimeTransition(response.result.runtimeTransition);
    if (response.result.status !== "started") {
      this.playback.releaseTopologyPresentationBoundary(presentationBoundary);
      runInAction(() => {
        this.stateReadWrite.runtimeStatus = response.status;
      });
      return response.result;
    }
    if (presentationBoundary !== null) {
      await presentationBoundary.reached;
    }
    this.topology.setSnapshot(compiledTopology);
    this.compiledSource.document = cloneWorldDocument(document);
    this.compiledSource.activitySignature = nextActivitySignature;
    this.compiledRegionalResourceSignature = nextRegionalResourceSignature;

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
      this.playback.releaseTopologyPresentationBoundary(presentationBoundary);
    }
    if (tickStatus.status === "not-found") {
      await this.playback.recoverPlaybackFromUnavailableTick(
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
      this.timeline.addTimelineMark("document-change");
      await this.timeline.restartTimelineFromCurrentSimulation();
    }

    return response.result;
  };

  public readonly setSimulationSpeed: SimulationInternalAction["setSimulationSpeed"] = action((value) => {
    if (!Number.isFinite(value) || value < 0) {
      return;
    }
    if (
      this.stateReadWrite.simulationMode === SIMULATION_MODE.regionalMultiBase
      && !isRegionalSimulationSpeed(value)
    ) {
      return;
    }
    if (this.regional.active && value !== this.stateReadWrite.simulationSpeed) {
      // 运行中区域提速/降速需重启重新预热；第一版仅在 stop 状态允许实际切换。
      return;
    }

    this.stateReadWrite.simulationSpeed = value;
    if (value === 0) {
      this.playback.completeTopologyPresentationBoundary(true);
    }
    void this.bridge.setSimulationSpeed(value).catch(() => undefined);
  });

  public readonly patchRuntimeSlot: SimulationAction["patchRuntimeSlot"] = async (patch) => {
    if (this.stateReadWrite.runningState === "stop") {
      return;
    }

    this.playback.resetPlaybackHotQueue();
    const response = await this.bridge.patchRuntimeSlot(patch);
    runInAction(() => {
      this.stateReadWrite.runtimeStatus = response.status;
    });

    const targetTickNumber = Math.trunc(this.stateReadWrite.currentPlaybackTickNumber);
    const status = await this.syncToTick(targetTickNumber);
    if (status.status === "not-found") {
      await this.playback.recoverPlaybackFromUnavailableTick(status, targetTickNumber);
    }

    this.timeline.addTimelineMark("runtime-change");
    await this.timeline.restartTimelineFromCurrentSimulation();
  };

  public readonly resetAdmissionCounter: SimulationAction["resetAdmissionCounter"] = async (reset) => {
    if (this.stateReadWrite.runningState === "stop") {
      return;
    }

    this.playback.resetPlaybackHotQueue();
    const response = await this.bridge.resetAdmissionCounter(reset);
    runInAction(() => {
      this.stateReadWrite.runtimeStatus = response.status;
    });

    const targetTickNumber = Math.trunc(this.stateReadWrite.currentPlaybackTickNumber);
    const status = await this.syncToTick(targetTickNumber);
    if (status.status === "not-found") {
      await this.playback.recoverPlaybackFromUnavailableTick(status, targetTickNumber);
    }

    this.timeline.addTimelineMark("runtime-change");
    await this.timeline.restartTimelineFromCurrentSimulation();
  };

  public readonly reset: SimulationInternalAction["reset"] = action(() => {
    this.clearPlaybackProgress();
    this.stateReadWrite.simulationSpeed = DEFAULT_SIMULATION_SPEED;
  });

  public readonly syncToTick: SimulationInternalAction["syncToTick"] = async (
    tickNumber: number,
    playbackTickNumberOnReady?: number,
  ): Promise<SimulationTickPullStatus> => {
    this.playback.resetPlaybackHotQueue();
    const requestTopologyRevision = this.topologyRevision;
    const retainTickNumber = this.presentation.currentSnapshot?.tickNumber;
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
        this.presentation.currentSnapshot = response.result.currentTick;
        // AI-REMOVED 2026-09-12:
        // Reason: 电池读数由当前 Presentation 直接进入文档级运行时 Query，不再复制到公共 State。
        // Trigger: 用户确认移除 SimulationState.statistics。
        // Evidence: response.result.currentTick 已是 LegacySnapshotPresentationProjection 的唯一数据源。
        // Replacement: SimulationQuery.getDocumentRuntimeStatus
        // Risk: Low
        // Human Review: Required
        //
        // Original code:
        // const snap = response.result.currentTick;
        // if (snap !== null) {
        //   this.stateReadWrite.statistics = {
        //     ...this.stateReadWrite.statistics,
        //     baseBatteryJoules: snap.baseBatteryJoules,
        //     baseBatteryCapacity: snap.baseBatteryCapacity,
        //   };
        // }
        if (playbackTickNumberOnReady !== undefined) {
          this.stateReadWrite.currentPlaybackTickNumber = playbackTickNumberOnReady;
          this.playback.playbackTargetTickNumber = playbackTickNumberOnReady;
        }
        this.timeline.syncTimelineCursorFromPlayback();
      }
    });

    // Perf 轮询：每 180 tick 阈值追赶
    if (response.result.status.status === "ready" && this.getPerfEnabled?.()) {
      this.pollPerfReport(tickNumber);
    }

    if (response.result.status.status === "ready") {
      void this.timeline.checkTimelineSafetySync(tickNumber);
    }

    return response.result.status;
  };

  // AI-REMOVED 2026-08-28:
  // Reason: 该代码仅服务已归档的 Playwright 区域蓝图 Runner，新 Blueprint Runner 直接驱动区域仿真 session。
  // Trigger: 用户明确要求当前及未来此类用例归入 Blueprint 测试组。
  // Evidence: 该公开动作仅被已归档浏览器 Runner 调用。
  // Replacement: src/tests/simulation/regional-blueprint-runner.ts#runRegionalBlueprintSimulation
  // Risk: Low
  // Human Review: Required
  //
  // Original code:
  // public readonly syncRegionalToTick: SimulationInternalAction["syncRegionalToTick"] = (
  //   tickNumber,
  //   timeoutMs,
  // ) => {
  //   if (this.regionalTickSyncInFlight !== null) {
  //     throw new Error("Regional tick synchronization is already running.");
  //   }
  //
  //   const sync = this.syncRegionalToTickNow(tickNumber, timeoutMs);
  //   const tracked = sync.finally(() => {
  //     if (this.regionalTickSyncInFlight === tracked) {
  //       this.regionalTickSyncInFlight = null;
  //     }
  //   });
  //   this.regionalTickSyncInFlight = tracked;
  //   return tracked;
  // };
  //
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

  /**
   * 启动失败或启动被中断时复位到 stop，并清空播放队列与游标。
   * 只在 start/startRegionalSimulation 的失败路径调用，
   * 避免 runningState 卡在 "starting" 导致顶部控制按钮永久禁用，
   * 以及失败后残留热队列造成 playbackDiag 空转（notReady=100%）。
   * 传入 error 时覆盖 runtimeStatus 为 error，否则保留各失败分支已设置的具体错误信息。
   */
  private recoverFromStartFailure(error?: unknown): void {
    this.regional.disposeRegionalSession();
    this.playback.resetPlaybackHotQueue();
    runInAction(() => {
      this.stateReadWrite.runningState = "stop";
      this.presentation.currentSnapshot = null;
      this.stateReadWrite.currentPlaybackTickNumber = 0;
      this.playback.playbackTargetTickNumber = 0;
      if (error !== undefined) {
        this.stateReadWrite.runtimeStatus = {
          ...this.stateReadWrite.runtimeStatus,
          mode: "error",
          error: error instanceof Error ? error.message : String(error),
        };
      }
    });
  }

  private clearPlaybackProgress(): void {
    this.regional.disposeRegionalSession();
    this.topologyRevision += 1;
    this.playback.completeTopologyPresentationBoundary(false);
    this.timeline.stopTimelineWorker();
    this.topology.setSnapshot(null);
    this.compiledSource.document = null;
    this.compiledRegionalResourceSignature = null;
    this.stateReadWrite.runningState = "stop";
    this.stateReadWrite.hasStarted = false;
    this.stateReadWrite.runtimeStatus = createInitialSimulationRuntimeStatus();
    this.presentation.currentSnapshot = null;
    this.stateReadWrite.currentPlaybackTickNumber = 0;
    this.stateReadWrite.regionalTotalPowerDemand = null;
    this.playback.playbackTargetTickNumber = 0;
    // AI-REMOVED 2026-09-12:
    // Reason: 性能窗口由 LegacyPlaybackController 私有持有，电池读数来自当前 Presentation。
    // Trigger: 用户确认移除 SimulationState.statistics。
    // Evidence: 下方 resetStatistics 已完整清理内部 TPS；presentation=null 已清理电池投影。
    // Replacement: LegacyPlaybackController.resetStatistics
    // Risk: Low
    // Human Review: Required
    //
    // Original code:
    // this.stateReadWrite.statistics = { tickPerSecond: 0, targetTickPerSecond: 0, baseBatteryJoules: 0, baseBatteryCapacity: 0 };
    this.playback.resetStatistics();
    this.nextPerfReportTick = 180;
    this.playback.resetPlaybackHotQueue();
    this.lastWorkerDebugEnabled = null;
    this.lastWorkerDebugDataEnabled = null;
    Object.assign(this.stateReadWrite.timeline, createInitialSimulationTimelineState());
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
  public readonly enableTimeline: SimulationAction["enableTimeline"] = () => this.timeline.enableTimeline();
  public readonly disableTimeline: SimulationAction["disableTimeline"] = () => this.timeline.disableTimeline();
  public readonly seekTimelineToTick: SimulationAction["seekTimelineToTick"] = (tick) => this.timeline.seekTimelineToTick(tick);
  public readonly advancePlaybackByDeltaMs: SimulationAction["advancePlaybackByDeltaMs"] = (deltaMs) => this.playback.advancePlaybackByDeltaMs(deltaMs);

}
