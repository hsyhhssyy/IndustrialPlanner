import { describe, expect, it } from "vitest";

import { createRegistryContract } from "@/registry";
import { aggregateRegionalWarehouseStats } from "@/simulation/regional";
import { buildRegionalWarehouseOutletTable } from "@/simulation/regional/warehouse-outlet-table";
import {
  LocalRegionalBasePort,
  RegionalSimulationSession,
  type RegionalBaseTopologyInput,
} from "@/simulation/regional/session";
import { compileSimulationTopology } from "@/simulation/topology-compiler";
import type {
  RegionalResourceSupplySetting,
  RuntimeTickSnapshot,
} from "@/simulation/types";
import { runBlueprintSimulation } from "./blueprint-runner";
import {
  createBlueprint,
  createEntity,
  createWarehouseSlotLink,
  createWorldDocumentFromBlueprint,
  getTick,
} from "./blueprint-test-helpers";

const FINITE_SOURCE_ORE: readonly RegionalResourceSupplySetting[] = [{
  itemId: "item_originium_ore",
  mode: "rate",
  perMinute: 540,
}];

describe("地区资源供给", () => {
  it("单基地每 10 秒提交有限资源，并为固定及可配置无限资源投影独立状态", async () => {
    const report = await runBlueprintSimulation({
      blueprint: createBlueprint("regional-resource-single", []),
      maxTickNumber: 201,
      registry: createRegistryContract(),
      regionalResources: [
        ...FINITE_SOURCE_ORE,
        { itemId: "item_iron_ore", mode: "infinite", perMinute: 10 },
      ],
    });

    const initialStats = getTick(report, 0).warehouseStats;
    expect(initialStats?.items["item_iron_ore"]).toMatchObject({
      infinite: true,
      warehouseCount: 0,
      producedPerMinute: 0,
    });
    expect(initialStats?.items["item_liquid_water"]?.infinite).toBe(true);
    expect(initialStats?.items["item_liquid_acid"]?.infinite).toBe(true);
    expect(getTick(report, 200).warehouseStats?.items["item_originium_ore"]).toBeUndefined();
    expect(getTick(report, 201).warehouseStats?.items["item_originium_ore"]).toMatchObject({
      infinite: false,
      warehouseCount: 90,
    });
  });

  it("有限地区 Profile 覆盖设备文档中的旧自然资源 ignoreStock", () => {
    const registry = createRegistryContract();
    const document = createWorldDocumentFromBlueprint(createBlueprint(
      "regional-resource-policy-precedence",
      [
        createEntity("unloader", "unloader_1", 51, 34, 270, {
          "storageSlotGroups[0].slots[0].ignoreStock": true,
        }),
        createEntity("belt", "belt_straight_1x1", 52, 35),
      ],
      [createWarehouseSlotLink("unloader", "item_originium_ore")],
    ));
    const topology = compileSimulationTopology({
      document,
      registry,
      simulationMode: "regional-multi-base",
      poweredEntityIds: new Set(),
      activeActivityIds: [],
      regionalResources: FINITE_SOURCE_ORE,
    });
    const admission = buildRegionalWarehouseOutletTable({
      registry,
      topologies: [{ baseId: document.baseId, regionBaseOrderIndex: 0, topology }],
    });

    expect(admission.ok).toBe(true);
    expect(Object.values(admission.table!.outletById)).toEqual([
      expect.objectContaining({ itemId: "item_originium_ore", ignoreStock: false }),
    ]);
  });

  it("多基地在同一 10 秒区域提交边界注入有限资源", async () => {
    const registry = createRegistryContract();
    const documents = ["regional-a", "regional-b"].map((baseId) => {
      const document = createWorldDocumentFromBlueprint(createBlueprint(baseId, []));
      document.baseId = baseId;
      return document;
    });
    const topologies: RegionalBaseTopologyInput[] = documents.map((document, index) => ({
      baseId: document.baseId,
      regionBaseOrderIndex: index,
      topology: compileSimulationTopology({
        document,
        registry,
        simulationMode: "regional-multi-base",
        poweredEntityIds: new Set(),
        activeActivityIds: [],
        regionalResources: [{
          itemId: "item_originium_ore",
          mode: "rate",
          perMinute: 10,
        }],
      }),
    }));
    const admission = buildRegionalWarehouseOutletTable({ registry, topologies });
    expect(admission.ok).toBe(true);
    const ports = topologies.map((input, index) => new LocalRegionalBasePort({
      registry,
      baseId: input.baseId,
      regionBaseOrderIndex: index,
      topology: input.topology,
      table: admission.table!,
      initialWarehouseCounts: {},
      isCurrentBase: index === 0,
      simulationSpeed: 1,
      fixedDynamicTickRate: index === 0 ? 20 : 2,
      advanceMode: index === 0 ? "per-tick" : "coarse",
    }));
    const session = new RegionalSimulationSession({
      sessionId: "regional-resource-supply",
      registry,
      topologies,
      table: admission.table!,
      currentBaseId: topologies[0]!.baseId,
      expectedBaseIds: topologies.map((input) => input.baseId),
      initialWarehouseCounts: {},
      simulationSpeed: 1,
      currentBaseDynamicTickRate: 20,
      backgroundDynamicTickRate: 2,
    }, ports, null);

    try {
      let committed = await session.runEpoch(0);
      for (let epoch = 1; epoch <= 120; epoch += 1) {
        committed = await session.runEpoch(epoch);
      }
      expect(committed.gateTickNumber).toBe(1201);
      expect(committed.warehouseCounts["item_originium_ore"]).toBe(10);
      const baseSnapshots = Object.values(committed.snapshotsByBaseId)
        .filter((snapshot): snapshot is RuntimeTickSnapshot => snapshot !== null);
      const warehouseStats = aggregateRegionalWarehouseStats({
        baseSnapshots,
        authorityCounts: committed.warehouseCounts,
        supply: topologies[0]!.topology.regionalResourceSupply,
      });
      expect(warehouseStats.items["item_originium_ore"]).toMatchObject({
        producedPerMinute: 10,
        warehouseCount: 10,
        infinite: false,
      });
      expect(warehouseStats.items["item_liquid_water"]?.infinite).toBe(true);
    } finally {
      session.dispose();
    }
  });
});
