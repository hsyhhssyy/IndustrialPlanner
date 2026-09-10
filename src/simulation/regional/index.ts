export { buildRegionalWarehouseOutletTable } from "./warehouse-outlet-table";
export type {
  RegionalAdmissionDiagnostic,
  RegionalAdmissionResult,
} from "./warehouse-outlet-table";
export {
  arbitrateRegionalWarehouseEpoch,
  commitRegionalWarehouseEpoch,
} from "./warehouse-arbiter";
// AI-REMOVED 2026-09-09:
// Reason: 按仿真引擎与状态所有权重组，原实现迁入明确的职责模块。
// Trigger: 用户授权抽离 dense / legacy 公共接口并重组 legacy。
// Evidence: 原入口混合引擎选择、查询、Worker bridge 与 legacy 控制状态。
// Replacement: src/simulation/legacy/regional-session.ts
// Risk: 异步生命周期与查询语义由双引擎回归验证。
// Human Review: Required
//
// Original code:
// export {
//   LocalRegionalBasePort,
//   RegionalSimulationSession,
// } from "./session";

export { aggregateRegionalWarehouseStats } from "./warehouse-stats";
// AI-REMOVED 2026-09-09:
// Reason: 按仿真引擎与状态所有权重组，原实现迁入明确的职责模块。
// Trigger: 用户授权抽离 dense / legacy 公共接口并重组 legacy。
// Evidence: 原入口混合引擎选择、查询、Worker bridge 与 legacy 控制状态。
// Replacement: src/simulation/legacy/regional-session.ts
// Risk: 异步生命周期与查询语义由双引擎回归验证。
// Human Review: Required
//
// Original code:
// export type {
//   LocalRegionalBasePortOptions,
//   RegionalAuthorityPort,
//   RegionalBasePort,
//   RegionalBaseTopologyInput,
//   RegionalCommittedEpoch,
//   RegionalSessionRuntimeOptions,
// } from "./session";

// AI-REMOVED 2026-09-09:
// Reason: 按仿真引擎与状态所有权重组，原实现迁入明确的职责模块。
// Trigger: 用户授权抽离 dense / legacy 公共接口并重组 legacy。
// Evidence: 原入口混合引擎选择、查询、Worker bridge 与 legacy 控制状态。
// Replacement: src/simulation/legacy/regional-worker-port.ts
// Risk: 异步生命周期与查询语义由双引擎回归验证。
// Human Review: Required
//
// Original code:
// export {
//   BrowserRegionalAuthorityPort,
//   BrowserRegionalBasePort,
//   RegionalWorkerBridge,
//   createBrowserRegionalSessionPorts,
// } from "./worker-port";

// AI-REMOVED 2026-09-09:
// Reason: 按仿真引擎与状态所有权重组，原实现迁入明确的职责模块。
// Trigger: 用户授权抽离 dense / legacy 公共接口并重组 legacy。
// Evidence: 原入口混合引擎选择、查询、Worker bridge 与 legacy 控制状态。
// Replacement: src/simulation/legacy/regional-worker-port.ts
// Risk: 异步生命周期与查询语义由双引擎回归验证。
// Human Review: Required
//
// Original code:
// export type {
//   BrowserRegionalBasePortOptions,
// } from "./worker-port";

export type {
  RegionWarehouseAckBatch,
  RegionWarehouseArbitrationResult,
  RegionWarehouseAuthorityState,
  RegionWarehouseCommitProposal,
  RegionWarehouseDemandBatch,
  RegionWarehouseDeposit,
  RegionWarehouseGrantBatch,
  RegionalSimulationTopologyInput,
  RegionalWarehouseOutlet,
  RegionalWarehouseOutletIdentity,
  RegionalWarehouseOutletTable,
} from "./types";
export { normalizeRegionNumber } from "./types";
