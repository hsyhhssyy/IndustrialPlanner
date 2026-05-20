import { describe, expect, it } from "vitest";

import type { BlueprintDocument } from "@/domain/document/blueprint-document";
import type { WorldEntity } from "@/domain/document/world-document";
import { runBlueprintSimulation } from "@/simulation/blueprint-runner";
import {
  createBlueprint,
  createEntity,
  findSlot,
} from "./blueprint-test-helpers";

function createGrinderBlueprint(
  name: string,
  position: WorldEntity["position"],
  initialItemType: string,
  initialCount: number,
): BlueprintDocument {
  return createBlueprint(name, [
    createEntity("grinder", "item_port_grinder_1", position.x, position.y, 0, {
      "storageSlotGroups[0].slots[0].initialItemType": initialItemType,
      "storageSlotGroups[0].slots[0].initialCount": initialCount,
    }),
  ]);
}

function createLinkedGrinderBlueprint(): BlueprintDocument {
  return createBlueprint(
    "linked-grinder",
    [
      createEntity("grinder", "item_port_grinder_1", 0, 0, 0, {
        "storageSlotGroups[0].slots[0].initialItemType": "item_iron_nugget",
        "storageSlotGroups[0].slots[0].initialCount": 1,
      }),
      createEntity("storage", "item_port_storager_1", 5, 0),
    ],
    [{
      id: "storage-to-grinder",
      linkType: "share-cap",
      source: {
        entityId: "storage",
        storageSlotGroupId: "storage_slot_1",
        slotId: "slot_1",
      },
      target: {
        entityId: "grinder",
        storageSlotGroupId: "item_input_buffer",
        slotId: "input_slot_1",
      },
    }],
  );
}

describe("REQ-076: topology migration", () => {
  it("covers topology-migration scenarios as blueprint pairs instead of private runtime state mutation", async () => {
    const original = await runBlueprintSimulation({
      blueprint: createGrinderBlueprint("migration-original", { x: 0, y: 0 }, "item_iron_nugget", 1),
      maxTickNumber: 0,
    });
    const moved = await runBlueprintSimulation({
      blueprint: createGrinderBlueprint("migration-moved", { x: 1, y: 0 }, "item_iron_nugget", 1),
      maxTickNumber: 0,
    });
    const configChanged = await runBlueprintSimulation({
      blueprint: createGrinderBlueprint("migration-config-changed", { x: 0, y: 0 }, "item_copper_ore", 2),
      maxTickNumber: 0,
    });
    const linked = await runBlueprintSimulation({
      blueprint: createLinkedGrinderBlueprint(),
      maxTickNumber: 0,
    });

    expect(moved.topology.documentHash).not.toBe(original.topology.documentHash);
    expect(findSlot(moved, 0, "grinder", "item_input_buffer", "input_slot_1"))
      .toMatchObject({
        itemType: "item_iron_nugget",
        count: 1,
      });
    expect(findSlot(configChanged, 0, "grinder", "item_input_buffer", "input_slot_1"))
      .toMatchObject({
        itemType: "item_copper_ore",
        count: 2,
      });
    expect(linked.blueprint.slotLinkCount).toBe(1);
    expect(linked.topology.diagnosticCount).toBe(0);
  });
});
