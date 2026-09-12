import type { SimulationDeviceOperatingStatus } from '@/domain/simulation';

const STATUS_KEY_BY_OPERATING_STATUS: Readonly<Record<SimulationDeviceOperatingStatus, number>> = {
  closed: 1,
  idle: 3,
  normal: 4,
  blocked: 5,
  'no-power': 6,
  'not-in-power-net': 7,
};

/** 将项目语义状态转换为素材包 FacEffectCfg 的 statusKey。 */
export function resolveBuildingEffectStatusKey(status: SimulationDeviceOperatingStatus): number {
  return STATUS_KEY_BY_OPERATING_STATUS[status];
}
