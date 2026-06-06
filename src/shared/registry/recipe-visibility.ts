import type { RecipeDefinition } from "@/domain/registry/types/recipe-definition";

export const TOOLBOX_HIDDEN_RECIPE_TAG = "ToolboxHidden";

export function isRecipeVisibleInToolbox(
  recipe: Pick<RecipeDefinition, "tags">,
): boolean {
  return !recipe.tags.includes(TOOLBOX_HIDDEN_RECIPE_TAG);
}
