// AI-REMOVED 2026-09-09:
// Reason: 按仿真引擎与状态所有权重组，原实现迁入明确的职责模块。
// Trigger: 用户授权抽离 dense / legacy 公共接口并重组 legacy。
// Evidence: 原入口混合引擎选择、查询、Worker bridge 与 legacy 控制状态。
// Replacement: src/simulation/legacy/recipe-completion.ts
// Risk: 异步生命周期与查询语义由双引擎回归验证。
// Human Review: Required
//
// Original code:
// import type {
//   CompiledSimulationTopology,
//   RegionalWarehouseWriteContext,
// } from "../types";
// import type {
//   RuntimeDeviceRecipeState,
//   SimulationMutableRuntimeState,
// } from "./runtime-state";
// import { finishRecipeIfPossible } from "./runtime-slot-access";
// import { submitSlotsToWarehouse } from "./warehouse-submit";
// import type { RegistryContract } from "@/domain/registry/registry-contract";
//
// /**
//  * 配方完成的唯一业务入口。
//  *
//  * Stage1 正常推进完成与 Stage5 溢出推进完成必须共同调用这里，避免完成位置变化后
//  * 遗漏仓库提交等配方级副作用。
//  */
// export function completeRecipeIfPossible(options: {
//   readonly registry: RegistryContract;
//   readonly topology: CompiledSimulationTopology;
//   readonly state: SimulationMutableRuntimeState;
//   readonly deviceId: string;
//   readonly recipe: RuntimeDeviceRecipeState;
//   readonly regionalWarehouse?: RegionalWarehouseWriteContext;
// }): boolean {
//   if (!finishRecipeIfPossible(options.registry, options.topology, options.state, options.recipe)) {
//     return false;
//   }
//
//   if (options.recipe.plan.recipeId === "r_warehouse_submit") {
//     submitSlotsToWarehouse(options.topology, options.state, options.deviceId, options.regionalWarehouse);
//   }
//
//   return true;
// }
//
