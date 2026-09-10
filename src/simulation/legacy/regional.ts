import { runInAction } from "mobx";

import type { WorkspaceContract } from "@/domain/document/workspace-contract";

import { SIMULATION_MODE } from "@/domain/shared/simulation-mode";

import type { SnapshotStoreReadWrite } from "@/shared/snapshot/snapshot-store";

import { compileSimulationTopology } from "../topology";
import { appendSimulationBaseBuiltinEntities, prepareCurrentSimulationDocument } from "../topology";

import type {
  CompiledRegionalResourceSupply,
  CompiledSimulationTopology,
  RuntimeTickSnapshot,
  RegionalResourceSupplySetting,
} from "../contracts";

import {
  aggregateRegionalWarehouseStats as aggregateRegionalWarehouseStatsCore,
  buildRegionalWarehouseOutletTable,
} from "../regional";
import { createBrowserRegionalSessionPorts, type RegionalWorkerBridge } from "./regional-worker-port";
import {
  LocalRegionalBasePort,
  RegionalSimulationSession,
  type RegionalAuthorityPort,
  type RegionalBasePort,
  type RegionalBaseTopologyInput,
} from "./regional-session";

import type { LegacyPresentationState } from "./state";
import type { SimulationStateReadWrite } from "../contracts";

import { LegacyPlaybackController } from "./playback";
// AI-REMOVED 2026-09-09:
// Reason: 明确状态归属并清理重组产生的重复声明。
// Trigger: Host / legacy 控制器重构。
// Evidence: 公共 Query 与子控制器已接管对应职责，原 import 或状态入口不再需要。
// Replacement: 本文件中的 LegacyRegionalController 声明
// Risk: Low
// Human Review: Required
// Original code:
// import { LegacyRegionalController } from "./regional";

import {
  PLAYBACK_HOT_QUEUE_CAPACITY,
  PLAYBACK_HOT_QUEUE_LOW_WATER,
  logger,
  computePoweredEntityIds,
  normalizeActiveActivityIds,
  normalizeRegionalResourceSettings,
} from "./controller-support";

function aggregateRegionalWarehouseStats(
  baseSnapshots: readonly RuntimeTickSnapshot[],
  authorityCounts: Readonly<Record<string, number>>,
  supply: CompiledRegionalResourceSupply | undefined,
): NonNullable<RuntimeTickSnapshot["warehouseStats"]> {
  return aggregateRegionalWarehouseStatsCore({
    baseSnapshots,
    authorityCounts,
    supply,
  });
}

interface LegacyRegionalContext {
  readonly workspace: WorkspaceContract;
  readonly stateReadWrite: SimulationStateReadWrite;
  readonly presentation: LegacyPresentationState;
  readonly topology: SnapshotStoreReadWrite<CompiledSimulationTopology | null>;
  readonly getRegionalResourceSettings: ((regionTag: string) => readonly RegionalResourceSupplySetting[]) | undefined;
  readonly getActiveActivityIds: (() => readonly string[]) | undefined;
  readonly regionalWorkerMode: "auto" | "runtime";
  readonly playback: LegacyPlaybackController;
  recoverFromStartFailure(error?: unknown): void;
}

export class LegacyRegionalController {
  public constructor(private readonly context: LegacyRegionalContext) {}

  public get active(): boolean { return this.regionalSession !== null; }
  public pause(): void { this.regionalSessionPaused = true; }
  public resume(): void {
    this.regionalSessionPaused = false;
    this.ensureRegionalSessionLoop();
  }

  // AI-REMOVED 2026-08-19:
  // Reason: 区域多基地开关必须由 SimulationState.simulationMode 作为唯一事实来源，不能在 Action 内另存一份状态。
  // Trigger: 用户要求编辑态也能观察模式，并要求所有行为从显式 SimulationMode 派生。
  // Evidence: App 状态、Action 私有字段和编译上下文此前各自推断模式，存在停止态不可观察与状态漂移风险。
  // Replacement: SimulationStateReadWrite.simulationMode。
  // Risk: Low
  // Human Review: Required
  //
  // Original code:
  // private regionalMultiBaseEnabled = false;
  private regionalSession: RegionalSimulationSession | null = null;

  private regionalSessionBridges: readonly RegionalWorkerBridge[] = [];

  private regionalSessionGeneration = 0;

  private regionalSessionLoop: Promise<void> | null = null;

  private regionalSessionPaused = false;

  private regionalSessionStopped = false;

  private regionalPreviousWarehouseCounts: Readonly<Record<string, number>> = {};

  private regionalPreviousBaseSnapshots: readonly RuntimeTickSnapshot[] = [];

  public async startRegionalSimulation(): Promise<void> {
    const sourceDocument = this.context.workspace.editor?.document.getSnapshot();
    if (sourceDocument === undefined) {
      runInAction(() => {
        this.context.stateReadWrite.runtimeStatus = {
          ...this.context.stateReadWrite.runtimeStatus,
          mode: "error",
          error: "Simulation cannot start before editor document is available.",
        };
      });
      logger.error("Regional simulation start rejected.", {
        code: "editor-document-unavailable",
        error: this.context.stateReadWrite.runtimeStatus.error,
      });
      this.context.recoverFromStartFailure();
      return;
    }

    const baseDefinitions = this.context.workspace.registry.baseDefinitions;
    const currentBase = baseDefinitions.find((definition) => definition.id === sourceDocument.baseId);
    if (currentBase === undefined) {
      runInAction(() => {
        this.context.stateReadWrite.runtimeStatus = {
          ...this.context.stateReadWrite.runtimeStatus,
          mode: "error",
          error: `Unknown current base "${sourceDocument.baseId}".`,
        };
      });
      logger.error("Regional simulation start rejected.", {
        code: "unknown-current-base",
        currentBaseId: sourceDocument.baseId,
        error: this.context.stateReadWrite.runtimeStatus.error,
      });
      this.context.recoverFromStartFailure();
      return;
    }

    const regionDefinitions = baseDefinitions.filter((definition) => definition.tag === currentBase.tag);
    if (regionDefinitions.length > 5) {
      runInAction(() => {
        this.context.stateReadWrite.runtimeStatus = {
          ...this.context.stateReadWrite.runtimeStatus,
          mode: "error",
          error: `区域 ${currentBase.tag} 包含 ${regionDefinitions.length} 个基地，超过 5 个上限。`,
        };
      });
      logger.error("Regional simulation start rejected.", {
        code: "regional-base-limit-exceeded",
        currentBaseId: sourceDocument.baseId,
        regionBaseCount: regionDefinitions.length,
        regionTag: currentBase.tag,
        error: this.context.stateReadWrite.runtimeStatus.error,
      });
      this.context.recoverFromStartFailure();
      return;
    }

    const editor = this.context.workspace.editor;
    if (regionDefinitions.length <= 1 || editor === null) {
      // AI-REMOVED 2026-08-19:
      // Reason: regional-multi-base 模式不能静默降级为 single-base，否则 registry 行为与用户选择的模式不一致。
      // Trigger: 用户要求 SimulationMode 显式传入 Simulation，并成为设备行为选择的唯一依据。
      // Evidence: 原分支调用 refreshFromCurrentDocument，会在多基地模式选中时编译单基地语义。
      // Replacement: 当前 fail-fast 错误分支；只有具备编辑器和至少两个同区域基地时才能启动区域仿真。
      // Risk: Low - 原先的退化启动现在会明确失败。
      // Human Review: Required
      //
      // Original code:
      // // 单基地继续走现有快速路径，不创建退化区域屏障。
      // const result = await this.refreshFromCurrentDocument();
      // if (result.status === "started") {
      //   runInAction(() => {
      //     this.stateReadWrite.runningState = "start";
      //   });
      //   this.ensurePlaybackHotQueue();
      // } else {
      //   this.recoverFromStartFailure();
      // }
      runInAction(() => {
        this.context.stateReadWrite.runtimeStatus = {
          ...this.context.stateReadWrite.runtimeStatus,
          mode: "error",
          error: editor === null
            ? "Regional simulation requires an editor document provider."
            : `区域 ${currentBase.tag} 至少需要两个基地才能启动多基地仿真。`,
        };
      });
      logger.error("Regional simulation start rejected.", {
        code: editor === null ? "editor-unavailable" : "insufficient-regional-bases",
        currentBaseId: sourceDocument.baseId,
        regionBaseCount: regionDefinitions.length,
        regionTag: currentBase.tag,
        error: this.context.stateReadWrite.runtimeStatus.error,
      });
      this.context.recoverFromStartFailure();
      return;
    }

    try {
      const latestDocuments = await editor.queries.readLatestBaseDocuments(
        regionDefinitions.map((definition) => definition.id),
      );
      const currentCompiledDocument = prepareCurrentSimulationDocument({
        document: sourceDocument,
        workspace: this.context.workspace,
      });
      const documents = regionDefinitions.map((definition, index) => {
        if (definition.id === sourceDocument.baseId) {
          return currentCompiledDocument;
        }
        const latest = latestDocuments[index] ?? currentCompiledDocument;
        return appendSimulationBaseBuiltinEntities({
          document: latest,
          workspace: this.context.workspace,
        });
      });

      const registry = this.context.workspace.registry;
      const regionalResources = this.context.getRegionalResourceSettings === undefined
        ? undefined
        : normalizeRegionalResourceSettings(this.context.getRegionalResourceSettings(currentBase.tag));
      const topologies: RegionalBaseTopologyInput[] = documents.map((document, index) => ({
        baseId: document.baseId,
        regionBaseOrderIndex: index,
        topology: compileSimulationTopology({
          document,
          registry,
          simulationMode: SIMULATION_MODE.regionalMultiBase,
          poweredEntityIds: computePoweredEntityIds({ document, registry }),
          activeActivityIds: normalizeActiveActivityIds(this.context.getActiveActivityIds?.() ?? []),
          regionalResources,
        }),
      }));
      const compileFailure = topologies.flatMap((input) =>
        input.topology.diagnostics.map((diagnostic) => ({ input, diagnostic })))
        .find(({ diagnostic }) => diagnostic.severity === "error");
      if (compileFailure !== undefined) {
        runInAction(() => {
          this.context.stateReadWrite.runtimeStatus = {
            ...this.context.stateReadWrite.runtimeStatus,
            mode: "error",
            error: compileFailure.diagnostic.message,
          };
        });
        logger.error("Regional simulation topology compilation failed.", {
          baseId: compileFailure.input.baseId,
          diagnostic: compileFailure.diagnostic,
        });
        this.context.recoverFromStartFailure();
        return;
      }

      const admission = buildRegionalWarehouseOutletTable({ registry, topologies });
      if (!admission.ok || admission.table === null) {
        runInAction(() => {
          this.context.stateReadWrite.runtimeStatus = {
            ...this.context.stateReadWrite.runtimeStatus,
            mode: "error",
            error: admission.diagnostics.map((diagnostic) => diagnostic.message).join("\n"),
          };
        });
        logger.error("Regional simulation start rejected.", {
          code: "regional-warehouse-admission-failed",
          currentBaseId: sourceDocument.baseId,
          regionTag: currentBase.tag,
          diagnostics: admission.diagnostics,
          error: this.context.stateReadWrite.runtimeStatus.error,
        });
        this.context.recoverFromStartFailure();
        return;
      }

      this.disposeRegionalSession();
      const currentBaseId = sourceDocument.baseId;
      const expectedBaseIds = topologies.map((input) => input.baseId);
      const initialWarehouseCounts: Record<string, number> = {};
      const currentSpeed = this.context.stateReadWrite.simulationSpeed;
      const currentBaseDynamicTickRate = currentSpeed < 2 ? 20 : 10;
      const backgroundDynamicTickRate = 2;

      let ports: readonly RegionalBasePort[];
      let authorityPort: RegionalAuthorityPort | null = null;
      let bridges: readonly RegionalWorkerBridge[] = [];
      if (this.context.regionalWorkerMode === "runtime" || typeof Worker !== "function") {
        ports = topologies.map((input) => new LocalRegionalBasePort({
          registry,
          baseId: input.baseId,
          regionBaseOrderIndex: input.regionBaseOrderIndex,
          topology: input.topology,
          table: admission.table!,
          initialWarehouseCounts,
          isCurrentBase: input.baseId === currentBaseId,
          simulationSpeed: currentSpeed,
          fixedDynamicTickRate: input.baseId === currentBaseId
            ? currentBaseDynamicTickRate
            : backgroundDynamicTickRate,
          advanceMode: input.baseId === currentBaseId ? "per-tick" : "coarse",
        }));
      } else {
        const created = await createBrowserRegionalSessionPorts({
          currentBaseId,
          topologies,
          table: admission.table!,
          expectedBaseIds,
          initialWarehouseCounts,
          currentBaseDynamicTickRate,
          backgroundDynamicTickRate,
        });
        ports = created.ports;
        authorityPort = created.authorityPort;
        bridges = created.bridges;
      }

      this.regionalSessionBridges = bridges;
      this.regionalPreviousWarehouseCounts = initialWarehouseCounts;
      this.regionalSession = new RegionalSimulationSession({
        sessionId: `regional-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`,
        registry,
        topologies,
        table: admission.table!,
        currentBaseId,
        expectedBaseIds,
        initialWarehouseCounts,
        simulationSpeed: currentSpeed,
        currentBaseDynamicTickRate,
        backgroundDynamicTickRate,
      }, ports, authorityPort);
      this.regionalSessionStopped = false;
      this.regionalSessionPaused = false;
      this.context.topology.setSnapshot(topologies.find((input) => input.baseId === currentBaseId)?.topology ?? null);
      this.context.playback.resetPlaybackHotQueue();
      this.context.presentation.currentSnapshot = null;
      this.context.stateReadWrite.currentPlaybackTickNumber = 0;
      this.context.playback.playbackTargetTickNumber = 0;

      // 预填约 18 个稳态 Epoch，让 UI 只消费已经完成区域提交的结果。
      // AI-CORRECTION 2026-08-21: 启动只等待首个已提交 Epoch；后续快照由区域会话异步补充到播放低水位。
      for (let epoch = 0; epoch < 1 && !this.regionalSessionStopped; epoch += 1) {
        const committed = await this.regionalSession.runEpoch(epoch);
        this.enqueueRegionalCommittedEpoch(committed);
      }

      // stop 在预填期间被调用时，clearPlaybackProgress 已复位 runningState 与播放队列，
      // 此处直接退出，不得再覆盖为 "start"。
      if (this.regionalSessionStopped || this.regionalSession === null) {
        return;
      }

      runInAction(() => {
        this.context.stateReadWrite.runningState = "start";
        this.context.stateReadWrite.runtimeStatus = {
          mode: "running",
          topologyId: this.context.topology.getSnapshot()?.topologyId ?? null,
          documentHash: this.context.topology.getSnapshot()?.documentHash ?? null,
          retainedFromTick: this.context.presentation.currentSnapshot?.tickNumber ?? 0,
          latestTickNumber: this.latestRegionalPlaybackTickNumber(),
          bufferSize: this.context.playback.bufferedSize + (this.context.presentation.currentSnapshot === null ? 0 : 1),
          maxBufferSize: PLAYBACK_HOT_QUEUE_CAPACITY,
          dynamicTickRate: currentBaseDynamicTickRate,
          error: null,
        };
      });
      this.ensureRegionalSessionLoop();
    } catch (error) {
      console.error("[RegionalSimulation] Failed to start regional session.", error);
      this.context.recoverFromStartFailure(error);
    }
  }

  // AI-REMOVED 2026-08-28:
  // Reason: 该代码仅服务已归档的 Playwright 区域蓝图 Runner，新 Blueprint Runner 直接驱动区域仿真 session。
  // Trigger: 用户明确要求当前及未来此类用例归入 Blueprint 测试组。
  // Evidence: 该实现包含暂停 UI session、关闭逐 tick 推进和生成测试报告的测试专用流程。
  // Replacement: src/tests/simulation/regional-blueprint-runner.ts#runRegionalBlueprintSimulation
  // Risk: Low；应用原有区域仿真循环未依赖此方法。
  // Human Review: Required
  //
  // Original code:
  // private async syncRegionalToTickNow(
  //   tickNumber: number,
  //   timeoutMs: number,
  // ): Promise<RegionalSimulationTickSyncResult> {
  //   if (!Number.isSafeInteger(tickNumber) || tickNumber < 0) {
  //     throw new Error(`Regional target tick must be a non-negative safe integer; received ${tickNumber}.`);
  //   }
  //   if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
  //     throw new Error(`Regional synchronization timeout must be positive; received ${timeoutMs}.`);
  //   }
  //   if (this.stateReadWrite.simulationMode !== SIMULATION_MODE.regionalMultiBase) {
  //     throw new Error("Regional tick synchronization requires regional-multi-base mode.");
  //   }
  //
  //   const session = this.regionalSession;
  //   if (session === null || this.regionalSessionStopped) {
  //     throw new Error("Regional tick synchronization requires a running regional session.");
  //   }
  //   const previousRunningState = this.stateReadWrite.runningState;
  //   if (previousRunningState !== "start" && previousRunningState !== "pause") {
  //     throw new Error(`Regional session is not ready for synchronization: ${previousRunningState}.`);
  //   }
  //
  //   const deadline = Date.now() + timeoutMs;
  //   let switchedCurrentBaseToCoarse = false;
  //   this.regionalSessionPaused = true;
  //   runInAction(() => {
  //     this.stateReadWrite.runningState = "pause";
  //   });
  //
  //   try {
  //     const activeLoop = this.regionalSessionLoop;
  //     if (activeLoop !== null) {
  //       await waitForRegionalDeadline(
  //         activeLoop,
  //         deadline,
  //         `Timed out while pausing the regional session before tick ${tickNumber}.`,
  //       );
  //     }
  //     if (this.regionalSession !== session || this.regionalSessionStopped) {
  //       throw new Error("Regional session stopped before tick synchronization began.");
  //     }
  //
  //     await waitForRegionalDeadline(
  //       session.setCurrentBaseAdvanceMode("coarse"),
  //       deadline,
  //       `Timed out while enabling coarse regional advance before tick ${tickNumber}.`,
  //     );
  //     switchedCurrentBaseToCoarse = true;
  //
  //     this.resetPlaybackHotQueue();
  //     let committedTickNumber = resolveRegionalCommittedTickNumber(session.nextEpochNumber);
  //     while (committedTickNumber < tickNumber) {
  //       const committed = await waitForRegionalDeadline(
  //         session.runEpoch(session.nextEpochNumber),
  //         deadline,
  //         `Regional session did not reach tick ${tickNumber} within ${timeoutMs}ms.`,
  //       );
  //       if (this.regionalSession !== session || this.regionalSessionStopped) {
  //         throw new Error("Regional session stopped during tick synchronization.");
  //       }
  //
  //       this.regionalPreviousWarehouseCounts = committed.warehouseCounts;
  //       this.regionalPreviousSnapshotsByBaseId = committed.snapshotsByBaseId;
  //       this.regionalPreviousBaseSnapshots = Object.values(committed.snapshotsByBaseId)
  //         .filter((snapshot): snapshot is RuntimeTickSnapshot => snapshot !== null);
  //       committedTickNumber = committed.gateTickNumber;
  //     }
  //
  //     const currentBaseId = session.currentBasePort.baseId;
  //     const currentBaseSnapshot = this.regionalPreviousSnapshotsByBaseId[currentBaseId];
  //     if (currentBaseSnapshot === null || currentBaseSnapshot === undefined) {
  //       throw new Error(`Regional session has no committed snapshot for current base ${currentBaseId}.`);
  //     }
  //
  //     const aggregateWarehouseStats = aggregateRegionalWarehouseStats(
  //       this.regionalPreviousBaseSnapshots,
  //       this.regionalPreviousWarehouseCounts,
  //       this.topology.getSnapshot()?.regionalResourceSupply,
  //     );
  //     const publishedSnapshot: RuntimeTickSnapshot = {
  //       ...currentBaseSnapshot,
  //       warehouseStats: aggregateWarehouseStats,
  //     };
  //     const totalPowerDemand = this.regionalPreviousBaseSnapshots.reduce(
  //       (sum, snapshot) => sum + snapshot.totalPowerDemand,
  //       0,
  //     );
  //
  //     runInAction(() => {
  //       this.stateReadWrite.currentSnapshot = publishedSnapshot;
  //       this.stateReadWrite.currentPlaybackTickNumber = committedTickNumber;
  //       this.playbackTargetTickNumber = committedTickNumber;
  //       this.stateReadWrite.regionalTotalPowerDemand = totalPowerDemand;
  //       this.stateReadWrite.statistics = {
  //         ...this.stateReadWrite.statistics,
  //         baseBatteryJoules: publishedSnapshot.baseBatteryJoules,
  //         baseBatteryCapacity: publishedSnapshot.baseBatteryCapacity,
  //       };
  //       this.stateReadWrite.runtimeStatus = {
  //         ...this.stateReadWrite.runtimeStatus,
  //         mode: "running",
  //         retainedFromTick: committedTickNumber,
  //         latestTickNumber: committedTickNumber,
  //         bufferSize: 1,
  //         error: null,
  //       };
  //     });
  //
  //     return {
  //       requestedTickNumber: tickNumber,
  //       committedTickNumber,
  //       committedEpochNumber: session.nextEpochNumber - 1,
  //       warehouseVersion: session.authorityHead.warehouseVersion,
  //       warehouseCounts: session.authorityHead.warehouseCounts,
  //       warehouseStats: aggregateWarehouseStats,
  //       baseSummaries: Object.fromEntries(
  //         Object.entries(this.regionalPreviousSnapshotsByBaseId).flatMap(([baseId, snapshot]) =>
  //           snapshot === null
  //             ? []
  //             : [[baseId, {
  //                 tickNumber: snapshot.tickNumber,
  //                 totalPowerDemand: snapshot.totalPowerDemand,
  //                 warehouseStats: snapshot.warehouseStats,
  //               } satisfies RegionalSimulationBaseTickSummary]],
  //         ),
  //       ),
  //     };
  //   } catch (error) {
  //     if (this.regionalSession === session) {
  //       this.disposeRegionalSession();
  //       this.resetPlaybackHotQueue();
  //       runInAction(() => {
  //         this.stateReadWrite.runningState = "pause";
  //         this.stateReadWrite.runtimeStatus = {
  //           ...this.stateReadWrite.runtimeStatus,
  //           mode: "error",
  //           error: error instanceof Error ? error.message : String(error),
  //         };
  //       });
  //     }
  //     throw error;
  //   } finally {
  //     if (this.regionalSession === session && !this.regionalSessionStopped) {
  //       if (switchedCurrentBaseToCoarse) {
  //         await session.setCurrentBaseAdvanceMode("per-tick").catch((error: unknown) => {
  //           this.disposeRegionalSession();
  //           this.resetPlaybackHotQueue();
  //           runInAction(() => {
  //             this.stateReadWrite.runningState = "pause";
  //             this.stateReadWrite.runtimeStatus = {
  //               ...this.stateReadWrite.runtimeStatus,
  //               mode: "error",
  //               error: error instanceof Error ? error.message : String(error),
  //             };
  //           });
  //           return Promise.reject(error);
  //         });
  //       }
  //       const shouldResume = previousRunningState === "start";
  //       this.regionalSessionPaused = !shouldResume;
  //       runInAction(() => {
  //         this.stateReadWrite.runningState = shouldResume ? "start" : "pause";
  //       });
  //       if (shouldResume) {
  //         this.ensureRegionalSessionLoop();
  //       }
  //     }
  //   }
  // }
  //
  private latestRegionalPlaybackTickNumber(): number {
    return Math.max(
      this.context.presentation.currentSnapshot?.tickNumber ?? 0,
      this.context.playback.latestBufferedTick,
    );
  }

  private enqueueRegionalCommittedEpoch(committed: {
    readonly epochNumber: number;
    readonly gateTickNumber: number;
    readonly warehouseCounts: Readonly<Record<string, number>>;
    readonly snapshotsByBaseId: Readonly<Record<string, RuntimeTickSnapshot | null>>;
    readonly playbackSnapshots: readonly RuntimeTickSnapshot[];
  }): void {
    const baseSnapshots = Object.values(committed.snapshotsByBaseId)
      .filter((snapshot): snapshot is RuntimeTickSnapshot => snapshot !== null);
    runInAction(() => {
      for (const rawSnapshot of committed.playbackSnapshots) {
        const tickNumber = rawSnapshot.tickNumber;
        const isGateTick = tickNumber === committed.gateTickNumber;
        const counts = isGateTick
          ? committed.warehouseCounts
          : this.regionalPreviousWarehouseCounts;
        const snapshotsForStats = isGateTick
          ? baseSnapshots
          : this.regionalPreviousBaseSnapshots;
        const snapshot: RuntimeTickSnapshot = {
          ...rawSnapshot,
          warehouseStats: aggregateRegionalWarehouseStats(
            snapshotsForStats,
            counts,
            this.context.topology.getSnapshot()?.regionalResourceSupply,
          ),
        };
        if (this.context.presentation.currentSnapshot === null && snapshot.tickNumber === 0) {
          this.context.presentation.currentSnapshot = snapshot;
          this.context.stateReadWrite.currentPlaybackTickNumber = 0;
        } else if (snapshot.tickNumber > 0) {
          this.context.playback.enqueueSnapshot(snapshot);
        }
      }
      this.regionalPreviousWarehouseCounts = committed.warehouseCounts;
      this.regionalPreviousBaseSnapshots = baseSnapshots;
      // AI-REMOVED 2026-08-28:
      // Reason: 该赋值仅维护已归档浏览器 Runner 所需的按基地快照索引。
      // Trigger: 用户明确要求当前及未来此类用例归入 Blueprint 测试组。
      // Evidence: Active Code 只使用 regionalPreviousBaseSnapshots。
      // Replacement: None；应用区域仿真继续维护 regionalPreviousBaseSnapshots。
      // Risk: Low
      // Human Review: Required
      //
      // Original code:
      // this.regionalPreviousSnapshotsByBaseId = committed.snapshotsByBaseId;
      this.context.stateReadWrite.regionalTotalPowerDemand = baseSnapshots.reduce(
        (sum, snapshot) => sum + snapshot.totalPowerDemand,
        0,
      );
      this.context.stateReadWrite.runtimeStatus = {
        ...this.context.stateReadWrite.runtimeStatus,
        retainedFromTick: this.context.presentation.currentSnapshot?.tickNumber ?? 0,
        latestTickNumber: this.latestRegionalPlaybackTickNumber(),
        bufferSize: this.context.playback.bufferedSize + (this.context.presentation.currentSnapshot === null ? 0 : 1),
      };
    });
  }

  public ensureRegionalSessionLoop(): void {
    if (
      this.regionalSession === null
      || this.regionalSessionLoop !== null
      || this.regionalSessionStopped
      || this.regionalSessionPaused
    ) {
      return;
    }
    const generation = this.regionalSessionGeneration;
    const loop = this.runRegionalSessionLoop();
    const tracked = loop.finally(() => {
      if (this.regionalSessionLoop === tracked) {
        this.regionalSessionLoop = null;
      }
    });
    this.regionalSessionLoop = tracked;
    void loop.catch((error: unknown) => {
      if (generation !== this.regionalSessionGeneration || this.regionalSessionStopped) {
        return;
      }
      console.error("[RegionalSimulation] Session loop failed.", error);
      // AI-CORRECTION 2026-08-21: Epoch 失败后立即销毁全部区域 Worker；部分提交状态不可安全重试。
      // Trigger: Worker RPC 超时需要终止仍在运行或无响应的 Worker，并释放其他基地的会话资源。
      this.disposeRegionalSession();
      runInAction(() => {
        this.context.stateReadWrite.runningState = "pause";
        this.context.stateReadWrite.runtimeStatus = {
          ...this.context.stateReadWrite.runtimeStatus,
          mode: "error",
          error: error instanceof Error ? error.message : String(error),
        };
      });
    });
  }

  private async runRegionalSessionLoop(): Promise<void> {
    while (!this.regionalSessionStopped && !this.regionalSessionPaused) {
      const session = this.regionalSession;
      if (session === null) {
        return;
      }
      // AI-CORRECTION 2026-08-21: 区域播放复用单基地低水位；每个 Epoch 补入 10 Tick，队列稳定在 10~19。
      if (this.context.playback.bufferedSize >= PLAYBACK_HOT_QUEUE_LOW_WATER) {
        await new Promise((resolve) => setTimeout(resolve, 50));
        continue;
      }
      // AI-CORRECTION 2026-08-21: Epoch 序号改由标量维护，避免为取 length 持有全部提交快照历史。
      const committed = await session.runEpoch(session.nextEpochNumber);
      if (this.regionalSessionStopped || this.regionalSession !== session) {
        return;
      }
      this.enqueueRegionalCommittedEpoch(committed);
    }
  }

  public disposeRegionalSession(): void {
    this.regionalSessionGeneration += 1;
    this.regionalSessionStopped = true;
    this.regionalSessionPaused = false;
    const session = this.regionalSession;
    this.regionalSession = null;
    this.regionalSessionLoop = null;
    session?.dispose();
    for (const bridge of this.regionalSessionBridges) {
      bridge.dispose();
    }
    this.regionalSessionBridges = [];
    this.regionalPreviousWarehouseCounts = {};
    this.regionalPreviousBaseSnapshots = [];
    // AI-REMOVED 2026-08-28:
    // Reason: 对应的浏览器 Runner 测试专用字段已归档。
    // Trigger: 用户明确要求当前及未来此类用例归入 Blueprint 测试组。
    // Evidence: disposeRegionalSession 的 Active Code 不再持有该字段。
    // Replacement: None
    // Risk: Low
    // Human Review: Required
    //
    // Original code:
    // this.regionalPreviousSnapshotsByBaseId = {};
  }
}
