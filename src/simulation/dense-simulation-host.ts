import { action, runInAction } from "mobx";

import type { WorkspaceContract } from "@/domain/document/workspace-contract";
import type { WorldDocument, WorldEntity } from "@/domain/document/world-document";
import type { SimulationAction } from "@/domain/simulation/simulation-action";
import type { SimulationContract } from "@/domain/simulation/simulation-contract";
import type {
  SimulationDeviceRuntimeChannelRecipeStatus,
  SimulationDeviceRuntimeSlotItemReadModel,
  SimulationDeviceRuntimeStatusReadModel,
  WarehouseStatsReadModel,
} from "@/domain/simulation/types/simulation-types";
import { ADMISSION_RATE_WINDOWS_PER_MINUTE } from "@/domain/registry";
import { resolveBaseBuiltinEntities } from "@/domain/registry/types/base-definition";
import { SIMULATION_MODE } from "@/domain/shared/simulation-mode";
import { createLogger } from "@/shared/logging/logger";
import {
  createSnapshotStore,
  type SnapshotStoreReadWrite,
} from "@/shared/snapshot/snapshot-store";
import {
  areGridRectsIntersecting,
  resolveEntityGridRect,
  resolvePowerRangeGridRect,
} from "@/shared/geometry/power-range";
import { buildDeviceGasCoverage } from "./runtime/gas-diffusion";
import { isRegionalSimulationSpeed } from "@/shared/regional-simulation-speed";

import type { SimulationInternalAction } from "./action-impl";
import {
  DenseProjectionStore,
  DenseRegionalSimulationSession,
  createDenseEngineBridge,
  type DenseFrameDelta,
  type DenseEngineBridge,
} from "./dense";
import { buildRegionalWarehouseOutletTable } from "./regional";
import type {
  CreateSimulationHostOptions,
  SimulationHost,
} from "./simulation-host";
import {
  createInitialSimulationRuntimeStatus,
  createInitialSimulationTimelineState,
  createSimulationStateReadWrite,
  type SimulationStateReadWrite,
} from "./state-impl";
import { convertSimulationTicksToSeconds } from "./tick-rate";
import {
  compileSimulationTopology,
  createSimulationDocumentHash,
} from "./topology-compiler";
import { createSimulationTopologyMigration } from "./topology-migration";
import type {
  CompiledRegionalResourceSupply,
  CompiledSimulationTopology,
  RegionalResourceSupplySetting,
  WarehouseStats,
  SimulationStartResult,
  SimulationTickPullStatus,
  SimulationTopologyMigration,
} from "./types";

let nextDenseSessionId = 1;
const DENSE_TIMELINE_TICK_DURATION_SECONDS = 0.5;
const DENSE_TIMELINE_RULER_DURATION_SECONDS = 300;
const DENSE_TIMELINE_STEP_STANDARD_TICKS = 10;
const DENSE_TIMELINE_ORIGIN_STANDARD_TICK = 1;
const DENSE_TIMELINE_CAPACITY_TICKS = 600;
const logger = createLogger("dense-simulation-runtime");

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
    workspace,
    topology: topologyStore,
    internalState,
    internalActions: controller,
    get state() {
      return internalState;
    },
    actions,
    queries: createDenseQueries(controller),
    dispose: () => {
      while (disposers.length > 0) disposers.pop()?.();
      controller.dispose();
    },
  };
  workspace.simulation = host;
  const documentStore = workspace.editor?.document;
  if (documentStore !== undefined) {
    disposers.push(documentStore.subscribe((document) => {
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
  private readonly workspace: WorkspaceContract;
  private readonly options: CreateSimulationHostOptions;
  private readonly topologyStore: SnapshotStoreReadWrite<CompiledSimulationTopology | null>;
  private readonly state: SimulationStateReadWrite;
  private readonly bridge: DenseEngineBridge;
  private projection: DenseProjectionStore | null = null;
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
  private primaryTickNumber = 0;
  private compiledDocument: WorldDocument | null = null;
  private sourceDocumentSignature: string | null = null;
  private topologyRefreshQueue: Promise<void> | null = null;
  private timelinePresentationActive = false;
  private regionalSession: DenseRegionalSimulationSession | null = null;
  private readonly regionalPlaybackDeltas = new Map<number, DenseFrameDelta>();
  private readonly regionalWarehouseStatsByTick = new Map<number, WarehouseStats>();
  private regionalWarehouseStats: WarehouseStats | null = null;
  private regionalEpochInFlight: Promise<void> | null = null;
  private disposed = false;

  public constructor(input: {
    readonly workspace: WorkspaceContract;
    readonly options: CreateSimulationHostOptions;
    readonly topologyStore: SnapshotStoreReadWrite<CompiledSimulationTopology | null>;
    readonly state: SimulationStateReadWrite;
    readonly bridge: DenseEngineBridge;
  }) {
    this.workspace = input.workspace;
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

  public get simulationState(): SimulationStateReadWrite {
    return this.state;
  }

  public get currentPowerConsumptionOverride(): number | undefined {
    return normalizePowerConsumptionOverride(
      this.workspace.editor?.document.getSnapshot().documentSettings.powerConsumptionOverride,
    );
  }

  public get currentWarehouseStats(): WarehouseStats | null {
    return this.regionalWarehouseStats
      ?? this.projection?.getWarehouseStats()
      ?? null;
  }

  public hasSimulationRelevantDocumentChange(document: WorldDocument): boolean {
    return this.sourceDocumentSignature !== createDenseSimulationSourceSignature(document);
  }

  public readonly start: SimulationContract["actions"]["start"] = async () => {
    if (this.state.runningState === "starting") return;
    runInAction(() => {
      this.state.hasStarted = true;
      this.state.runningState = "starting";
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

  public readonly setRegionalMultiBaseEnabled: SimulationContract["actions"]["setRegionalMultiBaseEnabled"] = action((enabled) => {
    const simulationMode = enabled
      ? SIMULATION_MODE.regionalMultiBase
      : SIMULATION_MODE.singleBase;
    if (
      simulationMode === this.state.simulationMode
      || this.state.runningState !== "stop"
      || (enabled && this.state.timeline.enabled)
    ) return;
    if (enabled && !isRegionalSimulationSpeed(this.state.simulationSpeed)) {
      this.state.simulationSpeed = 1;
    }
    this.state.simulationMode = simulationMode;
  });

  public readonly pause: SimulationContract["actions"]["pause"] = action(() => {
    if (this.state.runningState !== "start") return;
    this.state.runningState = "pause";
    if (this.regionalSession === null) this.sendCommands([{ type: "pause" }]);
  });

  public readonly resume: SimulationContract["actions"]["resume"] = action(() => {
    if (this.state.runningState !== "pause") return;
    this.state.runningState = "start";
    if (this.regionalSession === null) this.sendCommands([{ type: "resume" }]);
  });

  public readonly stop: SimulationContract["actions"]["stop"] = action(() => {
    this.state.runningState = "stop";
    this.playbackRemainderTicks = 0;
    this.playbackTargetTickNumber = this.projection?.tickNumber ?? 0;
    if (this.projection !== null && this.regionalSession === null) {
      this.sendCommands([{ type: "stop" }]);
    }
    this.disposeRegionalSession();
  });

  public readonly setSimulationSpeed: SimulationInternalAction["setSimulationSpeed"] = action((value) => {
    if (!Number.isFinite(value) || value <= 0) {
      throw new Error(`Dense simulation speed must be positive; received ${value}.`);
    }
    if (
      this.state.simulationMode === SIMULATION_MODE.regionalMultiBase
      && !isRegionalSimulationSpeed(value)
    ) return;
    if (this.regionalSession !== null && value !== this.state.simulationSpeed) return;
    this.state.simulationSpeed = value;
    if (this.projection !== null) {
      this.sendCommands([{ type: "set-speed", simulationSpeed: value }]);
    }
  });

  public readonly advancePlaybackByDeltaMs: SimulationContract["actions"]["advancePlaybackByDeltaMs"] = async (deltaMs) => {
    if (this.state.runningState !== "start" || !Number.isFinite(deltaMs) || deltaMs <= 0) {
      return;
    }
    const topology = this.topologyStore.getSnapshot();
    if (topology === null) return;
    this.playbackRemainderTicks += deltaMs / 1000
      * topology.standardTickRate
      * this.state.simulationSpeed;
    const wholeTicks = Math.floor(this.playbackRemainderTicks);
    if (wholeTicks <= 0) return;
    this.playbackRemainderTicks -= wholeTicks;
    this.playbackTargetTickNumber = Math.max(
      this.playbackTargetTickNumber,
      this.projection?.tickNumber ?? 0,
    ) + wholeTicks;
    const activeTopologyRefresh = this.topologyRefreshQueue;
    if (activeTopologyRefresh !== null) {
      await activeTopologyRefresh;
      if (this.state.runningState !== "start") return;
    }
    if (this.playbackAdvanceInFlight === null) {
      const drain = this.drainPlaybackAdvances();
      const tracked = drain.finally(() => {
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
    await this.bridge.sendCommands([{ type: "patch-runtime-slot", patch }]);
    await this.syncToTick(this.projection.tickNumber ?? 0);
  };

  public readonly resetAdmissionCounter: SimulationContract["actions"]["resetAdmissionCounter"] = async (reset) => {
    if (this.state.runningState === "stop" || this.projection === null) return;
    const activeTopologyRefresh = this.topologyRefreshQueue;
    if (activeTopologyRefresh !== null) await activeTopologyRefresh;
    await this.bridge.sendCommands([{ type: "reset-admission-counter", reset }]);
    await this.syncToTick(this.projection.tickNumber ?? 0);
  };

  public readonly enableTimeline: SimulationContract["actions"]["enableTimeline"] = async () => {
    if (this.state.simulationMode !== "single-base") return;
    if (!this.state.hasStarted) await this.start();
    const currentTimelineTick = Math.max(
      0,
      Math.floor(
        (this.primaryTickNumber - DENSE_TIMELINE_ORIGIN_STANDARD_TICK)
        / DENSE_TIMELINE_STEP_STANDARD_TICKS,
      ),
    );
    runInAction(() => {
      this.state.timeline = {
        enabled: true,
        readiness: "ready",
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
        + timelineTickNumber * DENSE_TIMELINE_STEP_STANDARD_TICKS;
      const response = await this.bridge.requestPresentationCheckpoint(standardTickNumber);
      this.projection?.replaceCheckpoint(response.delta);
      this.timelinePresentationActive = true;
      this.publishProjectionSnapshot();
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
    this.assertNotDisposed();
    if (this.state.simulationMode === SIMULATION_MODE.regionalMultiBase) {
      if (this.regionalSession !== null) {
        const document = this.workspace.editor?.document.getSnapshot();
        if (document !== undefined) {
          this.sourceDocumentSignature = createDenseSimulationSourceSignature(document);
        }
        const topology = this.topologyStore.getSnapshot();
        return {
          status: "started",
          topologyId: topology?.topologyId ?? null,
          diagnostics: topology?.diagnostics ?? [],
        };
      }
      return this.startRegionalSimulation();
    }
    const activePlaybackAdvance = this.playbackAdvanceInFlight;
    if (activePlaybackAdvance !== null) {
      await activePlaybackAdvance;
    }
    const document = this.workspace.editor?.document.getSnapshot();
    if (document === undefined) {
      return this.failStart("Simulation cannot start before editor document is available.");
    }

    try {
      const topology = compileSimulationTopology({
        document,
        registry: this.workspace.registry,
        poweredEntityIds: computePoweredEntityIds(document, this.workspace.registry),
        simulationMode: this.state.simulationMode,
        activeActivityIds: this.options.getActiveActivityIds?.() ?? [],
      });
      const compileError = topology.diagnostics.find((diagnostic) => diagnostic.severity === "error");
      if (compileError !== undefined) {
        return this.failRefresh(compileError.message, topology.diagnostics);
      }

      const previousTopology = this.topologyStore.getSnapshot();
      const migration = this.compiledDocument === null
        || previousTopology === null
        || this.projection === null
        ? null
        : createSimulationTopologyMigration({
            previousDocument: this.compiledDocument,
            nextDocument: document,
            previousTopology,
            nextTopology: topology,
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
          document,
          topology,
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
          document,
          topology,
        });
      }
      const { identity: session, response } = initialized;
      const projection = new DenseProjectionStore(response.layout.dictionary, session);
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
      this.playbackTargetTickNumber = migrationApplied
        ? Math.max(this.playbackTargetTickNumber, response.initialDelta.tickNumber)
        : response.initialDelta.tickNumber;
      this.timelinePresentationActive = false;
      this.compiledDocument = cloneWorldDocument(document);
      this.sourceDocumentSignature = createDenseSimulationSourceSignature(document);
      this.topologyStore.setSnapshot(topology);
      this.publishProjectionSnapshot();
      runInAction(() => {
        this.state.hasStarted = true;
        this.state.currentPlaybackTickNumber = response.initialDelta.tickNumber;
        this.state.runtimeStatus = {
          mode: "running",
          topologyId: topology.topologyId,
          documentHash: topology.documentHash,
          retainedFromTick: response.initialDelta.tickNumber,
          latestTickNumber: response.initialDelta.tickNumber,
          bufferSize: 1,
          maxBufferSize: 1,
          dynamicTickRate: topology.standardTickRate,
          error: null,
        };
      });
      return {
        status: "started",
        topologyId: topology.topologyId,
        diagnostics: topology.diagnostics,
      };
    } catch (error) {
      return this.failStart(error instanceof Error ? error.message : String(error));
    }
  };

  private async initializeDenseTopology(options: {
    readonly document: WorldDocument;
    readonly topology: CompiledSimulationTopology;
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
      ...(options.migration === undefined ? {} : { migration: options.migration }),
    });
    return { identity, response };
  }

  public readonly syncToTick: SimulationInternalAction["syncToTick"] = async (tickNumber) => {
    this.assertNotDisposed();
    const activeTopologyRefresh = this.topologyRefreshQueue;
    if (activeTopologyRefresh !== null) await activeTopologyRefresh;
    if (this.regionalSession !== null) {
      if (tickNumber < (this.projection?.tickNumber ?? 0)) {
        return createNotFoundTickStatus(tickNumber);
      }
      await this.advanceRegionalPresentationToTick(tickNumber);
      return {
        status: "ready",
        retainedFromTick: 0,
        latestTickNumber: Math.max(tickNumber, this.latestRegionalBufferedTick()),
        bufferSize: this.regionalPlaybackDeltas.size + 1,
      };
    }
    const projection = this.projection;
    if (projection === null) {
      return createNotFoundTickStatus(tickNumber);
    }

    try {
      const response = await this.bridge.advanceToTick(tickNumber, Number.MAX_SAFE_INTEGER);
      projection.apply(response.delta);
      this.primaryTickNumber = response.delta.tickNumber;
      this.timelinePresentationActive = false;
      this.publishProjectionSnapshot();
      runInAction(() => {
        this.state.currentPlaybackTickNumber = tickNumber;
        this.state.runtimeStatus = {
          ...this.state.runtimeStatus,
          retainedFromTick: 0,
          latestTickNumber: response.delta.tickNumber,
          bufferSize: 1,
        };
      });
      return {
        status: "ready",
        retainedFromTick: 0,
        latestTickNumber: response.delta.tickNumber,
        bufferSize: 1,
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
    if (this.projection !== null && this.regionalSession === null) {
      this.sendCommands([{ type: "reset" }]);
    }
    this.disposeRegionalSession();
    this.projection = null;
    this.playbackRemainderTicks = 0;
    this.playbackTargetTickNumber = 0;
    this.playbackAdvanceInFlight = null;
    this.primaryTickNumber = 0;
    this.compiledDocument = null;
    this.sourceDocumentSignature = null;
    this.timelinePresentationActive = false;
    this.topologyStore.setSnapshot(null);
    this.state.runningState = "stop";
    this.state.hasStarted = false;
    this.state.currentSnapshot = null;
    this.state.currentPlaybackTickNumber = 0;
    this.state.runtimeStatus = createInitialSimulationRuntimeStatus();
    this.state.statistics = {
      tickPerSecond: 0,
      targetTickPerSecond: 0,
      baseBatteryJoules: 0,
      baseBatteryCapacity: 0,
    };
  });

  public dispose(): void {
    if (this.disposed) return;
    this.reset();
    this.bridge.dispose();
    this.disposed = true;
  }

  private async startRegionalSimulation(): Promise<SimulationStartResult> {
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
    if (regionBases.length < 2) {
      return this.failRegionalStart(
        `区域 ${currentBase.tag} 至少需要两个基地才能启动多基地仿真。`,
        {
          code: "insufficient-regional-bases",
          currentBaseId: sourceDocument.baseId,
          regionBaseCount: regionBases.length,
          regionTag: currentBase.tag,
        },
      );
    }
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
      const documents = regionBases.map((definition, index) =>
        appendBaseBuiltinEntities({
          document: definition.id === sourceDocument.baseId
            ? sourceDocument
            : (latestDocuments[index] ?? sourceDocument),
          workspace: this.workspace,
        })
      );
      const regionalResources = normalizeRegionalResources(
        this.options.getRegionalResourceSettings?.(currentBase.tag) ?? [],
      );
      startStage = "compile-topologies";
      const topologies = documents.map((document, regionBaseOrderIndex) => ({
        baseId: document.baseId,
        regionBaseOrderIndex,
        topology: compileSimulationTopology({
          document,
          registry: this.workspace.registry,
          poweredEntityIds: computePoweredEntityIds(document, this.workspace.registry),
          simulationMode: SIMULATION_MODE.regionalMultiBase,
          activeActivityIds: this.options.getActiveActivityIds?.() ?? [],
          regionalResources,
        }),
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
      startStage = "validate-warehouse-admission";
      const admission = buildRegionalWarehouseOutletTable({
        registry: this.workspace.registry,
        topologies,
      });
      if (!admission.ok || admission.table === null) {
        return this.failRegionalStart(
          admission.diagnostics.map((diagnostic) => diagnostic.message).join("\n"),
          {
            code: "regional-warehouse-admission-failed",
            currentBaseId: sourceDocument.baseId,
            diagnostics: admission.diagnostics,
          },
        );
      }

      this.disposeRegionalSession();
      this.topologyVersion += 1;
      startStage = "initialize-workers";
      const created = await DenseRegionalSimulationSession.create({
        sessionId: `dense-regional-${nextDenseSessionId}`,
        currentBaseId: sourceDocument.baseId,
        table: admission.table,
        bases: topologies.map((input) => {
          const document = documents.find((candidate) => candidate.baseId === input.baseId)!;
          return {
            baseId: input.baseId,
            topology: input.topology,
            powerMode: document.documentSettings.powerMode ?? "infinite",
            powerConsumptionOverride: normalizePowerConsumptionOverride(
              document.documentSettings.powerConsumptionOverride,
            ),
          };
        }),
        registry: this.workspace.registry,
        workerMode: this.options.workerMode ?? "auto",
      });
      nextDenseSessionId += 1;
      this.regionalSession = created.session;
      this.projection = created.currentBasePresentationProjection;
      this.primaryTickNumber = 0;
      this.playbackTargetTickNumber = 0;
      this.timelinePresentationActive = false;
      this.compiledDocument = null;
      this.sourceDocumentSignature = createDenseSimulationSourceSignature(sourceDocument);
      const currentTopology = topologies.find(
        (input) => input.baseId === sourceDocument.baseId,
      )?.topology ?? null;
      this.topologyStore.setSnapshot(currentTopology);
      this.regionalWarehouseStats = createInitialRegionalWarehouseStats(
        currentTopology?.regionalResourceSupply,
      );
      this.publishProjectionSnapshot();
      startStage = "commit-first-epoch";
      await this.fillOneRegionalEpoch();
      runInAction(() => {
        this.state.hasStarted = true;
        this.state.runningState = "start";
        this.state.currentPlaybackTickNumber = 0;
        this.state.runtimeStatus = {
          mode: "running",
          topologyId: currentTopology?.topologyId ?? null,
          documentHash: currentTopology?.documentHash ?? null,
          retainedFromTick: 0,
          latestTickNumber: this.latestRegionalBufferedTick(),
          bufferSize: this.regionalPlaybackDeltas.size + 1,
          maxBufferSize: 20,
          dynamicTickRate: currentTopology?.standardTickRate ?? null,
          error: null,
        };
      });
      logger.info("Dense regional simulation started.", {
        currentBaseId: sourceDocument.baseId,
        regionTag: currentBase.tag,
        regionalBaseIds,
        latestTickNumber: this.latestRegionalBufferedTick(),
      });
      return {
        status: "started",
        topologyId: currentTopology?.topologyId ?? null,
        diagnostics: currentTopology?.diagnostics ?? [],
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

  private failRegionalStart(
    message: string,
    context: Readonly<Record<string, unknown>>,
  ): SimulationStartResult {
    logger.error("Dense regional simulation start rejected.", {
      ...context,
      error: message,
    });
    this.disposeRegionalSession();
    runInAction(() => {
      this.state.runningState = "stop";
    });
    return this.failStart(message);
  }

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

  private async drainPlaybackAdvances(): Promise<void> {
    while (this.state.runningState === "start") {
      const currentTickNumber = this.projection?.tickNumber ?? 0;
      const targetTickNumber = this.playbackTargetTickNumber;
      if (targetTickNumber <= currentTickNumber) return;
      if (this.regionalSession !== null) {
        await this.advanceRegionalPresentationToTick(targetTickNumber);
      } else {
        await this.syncToTick(targetTickNumber);
      }
    }
  }

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
    this.publishProjectionSnapshot();
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

  private publishProjectionSnapshot(): void {
    const projection = this.projection;
    if (projection === null) return;
    const snapshot = this.options.workerMode === "runtime"
      ? projection.materializeSnapshot()
      : null;
    runInAction(() => {
      // runtime 模式只供 engine/Blueprint 测试使用；browser dense 路径不物化 legacy snapshot。
      this.state.currentSnapshot = snapshot;
      this.state.statistics = {
        tickPerSecond: 0,
        targetTickPerSecond: 0,
        baseBatteryJoules: projection.batteryJoules,
        baseBatteryCapacity: projection.batteryCapacity,
      };
    });
  }

  private failStart(
    message: string,
    diagnostics: SimulationStartResult["diagnostics"] = [],
  ): SimulationStartResult {
    this.projection = null;
    this.compiledDocument = null;
    this.sourceDocumentSignature = null;
    this.topologyStore.setSnapshot(null);
    runInAction(() => {
      this.state.hasStarted = false;
      this.state.currentSnapshot = null;
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
      runInAction(() => {
        this.state.runtimeStatus = {
          ...this.state.runtimeStatus,
          mode: "error",
          error: error instanceof Error ? error.message : String(error),
        };
      });
    });
  }

  private async restorePrimaryProjection(): Promise<void> {
    try {
      const response = await this.bridge.requestPresentationCheckpoint(this.primaryTickNumber);
      this.projection?.replaceCheckpoint(response.delta);
      this.timelinePresentationActive = false;
      this.publishProjectionSnapshot();
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
}

function createDenseQueries(
  controller: DenseSimulationController,
): SimulationContract["queries"] {
  let cachedTopology: CompiledSimulationTopology | null = null;
  let cachedShareCapSlotIds: Set<string> | null = null;
  return {
    getStatusRuntimeJson: () => {
      const projection = controller.currentProjection;
      const state = controller.simulationState;
      return JSON.stringify({
        state: {
          runningState: state.runningState,
          simulationSpeed: state.simulationSpeed,
          currentPlaybackTickNumber: state.currentPlaybackTickNumber,
        },
        runtimeStatus: state.runtimeStatus,
        currentTick: projection?.tickNumber === null || projection === null
          ? null
          : {
              tickNumber: projection.tickNumber,
              status: projection.status,
              totalPowerDemand: projection.totalPowerDemand,
              transferCount: projection.getTransfers().length,
              diagnosticCount: projection.getDiagnostics().length,
              ...(projection.debugData === undefined
                ? {}
                : { debugData: projection.debugData }),
            },
      });
    },
    getDocumentRuntimeStatus: () => {
      const projection = controller.currentProjection;
      const topology = controller.currentTopology;
      const state = controller.simulationState;
      if (projection === null || topology === null) return null;
      return {
        tickNumber: projection.tickNumber,
        totalPowerDemand: state.regionalTotalPowerDemand
          ?? controller.currentPowerConsumptionOverride
          ?? projection.totalPowerDemand,
        currentPowerGeneration: projection.currentPowerGeneration,
        isPowerOutage: projection.isPowerOutage,
      };
    },
    getDeviceRuntimeStatus: (deviceId) => {
      const topology = controller.currentTopology;
      if (topology !== cachedTopology) {
        cachedTopology = topology;
        cachedShareCapSlotIds = topology === null ? null : resolveShareCapSlotIds(topology);
      }
      return createDenseDeviceStatus(controller, deviceId, cachedShareCapSlotIds);
    },
    getPipeFluidItemId: (deviceId) => resolveDensePipeFluidItemId(controller, deviceId),
    isPipeDeviceSlotOccupied: (deviceId) => isDensePipeDeviceSlotOccupied(
      controller,
      deviceId,
    ),
    getActiveGasDiffusionRanges: () =>
      controller.currentProjection?.getGasDiffusions().map((diffusion) => ({
        sourceDeviceId: diffusion.sourceDeviceId,
        gasItemId: diffusion.gasItemId,
        gridRect: { ...diffusion.gridRect },
      })) ?? [],
    getDeviceActiveGasItemIds: (deviceId) => {
      const topology = controller.currentTopology;
      const projection = controller.currentProjection;
      if (topology === null || projection === null || projection.tickNumber === null) return null;
      const diffusions = projection.getGasDiffusions();
      if (diffusions.length === 0) return null;
      const compiledDeviceId = resolveCompiledDeviceId(topology, deviceId);
      if (compiledDeviceId === null) return null;
      const itemIds = buildDeviceGasCoverage(topology, diffusions).get(compiledDeviceId);
      return itemIds === undefined ? null : [...itemIds];
    },
    getWarehouseStats: (): WarehouseStatsReadModel | null => {
      const warehouseStats = controller.currentWarehouseStats;
      if (warehouseStats === null) return null;
      return {
        items: Object.fromEntries(
          Object.entries(warehouseStats.items).map(([itemId, value]) => [
            itemId,
            { ...value },
          ]),
        ),
        statsWindowReady: warehouseStats.statsWindowReady,
      };
    },
  };
}

function createDenseDeviceStatus(
  controller: DenseSimulationController,
  sourceDeviceId: string,
  shareCapSlotIds: ReadonlySet<string> | null,
): SimulationDeviceRuntimeStatusReadModel | null {
  const topology = controller.currentTopology;
  const projection = controller.currentProjection;
  if (topology === null || projection === null) return null;
  const compiledDeviceId = resolveCompiledDeviceId(topology, sourceDeviceId);
  if (compiledDeviceId === null) return null;
  const runtimeDevice = projection.getDevice(compiledDeviceId);
  const device = topology.devices[compiledDeviceId];
  if (runtimeDevice === null || device === undefined) return null;

  const channelRecipes: Record<
    string,
    SimulationDeviceRuntimeChannelRecipeStatus | null
  > = {};
  for (const [channelId, recipe] of Object.entries(runtimeDevice.channelRecipes)) {
    channelRecipes[channelId] = recipe === null
      ? null
      : {
          channelId,
          recipeId: recipe.recipeId,
          progressSeconds: convertSimulationTicksToSeconds(recipe.progressTicks),
          desiredSeconds: convertSimulationTicksToSeconds(recipe.durationTicks),
          state: recipe.state,
        };
  }

  const slotItemsByRealSlotKey = new Map<
    string,
    SimulationDeviceRuntimeSlotItemReadModel
  >();
  for (const nodeId of device.nodeIds) {
    const node = topology.nodes[nodeId];
    if (node === undefined) continue;
    for (const slotId of node.slotIds) {
      const slot = topology.slots[slotId];
      const value = projection.getSlot(slotId);
      if (slot === undefined || value === null) continue;
      const isShareCapSlot = shareCapSlotIds?.has(slotId) === true;
      const storageGroupId = slot.sourceStorageSlotGroupId ?? "synthetic";
      const sourceSlotId = slot.sourceSlotId ?? slot.id;
      const key = isShareCapSlot ? slotId : `${storageGroupId}:${sourceSlotId}`;
      const existing = slotItemsByRealSlotKey.get(key);
      slotItemsByRealSlotKey.set(key, {
        storageGroupId,
        slotId: sourceSlotId,
        viewRole: isShareCapSlot ? node.viewRole : "single-view",
        itemType: existing?.itemType ?? value.itemType,
        count: Math.max(existing?.count ?? 0, value.count),
        reserved: Math.max(existing?.reserved ?? 0, value.reserved),
        ignoreStock: (existing?.ignoreStock ?? false) || value.ignoreStock,
      });
    }
  }
  return {
    channelRecipes,
    admissionCounters: Object.fromEntries(
      Object.entries(runtimeDevice.admissionCounters ?? {}).map(([portRef, counter]) => {
        const windowTicks = topology.standardTickRate * 10;
        const currentTickNumber = projection.tickNumber ?? 0;
        const currentWindowStartTick = topology.standardTickRate > 0
          ? 1 + Math.floor(Math.max(0, currentTickNumber - 1) / windowTicks) * windowTicks
          : 1;
        const cutoff = currentTickNumber - topology.standardTickRate * 60;
        const oldestWindowStart = currentWindowStartTick
          - ADMISSION_RATE_WINDOWS_PER_MINUTE * windowTicks;
        const earliestFullWindowStart = currentWindowStartTick
          - (ADMISSION_RATE_WINDOWS_PER_MINUTE - 1) * windowTicks;
        const oldestPartial = (counter.moveTicks ?? []).reduce(
          (sum, tick) => tick >= oldestWindowStart
            && tick < earliestFullWindowStart
            && tick > cutoff
            ? sum + 1
            : sum,
          0,
        );
        const fullWindowsSum = counter.pastWindowCounts
          .slice(1)
          .reduce((sum, count) => sum + count, 0);
        return [portRef, {
          portGroupId: counter.portGroupId,
          portId: counter.portDefinitionId,
          itemType: counter.itemId,
          limit: counter.limit,
          count: counter.count,
          perMinuteLimit: counter.perMinuteLimit,
          rateWindowCount: counter.rateWindowCount,
          oneMinuteCount: oldestPartial + fullWindowsSum + counter.rateWindowCount,
        }] as const;
      }),
    ),
    powerStatus: device.powerStatus,
    slotItems: [...slotItemsByRealSlotKey.values()],
  };
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

function resolveCompiledDeviceId(
  topology: CompiledSimulationTopology,
  deviceId: string,
): string | null {
  if (topology.devices[deviceId] !== undefined) return deviceId;
  const directCompiledId = `device:${deviceId}`;
  if (topology.devices[directCompiledId] !== undefined) return directCompiledId;
  return topology.ordering.deviceOrder.find((compiledDeviceId) =>
    topology.devices[compiledDeviceId]?.sourceEntityId === deviceId
  ) ?? null;
}

function resolveShareCapSlotIds(topology: CompiledSimulationTopology): Set<string> {
  return new Set(
    Object.values(topology.links)
      .filter((link) => link.linkType === "share-cap")
      .flatMap((link) => [...link.sourceSlotIds, ...link.targetSlotIds]),
  );
}

function resolveDensePipeFluidItemId(
  controller: DenseSimulationController,
  deviceId: string,
): string | null {
  const topology = controller.currentTopology;
  const projection = controller.currentProjection;
  if (
    controller.simulationState.runningState === "stop"
    || topology === null
    || projection === null
    || projection.tickNumber === null
  ) {
    return null;
  }
  const compiledDeviceId = resolveCompiledDeviceId(topology, deviceId);
  if (compiledDeviceId === null) return null;
  const device = topology.devices[compiledDeviceId];
  if (device === undefined || device.transportClass !== "strict-pipe") return null;
  return device.transportComponentId === null
    ? null
    : projection.getTransportComponentItemType(device.transportComponentId);
}

function isDensePipeDeviceSlotOccupied(
  controller: DenseSimulationController,
  deviceId: string,
): boolean {
  const topology = controller.currentTopology;
  const projection = controller.currentProjection;
  if (
    controller.simulationState.runningState === "stop"
    || topology === null
    || projection === null
    || projection.tickNumber === null
  ) {
    return false;
  }
  const compiledDeviceId = resolveCompiledDeviceId(topology, deviceId);
  if (compiledDeviceId === null) return false;
  const device = topology.devices[compiledDeviceId];
  if (device === undefined || device.transportClass !== "strict-pipe") return false;
  return device.nodeIds.some((nodeId) =>
    topology.nodes[nodeId]?.slotIds.some((slotId) => {
      const slot = projection.getSlot(slotId);
      return slot !== null && slot.itemType !== null;
    }) === true
  );
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

function cloneWorldDocument(document: WorldDocument): WorldDocument {
  return JSON.parse(JSON.stringify(document)) as WorldDocument;
}

function computePoweredEntityIds(
  document: WorldDocument,
  registry: WorkspaceContract["registry"],
): Set<string> {
  const definitionById = new Map(
    registry.entityDefinitions.map((definition) => [definition.id, definition]),
  );
  const entities = resolveOrderedDocumentEntities(document);
  const powerRangeRects = entities.flatMap((entity) => {
    const definition = definitionById.get(entity.definitionId);
    if (definition === undefined) return [];
    const gridRect = resolvePowerRangeGridRect({ entity, definition });
    return gridRect === null ? [] : [gridRect];
  });
  if (powerRangeRects.length === 0) return new Set();

  return new Set(entities.flatMap((entity) => {
    const definition = definitionById.get(entity.definitionId);
    if (definition === undefined) return [];
    const entityGridRect = resolveEntityGridRect({ entity, definition });
    return powerRangeRects.some((powerRangeRect) =>
      areGridRectsIntersecting(entityGridRect, powerRangeRect)
    ) ? [entity.id] : [];
  }));
}

function resolveOrderedDocumentEntities(document: WorldDocument): WorldEntity[] {
  return document.entityOrder.flatMap((entityId) => {
    const entity = document.entities[entityId];
    return entity === undefined ? [] : [entity];
  });
}

function appendBaseBuiltinEntities(options: {
  readonly document: WorldDocument;
  readonly workspace: WorkspaceContract;
}): WorldDocument {
  const builtinEntities = resolveBaseBuiltinEntities({
    baseDefinitions: options.workspace.registry.baseDefinitions,
    baseId: options.document.baseId,
  });
  if (builtinEntities.length === 0) return options.document;
  const builtinIds = new Set(builtinEntities.map((entity) => entity.id));
  return {
    ...options.document,
    entities: {
      ...options.document.entities,
      ...Object.fromEntries(builtinEntities.map((entity) => [entity.id, entity])),
    },
    entityOrder: [
      ...builtinEntities.map((entity) => entity.id),
      ...options.document.entityOrder.filter((entityId) => !builtinIds.has(entityId)),
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

function createInitialRegionalWarehouseStats(
  supply: CompiledRegionalResourceSupply | undefined,
): WarehouseStats {
  const items: Record<string, {
    producedPerMinute: number;
    consumedPerMinute: number;
    warehouseCount: number;
    infinite: boolean;
    lastChangedTick: number;
  }> = {};
  for (const itemId of supply?.infiniteItemIds ?? []) {
    items[itemId] = {
      producedPerMinute: 0,
      consumedPerMinute: 0,
      warehouseCount: 0,
      infinite: true,
      lastChangedTick: 0,
    };
  }
  for (const [itemId, perMinute] of Object.entries(
    supply?.finitePerMinuteByItemId ?? {},
  )) {
    const current = items[itemId];
    items[itemId] = {
      producedPerMinute: perMinute,
      consumedPerMinute: current?.consumedPerMinute ?? 0,
      warehouseCount: current?.warehouseCount ?? 0,
      infinite: current?.infinite ?? false,
      lastChangedTick: current?.lastChangedTick ?? 0,
    };
  }
  return { items, statsWindowReady: false };
}
