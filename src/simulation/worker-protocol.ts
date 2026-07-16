import type {
  CompiledSimulationTopology,
  SimulationPerfReport,
  SimulationRuntimeStatus,
  SimulationRuntimeExport,
  SimulationStartResult,
  SimulationTopologyMigration,
  SimulationTickSnapshotResult,
} from "./types";
import type {
  SimulationAdmissionCounterReset,
  SimulationRuntimeSlotPatch,
} from "@/domain/simulation/types/simulation-types";

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
      /** 主线程最后确认展示的 tick；Worker 必须保留其运行时状态供拓扑迁移使用。 */
      readonly retainTickNumber?: number;
      readonly simulationSpeed?: number;
    }
  | {
      readonly type: "set-simulation-speed";
      readonly requestId: number;
      readonly simulationSpeed: number;
    }
  | {
      readonly type: "set-debug-enabled";
      readonly requestId: number;
      readonly debugEnabled: boolean;
    }
  | {
      readonly type: "patch-runtime-slot";
      readonly requestId: number;
      readonly patch: SimulationRuntimeSlotPatch;
    }
  | {
      readonly type: "reset-admission-counter";
      readonly requestId: number;
      readonly reset: SimulationAdmissionCounterReset;
    }
  | {
      readonly type: "get-perf-report";
      readonly requestId: number;
    }
  | {
      readonly type: "set-power-mode";
      readonly requestId: number;
      readonly powerMode: "real" | "infinite";
    }
  | {
      readonly type: "set-power-consumption-override";
      readonly requestId: number;
      readonly powerConsumptionOverride: number | undefined;
    }
  | {
      readonly type: "export-runtime-state";
      readonly requestId: number;
      readonly tickNumber?: number;
    }
  | {
      readonly type: "import-runtime-state";
      readonly requestId: number;
      readonly runtimeExport: SimulationRuntimeExport;
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
      readonly type: "debug-enabled-set";
      readonly requestId: number;
      readonly status: SimulationRuntimeStatus;
    }
  | {
      readonly type: "runtime-slot-patched";
      readonly requestId: number;
      readonly status: SimulationRuntimeStatus;
    }
  | {
      readonly type: "admission-counter-reset";
      readonly requestId: number;
      readonly status: SimulationRuntimeStatus;
    }
  | {
      readonly type: "perf-report";
      readonly requestId: number;
      readonly report: SimulationPerfReport | null;
      readonly status: SimulationRuntimeStatus;
    }
  | {
      readonly type: "power-mode-set";
      readonly requestId: number;
      readonly status: SimulationRuntimeStatus;
    }
  | {
      readonly type: "power-consumption-override-set";
      readonly requestId: number;
      readonly status: SimulationRuntimeStatus;
    }
  | {
      readonly type: "runtime-state-exported";
      readonly requestId: number;
      readonly runtimeExport: SimulationRuntimeExport | null;
      readonly status: SimulationRuntimeStatus;
    }
  | {
      readonly type: "runtime-state-imported";
      readonly requestId: number;
      readonly result: SimulationTickSnapshotResult;
      readonly status: SimulationRuntimeStatus;
    };

/**
 * Worker 主动推送的错误通知（非请求-响应）。
 * 用于 setTimeout 回调等异步路径中的错误，主线程收到后通过 console.error 记录，
 * 以便 debug-log 窗口捕获。
 */
export interface SimulationWorkerErrorNotification {
  readonly type: "worker-error";
  readonly error: string;
  readonly tickNumber: number | null;
}
