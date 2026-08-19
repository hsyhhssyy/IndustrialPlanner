import { describe, expect, it } from "vitest";

import { createRegistryContract } from "@/registry";
import { createWorldDocumentFromBlueprint } from "./blueprint-test-helpers";
import {
  createBlueprint,
  createEntity,
  createWarehouseSlotLink,
} from "./blueprint-test-helpers";
import { compileSimulationTopology } from "@/simulation/topology-compiler";
import { buildRegionalWarehouseOutletTable } from "@/simulation/regional/warehouse-outlet-table";
import {
  arbitrateRegionalWarehouseEpoch,
  commitRegionalWarehouseEpoch,
} from "@/simulation/regional/warehouse-arbiter";
import type {
  RegionWarehouseAuthorityState,
  RegionalWarehouseOutlet,
  RegionalWarehouseOutletTable,
} from "@/simulation/regional/types";

describe("区域仓库出口表与仲裁器", () => {
  it("识别合法 unloader → belt 仓库出口", () => {
    const registry = createRegistryContract();
    const document = createWorldDocumentFromBlueprint(createBlueprint("regional-outlet-legal", [
      createEntity("unloader", "unloader_1", 51, 34, 270),
      createEntity("belt_0", "belt_straight_1x1", 52, 35, 0),
    ], [
      createWarehouseSlotLink("unloader", "item_copper_ore"),
    ]));
    const topology = compileSimulationTopology({
      document,
      registry,
      simulationMode: "regional-multi-base",
      poweredEntityIds: new Set(),
      activeActivityIds: [],
    });
    const result = buildRegionalWarehouseOutletTable({
      registry,
      topologies: [{ baseId: document.baseId, regionBaseOrderIndex: 0, topology }],
    });
    expect(result.ok).toBe(true);
    expect(result.table?.orderedOutletIds).toHaveLength(1);
    const outlet = result.table!.outletById[result.table!.orderedOutletIds[0]!]!;
    expect(outlet.itemId).toBe("item_copper_ore");
    expect(outlet.ignoreStock).toBe(false);
  });

  it("按每物品区域游标公平轮询，库存充足时全批通过", () => {
    const table = createFakeOutletTable([
      createFakeOutlet("a", "item_iron", 0),
      createFakeOutlet("b", "item_iron", 1),
    ]);
    const state: RegionWarehouseAuthorityState = {
      warehouseVersion: 3,
      warehouseCounts: { item_iron: 10 },
      cursorByItemId: { item_iron: 0 },
    };
    const demands = [
      { sessionId: "s", epochNumber: 0, warehouseVersion: 3, baseId: "a", demandedOutletIds: ["a"] },
      { sessionId: "s", epochNumber: 0, warehouseVersion: 3, baseId: "b", demandedOutletIds: ["b"] },
    ];
    const arbitration = arbitrateRegionalWarehouseEpoch({ sessionId: "s", epochNumber: 0, table, state, demands });
    expect(arbitration.grantsByBaseId.a!.grantedOutletIds).toEqual(["a"]);
    expect(arbitration.grantsByBaseId.b!.grantedOutletIds).toEqual(["b"]);
    expect(arbitration.provisionalCounts.item_iron).toBe(8);
    expect(arbitration.provisionalCursorByItemId.item_iron).toBe(0);
  });

  it("库存为 1 时从游标开始授权一个出口，游标移到后继", () => {
    const table = createFakeOutletTable([
      createFakeOutlet("a", "item_iron", 0),
      createFakeOutlet("b", "item_iron", 1),
      createFakeOutlet("c", "item_iron", 2),
    ]);
    const state: RegionWarehouseAuthorityState = {
      warehouseVersion: 0,
      warehouseCounts: { item_iron: 1 },
      cursorByItemId: { item_iron: 1 },
    };
    const demands = [
      { sessionId: "s", epochNumber: 0, warehouseVersion: 0, baseId: "a", demandedOutletIds: ["a"] },
      { sessionId: "s", epochNumber: 0, warehouseVersion: 0, baseId: "b", demandedOutletIds: ["b"] },
      { sessionId: "s", epochNumber: 0, warehouseVersion: 0, baseId: "c", demandedOutletIds: ["c"] },
    ];
    const arbitration = arbitrateRegionalWarehouseEpoch({ sessionId: "s", epochNumber: 0, table, state, demands });
    expect(arbitration.grantsByBaseId.a!.grantedOutletIds).toEqual([]);
    expect(arbitration.grantsByBaseId.b!.grantedOutletIds).toEqual(["b"]);
    expect(arbitration.grantsByBaseId.c!.grantedOutletIds).toEqual([]);
    expect(arbitration.provisionalCursorByItemId.item_iron).toBe(2);
  });

  it("ignoreStock 直接获批，不扣库存也不推进有限游标", () => {
    const table = createFakeOutletTable([
      createFakeOutlet("infinite", "item_water", 0, true),
      createFakeOutlet("a", "item_iron", 1),
    ]);
    const state: RegionWarehouseAuthorityState = {
      warehouseVersion: 0,
      warehouseCounts: { item_iron: 5, item_water: 0 },
      cursorByItemId: { item_iron: 0 },
    };
    const arbitration = arbitrateRegionalWarehouseEpoch({
      sessionId: "s",
      epochNumber: 0,
      table,
      state,
      demands: [
        { sessionId: "s", epochNumber: 0, warehouseVersion: 0, baseId: "infinite", demandedOutletIds: ["infinite"] },
        { sessionId: "s", epochNumber: 0, warehouseVersion: 0, baseId: "a", demandedOutletIds: ["a"] },
      ],
    });
    expect(arbitration.grantsByBaseId.infinite!.grantedOutletIds).toEqual(["infinite"]);
    expect(arbitration.provisionalCounts.item_water).toBe(0);
    expect(arbitration.provisionalCounts.item_iron).toBe(4);
    expect(arbitration.provisionalCursorByItemId.item_iron).toBe(0);
  });

  it("入仓只从下一 Epoch 可见，并要求每个基地完整 ACK", () => {
    const table = createFakeOutletTable([createFakeOutlet("a", "item_iron", 0)]);
    const state: RegionWarehouseAuthorityState = {
      warehouseVersion: 4,
      warehouseCounts: { item_iron: 1 },
      cursorByItemId: { item_iron: 0 },
    };
    const demands = [
      { sessionId: "s", epochNumber: 5, warehouseVersion: 4, baseId: "a", demandedOutletIds: ["a"] },
    ];
    const arbitration = arbitrateRegionalWarehouseEpoch({ sessionId: "s", epochNumber: 5, table, state, demands });
    const proposal = commitRegionalWarehouseEpoch({
      sessionId: "s",
      epochNumber: 5,
      table,
      state,
      expectedBaseIds: ["a"],
      arbitration,
      acks: [{
        sessionId: "s",
        epochNumber: 5,
        warehouseVersion: 4,
        baseId: "a",
        grantId: arbitration.grantsByBaseId.a!.grantId,
        appliedOutletIds: ["a"],
        deposits: [{ itemId: "item_iron", amount: 3 }],
      }],
    });
    expect(proposal.parentWarehouseVersion).toBe(4);
    expect(proposal.nextWarehouseVersion).toBe(5);
    expect(proposal.warehouseCounts.item_iron).toBe(3);
  });
});

function createFakeOutletTable(outlets: readonly RegionalWarehouseOutlet[]): RegionalWarehouseOutletTable {
  const orderedOutletIds = outlets.map((outlet) => outlet.outletId);
  const finiteStockOutletIdsByItemId: Record<string, string[]> = {};
  const outletsByBaseId: Record<string, string[]> = {};
  for (const outlet of outlets) {
    (outletsByBaseId[outlet.baseId] ??= []).push(outlet.outletId);
    if (!outlet.ignoreStock) {
      (finiteStockOutletIdsByItemId[outlet.itemId] ??= []).push(outlet.outletId);
    }
  }
  return {
    orderedOutletIds,
    outletById: Object.fromEntries(outlets.map((outlet) => [outlet.outletId, outlet])),
    finiteStockOutletIdsByItemId,
    outletsByBaseId,
  };
}

function createFakeOutlet(
  outletId: string,
  itemId: string,
  order: number,
  ignoreStock = false,
): RegionalWarehouseOutlet {
  return {
    outletId,
    baseId: outletId,
    itemId,
    sourceDeviceId: `device:${outletId}`,
    sourceStorageGroupId: "group",
    sourceSlotId: "slot_1",
    sourcePortId: `port:${outletId}`,
    transferEdgeId: `edge:${outletId}`,
    sourceCompiledSlotId: `slot:${outletId}`,
    targetCompiledNodeId: `node:${outletId}`,
    targetCompiledSlotGroupId: "group",
    ignoreStock,
    order: {
      regionBaseOrderIndex: order,
      sourceDeviceOrderIndex: order,
      sourceStorageGroupOrder: 0,
      sourceSlotOrder: 0,
      sourcePortGroupOrder: 0,
      sourcePortOrder: 0,
      transferEdgeOrder: order,
    },
  };
}
