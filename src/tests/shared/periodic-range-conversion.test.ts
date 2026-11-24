import { describe, expect, it } from "vitest";

import { createWorldDocument, type WorldDocument } from "@/domain/document/world-document";
import type { EntityDefinition } from "@/domain/registry/types/entity-definition";
import type { PeriodicRangeConversionProgram } from "@/domain/registry/types/periodic-range-conversion";
import type { RecipeDefinition } from "@/domain/registry/types/recipe-definition";
import { createRegistryContract } from "@/registry";
import { createRegistryQuery } from "@/registry/registry-query";
import { CONSUMPTION_RECIPE_TAG } from "@/shared/consumption-channel";
import {
  collectPeriodicRangeRegions,
  createPeriodicRangeProgramSignature,
  createPeriodicRangeRegionId,
  findPeriodicRangeRegionsAtGridCell,
  isPeriodicRangeRegionLayoutLegal,
  resolvePeriodicRangeLayoutAggregate,
  resolvePeriodicRangeLayerState,
  type PeriodicRangeRegion,
} from "@/shared/periodic-range-conversion";

const MACHINE_ID = "fixture:periodic-transmuter";
const PROGRAM: PeriodicRangeConversionProgram = {
  id: "fixture:program",
  periodSeconds: 10,
  effects: [
    { probabilityByLayer: [1], outputItemByInputId: {} },
    { probabilityByLayer: [1], outputItemByInputId: {} },
    { probabilityByLayer: [0.4], outputItemByInputId: {} },
  ],
};

function asEffects(
  effects: readonly PeriodicRangeConversionProgram["effects"][number][],
): PeriodicRangeConversionProgram["effects"] {
  return effects as PeriodicRangeConversionProgram["effects"];
}

function createDefinition(options: {
  ranges?: EntityDefinition["ranges"];
  channels?: EntityDefinition["recipeChannels"];
  machineId?: string;
} = {}): EntityDefinition {
  return {
    id: options.machineId ?? MACHINE_ID,
    nameKey: "fixture:periodic-transmuter",
    spriteId: "fixture",
    iconPath: "",
    footprint: { width: 1, height: 1 },
    displayOrder: 1,
    uiGroup: "hidden",
    tags: [],
    inspectors: [],
    requiresPower: false,
    powerDemand: 0,
    placementBehaviors: [],
    portGroups: [],
    storageSlotGroups: [],
    portStorageBindings: [],
    recipeChannels: options.channels ?? [{
      id: "phase",
      type: "consumption-channel",
      manualRecipeOnly: true,
      ingredientStorageGroupIds: [],
      productStorageGroupIds: [],
    }],
    ranges: options.ranges ?? [{
      id: "primary",
      localRect: { x: 0, y: 0, width: 2, height: 2 },
      coverage: "contains",
      visualId: "fixture:primary",
    }],
  };
}

function createRecipe(options: {
  id: string;
  side: 0 | 1;
  machineId?: string;
  rangeIds?: readonly string[];
  program?: PeriodicRangeConversionProgram;
}): RecipeDefinition {
  return {
    id: options.id,
    nameKey: options.id,
    machineId: options.machineId ?? MACHINE_ID,
    durationSeconds: 1,
    inputs: [],
    outputs: [],
    recipeType: "reserved-item",
    tags: [CONSUMPTION_RECIPE_TAG],
    periodicRangeConversion: {
      side: options.side,
      rangeIds: options.rangeIds ?? ["primary"],
      program: options.program ?? PROGRAM,
    },
  };
}

function createFixture(options: {
  definitions?: readonly EntityDefinition[];
  recipes?: readonly RecipeDefinition[];
} = {}) {
  const baseRegistry = createRegistryContract();
  const entityDefinitions = [...baseRegistry.entityDefinitions, ...(options.definitions ?? [createDefinition()])];
  const recipeDefinitions = [
    ...baseRegistry.recipeDefinitions,
    ...(options.recipes ?? [createRecipe({ id: "fixture:ming", side: 0 }), createRecipe({ id: "fixture:hui", side: 1 })]),
  ];
  const registry = {
    ...baseRegistry,
    entityDefinitions,
    recipeDefinitions,
    queries: createRegistryQuery({
      entityDefinitions,
      itemDefinitions: baseRegistry.itemDefinitions,
      recipeDefinitions,
    }),
  };
  return { registry, document: createWorldDocument({ baseId: "draft_box" }) };
}

function addEntity(
  document: WorldDocument,
  id: string,
  recipeId: string | null,
  options: {
    position?: { x: number; y: number };
    channelRecipes?: Readonly<Record<string, string>>;
  } = {},
): void {
  const channelRecipes = options.channelRecipes ?? (recipeId === null ? {} : { phase: recipeId });
  document.entities[id] = {
    id,
    definitionId: MACHINE_ID,
    position: options.position ?? { x: 0, y: 0 },
    rotation: 0,
    config: { channelRecipes },
    tags: [],
  };
  document.entityOrder.push(id);
}

function onlyRegion(regions: readonly PeriodicRangeRegion[]): PeriodicRangeRegion {
  expect(regions).toHaveLength(1);
  return regions[0]!;
}

describe("周期范围区域共享模型", () => {
  it("完全重合的来源合并为一个区域，三明一晦按一层衡与 40% 聚合", () => {
    const { registry, document } = createFixture();
    addEntity(document, "ming-1", "fixture:ming");
    addEntity(document, "ming-2", "fixture:ming");
    addEntity(document, "ming-3", "fixture:ming");
    addEntity(document, "hui-1", "fixture:hui");

    const region = onlyRegion(collectPeriodicRangeRegions({ document, registry, activeActivityIds: [] }));

    expect(region.documentKey).toBe(document.documentKey);
    expect(region.gridRect).toEqual({ x: 0, y: 0, width: 2, height: 2 });
    expect(region.sources.map((source) => source.side)).toEqual(["ming", "ming", "ming", "hui"]);
    expect(isPeriodicRangeRegionLayoutLegal(region)).toBe(true);
    expect(resolvePeriodicRangeLayoutAggregate(region)).toEqual({
      effect: "heng",
      layers: 1,
      probability: 0.4,
    });
  });

  it("添加来源不改变区域身份，移除来源后身份保持不变", () => {
    const { registry, document } = createFixture();
    addEntity(document, "ming-1", "fixture:ming");
    const first = onlyRegion(collectPeriodicRangeRegions({ document, registry, activeActivityIds: [] }));

    addEntity(document, "hui-1", "fixture:hui");
    const second = onlyRegion(collectPeriodicRangeRegions({ document, registry, activeActivityIds: [] }));
    expect(second.regionId).toBe(first.regionId);

    delete document.entities["hui-1"];
    document.entityOrder = document.entityOrder.filter((id) => id !== "hui-1");
    const third = onlyRegion(collectPeriodicRangeRegions({ document, registry, activeActivityIds: [] }));
    expect(third.regionId).toBe(first.regionId);
    expect(third.sources.map((source) => source.side)).toEqual(["ming"]);
  });

  it("分影炉两个通道作用于两个区域，各自只记录本侧来源", () => {
    const definition = createDefinition({
      channels: [
        {
          id: "ming-side", type: "consumption-channel", manualRecipeOnly: true,
          ingredientStorageGroupIds: [], productStorageGroupIds: [],
        },
        {
          id: "hui-side", type: "consumption-channel", manualRecipeOnly: true,
          ingredientStorageGroupIds: [], productStorageGroupIds: [],
        },
      ],
      ranges: [
        {
          id: "west", localRect: { x: -5, y: 0, width: 2, height: 2 },
          coverage: "contains", visualId: "fixture:west",
        },
        {
          id: "east", localRect: { x: 5, y: 0, width: 2, height: 2 },
          coverage: "contains", visualId: "fixture:east",
        },
      ],
    });
    const recipes = [
      createRecipe({ id: "fixture:ming", side: 0, rangeIds: ["west"] }),
      createRecipe({ id: "fixture:hui", side: 1, rangeIds: ["east"] }),
    ];
    const { registry, document } = createFixture({ definitions: [definition], recipes });
    addEntity(document, "split", null, {
      position: { x: 5, y: 0 },
      channelRecipes: { "ming-side": "fixture:ming", "hui-side": "fixture:hui" },
    });

    const regions = collectPeriodicRangeRegions({ document, registry, activeActivityIds: [] });
    expect(regions.map((region) => region.gridRect)).toEqual([
      { x: 0, y: 0, width: 2, height: 2 },
      { x: 10, y: 0, width: 2, height: 2 },
    ]);
    expect(regions.map((region) => region.sources.map((source) => source.side))).toEqual([["ming"], ["hui"]]);
    expect(new Set(regions.map((region) => region.regionId)).size).toBe(2);
  });

  it("不同地图的同坐标区域身份相互独立", () => {
    const { registry, document } = createFixture();
    addEntity(document, "ming-1", "fixture:ming");
    const first = onlyRegion(collectPeriodicRangeRegions({ document, registry, activeActivityIds: [] }));

    const otherDocument = { ...document, documentKey: `${document.documentKey}-other` };
    const second = onlyRegion(collectPeriodicRangeRegions({ document: otherDocument, registry, activeActivityIds: [] }));

    expect(second.regionId).not.toBe(first.regionId);
    expect(second.regionId).toBe(createPeriodicRangeRegionId(
      otherDocument.documentKey,
      second.programSignature,
      second.gridRect,
    ));
  });

  it("部分重叠导致两个区域都非法，但保留可点选区域", () => {
    const definition = createDefinition({
      ranges: [{
        id: "primary",
        localRect: { x: 0, y: 0, width: 3, height: 2 },
        coverage: "contains",
        visualId: "fixture:primary",
      }],
    });
    const { registry, document } = createFixture({ definitions: [definition] });
    addEntity(document, "left", "fixture:ming", { position: { x: 0, y: 0 } });
    addEntity(document, "right", "fixture:hui", { position: { x: 1, y: 0 } });

    const regions = collectPeriodicRangeRegions({
      document,
      registry,
      activeActivityIds: [],
      isSourceInvalid: () => true,
    });

    expect(regions).toHaveLength(2);
    for (const region of regions) {
      expect(isPeriodicRangeRegionLayoutLegal(region)).toBe(false);
      expect(resolvePeriodicRangeLayoutAggregate(region)).toEqual({
        effect: null,
        layers: 0,
        probability: null,
      });
    }
  });

  it("失效来源不再提供效果，其余来源仍维持区域合法", () => {
    const { registry, document } = createFixture();
    addEntity(document, "ming-1", "fixture:ming");
    addEntity(document, "hui-1", "fixture:hui");

    const remainingMing = collectPeriodicRangeRegions({
      document,
      registry,
      activeActivityIds: [],
      isSourceInvalid: (entityId) => entityId === "hui-1",
    });
    const mingRegion = onlyRegion(remainingMing);
    expect(isPeriodicRangeRegionLayoutLegal(mingRegion)).toBe(true);
    expect(resolvePeriodicRangeLayoutAggregate(mingRegion)).toEqual({
      effect: "ming",
      layers: 1,
      probability: 1,
    });

    const allInvalid = collectPeriodicRangeRegions({
      document,
      registry,
      activeActivityIds: [],
      isSourceInvalid: () => true,
    });
    expect(isPeriodicRangeRegionLayoutLegal(onlyRegion(allInvalid))).toBe(false);
  });

  it("手动通道未选择或选择已失效时保留区域但不提供相位", () => {
    const { registry, document } = createFixture();
    addEntity(document, "unselected", null, { position: { x: 0, y: 0 } });
    addEntity(document, "stale", "fixture:missing", { position: { x: 10, y: 0 } });

    const regions = collectPeriodicRangeRegions({ document, registry, activeActivityIds: [] });
    expect(regions).toHaveLength(2);
    for (const region of regions) {
      expect(region.sources.map((source) => source.side)).toEqual([null]);
      expect(resolvePeriodicRangeLayoutAggregate(region)).toEqual({
        effect: null,
        layers: 0,
        probability: null,
      });
    }
  });

  it("程序签名与输出映射键顺序无关，身份随程序内容变化", () => {
    const reordered: PeriodicRangeConversionProgram = {
      ...PROGRAM,
      effects: asEffects(PROGRAM.effects.map((effect) => ({
        ...effect,
        outputItemByInputId: Object.fromEntries(Object.entries(effect.outputItemByInputId).reverse()),
      }))),
    };
    const withOutputs: PeriodicRangeConversionProgram = {
      ...PROGRAM,
      effects: asEffects(PROGRAM.effects.map((effect, index) => ({
        ...effect,
        outputItemByInputId: index === 0 ? { a: "b", c: "d" } : effect.outputItemByInputId,
      }))),
    };
    const reversedOutputs: PeriodicRangeConversionProgram = {
      ...withOutputs,
      effects: asEffects(withOutputs.effects.map((effect, index) => ({
        ...effect,
        outputItemByInputId: index === 0 ? { c: "d", a: "b" } : effect.outputItemByInputId,
      }))),
    };

    expect(createPeriodicRangeProgramSignature(reordered)).toBe(createPeriodicRangeProgramSignature(PROGRAM));
    expect(createPeriodicRangeProgramSignature(reversedOutputs))
      .toBe(createPeriodicRangeProgramSignature(withOutputs));
    expect(createPeriodicRangeProgramSignature({ ...PROGRAM, periodSeconds: 11 }))
      .not.toBe(createPeriodicRangeProgramSignature(PROGRAM));
  });

  it("区域命中按合并矩形判断，边界外不命中", () => {
    const { registry, document } = createFixture();
    addEntity(document, "ming-1", "fixture:ming");
    const regions = collectPeriodicRangeRegions({ document, registry, activeActivityIds: [] });

    expect(findPeriodicRangeRegionsAtGridCell(regions, { x: 0, y: 0 })).toHaveLength(1);
    expect(findPeriodicRangeRegionsAtGridCell(regions, { x: 1, y: 1 })).toHaveLength(1);
    expect(findPeriodicRangeRegionsAtGridCell(regions, { x: 2, y: 1 })).toHaveLength(0);
    expect(findPeriodicRangeRegionsAtGridCell(regions, { x: 1, y: 2 })).toHaveLength(0);
  });

  it("明晦配对与单侧层数共用同一规则", () => {
    expect(resolvePeriodicRangeLayerState(3, 1)).toEqual({ effect: "heng", layers: 1 });
    expect(resolvePeriodicRangeLayerState(2, 2)).toEqual({ effect: "heng", layers: 2 });
    expect(resolvePeriodicRangeLayerState(2, 0)).toEqual({ effect: "ming", layers: 2 });
    expect(resolvePeriodicRangeLayerState(0, 3)).toEqual({ effect: "hui", layers: 3 });
    expect(resolvePeriodicRangeLayerState(0, 0)).toEqual({ effect: null, layers: 0 });
  });
});
