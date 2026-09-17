import type { RecipeDefinition } from "@/domain/registry/types/recipe-definition";

export const TOOLBOX_HIDDEN_RECIPE_TAG = "ToolboxHidden";
export const LIQUID_FILLING_RECIPE_TAG = "bottle_filling";
export const LIQUID_DISMANTLE_RECIPE_TAG = "liquid_bottle_dismantle";

export function isRecipeVisibleInToolbox(
  recipe: Pick<RecipeDefinition, "tags">,
): boolean {
  return !recipe.tags.includes(TOOLBOX_HIDDEN_RECIPE_TAG);
}
