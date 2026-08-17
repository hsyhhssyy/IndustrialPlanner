import { describe, expect, it } from "vitest";

import { createRegistryContract } from "@/registry";
import { compileSimulationTopology } from "@/simulation/topology-compiler";
import { buildRegionalWarehouseOutletTable } from "@/simulation/regional/warehouse-outlet-table";
import {
  LocalRegionalBasePort,
  RegionalSimulationSession,
} from "@/simulation/regional/session";
import type { RegionalBaseTopologyInput } from "@/simulation/regional/session";
import { createWorldDocumentFromBlueprint } from "./blueprint-test-helpers";
import {
  createBlueprint,
  createEntity,
  createWarehouseSlotLink,
} from "./blueprint-test-helpers";

describe("区域会话端到端", () => {
  it("后台基地 WarehouseSink 入仓后，下一 Epoch 可被另一基地取用", async () => {
    const registry = createRegistryContract();

    const consumerDoc = createWorldDocumentFromBlueprint(createBlueprint("region-consumer", [
      createEntity("unloader", "unloader_1", 51, 34, 270),
      createEntity("belt_0", "belt_straight_1x1", 52, 35, 0),
    ], [
      createWarehouseSlotLink("unloader", "item_copper_ore"),
    ]));
    consumerDoc.baseId = "base-consumer";

    const producerDoc = createWorldDocumentFromBlueprint(createBlueprint("region-producer", [
      createEntity("unloader", "unloader_1", 51, 34, 270, {
        "storageSlotGroups[0].slots[0].ignoreStock": true,
      }),
      createEntity("belt_0", "belt_straight_1x1", 52, 35, 0),
      createEntity("loader", "loader_1", 53, 34, 270),
    ], [
      createWarehouseSlotLink("unloader", "item_copper_ore"),
    ]));
    producerDoc.baseId = "base-producer";

    const topologies: RegionalBaseTopologyInput[] = [
      {
        baseId: consumerDoc.baseId,
        regionBaseOrderIndex: 0,
        topology: compileSimulationTopology({
          document: consumerDoc,
          registry,
          poweredEntityIds: new Set(),
          activeActivityIds: [],
        }),
      },
      {
        baseId: producerDoc.baseId,
        regionBaseOrderIndex: 1,
        topology: compileSimulationTopology({
          document: producerDoc,
          registry,
          poweredEntityIds: new Set(),
          activeActivityIds: [],
        }),
      },
    ];
    const admission = buildRegionalWarehouseOutletTable({ registry, topologies });
    expect(admission.ok).toBe(true);
    const table = admission.table!;

    const session = new RegionalSimulationSession({
      sessionId: "test-session",
      registry,
      topologies,
      table,
      currentBaseId: consumerDoc.baseId,
      expectedBaseIds: ["base-consumer", "base-producer"],
      initialWarehouseCounts: {},
      simulationSpeed: 1,
      currentBaseDynamicTickRate: 20,
      backgroundDynamicTickRate: 2,
    }, [
      new LocalRegionalBasePort({
        registry,
        baseId: consumerDoc.baseId,
        regionBaseOrderIndex: 0,
        topology: topologies[0]!.topology,
        table,
        initialWarehouseCounts: {},
        isCurrentBase: true,
        simulationSpeed: 1,
        fixedDynamicTickRate: 20,
        advanceMode: "per-tick",
      }),
      new LocalRegionalBasePort({
        registry,
        baseId: producerDoc.baseId,
        regionBaseOrderIndex: 1,
        topology: topologies[1]!.topology,
        table,
        initialWarehouseCounts: {},
        isCurrentBase: false,
        simulationSpeed: 1,
        fixedDynamicTickRate: 2,
        advanceMode: "coarse",
      }),
    ], null);

    const epochs = [];
    for (let epoch = 0; epoch <= 12; epoch += 1) {
      epochs.push(await session.runEpoch(epoch));
    }
    const copperByEpoch = epochs.map((epoch) => epoch.warehouseCounts["item_copper_ore"] ?? 0);
    // tick 41 producer 入仓后从下一 Epoch 可见；tick 61 consumer 从区域仓库取走。
    expect(copperByEpoch[4]).toBe(1);
    expect(copperByEpoch[5]).toBe(1);
    expect(copperByEpoch[6]).toBe(0);
    expect(epochs[12]!.snapshotsByBaseId["base-consumer"]).not.toBeNull();

    session.dispose();
  });
});
