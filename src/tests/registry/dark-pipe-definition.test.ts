import { describe, expect, it } from "vitest";

import { INSPECTOR_TYPE } from "@/domain/registry/types/entity-inspector";
import {
  ENTITY_INPUT_ROUTING_STRATEGY,
  ENTITY_SIMULATION_BEHAVIOR_TYPE,
} from "@/domain/registry/types/entity-simulation-mode";
import {
  FLUID_DOMAIN_RECIPE_ITEM_ID,
  FluidDomain,
} from "@/domain/shared/item-domain-flags";
import { createRegistryContract } from "@/registry";
import { SIMULATION_MODE } from "@/domain/shared/simulation-mode";
import { TOOLBOX_HIDDEN_RECIPE_TAG } from "@/shared/registry/recipe-visibility";

function getEntity(id: string) {
  const registry = createRegistryContract();
  const entity = registry.entityDefinitions.find((candidate) => candidate.id === id);

  if (entity === undefined) {
    throw new Error(`Missing entity ${id}`);
  }

  return entity;
}

describe("dark pipe definitions", () => {
  it.each(["udpipe_loader_1", "udpipe_loader_2"])(
    "declares mode-specific input routing for %s",
    (definitionId) => {
      const registry = createRegistryContract();
      const definition = getEntity(definitionId);

      expect(registry.queries.resolveEntitySimulationModeConfig(
        definitionId,
        SIMULATION_MODE.singleBase,
      )).toEqual({
        behaviors: [{
          type: ENTITY_SIMULATION_BEHAVIOR_TYPE.inputRouting,
          strategy: ENTITY_INPUT_ROUTING_STRATEGY.localStorage,
          storageSlotGroupIds: ["loader_buffer"],
        }],
      });
      expect(registry.queries.resolveEntitySimulationModeConfig(
        definitionId,
        SIMULATION_MODE.regionalMultiBase,
      )).toEqual({
        behaviors: [{
          type: ENTITY_SIMULATION_BEHAVIOR_TYPE.inputRouting,
          strategy: ENTITY_INPUT_ROUTING_STRATEGY.warehouseSinkWhenUnlinked,
          storageSlotGroupIds: ["loader_buffer"],
        }],
      });
      expect(definition.simulationModeConfigs).toBeDefined();
    },
  );

  it("configures the single-port inlet as a local hidden fluid sink", () => {
    const inlet = getEntity("udpipe_loader_1");

    expect(inlet.tags).not.toContain("WarehouseSink");
    expect(inlet.storageSlotGroups).toHaveLength(1);
    expect(inlet.storageSlotGroups[0]).toMatchObject({
      id: "loader_buffer",
      kind: FluidDomain,
      slots: [
        expect.objectContaining({
          id: "slot_1",
          capacity: 500,
          itemFilterType: FluidDomain,
        }),
      ],
    });
    expect(inlet.portStorageBindings).toEqual([
      { id: "bind_fluid_input", portGroupId: "fluid_input", storageSlotGroupId: "loader_buffer" },
    ]);
    expect(inlet.recipeChannels).toEqual([
      {
        id: "void_fluid",
        type: "normal-channel",
        ingredientStorageGroupIds: ["loader_buffer"],
        productStorageGroupIds: ["loader_buffer"],
        manualRecipeOnly: undefined,
      },
    ]);
    expect(inlet.inspectors).toEqual(expect.arrayContaining([
      { type: INSPECTOR_TYPE.darkPipeLink },
      { type: INSPECTOR_TYPE.slotConfig, slotGroupIds: ["loader_buffer"] },
    ]));
  });

  it("configures the multi-port inlet as two hidden sink channels sharing one slot", () => {
    const inlet = getEntity("udpipe_loader_2");

    expect(inlet.storageSlotGroups).toHaveLength(1);
    expect(inlet.storageSlotGroups[0]?.id).toBe("loader_buffer");
    expect(inlet.storageSlotGroups[0]?.slots[0]?.capacity).toBe(500);
    expect(inlet.portGroups[0]?.ports).toHaveLength(2);
    expect(inlet.portStorageBindings).toEqual([
      { id: "bind_fluid_input", portGroupId: "fluid_input", storageSlotGroupId: "loader_buffer" },
    ]);
    expect(inlet.recipeChannels).toEqual([
      expect.objectContaining({
        id: "void_fluid_1",
        ingredientStorageGroupIds: ["loader_buffer"],
        productStorageGroupIds: ["loader_buffer"],
      }),
      expect.objectContaining({
        id: "void_fluid_2",
        ingredientStorageGroupIds: ["loader_buffer"],
        productStorageGroupIds: ["loader_buffer"],
      }),
    ]);
    expect(inlet.inspectors).toEqual(expect.arrayContaining([
      { type: INSPECTOR_TYPE.darkPipeLink },
      { type: INSPECTOR_TYPE.slotConfig, slotGroupIds: ["loader_buffer"] },
    ]));
  });

  it("configures dark pipe outlets as warehouse-linked generators with one 500-capacity fluid slot", () => {
    for (const id of ["udpipe_unloader_1", "udpipe_unloader_2"]) {
      const outlet = getEntity(id);

      expect(outlet.tags).not.toContain("WarehouseSink");
      expect(outlet.storageSlotGroups).toHaveLength(1);
      expect(outlet.storageSlotGroups[0]).toMatchObject({
        id: "unloader_buffer",
        kind: FluidDomain,
        slots: [
          expect.objectContaining({
            id: "slot_1",
            capacity: 500,
            initialItemType: null,
            initialCount: 0,
            itemFilterType: FluidDomain,
          }),
        ],
      });
      expect(outlet.recipeChannels).toEqual([
        {
          id: "default",
          type: "normal-channel",
          ingredientStorageGroupIds: ["unloader_buffer"],
          productStorageGroupIds: ["unloader_buffer"],
          manualRecipeOnly: undefined,
        },
      ]);
      expect(outlet.inspectors).toEqual(expect.arrayContaining([
        { type: INSPECTOR_TYPE.darkPipeLink },
        { type: INSPECTOR_TYPE.warehouseItemLink, slotGroupIds: ["unloader_buffer"] },
        { type: INSPECTOR_TYPE.slotConfig, slotGroupIds: ["unloader_buffer"] },
      ]));
    }
  });

  it("registers hidden any-fluid void recipes for dark pipe inlets", () => {
    const registry = createRegistryContract();

    expect(registry.recipeDefinitions).toEqual(expect.arrayContaining([
      expect.objectContaining({
        id: "r_udpipe_loader_void_fluid_any_internal",
        machineId: "udpipe_loader_1",
        durationSeconds: 0.5,
        inputs: [{ itemId: FLUID_DOMAIN_RECIPE_ITEM_ID, amount: 1 }],
        outputs: [],
        recipeType: "immediate-consume",
        tags: [TOOLBOX_HIDDEN_RECIPE_TAG],
      }),
      expect.objectContaining({
        id: "r_udpipe_loader_multi_void_fluid_any_internal",
        machineId: "udpipe_loader_2",
        durationSeconds: 0.5,
        inputs: [{ itemId: FLUID_DOMAIN_RECIPE_ITEM_ID, amount: 1 }],
        outputs: [],
        recipeType: "immediate-consume",
        tags: [TOOLBOX_HIDDEN_RECIPE_TAG],
      }),
    ]));
  });
});
