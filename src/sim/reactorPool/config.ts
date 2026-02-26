import type { DeviceConfig } from '../../domain/types'
import { ITEM_BY_ID } from '../../domain/registry'
import { clampRecipeIdsMax2 } from './slotMap'

export type NormalizedReactorPoolConfig = {
  selectedRecipeIds: string[]
  solidOutputItemId?: string
  liquidOutputItemIdA?: string
  liquidOutputItemIdB?: string
}

export function normalizeReactorPoolConfig(deviceConfig: DeviceConfig | undefined): NormalizedReactorPoolConfig {
  const selected = clampRecipeIdsMax2(deviceConfig?.reactorPool?.selectedRecipeIds ?? [])

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
