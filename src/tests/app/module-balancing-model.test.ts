import { describe, expect, it } from "vitest";

import type { RegistryContract } from "@/domain/registry/registry-contract";
import type { ModuleBalancingCanvas, ModuleBalancingState } from "@/app/toolbox-types";
import { createRegistryContract } from "@/registry";
import { TOOLBOX_HIDDEN_RECIPE_TAG } from "@/shared/registry/recipe-visibility";
import {
  buildModuleBalancingIndex,
  computeDispatchTicketGroups,
  computeModuleBalancing,
  computeStageModuleTotals,
  matchesModuleSearchQuery,
  resolveInfiniteSystemInputItemIds,
  resolveModuleDisplayTitle,
  resolveModuleIconSrc,
  resolveModuleInputs,
  resolveDispatchTicketRegion,
  resolveDispatchTicketValue,
} from "@/app/shell/module-balancing/module-balancing-model";

const TEST_REGISTRY: RegistryContract = {
  queries: {} as RegistryContract["queries"],
  baseDefinitions: [],
  entityDefinitions: [
    {
      id: "machine_smelter",
      nameKey: "machine.smelter",
      spriteId: "machine_smelter",
      iconPath: "device-icons/smelter-ui-icon.webp",
      footprint: { width: 1, height: 1 },
      uiGroup: "basicProduction",
      displayOrder: 100,
      tags: [],
      requiresPower: true,
      powerDemand: 1,
      inspectors: [],
      placementBehaviors: [],
      portGroups: [],
      storageSlotGroups: [],
      recipeChannels: [],
      portStorageBindings: [],
    },
    {
      id: "machine_assembler",
      nameKey: "machine.assembler",
      spriteId: "machine_assembler",
      iconPath: "device-icons/assembler-ui-icon.webp",
      footprint: { width: 1, height: 1 },
      uiGroup: "advancedManufacturing",
      displayOrder: 100,
      tags: [],
      requiresPower: true,
      powerDemand: 1,
      inspectors: [],
      placementBehaviors: [],
      portGroups: [],
      storageSlotGroups: [],
      recipeChannels: [],
      portStorageBindings: [],
    },
    {
      id: "cheat_machine",
      nameKey: "machine.cheat",
      spriteId: "cheat_machine",
      iconPath: "device-icons/cheat-ui-icon.webp",
      footprint: { width: 1, height: 1 },
      uiGroup: "cheat",
      displayOrder: 701,
      tags: [],
      requiresPower: false,
      powerDemand: 0,
      inspectors: [],
      placementBehaviors: [],
      portGroups: [],
      storageSlotGroups: [],
      recipeChannels: [],
      portStorageBindings: [],
    },
  ],
  entityVariantDefinitions: {},
  itemDefinitions: [
    { id: "ore", nameKey: "item.ore", iconId: "ore", displayOrder: 10000, tags: [] },
    { id: "plate", nameKey: "item.plate", iconId: "plate", displayOrder: 10000, tags: [] },
    { id: "gear", nameKey: "item.gear", iconId: "gear", displayOrder: 10000, tags: ["调度券地区:武陵", "调度券价值:22"] },
    { id: "valley_part", nameKey: "item.valleyPart", iconId: "valley_part", displayOrder: 10000, tags: ["调度券地区:四号谷地", "调度券价值:10"] },
    { id: "valley_part_2", nameKey: "item.valleyPart2", iconId: "valley_part_2", displayOrder: 10000, tags: ["调度券地区:四号谷地", "调度券价值:3"] },
  ],
  recipeDefinitions: [
    {
      id: "smelt_plate",
      nameKey: "recipe.smelt_plate",
      durationSeconds: 2,
      inputs: [{ itemId: "ore", amount: 1 }],
      outputs: [{ itemId: "plate", amount: 1 }],
      machineId: "machine_smelter",
      recipeType: "reserved-item",
      tags: [],
    },
    {
      id: "assemble_gear",
      nameKey: "recipe.assemble_gear",
      durationSeconds: 4,
      inputs: [{ itemId: "plate", amount: 2 }],
      outputs: [{ itemId: "gear", amount: 1 }],
      machineId: "machine_assembler",
      recipeType: "reserved-item",
      tags: [],
    },
    {
      id: "split_plate_and_gear",
      nameKey: "recipe.split_plate_and_gear",
      durationSeconds: 4,
      inputs: [{ itemId: "ore", amount: 2 }],
      outputs: [
        { itemId: "plate", amount: 1 },
        { itemId: "gear", amount: 1 },
      ],
      machineId: "machine_assembler",
      recipeType: "reserved-item",
      tags: [],
    },
    {
      id: "hidden_void_plate",
      nameKey: "recipe.hidden_void_plate",
      durationSeconds: 0.5,
      inputs: [{ itemId: "plate", amount: 1 }],
      outputs: [],
      machineId: "machine_smelter",
      recipeType: "reserved-item",
      tags: [TOOLBOX_HIDDEN_RECIPE_TAG],
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
        notes: "",
        sourceType: "custom",
        inputs: [{ itemId: "gear", perMinute: 5 }],
        outputs: [{ itemId: "plate", perMinute: 10 }],
      },
    ],
  };
}

describe("module-balancing-model", () => {
  it("filters toolbox-hidden recipes from system modules", () => {
    const state = createState();
    const index = buildModuleBalancingIndex(TEST_REGISTRY, state);

    expect(index.recipeById.has("hidden_void_plate")).toBe(false);
    expect(index.systemModules.map((module) => module.recipeId)).not.toContain("hidden_void_plate");
    expect(index.allEntities.map((entity) => entity.id)).not.toContain("cheat_machine");
  });

  it("merges hidden device running consumption into solid-gas transmuter recipes", () => {
    const index = buildModuleBalancingIndex(createRegistryContract(), createState());
    const gasRecipe = index.systemModules.find((module) => (
      module.recipeId === "liquid_transmuter_2_gas_gas_xiranite_1"
    ));
    const solidRecipe = index.systemModules.find((module) => (
      module.recipeId === "liquid_transmuter_2_solid_xiranite_powder_1"
    ));

    expect(gasRecipe).toBeDefined();
    expect(solidRecipe).toBeDefined();
    expect(resolveModuleInputs(gasRecipe!, index)).toEqual([
      { itemId: "item_xiranite_powder", perMinute: 30 },
      { itemId: "item_gas_xiranite", perMinute: 6 },
    ]);
    expect(resolveModuleInputs(solidRecipe!, index)).toEqual([
      { itemId: "item_gas_xiranite", perMinute: 36 },
    ]);
    expect(computeStageModuleTotals({
      id: "stage",
      name: "Solid-Gas",
      entries: [{ moduleId: gasRecipe!.id, quantity: 2 }],
    }, index)).toContainEqual({
      itemId: "item_gas_xiranite",
      totalInput: 12,
      totalOutput: 60,
      netDelta: 48,
    });
    expect(index.systemModules.some((module) => (
      module.recipeId === "r_transmuter_2_gastrans_xiranite_consumption_internal"
    ))).toBe(false);
  });

  it("keeps gas dispersing recipes visible and counts their own consumption only once", () => {
    const index = buildModuleBalancingIndex(createRegistryContract(), createState());
    const recipeId = "r_gas_diffuser_xiranite_gas_environment_basic";
    const module = index.systemModules.find((candidate) => candidate.recipeId === recipeId);

    expect(module).toBeDefined();
    expect(resolveModuleInputs(module!, index)).toEqual([
      { itemId: "item_gas_xiranite", perMinute: 6 },
    ]);
    expect(computeStageModuleTotals({
      id: "stage",
      name: "Gas Dispersing",
      entries: [{ moduleId: recipeId, quantity: 1 }],
    }, index)).toEqual([
      {
        itemId: "item_gas_xiranite",
        totalInput: 6,
        totalOutput: 0,
        netDelta: -6,
      },
    ]);
  });

  it("uses the device icon and output/device title for system recipes", () => {
    const index = buildModuleBalancingIndex(TEST_REGISTRY, createState());
    const module = index.systemModules.find((entry) => entry.id === "split_plate_and_gear");
    expect(module).toBeDefined();

    const translate = (key: string) => ({
      "item.plate": "铁板",
      "item.gear": "齿轮",
      "machine.assembler": "装配机",
    })[key] ?? key;

    expect(resolveModuleDisplayTitle(module!, index, translate)).toBe("铁板 · 齿轮 · 装配机");
    expect(resolveModuleIconSrc(module!, index)).toContain("device-icons/assembler-ui-icon.webp");
  });

  it("searches every output and device names by Chinese, full pinyin, and pinyin initials", () => {
    const index = buildModuleBalancingIndex(TEST_REGISTRY, createState());
    const module = index.systemModules.find((entry) => entry.id === "split_plate_and_gear");
    expect(module).toBeDefined();

    const translate = (key: string) => ({
      "item.ore": "矿石",
      "item.plate": "铁板",
      "item.gear": "齿轮",
      "machine.assembler": "装配机",
      "recipe.split_plate_and_gear": "分流配方",
    })[key] ?? key;

    expect(matchesModuleSearchQuery(module!, "齿轮", index, translate)).toBe(true);
    expect(matchesModuleSearchQuery(module!, "chilun", index, translate)).toBe(true);
    expect(matchesModuleSearchQuery(module!, "cl", index, translate)).toBe(true);
    expect(matchesModuleSearchQuery(module!, "zhuang pei ji", index, translate)).toBe(true);
    expect(matchesModuleSearchQuery(module!, "zpj", index, translate)).toBe(true);
  });

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

  it("excludes infinite system inputs from every stage, summary, and warehouse forecast", () => {
    const state = createState();
    const index = buildModuleBalancingIndex(TEST_REGISTRY, state);
    const canvas: ModuleBalancingCanvas = {
      id: "canvas",
      name: "Infinite",
      globalInputs: [{ itemId: "ore", perMinute: 0, infinite: true }],
      stages: [{
        id: "stage-1",
        name: "Smelt",
        entries: [{ moduleId: "smelt_plate", quantity: 1 }],
      }],
      warehouseCapacity: 60,
    };

    const result = computeModuleBalancing(canvas, index);

    expect([...resolveInfiniteSystemInputItemIds(canvas)]).toEqual(["ore"]);
    expect(result.stageBalances[0]?.balances.some((balance) => balance.itemId === "ore")).toBe(false);
    expect(result.summaryBalances.some((balance) => balance.itemId === "ore")).toBe(false);
    expect(result.warehouseForecasts.some((forecast) => forecast.itemId === "ore")).toBe(false);
    expect(result.summaryBalances).toContainEqual({
      itemId: "plate",
      totalInput: 0,
      totalOutput: 30,
      netDelta: 30,
    });
  });

  it("excludes infinite system items when stage totals are used to generate a module", () => {
    const state = createState();
    const index = buildModuleBalancingIndex(TEST_REGISTRY, state);

    expect(computeStageModuleTotals({
      id: "stage",
      name: "Smelt",
      entries: [{ moduleId: "smelt_plate", quantity: 1 }],
    }, index, new Set(["ore", "plate"]))).toEqual([]);
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

  it("uses version-provided recommended module ports in stage totals", () => {
    const state = createState();
    const index = buildModuleBalancingIndex(TEST_REGISTRY, state, {
      recommendedModules: [{
        id: "recommended:starter",
        name: "Starter",
        color: "#4f8cff",
        iconId: "gear",
        notes: "",
        inputs: [{ itemId: "plate", perMinute: 30 }],
        outputs: [{ itemId: "gear", perMinute: 15 }],
        sourceType: "recommended",
      }],
    });

    expect(computeStageModuleTotals({
      id: "stage",
      name: "Recommended",
      entries: [{ moduleId: "recommended:starter", quantity: 2 }],
    }, index)).toEqual(expect.arrayContaining([
      { itemId: "plate", totalInput: 60, totalOutput: 0, netDelta: -60 },
      { itemId: "gear", totalInput: 0, totalOutput: 30, netDelta: 30 },
    ]));
  });

  it("groups positive dispatch ticket output by region", () => {
    const state = createState();
    const index = buildModuleBalancingIndex(TEST_REGISTRY, state);
    const canvas: ModuleBalancingCanvas = {
      id: "canvas",
      name: "Main",
      globalInputs: [
        { itemId: "ore", perMinute: 30 },
        { itemId: "valley_part", perMinute: 3 },
        { itemId: "valley_part_2", perMinute: 2 },
      ],
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
      warehouseCapacity: null,
    };

    const result = computeModuleBalancing(canvas, index);

    // gear has netDelta 7.5, dispatch ticket value 22 → dispatchPerMin = 7.5 * 22 = 165
    // Valley 4 parts produce 3 * 10 + 2 * 3 = 36 dispatch tickets per minute.
    expect(result.dispatchTicketGroups).toEqual([
      {
        region: "武陵",
        items: [{
          itemId: "gear",
          value: 22,
          region: "武陵",
          netDelta: 7.5,
          dispatchPerMin: 165,
        }],
        totalDispatchPerMin: 165,
      },
      {
        region: "四号谷地",
        items: [
          {
            itemId: "valley_part",
            value: 10,
            region: "四号谷地",
            netDelta: 3,
            dispatchPerMin: 30,
          },
          {
            itemId: "valley_part_2",
            value: 3,
            region: "四号谷地",
            netDelta: 2,
            dispatchPerMin: 6,
          },
        ],
        totalDispatchPerMin: 36,
      },
    ]);
  });

  it("omits dispatch ticket regions with no positive net output", () => {
    const index = buildModuleBalancingIndex(TEST_REGISTRY, createState());

    expect(computeDispatchTicketGroups([
      { itemId: "gear", totalInput: 2, totalOutput: 1, netDelta: -1 },
      { itemId: "valley_part", totalInput: 2, totalOutput: 2, netDelta: 0 },
    ], index)).toEqual([]);
  });

  it("rejects ambiguous or unknown dispatch ticket metadata", () => {
    expect(resolveDispatchTicketValue(["调度券价值:22", "调度券价值:23"])).toBe(0);
    expect(resolveDispatchTicketValue(["调度券价值:22invalid"])).toBe(0);
    expect(resolveDispatchTicketRegion(["调度券地区:谷地"])).toBeNull();
    expect(resolveDispatchTicketRegion(["调度券地区:武陵", "调度券地区:四号谷地"])).toBeNull();
  });
});
