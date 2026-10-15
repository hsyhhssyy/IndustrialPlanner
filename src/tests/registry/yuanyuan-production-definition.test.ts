import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import { createRegistryContract } from "@/registry";
import { lookupText } from "@/shared/i18n";
import { resolveBaseAreas } from "@/shared/geometry/base-areas";
import { resolveEntityPlacementAreas } from "@/shared/entity-placement-whitelist";
import { resolveDeviceBodyPresentation } from "@/renderer/sprites/device-texture-key";
import evidence from "../fixtures/registry/akedata-1.6.3-production.json";

const registry = createRegistryContract();

describe("AKEData 1.6 缘缘庄生产数据", () => {
  it("仅新增制造配方与田块收获引用的38个物品，并提供原始中英文名称", () => {
    const referenced = new Set(registry.recipeDefinitions.flatMap(recipe =>
      [...recipe.inputs, ...recipe.outputs].map(item => item.itemId)));
    expect(evidence.items).toHaveLength(38);
    for (const item of evidence.items) {
      const definition = registry.queries.findItemDefinition(item.id)!;
      expect(definition, item.id).not.toBeNull();
      expect(definition.iconId).toBe(item.id);
      expect(referenced.has(item.id), item.id).toBe(true);
      expect(lookupText("zh-CN", definition.nameKey)).toBe(item.zhCN);
      expect(lookupText("en-US", definition.nameKey)).toBe(item.enUS);
    }
    for (const unrelated of ["item_Ingredient_spices_1", "item_ranch_meat_1", "item_corp_cabbage_seed_2"]) {
      expect(registry.queries.findItemDefinition(unrelated)).toBeNull();
    }
  });

  it("25条制造配方保留原始ID、时长、投入产出及现有设备归属", () => {
    const machineAliases: Record<string, string> = {
      seedcollector_1: "seedcol_1",
      filling_powder_mc_1: "filling_pd_mc_1",
    };
    expect(evidence.manufacturingRecipes).toHaveLength(25);
    for (const raw of evidence.manufacturingRecipes) {
      expect(raw.totalProgress).toBe(raw.durationSeconds * 6000);
      const machineId = machineAliases[raw.machineId] ?? raw.machineId;
      const recipe = registry.queries.findRecipeDefinition(raw.id)!;
      expect(recipe, raw.id).toMatchObject({
        durationSeconds: raw.durationSeconds, inputs: raw.inputs, outputs: raw.outputs,
        machineId, recipeType: "immediate-consume",
      });
      expect(registry.queries.findRecipeDefinitionsByMachine(machineId)).toContain(recipe);
      if (machineId === "filling_pd_mc_1") expect(recipe.tags).toContain("bottle_filling");
      expect(lookupText("zh-CN", recipe.nameKey)).not.toBe(recipe.nameKey);
      expect(lookupText("en-US", recipe.nameKey)).not.toBe(recipe.nameKey);
    }
  });

  it("全部旧田块与新版基础收获量一致，保留原有生长时长", () => {
    for (const id of ["soil_grass_1", "soil_grass_2", "soil_moss_1", "soil_moss_2", "soil_moss_3", "soil_bbflower_1", "soil_sp_1", "soil_sp_2", "soil_sp_3", "soil_sp_4"]) {
      const recipe = registry.queries.findRecipeDefinition(`r_${id}_harvest`)!;
      expect(recipe.outputs).toHaveLength(1);
      expect(recipe.outputs[0]!.amount).toBe(id.startsWith("soil_sp_") ? 30 : 10);
      if (id.startsWith("soil_sp_")) {
        const states = registry.queries.findEntityDefinition(id)!.stateMachine!.states;
        expect(states.reduce((seconds, state) => seconds + (state.transition?.kind === "elapsed" ? state.transition.durationSeconds : 0), 0)).toBe(43200);
      }
    }
  });

  it("12种田块只允许缘缘庄区域，统一灌溉并保留副产物与优质双产物", () => {
    const base = registry.baseDefinitions.find(candidate => candidate.id === "wuling_agricultural_land")!;
    const areas = resolveBaseAreas(base);
    expect(evidence.plots).toHaveLength(12);
    for (const raw of evidence.plots) {
      const plot = registry.queries.findEntityDefinition(raw.id)!;
      expect(plot).toMatchObject({ uiGroup: "agriculture", footprint: { width: 4, height: 4 }, requiresPower: false, powerDemand: 0, portGroups: [] });
      expect(lookupText("zh-CN", plot.nameKey)).toBe(raw.zhCN);
      expect(lookupText("en-US", plot.nameKey)).toBe(raw.enUS);
      expect(plot.tags).toContain("AcceptsIrrigation");
      expect(resolveEntityPlacementAreas(plot, base, areas).map(area => area.id)).toEqual(["wuling_yuanyuan_zhuang"]);
      for (const other of registry.baseDefinitions.filter(candidate => candidate.id !== base.id)) {
        expect(resolveEntityPlacementAreas(plot, other, resolveBaseAreas(other))).toEqual([]);
      }
      expect(plot.stateMachine!.states.map(state => state.id)).toEqual(["seedling", "watering-1", "growing-1", "harvest"]);
      expect(plot.stateMachine!.states[2]!.transition).toEqual({ kind: "elapsed", durationSeconds: raw.growthSeconds, nextStateId: "harvest" });
      expect(raw.growthSeconds).toBe(28800);
      expect(registry.queries.findRecipeDefinition(`r_${raw.id}_seedling`)).toMatchObject({ durationSeconds: 2, inputs: [] });
      expect(registry.queries.findRecipeDefinition(`r_${raw.id}_watering`)).toMatchObject({ durationSeconds: 30, requiredEnvironmentAnyOf: ["item_liquid_water", "item_gas_water"] });
      expect(registry.queries.findRecipeDefinition(`r_${raw.id}_harvest`)).toMatchObject({ durationSeconds: 2, outputTarget: "warehouse", outputs: raw.outputs });
      expect(plot.inspectors.filter(inspector => inspector.type === "device-state")).toHaveLength(1);
    }
    const orders = registry.entityDefinitions.filter(definition => definition.id.startsWith("soil_")).map(definition => definition.displayOrder);
    expect(new Set(orders).size).toBe(22);
  });

  it("共用芽针全部状态素材、蓝图方框及avatar，列表图标保持独立路径", async () => {
    const reference = registry.queries.findEntityDefinition("soil_grass_2")!;
    const effects = JSON.parse(await readFile("public/3d-top-view/port-effects/manifest.json", "utf8"));
    const mapping = JSON.parse(await readFile("resources/building-top-view-v15.json", "utf8"));
    for (const raw of evidence.plots) {
      const plot = registry.queries.findEntityDefinition(raw.id)!;
      expect(plot.spriteId).toBe(reference.spriteId);
      expect(plot.iconPath).toBe(`device-icons/item_port_${raw.id}.webp`);
      expect(effects.definitions[raw.id]).toBe(effects.definitions.soil_grass_2);
      expect(mapping.entries.find((entry: { entityId: string }) => entry.entityId === raw.id)).toMatchObject({ spriteId: reference.spriteId, sourcePath: "soil_grass_2/top" });
      for (const state of plot.stateMachine!.states) {
        const top = resolveDeviceBodyPresentation(plot, null, { forceBlueprint: false, allowAnimation: false, visualKey: state.visualKey });
        const expected = resolveDeviceBodyPresentation(reference, null, { forceBlueprint: false, allowAnimation: false, visualKey: state.visualKey });
        expect(top).toEqual(expected);
        expect(resolveDeviceBodyPresentation(plot, null, { forceBlueprint: true, allowAnimation: false, visualKey: state.visualKey }).bodyTextureKey)
          .toBe("blueprint-sprite-soil_grass_2");
      }
    }
    expect(await readFile("public/blueprint-view/sprites/soil_grass_2.webp"))
      .toEqual(await readFile("public/blueprint-view/sprites/soil_grass_1.webp"));
    const avatar = await readFile("public/blueprint-view/avatar/soil_grass_2.webp");
    for (const plot of registry.entityDefinitions.filter(definition => definition.id.startsWith("soil_"))) {
      expect(await readFile(`public/blueprint-view/avatar/${plot.spriteId}.webp`)).toEqual(avatar);
    }
  });
});
