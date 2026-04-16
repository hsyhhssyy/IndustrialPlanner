import type { DeviceInstance } from '../../domain/types'

export const REACTOR_POOL_TYPE_ID: DeviceInstance['typeId'] = 'item_port_mix_pool_1'
export const LARGE_REACTOR_POOL_TYPE_ID: DeviceInstance['typeId'] = 'item_port_mix_pool_large_1'

export type ReactorPoolTypeId = typeof REACTOR_POOL_TYPE_ID | typeof LARGE_REACTOR_POOL_TYPE_ID

export type ReactorSolidInputPortId = 'in_s_1' | 'in_s_2' | 'in_s_3' | 'in_s_4'
export type ReactorSolidOutputPortId = 'out_n_1' | 'out_n_2' | 'out_n_3' | 'out_n_4'
export type ReactorLiquidInputPortId = 'in_e_1' | 'in_e_3'
export type ReactorLiquidOutputPortId = 'out_w_1' | 'out_w_3'

export type ReactorInputPortId = ReactorSolidInputPortId | ReactorLiquidInputPortId
export type ReactorOutputPortId = ReactorSolidOutputPortId | ReactorLiquidOutputPortId

type ReactorPoolSpec = {
  sharedSlotCount: number
  recipeSlotCount: number
  solidInputPortIds: ReactorSolidInputPortId[]
  solidOutputPortIds: ReactorSolidOutputPortId[]
  liquidInputPortIds: ReactorLiquidInputPortId[]
  liquidOutputPortIds: ReactorLiquidOutputPortId[]
}

const REACTOR_POOL_SPEC_BY_TYPE_ID: Record<ReactorPoolTypeId, ReactorPoolSpec> = {
  item_port_mix_pool_1: {
    sharedSlotCount: 5,
    recipeSlotCount: 2,
    solidInputPortIds: ['in_s_1', 'in_s_3'],
    solidOutputPortIds: ['out_n_1', 'out_n_3'],
    liquidInputPortIds: ['in_e_1', 'in_e_3'],
    liquidOutputPortIds: ['out_w_1', 'out_w_3'],
  },
  item_port_mix_pool_large_1: {
    sharedSlotCount: 8,
    recipeSlotCount: 4,
    solidInputPortIds: ['in_s_1', 'in_s_2', 'in_s_3', 'in_s_4'],
    solidOutputPortIds: ['out_n_1', 'out_n_2', 'out_n_3', 'out_n_4'],
    liquidInputPortIds: ['in_e_1', 'in_e_3'],
    liquidOutputPortIds: ['out_w_1', 'out_w_3'],
  },
}

const ALL_REACTOR_SOLID_INPUT_PORT_IDS = new Set<string>(
  Object.values(REACTOR_POOL_SPEC_BY_TYPE_ID).flatMap((spec) => spec.solidInputPortIds),
)
const ALL_REACTOR_SOLID_OUTPUT_PORT_IDS = new Set<string>(
  Object.values(REACTOR_POOL_SPEC_BY_TYPE_ID).flatMap((spec) => spec.solidOutputPortIds),
)
const ALL_REACTOR_LIQUID_INPUT_PORT_IDS = new Set<string>(
  Object.values(REACTOR_POOL_SPEC_BY_TYPE_ID).flatMap((spec) => spec.liquidInputPortIds),
)
const ALL_REACTOR_LIQUID_OUTPUT_PORT_IDS = new Set<string>(
  Object.values(REACTOR_POOL_SPEC_BY_TYPE_ID).flatMap((spec) => spec.liquidOutputPortIds),
)

export function isReactorPoolType(typeId: DeviceInstance['typeId']): typeId is ReactorPoolTypeId {
  return typeId === REACTOR_POOL_TYPE_ID || typeId === LARGE_REACTOR_POOL_TYPE_ID
}

export function getReactorPoolSpec(typeId: DeviceInstance['typeId']): ReactorPoolSpec | null {
  if (!isReactorPoolType(typeId)) return null
  return REACTOR_POOL_SPEC_BY_TYPE_ID[typeId]
}

export function getReactorSharedSlotCount(typeId: DeviceInstance['typeId']) {
  return getReactorPoolSpec(typeId)?.sharedSlotCount ?? 0
}

export function getReactorRecipeSlotCount(typeId: DeviceInstance['typeId']) {
  return getReactorPoolSpec(typeId)?.recipeSlotCount ?? 0
}

export function getReactorSolidInputPortIds(typeId: DeviceInstance['typeId']) {
  return getReactorPoolSpec(typeId)?.solidInputPortIds ?? []
}

export function getReactorSolidOutputPortIds(typeId: DeviceInstance['typeId']) {
  return getReactorPoolSpec(typeId)?.solidOutputPortIds ?? []
}

export function getReactorLiquidInputPortIds(typeId: DeviceInstance['typeId']) {
  return getReactorPoolSpec(typeId)?.liquidInputPortIds ?? []
}

export function getReactorLiquidOutputPortIds(typeId: DeviceInstance['typeId']) {
  return getReactorPoolSpec(typeId)?.liquidOutputPortIds ?? []
}

export function isReactorSolidOutputPort(portId: string): portId is ReactorSolidOutputPortId {
  return ALL_REACTOR_SOLID_OUTPUT_PORT_IDS.has(portId)
}

export function isReactorLiquidOutputPort(portId: string): portId is ReactorLiquidOutputPortId {
  return ALL_REACTOR_LIQUID_OUTPUT_PORT_IDS.has(portId)
}

export function isReactorSolidInputPort(portId: string): portId is ReactorSolidInputPortId {
  return ALL_REACTOR_SOLID_INPUT_PORT_IDS.has(portId)
}

export function isReactorLiquidInputPort(portId: string): portId is ReactorLiquidInputPortId {
  return ALL_REACTOR_LIQUID_INPUT_PORT_IDS.has(portId)
}
