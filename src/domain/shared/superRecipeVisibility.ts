import type { DeviceTypeDef, ItemDef, RecipeDef } from '../types'

export const SUPER_RECIPE_TAG = '超时空'

function hasTag(tags: string[] | undefined, tag: string) {
  return Boolean(tags?.includes(tag))
}

export function isSuperRecipeItem(item: ItemDef) {
  return hasTag(item.tags, SUPER_RECIPE_TAG)
}

export function isSuperRecipeDevice(device: DeviceTypeDef) {
  return hasTag(device.tags, SUPER_RECIPE_TAG)
}

export function isSuperRecipeRecipe(
  recipe: RecipeDef,
  options: {
    getItemById: (itemId: string) => ItemDef | undefined
    getDeviceById: (deviceId: string) => DeviceTypeDef | undefined
  },
) {
  if (hasTag(recipe.tags, SUPER_RECIPE_TAG)) return true
  const machine = options.getDeviceById(recipe.machineType)
  if (machine && isSuperRecipeDevice(machine)) return true
  const hasTaggedItem = [...recipe.inputs, ...recipe.outputs].some((entry) => {
    const item = options.getItemById(entry.itemId)
    return item ? isSuperRecipeItem(item) : false
  })
  return hasTaggedItem
}

export function shouldShowSuperRecipeContent(superRecipeEnabled: boolean, isSuperRecipeContent: boolean) {
  if (superRecipeEnabled) return true
  return !isSuperRecipeContent
}
