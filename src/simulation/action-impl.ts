import { action, runInAction } from "mobx";

import type { SimulationAction } from "@/domain/action/simulation-action";
import type { WorkspaceContract } from "@/domain/contract/workspace-contract";
import type { SnapshotStoreReadWrite } from "@/shared/snapshot/snapshot-store";

import { compileSimulationTopology } from "./topology-compiler";
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
} from "./types";
import type { SimulationWorkerResponse } from "./worker-protocol";

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
    this.stateReadWrite.hasStarted = false;
    this.stateReadWrite.runningState = "stop";
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
    }
  };

  public readonly refreshFromCurrentDocument: SimulationInternalAction["refreshFromCurrentDocument"] = async () => {
    runInAction(() => {
      this.stateReadWrite.currentSnapshot = null;
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

    if (response.result.status === "started") {
      await this.syncToTick(0, 0);
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
    this.topology.setSnapshot(null);
    this.stateReadWrite.runningState = "stop";
    this.stateReadWrite.simulationSpeed = DEFAULT_SIMULATION_SPEED;
    this.stateReadWrite.hasStarted = false;
    this.stateReadWrite.runtimeStatus = createInitialSimulationRuntimeStatus();
    this.stateReadWrite.currentSnapshot = null;
    this.stateReadWrite.currentPlaybackTickNumber = 0;
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
}
