import { describe, expect, it } from "vitest";

import type { EntityDefinition } from "@/domain/registry/types/entity-definition";
import { INSPECTOR_TYPE } from "@/domain/registry/types/entity-inspector";
import { PLACEMENT_BEHAVIOR_TYPE } from "@/domain/registry/types/entity-placement-behavior";
import { ENTITY_DEFINITIONS } from "@/registry/entity-definition";
import { RECIPE_DEFINITIONS } from "@/registry/recipe-definition";
import {
  BLOCKAGE_AUTO_CLEARANCE_ENABLED_CONFIG_KEY,
  WATER_PURIFIER_BYPRODUCT_CHANNEL_ID,
  WATER_PURIFIER_BYPRODUCT_RECIPE_ID,
  WATER_PURIFIER_COLLECT_RECIPE_ID,
  WATER_PURIFIER_INPUT_STORAGE_GROUP_IDS,
  WATER_PURIFIER_INTAKE_CHANNEL_IDS,
  WATER_PURIFIER_NODE_ENTITY_ID,
  WATER_PURIFIER_OUTPUT_ITEM_ID,
  WATER_PURIFIER_OUTPUT_STORAGE_GROUP_ID,
  WATER_PURIFIER_SEWAGE_BUFFER_STORAGE_GROUP_ID,
} from "@/shared/water-purifier-node";

type PortGroupDefinition = EntityDefinition["portGroups"][number];

function requireEntity(id: string): EntityDefinition {
  const definition = ENTITY_DEFINITIONS.find((candidate) => candidate.id === id);
  if (definition === undefined) {
    throw new Error(`Missing entity definition: ${id}`);
  }
  return definition;
}

function requirePortGroup(
  definition: EntityDefinition,
  portGroupId: string,
): PortGroupDefinition {
  const portGroup = definition.portGroups.find((candidate) => candidate.id === portGroupId);
  if (portGroup === undefined) {
    throw new Error(`Missing port group ${portGroupId} on ${definition.id}`);
  }
  return portGroup;
}

describe("water purifier node definition", () => {
  it("declares the requested 27x3 outside-base fluid port layout with sprite on N side", () => {
    const definition = requireEntity(WATER_PURIFIER_NODE_ENTITY_ID);

    expect(definition.footprint).toEqual({ width: 27, height: 3 });
    expect(definition.spriteOffset?.topView).toEqual({ x: 0, y: -5, width: 27, height: 8 });
    expect(definition.uiGroup).toBe("resourcePower");
    expect(definition.requiresPower).toBe(false);
    expect(definition.powerDemand).toBe(0);
    expect(definition.tags).toEqual(
      expect.arrayContaining(["Producer", "武陵", "OuterRingAllowed", "InnerRingNotAllowed"]),
    );
    expect(definition.placementBehaviors).toEqual(
      expect.arrayContaining([{ type: PLACEMENT_BEHAVIOR_TYPE.snapToOuterRingEdge }]),
    );
    expectPort(requirePortGroup(definition, "fluid_input_1"), "in_s_1", 1, 2, "SOUTH", "item_liquid_sewage");
    expectPort(requirePortGroup(definition, "fluid_input_2"), "in_s_9", 9, 2, "SOUTH", "item_liquid_sewage");
    expectPort(requirePortGroup(definition, "fluid_input_3"), "in_s_17", 17, 2, "SOUTH", "item_liquid_sewage");
    expectPort(requirePortGroup(definition, "fluid_output"), "out_s_25", 25, 2, "SOUTH", WATER_PURIFIER_OUTPUT_ITEM_ID);
  });

  it("declares three 2-drop input slots, one 500-drop sewage cache, and one visible 50-drop output slot", () => {
    const definition = requireEntity(WATER_PURIFIER_NODE_ENTITY_ID);

    expect(definition.storageSlotGroups.map((slotGroup) => ({
      id: slotGroup.id,
      capacity: slotGroup.slots[0]?.capacity,
      lock: slotGroup.slots[0]?.lock,
      itemFilterType: slotGroup.slots[0]?.itemFilterType,
    }))).toEqual([
      ...WATER_PURIFIER_INPUT_STORAGE_GROUP_IDS.map((id) => ({
        id,
        capacity: 2,
        lock: "item_liquid_sewage",
        itemFilterType: "liquid",
      })),
      {
        id: WATER_PURIFIER_SEWAGE_BUFFER_STORAGE_GROUP_ID,
        capacity: 500,
        lock: "item_liquid_sewage",
        itemFilterType: "liquid",
      },
      {
        id: WATER_PURIFIER_OUTPUT_STORAGE_GROUP_ID,
        capacity: 50,
        lock: WATER_PURIFIER_OUTPUT_ITEM_ID,
        itemFilterType: "liquid",
      },
    ]);
    expect(definition.inspectors).toEqual(
      expect.arrayContaining([
        { type: INSPECTOR_TYPE.waterPurifierNode },
        {
          type: INSPECTOR_TYPE.slotConfig,
          slotGroupIds: [WATER_PURIFIER_OUTPUT_STORAGE_GROUP_ID],
        },
      ]),
    );
  });

  it("declares intake and byproduct recipes separately", () => {
    const definition = requireEntity(WATER_PURIFIER_NODE_ENTITY_ID);

    expect(definition.recipeChannels).toEqual([
      {
        id: WATER_PURIFIER_INTAKE_CHANNEL_IDS[0],
        type: "normal-channel",
        ingredientStorageGroupIds: [WATER_PURIFIER_INPUT_STORAGE_GROUP_IDS[0]],
        productStorageGroupIds: [WATER_PURIFIER_SEWAGE_BUFFER_STORAGE_GROUP_ID],
        manualRecipeOnly: undefined,
      },
      {
        id: WATER_PURIFIER_INTAKE_CHANNEL_IDS[1],
        type: "normal-channel",
        ingredientStorageGroupIds: [WATER_PURIFIER_INPUT_STORAGE_GROUP_IDS[1]],
        productStorageGroupIds: [WATER_PURIFIER_SEWAGE_BUFFER_STORAGE_GROUP_ID],
        manualRecipeOnly: undefined,
      },
      {
        id: WATER_PURIFIER_INTAKE_CHANNEL_IDS[2],
        type: "normal-channel",
        ingredientStorageGroupIds: [WATER_PURIFIER_INPUT_STORAGE_GROUP_IDS[2]],
        productStorageGroupIds: [WATER_PURIFIER_SEWAGE_BUFFER_STORAGE_GROUP_ID],
        manualRecipeOnly: undefined,
      },
      {
        id: WATER_PURIFIER_BYPRODUCT_CHANNEL_ID,
        type: "normal-channel",
        ingredientStorageGroupIds: [WATER_PURIFIER_SEWAGE_BUFFER_STORAGE_GROUP_ID],
        productStorageGroupIds: [WATER_PURIFIER_OUTPUT_STORAGE_GROUP_ID],
        manualRecipeOnly: undefined,
      },
    ]);

    expect(RECIPE_DEFINITIONS.find((recipe) => recipe.id === WATER_PURIFIER_COLLECT_RECIPE_ID)).toMatchObject({
      durationSeconds: 1,
      inputs: [{ itemId: "item_liquid_sewage", amount: 2 }],
      outputs: [{ itemId: "item_liquid_sewage", amount: 2 }],
      machineId: WATER_PURIFIER_NODE_ENTITY_ID,
      recipeType: "immediate-consume",
    });
    expect(RECIPE_DEFINITIONS.find((recipe) => recipe.id === WATER_PURIFIER_BYPRODUCT_RECIPE_ID)).toMatchObject({
      durationSeconds: 1,
      inputs: [{ itemId: "item_liquid_sewage", amount: 30 }],
      outputs: [{ itemId: WATER_PURIFIER_OUTPUT_ITEM_ID, amount: 1 }],
      machineId: WATER_PURIFIER_NODE_ENTITY_ID,
      recipeType: "immediate-consume",
    });
  });

  it("enables explicit blockage clearance only on expanded reactor and water purifier node", () => {
    const expandedPool = requireEntity("mix_pool_2");
    const normalPool = requireEntity("mix_pool_1");
    const waterNode = requireEntity(WATER_PURIFIER_NODE_ENTITY_ID);

    expect(normalPool.blockageAutoClearance).toBeUndefined();
    expect(expandedPool.blockageAutoClearance).toEqual({
      enabledByDefault: true,
      enabledConfigKey: BLOCKAGE_AUTO_CLEARANCE_ENABLED_CONFIG_KEY,
      channelIds: ["ch1", "ch2", "ch3", "ch4", "ch5", "ch6", "ch7", "ch8"],
      slotRefs: [{ storageSlotGroupId: "shared_input_buffer" }],
      blockedChannelThreshold: 2,
    });
    expect(expandedPool.inspectors).toEqual(
      expect.arrayContaining([{ type: INSPECTOR_TYPE.blockageAutoClearance }]),
    );
    expect(waterNode.blockageAutoClearance).toEqual({
      enabledByDefault: true,
      enabledConfigKey: BLOCKAGE_AUTO_CLEARANCE_ENABLED_CONFIG_KEY,
      channelIds: WATER_PURIFIER_INTAKE_CHANNEL_IDS,
      slotRefs: [{ storageSlotGroupId: WATER_PURIFIER_SEWAGE_BUFFER_STORAGE_GROUP_ID }],
      blockedChannelThreshold: 1,
    });
  });
});

function expectPort(
  portGroup: PortGroupDefinition,
  id: string,
  localCellX: number,
  localCellY: number,
  edge: string,
  itemId: string,
): void {
  expect(portGroup.kind).toBe("fluid");
  expect(portGroup.ports).toHaveLength(1);
  expect(portGroup.ports[0]).toMatchObject({
    id,
    localCellX,
    localCellY,
    edge,
    acceptRule: { base: { kind: "item", itemId }, exclude: [] },
  });
}
