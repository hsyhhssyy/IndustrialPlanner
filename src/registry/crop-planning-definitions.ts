import type { EntityDefinition } from "@/domain/registry/types/entity-definition";
import type { RecipeDefinition } from "@/domain/registry/types/recipe-definition";
import { CROP_STATE_MACHINES } from "./crop-definitions";

/** 从真实状态路径派生整轮产能，规划只读取采集边界，运行时仍由状态机请求阶段配方。 */
export function createCropPlanningRecipes(
  entities: readonly EntityDefinition[],
  recipes: readonly RecipeDefinition[],
): RecipeDefinition[] {
  const recipeById = new Map(recipes.map(recipe => [recipe.id, recipe]));
  const result: RecipeDefinition[] = [];
  for (const entity of entities) {
    const machine = CROP_STATE_MACHINES[entity.id];
    // 隐藏的独立优质田块不作为规划来源；优质作物使用普通田块的育种分支。
    if (!machine || entity.uiGroup === "hidden") continue;
    const stateById = new Map(machine.states.map(state => [state.id, state]));
    const visit = (stateId: string, seconds: number, inheritedDeadline: number | undefined,
      path: readonly string[], harvest: RecipeDefinition | undefined): void => {
      if (stateId === machine.initialStateId && path.length > 0) {
        if (!harvest || seconds <= 0) throw new Error(`田块循环没有有效收获：${entity.id}`);
        result.push({
          id: `${harvest.id}_cycle`, nameKey: harvest.nameKey,
          durationSeconds: seconds, inputs: [],
          outputs: harvest.outputs.map(output => ({ ...output })),
          machineId: entity.id, recipeType: "immediate-consume", outputTarget: "warehouse",
          primaryOutputs: [harvest.outputs[0]!.itemId],
          tags: ["自然资源采集", "农作物采集"],
        });
        return;
      }
      const state = stateById.get(stateId);
      if (!state || path.includes(stateId)) throw new Error(`无效田块规划路径：${entity.id}/${stateId}`);
      const deadline = inheritedDeadline ?? (state.timerDurationSeconds === undefined
        ? undefined : seconds + state.timerDurationSeconds);
      for (const transition of state.transitions) {
        let nextSeconds: number;
        let nextHarvest = harvest;
        if (transition.kind === "elapsed") {
          if (deadline === undefined) throw new Error(`田块计时器缺失：${entity.id}/${stateId}`);
          nextSeconds = Math.max(seconds, deadline);
        } else {
          const recipe = recipeById.get(transition.recipeId);
          if (!recipe || recipe.machineId !== entity.id || state.enterRecipeId !== recipe.id
            || !(recipe.durationSeconds > 0)) throw new Error(`无效田块阶段配方：${transition.recipeId}`);
          nextSeconds = seconds + recipe.durationSeconds;
          // 育种与生长并行；超过生长期的育种不能完成，也不能延长生长周期。
          if (deadline !== undefined && nextSeconds > deadline
            && state.transitions.some(candidate => candidate.kind === "elapsed")) continue;
          if (recipe.outputs.length > 0) {
            if (harvest) throw new Error(`田块路径重复收获：${entity.id}/${stateId}`);
            nextHarvest = recipe;
          }
        }
        visit(transition.nextStateId, nextSeconds, transition.inheritTimer ? deadline : undefined,
          [...path, stateId], nextHarvest);
      }
    };
    visit(machine.initialStateId, 0, undefined, [], undefined);
  }
  return result;
}
