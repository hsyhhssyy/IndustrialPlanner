
export interface SimulationDeviceRuntimeStatusReadModel {
  readonly recipeId: string | null;
  readonly progressSeconds: number | null;
  readonly desiredSeconds: number | null;
  readonly slotItems: readonly SimulationDeviceRuntimeSlotItemReadModel[];
}

export interface SimulationDeviceRuntimeSlotItemReadModel {
  readonly slotType: "ingredient" | "product" | "universal";
  readonly storageGroupId: string;
  readonly slotId: string;
  readonly viewRole: "single-view" | "input-view" | "output-view";
  readonly itemType: string | null;
  readonly count: number;
  readonly reserved: number;
}

export interface SimulationQuery {
  getStatusRuntimeJson(): string;
  getDeviceRuntimeStatus(deviceId: string): SimulationDeviceRuntimeStatusReadModel | null;
}
