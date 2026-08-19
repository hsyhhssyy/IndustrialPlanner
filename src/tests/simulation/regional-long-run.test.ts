import { describe, expect, it } from "vitest";

import { createRegistryContract } from "@/registry";
import { compileSimulationTopology } from "@/simulation/topology-compiler";
import { buildRegionalWarehouseOutletTable } from "@/simulation/regional/warehouse-outlet-table";
import {
  LocalRegionalBasePort,
  RegionalSimulationSession,
  type RegionalBaseTopologyInput,
} from "@/simulation/regional/session";
import { createWorldDocumentFromBlueprint } from "./blueprint-test-helpers";
import {
  createBlueprint,
  createEntity,
  createWarehouseSlotLink,
} from "./blueprint-test-helpers";

const TEN_MINUTE_EPOCHS = 1200;

describe("区域会话 10 分钟长跑", () => {
  it("连续 1200 个 Epoch 保持库存非负、版本连续、会话不失败", { timeout: 120_000 }, async () => {
    const registry = createRegistryContract();

    const consumerDoc = createWorldDocumentFromBlueprint(createBlueprint("region-long-consumer", [
      createEntity("unloader", "unloader_1", 51, 34, 270),
      createEntity("belt_0", "belt_straight_1x1", 52, 35, 0),
    ], [
      createWarehouseSlotLink("unloader", "item_copper_ore"),
    ]));
    consumerDoc.baseId = "base-consumer";

    const producerDoc = createWorldDocumentFromBlueprint(createBlueprint("region-long-producer", [
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
          document: consumerDoc, registry, simulationMode: "regional-multi-base", poweredEntityIds: new Set(), activeActivityIds: [],
        }),
      },
      {
        baseId: producerDoc.baseId,
        regionBaseOrderIndex: 1,
        topology: compileSimulationTopology({
          document: producerDoc, registry, simulationMode: "regional-multi-base", poweredEntityIds: new Set(), activeActivityIds: [],
        }),
      },
    ];
    const admission = buildRegionalWarehouseOutletTable({ registry, topologies });
    expect(admission.ok).toBe(true);

    const session = new RegionalSimulationSession({
      sessionId: "long-run",
      registry,
      topologies,
      table: admission.table!,
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
        table: admission.table!,
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
        table: admission.table!,
        initialWarehouseCounts: {},
        isCurrentBase: false,
        simulationSpeed: 1,
        fixedDynamicTickRate: 2,
        advanceMode: "coarse",
      }),
    ], null);

    try {
      for (let epoch = 0; epoch < TEN_MINUTE_EPOCHS; epoch += 1) {
        const committed = await session.runEpoch(epoch);
        expect(committed.epochNumber).toBe(epoch);
        expect(committed.warehouseVersion).toBe(epoch + 1);
        for (const count of Object.values(committed.warehouseCounts)) {
          expect(count).toBeGreaterThanOrEqual(0);
        }
      }
      expect(session.committedEpochs).toHaveLength(TEN_MINUTE_EPOCHS);
    } finally {
      session.dispose();
    }
  });
});
