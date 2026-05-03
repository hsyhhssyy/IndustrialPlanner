import { describe, expect, it } from "vitest";

import type { RegistryContract } from "@/domain/contract/registry-contracts";
import type { ModuleBalancingCanvas, ModuleBalancingState } from "@/domain/state/types";
import {
  buildModuleBalancingIndex,
  computeModuleBalancing,
  computeStageModuleTotals,
} from "@/app/shell/components/module-balancing-model";

const TEST_REGISTRY: RegistryContract = {
  queries: {} as RegistryContract["queries"],
  baseDefinitions: [],
  entityDefinitions: [
    {
      id: "machine_smelter",
      nameKey: "machine.smelter",
      spriteId: "machine_smelter",
      footprint: { width: 1, height: 1 },
      uiGroup: "basicProduction",
      tags: [],
      requiresPower: true,
      powerDemand: 1,
      inspectors: {},
      portGroups: [],
      storageSlotGroups: [],
      portStorageBindings: [],
    },
    {
      id: "machine_assembler",
      nameKey: "machine.assembler",
      spriteId: "machine_assembler",
      footprint: { width: 1, height: 1 },
      uiGroup: "advancedManufacturing",
      tags: [],
      requiresPower: true,
      powerDemand: 1,
      inspectors: {},
      portGroups: [],
      storageSlotGroups: [],
      portStorageBindings: [],
    },
  ],
  itemDefinitions: [
    { id: "ore", nameKey: "item.ore", iconId: "ore", tags: [] },
    { id: "plate", nameKey: "item.plate", iconId: "plate", tags: [] },
    { id: "gear", nameKey: "item.gear", iconId: "gear", tags: [] },
  ],
  recipeDefinitions: [
    {
      id: "smelt_plate",
      nameKey: "recipe.smelt_plate",
      durationSeconds: 2,
      inputs: [{ itemId: "ore", amount: 1 }],
      outputs: [{ itemId: "plate", amount: 1 }],
      machineId: "machine_smelter",
      tags: [],
    },
    {
      id: "assemble_gear",
      nameKey: "recipe.assemble_gear",
      durationSeconds: 4,
      inputs: [{ itemId: "plate", amount: 2 }],
      outputs: [{ itemId: "gear", amount: 1 }],
      machineId: "machine_assembler",
      tags: [],
    },
  ],
};

function createState(): ModuleBalancingState {
  return {
    activeCanvasId: "canvas",
    canvases: [],
    customModules: [
      {
        id: "custom_loop",
        name: "Loop",
        color: "#4f8cff",
        iconId: "gear",
        sourceType: "custom",
        inputs: [{ itemId: "gear", perMinute: 5 }],
        outputs: [{ itemId: "plate", perMinute: 10 }],
      },
    ],
  };
}

describe("module-balancing-model", () => {
  it("computes global inputs, recipe quantities, stage balances, and warehouse forecasts", () => {
    const state = createState();
    const index = buildModuleBalancingIndex(TEST_REGISTRY, state);
    const canvas: ModuleBalancingCanvas = {
      id: "canvas",
      name: "Main",
      globalInputs: [{ itemId: "ore", perMinute: 30 }],
      stages: [
        {
          id: "stage-1",
          name: "Smelt",
          entries: [{ moduleId: "smelt_plate", quantity: 1 }],
        },
        {
          id: "stage-2",
          name: "Gear",
          entries: [{ moduleId: "assemble_gear", quantity: 0.5 }],
        },
      ],
      warehouseCapacity: 60,
    };

    const result = computeModuleBalancing(canvas, index);

    expect(result.stageBalances).toHaveLength(2);
    expect(result.stageBalances[0]?.balances).toEqual(expect.arrayContaining([
      { itemId: "ore", totalInput: 30, totalOutput: 30, netDelta: 0 },
      { itemId: "plate", totalInput: 0, totalOutput: 30, netDelta: 30 },
    ]));
    expect(result.summaryBalances).toEqual(expect.arrayContaining([
      { itemId: "ore", totalInput: 30, totalOutput: 30, netDelta: 0 },
      { itemId: "plate", totalInput: 15, totalOutput: 30, netDelta: 15 },
      { itemId: "gear", totalInput: 0, totalOutput: 7.5, netDelta: 7.5 },
    ]));
    expect(result.warehouseForecasts).toEqual(expect.arrayContaining([
      { itemId: "plate", netDeltaPerMin: 15, timeToFillMinutes: 4, timeToEmptyMinutes: null },
      { itemId: "gear", netDeltaPerMin: 7.5, timeToFillMinutes: 8, timeToEmptyMinutes: null },
    ]));
  });

  it("uses custom module ports in stage totals", () => {
    const state = createState();
    const index = buildModuleBalancingIndex(TEST_REGISTRY, state);

    expect(computeStageModuleTotals({
      id: "stage",
      name: "Custom",
      entries: [{ moduleId: "custom_loop", quantity: 2 }],
    }, index)).toEqual(expect.arrayContaining([
      { itemId: "gear", totalInput: 10, totalOutput: 0, netDelta: -10 },
      { itemId: "plate", totalInput: 0, totalOutput: 20, netDelta: 20 },
    ]));
  });
});