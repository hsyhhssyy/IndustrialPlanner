import { notifyStateRecipeCompleted } from "./stage-6-process-device-states";
import type { CompiledSimulationTopology, RegionalWarehouseWriteContext } from "../contracts";
import type { RuntimeDeviceRecipeState, SimulationMutableRuntimeState } from "./runtime-state";
import { finishRecipeIfPossible } from "./runtime-slot-access";
import { submitSlotsToWarehouse } from "./warehouse-submit";
import type { RegistryContract } from "@/domain/registry/registry-contract";

/**
 * 配方完成的唯一业务入口。
 *
 * Stage1 正常推进完成与 Stage5 溢出推进完成必须共同调用这里，避免完成位置变化后
 * 遗漏仓库提交等配方级副作用。
 * AI-CORRECTION 2026-10-14: Stage5 只重试阻塞输出，不再处理溢出；完成事件交给 Stage6，下一 run 在 Stage7 启动。
 */
export function completeRecipeIfPossible(options: {
  readonly registry: RegistryContract;
  readonly topology: CompiledSimulationTopology;
  readonly state: SimulationMutableRuntimeState;
  readonly deviceId: string;
  readonly recipe: RuntimeDeviceRecipeState;
  readonly regionalWarehouse?: RegionalWarehouseWriteContext;
}): boolean {
  const definition = options.registry.queries.findRecipeDefinition(options.recipe.recipeId);
  const bonus = definition?.outputTarget === "warehouse" ? options.state.persistent.devices[options.deviceId]?.cultivation?.yieldBonusRatio ?? 0 : 0;
  const recipe = bonus === 0 ? options.recipe : { ...options.recipe, plan: { ...options.recipe.plan,
    outputs: options.recipe.plan.outputs.map(output => ({ ...output, amount: Math.round(output.amount * (1 + bonus)) })) } };
  if (!finishRecipeIfPossible(options.registry, options.topology, options.state, recipe)) {
    return false;
  }

  if (options.recipe.plan.recipeId === "r_warehouse_submit") {
    submitSlotsToWarehouse(options.topology, options.state, options.deviceId, options.regionalWarehouse);
  }

  if (definition?.outputTarget === "warehouse") {
    for (const output of definition.outputs) {
      const amount = Math.round(output.amount * (1 + bonus));
      const produced = options.state.transient.recipeStatsDelta.produced;
      produced[output.itemId] = (produced[output.itemId] ?? 0) + amount;
      if (options.regionalWarehouse) {
        const slotId = options.recipe.plan.productNodeIds.flatMap(id => options.topology.nodes[id]!.slotIds).find(id => options.topology.slots[id]!.lock === output.itemId);
        if (slotId === undefined || !options.regionalWarehouse.isWarehouseStorageSlotId(slotId)) throw new Error("Regional crop warehouse slot is missing.");
        options.state.persistent.slots[slotId]!.count -= amount;
        options.regionalWarehouse.deposit(output.itemId, amount);
      }
    }
  }
  notifyStateRecipeCompleted(options.registry, options.topology, options.state, options.deviceId, options.recipe.recipeId);
  return true;
}
