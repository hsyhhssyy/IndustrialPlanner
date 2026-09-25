import { createDenseBlueprintEngine } from "./blueprint-engine";
import { BlueprintExecutionClient } from "../blueprint";
import type { SimulationBlueprintRunRequest, SimulationBlueprintRunReport } from "@/domain/simulation";
import { createSnapshotSelector, shallowSnapshotEqual } from "@/shared/snapshot/snapshot-selector";
import { selectDocumentSimulation } from "@/shared/snapshot/world-document-selection";
import {
  createSimulationQueries,
  resolveDarkPipeStatusSourceByDeviceId,
} from "@/simulation/projection";
import { registerSimulationSnapshotReader } from "../testkit";
import { action, runInAction } from "mobx";

import type { WorkspaceContract } from "@/domain/document/workspace-contract";
import type { WorldDocument, WorldEntity } from "@/domain/document/world-document";
import type { SimulationAction } from "@/domain/simulation/simulation-action";
import type { SimulationContract } from "@/domain/simulation/simulation-contract";
import type { SimulationPerformanceDiagnosticsReadModel } from "@/domain/simulation";
// AI-REMOVED 2026-09-09:
// Reason: 明确状态归属并清理重组产生的重复声明。
// Trigger: Host / legacy 控制器重构。
// Evidence: 公共 Query 与子控制器已接管对应职责，原 import 或状态入口不再需要。
// Replacement: src/simulation/projection/query.ts
// Risk: Low
// Human Review: Required
// Original code:
// import type {
//   SimulationDeviceRuntimeChannelRecipeStatus,
//   SimulationDeviceRuntimeSlotItemReadModel,
//   SimulationDeviceRuntimeStatusReadModel,
//   WarehouseStatsReadModel,
// } from "@/domain/simulation/types/simulation-types";

// AI-REMOVED 2026-09-09:
// Reason: 明确状态归属并清理重组产生的重复声明。
// Trigger: Host / legacy 控制器重构。
// Evidence: 公共 Query 与子控制器已接管对应职责，原 import 或状态入口不再需要。
// Replacement: src/simulation/projection/query.ts
// Risk: Low
// Human Review: Required
// Original code:
// import { ADMISSION_RATE_WINDOWS_PER_MINUTE } from "@/domain/registry";

// AI-REMOVED 2026-09-08:
// Reason: Dense 不再私自合并基地内置实体，改用 Simulation 共享编译前文档入口。
// Trigger: Legacy 与 Dense 对 invalidPlacement 的处理不一致。
// Evidence: invalid-placement-compile 的 dense-v2 矩阵分支把越界传送带编入拓扑。
// Replacement: src/simulation/simulation-document-preparation.ts
// Risk: Low
// Human Review: Required
//
// Original code:
// import { resolveBaseBuiltinEntities } from "@/domain/registry/types/base-definition";
import { SIMULATION_MODE } from "@/domain/shared/simulation-mode";
import { createLogger } from "@/shared/logging/logger";
import {
  createSnapshotStore,
  type SnapshotStoreReadWrite,
} from "@/shared/snapshot/snapshot-store";
// AI-REMOVED 2026-09-16:
// Reason: 将两套引擎重复的供电覆盖算法收口至共享几何函数。
// Trigger: 独立蓝图验证必须与编辑器仿真使用相同供电规则。
// Evidence: legacy/controller-support 与 dense/host 采用相同矩形相交判定。
// Replacement: src/shared/geometry/power-range.ts collectPoweredEntityIds
// Risk: Low
// Human Review: Required
// Original code:
// import {
//   areGridRectsIntersecting,
//   resolveEntityGridRect,
//   resolvePowerRangeGridRect,
// } from "@/shared/geometry/power-range";
import { collectPoweredEntityIds } from "@/shared/geometry/power-range";
// AI-REMOVED 2026-09-09:
// Reason: 明确状态归属并清理重组产生的重复声明。
// Trigger: Host / legacy 控制器重构。
// Evidence: 公共 Query 与子控制器已接管对应职责，原 import 或状态入口不再需要。
// Replacement: src/simulation/projection/query.ts
// Risk: Low
// Human Review: Required
// Original code:
// import { buildDeviceGasCoverage } from "../projection";

// AI-REMOVED 2026-09-22:
// Reason: Dense 多基地与单基地统一支持完整速度档位，不再需要区域倍率白名单。
// Trigger: 用户撤销“多基地禁止 x4/x16”需求。
// Evidence: Dense 区域会话使用同一 kernel 与动态 standard tick rate 路径，x4/x16 无需单独拦截。
// Replacement: start 保留用户所选倍率；setSimulationSpeed 仅校验正数。
// Risk: Low
// Human Review: Required
//
// Original code:
// import { isRegionalSimulationSpeed } from "@/shared/regional-simulation-speed";
import {
  admitWorldDocumentForSimulation,
  type UnknownWorldEntityDefinitionIssue,
} from "@/shared/world-document-unknown-entities";

import type { SimulationInternalAction } from "../contracts";
import { DenseProjectionStore } from "./dense-frame-delta";
import {
  createDenseRegionalDocument,
} from "./dense-regional-document";
// AI-REMOVED 2026-09-20:
// Reason: 规范执行身份不再随当前基地变化，Host 无需为基地切换手工计算前后实体 ID。
// Trigger: ST2-RQ-036 将基地切换收敛为 Dense 内部展示投影替换。
// Evidence: createDensePresentationIdentity 从稳定规范拓扑确定性派生映射。
// Replacement: src/simulation/dense/dense-presentation-identity.ts
// Risk: Low
// Human Review: Required
//
// Original code:
// import { resolveDenseRegionalEntityId } from "./dense-regional-document";
import {
  createDenseOperatingStatusTopology,
  createDensePresentationIdentity,
  resolveDenseExecutionDeviceId,
  type DensePresentationIdentity,
} from "./dense-presentation-identity";
import type { DenseTopologyDictionary } from "./dense-topology";
import { createDenseEngineBridge, type DenseEngineBridge } from "./dense-engine-bridge";
// AI-REMOVED 2026-09-17:
// Reason: Dense 多基地改为单拓扑共享仓库，不再构建跨 Worker 仓库出货表。
// Trigger: 用户要求所有基地拼成一张大图并直接使用同一个仓库。
// Evidence: createDenseRegionalDocument + 单 DenseEngineBridge 初始化路径。
// Replacement: src/simulation/dense/dense-regional-document.ts
// Risk: Low；Legacy 区域模式仍保留原有仲裁器。
// Human Review: Required
//
// Original code:
// import { buildRegionalWarehouseOutletTable } from "../regional";
import type { CreateSimulationHostOptions, SimulationHost } from "../contracts";
import {
  createInitialSimulationRuntimeStatus,
  createInitialSimulationTimelineState,
  createSimulationStateReadWrite,
  SimulationPerformanceRateWindow,
  type SimulationStateReadWrite,
} from "../contracts";
import {
  convertSimulationPhaseTickBetweenRates,
  convertSimulationPhaseTickBetweenRatesExact,
  DENSE_LOW_STANDARD_TICK_RATE_PER_SECOND,
  DENSE_STANDARD_TICK_RATE_PER_SECOND,
} from "../contracts";
import { compileSimulationTopology, createSimulationDocumentHash } from "../topology";
import { createSimulationTopologyMigration } from "../topology";
import { appendSimulationBaseBuiltinEntities, prepareCurrentSimulationDocument } from "../topology";
import type {
  CompiledSimulationTopology,
  RegionalResourceSupplySetting,
  WarehouseStats,
  SimulationStartResult,
  SimulationTickPullStatus,
  SimulationTopologyMigration,
} from "../contracts";

let nextDenseSessionId = 1;
const DENSE_TIMELINE_TICK_DURATION_SECONDS = 0.5;
const DENSE_TIMELINE_RULER_DURATION_SECONDS = 300;
// AI-REMOVED 2026-09-19:
// Reason: Dense standard TPS 热切换后，时间轴半秒步长必须由当前 topology rate 推导，不能继续固定为 4 TPS 下的 2 ticks。
// Trigger: 用户要求 Dense 在 x4 及以上使用真实 4 / 2 standard TPS 动态切换。
// Evidence: 2 TPS 下半秒时间轴步长应为 1 tick；固定常量会把时间轴尺度放大一倍。
// Replacement: resolveDenseTimelineStepStandardTicks
// Risk: Low；目前 4 / 2 TPS 都能精确表示 0.5 秒步长。
// Human Review: Required
//
// Original code:
// const DENSE_TIMELINE_STEP_STANDARD_TICKS =
//   DENSE_STANDARD_TICK_RATE_PER_SECOND * DENSE_TIMELINE_TICK_DURATION_SECONDS;
const DENSE_TIMELINE_ORIGIN_STANDARD_TICK = 1;
const DENSE_TIMELINE_CAPACITY_TICKS = 600;
const DENSE_DYNAMIC_STANDARD_RATE_MINIMUM_SPEED = 4;
const DENSE_BACKPRESSURE_WALL_SECONDS = 0.5;
const DENSE_RATE_SAMPLE_SIMULATION_SECONDS = 2;
const DENSE_HIGH_RATE_CAPACITY_MARGIN = 1.1;
const DENSE_LOW_RATE_RECOVERY_MARGIN = 2.5;
const logger = createLogger("dense-simulation-runtime");

interface DenseActiveTopologySource {
  readonly initializationDocument: WorldDocument;
  readonly executionDocument: WorldDocument;
  readonly executionExcludedIssues: readonly UnknownWorldEntityDefinitionIssue[];
  readonly presentationDocument: WorldDocument | null;
  readonly presentationExcludedIssues: readonly UnknownWorldEntityDefinitionIssue[];
  readonly regionalResources: readonly RegionalResourceSupplySetting[];
  readonly operatingStatusDeviceIds: readonly string[];
  readonly presentationIdentity: DensePresentationIdentity;
  readonly executionDictionary: DenseTopologyDictionary;
  readonly regionTag: string | null;
  readonly regionalDocuments: readonly WorldDocument[] | null;
}

export function createDenseSimulationHost(
  workspace: WorkspaceContract,
  options: CreateSimulationHostOptions,
): SimulationHost {
  const topologyStore = createSnapshotStore<CompiledSimulationTopology | null>(null);
  const internalState = createSimulationStateReadWrite();
  const disposers: Array<() => void> = [];
  const bridge = createDenseEngineBridge(
    options.workerMode ?? "auto",
    workspace.registry,
  );
  const controller = new DenseSimulationController({
    workspace,
    options,
    topologyStore,
    state: internalState,
    bridge,
  });
  const actions: SimulationContract["actions"] = controller;
  const host: SimulationHost = {
    engineKind: "dense-v2",
    workspace,
    topology: topologyStore,
    internalState,
    internalActions: controller,
    get state() {
      return internalState;
    },
    actions,
    queries: createSimulationQueries({
      state: internalState,
      registryQueries: workspace.registry.queries,
      getTopology: () => controller.currentTopology,
      getOperatingStatusTopology: () => controller.currentOperatingStatusTopology,
      getPresentation: () => controller.currentProjection,
      getTotalPowerDemand: (_topology, projection) => internalState.regionalTotalPowerDemand
        ?? controller.currentPowerConsumptionOverride ?? projection.totalPowerDemand,
      getWarehouseStats: () => controller.currentWarehouseStats,
      getPerformanceDiagnostics: () => controller.getPerformanceDiagnostics(),
      getDebugDataEnabled: () => true,
    }),
    dispose: () => {
      while (disposers.length > 0) disposers.pop()?.();
      controller.dispose();
    },
  };
  disposers.push(registerSimulationSnapshotReader(host, () => controller.currentProjection?.materializeSnapshot() ?? null));
  workspace.simulation = host;
  const documentStore = workspace.editor?.document;
  if (documentStore !== undefined) {
    disposers.push(createSnapshotSelector(documentStore, selectDocumentSimulation, shallowSnapshotEqual).subscribe(() => {
      const document = documentStore.getSnapshot();
      if (
        internalState.hasStarted
        && controller.hasSimulationRelevantDocumentChange(document)
      ) {
        void controller.refreshFromCurrentDocument();
      }
    }));
  }
  return host;
}

class DenseSimulationController implements SimulationAction, SimulationInternalAction {
  private readonly blueprintExecution: BlueprintExecutionClient;

  public runBlueprint(request: SimulationBlueprintRunRequest, signal?: AbortSignal): Promise<SimulationBlueprintRunReport> {
    return this.blueprintExecution.run(request, signal);
  }

  public disposeBlueprintRuns(): void {
    this.blueprintExecution.dispose();
  }

  private readonly workspace: WorkspaceContract;
  private readonly options: CreateSimulationHostOptions;
  private readonly topologyStore: SnapshotStoreReadWrite<CompiledSimulationTopology | null>;
  private readonly state: SimulationStateReadWrite;
  private readonly bridge: DenseEngineBridge;
  private projection: DenseProjectionStore | null = null;
  private presentationIdentity: DensePresentationIdentity | null = null;
  private executionTopology: CompiledSimulationTopology | null = null;
  private denseSessionIdentity: {
    readonly sessionId: string;
    readonly topologyVersion: number;
  } | null = null;
  private operatingStatusTopology: CompiledSimulationTopology | null = null;
  // AI-REMOVED 2026-09-03:
  // Reason: Dense 物理状态与帧编码必须只存在于 Worker，Host 不能同时持有第二份运行时真相。
  // Trigger: ST2-RQ-023 Phase B 接入独立 dense Worker 协议。
  // Evidence: DenseEngineBridge 现统一承接 browser Worker 与测试 local runtime。
  // Replacement: src/simulation/dense/dense-engine-bridge.ts 与 dense-worker-runtime.ts
  // Risk: Low；runtime 测试模式仍通过同一协议同步执行。
  // Human Review: Required
  //
  // Original code:
  // private kernel: DenseSimulationKernel | null = null;
  // private emitter: DenseFrameEmitter | null = null;
  private topologyVersion = 0;
  private playbackRemainderTicks = 0;
  private playbackTargetTickNumber = 0;
  private playbackAdvanceInFlight: Promise<void> | null = null;
  private readonly playbackTickRateWindow = new SimulationPerformanceRateWindow();
  private pendingPlaybackPerformanceElapsedMs = 0;
  private pendingPlaybackPerformanceTicks = 0;
  private runtimeRetainedStateCount = 0;
  private primaryTickNumber = 0;
  private timelineBufferedThroughTick = 0;
  private compiledDocument: WorldDocument | null = null;
  private sourceDocumentSignature: string | null = null;
  private topologyRefreshQueue: Promise<void> | null = null;
  private timelinePresentationActive = false;
  private activeTopologySource: DenseActiveTopologySource | null = null;
  private pendingStandardTickRate: number | null = null;
  private rateSampleWallTimeMs = 0;
  private rateSampleSimulationSeconds = 0;
  // AI-REMOVED 2026-09-17:
  // Reason: Dense Host 不再持有多 Worker 区域 Session、Epoch 帧缓存或主线程仓库统计。
  // Trigger: 用户要求 Dense 多基地合成单图并直接共享同一个仓库。
  // Evidence: startRegionalSimulation 只初始化 this.bridge；仓库统计来自 this.projection。
  // Replacement: createDenseRegionalDocument + DenseProjectionStore
  // Risk: Low。
  // Human Review: Required
  //
  // Original code:
  // private regionalSession: DenseRegionalSimulationSession | null = null;
  // private readonly regionalPlaybackDeltas = new Map<number, DenseFrameDelta>();
  // private readonly regionalWarehouseStatsByTick = new Map<number, WarehouseStats>();
  // private regionalWarehouseStats: WarehouseStats | null = null;
  // private regionalEpochInFlight: Promise<void> | null = null;
  private disposed = false;

  public constructor(input: {
    readonly workspace: WorkspaceContract;
    readonly options: CreateSimulationHostOptions;
    readonly topologyStore: SnapshotStoreReadWrite<CompiledSimulationTopology | null>;
    readonly state: SimulationStateReadWrite;
    readonly bridge: DenseEngineBridge;
  }) {
    this.workspace = input.workspace;
    this.blueprintExecution = new BlueprintExecutionClient(this.workspace.registry, "dense-v2", input.options.workerMode ?? "auto",
      (engineOptions) => createDenseBlueprintEngine(this.workspace.registry, engineOptions), input.options.blueprintDenseTickRate);
    this.options = input.options;
    this.topologyStore = input.topologyStore;
    this.state = input.state;
    this.bridge = input.bridge;
  }

  public get currentProjection(): DenseProjectionStore | null {
    return this.projection;
  }

  public get currentTopology(): CompiledSimulationTopology | null {
    return this.topologyStore.getSnapshot();
  }

  public get currentOperatingStatusTopology(): CompiledSimulationTopology | null {
    return this.operatingStatusTopology;
  }

  public get simulationState(): SimulationStateReadWrite {
    return this.state;
  }

  public get currentPowerConsumptionOverride(): number | undefined {
    const sessionDocument = this.activeTopologySource?.initializationDocument;
    return normalizePowerConsumptionOverride(
      (sessionDocument ?? this.workspace.editor?.document.getSnapshot())
        ?.documentSettings.powerConsumptionOverride,
    );
  }

  public get currentWarehouseStats(): WarehouseStats | null {
    return this.projection?.getWarehouseStats() ?? null;
  }

  public getPerformanceDiagnostics(): SimulationPerformanceDiagnosticsReadModel {
    const topology = this.topologyStore.getSnapshot();
    const tickRate = this.projection?.tickRate ?? topology?.standardTickRate ?? 0;
    return {
      tickPerSecond: this.playbackTickRateWindow.ratePerSecond,
      targetTickPerSecond: this.state.runningState === "start"
        ? this.state.simulationSpeed * tickRate
        : 0,
      playbackBufferedFrameCount: this.projection === null ? 0 : 1,
      runtimeRetainedStateCount: this.runtimeRetainedStateCount,
      timelineRetainedFrameCount: this.state.timeline.enabled
        ? this.runtimeRetainedStateCount
        : 0,
      timelineGeneratedFramePerSecond: 0,
    };
  }

  public hasSimulationRelevantDocumentChange(document: WorldDocument): boolean {
    return this.sourceDocumentSignature !== createDenseSimulationSourceSignature(document);
  }

  public readonly start: SimulationContract["actions"]["start"] = async () => {
    if (this.state.runningState === "starting") return;
    const simulationMode = this.workspace.app?.state.settings.regionalMultiBaseEnabled === true
      ? SIMULATION_MODE.regionalMultiBase
      : SIMULATION_MODE.singleBase;
    runInAction(() => {
      this.state.hasStarted = true;
      this.state.runningState = "starting";
      this.state.simulationMode = simulationMode;
      // AI-REMOVED 2026-09-22:
      // Reason: 多基地启动必须保留 x4/x16 等完整速度选择，不再把高倍率归一化为 x1。
      // Trigger: 用户要求所有模式均可使用完整速度。
      // Evidence: Dense 区域合图会话与单基地共用 Worker 速率控制和动态 standard tick rate。
      // Replacement: 保留 start 前已写入的 simulationSpeed。
      // Risk: Low
      // Human Review: Required
      //
      // Original code:
      // if (
      //   simulationMode === SIMULATION_MODE.regionalMultiBase
      //   && !isRegionalSimulationSpeed(this.state.simulationSpeed)
      // ) {
      //   this.state.simulationSpeed = 1;
      // }
    });
    if (this.state.simulationMode === SIMULATION_MODE.regionalMultiBase) {
      await this.startRegionalSimulation();
      return;
    }
    const result = await this.refreshFromCurrentDocument();
    if (result.status !== "started") {
      runInAction(() => {
        this.state.runningState = "stop";
      });
      throw new Error(result.error ?? "Dense simulation failed to start.");
    }
    await this.bridge.sendCommands([{ type: "start" }]);
    runInAction(() => {
      this.state.runningState = "start";
    });
  };

  // AI-REMOVED 2026-09-20:
  // Reason: Dense 会话模式必须在 start 时从 AppSettings 固化，外部不得预写 SimulationMode。
  // Trigger: ST2-RQ-035 将多基地用户选择收归 AppContract，并移除 main reaction。
  // Evidence: start 已在进入 starting 前读取 regionalMultiBaseEnabled 并归一化区域倍率。
  // Replacement: DenseSimulationController.start。
  // Risk: Medium；停止态 UI 与测试必须改读/改写 AppSettings，而不是调用 Simulation Action。
  // Human Review: Required
  //
  // Original code:
  // public readonly setRegionalMultiBaseEnabled: SimulationContract["actions"]["setRegionalMultiBaseEnabled"] = action((enabled) => {
  //   const simulationMode = enabled
  //     ? SIMULATION_MODE.regionalMultiBase
  //     : SIMULATION_MODE.singleBase;
  //   // AI-REMOVED 2026-09-17:
  //   // Reason: Dense 区域模式与时间轴已共用同一 Worker 缓冲区，不再存在两类会话冲突。
  //   // Trigger: 用户要求 Dense 时间轴直接读取更远 tick，并允许多基地使用同一机制。
  //   // Evidence: 区域模式已由 createDenseRegionalDocument 合并为普通单 kernel 会话。
  //   // Replacement: DenseSimulationController.enableTimeline
  //   // Risk: Low；App 层若仍保留旧禁用逻辑，需要后续获得跨模块授权后同步清理。
  //   // Human Review: Required
  //   //
  //   // Original code:
  //   // || (enabled && this.state.timeline.enabled)
  //   if (
  //     simulationMode === this.state.simulationMode
  //     || this.state.runningState !== "stop"
  //   ) return;
  //   if (enabled && !isRegionalSimulationSpeed(this.state.simulationSpeed)) {
  //     this.state.simulationSpeed = 1;
  //   }
  //   this.state.simulationMode = simulationMode;
  // });

  public readonly pause: SimulationContract["actions"]["pause"] = action(() => {
    if (this.state.runningState !== "start") return;
    this.state.runningState = "pause";
    this.sendCommands([{ type: "pause" }]);
  });

  public readonly resume: SimulationContract["actions"]["resume"] = action(() => {
    if (this.state.runningState !== "pause") return;
    this.state.runningState = "start";
    this.sendCommands([{ type: "resume" }]);
  });

  public readonly stop: SimulationContract["actions"]["stop"] = action(() => {
    this.reset();
    // AI-REMOVED 2026-09-08:
    // Reason: stop 只停止推进但保留 projection、topology 与迁移源，导致再次 start 迁移上次运行时数据。
    // Trigger: 用户报告新版求解器停止后未清理数据；公共 Host 生命周期矩阵已覆盖该行为。
    // Evidence: runtime-slot-patch 在 dense-v2 下停止并重启后仍保留 patch 的 11 个铜矿。
    // Replacement: DenseSimulationController.reset（本方法上方调用）统一释放 Worker 会话与 Host 投影状态。
    // Risk: Low；stop 的公共契约本就要求下一次 start 从文档初始配置启动。
    // Human Review: Required
    //
    // Original code:
    // this.state.runningState = "stop";
    // this.playbackRemainderTicks = 0;
    // this.playbackTargetTickNumber = this.projection?.tickNumber ?? 0;
    // if (this.projection !== null && this.regionalSession === null) {
    //   this.sendCommands([{ type: "stop" }]);
    // }
    // this.disposeRegionalSession();
  });

  public readonly setSimulationSpeed: SimulationInternalAction["setSimulationSpeed"] = action((value) => {
    if (!Number.isFinite(value) || value <= 0) {
      throw new Error(`Dense simulation speed must be positive; received ${value}.`);
    }
    // AI-REMOVED 2026-09-22:
    // Reason: 区域模式与单基地模式使用相同速度集合，x4/x16 不再是非法倍率。
    // Trigger: 用户撤销区域模式专用倍率限制。
    // Evidence: 顶栏现始终展示完整档位，Host 必须与 UI 契约一致并实际接受选择。
    // Replacement: 上方仅保留有限正数校验。
    // Risk: Low
    // Human Review: Required
    //
    // Original code:
    // if (
    //   this.state.simulationMode === SIMULATION_MODE.regionalMultiBase
    //   && !isRegionalSimulationSpeed(value)
    // ) return;
    this.state.simulationSpeed = value;
    this.resetDenseRateSample();
    if (this.projection !== null) {
      void this.bridge.sendCommands([{ type: "set-speed", simulationSpeed: value }]).then(() => {
        if (
          this.state.simulationSpeed < DENSE_DYNAMIC_STANDARD_RATE_MINIMUM_SPEED
          && this.projection !== null
        ) {
          this.requestDenseStandardTickRate(DENSE_STANDARD_TICK_RATE_PER_SECOND);
        }
      }).catch((error: unknown) => this.publishRuntimeError(error));
    }
  });

  public readonly advancePlaybackByDeltaMs: SimulationContract["actions"]["advancePlaybackByDeltaMs"] = async (deltaMs) => {
    if (this.state.runningState !== "start" || !Number.isFinite(deltaMs) || deltaMs <= 0) {
      return;
    }
    const topology = this.topologyStore.getSnapshot();
    if (topology === null) return;
    this.pendingPlaybackPerformanceElapsedMs += deltaMs;
    this.playbackRemainderTicks += deltaMs / 1000
      * topology.standardTickRate
      * this.state.simulationSpeed;
    const wholeTicks = Math.floor(this.playbackRemainderTicks);
    if (wholeTicks <= 0) {
      if (this.playbackAdvanceInFlight === null) {
        this.flushPlaybackPerformanceWindow();
      }
      return;
    }
    this.playbackRemainderTicks -= wholeTicks;
    this.playbackTargetTickNumber = Math.max(
      this.playbackTargetTickNumber,
      this.projection?.tickNumber ?? 0,
    ) + wholeTicks;
    this.observeDensePlaybackBackpressure();
    const activeTopologyRefresh = this.topologyRefreshQueue;
    if (activeTopologyRefresh !== null) {
      await activeTopologyRefresh;
      if (this.state.runningState !== "start") return;
    }
    if (this.playbackAdvanceInFlight === null) {
      const drain = this.drainPlaybackAdvances();
      const tracked = drain.finally(() => {
        this.flushPlaybackPerformanceWindow();
        if (this.playbackAdvanceInFlight === tracked) {
          this.playbackAdvanceInFlight = null;
        }
      });
      this.playbackAdvanceInFlight = tracked;
    }
    await this.playbackAdvanceInFlight.catch(() => undefined);
  };

  public readonly patchRuntimeSlot: SimulationContract["actions"]["patchRuntimeSlot"] = async (patch) => {
    if (this.state.runningState === "stop" || this.projection === null) return;
    const activeTopologyRefresh = this.topologyRefreshQueue;
    if (activeTopologyRefresh !== null) await activeTopologyRefresh;
    const executionDeviceId = this.presentationIdentity === null
      ? null
      : resolveDenseExecutionDeviceId(this.presentationIdentity, patch.entityId);
    await this.bridge.sendCommands([{
      type: "patch-runtime-slot",
      patch: executionDeviceId === null
        ? patch
        : { ...patch, entityId: executionDeviceId },
    }]);
    this.timelineBufferedThroughTick = this.primaryTickNumber;
    await this.syncToTick(this.primaryTickNumber);
    if (this.state.timeline.enabled) await this.ensureTimelineBuffer();
  };

  public readonly resetAdmissionCounter: SimulationContract["actions"]["resetAdmissionCounter"] = async (reset) => {
    if (this.state.runningState === "stop" || this.projection === null) return;
    const activeTopologyRefresh = this.topologyRefreshQueue;
    if (activeTopologyRefresh !== null) await activeTopologyRefresh;
    const executionDeviceId = this.presentationIdentity === null
      ? null
      : resolveDenseExecutionDeviceId(this.presentationIdentity, reset.entityId);
    await this.bridge.sendCommands([{
      type: "reset-admission-counter",
      reset: executionDeviceId === null
        ? reset
        : { ...reset, entityId: executionDeviceId },
    }]);
    this.timelineBufferedThroughTick = this.primaryTickNumber;
    await this.syncToTick(this.primaryTickNumber);
    if (this.state.timeline.enabled) await this.ensureTimelineBuffer();
  };

  public readonly enableTimeline: SimulationContract["actions"]["enableTimeline"] = async () => {
    // AI-REMOVED 2026-09-17:
    // Reason: 区域多基地已是普通 Dense 单 Worker 会话，时间轴无需按 simulationMode 禁用。
    // Trigger: 用户要求 Dense 多基地时间轴不再开启额外 Worker。
    // Evidence: startRegionalSimulation 初始化同一个 this.bridge，seek 继续请求该 bridge 的检查点。
    // Replacement: 下方统一的 Dense timeline 初始化路径。
    // Risk: Low。
    // Human Review: Required
    //
    // Original code:
    // if (this.state.simulationMode !== "single-base") return;
    if (!this.state.hasStarted) await this.start();
    const activePlaybackAdvance = this.playbackAdvanceInFlight;
    if (activePlaybackAdvance !== null) await activePlaybackAdvance;
    const currentTimelineTick = Math.max(
      0,
      Math.floor(
        (this.primaryTickNumber - DENSE_TIMELINE_ORIGIN_STANDARD_TICK)
        / resolveDenseTimelineStepStandardTicks(this.requireCurrentStandardTickRate()),
      ),
    );
    runInAction(() => {
      this.state.timeline = {
        enabled: true,
        readiness: "preparing",
        tickDurationSeconds: DENSE_TIMELINE_TICK_DURATION_SECONDS,
        rulerDurationSeconds: DENSE_TIMELINE_RULER_DURATION_SECONDS,
        windowStartTickNumber: Math.max(0, currentTimelineTick - DENSE_TIMELINE_CAPACITY_TICKS / 2),
        cursorTickNumber: currentTimelineTick,
        availableFromTickNumber: 0,
        availableToTickNumber: currentTimelineTick + DENSE_TIMELINE_CAPACITY_TICKS,
        marks: [],
        isSeeking: false,
      };
    });
    try {
      await this.ensureTimelineBuffer();
      runInAction(() => {
        this.state.timeline.readiness = "ready";
      });
    } catch (error) {
      runInAction(() => {
        this.state.timeline.readiness = "idle";
      });
      throw error;
    }
  };

  public readonly disableTimeline: SimulationContract["actions"]["disableTimeline"] = action(() => {
    this.state.timeline = createInitialSimulationTimelineState();
    if (this.timelinePresentationActive) {
      void this.restorePrimaryProjection();
    }
  });

  public readonly seekTimelineToTick: SimulationContract["actions"]["seekTimelineToTick"] = async (
    timelineTickNumber,
  ) => {
    if (
      !this.state.timeline.enabled
      || !Number.isSafeInteger(timelineTickNumber)
      || timelineTickNumber < this.state.timeline.availableFromTickNumber
      || timelineTickNumber > this.state.timeline.availableToTickNumber
    ) {
      return false;
    }
    runInAction(() => {
      this.state.timeline.isSeeking = true;
    });
    try {
      const standardTickNumber = DENSE_TIMELINE_ORIGIN_STANDARD_TICK
        + timelineTickNumber * resolveDenseTimelineStepStandardTicks(
          this.requireCurrentStandardTickRate(),
        );
      const response = await this.bridge.requestPresentationCheckpoint(standardTickNumber);
      this.projection?.replaceCheckpoint(response.delta);
      this.runtimeRetainedStateCount = response.runtimeRetainedStateCount;
      this.timelinePresentationActive = true;
      // AI-REMOVED 2026-09-12:
      // Reason: 性能与电池读数不再由 SimulationState 发布，避免把诊断数据写入领域状态。
      // Trigger: 用户要求统一通过 SimulationQuery 每秒查询仿真性能诊断。
      // Evidence: presentation-checkpoint 已直接更新投影与 runtimeRetainedStateCount，查询可读取两者。
      // Replacement: DenseSimulationController.getPerformanceDiagnostics 与 DenseProjectionStore。
      // Risk: Low。
      // Human Review: Required
      //
      // Original code:
      // this.publishProjectionSnapshot();
      runInAction(() => {
        this.state.timeline.cursorTickNumber = timelineTickNumber;
        this.state.currentPlaybackTickNumber = standardTickNumber;
        this.state.timeline.isSeeking = false;
      });
      return true;
    } catch (error) {
      runInAction(() => {
        this.state.timeline.isSeeking = false;
      });
      throw error;
    }
  };

  public readonly refreshFromCurrentDocument: SimulationInternalAction["refreshFromCurrentDocument"] = () => {
    return this.enqueueDenseRuntimeTransition(() => this.refreshFromCurrentDocumentNow());
  };

  private enqueueDenseRuntimeTransition<TResult>(
    operation: () => Promise<TResult>,
  ): Promise<TResult> {
    const queuedRefresh = this.topologyRefreshQueue;
    const refresh = queuedRefresh === null
      ? operation()
      : queuedRefresh.then(operation);
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
  }

  private readonly refreshFromCurrentDocumentNow = async (): Promise<SimulationStartResult> => {
    this.assertNotDisposed();
    if (this.state.simulationMode === SIMULATION_MODE.regionalMultiBase) {
      return this.startRegionalSimulation();
    }
    const activePlaybackAdvance = this.playbackAdvanceInFlight;
    if (activePlaybackAdvance !== null) {
      await activePlaybackAdvance;
    }
    const sourceDocument = this.workspace.editor?.document.getSnapshot();
    if (sourceDocument === undefined) {
      return this.failStart("Simulation cannot start before editor document is available.");
    }

    try {
      const admission = prepareDenseSimulationDocument({
        document: sourceDocument,
        workspace: this.workspace,
      });
      const presentationDocument = admission.document;
      const currentBase = this.workspace.registry.baseDefinitions.find(
        (definition) => definition.id === presentationDocument.baseId,
      );
      const regionalResources = currentBase === undefined
        || this.options.getRegionalResourceSettings === undefined
        ? undefined
        : normalizeRegionalResources(
            this.options.getRegionalResourceSettings(currentBase.tag),
          );
      const standardTickRate = this.topologyStore.getSnapshot()?.standardTickRate
        ?? DENSE_STANDARD_TICK_RATE_PER_SECOND;
      const compile = (document: WorldDocument) => compileSimulationTopology({
        document,
        registry: this.workspace.registry,
        poweredEntityIds: computePoweredEntityIds(document, this.workspace.registry),
        simulationMode: this.state.simulationMode,
        activeActivityIds: this.options.getActiveActivityIds?.() ?? [],
        standardTickRate,
        ...(regionalResources === undefined ? {} : { regionalResources }),
      });
      const presentationTopology = appendUnknownEntityAdmissionDiagnostics(
        compile(presentationDocument),
        admission.excludedIssues,
      );
      const executionDocument = createDenseRegionalDocument({
        documents: [presentationDocument],
        registry: this.workspace.registry,
      });
      const executionTopology = compile(executionDocument);
      const compileError = [
        ...presentationTopology.diagnostics,
        ...executionTopology.diagnostics,
      ].find((diagnostic) => diagnostic.severity === "error");
      if (compileError !== undefined) {
        return this.failRefresh(compileError.message, presentationTopology.diagnostics);
      }
      const presentationIdentity = createDensePresentationIdentity({
        baseId: presentationDocument.baseId,
        presentationTopology,
        executionTopology,
      });

      const previousTopology = this.executionTopology;
      const migration = this.compiledDocument === null
        || previousTopology === null
        || this.projection === null
        ? null
        : createSimulationTopologyMigration({
            previousDocument: this.compiledDocument,
            nextDocument: executionDocument,
            previousTopology,
            nextTopology: executionTopology,
            baseTickNumber: this.primaryTickNumber,
          });
      let migrationApplied = migration !== null;
      let initialized: {
        readonly identity: {
          readonly sessionId: string;
          readonly topologyVersion: number;
        };
        readonly response: Awaited<ReturnType<DenseEngineBridge["initialize"]>>;
      };
      try {
        initialized = await this.initializeDenseTopology({
          document: executionDocument,
          topology: executionTopology,
          presentationIdentity,
          migration: migration ?? undefined,
        });
      } catch (migrationError) {
        if (migration === null) throw migrationError;
        migrationApplied = false;
        logger.warn("Dense topology migration failed; rebuilding the runtime explicitly.", {
          baseTickNumber: migration.baseTickNumber,
          resetDeviceIds: migration.resetDeviceIds,
          error: migrationError instanceof Error
            ? migrationError.message
            : String(migrationError),
        });
        initialized = await this.initializeDenseTopology({
          document: executionDocument,
          topology: executionTopology,
          presentationIdentity,
        });
      }
      const { identity: session, response } = initialized;
      const projection = new DenseProjectionStore(
        response.layout.dictionary,
        session,
        presentationIdentity,
      );
      projection.apply(response.initialDelta);

      // AI-REMOVED 2026-09-03:
      // Reason: Host 不得在主线程构造 dense kernel/emitter；browser 与测试均走同一 Worker 协议。
      // Trigger: ST2-RQ-023 Phase B Worker 接线。
      // Evidence: bridge.initialize 返回 TopologyReady 与初始 FrameDelta。
      // Replacement: DenseWorkerRuntime.initialize。
      // Risk: Low。
      // Human Review: Required
      //
      // Original code:
      // const layout = compileDenseTopologyLayout(topology, this.workspace.registry);
      // const kernel = new DenseSimulationKernel(topology, layout, this.workspace.registry);
      // const emitter = new DenseFrameEmitter(topology, layout, session);
      // const projection = new DenseProjectionStore(layout.dictionary, session);
      // projection.apply(emitter.emitInitial(kernel));
      // this.kernel = kernel;
      // this.emitter = emitter;
      this.projection = projection;
      this.primaryTickNumber = response.initialDelta.tickNumber;
      this.timelineBufferedThroughTick = response.initialDelta.tickNumber;
      this.runtimeRetainedStateCount = response.runtimeRetainedStateCount;
      this.playbackTargetTickNumber = migrationApplied
        ? Math.max(this.playbackTargetTickNumber, response.initialDelta.tickNumber)
        : response.initialDelta.tickNumber;
      this.timelinePresentationActive = false;
      this.compiledDocument = cloneWorldDocument(executionDocument);
      this.sourceDocumentSignature = createDenseSimulationSourceSignature(sourceDocument);
      this.executionTopology = executionTopology;
      this.presentationIdentity = presentationIdentity;
      this.denseSessionIdentity = session;
      this.operatingStatusTopology = createDenseOperatingStatusTopology(
        executionTopology,
        presentationIdentity,
      );
      this.topologyStore.setSnapshot(presentationTopology);
      this.activeTopologySource = {
        initializationDocument: cloneWorldDocument(executionDocument),
        executionDocument: cloneWorldDocument(executionDocument),
        executionExcludedIssues: [...admission.excludedIssues],
        presentationDocument: cloneWorldDocument(presentationDocument),
        presentationExcludedIssues: [...admission.excludedIssues],
        regionalResources: regionalResources === undefined ? [] : [...regionalResources],
        operatingStatusDeviceIds: [],
        presentationIdentity,
        executionDictionary: response.layout.dictionary,
        regionTag: null,
        regionalDocuments: null,
      };
      // AI-REMOVED 2026-09-12:
      // Reason: 性能与电池读数不再由 SimulationState 发布，初始化只需提交投影和运行态。
      // Trigger: 用户要求统一通过 SimulationQuery 每秒查询仿真性能诊断。
      // Evidence: projection 与 runtimeRetainedStateCount 已在 Host 内部就绪。
      // Replacement: DenseSimulationController.getPerformanceDiagnostics 与 DenseProjectionStore。
      // Risk: Low。
      // Human Review: Required
      //
      // Original code:
      // this.publishProjectionSnapshot();
      runInAction(() => {
        this.state.hasStarted = true;
        this.state.currentPlaybackTickNumber = response.initialDelta.tickNumber;
        this.state.runtimeStatus = {
          mode: "running",
          topologyId: presentationTopology.topologyId,
          documentHash: presentationTopology.documentHash,
          retainedFromTick: response.initialDelta.tickNumber,
          latestTickNumber: response.initialDelta.tickNumber,
          bufferSize: 1,
          maxBufferSize: 1,
          dynamicTickRate: presentationTopology.standardTickRate,
          error: null,
        };
      });
      return {
        status: "started",
        topologyId: presentationTopology.topologyId,
        diagnostics: presentationTopology.diagnostics,
      };
    } catch (error) {
      return this.failStart(error instanceof Error ? error.message : String(error));
    }
  };

  private async initializeDenseTopology(options: {
    readonly document: WorldDocument;
    readonly topology: CompiledSimulationTopology;
    readonly presentationIdentity?: DensePresentationIdentity;
    readonly operatingStatusDeviceIds?: readonly string[];
    readonly migration?: SimulationTopologyMigration;
  }): Promise<{
    readonly identity: { readonly sessionId: string; readonly topologyVersion: number };
    readonly response: Awaited<ReturnType<DenseEngineBridge["initialize"]>>;
  }> {
    this.topologyVersion += 1;
    const identity = {
      sessionId: `dense-session-${nextDenseSessionId}`,
      topologyVersion: this.topologyVersion,
    } as const;
    nextDenseSessionId += 1;
    const response = await this.bridge.initialize({
      identity,
      topology: options.topology,
      perfEnabled: this.options.getPerfEnabled?.() ?? false,
      debugDataEnabled: this.options.getDebugDataEnabled?.() ?? false,
      powerMode: options.document.documentSettings.powerMode ?? "infinite",
      powerConsumptionOverride: normalizePowerConsumptionOverride(
        options.document.documentSettings.powerConsumptionOverride,
      ),
      ...(options.presentationIdentity === undefined
        ? {}
        : { presentationDeviceIds: options.presentationIdentity.executionDeviceIds }),
      ...(options.operatingStatusDeviceIds === undefined
        ? {}
        : { operatingStatusDeviceIds: options.operatingStatusDeviceIds }),
      ...(options.migration === undefined ? {} : { migration: options.migration }),
    });
    return { identity, response };
  }

  public readonly syncToTick: SimulationInternalAction["syncToTick"] = async (tickNumber) => {
    this.assertNotDisposed();
    const activeTopologyRefresh = this.topologyRefreshQueue;
    if (activeTopologyRefresh !== null) await activeTopologyRefresh;
    const projection = this.projection;
    if (projection === null) {
      return createNotFoundTickStatus(tickNumber);
    }

    try {
      const response = await this.bridge.advanceToTick(tickNumber, Number.MAX_SAFE_INTEGER);
      if (response.type === "presentation-checkpoint") {
        projection.replaceCheckpoint(response.delta);
      } else {
        projection.apply(response.delta);
      }
      this.primaryTickNumber = response.delta.tickNumber;
      this.runtimeRetainedStateCount = response.runtimeRetainedStateCount;
      this.timelinePresentationActive = false;
      // AI-REMOVED 2026-09-12:
      // Reason: 性能与电池读数不再由 SimulationState 发布，推进结果直接留在 Host 投影和诊断采样器中。
      // Trigger: 用户要求统一通过 SimulationQuery 每秒查询仿真性能诊断。
      // Evidence: frame-delta 已更新 projection、primaryTickNumber 与 runtimeRetainedStateCount。
      // Replacement: DenseSimulationController.getPerformanceDiagnostics 与 DenseProjectionStore。
      // Risk: Low。
      // Human Review: Required
      //
      // Original code:
      // this.publishProjectionSnapshot();
      runInAction(() => {
        this.state.currentPlaybackTickNumber = tickNumber;
        this.state.runtimeStatus = {
          ...this.state.runtimeStatus,
          retainedFromTick: 0,
          latestTickNumber: Math.max(
            response.delta.tickNumber,
            this.timelineBufferedThroughTick,
          ),
          bufferSize: this.runtimeRetainedStateCount,
        };
      });
      return {
        status: "ready",
        retainedFromTick: 0,
        latestTickNumber: Math.max(
          response.delta.tickNumber,
          this.timelineBufferedThroughTick,
        ),
        bufferSize: this.runtimeRetainedStateCount,
      };
    } catch (error) {
      runInAction(() => {
        this.state.runtimeStatus = {
          ...this.state.runtimeStatus,
          mode: "error",
          error: error instanceof Error ? error.message : String(error),
        };
      });
      throw error;
    }
  };

  public readonly setDebugEnabled: SimulationInternalAction["setDebugEnabled"] = () => {};
  public readonly setDebugDataEnabled: SimulationInternalAction["setDebugDataEnabled"] = () => {};

  public readonly reset: SimulationInternalAction["reset"] = action(() => {
    if (this.projection !== null) {
      this.sendCommands([{ type: "reset" }]);
    }
    this.projection = null;
    this.presentationIdentity = null;
    this.executionTopology = null;
    this.denseSessionIdentity = null;
    this.playbackRemainderTicks = 0;
    this.playbackTargetTickNumber = 0;
    this.playbackAdvanceInFlight = null;
    this.playbackTickRateWindow.reset();
    this.pendingPlaybackPerformanceElapsedMs = 0;
    this.pendingPlaybackPerformanceTicks = 0;
    this.runtimeRetainedStateCount = 0;
    this.primaryTickNumber = 0;
    this.timelineBufferedThroughTick = 0;
    this.compiledDocument = null;
    this.sourceDocumentSignature = null;
    this.timelinePresentationActive = false;
    this.activeTopologySource = null;
    this.pendingStandardTickRate = null;
    this.resetDenseRateSample();
    this.operatingStatusTopology = null;
    this.topologyStore.setSnapshot(null);
    this.state.runningState = "stop";
    this.state.hasStarted = false;

    this.state.currentPlaybackTickNumber = 0;
    this.state.runtimeStatus = createInitialSimulationRuntimeStatus();
    // AI-REMOVED 2026-09-12:
    // Reason: SimulationState 不再承载性能诊断或电池投影，reset 只重置领域运行态。
    // Trigger: 用户确认移除 SimulationState.statistics，并改由统一 Query 读取。
    // Evidence: 性能采样器已在上方重置；电池值由 document runtime read model 查询投影。
    // Replacement: DenseSimulationController.getPerformanceDiagnostics 与 SimulationQuery.getDocumentRuntimeStatus。
    // Risk: Low。
    // Human Review: Required
    //
    // Original code:
    // this.state.statistics = {
    //   tickPerSecond: 0,
    //   targetTickPerSecond: 0,
    //   baseBatteryJoules: 0,
    //   baseBatteryCapacity: 0,
    // };
  });

  public dispose(): void {
    if (this.disposed) return;
    this.disposeBlueprintRuns();
    this.reset();
    this.bridge.dispose();
    this.disposed = true;
  }

  private async startRegionalSimulation(): Promise<SimulationStartResult> {
    const activePlaybackAdvance = this.playbackAdvanceInFlight;
    if (activePlaybackAdvance !== null) {
      await activePlaybackAdvance;
    }
    const editor = this.workspace.editor;
    const sourceDocument = editor?.document.getSnapshot();
    if (editor === null || editor === undefined || sourceDocument === undefined) {
      return this.failRegionalStart(
        "Regional simulation requires an editor document provider.",
        { code: "editor-document-unavailable" },
      );
    }
    const currentBase = this.workspace.registry.baseDefinitions.find(
      (definition) => definition.id === sourceDocument.baseId,
    );
    if (currentBase === undefined) {
      return this.failRegionalStart(
        `Unknown current base "${sourceDocument.baseId}".`,
        {
          code: "unknown-current-base",
          currentBaseId: sourceDocument.baseId,
        },
      );
    }
    const regionBases = this.workspace.registry.baseDefinitions.filter(
      (definition) => definition.tag === currentBase.tag,
    );
    // AI-REMOVED 2026-09-25:
    // Reason: Dense 合图和投影均支持一份基地文档，数量下限来自已退役的多 Worker 区域屏障。
    // Trigger: 单基地草稿箱在已开启区域模式时仍需启动仿真。
    // Evidence: createDenseRegionalDocument 仅拒绝空集合，且单基地合图已有测试覆盖。
    // Replacement: createDenseRegionalDocument 的非空文档校验；下方仍保留五基地上限。
    // Risk: 单基地区域合图需验证启动、投影和仓库行为。
    // Human Review: Required
    // Original code:
    // if (regionBases.length < 2) {
    //   return this.failRegionalStart(
    //     `区域 ${currentBase.tag} 至少需要两个基地才能启动多基地仿真。`,
    //     {
    //       code: "insufficient-regional-bases",
    //       currentBaseId: sourceDocument.baseId,
    //       regionBaseCount: regionBases.length,
    //       regionTag: currentBase.tag,
    //     },
    //   );
    // }
    if (regionBases.length > 5) {
      return this.failRegionalStart(
        `区域 ${currentBase.tag} 包含 ${regionBases.length} 个基地，超过 5 个上限。`,
        {
          code: "regional-base-limit-exceeded",
          currentBaseId: sourceDocument.baseId,
          regionBaseCount: regionBases.length,
          regionTag: currentBase.tag,
        },
      );
    }

    const switchedPresentation = await this.trySwitchRegionalPresentation({
      sourceDocument,
      currentBaseId: currentBase.id,
      regionTag: currentBase.tag,
    });
    if (switchedPresentation !== null) return switchedPresentation;

    const regionalBaseIds = regionBases.map((definition) => definition.id);
    let startStage = "read-base-documents";
    logger.info("Dense regional simulation start requested.", {
      currentBaseId: sourceDocument.baseId,
      regionTag: currentBase.tag,
      regionalBaseIds,
    });
    try {
      const latestDocuments = await editor.queries.readLatestBaseDocuments(
        regionalBaseIds,
      );
      const admissions = regionBases.map((definition, index) =>
        prepareDenseSimulationDocument({
          document: definition.id === sourceDocument.baseId
            ? sourceDocument
            : (latestDocuments[index] ?? sourceDocument),
          workspace: this.workspace,
          useCurrentEditorPlacementState: definition.id === sourceDocument.baseId,
        })
      );
      const regionalResources = normalizeRegionalResources(
        this.options.getRegionalResourceSettings?.(currentBase.tag) ?? [],
      );
      const standardTickRate = this.topologyStore.getSnapshot()?.standardTickRate
        ?? DENSE_STANDARD_TICK_RATE_PER_SECOND;
      startStage = "compile-topologies";
      const topologies = admissions.map((admission, regionBaseOrderIndex) => ({
        baseId: admission.document.baseId,
        regionBaseOrderIndex,
        topology: appendUnknownEntityAdmissionDiagnostics(
          compileSimulationTopology({
            document: admission.document,
            registry: this.workspace.registry,
            poweredEntityIds: computePoweredEntityIds(
              admission.document,
              this.workspace.registry,
            ),
            simulationMode: SIMULATION_MODE.regionalMultiBase,
            activeActivityIds: this.options.getActiveActivityIds?.() ?? [],
            regionalResources,
            standardTickRate,
          }),
          admission.excludedIssues,
        ),
      }));
      const compileFailure = topologies.flatMap((input) =>
        input.topology.diagnostics.map((diagnostic) => ({
          baseId: input.baseId,
          diagnostic,
        })))
        .find(({ diagnostic }) => diagnostic.severity === "error");
      if (compileFailure !== undefined) {
        return this.failRegionalStart(
          compileFailure.diagnostic.message,
          {
            code: "topology-compile-failed",
            currentBaseId: sourceDocument.baseId,
            failedBaseId: compileFailure.baseId,
            diagnostic: compileFailure.diagnostic,
          },
        );
      }
      const currentTopology = topologies.find(
        (input) => input.baseId === sourceDocument.baseId,
      )?.topology;
      if (currentTopology === undefined) {
        return this.failRegionalStart(
          `Dense regional current base "${sourceDocument.baseId}" is missing.`,
          {
            code: "regional-current-base-missing",
            currentBaseId: sourceDocument.baseId,
          },
        );
      }

      // AI-REMOVED 2026-09-17:
      // Reason: 多基地不再创建一组 Worker，也不再由主线程执行 Epoch 仓库仲裁。
      // Trigger: 用户要求所有基地合成一张大图并直接共享同一个仓库。
      // Evidence: 下方 regionalDocument/regionalTopology 只初始化一次 this.bridge；仓库由唯一隐藏仓库槽承载。
      // Replacement: createDenseRegionalDocument + initializeDenseTopology。
      // Risk: Medium；仓库写入从下一 Epoch 可见改为同一 kernel 内按正常 tick 阶段可见。
      // Human Review: Required
      //
      // Original code:
      // startStage = "validate-warehouse-admission";
      // const admission = buildRegionalWarehouseOutletTable({
      //   registry: this.workspace.registry,
      //   topologies,
      // });
      // if (!admission.ok || admission.table === null) {
      //   return this.failRegionalStart(
      //     admission.diagnostics.map((diagnostic) => diagnostic.message).join("\n"),
      //     {
      //       code: "regional-warehouse-admission-failed",
      //       currentBaseId: sourceDocument.baseId,
      //       diagnostics: admission.diagnostics,
      //     },
      //   );
      // }
      // this.topologyVersion += 1;
      // startStage = "initialize-workers";
      // const created = await DenseRegionalSimulationSession.create({
      //   sessionId: `dense-regional-${nextDenseSessionId}`,
      //   currentBaseId: sourceDocument.baseId,
      //   table: admission.table,
      //   bases: topologies.map((input) => {
      //     const document = admissions.find(
      //       (candidate) => candidate.document.baseId === input.baseId,
      //     )!.document;
      //     return {
      //       baseId: input.baseId,
      //       topology: input.topology,
      //       powerMode: document.documentSettings.powerMode ?? "infinite",
      //       powerConsumptionOverride: normalizePowerConsumptionOverride(
      //         document.documentSettings.powerConsumptionOverride,
      //       ),
      //     };
      //   }),
      //   registry: this.workspace.registry,
      //   workerMode: this.options.workerMode ?? "auto",
      // });
      // nextDenseSessionId += 1;
      // this.regionalSession = created.session;
      // this.projection = created.currentBasePresentationProjection;
      // this.primaryTickNumber = 0;
      // this.playbackTargetTickNumber = 0;
      // this.regionalWarehouseStats = createInitialRegionalWarehouseStats(
      //   currentTopology?.regionalResourceSupply,
      // );
      // startStage = "commit-first-epoch";
      // await this.fillOneRegionalEpoch();
      startStage = "compose-regional-document";
      const regionalDocument = createDenseRegionalDocument({
        documents: admissions.map((admission) => admission.document),
        registry: this.workspace.registry,
        // AI-REMOVED 2026-09-25:
        // Reason: Dense 合图直接解析已准备的区域文档。
        // Trigger: REQ-038 出口文档权威。
        // Evidence: createDenseRegionalDocument 不再接收外部关系表。
        // Replacement: dense-regional-document.ts。
        // Risk: 旧资产需先迁移。
        // Human Review: Required
        // Original code:
        // darkPipeLinks: this.options.getRegionalDarkPipeLinks?.(currentBase.tag) ?? [],
      });
      startStage = "compile-regional-topology";
      const regionalTopology = compileSimulationTopology({
        document: regionalDocument,
        registry: this.workspace.registry,
        poweredEntityIds: computePoweredEntityIds(regionalDocument, this.workspace.registry),
        simulationMode: SIMULATION_MODE.regionalMultiBase,
        activeActivityIds: this.options.getActiveActivityIds?.() ?? [],
        regionalResources,
        standardTickRate,
      });
      const regionalCompileError = regionalTopology.diagnostics.find(
        (diagnostic) => diagnostic.severity === "error",
      );
      if (regionalCompileError !== undefined) {
        return this.failRegionalStart(
          regionalCompileError.message,
          {
            code: "regional-composite-topology-compile-failed",
            currentBaseId: sourceDocument.baseId,
            diagnostic: regionalCompileError,
          },
        );
      }

      const previousSource = this.activeTopologySource;
      const previousExecutionTopology = this.executionTopology;
      const migration = previousSource === null
        || previousExecutionTopology === null
        || previousSource.regionTag !== currentBase.tag
        ? null
        : createSimulationTopologyMigration({
            previousDocument: previousSource.executionDocument,
            nextDocument: regionalDocument,
            previousTopology: previousExecutionTopology,
            nextTopology: regionalTopology,
            baseTickNumber: this.primaryTickNumber,
          });

      const presentationIdentity = createDensePresentationIdentity({
        baseId: sourceDocument.baseId,
        presentationTopology: currentTopology,
        executionTopology: regionalTopology,
      });

      const regionalStatusSourceByDeviceId = resolveDarkPipeStatusSourceByDeviceId(
        regionalTopology,
      );
      const currentDeviceIds = new Set(presentationIdentity.executionDeviceIds);
      const operatingStatusDeviceIds = [...new Set(
        presentationIdentity.executionDeviceIds.flatMap((deviceId) => {
          const sourceDeviceId = regionalStatusSourceByDeviceId.get(deviceId);
          return sourceDeviceId === undefined || currentDeviceIds.has(sourceDeviceId)
            ? []
            : [sourceDeviceId];
        }),
      )];
      startStage = "initialize-worker";
      const initialized = await this.initializeDenseTopology({
        document: regionalDocument,
        topology: regionalTopology,
        presentationIdentity,
        operatingStatusDeviceIds,
        ...(migration === null ? {} : { migration }),
      });
      const projection = new DenseProjectionStore(
        initialized.response.layout.dictionary,
        initialized.identity,
        presentationIdentity,
        operatingStatusDeviceIds,
      );
      projection.apply(initialized.response.initialDelta);
      await this.bridge.sendCommands([{ type: "start" }]);
      this.projection = projection;
      this.primaryTickNumber = initialized.response.initialDelta.tickNumber;
      this.timelineBufferedThroughTick = initialized.response.initialDelta.tickNumber;
      this.runtimeRetainedStateCount = initialized.response.runtimeRetainedStateCount;
      this.playbackTargetTickNumber = migration === null
        ? initialized.response.initialDelta.tickNumber
        : Math.max(
            this.playbackTargetTickNumber,
            initialized.response.initialDelta.tickNumber,
          );
      this.timelinePresentationActive = false;
      this.compiledDocument = null;
      this.sourceDocumentSignature = createDenseSimulationSourceSignature(sourceDocument);
      this.executionTopology = regionalTopology;
      this.presentationIdentity = presentationIdentity;
      this.denseSessionIdentity = initialized.identity;
      this.operatingStatusTopology = createDenseOperatingStatusTopology(
        regionalTopology,
        presentationIdentity,
      );
      this.topologyStore.setSnapshot(currentTopology);
      const currentAdmission = admissions.find(
        (admission) => admission.document.baseId === sourceDocument.baseId,
      );
      this.activeTopologySource = {
        initializationDocument: cloneWorldDocument(regionalDocument),
        executionDocument: cloneWorldDocument(regionalDocument),
        executionExcludedIssues: [],
        presentationDocument: cloneWorldDocument(
          currentAdmission?.document ?? sourceDocument,
        ),
        presentationExcludedIssues: [...(currentAdmission?.excludedIssues ?? [])],
        regionalResources: [...regionalResources],
        operatingStatusDeviceIds: [...operatingStatusDeviceIds],
        presentationIdentity,
        executionDictionary: initialized.response.layout.dictionary,
        regionTag: currentBase.tag,
        regionalDocuments: admissions.map((admission) =>
          cloneWorldDocument(admission.document)
        ),
      };
      this.state.regionalTotalPowerDemand = null;
      // AI-REMOVED 2026-09-12:
      // Reason: regional 初始化不再向 SimulationState 发布性能与电池读数。
      // Trigger: 用户要求统一通过 SimulationQuery 每秒查询仿真性能诊断。
      // Evidence: regionalSession 与 projection 已保存查询所需的运行态。
      // Replacement: DenseSimulationController.getPerformanceDiagnostics 与 DenseProjectionStore。
      // Risk: Low。
      // Human Review: Required
      //
      // Original code:
      // this.publishProjectionSnapshot();
      runInAction(() => {
        this.state.hasStarted = true;
        this.state.runningState = "start";
        this.state.currentPlaybackTickNumber = initialized.response.initialDelta.tickNumber;
        this.state.runtimeStatus = {
          mode: "running",
          topologyId: currentTopology.topologyId,
          documentHash: currentTopology.documentHash,
          retainedFromTick: initialized.response.initialDelta.tickNumber,
          latestTickNumber: initialized.response.initialDelta.tickNumber,
          bufferSize: 1,
          maxBufferSize: 1,
          dynamicTickRate: currentTopology.standardTickRate,
          error: null,
        };
      });
      logger.info("Dense regional simulation started.", {
        currentBaseId: sourceDocument.baseId,
        regionTag: currentBase.tag,
        regionalBaseIds,
        executionTopologyId: regionalTopology.topologyId,
      });
      return {
        status: "started",
        topologyId: currentTopology.topologyId,
        diagnostics: currentTopology.diagnostics,
      };
    } catch (error) {
      return this.failRegionalStart(
        error instanceof Error ? error.message : String(error),
        {
          code: "regional-start-exception",
          currentBaseId: sourceDocument.baseId,
          regionTag: currentBase.tag,
          regionalBaseIds,
          stage: startStage,
        },
      );
    }
  }

  private async trySwitchRegionalPresentation(options: {
    readonly sourceDocument: WorldDocument;
    readonly currentBaseId: string;
    readonly regionTag: string;
  }): Promise<SimulationStartResult | null> {
    const source = this.activeTopologySource;
    const executionTopology = this.executionTopology;
    const sessionIdentity = this.denseSessionIdentity;
    if (
      source?.regionTag !== options.regionTag
      || source.regionalDocuments === null
      || executionTopology === null
      || sessionIdentity === null
    ) {
      return null;
    }
    const cachedDocument = source.regionalDocuments.find(
      (document) => document.baseId === options.currentBaseId,
    );
    if (cachedDocument === undefined) return null;

    const admission = prepareDenseSimulationDocument({
      document: options.sourceDocument,
      workspace: this.workspace,
      useCurrentEditorPlacementState: true,
    });
    if (
      createSimulationDocumentHash(admission.document)
      !== createSimulationDocumentHash(cachedDocument)
    ) {
      return null;
    }

    const presentationTopology = appendUnknownEntityAdmissionDiagnostics(
      compileSimulationTopology({
        document: admission.document,
        registry: this.workspace.registry,
        poweredEntityIds: computePoweredEntityIds(
          admission.document,
          this.workspace.registry,
        ),
        simulationMode: SIMULATION_MODE.regionalMultiBase,
        activeActivityIds: this.options.getActiveActivityIds?.() ?? [],
        regionalResources: source.regionalResources,
        standardTickRate: executionTopology.standardTickRate,
      }),
      admission.excludedIssues,
    );
    const compileError = presentationTopology.diagnostics.find(
      (diagnostic) => diagnostic.severity === "error",
    );
    if (compileError !== undefined) {
      return this.failRefresh(compileError.message, presentationTopology.diagnostics);
    }

    const presentationIdentity = createDensePresentationIdentity({
      baseId: options.currentBaseId,
      presentationTopology,
      executionTopology,
    });
    const operatingStatusDeviceIds = resolveDenseOperatingStatusDeviceIds(
      executionTopology,
      presentationIdentity,
    );
    const response = await this.bridge.switchPresentation({
      tickNumber: this.primaryTickNumber,
      presentationDeviceIds: presentationIdentity.executionDeviceIds,
      operatingStatusDeviceIds,
    });
    const projection = new DenseProjectionStore(
      source.executionDictionary,
      sessionIdentity,
      presentationIdentity,
      operatingStatusDeviceIds,
    );
    projection.apply(response.delta);

    this.projection = projection;
    this.presentationIdentity = presentationIdentity;
    this.operatingStatusTopology = createDenseOperatingStatusTopology(
      executionTopology,
      presentationIdentity,
    );
    this.runtimeRetainedStateCount = response.runtimeRetainedStateCount;
    this.timelinePresentationActive = false;
    this.sourceDocumentSignature = createDenseSimulationSourceSignature(
      options.sourceDocument,
    );
    this.topologyStore.setSnapshot(presentationTopology);
    this.activeTopologySource = {
      ...source,
      presentationDocument: cloneWorldDocument(admission.document),
      presentationExcludedIssues: [...admission.excludedIssues],
      operatingStatusDeviceIds: [...operatingStatusDeviceIds],
      presentationIdentity,
    };
    runInAction(() => {
      this.state.currentPlaybackTickNumber = this.primaryTickNumber;
      this.state.runtimeStatus = {
        ...this.state.runtimeStatus,
        topologyId: presentationTopology.topologyId,
        documentHash: presentationTopology.documentHash,
        retainedFromTick: 0,
        latestTickNumber: Math.max(
          this.primaryTickNumber,
          this.timelineBufferedThroughTick,
        ),
        bufferSize: response.runtimeRetainedStateCount,
        dynamicTickRate: presentationTopology.standardTickRate,
        error: null,
      };
    });
    logger.info("Dense regional presentation switched without rebuilding the runtime.", {
      currentBaseId: options.currentBaseId,
      regionTag: options.regionTag,
      executionTopologyId: executionTopology.topologyId,
      tickNumber: response.delta.tickNumber,
    });
    return {
      status: "started",
      topologyId: presentationTopology.topologyId,
      diagnostics: presentationTopology.diagnostics,
    };
  }

  private failRegionalStart(
    message: string,
    context: Readonly<Record<string, unknown>>,
  ): SimulationStartResult {
    logger.error("Dense regional simulation start rejected.", {
      ...context,
      error: message,
    });
    runInAction(() => {
      this.state.runningState = "stop";
    });
    return this.failStart(message);
  }

  /*
   * AI-REMOVED 2026-09-17:
   * Reason: Dense Host 不再调度区域 Epoch 或聚合多个 Worker 的仓库结果。
   * Trigger: 用户要求 Dense 多基地改为单 Worker 合图和单共享仓库。
   * Evidence: startRegionalSimulation 只创建一个复合 topology 并初始化一个 bridge。
   * Replacement: DenseSimulationController.syncToTick
   * Risk: Low；Legacy 的区域 Epoch 实现在 src/simulation/legacy 中保留。
   * Human Review: Required
   *
   * Original code:
  private async fillOneRegionalEpoch(): Promise<void> {
    const session = this.regionalSession;
    if (session === null) return;
    if (this.regionalEpochInFlight !== null) {
      await this.regionalEpochInFlight;
      return;
    }
    const fill = session.runNextEpoch().then((committed) => {
      if (this.regionalSession !== session) return;
      for (const delta of committed.playbackDeltas) {
        this.regionalPlaybackDeltas.set(delta.tickNumber, delta);
      }
      this.regionalWarehouseStatsByTick.set(
        committed.gateTickNumber,
        committed.warehouseStats,
      );
      runInAction(() => {
        this.state.regionalTotalPowerDemand = committed.totalPowerDemand;
        this.state.runtimeStatus = {
          ...this.state.runtimeStatus,
          latestTickNumber: this.latestRegionalBufferedTick(),
          bufferSize: this.regionalPlaybackDeltas.size + 1,
        };
      });
    });
    this.regionalEpochInFlight = fill.finally(() => {
      if (this.regionalEpochInFlight === tracked) this.regionalEpochInFlight = null;
    });
    const tracked = this.regionalEpochInFlight;
    await tracked;
  }
   */

  private async drainPlaybackAdvances(): Promise<void> {
    while (this.state.runningState === "start") {
      const currentTickNumber = this.projection?.tickNumber ?? 0;
      const targetTickNumber = this.playbackTargetTickNumber;
      if (targetTickNumber <= currentTickNumber) return;
      const standardTickRate = this.requireCurrentStandardTickRate();
      const advanceStartedAt = performance.now();
      await this.syncToTick(targetTickNumber);
      const advancedTicks = Math.max(
        0,
        this.primaryTickNumber - currentTickNumber,
      );
      this.pendingPlaybackPerformanceTicks += advancedTicks;
      this.observeDenseRateCapacity({
        standardTickRate,
        advancedTicks,
        wallTimeMs: Math.max(0.001, performance.now() - advanceStartedAt),
      });
      await this.applyPendingDenseStandardTickRate();
    }
  }

  private observeDensePlaybackBackpressure(): void {
    const standardTickRate = this.projection?.standardTickRate;
    if (standardTickRate === null || standardTickRate === undefined) return;
    if (this.state.simulationSpeed < DENSE_DYNAMIC_STANDARD_RATE_MINIMUM_SPEED) {
      this.requestDenseStandardTickRate(DENSE_STANDARD_TICK_RATE_PER_SECOND);
      return;
    }
    if (standardTickRate !== DENSE_STANDARD_TICK_RATE_PER_SECOND) return;
    const backlogTicks = Math.max(
      0,
      this.playbackTargetTickNumber - this.primaryTickNumber,
    );
    const backlogWallSeconds = backlogTicks
      / (standardTickRate * this.state.simulationSpeed);
    if (backlogWallSeconds >= DENSE_BACKPRESSURE_WALL_SECONDS) {
      this.requestDenseStandardTickRate(DENSE_LOW_STANDARD_TICK_RATE_PER_SECOND);
    }
  }

  private observeDenseRateCapacity(options: {
    readonly standardTickRate: number;
    readonly advancedTicks: number;
    readonly wallTimeMs: number;
  }): void {
    if (
      this.state.simulationSpeed < DENSE_DYNAMIC_STANDARD_RATE_MINIMUM_SPEED
      || options.advancedTicks <= 0
      || options.wallTimeMs <= 0
    ) {
      return;
    }
    this.rateSampleWallTimeMs += options.wallTimeMs;
    this.rateSampleSimulationSeconds += options.advancedTicks / options.standardTickRate;
    if (this.rateSampleSimulationSeconds < DENSE_RATE_SAMPLE_SIMULATION_SECONDS) {
      return;
    }

    const simulationSecondsPerWallSecond = this.rateSampleSimulationSeconds
      / (this.rateSampleWallTimeMs / 1_000);
    const backlogTicks = Math.max(
      0,
      this.playbackTargetTickNumber - this.primaryTickNumber,
    );
    const backlogWallSeconds = backlogTicks
      / (options.standardTickRate * this.state.simulationSpeed);
    if (
      options.standardTickRate === DENSE_STANDARD_TICK_RATE_PER_SECOND
      && simulationSecondsPerWallSecond
        < this.state.simulationSpeed * DENSE_HIGH_RATE_CAPACITY_MARGIN
    ) {
      this.requestDenseStandardTickRate(DENSE_LOW_STANDARD_TICK_RATE_PER_SECOND);
    } else if (
      options.standardTickRate === DENSE_LOW_STANDARD_TICK_RATE_PER_SECOND
      && backlogWallSeconds < DENSE_BACKPRESSURE_WALL_SECONDS / 2
      && simulationSecondsPerWallSecond
        >= this.state.simulationSpeed * DENSE_LOW_RATE_RECOVERY_MARGIN
    ) {
      this.requestDenseStandardTickRate(DENSE_STANDARD_TICK_RATE_PER_SECOND);
    }
    this.resetDenseRateSample();
  }

  private requestDenseStandardTickRate(standardTickRate: number): void {
    if (
      standardTickRate !== DENSE_STANDARD_TICK_RATE_PER_SECOND
      && standardTickRate !== DENSE_LOW_STANDARD_TICK_RATE_PER_SECOND
    ) {
      throw new Error(`Unsupported Dense standard tick rate ${standardTickRate}.`);
    }
    const currentStandardTickRate = this.projection?.standardTickRate;
    if (currentStandardTickRate === standardTickRate) {
      this.pendingStandardTickRate = null;
      return;
    }
    this.pendingStandardTickRate = standardTickRate;
    if (this.playbackAdvanceInFlight === null) {
      void this.applyPendingDenseStandardTickRate().catch((error: unknown) => {
        this.publishRuntimeError(error);
      });
    }
  }

  private async applyPendingDenseStandardTickRate(): Promise<void> {
    const requestedStandardTickRate = this.pendingStandardTickRate;
    const currentStandardTickRate = this.projection?.standardTickRate;
    if (
      requestedStandardTickRate === null
      || currentStandardTickRate === null
      || currentStandardTickRate === undefined
    ) {
      return;
    }
    if (requestedStandardTickRate === currentStandardTickRate) {
      this.pendingStandardTickRate = null;
      return;
    }
    if (
      requestedStandardTickRate === DENSE_LOW_STANDARD_TICK_RATE_PER_SECOND
      && this.state.simulationSpeed < DENSE_DYNAMIC_STANDARD_RATE_MINIMUM_SPEED
    ) {
      this.pendingStandardTickRate = DENSE_STANDARD_TICK_RATE_PER_SECOND;
      return;
    }
    if (
      convertSimulationPhaseTickBetweenRatesExact(
        this.primaryTickNumber,
        currentStandardTickRate,
        requestedStandardTickRate,
      ) === null
    ) {
      return;
    }

    this.pendingStandardTickRate = null;
    await this.enqueueDenseRuntimeTransition(() =>
      this.switchDenseStandardTickRate(requestedStandardTickRate)
    );
  }

  private async switchDenseStandardTickRate(
    nextStandardTickRate: number,
  ): Promise<void> {
    const source = this.activeTopologySource;
    const previousExecutionTopology = this.operatingStatusTopology;
    const previousStandardTickRate = this.requireCurrentStandardTickRate();
    if (
      source === null
      || previousExecutionTopology === null
      || previousStandardTickRate === nextStandardTickRate
    ) {
      return;
    }

    const compile = (document: WorldDocument) => compileSimulationTopology({
      document,
      registry: this.workspace.registry,
      poweredEntityIds: computePoweredEntityIds(document, this.workspace.registry),
      simulationMode: this.state.simulationMode,
      activeActivityIds: this.options.getActiveActivityIds?.() ?? [],
      standardTickRate: nextStandardTickRate,
      ...(source.regionalResources.length === 0
        ? {}
        : { regionalResources: source.regionalResources }),
    });
    const executionTopology = appendUnknownEntityAdmissionDiagnostics(
      compile(source.executionDocument),
      source.executionExcludedIssues,
    );
    const executionCompileError = executionTopology.diagnostics.find(
      (diagnostic) => diagnostic.severity === "error",
    );
    if (executionCompileError !== undefined) {
      throw new Error(executionCompileError.message);
    }
    const presentationTopology = source.presentationDocument === null
      ? null
      : appendUnknownEntityAdmissionDiagnostics(
          compile(source.presentationDocument),
          source.presentationExcludedIssues,
        );
    const presentationCompileError = presentationTopology?.diagnostics.find(
      (diagnostic) => diagnostic.severity === "error",
    );
    if (presentationCompileError !== undefined) {
      throw new Error(presentationCompileError.message);
    }
    if (presentationTopology === null || source.presentationDocument === null) {
      throw new Error("Dense standard tick rate transition requires a presentation topology.");
    }
    const presentationIdentity = createDensePresentationIdentity({
      baseId: source.presentationDocument.baseId,
      presentationTopology,
      executionTopology,
    });
    const operatingStatusDeviceIds = resolveDenseOperatingStatusDeviceIds(
      executionTopology,
      presentationIdentity,
    );

    const migration = createSimulationTopologyMigration({
      previousDocument: source.executionDocument,
      nextDocument: source.executionDocument,
      previousTopology: previousExecutionTopology,
      nextTopology: executionTopology,
      baseTickNumber: this.primaryTickNumber,
    });
    if (migration === null) {
      throw new Error("Dense standard tick rate transition requires a migration source.");
    }

    const initialized = await this.initializeDenseTopology({
      document: source.initializationDocument,
      topology: executionTopology,
      presentationIdentity,
      operatingStatusDeviceIds,
      migration,
    });
    // 初始化等待期间 RAF 仍会按旧频率累计墙钟目标；必须在提交新频率前读取最新值并一次换算。
    const previousPlaybackTarget = this.playbackTargetTickNumber;
    const previousPlaybackRemainder = this.playbackRemainderTicks;
    const projection = new DenseProjectionStore(
      initialized.response.layout.dictionary,
      initialized.identity,
      presentationIdentity,
      operatingStatusDeviceIds,
    );
    projection.apply(initialized.response.initialDelta);

    const convertedPlaybackTarget = convertSimulationPhaseTickBetweenRates(
      previousPlaybackTarget,
      previousStandardTickRate,
      nextStandardTickRate,
    );
    const convertedWholeTarget = Math.floor(convertedPlaybackTarget);
    let convertedRemainder = previousPlaybackRemainder
      * nextStandardTickRate
      / previousStandardTickRate
      + convertedPlaybackTarget
      - convertedWholeTarget;
    let normalizedTarget = convertedWholeTarget;
    if (convertedRemainder >= 1) {
      const extraWholeTicks = Math.floor(convertedRemainder);
      normalizedTarget += extraWholeTicks;
      convertedRemainder -= extraWholeTicks;
    }

    this.projection = projection;
    this.primaryTickNumber = initialized.response.initialDelta.tickNumber;
    this.timelineBufferedThroughTick = this.primaryTickNumber;
    this.runtimeRetainedStateCount = initialized.response.runtimeRetainedStateCount;
    this.playbackTargetTickNumber = Math.max(this.primaryTickNumber, normalizedTarget);
    this.playbackRemainderTicks = convertedRemainder;
    this.timelinePresentationActive = false;
    this.executionTopology = executionTopology;
    this.presentationIdentity = presentationIdentity;
    this.denseSessionIdentity = initialized.identity;
    this.operatingStatusTopology = createDenseOperatingStatusTopology(
      executionTopology,
      presentationIdentity,
    );
    const publishedTopology = presentationTopology;
    this.topologyStore.setSnapshot(publishedTopology);
    this.activeTopologySource = {
      ...source,
      operatingStatusDeviceIds: [...operatingStatusDeviceIds],
      presentationIdentity,
      executionDictionary: initialized.response.layout.dictionary,
    };
    this.resetDenseRateSample();

    runInAction(() => {
      this.state.currentPlaybackTickNumber = this.primaryTickNumber;
      this.state.runtimeStatus = {
        mode: "running",
        topologyId: publishedTopology.topologyId,
        documentHash: publishedTopology.documentHash,
        retainedFromTick: this.primaryTickNumber,
        latestTickNumber: this.primaryTickNumber,
        bufferSize: this.runtimeRetainedStateCount,
        maxBufferSize: 1,
        dynamicTickRate: nextStandardTickRate,
        error: null,
      };
      if (this.state.timeline.enabled) {
        const timelineStepTicks = resolveDenseTimelineStepStandardTicks(
          nextStandardTickRate,
        );
        const cursorTickNumber = Math.max(
          0,
          Math.floor(
            (this.primaryTickNumber - DENSE_TIMELINE_ORIGIN_STANDARD_TICK)
              / timelineStepTicks,
          ),
        );
        this.state.timeline = {
          ...this.state.timeline,
          readiness: "preparing",
          windowStartTickNumber: cursorTickNumber,
          cursorTickNumber,
          availableFromTickNumber: cursorTickNumber,
          availableToTickNumber: cursorTickNumber + DENSE_TIMELINE_CAPACITY_TICKS,
          isSeeking: false,
        };
      }
    });
    if (this.state.timeline.enabled) {
      await this.ensureTimelineBuffer();
      runInAction(() => {
        this.state.timeline.readiness = "ready";
      });
    }
  }

  private requireCurrentStandardTickRate(): number {
    const standardTickRate = this.projection?.standardTickRate
      ?? this.topologyStore.getSnapshot()?.standardTickRate;
    if (standardTickRate === null || standardTickRate === undefined) {
      throw new Error("Dense standard tick rate is unavailable before initialization.");
    }
    return standardTickRate;
  }

  private resetDenseRateSample(): void {
    this.rateSampleWallTimeMs = 0;
    this.rateSampleSimulationSeconds = 0;
  }

  private flushPlaybackPerformanceWindow(): void {
    this.playbackTickRateWindow.record(
      this.pendingPlaybackPerformanceElapsedMs,
      this.pendingPlaybackPerformanceTicks,
    );
    this.pendingPlaybackPerformanceElapsedMs = 0;
    this.pendingPlaybackPerformanceTicks = 0;
  }

  /*
   * AI-REMOVED 2026-09-17:
   * Reason: Dense 播放投影直接消费唯一 Worker 的 FrameDelta，不再回放当前基地专属 Epoch 队列。
   * Trigger: 用户要求所有基地在同一张 Dense 图内持续运行。
   * Evidence: DenseFrameEmitter 的 presentation filter 直接生成当前基地展示切片。
   * Replacement: DenseSimulationController.syncToTick + DenseProjectionStore
   * Risk: Low。
   * Human Review: Required
   *
   * Original code:
  private async advanceRegionalPresentationToTick(targetTickNumber: number): Promise<void> {
    const projection = this.projection;
    if (projection === null || this.regionalSession === null) return;
    while (this.latestRegionalBufferedTick() < targetTickNumber) {
      await this.fillOneRegionalEpoch();
    }
    for (
      let tickNumber = (projection.tickNumber ?? 0) + 1;
      tickNumber <= targetTickNumber;
      tickNumber += 1
    ) {
      const delta = this.regionalPlaybackDeltas.get(tickNumber);
      if (delta === undefined) {
        throw new Error(`Dense regional playback is missing tick ${tickNumber}.`);
      }
      projection.apply(delta);
      this.regionalPlaybackDeltas.delete(tickNumber);
      const warehouseStats = this.regionalWarehouseStatsByTick.get(tickNumber);
      if (warehouseStats !== undefined) {
        this.regionalWarehouseStats = warehouseStats;
        this.regionalWarehouseStatsByTick.delete(tickNumber);
      }
    }
    this.primaryTickNumber = targetTickNumber;
    // AI-REMOVED 2026-09-12:
    // Reason: regional 播放推进不再向 SimulationState 发布性能与电池读数。
    // Trigger: 用户要求统一通过 SimulationQuery 每秒查询仿真性能诊断。
    // Evidence: projection、regionalSession 与播放缓存已保存查询所需的运行态。
    // Replacement: DenseSimulationController.getPerformanceDiagnostics 与 DenseProjectionStore。
    // Risk: Low。
    // Human Review: Required
    //
    // Original code:
    // this.publishProjectionSnapshot();
    runInAction(() => {
      this.state.currentPlaybackTickNumber = targetTickNumber;
      this.state.runtimeStatus = {
        ...this.state.runtimeStatus,
        retainedFromTick: targetTickNumber,
        latestTickNumber: Math.max(targetTickNumber, this.latestRegionalBufferedTick()),
        bufferSize: this.regionalPlaybackDeltas.size + 1,
      };
    });
  }

  private latestRegionalBufferedTick(): number {
    let latest = this.projection?.tickNumber ?? 0;
    for (const tickNumber of this.regionalPlaybackDeltas.keys()) {
      latest = Math.max(latest, tickNumber);
    }
    return latest;
  }

  private disposeRegionalSession(): void {
    this.regionalSession?.dispose();
    this.regionalSession = null;
    this.regionalEpochInFlight = null;
    this.regionalPlaybackDeltas.clear();
    this.regionalWarehouseStatsByTick.clear();
    this.regionalWarehouseStats = null;
    this.state.regionalTotalPowerDemand = null;
  }
   */

  // AI-REMOVED 2026-09-12:
  // Reason: 性能诊断不是领域状态，电池读数也已有 document runtime read model，禁止继续向 SimulationState 写入。
  // Trigger: 用户确认移除公共 contract 中的仿真计数，并由界面每秒调用统一 Query。
  // Evidence: SimulationQuery.getPerformanceDiagnostics 提供 Host 内部采样；getDocumentRuntimeStatus 提供电池投影。
  // Replacement: DenseSimulationController.getPerformanceDiagnostics 与 SimulationQuery.getDocumentRuntimeStatus。
  // Risk: Low；依赖 MobX statistics 变更通知的旧调用方必须改为主动轮询 Query。
  // Human Review: Required
  //
  // Original code:
  // private publishProjectionSnapshot(): void {
  //   const projection = this.projection;
  //   if (projection === null) return;
  //   runInAction(() => {
  //     // runtime 模式只供 engine/Blueprint 测试使用；browser dense 路径不物化 legacy snapshot。
  //     // AI-CORRECTION 2026-09-09: 两种模式都只发布投影统计；完整快照改由 testkit 按需读取。
  //     this.state.statistics = {
  //       tickPerSecond: 0,
  //       targetTickPerSecond: 0,
  //       baseBatteryJoules: projection.batteryJoules,
  //       baseBatteryCapacity: projection.batteryCapacity,
  //     };
  //   });
  // }

  private failStart(
    message: string,
    diagnostics: SimulationStartResult["diagnostics"] = [],
  ): SimulationStartResult {
    this.projection = null;
    this.presentationIdentity = null;
    this.executionTopology = null;
    this.denseSessionIdentity = null;
    this.compiledDocument = null;
    this.sourceDocumentSignature = null;
    this.runtimeRetainedStateCount = 0;
    this.timelineBufferedThroughTick = 0;
    this.activeTopologySource = null;
    this.pendingStandardTickRate = null;
    this.resetDenseRateSample();
    this.operatingStatusTopology = null;
    this.topologyStore.setSnapshot(null);
    runInAction(() => {
      this.state.hasStarted = false;

      this.state.runtimeStatus = {
        ...createInitialSimulationRuntimeStatus(),
        mode: "error",
        error: message,
      };
    });
    return { status: "failed", topologyId: null, diagnostics, error: message };
  }

  private failRefresh(
    message: string,
    diagnostics: SimulationStartResult["diagnostics"],
  ): SimulationStartResult {
    const topology = this.topologyStore.getSnapshot();
    if (this.projection === null || topology === null) {
      return this.failStart(message, diagnostics);
    }
    runInAction(() => {
      this.state.runtimeStatus = {
        ...this.state.runtimeStatus,
        mode: "error",
        error: message,
      };
    });
    return {
      status: "failed",
      topologyId: topology.topologyId,
      diagnostics,
      error: message,
    };
  }

  private assertNotDisposed(): void {
    if (this.disposed) throw new Error("Dense simulation host has been disposed.");
  }

  private sendCommands(commands: Parameters<DenseEngineBridge["sendCommands"]>[0]): void {
    void this.bridge.sendCommands(commands).catch((error: unknown) => {
      this.publishRuntimeError(error);
    });
  }

  private publishRuntimeError(error: unknown): void {
    runInAction(() => {
      this.state.runtimeStatus = {
        ...this.state.runtimeStatus,
        mode: "error",
        error: error instanceof Error ? error.message : String(error),
      };
    });
  }

  private async restorePrimaryProjection(): Promise<void> {
    try {
      const response = await this.bridge.requestPresentationCheckpoint(this.primaryTickNumber);
      this.projection?.replaceCheckpoint(response.delta);
      this.runtimeRetainedStateCount = response.runtimeRetainedStateCount;
      this.timelinePresentationActive = false;
      // AI-REMOVED 2026-09-12:
      // Reason: 恢复主投影不再向 SimulationState 发布性能与电池读数。
      // Trigger: 用户要求统一通过 SimulationQuery 每秒查询仿真性能诊断。
      // Evidence: presentation-checkpoint 已更新 projection 与 runtimeRetainedStateCount。
      // Replacement: DenseSimulationController.getPerformanceDiagnostics 与 DenseProjectionStore。
      // Risk: Low。
      // Human Review: Required
      //
      // Original code:
      // this.publishProjectionSnapshot();
      runInAction(() => {
        this.state.currentPlaybackTickNumber = this.primaryTickNumber;
      });
    } catch (error) {
      runInAction(() => {
        this.state.runtimeStatus = {
          ...this.state.runtimeStatus,
          mode: "error",
          error: error instanceof Error ? error.message : String(error),
        };
      });
    }
  }

  private async ensureTimelineBuffer(): Promise<void> {
    if (!this.state.timeline.enabled || this.projection === null) return;
    const targetTickNumber = DENSE_TIMELINE_ORIGIN_STANDARD_TICK
      + this.state.timeline.availableToTickNumber * resolveDenseTimelineStepStandardTicks(
        this.requireCurrentStandardTickRate(),
      );
    if (targetTickNumber <= this.timelineBufferedThroughTick) return;
    const response = await this.bridge.ensureBufferedThrough(targetTickNumber);
    this.timelineBufferedThroughTick = response.bufferedThroughTickNumber;
    this.runtimeRetainedStateCount = response.runtimeRetainedStateCount;
    runInAction(() => {
      this.state.runtimeStatus = {
        ...this.state.runtimeStatus,
        retainedFromTick: 0,
        latestTickNumber: Math.max(
          this.primaryTickNumber,
          response.bufferedThroughTickNumber,
        ),
        bufferSize: response.runtimeRetainedStateCount,
        maxBufferSize: 900,
      };
    });
  }
}

function resolveDenseTimelineStepStandardTicks(standardTickRate: number): number {
  const stepTicks = standardTickRate * DENSE_TIMELINE_TICK_DURATION_SECONDS;
  if (!Number.isSafeInteger(stepTicks) || stepTicks <= 0) {
    throw new Error(
      `Dense standard tick rate ${standardTickRate} cannot represent the timeline step.`,
    );
  }
  return stepTicks;
}

function createNotFoundTickStatus(tickNumber: number): SimulationTickPullStatus {
  return {
    status: "not-found",
    reason: "missing-topology",
    requestedTickNumber: tickNumber,
    retainedFromTick: null,
    latestTickNumber: null,
    bufferSize: 0,
  };
}

function normalizePowerConsumptionOverride(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) && value >= 0
    ? value
    : undefined;
}

function createDenseSimulationSourceSignature(document: WorldDocument): string {
  const powerMode = document.documentSettings.powerMode ?? "infinite";
  const powerConsumptionOverride = normalizePowerConsumptionOverride(
    document.documentSettings.powerConsumptionOverride,
  );
  return [
    createSimulationDocumentHash(document),
    powerMode,
    powerConsumptionOverride ?? "default",
  ].join("|");
}

// AI-REMOVED 2026-09-20:
// Reason: 基地切换不再改变执行实体和仓库身份，因此不需要构造跨 ID topology migration。
// Trigger: ST2-RQ-036 要求当前基地仅作为投影，并保留原 Worker、kernel 与 checkpoint 缓冲。
// Evidence: createDenseRegionalDocument 已对所有基地使用稳定作用域 ID；trySwitchRegionalPresentation 只替换 FrameEmitter 与 Host 投影。
// Replacement: createDensePresentationIdentity + DenseEngineBridge.switchPresentation
// Risk: Low；真实文档变更仍使用稳定同 ID 的 createSimulationTopologyMigration。
// Human Review: Required
//
// Original code:
// function createDenseRegionalMigrationIdentity(options: {
//   readonly documents: readonly WorldDocument[];
//   readonly previousCurrentBaseId: string;
//   readonly nextCurrentBaseId: string;
// }): {
//   readonly previousEntityIdByNextEntityId: Readonly<Record<string, string>>;
//   readonly previousDeviceIdByNextDeviceId: Readonly<Record<string, string>>;
// } {
//   const previousEntityIdByNextEntityId: Record<string, string> = {};
//   const previousDeviceIdByNextDeviceId: Record<string, string> = {};
//   for (const document of options.documents) {
//     for (const entityId of document.entityOrder) {
//       const previousEntityId = resolveDenseRegionalEntityId(
//         document.baseId,
//         entityId,
//         options.previousCurrentBaseId,
//       );
//       const nextEntityId = resolveDenseRegionalEntityId(
//         document.baseId,
//         entityId,
//         options.nextCurrentBaseId,
//       );
//       if (previousEntityId === nextEntityId) continue;
//       previousEntityIdByNextEntityId[nextEntityId] = previousEntityId;
//       previousDeviceIdByNextDeviceId[`device:${nextEntityId}`] =
//         `device:${previousEntityId}`;
//     }
//   }
//
//   const previousWarehouseDeviceId = `device:warehouse:${options.previousCurrentBaseId}`;
//   const nextWarehouseDeviceId = `device:warehouse:${options.nextCurrentBaseId}`;
//   if (previousWarehouseDeviceId !== nextWarehouseDeviceId) {
//     previousDeviceIdByNextDeviceId[nextWarehouseDeviceId] = previousWarehouseDeviceId;
//   }
//   return {
//     previousEntityIdByNextEntityId,
//     previousDeviceIdByNextDeviceId,
//   };
// }

function resolveDenseOperatingStatusDeviceIds(
  executionTopology: CompiledSimulationTopology,
  presentationIdentity: DensePresentationIdentity,
): string[] {
  const statusSourceByDeviceId = resolveDarkPipeStatusSourceByDeviceId(executionTopology);
  const presentationDeviceIds = new Set(presentationIdentity.executionDeviceIds);
  return [...new Set(presentationIdentity.executionDeviceIds.flatMap((deviceId) => {
    const sourceDeviceId = statusSourceByDeviceId.get(deviceId);
    return sourceDeviceId === undefined || presentationDeviceIds.has(sourceDeviceId)
      ? []
      : [sourceDeviceId];
  }))];
}

function cloneWorldDocument(document: WorldDocument): WorldDocument {
  return JSON.parse(JSON.stringify(document)) as WorldDocument;
}

// AI-REMOVED 2026-09-16:
// Reason: 将两套引擎重复的供电覆盖算法收口至共享几何函数。
// Trigger: 独立蓝图验证必须与编辑器仿真使用相同供电规则。
// Evidence: legacy/controller-support 与 dense/host 采用相同矩形相交判定。
// Replacement: src/shared/geometry/power-range.ts collectPoweredEntityIds
// Risk: Low
// Human Review: Required
// Original code:
// function computePoweredEntityIds(
//   document: WorldDocument,
//   registry: WorkspaceContract["registry"],
// ): Set<string> {
//   const definitionById = new Map(
//     registry.entityDefinitions.map((definition) => [definition.id, definition]),
//   );
//   const entities = resolveOrderedDocumentEntities(document);
//   const powerRangeRects = entities.flatMap((entity) => {
//     const definition = definitionById.get(entity.definitionId);
//     if (definition === undefined) return [];
//     const gridRect = resolvePowerRangeGridRect({ entity, definition });
//     return gridRect === null ? [] : [gridRect];
//   });
//   if (powerRangeRects.length === 0) return new Set();
//
//   return new Set(entities.flatMap((entity) => {
//     const definition = definitionById.get(entity.definitionId);
//     if (definition === undefined) return [];
//     const entityGridRect = resolveEntityGridRect({ entity, definition });
//     return powerRangeRects.some((powerRangeRect) =>
//       areGridRectsIntersecting(entityGridRect, powerRangeRect)
//     ) ? [entity.id] : [];
//   }));
// }
function computePoweredEntityIds(document: WorldDocument, registry: WorkspaceContract["registry"]): Set<string> {
  return collectPoweredEntityIds(resolveOrderedDocumentEntities(document), registry.entityDefinitions);
}

function resolveOrderedDocumentEntities(document: WorldDocument): WorldEntity[] {
  return document.entityOrder.flatMap((entityId) => {
    const entity = document.entities[entityId];
    return entity === undefined ? [] : [entity];
  });
}

// AI-REMOVED 2026-09-08:
// Reason: Dense 私有的基地内置实体合并会绕开 Legacy 的 invalidPlacement 过滤，现统一到共享入口。
// Trigger: invalid-placement-compile 的 dense-v2 矩阵分支把越界传送带编入拓扑。
// Evidence: prepareDenseSimulationDocument 原先只调用该函数后执行未知定义准入。
// Replacement: src/simulation/simulation-document-preparation.ts
// Risk: Low；共享入口保留相同的内置实体顺序与覆盖语义。
// Human Review: Required
//
// Original code:
// function appendBaseBuiltinEntities(options: {
//   readonly document: WorldDocument;
//   readonly workspace: WorkspaceContract;
// }): WorldDocument {
//   const builtinEntities = resolveBaseBuiltinEntities({
//     baseDefinitions: options.workspace.registry.baseDefinitions,
//     baseId: options.document.baseId,
//   });
//   if (builtinEntities.length === 0) return options.document;
//   const builtinIds = new Set(builtinEntities.map((entity) => entity.id));
//   return {
//     ...options.document,
//     entities: {
//       ...options.document.entities,
//       ...Object.fromEntries(builtinEntities.map((entity) => [entity.id, entity])),
//     },
//     entityOrder: [
//       ...builtinEntities.map((entity) => entity.id),
//       ...options.document.entityOrder.filter((entityId) => !builtinIds.has(entityId)),
//     ],
//   };
// }

function prepareDenseSimulationDocument(options: {
  readonly document: WorldDocument;
  readonly workspace: WorkspaceContract;
  readonly useCurrentEditorPlacementState?: boolean;
}): ReturnType<typeof admitWorldDocumentForSimulation> {
  const document = options.useCurrentEditorPlacementState === false
    ? appendSimulationBaseBuiltinEntities(options)
    : prepareCurrentSimulationDocument(options);
  const admission = admitWorldDocumentForSimulation({
    document,
    entityDefinitions: options.workspace.registry.entityDefinitions,
  });
  if (admission.excludedIssues.length > 0) {
    logger.warn("Dense simulation ignored unknown document entities.", {
      baseId: options.document.baseId,
      ignoredEntityCount: admission.excludedIssues.length,
      ignoredEntities: admission.excludedIssues.map((issue) => ({
        entityId: issue.entityId,
        definitionId: issue.definitionId,
        position: issue.position,
        relatedSlotLinkCount: issue.relatedSlotLinkCount,
      })),
    });
  }
  return admission;
}

function appendUnknownEntityAdmissionDiagnostics(
  topology: CompiledSimulationTopology,
  excludedIssues: readonly UnknownWorldEntityDefinitionIssue[],
): CompiledSimulationTopology {
  if (excludedIssues.length === 0) return topology;

  return {
    ...topology,
    diagnostics: [
      ...excludedIssues.map((issue) => ({
        severity: "warning" as const,
        code: "ignored-unknown-entity-definition",
        message: `Ignored unknown entity "${issue.entityId}" with missing definition "${issue.definitionId}".`,
        entityId: issue.entityId,
        definitionId: issue.definitionId,
      })),
      ...topology.diagnostics,
    ],
  };
}

function normalizeRegionalResources(
  settings: readonly RegionalResourceSupplySetting[],
): RegionalResourceSupplySetting[] {
  return [...settings]
    .map((setting) => ({ ...setting }))
    .sort((left, right) => left.itemId.localeCompare(right.itemId));
}

// AI-REMOVED 2026-09-17:
// Reason: 单 kernel 区域会话的仓库统计直接由唯一隐藏仓库生成，不再需要 Host 构造区域初始统计。
// Trigger: 用户要求多基地直接共享同一个仓库，删除主线程仓库同步设施。
// Evidence: DenseFrameEmitter.createWarehouseStatsDelta 已覆盖初始帧与后续差分。
// Replacement: DenseProjectionStore.getWarehouseStats
// Risk: Low。
// Human Review: Required
//
// Original code:
// function createInitialRegionalWarehouseStats(
//   supply: CompiledRegionalResourceSupply | undefined,
// ): WarehouseStats {
//   const items: Record<string, {
//     producedPerMinute: number;
//     consumedPerMinute: number;
//     warehouseCount: number;
//     infinite: boolean;
//     lastChangedTick: number;
//   }> = {};
//   for (const itemId of supply?.infiniteItemIds ?? []) {
//     items[itemId] = {
//       producedPerMinute: 0,
//       consumedPerMinute: 0,
//       warehouseCount: 0,
//       infinite: true,
//       lastChangedTick: 0,
//     };
//   }
//   for (const [itemId, perMinute] of Object.entries(
//     supply?.finitePerMinuteByItemId ?? {},
//   )) {
//     const current = items[itemId];
//     items[itemId] = {
//       producedPerMinute: perMinute,
//       consumedPerMinute: current?.consumedPerMinute ?? 0,
//       warehouseCount: current?.warehouseCount ?? 0,
//       infinite: current?.infinite ?? false,
//       lastChangedTick: current?.lastChangedTick ?? 0,
//     };
//   }
//   return { items, statsWindowReady: false };
// }
