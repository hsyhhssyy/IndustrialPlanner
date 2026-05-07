
export interface SimulationDeviceRuntimeStatusReadModel {
  readonly recipeId: string | null;
  readonly progressSeconds: number | null;
  readonly desiredSeconds: number | null;
  readonly slotItems: readonly SimulationDeviceRuntimeSlotItemReadModel[];
}

export interface SimulationDeviceRuntimeSlotItemReadModel {
  readonly slotId: string;
  readonly itemType: string | null;
  readonly count: number;
  readonly reserved: number;
}

export interface SimulationQuery {
  getStatusRuntimeJson(): String;
  getDeviceRuntimeStatus(deviceId: string): SimulationDeviceRuntimeStatusReadModel | null;
}
