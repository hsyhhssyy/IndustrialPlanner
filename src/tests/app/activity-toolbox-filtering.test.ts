import { describe, expect, it } from "vitest";

import type { ModuleBalancingCanvas, ModuleBalancingState } from "@/app/toolbox-types";
import {
  buildModuleBalancingIndex,
  canvasContainsInactiveActivityContent,
  moduleContainsInactiveActivityContent,
} from "@/app/shell/module-balancing/module-balancing-model";
import { buildProductionPlanningIndex } from "@/app/shell/production-planning/production-planning-model";
import { createRegistryContract } from "@/registry";
import { ACTIVITY_LIMITED_FORMULA_1_ID } from "@/shared/registry/activity-availability";

const ACTIVITY_ITEM_ID = "item_activity_xiranite_cmpt";
const ACTIVITY_RECIPE_ID = "r_component_activity_xiranite_cmpt_from_xiranite_powder_basic";

function createModuleBalancingState(canvas: ModuleBalancingCanvas): ModuleBalancingState {
  return {
    activeCanvasId: canvas.id,
    canvases: [canvas],
    customModules: [
      {
        id: "custom_activity_module",
        name: "Activity Module",
        color: "#4f8cff",
        iconId: ACTIVITY_ITEM_ID,
        notes: "",
        sourceType: "custom",
        inputs: [],
        outputs: [{ itemId: ACTIVITY_ITEM_ID, perMinute: 60 }],
      },
    ],
  };
}

describe("activity toolbox filtering", () => {
  it("filters inactive activity content from production planning index when show-all is disabled", () => {
    const registry = createRegistryContract();
    const inactiveIndex = buildProductionPlanningIndex(registry, {
      includeInactiveActivityContent: false,
      activeActivityIds: [],
    });
    const activeIndex = buildProductionPlanningIndex(registry, {
      includeInactiveActivityContent: false,
      activeActivityIds: [ACTIVITY_LIMITED_FORMULA_1_ID],
    });
    const showAllIndex = buildProductionPlanningIndex(registry, {
      includeInactiveActivityContent: true,
      activeActivityIds: [],
    });

    expect(inactiveIndex.itemById.has(ACTIVITY_ITEM_ID)).toBe(false);
    expect(inactiveIndex.recipeById.has(ACTIVITY_RECIPE_ID)).toBe(false);
    expect(activeIndex.itemById.has(ACTIVITY_ITEM_ID)).toBe(true);
    expect(activeIndex.recipeById.has(ACTIVITY_RECIPE_ID)).toBe(true);
    expect(showAllIndex.itemById.has(ACTIVITY_ITEM_ID)).toBe(true);
    expect(showAllIndex.recipeById.has(ACTIVITY_RECIPE_ID)).toBe(true);
  });

  it("detects inactive activity modules and canvases without deleting persisted data", () => {
    const registry = createRegistryContract();
    const canvas: ModuleBalancingCanvas = {
      id: "canvas",
      name: "Activity Canvas",
      globalInputs: [{ itemId: ACTIVITY_ITEM_ID, perMinute: 60 }],
      stages: [
        {
          id: "stage",
          name: "Stage",
          entries: [{ moduleId: ACTIVITY_RECIPE_ID, quantity: 1 }],
        },
      ],
      warehouseCapacity: null,
    };
    const state = createModuleBalancingState(canvas);
    const inactiveIndex = buildModuleBalancingIndex(registry, state, {
      includeInactiveActivityContent: false,
      activeActivityIds: [],
    });
    const activeIndex = buildModuleBalancingIndex(registry, state, {
      includeInactiveActivityContent: false,
      activeActivityIds: [ACTIVITY_LIMITED_FORMULA_1_ID],
    });
    const customModule = state.customModules[0]!;

    expect(inactiveIndex.systemModules.map((module) => module.recipeId)).not.toContain(ACTIVITY_RECIPE_ID);
    expect(moduleContainsInactiveActivityContent(customModule, inactiveIndex, [])).toBe(true);
    expect(canvasContainsInactiveActivityContent(canvas, inactiveIndex, [])).toBe(true);
    expect(state.customModules).toHaveLength(1);
    expect(state.canvases).toHaveLength(1);

    expect(activeIndex.systemModules.map((module) => module.recipeId)).toContain(ACTIVITY_RECIPE_ID);
    expect(moduleContainsInactiveActivityContent(customModule, activeIndex, [ACTIVITY_LIMITED_FORMULA_1_ID])).toBe(false);
    expect(canvasContainsInactiveActivityContent(canvas, activeIndex, [ACTIVITY_LIMITED_FORMULA_1_ID])).toBe(false);
  });
});
