import { describe, expect, it } from "vitest";

import { createDummyWorldDocument } from "@/editor/dummy-document";
import { createRegistryContract } from "@/registry";
import { STANDARD_TICK_RATE_PER_SECOND } from "@/simulation/tick-rate";
import { compileSimulationTopology } from "@/simulation/topology-compiler";

describe("compileSimulationTopology", () => {
  it("merges entity definition defaults with entity config path overrides", () => {
    const document = createDummyWorldDocument();
    const storager = document.entities["dummy-entity-2"];

    if (storager === undefined) {
      throw new Error("Expected dummy storager entity to exist.");
    }

    document.entities[storager.id] = {
      ...storager,
      config: {
        "storageSlotGroups[0].slots[0].lock": "item_test_plate",
        "storageSlotGroups[0].slots[0].initialCount": 7,
        "storageSlotGroups[0].slots[0].ignoreStock": true,
        "portGroups[0].ports[0].count": 3,
      },
    };

    const topology = compileSimulationTopology({
      document,
      registry: createRegistryContract(),
    });

    const slot = topology.slots[
      "device:dummy-entity-2/cache-group:item_storage.slot_1.output-view/slot:slot_1.out-view"
    ];
    const storagerCacheGroups = Object.values(topology.cacheGroups).filter((cacheGroup) =>
      cacheGroup.id.startsWith("device:dummy-entity-2/cache-group:item_storage"),
    );
    const port = topology.ports[
      "device:dummy-entity-2/port:item_input.in_s_0.input"
    ];

    expect(storagerCacheGroups).toHaveLength(12);
    expect(slot?.capacity).toBe(50);
    expect(slot?.lock).toBe("item_test_plate");
    expect(slot?.initialItemType).toBe("item_test_plate");
    expect(slot?.initialCount).toBe(7);
    expect(slot?.ignoreStock).toBe(true);
    expect(port?.count).toBe(3);
  });

  it("compiles transport recipe and directed cache link from entity definition properties", () => {
    const topology = compileSimulationTopology({
      document: createDummyWorldDocument(),
      registry: createRegistryContract(),
    });

    const belt = topology.devices["device:dummy-entity-1"];
    const beltLinks = Object.values(topology.links).filter((link) =>
      link.id.includes("device:dummy-entity-1"),
    );

    expect(belt?.recipePlan).toMatchObject({
      recipeType: "reserved-item",
      durationTicks: 2 * STANDARD_TICK_RATE_PER_SECOND,
      inputs: [{ itemId: "any", amount: 1 }],
      outputs: [{ itemId: "same-as-input", amount: 1 }],
    });
    expect(beltLinks).toHaveLength(1);
    expect(beltLinks[0]).toMatchObject({
      linkType: "share-all",
      sourceSlotIds: ["device:dummy-entity-1/cache-group:item_input_buffer/slot:input_slot_1"],
      targetSlotIds: ["device:dummy-entity-1/cache-group:item_output_buffer/slot:output_slot_1"],
    });
  });

});
