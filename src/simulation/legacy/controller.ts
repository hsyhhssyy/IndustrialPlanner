import { createLegacyBlueprintEngine } from "./blueprint-engine";
import { BlueprintExecutionClient } from "../blueprint";
import type { SimulationBlueprintRunRequest, SimulationBlueprintRunReport } from "@/domain/simulation";
import { action, runInAction } from "mobx";
import type { SimulationAction } from "@/domain/simulation/simulation-action";
import type { SimulationPerformanceDiagnosticsReadModel } from "@/domain/simulation";

import type { WorkspaceContract } from "@/domain/document/workspace-contract";
import type { WorldDocument } from "@/domain/document/world-document";
import { SIMULATION_MODE } from "@/domain/shared/simulation-mode";

// AI-REMOVED 2026-09-22:
// Reason: 区域模式不再使用专用倍率白名单，Legacy 遗留控制器也不应保留 x4/x16 拦截。
// Trigger: 用户要求所有模式均可使用完整速度。
// Evidence: Legacy 当前公开入口仍固定单基地；移除此白名单可统一内部速度契约且不改变区域运行中调速限制。
// Replacement: setSimulationSpeed 的通用数值校验与既有 regional.active 运行态门禁。
// Risk: Low
// Human Review: Required
//
// Original code:
// import { isRegionalSimulationSpeed } from "@/shared/regional-simulation-speed";
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

import type {
// AI-REMOVED 2026-09-25:
// Reason: 跨基地关系已迁入出口世界文档，移除 App 关系权威的装配和接口。
// Trigger: REQ-038 及用户授权修改 main。
// Evidence: Editor 文档集合与 listDocumentRegionalDarkPipeLinks 已统一提供当前关系。
// Replacement: src/simulation/legacy/regional.ts 从最新文档派生关系。
// Risk: Legacy 单基地和区域启动保护需回归。
// Human Review: Required
// Original code:
//   CreateSimulationHostOptions,
  SimulationInternalAction,
} from "@/simulation/contracts";
import type { LegacyPresentationState } from "./state";
import type { SimulationStateReadWrite } from "../contracts";
import type { SimulationWorkerBridge, TimelineWorkerBridge } from "./bridge-contract";
import { LegacyTimelineController } from "./timeline";
import { LegacyPlaybackController } from "./playback";
// AI-REMOVED 2026-09-25:
// Reason: Legacy 产品入口已固定单基地，区域控制器不可达。
// Trigger: 清理退役的 Legacy 多基地产品实现。
// Evidence: SimulationActionImpl.start 只执行 refreshFromCurrentDocument。
// Replacement: None
// Risk: Low
// Human Review: Required
// Original code:
// import { LegacyRegionalController } from "./regional";
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
// AI-REMOVED 2026-09-25:
// Reason: 跨基地关系已迁入出口世界文档，移除 App 关系权威的装配和接口。
// Trigger: REQ-038 及用户授权修改 main。
// Evidence: Editor 文档集合与 listDocumentRegionalDarkPipeLinks 已统一提供当前关系。
// Replacement: src/simulation/legacy/regional.ts 从最新文档派生关系。
// Risk: Legacy 单基地和区域启动保护需回归。
// Human Review: Required
// Original code:
//   getRegionalDarkPipeLinks?: CreateSimulationHostOptions["getRegionalDarkPipeLinks"];
  regionalWorkerMode?: "auto" | "runtime";
}

function createMissingTimelineWorkerBridge(): TimelineWorkerBridge {
  throw new Error("Timeline worker bridge is not configured.");
}

export class SimulationActionImpl implements SimulationAction, SimulationInternalAction {
  private readonly blueprintExecution: BlueprintExecutionClient;

  public runBlueprint(request: SimulationBlueprintRunRequest, signal?: AbortSignal): Promise<SimulationBlueprintRunReport> {
    return this.blueprintExecution.run(request, signal);
  }

  public disposeBlueprintRuns(): void {
    this.blueprintExecution.dispose();
  }

  private readonly timeline: LegacyTimelineController;
  private readonly playback: LegacyPlaybackController;
  // AI-REMOVED 2026-09-25:
  // Reason: Legacy 已无多基地产品入口。
  // Trigger: 清理不可达的区域控制器状态。
  // Evidence: start 始终写入 SIMULATION_MODE.singleBase。
  // Replacement: 单基地 playback 与 timeline。
  // Risk: Low
  // Human Review: Required
  // Original code:
  // private readonly regional: LegacyRegionalController;

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

// AI-REMOVED 2026-09-25:
// Reason: 跨基地关系已迁入出口世界文档，移除 App 关系权威的装配和接口。
// Trigger: REQ-038 及用户授权修改 main。
// Evidence: Editor 文档集合与 listDocumentRegionalDarkPipeLinks 已统一提供当前关系。
// Replacement: src/simulation/legacy/regional.ts 从最新文档派生关系。
// Risk: Legacy 单基地和区域启动保护需回归。
// Human Review: Required
// Original code:
//   private readonly getRegionalDarkPipeLinks: SimulationActionImplOptions["getRegionalDarkPipeLinks"];

  // AI-REMOVED 2026-09-25:
  // Reason: 此字段仅用于构造退役区域控制器；Blueprint 客户端直接使用 options.regionalWorkerMode。
  // Trigger: 清理 Legacy 多基地产品装配。
  // Evidence: 构造器中该字段无其他有效读取。
  // Replacement: BlueprintExecutionClient 构造参数。
  // Risk: Low
  // Human Review: Required
  // Original code:
  // private readonly regionalWorkerMode: "auto" | "runtime";

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
    this.blueprintExecution = new BlueprintExecutionClient(this.workspace.registry, "legacy", options.regionalWorkerMode ?? "auto",
      (engineOptions) => createLegacyBlueprintEngine(this.workspace.registry, engineOptions));
    this.stateReadWrite = options.state;
    this.presentation = options.presentation;
    this.topology = options.topology;
    this.bridge = options.bridge;
    this.createTimelineBridge = options.createTimelineBridge ?? createMissingTimelineWorkerBridge;
    this.getPerfEnabled = options.getPerfEnabled;
    this.getDebugDataEnabled = options.getDebugDataEnabled;
    this.getActiveActivityIds = options.getActiveActivityIds;
    this.getRegionalResourceSettings = options.getRegionalResourceSettings;
// AI-REMOVED 2026-09-25:
// Reason: 跨基地关系已迁入出口世界文档，移除 App 关系权威的装配和接口。
// Trigger: REQ-038 及用户授权修改 main。
// Evidence: Editor 文档集合与 listDocumentRegionalDarkPipeLinks 已统一提供当前关系。
// Replacement: src/simulation/legacy/regional.ts 从最新文档派生关系。
// Risk: Legacy 单基地和区域启动保护需回归。
// Human Review: Required
// Original code:
//     this.getRegionalDarkPipeLinks = options.getRegionalDarkPipeLinks;
    // AI-REMOVED 2026-09-25:
    // Reason: regionalWorkerMode 字段已移除。
    // Trigger: 清理 Legacy 区域控制器装配。
    // Evidence: BlueprintExecutionClient 已直接消费 options.regionalWorkerMode。
    // Replacement: 上方 BlueprintExecutionClient 构造参数。
    // Risk: Low
    // Human Review: Required
    // Original code:
    // this.regionalWorkerMode = options.regionalWorkerMode ?? "auto";
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
      // AI-REMOVED 2026-09-25:
      // Reason: Legacy playback 不再区分不可达的区域会话。
      // Trigger: 清理多基地残留回调。
      // Evidence: Legacy start 固定 singleBase。
      // Replacement: LegacyPlaybackController 的单基地逻辑。
      // Risk: Low
      // Human Review: Required
      // Original code:
      // isRegionalActive: () => this.regional.active,
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
    // AI-REMOVED 2026-09-25:
    // Reason: Legacy 产品入口不再创建区域会话，控制器无需构造不可达的对象。
    // Trigger: 清理退役的 Legacy 多基地实现。
    // Evidence: start 只调用单基地拓扑启动。
    // Replacement: LegacyPlaybackController 与 LegacyTimelineController。
    // Risk: Low
    // Human Review: Required
    // Original code:
    // this.regional = new LegacyRegionalController({
    //   workspace: this.workspace, stateReadWrite: this.stateReadWrite, presentation: this.presentation, topology: this.topology,
    //   getRegionalResourceSettings: this.getRegionalResourceSettings,
    // AI-REMOVED 2026-09-25:
    // Reason: 跨基地关系已迁入出口世界文档，移除 App 关系权威的装配和接口。
    // Trigger: REQ-038 及用户授权修改 main。
    // Evidence: Editor 文档集合与 listDocumentRegionalDarkPipeLinks 已统一提供当前关系。
    // Replacement: src/simulation/legacy/regional.ts 从最新文档派生关系。
    // Risk: Legacy 单基地和区域启动保护需回归。
    // Human Review: Required
    // Original code:
    //       getRegionalDarkPipeLinks: this.getRegionalDarkPipeLinks,
    //   getActiveActivityIds: this.getActiveActivityIds,
    //   regionalWorkerMode: this.regionalWorkerMode, playback: this.playback,
    //   recoverFromStartFailure: (error) => this.recoverFromStartFailure(error),
    // });
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
      this.stateReadWrite.simulationMode = SIMULATION_MODE.singleBase;
    });

    try {
      // AI-REMOVED 2026-09-20:
      // Reason: Legacy 产品入口不再支持区域多基地，会话启动必须无条件使用单基地拓扑。
      // Trigger: ST2-RQ-035 要求 Legacy 忽略 AppSettings 中保留的 Dense 多基地选择。
      // Evidence: 基地面板在 Legacy 下禁用；SimulationMode 在 start 开始时已固化为 single-base。
      // Replacement: 下方统一的 refreshFromCurrentDocument 单基地启动路径。
      // Risk: Medium；Legacy 区域实现保留为审计代码，但不再有产品启动入口。
      // Human Review: Required
      //
      // Original code:
      // if (this.stateReadWrite.simulationMode === SIMULATION_MODE.regionalMultiBase) {
      //   await this.regional.startRegionalSimulation();
      // } else {
      const result = await this.refreshFromCurrentDocument();
      if (result.status === "started") {
        runInAction(() => {
          this.stateReadWrite.runningState = "start";
        });
        this.playback.ensurePlaybackHotQueue();
      } else {
        this.recoverFromStartFailure();
      }
      // }
    } catch (error) {
      console.error("[Simulation] Failed to start simulation.", error);
      this.recoverFromStartFailure(error);
    }
  };

  // AI-REMOVED 2026-09-20:
  // Reason: Legacy 不支持区域多基地，且会话模式不再允许外部 Action 写入。
  // Trigger: ST2-RQ-035 将用户选择收归 AppSettings，并要求 Legacy 启动始终固化 single-base。
  // Evidence: start 在任何 Worker 初始化前写入 single-base，公共 SimulationAction 已移除该方法。
  // Replacement: SimulationActionImpl.start。
  // Risk: Medium；旧 Legacy 区域实现不可再由产品入口触达。
  // Human Review: Required
  //
  // Original code:
  // public readonly setRegionalMultiBaseEnabled: SimulationAction["setRegionalMultiBaseEnabled"] = action((enabled) => {
  //   const simulationMode = enabled
  //     ? SIMULATION_MODE.regionalMultiBase
  //     : SIMULATION_MODE.singleBase;
  //   if (simulationMode === this.stateReadWrite.simulationMode) {
  //     return;
  //   }
  //   if (this.stateReadWrite.runningState !== "stop") {
  //     return;
  //   }
  //   if (enabled && this.stateReadWrite.timeline.enabled) {
  //     return;
  //   }
  //   if (enabled && !isRegionalSimulationSpeed(this.stateReadWrite.simulationSpeed)) {
  //     this.setSimulationSpeed(DEFAULT_SIMULATION_SPEED);
  //   }
  //   this.stateReadWrite.simulationMode = simulationMode;
  // });

  public readonly pause: SimulationAction["pause"] = action(() => {
    this.timeline.cancelPendingResume();
    this.stateReadWrite.runningState = "pause";
    this.playback.completeTopologyPresentationBoundary(true);
    // AI-REMOVED 2026-09-25:
    // Reason: Legacy 区域会话已无产品启动入口。
    // Trigger: 清理暂停动作的无效分支。
    // Evidence: start 固定 singleBase。
    // Replacement: 上方单基地 playback 暂停处理。
    // Risk: Low
    // Human Review: Required
    // Original code:
    // if (this.regional.active) {
    //   this.regional.pause();
    // }
  });

  public readonly resume: SimulationAction["resume"] = action(() => {
    if (this.stateReadWrite.runningState !== "pause") {
      return;
    }

    if (this.timeline.resumePendingPresentation()) return;

    this.stateReadWrite.runningState = "start";
    // AI-REMOVED 2026-09-25:
    // Reason: Legacy 区域恢复分支不可达。
    // Trigger: 清理退役多基地残留。
    // Evidence: start 固定 singleBase。
    // Replacement: this.playback.ensurePlaybackHotQueue()。
    // Risk: Low
    // Human Review: Required
    // Original code:
    // if (this.regional.active) {
    //   this.regional.resume();
    // } else {
    //   this.playback.ensurePlaybackHotQueue();
    // }
    this.playback.ensurePlaybackHotQueue();
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
    // AI-REMOVED 2026-09-25:
    // Reason: Legacy 区域会话不可达，刷新始终编译单基地文档。
    // Trigger: 清理无效拓扑刷新分支。
    // Evidence: SimulationActionImpl.start 固定 singleBase。
    // Replacement: 下方单基地刷新路径。
    // Risk: Low
    // Human Review: Required
    // Original code:
    // if (this.regional.active) {
    //   const topology = this.topology.getSnapshot();
    //   return {
    //     status: "started",
    //     topologyId: topology?.topologyId ?? null,
    //     diagnostics: topology?.diagnostics ?? [],
    //   };
    // }
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
    // AI-REMOVED 2026-09-22:
    // Reason: x4/x16 不再是区域模式非法倍率，控制器不得按模式过滤完整速度集合。
    // Trigger: 用户撤销“多基地禁止 x4/x16”需求。
    // Evidence: 顶栏与 Dense Host 已统一开放完整速度；Legacy 遗留区域路径应保持同一契约。
    // Replacement: 上方通用数值校验；下方仅保留区域运行中禁止即时换速的生命周期约束。
    // Risk: Low
    // Human Review: Required
    //
    // Original code:
    // if (
    //   this.stateReadWrite.simulationMode === SIMULATION_MODE.regionalMultiBase
    //   && !isRegionalSimulationSpeed(value)
    // ) {
    //   return;
    // }
    // AI-CORRECTION 2026-09-25: 上方旧订正中提及的 regional.active 门禁随 Legacy 多基地入口一并移除。
    // AI-REMOVED 2026-09-25:
    // Reason: Legacy 区域运行态不可达，运行中调速门禁不再有适用对象。
    // Trigger: 清理退役 Legacy 多基地分支。
    // Evidence: start 始终使用 singleBase。
    // Replacement: 下方单基地速度更新路径。
    // Risk: Low
    // Human Review: Required
    // Original code:
    // if (this.regional.active && value !== this.stateReadWrite.simulationSpeed) {
    //   // 运行中区域提速/降速需重启重新预热；第一版仅在 stop 状态允许实际切换。
    //   return;
    // }

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
  /** AI-CORRECTION 2026-09-25: Legacy 多基地启动入口已归档，此处仅处理单基地 start 失败。 */
  private recoverFromStartFailure(error?: unknown): void {
    // AI-REMOVED 2026-09-25:
    // Reason: Legacy 区域会话不可达，无会话需要清理。
    // Trigger: 清理退役多基地产品代码。
    // Evidence: start 固定 singleBase，控制器不再构造 regional。
    // Replacement: 下方单基地 playback 清理。
    // Risk: Low
    // Human Review: Required
    // Original code:
    // this.regional.disposeRegionalSession();
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
    // AI-REMOVED 2026-09-25:
    // Reason: Legacy 区域会话不可达，停止路径无需清理会话。
    // Trigger: 清理退役多基地残留。
    // Evidence: start 固定 singleBase。
    // Replacement: 下方单基地拓扑与播放状态清理。
    // Risk: Low
    // Human Review: Required
    // Original code:
    // this.regional.disposeRegionalSession();
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
