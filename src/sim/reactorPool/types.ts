import type { DeviceInstance } from '../../domain/types'

export const REACTOR_POOL_TYPE_ID: DeviceInstance['typeId'] = 'item_port_mix_pool_1'

export type ReactorSolidInputPortId = 'in_s_1' | 'in_s_3'
export type ReactorSolidOutputPortId = 'out_n_1' | 'out_n_3'
export type ReactorLiquidInputPortId = 'in_e_1' | 'in_e_3'
export type ReactorLiquidOutputPortId = 'out_w_1' | 'out_w_3'

export type ReactorInputPortId = ReactorSolidInputPortId | ReactorLiquidInputPortId
export type ReactorOutputPortId = ReactorSolidOutputPortId | ReactorLiquidOutputPortId

export const REACTOR_SHARED_SLOT_COUNT = 5

export function isReactorPoolType(typeId: DeviceInstance['typeId']) {
  return typeId === REACTOR_POOL_TYPE_ID
}

export function isReactorSolidOutputPort(portId: string): portId is ReactorSolidOutputPortId {
  return portId === 'out_n_1' || portId === 'out_n_3'
}

export function isReactorLiquidOutputPort(portId: string): portId is ReactorLiquidOutputPortId {
  return portId === 'out_w_1' || portId === 'out_w_3'
}
