import { action, runInAction } from "mobx";

import type { SimulationAction } from "@/domain/action/simulation-action";
import type { WorkspaceContract } from "@/domain/contract/workspace-contract";
import type {
  CompiledSimulationTopology,
  GetSimulationTickSnapshotResult,
  SimulationStartResult,
} from "@/domain/types/simulation";
import type {
  SimulationWorkerRequest,
  SimulationWorkerResponse,
} from "@/simulation/worker-protocol";
import type { SnapshotStoreReadWrite } from "@/shared/snapshot/snapshot-store";

import { compileSimulationTopology } from "./topology-compiler";
import {
  createInitialSimulationRuntimeStatus,
  DEFAULT_PLAYBACK_TICK_RATE_HZ,
  type SimulationStateReadWrite,
} from "./state-impl";

export interface SimulationWorkerBridge {
  loadTopology(topology: CompiledSimulationTopology): Promise<Extract<
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
  setPlaybackTickRateHz(value: number): void;
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
        this.stateReadWrite.state = "start";
      });
    }

    return result;
  };

  public readonly pause: SimulationAction["pause"] = action(() => {
    this.stateReadWrite.state = "pause";
  });

  public readonly stop: SimulationAction["stop"] = action(() => {
    this.stateReadWrite.hasStarted = false;
    this.stateReadWrite.state = "stop";
  });

  public readonly getTickSnapshot: SimulationAction["getTickSnapshot"] = async (
    tickNumber,
  ) => this.requestTickSnapshot(tickNumber, tickNumber);

  public readonly advancePlaybackByDeltaMs: SimulationAction["advancePlaybackByDeltaMs"] = async (
    deltaMs,
  ) => {
    if (this.stateReadWrite.state !== "start") {
      return null;
    }

    const previousPlaybackTickNumber = this.stateReadWrite.currentPlaybackTickNumber;
    const tickDelta = deltaMs * this.stateReadWrite.playbackTickRateHz / 1000;

    runInAction(() => {
      this.stateReadWrite.currentPlaybackTickNumber += tickDelta;
    });

    const previousIntegerTickNumber = Math.trunc(previousPlaybackTickNumber);
    const nextIntegerTickNumber = Math.trunc(this.stateReadWrite.currentPlaybackTickNumber);
    if (previousIntegerTickNumber === nextIntegerTickNumber) {
      return null;
    }

    const result = await this.requestTickSnapshot(nextIntegerTickNumber);
    if (result.status === "not-ready") {
      runInAction(() => {
        this.stateReadWrite.currentPlaybackTickNumber = previousPlaybackTickNumber;
      });
    }

    return result;
  };

  public readonly refreshFromCurrentDocument: SimulationInternalAction["refreshFromCurrentDocument"] = async () => {
    runInAction(() => {
      this.stateReadWrite.currentTickSnapshot = null;
      this.stateReadWrite.currentPlaybackTickNumber = 0;
    });

    const document = this.workspace.editor?.document.getSnapshot();
    if (document === undefined) {
      this.topology.setSnapshot(null);
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
    const response = await this.bridge.loadTopology(compiledTopology);
    this.topology.setSnapshot(compiledTopology);

    runInAction(() => {
      this.stateReadWrite.runtimeStatus = response.status;
    });

    return response.result;
  };

  public readonly setPlaybackTickRateHz: SimulationInternalAction["setPlaybackTickRateHz"] = action((value) => {
    if (!Number.isFinite(value)) {
      return;
    }

    this.stateReadWrite.playbackTickRateHz = Math.trunc(value);
  });

  public readonly reset: SimulationInternalAction["reset"] = action(() => {
    this.topology.setSnapshot(null);
    this.stateReadWrite.state = "stop";
    this.stateReadWrite.playbackTickRateHz = DEFAULT_PLAYBACK_TICK_RATE_HZ;
    this.stateReadWrite.hasStarted = false;
    this.stateReadWrite.runtimeStatus = createInitialSimulationRuntimeStatus();
    this.stateReadWrite.currentTickSnapshot = null;
    this.stateReadWrite.currentPlaybackTickNumber = 0;
  });

  private readonly requestTickSnapshot = async (
    tickNumber: number,
    playbackTickNumberOnReady?: number,
  ): Promise<GetSimulationTickSnapshotResult> => {
    const response = await this.bridge.getTickSnapshot(tickNumber);

    runInAction(() => {
      this.stateReadWrite.runtimeStatus = response.status;

      if (response.result.status === "ready") {
        this.stateReadWrite.currentTickSnapshot = response.result.snapshot;
        if (playbackTickNumberOnReady !== undefined) {
          this.stateReadWrite.currentPlaybackTickNumber = playbackTickNumberOnReady;
        }
      }
    });

    return response.result;
  };
}