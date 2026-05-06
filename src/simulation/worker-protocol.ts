import type {
  CompiledSimulationTopology,
  SimulationRuntimeStatus,
  SimulationStartResult,
  SimulationTickReadResult,
} from "./types";

export type SimulationWorkerRequest =
  | {
      readonly type: "load-topology";
      readonly requestId: number;
      readonly topology: CompiledSimulationTopology;
    }
  | {
      readonly type: "get-tick-read-model";
      readonly requestId: number;
      readonly tickNumber: number;
    };

export type SimulationWorkerResponse =
  | {
      readonly type: "topology-loaded";
      readonly requestId: number;
      readonly result: SimulationStartResult;
      readonly status: SimulationRuntimeStatus;
    }
  | {
      readonly type: "tick-read-model-result";
      readonly requestId: number;
      readonly result: SimulationTickReadResult;
      readonly status: SimulationRuntimeStatus;
    };
