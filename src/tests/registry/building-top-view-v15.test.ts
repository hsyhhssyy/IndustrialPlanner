// @vitest-environment node

import { readFile } from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";
import { describe, expect, it } from "vitest";

import { ENTITY_DEFINITIONS } from "@/registry/entity-definition";
import { normalizeDeviceSpriteAnimationDefinition } from "@/shared/device-sprite-animation";

interface ImportedBuilding {
  entityId: string;
  spriteId: string;
  animated: boolean;
  spriteOffset: { x: number; y: number; width: number; height: number };
}

const collection = JSON.parse(await readFile(path.resolve("resources/building-top-view-v15.json"), "utf8")) as {
  entries: ImportedBuilding[];
};

describe("v1.5 建筑素材发布", () => {
  it.each(collection.entries)("$entityId 的注册表、静态首帧、遮罩和分页尺寸一致", async (entry) => {
    const entity = ENTITY_DEFINITIONS.find((candidate) => candidate.id === entry.entityId);
    expect(entity?.spriteId).toBe(entry.spriteId);
    expect(entity?.spriteOffset?.topView ?? { x: 0, y: 0, ...entity?.footprint }).toEqual(entry.spriteOffset);
    const width = entry.spriteOffset.width * 128;
    const height = entry.spriteOffset.height * 128;
    for (const directory of ["sprites", "sprite-masks"]) {
      const image = await sharp(path.resolve(`public/3d-top-view/${directory}/${entry.spriteId}.webp`)).metadata();
      expect([image.width, image.height]).toEqual([width, height]);
    }
    if (!entry.animated) {
      expect(entity?.spriteAnimation).toBeUndefined();
      const source = await readFile(path.resolve(`resources/device-sprite-original/v15/${entry.spriteId}.webp`));
      expect(source.length).toBeGreaterThan(0);
      return;
    }
    const directory = path.resolve(`public/3d-top-view/animations/${entry.spriteId}`);
    const manifest = JSON.parse(await readFile(path.join(directory, "manifest.json"), "utf8"));
    const animation = normalizeDeviceSpriteAnimationDefinition(entity?.spriteAnimation, manifest);
    expect([animation.frameWidth, animation.frameHeight]).toEqual([width, height]);
    for (const clip of Object.values(animation.clips)) {
      expect(clip.frameEndTimesMs).toHaveLength(clip.frameCount);
      expect(clip.frameEndTimesMs.at(-1)).toBe(clip.durationMs);
      for (const page of clip.pages) {
        const image = await sharp(path.join(directory, page.file)).metadata();
        expect([image.width, image.height]).toEqual([page.columns * width, page.rows * height]);
        expect(image.hasAlpha).toBe(true);
        expect(Math.max(image.width ?? 0, image.height ?? 0)).toBeLessThan(4096);
      }
    }
    const mask = await sharp(path.join(directory, animation.maskFile)).metadata();
    expect([mask.width, mask.height]).toEqual([width, height]);
  });

  it("不重复导入既有动画，且同一实体只选择一个素材包", () => {
    const ids = collection.entries.map((entry) => entry.entityId);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids).not.toContain("cmpt_mc_1");
    expect(ids).not.toContain("mix_pool_1");
    expect(ids).not.toContain("liquid_purifier_1");
    expect(ids).not.toContain("mix_pool_2");
  });
});
