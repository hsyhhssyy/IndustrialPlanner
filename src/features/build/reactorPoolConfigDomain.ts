import { useCallback } from 'react'
import type { ItemId, LayoutState } from '../../domain/types'
import { ITEM_BY_ID } from '../../domain/registry'
import { normalizeReactorPoolConfig } from '../../sim/reactorPool'

type SetLayout = (updater: LayoutState | ((current: LayoutState) => LayoutState)) => void

function patchReactorConfig(
  setLayout: SetLayout,
  deviceInstanceId: string,
  updater: (
    current: NonNullable<LayoutState['devices'][number]['config']['reactorPool']>,
  ) => NonNullable<LayoutState['devices'][number]['config']['reactorPool']>,
) {
  setLayout((current) => ({
    ...current,
    devices: current.devices.map((device) => {
      if (device.instanceId !== deviceInstanceId || device.typeId !== 'item_port_mix_pool_1') return device
      const normalized = normalizeReactorPoolConfig(device.config)
      const next = updater({
        selectedRecipeIds: normalized.selectedRecipeIds,
        solidOutputItemId: normalized.solidOutputItemId,
        liquidOutputItemIdA: normalized.liquidOutputItemIdA,
        liquidOutputItemIdB: normalized.liquidOutputItemIdB,
      })
      return {
        ...device,
        config: {
          ...device.config,
          reactorPool: next,
        },
      }
    }),
  }))
}

export function useReactorPoolConfigDomain({ setLayout }: { setLayout: SetLayout }) {
  const updateReactorSelectedRecipe = useCallback(
    (deviceInstanceId: string, slotIndex: 0 | 1, recipeId: string | null) => {
      patchReactorConfig(setLayout, deviceInstanceId, (currentConfig) => {
        const next = [...(currentConfig.selectedRecipeIds ?? [])]
        if (slotIndex >= next.length) {
          while (next.length <= slotIndex) next.push('')
        }
        next[slotIndex] = recipeId ?? ''
        const selectedRecipeIds = Array.from(new Set(next.filter((id) => id.trim().length > 0))).slice(0, 2)

        return {
          ...currentConfig,
          selectedRecipeIds,
        }
      })
    },
    [setLayout],
  )

  const updateReactorSolidOutputItem = useCallback(
    (deviceInstanceId: string, itemId: ItemId | null) => {
      patchReactorConfig(setLayout, deviceInstanceId, (currentConfig) => ({
        ...currentConfig,
        solidOutputItemId: itemId && ITEM_BY_ID[itemId]?.type === 'solid' ? itemId : undefined,
      }))
    },
    [setLayout],
  )

  const updateReactorLiquidOutputItemA = useCallback(
    (deviceInstanceId: string, itemId: ItemId | null) => {
      patchReactorConfig(setLayout, deviceInstanceId, (currentConfig) => ({
        ...currentConfig,
        liquidOutputItemIdA: itemId && ITEM_BY_ID[itemId]?.type === 'liquid' ? itemId : undefined,
      }))
    },
    [setLayout],
  )

  const updateReactorLiquidOutputItemB = useCallback(
    (deviceInstanceId: string, itemId: ItemId | null) => {
      patchReactorConfig(setLayout, deviceInstanceId, (currentConfig) => ({
        ...currentConfig,
        liquidOutputItemIdB: itemId && ITEM_BY_ID[itemId]?.type === 'liquid' ? itemId : undefined,
      }))
    },
    [setLayout],
  )

  return {
    updateReactorSelectedRecipe,
    updateReactorSolidOutputItem,
    updateReactorLiquidOutputItemA,
    updateReactorLiquidOutputItemB,
  }
}
