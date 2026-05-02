import type {
  CompiledSimulationTopology,
  GetSimulationTickSnapshotResult,
  SimulationRuntimeStatus,
  SimulationStartResult,
} from "@/domain/types/simulation";

export type SimulationWorkerRequest =
  | {
      readonly type: "load-topology";
      readonly requestId: number;
      readonly topology: CompiledSimulationTopology;
    }
  | {
      readonly type: "get-tick-snapshot";
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
      readonly type: "tick-snapshot-result";
      readonly requestId: number;
      readonly result: GetSimulationTickSnapshotResult;
      readonly status: SimulationRuntimeStatus;
    };
