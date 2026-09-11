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
  package: string;
  animated: boolean;
  spriteOffset: { x: number; y: number; width: number; height: number };
  sourceMetadata: {
    spatial: {
      canvasCells: { width: number; height: number };
      footprintRectCells: { left: number; top: number };
      solidPorts?: {
        kind: "input" | "output";
        cellCenterPixels: { x: number; y: number };
      }[];
    };
  };
}

const collection = JSON.parse(await readFile(path.resolve("resources/building-top-view-v15.json"), "utf8")) as {
  entries: ImportedBuilding[];
};

describe("v1.5 建筑素材发布", () => {
  it.each(collection.entries)("$entityId 的注册表、静态首帧、遮罩和分页尺寸一致", async (entry) => {
    const entity = ENTITY_DEFINITIONS.find((candidate) => candidate.id === entry.entityId);
    expect(entity?.spriteId).toBe(entry.spriteId);
    expect(entity?.spriteOffset?.topView ?? { x: 0, y: 0, ...entity?.footprint }).toEqual(entry.spriteOffset);
    expect(entry.spriteOffset).toEqual({
      x: -entry.sourceMetadata.spatial.footprintRectCells.left,
      y: -entry.sourceMetadata.spatial.footprintRectCells.top,
      width: entry.sourceMetadata.spatial.canvasCells.width,
      height: entry.sourceMetadata.spatial.canvasCells.height,
    });
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

  it("接入最终修复集合，不重复导入实体或保留被撤回的包", () => {
    const ids = collection.entries.map((entry) => entry.entityId);
    expect(new Set(ids).size).toBe(ids.length);
    expect(collection.entries).toHaveLength(40);
    expect(collection.entries.filter((entry) => entry.animated)).toHaveLength(28);
    expect(ids).toEqual(expect.arrayContaining([
      "filling_pd_mc_1",
      "grinder_1",
      "liquid_cleaner_1",
      "liquid_purifier_1",
      "mix_pool_2",
      "thickener_1",
      "tools_asm_mc_1",
      "winder_1",
    ]));
    expect(ids).not.toContain("cmpt_mc_1");
    expect(ids).not.toContain("mix_pool_1");
    const packages = collection.entries.map((entry) => entry.package);
    for (const supersededPackage of [
      "filling_pd_mc_1_top_pixi_canvas_8x6_128px_webp4096.zip",
      "liquid_cleaner_1_top_pixi_canvas_5x5_128px_webp4096.zip",
      "storager_1_top_pixi_canvas_3x4_128px_webp4096.zip",
      "thickener_1_top_pixi_canvas_8x6_128px_webp4096.zip",
      "tools_asm_mc_1_top_pixi_canvas_8x6_128px_webp4096.zip",
      "winder_1_top_pixi_canvas_8x6_128px_webp4096.zip",
    ]) {
      expect(packages).not.toContain(supersededPackage);
    }
  });

  it.each([
    "dismantler_1",
    "furnance_1",
    "liquid_furnance_1",
    "grinder_1",
    "liquid_purifier_1_gas",
    "transmuter_2_gastrans",
    "transmuter_2_solidtrans",
    "xiranite_oven_1",
  ])("$0 的修复包固体端口与 Registry 南入北出方向一致", (entityId) => {
    const entry = collection.entries.find((candidate) => candidate.entityId === entityId);
    const ports = entry?.sourceMetadata.spatial.solidPorts ?? [];
    const frameHeight = (entry?.spriteOffset.height ?? 0) * 128;
    expect(ports.length).toBeGreaterThan(0);
    expect(ports.filter((port) => port.kind === "input")
      .every((port) => port.cellCenterPixels.y === frameHeight - 64)).toBe(true);
    expect(ports.filter((port) => port.kind === "output")
      .every((port) => port.cellCenterPixels.y === 64)).toBe(true);
  });
});
