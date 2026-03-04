import { RECIPES } from '../registry'
import type { DeviceTypeId } from '../types'

export function recipeForDevice(typeId: DeviceTypeId, recipeId?: string) {
  if (!recipeId) return undefined
  const activeRecipe = RECIPES.find((recipe) => recipe.id === recipeId)
  if (activeRecipe && activeRecipe.machineType === typeId) return activeRecipe
  return undefined
}