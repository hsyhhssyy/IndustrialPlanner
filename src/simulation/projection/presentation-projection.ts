import type {
  RuntimeDeviceSnapshot,
  RuntimeGasDiffusionSnapshot,
  RuntimeNodeSnapshot,
  RuntimeTickSnapshot,
  RuntimeTransferSnapshot,
  WarehouseStats,
} from "../types";

export interface SimulationPresentationProjection {
  readonly tickNumber: number | null;
  readonly status: RuntimeTickSnapshot["status"] | null;
  readonly debugData: string | undefined;
  readonly totalPowerDemand: number | null;
  readonly currentPowerGeneration: number | null;
  readonly isPowerOutage: boolean;
  getSlot(slotId: string): RuntimeTickSnapshot["slots"][string] | null;
  getDevice(deviceId: string): RuntimeDeviceSnapshot | null;
  getNode(nodeId: string): RuntimeNodeSnapshot | null;
  getTransportComponentItemType(componentId: string): string | null;
  getTransfers(): readonly RuntimeTransferSnapshot[];
  getDiagnostics(): readonly RuntimeTickSnapshot["diagnostics"][number][];
  getGasDiffusions(): readonly RuntimeGasDiffusionSnapshot[];
  getWarehouseStats(): WarehouseStats | null;
}

export class LegacySnapshotPresentationProjection implements SimulationPresentationProjection {
  public constructor(private readonly readSnapshot: () => RuntimeTickSnapshot | null) {}

  public get tickNumber(): number | null {
    return this.readSnapshot()?.tickNumber ?? null;
  }

  public get status(): RuntimeTickSnapshot["status"] | null {
    return this.readSnapshot()?.status ?? null;
  }

  public get debugData(): string | undefined {
    return this.readSnapshot()?.debugData;
  }

  public get totalPowerDemand(): number | null {
    return this.readSnapshot()?.totalPowerDemand ?? null;
  }

  public get currentPowerGeneration(): number | null {
    return this.readSnapshot()?.currentPowerGeneration ?? null;
  }

  public get isPowerOutage(): boolean {
    return this.readSnapshot()?.isPowerOutage ?? false;
  }

  public getSlot(slotId: string): RuntimeTickSnapshot["slots"][string] | null {
    return this.readSnapshot()?.slots[slotId] ?? null;
  }

  public getDevice(deviceId: string): RuntimeDeviceSnapshot | null {
    return this.readSnapshot()?.devices[deviceId] ?? null;
  }

  public getNode(nodeId: string): RuntimeNodeSnapshot | null {
    return this.readSnapshot()?.nodes[nodeId] ?? null;
  }

  public getTransportComponentItemType(componentId: string): string | null {
    return this.readSnapshot()?.transportComponentDomain[componentId] ?? null;
  }

  public getTransfers(): readonly RuntimeTransferSnapshot[] {
    return this.readSnapshot()?.transfers ?? [];
  }

  public getDiagnostics(): readonly RuntimeTickSnapshot["diagnostics"][number][] {
    return this.readSnapshot()?.diagnostics ?? [];
  }

  public getGasDiffusions(): readonly RuntimeGasDiffusionSnapshot[] {
    return this.readSnapshot()?.gasDiffusions ?? [];
  }

  public getWarehouseStats(): WarehouseStats | null {
    return this.readSnapshot()?.warehouseStats ?? null;
  }
}
