import { hashStable } from "../deterministic";
import type {
  RegionWarehouseAckBatch,
  RegionWarehouseArbitrationResult,
  RegionWarehouseAuthorityState,
  RegionWarehouseCommitProposal,
  RegionWarehouseDemandBatch,
  RegionWarehouseGrantBatch,
  RegionalWarehouseOutletTable,
} from "./types";
import { normalizeRegionNumber } from "./types";

/**
 * 纯数据、确定性的区域仓库仲裁器。
 *
 * 公平单位是仓库出口，不是基地；不同 itemId 独立维护游标。
 * 库存充足时全部有效 demand 获批，游标不能限制总吞吐。
 * ignoreStock 出口直接获批，不扣库存、不参与有限库存游标。
 */
export function arbitrateRegionalWarehouseEpoch(options: {
  readonly sessionId: string;
  readonly epochNumber: number;
  readonly table: RegionalWarehouseOutletTable;
  readonly state: RegionWarehouseAuthorityState;
  readonly demands: readonly RegionWarehouseDemandBatch[];
}): RegionWarehouseArbitrationResult {
  validateEpochNumbers(options.epochNumber, options.state.warehouseVersion);
  validateDemandBatches(options.table, options.demands);

  const provisionalCounts: Record<string, number> = Object.fromEntries(
    Object.entries(options.state.warehouseCounts).map(([itemId, count]) => [
      itemId,
      normalizeRegionNumber(count),
    ]),
  );
  const provisionalCursorByItemId: Record<string, number> = {
    ...options.state.cursorByItemId,
  };

  const grantedByOutletId = new Map<string, RegionWarehouseGrantBatch>();
  const grantedByBaseAndOutlet = new Map<string, string>();

  // 1) ignoreStock 出口直接授权。
  for (const outletId of options.table.orderedOutletIds) {
    const outlet = options.table.outletById[outletId];
    if (outlet === undefined || !outlet.ignoreStock) {
      continue;
    }
    const demand = findDemandForOutlet(options.demands, outlet.baseId, outlet.outletId);
    if (demand === null) {
      continue;
    }
    recordGrant({
      sessionId: options.sessionId,
      epochNumber: options.epochNumber,
      warehouseVersion: options.state.warehouseVersion,
      table: options.table,
      baseId: outlet.baseId,
      outletId: outlet.outletId,
      grantId: createGrantId(options.sessionId, options.epochNumber, options.state.warehouseVersion, outlet.outletId),
      grantedByOutletId,
      grantedByBaseAndOutlet,
    });
  }

  // 2) 有限库存出口按 itemId 分组、按每物品游标需求感知轮询。
  const itemIds = Object.keys(options.table.finiteStockOutletIdsByItemId).sort();
  for (const itemId of itemIds) {
    const ring = options.table.finiteStockOutletIdsByItemId[itemId] ?? [];
    if (ring.length === 0) {
      continue;
    }

    const demandOutletIds = new Set(
      ring.filter((outletId) => findDemandForOutlet(options.demands, options.table.outletById[outletId]!.baseId, outletId) !== null),
    );
    if (demandOutletIds.size === 0) {
      continue;
    }

    let remaining = Math.max(0, Math.floor(provisionalCounts[itemId] ?? 0));
    if (remaining === 0) {
      continue;
    }

    const cursor = normalizeCursor(options.state.cursorByItemId[itemId] ?? 0, ring.length);
    let lastGrantedIndex = -1;
    for (let offset = 0; offset < ring.length && remaining > 0; offset += 1) {
      const index = (cursor + offset) % ring.length;
      const outletId = ring[index] ?? "";
      if (!demandOutletIds.has(outletId)) {
        continue;
      }
      const outlet = options.table.outletById[outletId];
      if (outlet === undefined) {
        throw new Error(`Regional outlet table contains unknown outlet "${outletId}".`);
      }
      recordGrant({
        sessionId: options.sessionId,
        epochNumber: options.epochNumber,
        warehouseVersion: options.state.warehouseVersion,
        table: options.table,
        baseId: outlet.baseId,
        outletId: outlet.outletId,
        grantId: createGrantId(options.sessionId, options.epochNumber, options.state.warehouseVersion, outlet.outletId),
        grantedByOutletId,
        grantedByBaseAndOutlet,
      });
      remaining -= 1;
      lastGrantedIndex = index;
    }

    provisionalCounts[itemId] = remaining;
    if (lastGrantedIndex >= 0) {
      provisionalCursorByItemId[itemId] = (lastGrantedIndex + 1) % ring.length;
    }
  }

  // 3) 按冻结全出口表总序归并 grant；没有获批出口的基地也必须有空 grant。
  const baseIds = [...new Set(options.demands.map((demand) => demand.baseId))].sort();
  const grantsByBaseId: Record<string, RegionWarehouseGrantBatch> = {};
  for (const baseId of baseIds) {
    const grantedOutletIds = options.table.orderedOutletIds.filter((outletId) => {
      const outlet = options.table.outletById[outletId];
      return outlet?.baseId === baseId && grantedByBaseAndOutlet.has(`${baseId}\u0000${outletId}`);
    });
    grantsByBaseId[baseId] = {
      sessionId: options.sessionId,
      epochNumber: options.epochNumber,
      warehouseVersion: options.state.warehouseVersion,
      baseId,
      grantId: createBaseGrantId(options.sessionId, options.epochNumber, options.state.warehouseVersion, baseId),
      grantedOutletIds,
    };
  }

  return {
    grantsByBaseId,
    provisionalCounts,
    provisionalCursorByItemId,
  };
}

export function commitRegionalWarehouseEpoch(options: {
  readonly sessionId: string;
  readonly epochNumber: number;
  readonly table: RegionalWarehouseOutletTable;
  readonly state: RegionWarehouseAuthorityState;
  readonly expectedBaseIds: readonly string[];
  readonly arbitration: RegionWarehouseArbitrationResult;
  readonly acks: readonly RegionWarehouseAckBatch[];
}): RegionWarehouseCommitProposal {
  validateEpochNumbers(options.epochNumber, options.state.warehouseVersion);
  validateAckBatches(options.table, options.expectedBaseIds, options.arbitration, options.acks);

  const nextCounts: Record<string, number> = { ...options.arbitration.provisionalCounts };
  for (const ack of options.acks) {
    for (const deposit of ack.deposits) {
      nextCounts[deposit.itemId] = normalizeRegionNumber(
        (nextCounts[deposit.itemId] ?? 0) + deposit.amount,
      );
    }
  }

  const nextWarehouseVersion = options.state.warehouseVersion + 1;
  if (!Number.isSafeInteger(nextWarehouseVersion)) {
    throw new Error("Regional warehouse version overflow.");
  }

  return {
    sessionId: options.sessionId,
    epochNumber: options.epochNumber,
    parentWarehouseVersion: options.state.warehouseVersion,
    nextWarehouseVersion,
    warehouseCounts: nextCounts,
    cursorByItemId: { ...options.arbitration.provisionalCursorByItemId },
  };
}

function recordGrant(options: {
  readonly sessionId: string;
  readonly epochNumber: number;
  readonly warehouseVersion: number;
  readonly table: RegionalWarehouseOutletTable;
  readonly baseId: string;
  readonly outletId: string;
  readonly grantId: string;
  readonly grantedByOutletId: Map<string, RegionWarehouseGrantBatch>;
  readonly grantedByBaseAndOutlet: Map<string, string>;
}): void {
  if (options.grantedByOutletId.has(options.outletId)) {
    return;
  }
  if (options.table.outletById[options.outletId] === undefined) {
    throw new Error(`Cannot grant unknown regional outlet "${options.outletId}".`);
  }
  options.grantedByBaseAndOutlet.set(`${options.baseId}\u0000${options.outletId}`, options.outletId);
  options.grantedByOutletId.set(options.outletId, {
    sessionId: options.sessionId,
    epochNumber: options.epochNumber,
    warehouseVersion: options.warehouseVersion,
    baseId: options.baseId,
    grantId: options.grantId,
    grantedOutletIds: [options.outletId],
  });
}

function findDemandForOutlet(
  demands: readonly RegionWarehouseDemandBatch[],
  baseId: string,
  outletId: string,
): RegionWarehouseDemandBatch | null {
  const demand = demands.find((candidate) =>
    candidate.baseId === baseId && candidate.demandedOutletIds.includes(outletId),
  );
  return demand ?? null;
}

function validateDemandBatches(
  table: RegionalWarehouseOutletTable,
  demands: readonly RegionWarehouseDemandBatch[],
): void {
  const seenBaseIds = new Set<string>();
  for (const demand of demands) {
    if (seenBaseIds.has(demand.baseId)) {
      throw new Error(`Duplicate regional demand batch for base "${demand.baseId}".`);
    }
    seenBaseIds.add(demand.baseId);
    validateOrderedOutletSubsequence(table, demand.demandedOutletIds, demand.baseId);
  }
}

function validateAckBatches(
  table: RegionalWarehouseOutletTable,
  expectedBaseIds: readonly string[],
  arbitration: RegionWarehouseArbitrationResult,
  acks: readonly RegionWarehouseAckBatch[],
): void {
  const actualBaseIds = new Set(acks.map((ack) => ack.baseId));
  if (actualBaseIds.size !== expectedBaseIds.length || !expectedBaseIds.every((baseId) => actualBaseIds.has(baseId))) {
    throw new Error("Regional ACK barrier is incomplete: every expected base must ACK exactly once.");
  }

  for (const ack of acks) {
    const grant = arbitration.grantsByBaseId[ack.baseId];
    if (grant === undefined) {
      throw new Error(`Regional ACK from base "${ack.baseId}" has no grant batch.`);
    }
    if (ack.grantId !== grant.grantId) {
      throw new Error(`Regional ACK grant identity mismatch for base "${ack.baseId}".`);
    }
    if (!sameSequence(ack.appliedOutletIds, grant.grantedOutletIds)) {
      throw new Error(`Regional ACK applied outlets do not equal grant for base "${ack.baseId}".`);
    }
    validateOrderedOutletSubsequence(table, ack.appliedOutletIds, ack.baseId);

    const seenItemIds = new Set<string>();
    for (const deposit of ack.deposits) {
      if (seenItemIds.has(deposit.itemId)) {
        throw new Error(`Regional ACK deposit duplicates item "${deposit.itemId}" for base "${ack.baseId}".`);
      }
      seenItemIds.add(deposit.itemId);
      if (!Number.isFinite(deposit.amount) || deposit.amount < 0 || !Number.isInteger(deposit.amount)) {
        throw new Error(`Regional ACK deposit must be a finite non-negative integer for base "${ack.baseId}".`);
      }
    }
  }
}

function validateOrderedOutletSubsequence(
  table: RegionalWarehouseOutletTable,
  outletIds: readonly string[],
  baseId: string,
): void {
  const globalIndex = new Map(table.orderedOutletIds.map((outletId, index) => [outletId, index]));
  let previousIndex = -1;
  const seen = new Set<string>();
  for (const outletId of outletIds) {
    if (seen.has(outletId)) {
      throw new Error(`Regional batch contains duplicate outlet "${outletId}".`);
    }
    seen.add(outletId);
    const outlet = table.outletById[outletId];
    if (outlet === undefined || outlet.baseId !== baseId) {
      throw new Error(`Regional batch contains unknown outlet "${outletId}" for base "${baseId}".`);
    }
    const index = globalIndex.get(outletId);
    if (index === undefined || index < previousIndex) {
      throw new Error("Regional batch outlets must be an ordered subsequence of the frozen outlet table.");
    }
    previousIndex = index;
  }
}

function validateEpochNumbers(epochNumber: number, warehouseVersion: number): void {
  if (!Number.isSafeInteger(epochNumber) || epochNumber < 0) {
    throw new Error("Regional epochNumber must be a non-negative safe integer.");
  }
  if (!Number.isSafeInteger(warehouseVersion) || warehouseVersion < 0) {
    throw new Error("Regional warehouseVersion must be a non-negative safe integer.");
  }
}

function normalizeCursor(cursor: number, ringLength: number): number {
  const normalized = ((cursor % ringLength) + ringLength) % ringLength;
  return Number.isFinite(normalized) ? normalized : 0;
}

function createGrantId(
  sessionId: string,
  epochNumber: number,
  warehouseVersion: number,
  outletId: string,
): string {
  return `grant:${hashStable([sessionId, epochNumber, warehouseVersion, "outlet", outletId])}`;
}

function createBaseGrantId(
  sessionId: string,
  epochNumber: number,
  warehouseVersion: number,
  baseId: string,
): string {
  return `grant:${hashStable([sessionId, epochNumber, warehouseVersion, "base", baseId])}`;
}

function sameSequence(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}
