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
      "device:dummy-entity-2/node:item_storage.output-view/slot:slot_1.out-view"
    ];
    const storagerSlots = Object.values(topology.slots).filter((compiledSlot) =>
      compiledSlot.id.startsWith("device:dummy-entity-2/node:item_storage"),
    );
    const port = topology.ports[
      "device:dummy-entity-2/port:item_input.in_s_0.input"
    ];

    expect(storagerSlots).toHaveLength(12);
    expect(slot?.capacity).toBe(50);
    expect(slot?.lock).toBe("item_test_plate");
    expect(slot?.initialItemType).toBe("item_test_plate");
    expect(slot?.initialCount).toBe(7);
    expect(slot?.ignoreStock).toBe(true);
    expect(port?.count).toBe(3);
  });

  it("compiles directed cache link from entity definition properties", () => {
    const topology = compileSimulationTopology({
      document: createDummyWorldDocument(),
      registry: createRegistryContract(),
    });

    const beltLinks = Object.values(topology.links).filter((link) =>
      link.id.includes("device:dummy-entity-1"),
    );

    expect(beltLinks).toHaveLength(1);
    expect(beltLinks[0]).toMatchObject({
      linkType: "share-cap",
      sourceSlotIds: ["device:dummy-entity-1/node:item_buffer.input-view/slot:slot_1.in-view"],
      targetSlotIds: ["device:dummy-entity-1/node:item_buffer.output-view/slot:slot_1.out-view"],
    });
  });

});
