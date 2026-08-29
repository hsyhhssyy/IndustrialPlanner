import type { RecipeDefinition } from "@/domain/registry/types/recipe-definition";

import { CONSUMPTION_RECIPE_TAG } from "./consumption-channel";

export function buildDeviceRunningConsumptionRecipesByMachine(
  recipeDefinitions: readonly RecipeDefinition[],
): Map<string, RecipeDefinition[]> {
  const recipesByMachine = new Map<string, RecipeDefinition[]>();
  for (const recipe of recipeDefinitions) {
    if (!recipe.tags.includes(CONSUMPTION_RECIPE_TAG)) {
      continue;
    }

    const recipes = recipesByMachine.get(recipe.machineId);
    if (recipes === undefined) {
      recipesByMachine.set(recipe.machineId, [recipe]);
    } else {
      recipes.push(recipe);
    }
  }

  return recipesByMachine;
}

export function resolveCompanionDeviceRunningConsumptionRecipe(
  hostRecipe: RecipeDefinition,
  recipesByMachine: ReadonlyMap<string, readonly RecipeDefinition[]>,
): RecipeDefinition | undefined {
  if (hostRecipe.tags.includes(CONSUMPTION_RECIPE_TAG)) {
    return undefined;
  }

  const consumptionRecipes = recipesByMachine.get(hostRecipe.machineId) ?? [];
  return consumptionRecipes.find((candidate) =>
    candidate.inputs.some((consumptionInput) =>
      hostRecipe.inputs.some((input) => input.itemId === consumptionInput.itemId),
    ),
  ) ?? consumptionRecipes[0];
}
