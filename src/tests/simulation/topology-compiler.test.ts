import { describe, expect, it } from "vitest";

import { createDummyWorldDocument } from "@/editor/dummy-document";
import { createRegistryContract } from "@/registry";
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
      "device:dummy-entity-2/cache-group:item_storage/slot:slot_1"
    ];
    const port = topology.ports[
      "device:dummy-entity-2/port:item_input.in_s_0.input"
    ];

    expect(slot?.capacity).toBe(50);
    expect(slot?.lock).toBe("item_test_plate");
    expect(slot?.initialItemType).toBe("item_test_plate");
    expect(slot?.initialCount).toBe(7);
    expect(slot?.ignoreStock).toBe(true);
    expect(port?.count).toBe(3);
  });

  it("compiles transport recipe and share-cap link from entity definition properties", () => {
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
      durationTicks: 1,
      inputs: [{ itemId: "any", amount: 1 }],
      outputs: [{ itemId: "same-as-input", amount: 1 }],
    });
    expect(beltLinks).toHaveLength(1);
    expect(beltLinks[0]).toMatchObject({
      linkType: "share-cap",
      shareLimit: 1,
    });
  });

});
