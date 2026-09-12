// @vitest-environment node

import { readFile } from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";
import { describe, expect, it } from "vitest";

import { ENTITY_DEFINITIONS } from "@/registry/entity-definition";
import { normalizeDeviceSpriteAnimationDefinition } from "@/shared/device-sprite-animation";
// AI-REMOVED 2026-09-11:
// Reason: 此辅助函数只有测试调用，未参与真实发布；时长断言仅与自身比较，不能验证需求。
// Trigger: 统一验证实际 publisher 的逐帧反射、排序、时长与遮罩行为。
// Evidence: 全仓引用仅在此测试；真实发布使用 copyFrameToPage/mergeFrameAlpha/extractFrame。
// Replacement: src/tests/scripts/device-sprite-animation.test.ts 中实际文件发布回归测试。
// Risk: Low；正式发布入口的覆盖已由实际产物断言补齐。
// Human Review: Required
//
// Original code:
// import { transformRgbaFrameRows } from "@/scripts/device-sprite-animation-publisher.mjs";

interface ImportedBuilding {
  entityId: string;
  spriteId: string;
  sourcePath: string;
  package: string;
  animated: boolean;
  spriteOffset: { x: number; y: number; width: number; height: number };
  sourceMetadata: {
    sourceArchiveSha256: string;
    spatial: {
      canvasCells: { width: number; height: number };
      footprintRectCells: { left: number; top: number; width: number; height: number };
      solidPorts?: {
        kind: "input" | "output";
        cellCenterPixels: { x: number; y: number };
      }[];
      verticalTransform: { operation: string };
    };
    publishedTransform: { operation: string };
  };
}

const collection = JSON.parse(await readFile(path.resolve("resources/building-top-view-v15.json"), "utf8")) as {
  sourceArchiveSha256: string;
  sourceCoordinateTransform: unknown;
  entries: ImportedBuilding[];
};

describe("v1.5 建筑素材发布", () => {
  it("使用当前设备 ID 关联颜色资源与高度特效视图", async () => {
    const manifest = JSON.parse(await readFile(path.resolve("public/3d-top-view/port-effects/manifest.json"), "utf8"));
    expect(Object.keys(manifest.definitions).sort()).toEqual(collection.entries.map((entry) => entry.entityId).sort());
    for (const entry of collection.entries) {
      expect(manifest.definitions[entry.entityId]).toBe(entry.sourcePath);
      expect(manifest.views[entry.sourcePath]).toBeDefined();
    }
  });

  it.each([
    ["filling_pd_mc_1_liquid", "liquid__0"],
    ["shaper_1_gas", "gas__0"],
  ])("$0 发布 Registry 变体对应的管道端口特效", async (entityId, variantKey) => {
    const manifest = JSON.parse(await readFile(path.resolve("public/3d-top-view/port-effects/manifest.json"), "utf8"));
    const viewKey = manifest.definitions[entityId];
    const ports = manifest.views[viewKey]?.variants[variantKey];

    expect(ports).toHaveLength(1);
    expect(ports[0]?.bindings).toMatchObject({
      off: "v1.5/fx/P_interactive_large_pipeoff_in_01",
    });
    expect(ports[0]?.bindings.on).toMatch(/^v1\.5\/fx\/P_interactive_(?:bend)?large_pipeon_in_01$/);
  });

  it("启用液体灌装机现有动画资源", () => {
    expect(ENTITY_DEFINITIONS.find((definition) => definition.id === "filling_pd_mc_1_liquid")?.spriteAnimation)
      .toEqual({ closeIdleMode: "hold-last" });
  });
// AI-REMOVED 2026-09-11:
// Reason: 此辅助函数只有测试调用，未参与真实发布；时长断言仅与自身比较，不能验证需求。
// Trigger: 统一验证实际 publisher 的逐帧反射、排序、时长与遮罩行为。
// Evidence: 全仓引用仅在此测试；真实发布使用 copyFrameToPage/mergeFrameAlpha/extractFrame。
// Replacement: src/tests/scripts/device-sprite-animation.test.ts 中实际文件发布回归测试。
// Risk: Low；正式发布入口的覆盖已由实际产物断言补齐。
// Human Review: Required
//
// Original code:
//   it("逐帧上下变换保持帧序、时长，并与 alpha union 同步", () => {
//     const width = 1; const height = 2;
//     const frameA = Buffer.from([255, 0, 0, 255, 0, 0, 0, 0]);
//     const frameB = Buffer.from([0, 255, 0, 255, 0, 0, 0, 0]);
//     const published = [frameA, frameB].map((frame) => transformRgbaFrameRows(frame, width, height, "flip-top-bottom"));
//     expect(published[0][3]).toBe(0);
//     expect(published[0][7]).toBe(255);
//     expect(published[1][1]).toBe(0);
//     expect(published[1][5]).toBe(255);
//     expect([33, 67]).toEqual([33, 67]);
//     const union = Buffer.from(published[0].map((value, index) => index % 4 === 3 ? Math.max(value, published[1][index]) : 0));
//     expect(union[3]).toBe(0);
//     expect(union[7]).toBe(255);
//   });

  it.each(collection.entries)("$entityId 的注册表、静态首帧、遮罩和分页尺寸一致", async (entry) => {
    const entity = ENTITY_DEFINITIONS.find((candidate) => candidate.id === entry.entityId);
    expect(entity?.spriteId).toBe(entry.spriteId);
    expect(entity?.spriteOffset?.topView ?? { x: 0, y: 0, ...entity?.footprint }).toEqual(entry.spriteOffset);
    expect(entry.spriteOffset).toEqual({
      x: entry.sourceMetadata.spatial.footprintRectCells.left === 0
        ? 0
        : -entry.sourceMetadata.spatial.footprintRectCells.left,
      y: entry.sourceMetadata.spatial.footprintRectCells.top
        + entry.sourceMetadata.spatial.footprintRectCells.height
        - entry.sourceMetadata.spatial.canvasCells.height,
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
    expect(manifest.sourceArchiveSha256).toBe(entry.sourceMetadata.sourceArchiveSha256);
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
    expect(collection.entries).toHaveLength(51);
    expect(collection.entries.filter((entry) => entry.animated)).toHaveLength(31);
    expect(ids).toEqual(expect.arrayContaining([
      "filling_pd_mc_1",
      "grinder_1",
      "liquid_cleaner_1",
      "liquid_purifier_1",
      "mix_pool_2",
      "thickener_1",
      "tools_asm_mc_1",
      "winder_1",
      "cmpt_mc_1",
      "mix_pool_1",
      "filling_pd_mc_1_liquid",
      "log_admission",
      "log_connector",
      "log_converger",
      "log_splitter",
      "pipe_admission",
      "pipe_connector",
      "pipe_converger",
      "pipe_splitter",
    ]));
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

  it("记录 ZIP 来源 hash，并锁定 source→project 的逐帧坐标变换", () => {
    expect(collection.sourceArchiveSha256).toMatch(/^[a-f0-9]{64}$/);
    expect(collection.sourceCoordinateTransform).toEqual({
      imageAxes: { x: "+sourceX", y: "+sourceZ" },
      operation: "projectY = depth - 1 - sourceZ",
      rasterOperation: "flip-top-bottom per frame cell",
    });
    for (const entry of collection.entries) {
      expect(entry.sourceMetadata.sourceArchiveSha256).toMatch(/^[a-f0-9]{64}$/);
      expect(entry.sourceMetadata.publishedTransform.operation)
        .toBe("flip-top-bottom per frame");
    }
  });

  it.each([
    "dismantler_1",
    "furnance_1",
    "furnance_1_liquid",
    "grinder_1",
    "liquid_purifier_1_gas",
    "transmuter_2_gastrans",
    "transmuter_2_solidtrans",
    "xiranite_oven_1",
  ])("$0 的 RAW 端口经发布坐标变换后与 Registry 物理坐标和角色一致", (entityId) => {
    const entry = collection.entries.find((candidate) => candidate.entityId === entityId);
    const entity = ENTITY_DEFINITIONS.find((candidate) => candidate.id === entityId);
    const ports = entry?.sourceMetadata.spatial.solidPorts ?? [];
    expect(ports.length).toBeGreaterThan(0);
    const expected = ports.map((port) => {
      const x = entry?.spriteOffset.x ?? 0;
      const y = entry?.spriteOffset.y ?? 0;
      return `${port.kind}:${x + port.cellCenterPixels.x / 128 - 0.5},${y + (entry?.spriteOffset.height ?? 0) - port.cellCenterPixels.y / 128 - 0.5}`;
    }).sort();
    const actual = (entity?.portGroups ?? []).filter((group) => !group.isPipe).flatMap((group) => group.ports.map((port) => (
      `${group.direction === "input" ? "input" : "output"}:${port.localCellX},${port.localCellY}`
    ))).sort();
    expect(actual).toEqual(expect.arrayContaining(expected));
  });
});
