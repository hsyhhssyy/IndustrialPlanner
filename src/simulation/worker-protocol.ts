import type {
  CompiledSimulationTopology,
  SimulationPerfReport,
  SimulationRuntimeStatus,
  SimulationRuntimeExport,
  SimulationStartResult,
  SimulationTickPullStatus,
  SimulationTopologyMigration,
  SimulationTickSnapshotResult,
  RuntimeTickSnapshot,
} from "./types";
import type {
  RegionWarehouseAckBatch,
  RegionWarehouseArbitrationResult,
  RegionWarehouseCommitProposal,
  RegionWarehouseDemandBatch,
  RegionWarehouseDeposit,
  RegionalWarehouseOutletTable,
} from "./regional";
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
      /** 轻量 Worker 性能统计，不控制 debugData。 */
      readonly perfEnabled?: boolean;
      /** 完整 debugData 快照的构造与传输。 */
      readonly debugDataEnabled?: boolean;
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
      /** 只读预取连续 Tick 快照；不得推进 Worker 的呈现清理锚点。 */
      readonly type: "get-tick-snapshot-range";
      readonly requestId: number;
      readonly fromTickNumber: number;
      readonly toTickNumber: number;
      /** 主线程热队列生命周期；响应原样回传，供调用方丢弃过期结果。 */
      readonly generation: number;
      readonly simulationSpeed?: number;
    }
  | {
      /** 确认主线程已呈现到该 Tick；Worker 可清理更早的快照与运行时 checkpoint。 */
      readonly type: "acknowledge-presented-tick";
      readonly requestId: number;
      readonly tickNumber: number;
      readonly generation: number;
    }
  | {
      readonly type: "set-simulation-speed";
      readonly requestId: number;
      readonly simulationSpeed: number;
    }
  | {
      /** 历史协议名：仅同步调试模式下的轻量性能统计，不控制 debugData。 */
      readonly type: "set-debug-enabled";
      readonly requestId: number;
      readonly debugEnabled: boolean;
    }
  | {
      /** 单独同步完整 debugData 快照开关。 */
      readonly type: "set-debug-data-enabled";
      readonly requestId: number;
      readonly debugDataEnabled: boolean;
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
      readonly type: "load-regional-topology";
      readonly requestId: number;
      readonly topology: CompiledSimulationTopology;
      readonly baseId: string;
      readonly table: RegionalWarehouseOutletTable;
      readonly initialWarehouseCounts: Readonly<Record<string, number>>;
      readonly expectedBaseIds: readonly string[];
      readonly fixedDynamicTickRate: number;
      readonly advanceMode: "per-tick" | "coarse";
    }
  | {
      readonly type: "prepare-regional-epoch";
      readonly requestId: number;
      readonly epochNumber: number;
    }
  | {
      readonly type: "apply-regional-epoch-grant";
      readonly requestId: number;
      readonly epochNumber: number;
      readonly grantedOutletIds: readonly string[];
    }
  | {
      readonly type: "finalize-regional-epoch";
      readonly requestId: number;
      readonly epochNumber: number;
      readonly nextWarehouseCounts: Readonly<Record<string, number>>;
      readonly includeSnapshot: boolean;
      readonly retainSnapshot: boolean;
    }
  | {
      readonly type: "regional-arbitrate";
      readonly requestId: number;
      readonly epochNumber: number;
      readonly demands: readonly RegionWarehouseDemandBatch[];
    }
  | {
      readonly type: "regional-commit";
      readonly requestId: number;
      readonly epochNumber: number;
      readonly acks: readonly RegionWarehouseAckBatch[];
    }
  | {
      readonly type: "take-regional-snapshots";
      readonly requestId: number;
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
      readonly type: "tick-snapshot-range-result";
      readonly requestId: number;
      readonly result: SimulationTickSnapshotRangeResult;
      readonly status: SimulationRuntimeStatus;
    }
  | {
      readonly type: "presented-tick-acknowledged";
      readonly requestId: number;
      readonly generation: number;
      /** generation 或 checkpoint 不匹配时为 null，且不会清理缓存。 */
      readonly acknowledgedTickNumber: number | null;
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
      readonly type: "debug-data-enabled-set";
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
    }
  | {
      readonly type: "regional-topology-loaded";
      readonly requestId: number;
      readonly result: SimulationStartResult;
      readonly status: SimulationRuntimeStatus;
    }
  | {
      readonly type: "regional-epoch-prepared";
      readonly requestId: number;
      readonly epochNumber: number;
      readonly tickNumber: number;
      readonly demandedOutletIds: readonly string[];
      readonly status: SimulationRuntimeStatus;
    }
  | {
      readonly type: "regional-epoch-grant-applied";
      readonly requestId: number;
      readonly epochNumber: number;
      readonly tickNumber: number;
      readonly deposits: readonly RegionWarehouseDeposit[];
      readonly status: SimulationRuntimeStatus;
    }
  | {
      readonly type: "regional-epoch-finalized";
      readonly requestId: number;
      readonly epochNumber: number;
      readonly tickNumber: number;
      readonly snapshot: RuntimeTickSnapshot | null;
      readonly status: SimulationRuntimeStatus;
    }
  | {
      readonly type: "regional-arbitrated";
      readonly requestId: number;
      readonly epochNumber: number;
      readonly result: RegionWarehouseArbitrationResult;
      readonly status: SimulationRuntimeStatus;
    }
  | {
      readonly type: "regional-committed";
      readonly requestId: number;
      readonly epochNumber: number;
      readonly result: RegionWarehouseCommitProposal;
      readonly status: SimulationRuntimeStatus;
    }
  | {
      readonly type: "regional-snapshots-taken";
      readonly requestId: number;
      readonly snapshots: readonly RuntimeTickSnapshot[];
      readonly status: SimulationRuntimeStatus;
    };

/**
 * Worker 主动推送的错误通知（非请求-响应）。
 * AI-CORRECTION 2026-08-08: 错误已在 Worker 内通过 console.error 直达 Collector；
 * 主线程收到此通知只处理业务状态，不得再次输出同一条日志。
 */
export interface SimulationWorkerErrorNotification {
  readonly type: "worker-error";
  readonly error: string;
  readonly tickNumber: number | null;
}

/**
 * 范围预取只返回从 fromTickNumber 开始的连续前缀。
 * status=ready 时 snapshots 可以少于请求数量；空数组由 not-ready/not-found 解释原因。
 */
export interface SimulationTickSnapshotRangeResult {
  readonly generation: number;
  readonly fromTickNumber: number;
  readonly toTickNumber: number;
  readonly status: SimulationTickPullStatus;
  readonly snapshots: readonly RuntimeTickSnapshot[];
}
