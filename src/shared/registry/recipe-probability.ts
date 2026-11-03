import type { RecipeDefinition } from "@/domain/registry/types/recipe-definition";

/** 概率使用比例值；省略表示普通配方，配置值必须是有限正数。 */
export function validateRecipeProbability(recipe: Pick<RecipeDefinition, "id" | "probability">): void {
  if (recipe.probability !== undefined
    && (!Number.isFinite(recipe.probability) || recipe.probability <= 0)) {
    throw new Error(`Invalid probability on recipe "${recipe.id}": ${String(recipe.probability)}; expected a finite positive number.`);
  }
}
