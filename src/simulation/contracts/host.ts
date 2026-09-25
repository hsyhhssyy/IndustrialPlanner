import type { SimulationContract } from "@/domain/simulation/simulation-contract";
import type { WorkspaceContract } from "@/domain/document/workspace-contract";
import type { SimulationEngineKind } from "@/domain/simulation/types/simulation-types";
import type { SnapshotStoreReadWrite } from "@/shared/snapshot/snapshot-store";
// AI-REMOVED 2026-09-25:
// Reason: 跨基地关系已迁入出口世界文档，移除 App 关系权威的装配和接口。
// Trigger: REQ-038 及用户授权修改 main。
// Evidence: Editor 文档集合与 listDocumentRegionalDarkPipeLinks 已统一提供当前关系。
// Replacement: src/shared/dark-pipe-link.ts:listDocumentRegionalDarkPipeLinks。
// Risk: Legacy 单基地和区域启动保护需回归。
// Human Review: Required
// Original code:
// import type { RegionalDarkPipeLink } from "@/shared/dark-pipe-link";
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
  /** 独立 Dense 蓝图验证的真实 tick 频率；默认沿用 Dense 引擎频率。 */
  readonly blueprintDenseTickRate?: 2 | 4;
  /** 调试模式下的轻量性能统计开关。 */
  readonly getPerfEnabled?: () => boolean;
  /** 完整 Worker debugData 快照开关；应由调用方同时应用调试模式总开关。 */
  readonly getDebugDataEnabled?: () => boolean;
  readonly getActiveActivityIds?: () => readonly string[];
  /** 按基地中文地区 tag 读取地区资源供给。 */
  readonly getRegionalResourceSettings?: (regionTag: string) => readonly import("./types").RegionalResourceSupplySetting[];
// AI-REMOVED 2026-09-25:
// Reason: 跨基地关系已迁入出口世界文档，移除 App 关系权威的装配和接口。
// Trigger: REQ-038 及用户授权修改 main。
// Evidence: Editor 文档集合与 listDocumentRegionalDarkPipeLinks 已统一提供当前关系。
// Replacement: src/shared/dark-pipe-link.ts:listDocumentRegionalDarkPipeLinks。
// Risk: Legacy 单基地和区域启动保护需回归。
// Human Review: Required
// Original code:
//   /** 按基地中文地区 tag 读取跨基地暗管连接。 */
//   readonly getRegionalDarkPipeLinks?: (regionTag: string) => readonly RegionalDarkPipeLink[];
}

export type SimulationHostFactory = (workspace: WorkspaceContract, options: CreateSimulationHostOptions) => SimulationHost;
