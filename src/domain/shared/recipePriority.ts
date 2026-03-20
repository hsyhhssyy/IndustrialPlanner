import type { RecipeDef } from '../types'

export const LIQUID_BOTTLE_DISMANTLE_RECIPE_TAG = 'liquid_bottle_dismantle'

export function isLiquidBottleDismantleRecipe(recipe: Pick<RecipeDef, 'tags'> | null | undefined) {
  return recipe?.tags?.includes(LIQUID_BOTTLE_DISMANTLE_RECIPE_TAG) ?? false
}

export function prioritizeNonBottleDismantleRecipes<T extends Pick<RecipeDef, 'tags'>>(recipes: T[]) {
  const hasNonDismantleRecipe = recipes.some((recipe) => !isLiquidBottleDismantleRecipe(recipe))
  if (!hasNonDismantleRecipe) return recipes
  return [...recipes].sort((left, right) => {
    const leftRank = isLiquidBottleDismantleRecipe(left) ? 1 : 0
    const rightRank = isLiquidBottleDismantleRecipe(right) ? 1 : 0
    return leftRank - rightRank
  })
}