import type {
  CompiledSimulationTopology,
  SimulationPerfReport,
  SimulationRuntimeStatus,
  SimulationStartResult,
  SimulationTopologyMigration,
  SimulationTickSnapshotResult,
} from "./types";

export type SimulationWorkerRequest =
  | {
      readonly type: "load-topology";
      readonly requestId: number;
      readonly topology: CompiledSimulationTopology;
      readonly migration?: SimulationTopologyMigration;
      readonly perfEnabled?: boolean;
    }
  | {
      readonly type: "get-tick-snapshot";
      readonly requestId: number;
      readonly tickNumber: number;
    }
  | {
      readonly type: "get-perf-report";
      readonly requestId: number;
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
      readonly result: SimulationTickSnapshotResult;
      readonly status: SimulationRuntimeStatus;
    }
  | {
      readonly type: "perf-report";
      readonly requestId: number;
      readonly report: SimulationPerfReport | null;
      readonly status: SimulationRuntimeStatus;
    };
