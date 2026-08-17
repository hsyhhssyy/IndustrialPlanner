import { describe, expect, it } from "vitest";

import { createRegistryContract } from "@/registry";
import { compileSimulationTopology } from "@/simulation/topology-compiler";
import { buildRegionalWarehouseOutletTable } from "@/simulation/regional/warehouse-outlet-table";
import {
  arbitrateRegionalWarehouseEpoch,
  commitRegionalWarehouseEpoch,
} from "@/simulation/regional/warehouse-arbiter";
import type {
  RegionWarehouseAckBatch,
  RegionWarehouseAuthorityState,
  RegionWarehouseDemandBatch,
} from "@/simulation/regional";
import { SimulationWorkerRuntime } from "@/simulation/worker-runtime";
import { createWorldDocumentFromBlueprint } from "./blueprint-test-helpers";
import {
  createBlueprint,
  createEntity,
  createWarehouseSlotLink,
} from "./blueprint-test-helpers";

describe("区域基地 Runtime 门禁", () => {
  it("Epoch 0 在 tick1 提货，管道/传送带相位错误时不产生 demand", () => {
    const registry = createRegistryContract();
    const document = createWorldDocumentFromBlueprint(createBlueprint("regional-runtime-belt", [
      createEntity("unloader", "unloader_1", 51, 34, 270),
      createEntity("belt_0", "belt_straight_1x1", 52, 35, 0),
    ], [
      createWarehouseSlotLink("unloader", "item_copper_ore"),
    ]));
    const topology = compileSimulationTopology({
      document,
      registry,
      poweredEntityIds: new Set(),
      activeActivityIds: [],
    });
    const admission = buildRegionalWarehouseOutletTable({
      registry,
      topologies: [{ baseId: document.baseId, regionBaseOrderIndex: 0, topology }],
    });
    expect(admission.ok).toBe(true);
    const table = admission.table!;

    const runtime = new SimulationWorkerRuntime(registry);
    const start = runtime.loadRegionalTopology({
      topology,
      baseId: document.baseId,
      table,
      initialWarehouseCounts: { item_copper_ore: 1 },
      fixedDynamicTickRate: 2,
      advanceMode: "coarse",
    });
    expect(start.status).toBe("started");

    const epoch0 = runtime.prepareRegionalEpochDemand(0);
    expect(epoch0.tickNumber).toBe(1);
    expect(epoch0.demandedOutletIds).toHaveLength(1);

    const state0: RegionWarehouseAuthorityState = {
      warehouseVersion: 0,
      warehouseCounts: { item_copper_ore: 1 },
      cursorByItemId: { item_copper_ore: 0 },
    };
    const demand0: RegionWarehouseDemandBatch = {
      sessionId: "s",
      epochNumber: 0,
      warehouseVersion: 0,
      baseId: document.baseId,
      demandedOutletIds: [...epoch0.demandedOutletIds],
    };
    const arbitration0 = arbitrateRegionalWarehouseEpoch({
      sessionId: "s",
      epochNumber: 0,
      table,
      state: state0,
      demands: [demand0],
    });
    const grant0 = arbitration0.grantsByBaseId[document.baseId]!;
    const applied0 = runtime.applyRegionalEpochGrant({
      epochNumber: 0,
      grantedOutletIds: [...grant0.grantedOutletIds],
    });
    expect(applied0.deposits).toEqual([]);
    const finalized0 = runtime.finalizeRegionalEpoch({
      epochNumber: 0,
      nextWarehouseCounts: arbitration0.provisionalCounts,
      includeSnapshot: true,
    });
    expect(finalized0.snapshot!.transfers).toEqual(expect.arrayContaining([
      expect.objectContaining({ itemType: "item_copper_ore", amount: 1 }),
    ]));

    const epoch1 = runtime.prepareRegionalEpochDemand(1);
    expect(epoch1.tickNumber).toBe(11);
    // BeltFamily 相位为 20 tick，tick11 不产生 demand；首段已占用也不会产生 demand。
    expect(epoch1.demandedOutletIds).toEqual([]);
    const state1: RegionWarehouseAuthorityState = {
      warehouseVersion: 1,
      warehouseCounts: arbitration0.provisionalCounts,
      cursorByItemId: arbitration0.provisionalCursorByItemId,
    };
    const demand1: RegionWarehouseDemandBatch = {
      sessionId: "s",
      epochNumber: 1,
      warehouseVersion: 1,
      baseId: document.baseId,
      demandedOutletIds: [],
    };
    const arbitration1 = arbitrateRegionalWarehouseEpoch({
      sessionId: "s",
      epochNumber: 1,
      table,
      state: state1,
      demands: [demand1],
    });
    const ack1: RegionWarehouseAckBatch = {
      sessionId: "s",
      epochNumber: 1,
      warehouseVersion: 1,
      baseId: document.baseId,
      grantId: arbitration1.grantsByBaseId[document.baseId]!.grantId,
      appliedOutletIds: [],
      deposits: [],
    };
    const proposal1 = commitRegionalWarehouseEpoch({
      sessionId: "s",
      epochNumber: 1,
      table,
      state: state1,
      expectedBaseIds: [document.baseId],
      arbitration: arbitration1,
      acks: [ack1],
    });
    const applied1 = runtime.applyRegionalEpochGrant({
      epochNumber: 1,
      grantedOutletIds: [],
    });
    expect(applied1.deposits).toEqual([]);
    const finalized1 = runtime.finalizeRegionalEpoch({
      epochNumber: 1,
      nextWarehouseCounts: proposal1.warehouseCounts,
      includeSnapshot: true,
    });
    expect(finalized1.snapshot!.tickNumber).toBe(11);
  });
});
