import type {
  RuntimeDeviceSnapshot,
  RuntimeSlotSnapshot,
  RuntimeNodeSnapshot,
  RuntimeTransferSnapshot,
  RuntimeDiagnosticSnapshot,
  RuntimeGasDiffusionSnapshot,
  WarehouseStats,
} from "@/simulation/contracts";

export interface SimulationPresentationProjection {
  readonly tickNumber: number | null;
  readonly standardTickRate: number | null;
  readonly tickRate: number | null;
  readonly status: "initial" | "running" | null;
  readonly debugData: string | undefined;
  readonly totalPowerDemand: number | null;
  readonly currentPowerGeneration: number | null;
  readonly isPowerOutage: boolean;
  getSlot(slotId: string): RuntimeSlotSnapshot | null;
  getDevice(deviceId: string): RuntimeDeviceSnapshot | null;
  getNode(nodeId: string): RuntimeNodeSnapshot | null;
  getTransportComponentItemType(componentId: string): string | null;
  getTransfers(): readonly RuntimeTransferSnapshot[];
  getDiagnostics(): readonly RuntimeDiagnosticSnapshot[];
  getGasDiffusions(): readonly RuntimeGasDiffusionSnapshot[];
  getWarehouseStats(): WarehouseStats | null;
}

// AI-REMOVED 2026-09-09:
// Reason: 展示接口解除完整快照类型绑定，legacy adapter 归还 legacy。
// Trigger: 用户授权抽离 dense / legacy 公共接口并重组 legacy。
// Evidence: 两个 Host 共用契约与投影，旧入口混合查询、Worker bridge 和 legacy 控制状态。
// Replacement: src/simulation/legacy/snapshot-projection.ts；本文件的投影接口
// Risk: 异步生命周期和查询语义需由双引擎回归验证。
// Human Review: Required
//
// Original code:
// import type {
//   RuntimeDeviceSnapshot,
//   RuntimeGasDiffusionSnapshot,
//   RuntimeNodeSnapshot,
//   RuntimeTickSnapshot,
//   RuntimeTransferSnapshot,
//   WarehouseStats,
// } from "../types";
//
// export interface SimulationPresentationProjection {
//   readonly tickNumber: number | null;
//   readonly standardTickRate: number | null;
//   readonly tickRate: number | null;
//   readonly status: RuntimeTickSnapshot["status"] | null;
//   readonly debugData: string | undefined;
//   readonly totalPowerDemand: number | null;
//   readonly currentPowerGeneration: number | null;
//   readonly isPowerOutage: boolean;
//   getSlot(slotId: string): RuntimeTickSnapshot["slots"][string] | null;
//   getDevice(deviceId: string): RuntimeDeviceSnapshot | null;
//   getNode(nodeId: string): RuntimeNodeSnapshot | null;
//   getTransportComponentItemType(componentId: string): string | null;
//   getTransfers(): readonly RuntimeTransferSnapshot[];
//   getDiagnostics(): readonly RuntimeTickSnapshot["diagnostics"][number][];
//   getGasDiffusions(): readonly RuntimeGasDiffusionSnapshot[];
//   getWarehouseStats(): WarehouseStats | null;
// }
//
// export class LegacySnapshotPresentationProjection implements SimulationPresentationProjection {
//   public constructor(private readonly readSnapshot: () => RuntimeTickSnapshot | null) {}
//
//   public get tickNumber(): number | null {
//     return this.readSnapshot()?.tickNumber ?? null;
//   }
//
//   public get standardTickRate(): number | null {
//     return this.readSnapshot()?.standardTickRate ?? null;
//   }
//
//   public get tickRate(): number | null {
//     return this.readSnapshot()?.tickRate ?? null;
//   }
//
//   public get status(): RuntimeTickSnapshot["status"] | null {
//     return this.readSnapshot()?.status ?? null;
//   }
//
//   public get debugData(): string | undefined {
//     return this.readSnapshot()?.debugData;
//   }
//
//   public get totalPowerDemand(): number | null {
//     return this.readSnapshot()?.totalPowerDemand ?? null;
//   }
//
//   public get currentPowerGeneration(): number | null {
//     return this.readSnapshot()?.currentPowerGeneration ?? null;
//   }
//
//   public get isPowerOutage(): boolean {
//     return this.readSnapshot()?.isPowerOutage ?? false;
//   }
//
//   public getSlot(slotId: string): RuntimeTickSnapshot["slots"][string] | null {
//     return this.readSnapshot()?.slots[slotId] ?? null;
//   }
//
//   public getDevice(deviceId: string): RuntimeDeviceSnapshot | null {
//     return this.readSnapshot()?.devices[deviceId] ?? null;
//   }
//
//   public getNode(nodeId: string): RuntimeNodeSnapshot | null {
//     return this.readSnapshot()?.nodes[nodeId] ?? null;
//   }
//
//   public getTransportComponentItemType(componentId: string): string | null {
//     return this.readSnapshot()?.transportComponentDomain[componentId] ?? null;
//   }
//
//   public getTransfers(): readonly RuntimeTransferSnapshot[] {
//     return this.readSnapshot()?.transfers ?? [];
//   }
//
//   public getDiagnostics(): readonly RuntimeTickSnapshot["diagnostics"][number][] {
//     return this.readSnapshot()?.diagnostics ?? [];
//   }
//
//   public getGasDiffusions(): readonly RuntimeGasDiffusionSnapshot[] {
//     return this.readSnapshot()?.gasDiffusions ?? [];
//   }
//
//   public getWarehouseStats(): WarehouseStats | null {
//     return this.readSnapshot()?.warehouseStats ?? null;
//   }
// }
//
