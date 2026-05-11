import { action, runInAction } from "mobx";

import type { SimulationAction } from "@/domain/simulation/simulation-action";
import type { WorkspaceContract } from "@/domain/document/workspace-contract";
import type { WorldDocument } from "@/domain/document/world-document";
import type { SnapshotStoreReadWrite } from "@/shared/snapshot/snapshot-store";

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
import type {
  CompiledSimulationTopology,
  SimulationStartResult,
  SimulationTickPullStatus,
  SimulationTopologyMigration,
} from "./types";
import type { SimulationWorkerResponse } from "./worker-protocol";

export interface SimulationWorkerBridge {
  loadTopology(topology: CompiledSimulationTopology, migration?: SimulationTopologyMigration): Promise<Extract<
    SimulationWorkerResponse,
    { readonly type: "topology-loaded" }
  >>;
  getTickSnapshot(tickNumber: number): Promise<Extract<
    SimulationWorkerResponse,
    { readonly type: "tick-snapshot-result" }
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
}

export class SimulationActionImpl
implements SimulationAction, SimulationInternalAction {
  private readonly workspace: WorkspaceContract;
  private readonly stateReadWrite: SimulationStateReadWrite;
  private readonly topology: SnapshotStoreReadWrite<CompiledSimulationTopology | null>;
  private readonly bridge: SimulationWorkerBridge;
  private compiledDocument: WorldDocument | null = null;

  public constructor(options: SimulationActionImplOptions) {
    this.workspace = options.workspace;
    this.stateReadWrite = options.state;
    this.topology = options.topology;
    this.bridge = options.bridge;
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
    if (this.stateReadWrite.runningState !== "start") {
      return;
    }

    const previousPlaybackTickNumber = this.stateReadWrite.currentPlaybackTickNumber;
    // simulationSpeed 有且仅有这一处可以参与运算：它只影响 add time 的推进速度。
    // 任何其他场合都不得使用该倍率做 tick/second 换算；换算只能依赖 standard tick rate。
    const tickDelta = deltaMs
      * STANDARD_TICK_RATE_PER_SECOND
      * this.stateReadWrite.simulationSpeed
      / 1000;

    runInAction(() => {
      this.stateReadWrite.currentPlaybackTickNumber += tickDelta;
    });

    const previousIntegerTickNumber = Math.trunc(previousPlaybackTickNumber);
    const nextIntegerTickNumber = Math.trunc(this.stateReadWrite.currentPlaybackTickNumber);
    if (previousIntegerTickNumber === nextIntegerTickNumber) {
      return;
    }

    const result = await this.syncToTick(nextIntegerTickNumber);
    if (result.status === "not-ready") {
      runInAction(() => {
        this.stateReadWrite.currentPlaybackTickNumber = previousPlaybackTickNumber;
      });
      return;
    }

    if (result.status === "not-found") {
      await this.recoverPlaybackFromUnavailableTick(result, previousPlaybackTickNumber);
    }
  };

  public readonly refreshFromCurrentDocument: SimulationInternalAction["refreshFromCurrentDocument"] = async () => {
    const document = this.workspace.editor?.document.getSnapshot();
    if (document === undefined) {
      this.topology.setSnapshot(null);
      this.compiledDocument = null;
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

    const previousTopology = this.topology.getSnapshot();
    const nextDocumentHash = createSimulationDocumentHash(document);
    if (
      this.compiledDocument !== null
      && previousTopology !== null
      && this.stateReadWrite.runtimeStatus.mode !== "error"
      && previousTopology.documentHash === nextDocumentHash
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
    const response = await this.bridge.loadTopology(compiledTopology, migration ?? undefined);
    this.topology.setSnapshot(compiledTopology);
    this.compiledDocument = cloneWorldDocument(document);

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
  });

  public readonly reset: SimulationInternalAction["reset"] = action(() => {
    this.clearPlaybackProgress();
    this.stateReadWrite.simulationSpeed = DEFAULT_SIMULATION_SPEED;
  });

  public readonly syncToTick: SimulationInternalAction["syncToTick"] = async (
    tickNumber: number,
    playbackTickNumberOnReady?: number,
  ): Promise<SimulationTickPullStatus> => {
    const response = await this.bridge.getTickSnapshot(tickNumber);

    runInAction(() => {
      this.stateReadWrite.runtimeStatus = response.status;

      if (response.result.status.status === "ready") {
        this.stateReadWrite.currentSnapshot = response.result.currentTick;
        if (playbackTickNumberOnReady !== undefined) {
          this.stateReadWrite.currentPlaybackTickNumber = playbackTickNumberOnReady;
        }
      }
    });

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
  }
}

function cloneWorldDocument(document: WorldDocument): WorldDocument {
  return JSON.parse(JSON.stringify(document)) as WorldDocument;
}
