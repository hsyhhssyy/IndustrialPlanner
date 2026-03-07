import { RECIPES } from '../registry'
import type { DeviceTypeId, ItemId, RecipeDef } from '../types'

const THERMAL_POOL_TYPE_ID: DeviceTypeId = 'item_port_power_sta_1'

const THERMAL_POOL_FUEL_RULES: Array<{ itemId: ItemId; burnSeconds: number; powerKw: number }> = [
  { itemId: 'item_originium_ore', burnSeconds: 8, powerKw: 50 },
  { itemId: 'item_proc_battery_1', burnSeconds: 40, powerKw: 220 },
  { itemId: 'item_proc_battery_2', burnSeconds: 40, powerKw: 420 },
  { itemId: 'item_proc_battery_3', burnSeconds: 40, powerKw: 1100 },
  { itemId: 'item_proc_battery_4', burnSeconds: 40, powerKw: 1600 },
]

export const THERMAL_POOL_VIRTUAL_RECIPES: RecipeDef[] = THERMAL_POOL_FUEL_RULES.map((rule) => ({
  id: `virtual_thermal_pool_${rule.itemId}`,
  machineType: THERMAL_POOL_TYPE_ID,
  cycleSeconds: rule.burnSeconds,
  inputs: [{ itemId: rule.itemId, amount: 1 }],
  outputs: [],
}))

export const THERMAL_POOL_POWER_BY_RECIPE_ID = new Map(
  THERMAL_POOL_VIRTUAL_RECIPES.map((recipe, index) => [recipe.id, THERMAL_POOL_FUEL_RULES[index].powerKw]),
)

export function recipeById(recipeId?: string) {
  if (!recipeId) return undefined
  return RECIPES.find((recipe) => recipe.id === recipeId) ?? THERMAL_POOL_VIRTUAL_RECIPES.find((recipe) => recipe.id === recipeId)
}

export function recipesForDevice(typeId: DeviceTypeId) {
  if (typeId === THERMAL_POOL_TYPE_ID) return THERMAL_POOL_VIRTUAL_RECIPES
  return RECIPES.filter((recipe) => recipe.machineType === typeId)
}

export function recipeForDevice(typeId: DeviceTypeId, recipeId?: string) {
  const activeRecipe = recipeById(recipeId)
  if (!activeRecipe) return undefined
  if (activeRecipe && activeRecipe.machineType === typeId) return activeRecipe
  return undefined
}