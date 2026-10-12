import { readFile } from "node:fs/promises";
import sharp from "sharp";
import { describe, expect, it } from "vitest";
import { createRegistryContract } from "@/registry";
import { lookupText } from "@/shared/i18n";

const EXPECTED_PLOTS = [
  ["soil_grass_1", "锦草田块", "Jincao Plot"],
  ["soil_grass_2", "芽针田块", "Yazhen Plot"],
  ["soil_moss_1", "荞花田块", "Buckflower Plot"],
  ["soil_moss_2", "柑实田块", "Citrome Plot"],
  ["soil_moss_3", "砂叶田块", "Sandleaf Plot"],
  ["soil_bbflower_1", "酮化灌木田块", "Aketine Plot"],
  ["soil_sp_1", "灰芦麦田块", "Reed Rye Plot"],
  ["soil_sp_2", "苦叶椒田块", "Tartpepper Plot"],
  ["soil_sp_3", "琼叶参田块", "Redjade Ginseng Plot"],
  ["soil_sp_4", "金石稻田块", "Amber Rice Plot"],
] as const;

describe("普通田块建筑定义", () => {
  const registry = createRegistryContract();
  const plots = registry.entityDefinitions.filter((definition) => definition.uiGroup === "agriculture");

  it("收录全部十种普通田块并提供原始中英文名称，排除模拟及无名田块", () => {
    expect(plots.map((definition) => definition.id)).toEqual(EXPECTED_PLOTS.map(([id]) => id));
    for (const [id, zh, en] of EXPECTED_PLOTS) {
      const definition = registry.queries.findEntityDefinition(id)!;
      expect(lookupText("zh-CN", definition.nameKey)).toBe(zh);
      expect(lookupText("en-US", definition.nameKey)).toBe(en);
      expect(definition.footprint).toEqual({ width: 4, height: 4 });
      expect(definition.requiresPower).toBe(false);
      expect(definition.powerDemand).toBe(0);
      expect(definition.portGroups).toEqual([]);
      expect(definition.recipeChannels).toEqual([]);
    }
    expect(registry.entityDefinitions.filter((definition) => definition.id.startsWith("soil")).map((definition) => definition.id))
      .toEqual(EXPECTED_PLOTS.map(([id]) => id));
    expect(new Set(plots.map((definition) => definition.displayOrder)).size).toBe(10);
  });

  it("独立作物精灵保留相同的无端口方框蓝图，遮罩与实际像素一致", async () => {
    expect(new Set(plots.map((definition) => definition.spriteId))).toEqual(new Set(EXPECTED_PLOTS.map(([id]) => id)));
    const sprite = await sharp("public/blueprint-view/sprites/soil_grass_1.webp")
      .ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    const mask = await sharp("public/blueprint-view/sprite-masks/soil_grass_1.webp")
      .ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    expect([sprite.info.width, sprite.info.height]).toEqual([512, 512]);
    expect([mask.info.width, mask.info.height]).toEqual([512, 512]);
    expect(sprite.data[(256 * 512 + 256) * 4 + 3]).toBe(0);
    expect(sprite.data[3]).toBe(0);
    expect(sprite.data[(256 * 512 + 20) * 4 + 3]).toBe(255);
    for (let index = 0; index < 512 * 512; index += 1) {
      if (mask.data[index * 4] !== sprite.data[index * 4 + 3]) {
        throw new Error(`田块遮罩与蓝图 alpha 不一致：pixel=${index}`);
      }
    }
    for (const definition of plots) {
      expect(await readFile(`public/blueprint-view/sprites/${definition.spriteId}.webp`))
        .toEqual(await readFile("public/blueprint-view/sprites/soil_grass_1.webp"));
      expect(await readFile(`public/blueprint-view/sprite-masks/${definition.spriteId}.webp`))
        .toEqual(await readFile("public/blueprint-view/sprite-masks/soil_grass_1.webp"));
    }
  });

  it("十种田块使用成株静态图、匹配的高度和各自游戏图标", async () => {
    const mapping = JSON.parse(await readFile("resources/building-top-view-v15.json", "utf8"));
    const effects = JSON.parse(await readFile("public/3d-top-view/port-effects/manifest.json", "utf8"));
    const images = [];
    for (const definition of plots) {
      expect(definition.spriteAnimation).toBeUndefined();
      expect(definition.iconPath).toBe(`device-icons/item_port_${definition.id}.webp`);
      expect(mapping.entries.find((entry: { entityId: string }) => entry.entityId === definition.id))
        .toMatchObject({ spriteId: definition.id, sourcePath: `${definition.id}/top`, animated: false, staticPhase: "soil_1_mature" });
      expect(effects.views[`${definition.id}/top`].stateMapping.default).toBe("soil_1_mature");
      const image = await readFile(`public/3d-top-view/sprites/${definition.spriteId}.webp`);
      images.push(image.toString("base64"));
      expect(await sharp(image).metadata()).toMatchObject({ width: 256, height: 256 });
      expect(await sharp(`public/3d-top-view/sprite-masks/${definition.spriteId}.webp`).metadata())
        .toMatchObject({ width: 256, height: 256 });
      expect(await sharp(`public/${definition.iconPath}`).metadata()).toMatchObject({ width: 128, height: 128 });
      expect(await sharp(`public/3d-top-view/avatar/${definition.spriteId}.webp`).metadata())
        .toMatchObject({ width: 128, height: 128 });
    }
    expect(new Set(images).size).toBe(10);
  });
});
