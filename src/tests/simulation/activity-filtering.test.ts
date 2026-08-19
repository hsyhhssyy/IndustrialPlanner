import { describe, expect, it } from "vitest";

import {
  createWorldDocument,
  type WorldDocument,
} from "@/domain/document/world-document";
import type { EntityDefinition } from "@/domain/registry/types/entity-definition";
import { ItemDomainFlag } from "@/domain/shared/item-domain-flags";
import { createRegistryContract } from "@/registry";
import {
  ACTIVITY_LIMITED_FORMULA_1_ID,
} from "@/shared/registry/activity-availability";
import { compileSimulationTopology } from "@/simulation/topology-compiler";

const ACTIVITY_ITEM_ID = "item_activity_xiranite_cmpt";
const ACTIVITY_RECIPE_ID = "r_component_activity_xiranite_cmpt_from_xiranite_powder_basic";

function createActivityTestEntityDefinition(): EntityDefinition {
  return {
    id: "test_activity_machine",
    nameKey: "test.activityMachine",
    spriteId: "test_activity_machine",
    footprint: { width: 1, height: 1 },
    uiGroup: "hidden",
    displayOrder: 10000,
    tags: [],
    requiresPower: false,
    powerDemand: 0,
    inspectors: [],
    placementBehaviors: [],
    portGroups: [
      {
        id: "item_port",
        kind: ItemDomainFlag.Solid,
        isPipe: false,
        direction: "input",
        ports: [
          {
            id: "port_1",
            localCellX: 0,
            localCellY: 0,
            edge: "NORTH",
            acceptRule: { base: { kind: "item", itemId: ACTIVITY_ITEM_ID }, exclude: [] },
            // AI-REMOVED 2026-06-12:
            // Reason: PortDefinition.count per-tick 限流字段已删除。
            // Trigger: 用户要求删除 per tick count。
            // Evidence: 仿真准入数量限制已改为 admissionRule 跨 tick counter。
            // Replacement: None - 此测试仅需要 acceptRule。
            // Risk: Low
            // Human Review: Required
            //
            // Original code:
            // count: "unlimited",
            priorityGroup: 5,
            roundRobinSeed: 0,
          },
        ],
      },
    ],
    storageSlotGroups: [
      {
        id: "buffer",
        kind: ItemDomainFlag.Solid,
        slots: [
          {
            id: "slot_1",
            capacity: 10,
            itemFilter: "type",
            itemFilterType: ItemDomainFlag.Solid,
            lock: ACTIVITY_ITEM_ID,
            initialItemType: ACTIVITY_ITEM_ID,
            initialCount: 5,
            ignoreStock: true,
          },
        ],
      },
    ],
    recipeChannels: [
      {
        id: "default",
        ingredientStorageGroupIds: ["buffer"],
        productStorageGroupIds: ["buffer"],
        manualRecipeOnly: true,
      },
    ],
    portStorageBindings: [
      {
        id: "bind_item_port",
        portGroupId: "item_port",
        storageSlotGroupId: "buffer",
      },
    ],
  };
}

function createActivityTestDocument(): WorldDocument {
  return {
    ...createWorldDocument(),
    entities: {
      machine: {
        id: "machine",
        definitionId: "test_activity_machine",
        position: { x: 0, y: 0 },
        rotation: 0,
        config: {
          channelRecipes: {
            default: ACTIVITY_RECIPE_ID,
          },
        },
        tags: [],
      },
    },
    entityOrder: ["machine"],
  };
}

function compileWithActivities(activeActivityIds: readonly string[]) {
  const registry = createRegistryContract();
  registry.entityDefinitions = [...registry.entityDefinitions, createActivityTestEntityDefinition()];

  return compileSimulationTopology({
    document: createActivityTestDocument(),
    registry,
    simulationMode: "single-base",
    poweredEntityIds: new Set(["machine"]),
    activeActivityIds,
  });
}

describe("simulation activity filtering", () => {
  it("records the activity set instead of compiling registry catalogs into topology", () => {
    const inactiveTopology = compileWithActivities([]);
    const activeTopology = compileWithActivities([ACTIVITY_LIMITED_FORMULA_1_ID]);

    expect(inactiveTopology.activeActivityIds).toEqual([]);
    expect(activeTopology.activeActivityIds).toEqual([ACTIVITY_LIMITED_FORMULA_1_ID]);
  });

  it("treats inactive activity slot configuration and links as empty", () => {
    const inactiveTopology = compileWithActivities([]);
    const slot = inactiveTopology.slots["device:machine/node:buffer/slot:slot_1"];
    const port = inactiveTopology.ports["device:machine/port:item_port.port_1.input"];
    const channel = inactiveTopology.devices["device:machine"]?.recipeChannels[0];

    expect(slot).toMatchObject({
      lock: null,
      initialItemType: null,
      initialCount: 0,
      ignoreStock: false,
    });
    expect(port?.acceptRule.base).toEqual({ kind: "none" });
    expect(channel?.defaultRecipeId).toBeNull();
  });

  it("keeps activity slot configuration and manual recipe when the activity is active", () => {
    const activeTopology = compileWithActivities([ACTIVITY_LIMITED_FORMULA_1_ID]);
    const slot = activeTopology.slots["device:machine/node:buffer/slot:slot_1"];
    const port = activeTopology.ports["device:machine/port:item_port.port_1.input"];
    const channel = activeTopology.devices["device:machine"]?.recipeChannels[0];

    expect(slot).toMatchObject({
      lock: ACTIVITY_ITEM_ID,
      initialItemType: ACTIVITY_ITEM_ID,
      initialCount: 5,
      ignoreStock: true,
    });
    expect(port?.acceptRule.base).toEqual({ kind: "item", itemId: ACTIVITY_ITEM_ID });
    expect(channel?.defaultRecipeId).toBe(ACTIVITY_RECIPE_ID);
  });
});
