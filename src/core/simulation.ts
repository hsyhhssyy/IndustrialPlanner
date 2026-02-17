import {
  DEFAULT_EXTERNAL_INVENTORY,
  EMPTY_RUNTIME_STOCK,
  type ItemId,
  type RuntimeStock,
  type StoreSnapshot,
} from "../types/domain"

export type RuntimeResetResult = {
  externalInventory: Record<ItemId, number>
  runtimeStock: RuntimeStock
  machineProgress: Record<string, number>
  productionPerMin: Record<ItemId, number>
  consumptionPerMin: Record<ItemId, number>
}

export function createInitialSnapshot(): StoreSnapshot {
  return {
    externalInventory: { ...DEFAULT_EXTERNAL_INVENTORY },
    runtimeStock: { ...EMPTY_RUNTIME_STOCK },
    machineProgress: {},
  }
}

export function fullRuntimeReset(): RuntimeResetResult {
  return {
    externalInventory: { ...DEFAULT_EXTERNAL_INVENTORY },
    runtimeStock: {
      machineInternal: {},
      beltInTransit: {},
    },
    machineProgress: {},
    productionPerMin: {
      originium_ore: 0,
      originium_powder: 0,
    },
    consumptionPerMin: {
      originium_ore: 0,
      originium_powder: 0,
    },
  }
}
