import { RECIPES } from '../registry'
import type { DeviceTypeId } from '../types'

export function recipeForDevice(typeId: DeviceTypeId) {
  return RECIPES.find((recipe) => recipe.machineType === typeId)
}