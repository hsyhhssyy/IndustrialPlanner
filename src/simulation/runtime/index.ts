// AI-REMOVED 2026-09-09:
// Reason: 按仿真引擎与状态所有权重组，原实现迁入明确的职责模块。
// Trigger: 用户授权抽离 dense / legacy 公共接口并重组 legacy。
// Evidence: 原入口混合引擎选择、查询、Worker bridge 与 legacy 控制状态。
// Replacement: src/simulation/legacy/index.ts
// Risk: 异步生命周期与查询语义由双引擎回归验证。
// Human Review: Required
//
// Original code:
// export { BASE_BATTERY_CAPACITY_J } from "./runtime-state";
//
