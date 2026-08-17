import type { CompiledSimulationTopology } from "../types";

/**
 * 区域仓库出口的唯一身份。六元组编码为 outletId：
 * JSON.stringify([baseId, sourceDeviceId, sourceStorageGroupId, sourceSlotId, sourcePortId, transferEdgeId])。
 */
export interface RegionalWarehouseOutletIdentity {
  readonly baseId: string;
  readonly sourceDeviceId: string;
  readonly sourceStorageGroupId: string;
  readonly sourceSlotId: string;
  readonly sourcePortId: string;
  readonly transferEdgeId: string;
}

export interface RegionalWarehouseOutletOrder {
  readonly regionBaseOrderIndex: number;
  readonly sourceDeviceOrderIndex: number;
  readonly sourceStorageGroupOrder: number;
  readonly sourceSlotOrder: number;
  readonly sourcePortGroupOrder: number;
  readonly sourcePortOrder: number;
  readonly transferEdgeOrder: number;
}

export interface RegionalWarehouseOutlet extends RegionalWarehouseOutletIdentity {
  readonly outletId: string;
  readonly itemId: string;
  /** 源槽位在本地拓扑中的编译槽位 ID，供 RegionWarehouseGate 定位。 */
  readonly sourceCompiledSlotId: string;
  /** 首段物流输入对应的 transfer edge（与身份中的 transferEdgeId 相同，显式保留便于协议应用）。 */
  readonly targetCompiledNodeId: string;
  readonly targetCompiledSlotGroupId: string | null;
  /** ignoreStock 出口不扣权威库存、不参与有限库存游标。 */
  readonly ignoreStock: boolean;
  readonly order: RegionalWarehouseOutletOrder;
}

export interface RegionalWarehouseOutletTable {
  /** 冻结全出口表总序。demand/grant/applied 都必须保持为该序列的有序子序列。 */
  readonly orderedOutletIds: readonly string[];
  readonly outletById: Readonly<Record<string, RegionalWarehouseOutlet>>;
  /** 每个 itemId 的有限库存出口环，均按全局总序过滤。 */
  readonly finiteStockOutletIdsByItemId: Readonly<Record<string, readonly string[]>>;
  readonly outletsByBaseId: Readonly<Record<string, readonly string[]>>;
}

export interface RegionWarehouseDemandBatch {
  readonly sessionId: string;
  readonly epochNumber: number;
  readonly warehouseVersion: number;
  readonly baseId: string;
  /** 冻结出口表的有序子序列。 */
  readonly demandedOutletIds: readonly string[];
}

export interface RegionWarehouseGrantBatch {
  readonly sessionId: string;
  readonly epochNumber: number;
  readonly warehouseVersion: number;
  readonly baseId: string;
  readonly grantId: string;
  /** 冻结出口表的有序子序列。 */
  readonly grantedOutletIds: readonly string[];
}

export interface RegionWarehouseDeposit {
  readonly itemId: string;
  readonly amount: number;
}

export interface RegionWarehouseAckBatch {
  readonly sessionId: string;
  readonly epochNumber: number;
  readonly warehouseVersion: number;
  readonly baseId: string;
  readonly grantId: string;
  /** 必须与对应 grant 完全一致。 */
  readonly appliedOutletIds: readonly string[];
  /** 按 itemId 稳定排序，且 (baseId, itemId) 在本基地 ACK 内唯一。 */
  readonly deposits: readonly RegionWarehouseDeposit[];
}

export interface RegionWarehouseArbitrationResult {
  readonly grantsByBaseId: Readonly<Record<string, RegionWarehouseGrantBatch>>;
  /** 有限库存被本轮授权扣减后的 provisional counts；未提交前不得覆盖 head。 */
  readonly provisionalCounts: Readonly<Record<string, number>>;
  /** 每 itemId 本轮后的 provisional cursor。 */
  readonly provisionalCursorByItemId: Readonly<Record<string, number>>;
}

export interface RegionWarehouseCommitProposal {
  readonly sessionId: string;
  readonly epochNumber: number;
  readonly parentWarehouseVersion: number;
  readonly nextWarehouseVersion: number;
  /** 提交后权威库存，deposits 从下一 Epoch 才参与取货。 */
  readonly warehouseCounts: Readonly<Record<string, number>>;
  readonly cursorByItemId: Readonly<Record<string, number>>;
}

export interface RegionWarehouseAuthorityState {
  readonly warehouseVersion: number;
  readonly warehouseCounts: Readonly<Record<string, number>>;
  readonly cursorByItemId: Readonly<Record<string, number>>;
}

export interface RegionalSimulationTopologyInput {
  readonly baseId: string;
  readonly regionBaseOrderIndex: number;
  readonly topology: CompiledSimulationTopology;
}

/** 把任意有限非负数字规范化为稳定 JSON 可表达的值。 */
export function normalizeRegionNumber(value: number): number {
  if (!Number.isFinite(value)) {
    throw new Error("Region protocol requires finite numeric values.");
  }
  return Object.is(value, -0) ? 0 : value;
}
