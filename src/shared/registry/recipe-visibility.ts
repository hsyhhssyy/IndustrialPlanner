import type { RecipeDefinition } from "@/domain/registry/types/recipe-definition";

export const TOOLBOX_HIDDEN_RECIPE_TAG = "ToolboxHidden";
export const LIQUID_FILLING_RECIPE_TAG = "bottle_filling";
export const LIQUID_DISMANTLE_RECIPE_TAG = "liquid_bottle_dismantle";
export const WIKI_DEFAULT_CRAFT_RECIPE_TAG = "wiki_default_craft";

export function isRecipeVisibleInToolbox(
  recipe: Pick<RecipeDefinition, "tags">,
): boolean {
  return !recipe.tags.includes(TOOLBOX_HIDDEN_RECIPE_TAG);
}

export function compareRecipesByDefaultPriority(
  left: Pick<RecipeDefinition, "id" | "tags">,
  right: Pick<RecipeDefinition, "id" | "tags">,
): number {
  const priorityDifference = resolveRecipeDefaultPriority(left) - resolveRecipeDefaultPriority(right);
  return priorityDifference || left.id.localeCompare(right.id);
}

export function sortRecipesByDefaultPriority<T extends Pick<RecipeDefinition, "id" | "tags">>(
  recipes: readonly T[],
): T[] {
  return [...recipes].sort(compareRecipesByDefaultPriority);
}

function resolveRecipeDefaultPriority(recipe: Pick<RecipeDefinition, "tags">): number {
  if (
    recipe.tags.includes(LIQUID_FILLING_RECIPE_TAG)
    || recipe.tags.includes(LIQUID_DISMANTLE_RECIPE_TAG)
  ) {
    return 2;
  }
  return recipe.tags.includes(WIKI_DEFAULT_CRAFT_RECIPE_TAG) ? 0 : 1;
}
