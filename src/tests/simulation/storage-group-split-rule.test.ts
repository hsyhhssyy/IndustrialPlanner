import { describe, expect, it } from "vitest";

import type { EntityDefinition } from "@/domain/registry/types/entity-definition";
import { createDummyWorldDocument } from "@/editor/dummy-document";
import { createRegistryContract } from "@/registry";
import { compileSimulationTopology } from "@/simulation/topology-compiler";

describe("storage group split rules", () => {
  it("keeps share-all split views aligned with the original bidirectional role", () => {
    const topology = compileStoragerTopology({
      role: "bidirectional",
      splitLinkType: "share-all",
    });

    expectStoragerSplit(topology, {
      linkType: "share-all",
      inputSlotType: "universal",
      outputSlotType: "universal",
      ingredientNodeIds: [STORAGER_INPUT_VIEW_NODE_ID, STORAGER_OUTPUT_VIEW_NODE_ID],
      productNodeIds: [STORAGER_INPUT_VIEW_NODE_ID, STORAGER_OUTPUT_VIEW_NODE_ID],
    });
  });

  it("splits bidirectional share-cap groups into ingredient input and product output views", () => {
    const topology = compileStoragerTopology({
      role: "bidirectional",
      splitLinkType: "share-cap",
    });

    expectStoragerSplit(topology, {
      linkType: "share-cap",
      inputSlotType: "ingredient",
      outputSlotType: "product",
      ingredientNodeIds: [STORAGER_INPUT_VIEW_NODE_ID],
      productNodeIds: [STORAGER_OUTPUT_VIEW_NODE_ID],
    });
  });

  it("keeps share-cap split input groups as ingredient on both views", () => {
    const topology = compileStoragerTopology({
      role: "input",
      splitLinkType: "share-cap",
    });

    expectStoragerSplit(topology, {
      linkType: "share-cap",
      inputSlotType: "ingredient",
      outputSlotType: "ingredient",
      ingredientNodeIds: [STORAGER_INPUT_VIEW_NODE_ID, STORAGER_OUTPUT_VIEW_NODE_ID],
      productNodeIds: [],
    });
  });

  it("compiles belt definitions as a single bidirectional share-cap buffer", () => {
    const registry = createRegistryContract();
    const beltDefinition = registry.entityDefinitions.find((definition) =>
      definition.id === "belt_straight_1x1",
    );

    expect(beltDefinition?.storageSlotGroups).toHaveLength(1);
    expect(beltDefinition?.storageSlotGroups[0]).toMatchObject({
      id: BELT_GROUP_ID,
      role: "bidirectional",
      splitLinkType: "share-cap",
    });
    expect(beltDefinition?.portStorageBindings).toEqual([
      expect.objectContaining({ portGroupId: "item_input", storageSlotGroupId: BELT_GROUP_ID }),
      expect.objectContaining({ portGroupId: "item_output", storageSlotGroupId: BELT_GROUP_ID }),
    ]);

    const topology = compileSimulationTopology({
      document: createDummyWorldDocument(),
      registry,
    });

    expect(topology.nodes[BELT_INPUT_VIEW_NODE_ID]?.slotType).toBe("ingredient");
    expect(topology.nodes[BELT_OUTPUT_VIEW_NODE_ID]?.slotType).toBe("product");
    expect(topology.links[BELT_SPLIT_LINK_ID]).toMatchObject({
      linkType: "share-cap",
      sourceSlotIds: [BELT_INPUT_VIEW_SLOT_ID],
      targetSlotIds: [BELT_OUTPUT_VIEW_SLOT_ID],
    });
    expect(topology.devices[BELT_DEVICE_ID]?.ingredientNodeIds).toEqual([BELT_INPUT_VIEW_NODE_ID]);
    expect(topology.devices[BELT_DEVICE_ID]?.productNodeIds).toEqual([BELT_OUTPUT_VIEW_NODE_ID]);
  });
});

const BELT_DEVICE_ID = "device:dummy-entity-1";
const BELT_GROUP_ID = "item_buffer";
const BELT_INPUT_VIEW_NODE_ID = `${BELT_DEVICE_ID}/node:${BELT_GROUP_ID}.input-view`;
const BELT_OUTPUT_VIEW_NODE_ID = `${BELT_DEVICE_ID}/node:${BELT_GROUP_ID}.output-view`;
const BELT_INPUT_VIEW_SLOT_ID = `${BELT_INPUT_VIEW_NODE_ID}/slot:slot_1.in-view`;
const BELT_OUTPUT_VIEW_SLOT_ID = `${BELT_OUTPUT_VIEW_NODE_ID}/slot:slot_1.out-view`;
const BELT_SPLIT_LINK_ID = `link:${BELT_DEVICE_ID}:${BELT_GROUP_ID}:input-view-to-output-view`;

const STORAGER_DEVICE_ID = "device:dummy-entity-2";
const STORAGER_GROUP_ID = "item_storage";
const STORAGER_INPUT_VIEW_NODE_ID = `${STORAGER_DEVICE_ID}/node:${STORAGER_GROUP_ID}.input-view`;
const STORAGER_OUTPUT_VIEW_NODE_ID = `${STORAGER_DEVICE_ID}/node:${STORAGER_GROUP_ID}.output-view`;
const STORAGER_SPLIT_LINK_ID = `link:${STORAGER_DEVICE_ID}:${STORAGER_GROUP_ID}:input-view-to-output-view`;

function compileStoragerTopology(options: {
  role: EntityDefinition["storageSlotGroups"][number]["role"];
  splitLinkType: NonNullable<EntityDefinition["storageSlotGroups"][number]["splitLinkType"]>;
}) {
  const registry = createRegistryContract();
  const storagerIndex = registry.entityDefinitions.findIndex((definition) =>
    definition.id === "item_port_storager_1",
  );
  if (storagerIndex < 0) {
    throw new Error("Expected item_port_storager_1 to exist.");
  }

  const storagerDefinition = registry.entityDefinitions[storagerIndex];
  if (storagerDefinition === undefined) {
    throw new Error("Expected item_port_storager_1 to exist.");
  }

  registry.entityDefinitions[storagerIndex] = {
    ...storagerDefinition,
    storageSlotGroups: storagerDefinition.storageSlotGroups.map((group) =>
      group.id === STORAGER_GROUP_ID
        ? {
            ...group,
            role: options.role,
            splitLinkType: options.splitLinkType,
          }
        : group,
    ),
  };

  return compileSimulationTopology({
    document: createDummyWorldDocument(),
    registry,
  });
}

function expectStoragerSplit(
  topology: ReturnType<typeof compileSimulationTopology>,
  expected: {
    linkType: "share-all" | "share-cap";
    inputSlotType: "ingredient" | "product" | "universal";
    outputSlotType: "ingredient" | "product" | "universal";
    ingredientNodeIds: string[];
    productNodeIds: string[];
  },
): void {
  expect(topology.nodes[STORAGER_INPUT_VIEW_NODE_ID]?.slotType).toBe(expected.inputSlotType);
  expect(topology.nodes[STORAGER_OUTPUT_VIEW_NODE_ID]?.slotType).toBe(expected.outputSlotType);
  expect(topology.links[STORAGER_SPLIT_LINK_ID]?.linkType).toBe(expected.linkType);
  expect(topology.devices[STORAGER_DEVICE_ID]?.ingredientNodeIds).toEqual(expected.ingredientNodeIds);
  expect(topology.devices[STORAGER_DEVICE_ID]?.productNodeIds).toEqual(expected.productNodeIds);
}