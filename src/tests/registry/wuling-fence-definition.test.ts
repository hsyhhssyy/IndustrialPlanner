import { describe, expect, it } from "vitest";
import sharp from "sharp";
import { createRegistryContract } from "@/registry";
import { resolveBaseBuiltinEntities } from "@/domain/registry/types/base-definition";
import { getRotatedGridFootprint } from "@/shared/geometry/grid";
import { lookupText } from "@/shared/i18n";

describe("武陵农用地自带围栏", () => {
  const registry = createRegistryContract();
  const entities = resolveBaseBuiltinEntities({ baseDefinitions: registry.baseDefinitions, baseId: "wuling_agricultural_land" });
  const railCells = new Set<string>();
  for (const entity of entities.filter((item) => item.definitionId !== "wuling_fence_post")) {
    const definition = registry.queries.findEntityDefinition(entity.definitionId)!;
    const size = getRotatedGridFootprint(definition.footprint, entity.rotation);
    for (let y = entity.position.y; y < entity.position.y + size.height; y += 1) {
      for (let x = entity.position.x; x < entity.position.x + size.width; x += 1) railCells.add(`${x},${y}`);
    }
  }

  it("保留 44×44 净空、两个 10 格入口和全部 38 个独立件", () => {
    expect(entities).toHaveLength(38);
    expect(new Set(entities.map((entity) => entity.id)).size).toBe(38);
    expect(entities.filter((entity) => entity.definitionId === "wuling_fence_rail_5")).toHaveLength(30);
    expect(railCells.size).toBe(160);
    for (let y = 0; y < 44; y += 1) for (let x = 0; x < 44; x += 1) {
      expect(railCells.has(`${x},${y}`)).toBe(false);
    }
    expect(Array.from({ length: 46 }, (_, index) => index - 1).filter((x) => !railCells.has(`${x},44`)))
      .toEqual(Array.from({ length: 10 }, (_, index) => index + 15));
    expect(Array.from({ length: 46 }, (_, index) => index - 1).filter((y) => !railCells.has(`-1,${y}`)))
      .toEqual(Array.from({ length: 10 }, (_, index) => index + 30));
    const posts = entities.filter((entity) => entity.definitionId === "wuling_fence_post");
    expect(posts).toHaveLength(4);
    for (const post of posts) expect(railCells.has(`${post.position.x},${post.position.y}`)).toBe(true);
  });

  it("四种规格隐藏在面板之外，无端口、配方或耗电，并提供两种本体素材", async () => {
    const definitions = registry.entityDefinitions.filter((definition) => definition.id.startsWith("wuling_fence_"));
    expect(definitions).toHaveLength(4);
    for (const definition of definitions) {
      expect(definition.uiGroup).toBe("hidden");
      expect(definition.portGroups).toEqual([]);
      expect(definition.recipeChannels).toEqual([]);
      expect(definition.powerDemand).toBe(0);
      expect(lookupText("zh-CN", definition.nameKey)).toContain("武陵农用地");
      for (const root of ["3d-top-view", "blueprint-view"]) {
        const color = await sharp(`public/${root}/sprites/${definition.spriteId}.webp`).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
        const mask = await sharp(`public/${root}/sprite-masks/${definition.spriteId}.webp`).ensureAlpha().raw().toBuffer();
        expect([color.info.width, color.info.height]).toEqual([(definition.footprint.width + 2) * 64, 192]);
        for (let index = 0; index < color.info.width * color.info.height; index += 1) {
          if (color.data[index * 4 + 3] !== mask[index * 4]) throw new Error(`围栏遮罩不匹配：${root}/${definition.id}/${index}`);
        }
      }
    }
  });
});
