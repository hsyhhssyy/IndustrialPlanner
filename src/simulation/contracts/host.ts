import type { SimulationContract } from "@/domain/simulation/simulation-contract";
import type { WorkspaceContract } from "@/domain/document/workspace-contract";
import type { SimulationEngineKind } from "@/domain/simulation/types/simulation-types";
import type { SnapshotStoreReadWrite } from "@/shared/snapshot/snapshot-store";
import type { CompiledSimulationTopology } from "./types";
import type { SimulationStateReadWrite } from "./state";
import type { SimulationInternalAction } from "./internal-action";

export interface SimulationHost extends SimulationContract {
  workspace: WorkspaceContract;
  topology: SnapshotStoreReadWrite<CompiledSimulationTopology | null>;
  internalState: SimulationStateReadWrite;
  internalActions: SimulationInternalAction;
  dispose: () => void;
}

export type SimulationHostWorkerMode = "auto" | "runtime";

export interface CreateSimulationHostOptions {
  readonly engineKind?: SimulationEngineKind;
  readonly workerMode?: SimulationHostWorkerMode;
  /** 调试模式下的轻量性能统计开关。 */
  readonly getPerfEnabled?: () => boolean;
  /** 完整 Worker debugData 快照开关；应由调用方同时应用调试模式总开关。 */
  readonly getDebugDataEnabled?: () => boolean;
  readonly getActiveActivityIds?: () => readonly string[];
  /** 按基地中文地区 tag 读取地区资源供给。 */
  readonly getRegionalResourceSettings?: (regionTag: string) => readonly import("./types").RegionalResourceSupplySetting[];
}

export type SimulationHostFactory = (workspace: WorkspaceContract, options: CreateSimulationHostOptions) => SimulationHost;
