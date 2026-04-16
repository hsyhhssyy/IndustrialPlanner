import { useCallback } from 'react'
import type { ItemId, LayoutState } from '../../domain/types'
import { ITEM_BY_ID } from '../../domain/registry'
import { getReactorRecipeSlotCount, isReactorPoolType, normalizeReactorPoolConfig } from '../../sim/reactorPool'

type SetLayout = (updater: LayoutState | ((current: LayoutState) => LayoutState)) => void

function patchReactorConfig(
  setLayout: SetLayout,
  deviceInstanceId: string,
  updater: (
    current: NonNullable<LayoutState['devices'][number]['config']['reactorPool']>,
    deviceTypeId: LayoutState['devices'][number]['typeId'],
  ) => NonNullable<LayoutState['devices'][number]['config']['reactorPool']>,
) {
  setLayout((current) => ({
    ...current,
    devices: current.devices.map((device) => {
      if (device.instanceId !== deviceInstanceId || !isReactorPoolType(device.typeId)) return device
      const normalized = normalizeReactorPoolConfig(device.typeId, device.config)
      const next = updater({
        selectedRecipeIds: normalized.selectedRecipeIds,
        solidOutputItemId: normalized.solidOutputItemId,
        liquidOutputItemIdA: normalized.liquidOutputItemIdA,
        liquidOutputItemIdB: normalized.liquidOutputItemIdB,
      }, device.typeId)
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
    (deviceInstanceId: string, slotIndex: number, recipeId: string | null) => {
      patchReactorConfig(setLayout, deviceInstanceId, (currentConfig, deviceTypeId) => {
        const next = [...(currentConfig.selectedRecipeIds ?? [])]
        if (slotIndex >= next.length) {
          while (next.length <= slotIndex) next.push('')
        }
        next[slotIndex] = recipeId ?? ''
        const selectedRecipeIds = Array.from(new Set(next.filter((id) => id.trim().length > 0))).slice(
          0,
          getReactorRecipeSlotCount(deviceTypeId),
        )

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
