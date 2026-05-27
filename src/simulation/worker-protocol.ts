import type {
  CompiledSimulationTopology,
  SimulationPerfReport,
  SimulationRuntimeStatus,
  SimulationStartResult,
  SimulationTopologyMigration,
  SimulationTickSnapshotResult,
} from "./types";
import type { SimulationRuntimeSlotPatch } from "@/domain/simulation/types/simulation-types";

export type SimulationWorkerRequest =
  | {
      readonly type: "load-topology";
      readonly requestId: number;
      readonly topology: CompiledSimulationTopology;
      readonly migration?: SimulationTopologyMigration;
      readonly perfEnabled?: boolean;
      readonly simulationSpeed?: number;
    }
  | {
      readonly type: "get-tick-snapshot";
      readonly requestId: number;
      readonly tickNumber: number;
      readonly simulationSpeed?: number;
    }
  | {
      readonly type: "set-simulation-speed";
      readonly requestId: number;
      readonly simulationSpeed: number;
    }
  | {
      readonly type: "patch-runtime-slot";
      readonly requestId: number;
      readonly patch: SimulationRuntimeSlotPatch;
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
      readonly type: "simulation-speed-set";
      readonly requestId: number;
      readonly status: SimulationRuntimeStatus;
    }
  | {
      readonly type: "runtime-slot-patched";
      readonly requestId: number;
      readonly status: SimulationRuntimeStatus;
    }
  | {
      readonly type: "perf-report";
      readonly requestId: number;
      readonly report: SimulationPerfReport | null;
      readonly status: SimulationRuntimeStatus;
    };
