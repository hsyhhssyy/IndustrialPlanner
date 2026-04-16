import type { DeviceConfig, DeviceInstance } from '../../domain/types'
import { ITEM_BY_ID } from '../../domain/registry'
import { clampRecipeIds } from './slotMap'
import { getReactorRecipeSlotCount, isReactorPoolType, LARGE_REACTOR_POOL_TYPE_ID } from './types'

const LARGE_REACTOR_RECIPE_ID_BY_LEGACY_ID: Record<string, string> = {
  r_chrono_mix_pool_xiranite_waste_liquids_from_liquid_xiranite_and_wastewater_basic:
    'r_chrono_mix_pool_xiranite_waste_liquids_from_liquid_xiranite_and_wastewater_basic_large',
  r_chrono_mix_pool_inert_waste_liquid_water_slag_from_waste_liquid_and_iron_powder_basic:
    'r_chrono_mix_pool_inert_waste_liquid_water_slag_from_waste_liquid_and_iron_powder_basic_large',
  r_mix_pool_liquid_plant_grass_1_from_powder_and_water_basic:
    'r_mix_pool_liquid_plant_grass_1_from_powder_and_water_basic_large',
  r_mix_pool_liquid_plant_grass_2_from_powder_and_water_basic:
    'r_mix_pool_liquid_plant_grass_2_from_powder_and_water_basic_large',
  r_mix_pool_liquid_xiranite_from_xiranite_powder_and_water_basic:
    'r_mix_pool_liquid_xiranite_from_xiranite_powder_and_water_basic_large',
}

function normalizeReactorRecipeId(deviceTypeId: DeviceInstance['typeId'] | undefined, recipeId: string) {
  if (deviceTypeId !== LARGE_REACTOR_POOL_TYPE_ID) return recipeId
  return LARGE_REACTOR_RECIPE_ID_BY_LEGACY_ID[recipeId] ?? recipeId
}

export type NormalizedReactorPoolConfig = {
  selectedRecipeIds: string[]
  solidOutputItemId?: string
  liquidOutputItemIdA?: string
  liquidOutputItemIdB?: string
}

export function normalizeReactorPoolConfig(
  deviceTypeId: DeviceInstance['typeId'] | undefined,
  deviceConfig: DeviceConfig | undefined,
): NormalizedReactorPoolConfig {
  const recipeSlotCount = isReactorPoolType(deviceTypeId ?? 'item_port_mix_pool_1')
    ? getReactorRecipeSlotCount(deviceTypeId ?? 'item_port_mix_pool_1')
    : 2
  const selected = clampRecipeIds(
    (deviceConfig?.reactorPool?.selectedRecipeIds ?? []).map((recipeId) => normalizeReactorRecipeId(deviceTypeId, recipeId)),
    recipeSlotCount,
  )

  const solidCandidate = deviceConfig?.reactorPool?.solidOutputItemId
  const liquidCandidateLegacy = deviceConfig?.reactorPool?.liquidOutputItemId
  const liquidCandidateA = deviceConfig?.reactorPool?.liquidOutputItemIdA ?? liquidCandidateLegacy
  const liquidCandidateB = deviceConfig?.reactorPool?.liquidOutputItemIdB ?? liquidCandidateLegacy
  const solidOutputItemId = solidCandidate && ITEM_BY_ID[solidCandidate]?.type === 'solid' ? solidCandidate : undefined
  const liquidOutputItemIdA = liquidCandidateA && ITEM_BY_ID[liquidCandidateA]?.type === 'liquid' ? liquidCandidateA : undefined
  const liquidOutputItemIdB = liquidCandidateB && ITEM_BY_ID[liquidCandidateB]?.type === 'liquid' ? liquidCandidateB : undefined

  return {
    selectedRecipeIds: selected,
    solidOutputItemId,
    liquidOutputItemIdA,
    liquidOutputItemIdB,
  }
}
