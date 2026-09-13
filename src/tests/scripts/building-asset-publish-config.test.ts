// @vitest-environment node

import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";

import sharp from "sharp";
import { describe, expect, it } from "vitest";

import { DEVICE_SPRITE_ANIMATION_PHASES } from "@/shared/device-sprite-animation";
// @ts-expect-error 发布配置为 Node mjs；测试直接复用，不另建运行时声明。
import { BUILDING_ASSET_PUBLISH_RESOLUTIONS, resolveBuildingAssetPublishTargets } from "../../scripts/building-asset-publish-config.mjs";
// @ts-expect-error 既有生成入口为 Node mjs；测试直接复用，不另建运行时声明。
import { publishDeviceSpriteAnimations } from "../../scripts/sync-device-sprites.mjs";

describe("建筑素材发布规格", () => {
  it("默认配置提供全部目标，单独切换四分之一尺寸时保留当前运行时目录", () => {
    const root = path.resolve("public/3d-top-view");
    const defaults = resolveBuildingAssetPublishTargets(root);
    expect(defaults.map((target: { resolution: number }) => target.resolution))
      .toEqual(BUILDING_ASSET_PUBLISH_RESOLUTIONS);
    expect(defaults[0].outputDirectory).toBe(root);
    expect(resolveBuildingAssetPublishTargets(root, [0.25]))
      .toEqual([{ resolution: 0.25, outputDirectory: root }]);
  });

  it("多规格目标使用独立目录，避免同名发布文件互相覆盖", () => {
    const root = path.resolve("public/3d-top-view");
    expect(resolveBuildingAssetPublishTargets(root, [0.5, 0.25])).toEqual([
      { resolution: 0.5, outputDirectory: root },
      { resolution: 0.25, outputDirectory: path.join(root, "variants/resolution-0.25") },
    ]);
  });

  it("拒绝空配置、无效比例和重复规格", () => {
    for (const resolutions of [[], [0], [-0.5], [1.5], [NaN], [Infinity], ["0.5"], [0.5, 0.5]]) {
      expect(() => resolveBuildingAssetPublishTargets("public/3d-top-view", resolutions)).toThrow();
    }
    expect(() => resolveBuildingAssetPublishTargets("", [0.5])).toThrow();
  });

  it("同一份原件可生成半尺寸和四分之一尺寸动画，保留各自清单、时序与源字节", async () => {
    const parent = path.resolve(".temp/.trash");
    await mkdir(parent, { recursive: true });
    const directory = await mkdtemp(path.join(parent, "building-asset-resolutions-"));
    try {
      const sourceDirectory = path.join(directory, "source");
      const sourceRoot = path.join(sourceDirectory, "fixture");
      await mkdir(sourceRoot, { recursive: true });
      const imagePath = path.join(sourceRoot, "frames.webp");
      const pixels = Buffer.alloc(8 * 4 * 4);
      for (let frame = 0; frame < 2; frame += 1) {
        for (let y = 1; y < 3; y += 1) for (let x = 1; x < 3; x += 1) {
          const offset = (y * 8 + frame * 4 + x) * 4;
          pixels.set([64 + frame * 64, 128, 192, 255], offset);
        }
      }
      await sharp(pixels, { raw: { width: 8, height: 4, channels: 4 } })
        .webp({ lossless: true }).toFile(imagePath);
      const manifestPath = path.join(sourceRoot, "manifest.json");
      await writeFile(manifestPath, JSON.stringify({
        schemaVersion: 1, frameWidth: 4, frameHeight: 4, fps: 10, pageRows: 1, pageColumns: 2,
        sources: { frames: { file: "frames.webp", rows: 1, columns: 2, frameCount: 2,
          frameDurationsMs: [30, 170] } },
        clips: Object.fromEntries(DEVICE_SPRITE_ANIMATION_PHASES.map((phase) => [phase, [
          { source: "frames", startFrame: 0, frameCount: 2 },
        ]])),
      }));
      const originals = await Promise.all([imagePath, manifestPath].map((file) => readFile(file)));
      const targets = resolveBuildingAssetPublishTargets(path.join(directory, "public"), [0.5, 0.25]);
      for (const { resolution, outputDirectory } of targets) {
        await publishDeviceSpriteAnimations({
          sourceDirectory,
          spriteDirectory: path.join(outputDirectory, "sprites"),
          maskDirectory: path.join(outputDirectory, "sprite-masks"),
          animationDirectory: path.join(outputDirectory, "animations"),
          maskOverrideDirectory: path.join(directory, "overrides"),
          resolution,
          definitions: [{ spriteId: "fixture", spriteAnimation: { closeIdleMode: "hold-last" } }],
        });
      }
      for (const { resolution, outputDirectory } of targets) {
        const outputRoot = path.join(outputDirectory, "animations/fixture");
        const manifest = JSON.parse(await readFile(path.join(outputRoot, "manifest.json"), "utf8"));
        expect(manifest).toMatchObject({ resolution, frameWidth: 4, frameHeight: 4 });
        for (const phase of DEVICE_SPRITE_ANIMATION_PHASES) {
          expect(manifest.clips[phase]).toMatchObject({ frameCount: 2, frameDurationsMs: [30, 170] });
          expect(await sharp(path.join(outputRoot, `${phase}-0.webp`)).metadata())
            .toMatchObject({ width: 8 * resolution, height: 4 * resolution });
        }
        expect(await sharp(path.join(outputRoot, "mask.webp")).metadata())
          .toMatchObject({ width: 4 * resolution, height: 4 * resolution });
      }
      expect(await Promise.all([imagePath, manifestPath].map((file) => readFile(file)))).toEqual(originals);
    } finally {
      // 释放 Sharp 缓存的文件句柄，确保 NFS 上的临时夹具也能清理。
      const cache = sharp.cache();
      sharp.cache(false);
      try {
        await rm(directory, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
      } finally {
        sharp.cache({ memory: cache.memory.max, files: cache.files.max, items: cache.items.max });
      }
    }
  });
});
