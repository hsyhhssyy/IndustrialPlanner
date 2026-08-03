import type { CompiledSimulationTopology } from "../types";
import type {
  RuntimeDeviceRecipeState,
  SimulationMutableRuntimeState,
} from "./runtime-state";
import { finishRecipeIfPossible } from "./runtime-slot-access";
import { submitSlotsToWarehouse } from "./warehouse-submit";
import type { RegistryContract } from "@/domain/registry/registry-contract";

/**
 * 配方完成的唯一业务入口。
 *
 * Stage1 正常推进完成与 Stage5 溢出推进完成必须共同调用这里，避免完成位置变化后
 * 遗漏仓库提交等配方级副作用。
 */
export function completeRecipeIfPossible(options: {
  readonly registry: RegistryContract;
  readonly topology: CompiledSimulationTopology;
  readonly state: SimulationMutableRuntimeState;
  readonly deviceId: string;
  readonly recipe: RuntimeDeviceRecipeState;
}): boolean {
  if (!finishRecipeIfPossible(options.registry, options.topology, options.state, options.recipe)) {
    return false;
  }

  if (options.recipe.plan.recipeId === "r_warehouse_submit") {
    submitSlotsToWarehouse(options.topology, options.state, options.deviceId);
  }

  return true;
}
