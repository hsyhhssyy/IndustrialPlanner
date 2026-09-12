// @vitest-environment node

import { access, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";

import sharp from "sharp";
import { describe, expect, it } from "vitest";

import type { DeviceSpriteAnimationDefinition } from "@/domain/registry";
import { DEVICE_SPRITE_ANIMATION_PHASES } from "@/shared/device-sprite-animation";
// @ts-expect-error 既有生成入口为 Node mjs；测试直接复用，不另建运行时声明。
import { publishDeviceSprite, publishDeviceSpriteAnimations } from "../../scripts/sync-device-sprites.mjs";

const definition: DeviceSpriteAnimationDefinition = {
  closeIdleMode: "hold-last",
};

async function withFixture(run: (options: {
  sourceDirectory: string; spriteDirectory: string; maskDirectory: string;
  animationDirectory: string; maskOverrideDirectory: string;
  definitions: { spriteId: string; spriteAnimation: DeviceSpriteAnimationDefinition }[];
}) => Promise<void>): Promise<void> {
  const parent = path.resolve(".temp/.trash");
  await mkdir(parent, { recursive: true });
  const directory = await mkdtemp(path.join(parent, "animation-assets-"));
  const options = { sourceDirectory: path.join(directory, "source"), spriteDirectory: path.join(directory, "sprites"),
    maskDirectory: path.join(directory, "masks"), animationDirectory: path.join(directory, "animations"),
    maskOverrideDirectory: path.join(directory, "overrides"), definitions: [{ spriteId: "fixture", spriteAnimation: definition }] };
  try {
    await mkdir(path.join(options.sourceDirectory, "fixture"), { recursive: true });
    for (let index = 0; index < DEVICE_SPRITE_ANIMATION_PHASES.length; index += 1) {
      const pixels = Buffer.alloc(4 * 2 * 4);
      for (let frame = 0; frame < 2; frame += 1) {
        const localPixel = (index + frame) % 4;
        const offset = (Math.floor(localPixel / 2) * 4 + frame * 2 + localPixel % 2) * 4;
        pixels[offset] = 20 + index;
        pixels[offset + 1] = 40;
        pixels[offset + 2] = 60;
        pixels[offset + 3] = 255;
      }
      await sharp(pixels, { raw: { width: 4, height: 2, channels: 4 } }).webp({ lossless: true })
        .toFile(path.join(options.sourceDirectory, "fixture", `${DEVICE_SPRITE_ANIMATION_PHASES[index]}.webp`));
    }
    await writeFile(path.join(options.sourceDirectory, "fixture/manifest.json"), JSON.stringify({
      schemaVersion: 1,
      frameWidth: 2,
      frameHeight: 2,
      fps: 10,
      pageRows: 1,
      pageColumns: 2,
      sources: Object.fromEntries(DEVICE_SPRITE_ANIMATION_PHASES.map((phase) => [phase, {
        file: `${phase}.webp`, rows: 1, columns: 2, frameCount: 2,
      }])),
      clips: Object.fromEntries(DEVICE_SPRITE_ANIMATION_PHASES.map((phase) => [phase, [{
        source: phase, startFrame: 0, frameCount: 2,
      }]])),
    }), "utf8");
    await run(options);
  } finally {
    // Sharp 的 Promise 完成后仍会缓存文件句柄；NFS 必须先释放句柄，再删除夹具目录。
    const cache = sharp.cache();
    sharp.cache(false);
    try {
      await rm(directory, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
    } finally {
      sharp.cache({ memory: cache.memory.max, files: cache.files.max, items: cache.items.max });
    }
  }
}

async function readPixels(file: string): Promise<number[]> {
  return [...await sharp(file).ensureAlpha().raw().toBuffer()];
}

describe("device animation generation", () => {
  it("发布时保留源帧时长和循环边界拆分时长，不复制长停留帧", async () => {
    await withFixture(async (options) => {
      const sourceFile = path.join(options.sourceDirectory, "fixture/manifest.json");
      const source = JSON.parse(await readFile(sourceFile, "utf8"));
      source.sources.open.frameDurationsMs = [30, 1340];
      source.clips.open = [
        { source: "open", startFrame: 1, frameCount: 1, frameDurationsMs: [670] },
        { source: "open", startFrame: 0, frameCount: 1 },
      ];
      await writeFile(sourceFile, JSON.stringify(source));
      await publishDeviceSpriteAnimations(options);
      const output = JSON.parse(await readFile(path.join(options.animationDirectory, "fixture/manifest.json"), "utf8"));
      expect(output.clips.open.frameCount).toBe(2);
      expect(output.clips.open.frameDurationsMs).toEqual([670, 30]);
      expect(output.clips.open.pages).toHaveLength(1);
    });
  });

  it("publishes the open first frame, separate static mask and four-phase union mask", async () => {
    await withFixture(async (options) => {
      expect(await publishDeviceSpriteAnimations(options)).toEqual([{
        spriteId: "fixture", frameWidth: 2, frameHeight: 2, pageCount: 4,
      }]);
      const first = await sharp(path.join(options.sourceDirectory, "fixture/open.webp"))
        .extract({ left: 0, top: 0, width: 2, height: 2 }).ensureAlpha().raw().toBuffer();
      expect(await readPixels(path.join(options.spriteDirectory, "fixture.webp"))).toEqual([...first]);
      expect(await readPixels(path.join(options.maskDirectory, "fixture.webp")))
        .toEqual([255, 255, 255, 255, 0, 0, 0, 255, 0, 0, 0, 255, 0, 0, 0, 255]);
      expect(await readPixels(path.join(options.animationDirectory, "fixture/mask.webp"))).toEqual(Array(16).fill(255));
      expect((await readdir(path.join(options.animationDirectory, "fixture"))).sort())
        .toEqual([
          "close-0.webp", "close_idle-0.webp", "manifest.json", "mask.webp", "open-0.webp", "open_idle-0.webp",
        ]);
      expect(JSON.parse(await readFile(
        path.join(options.animationDirectory, "fixture/manifest.json"), "utf8",
      ))).toMatchObject({
        frameWidth: 2,
        frameHeight: 2,
        clips: { open: { frameCount: 2, frameDurationMs: 100 } },
      });
    });
  });

  it("flips non-symmetric 2x2 frames by rows while preserving frame order, durations and masks", async () => {
    await withFixture(async (options) => {
      const sourceManifestPath = path.join(options.sourceDirectory, "fixture/manifest.json");
      const sourceManifest = JSON.parse(await readFile(sourceManifestPath, "utf8"));
      sourceManifest.frameTransform = "flip-top-bottom";
      sourceManifest.pageRows = 2;
      sourceManifest.pageColumns = 2;
      sourceManifest.sources.open = { file: "open.webp", rows: 2, columns: 2, frameCount: 4,
        frameDurationsMs: [11, 22, 33, 44] };
      sourceManifest.clips.open = [{ source: "open", startFrame: 0, frameCount: 4 }];
      const pixels = Buffer.alloc(4 * 4 * 4);
      for (let y = 0; y < 4; y += 1) for (let x = 0; x < 4; x += 1) {
        const i = (y * 4 + x) * 4;
        const frame = Math.floor(y / 2) * 2 + Math.floor(x / 2);
        const localX = x % 2, localY = y % 2;
        pixels[i] = 20 + y * 30 + x; pixels[i + 1] = 80 + y; pixels[i + 2] = 140 + x;
        pixels[i + 3] = localX === (frame % 2) && localY === Math.floor(frame / 2) ? 255 : 0;
      }
      await sharp(pixels, { raw: { width: 4, height: 4, channels: 4 } }).webp({ lossless: true })
        .toFile(path.join(options.sourceDirectory, "fixture/open.webp"));
      await writeFile(sourceManifestPath, JSON.stringify(sourceManifest), "utf8");
      await publishDeviceSpriteAnimations(options);

      const output = JSON.parse(await readFile(path.join(options.animationDirectory, "fixture/manifest.json"), "utf8"));
      expect(output.appliedSourceToPublishedTransform).toBe("flip-top-bottom");
      expect(output.clips.open.frameDurationsMs).toEqual([11, 22, 33, 44]);
      expect(output.clips.open.pages[0]).toMatchObject({ rows: 2, columns: 2, frameCount: 4 });

      const published = await sharp(path.join(options.animationDirectory, "fixture/open-0.webp"))
        .ensureAlpha().raw().toBuffer();
      let alphaMismatches = 0;
      for (let frame = 0; frame < 4; frame += 1) for (let y = 0; y < 2; y += 1) for (let x = 0; x < 2; x += 1) {
        const sourceX = (frame % 2) * 2 + x;
        const sourceY = Math.floor(frame / 2) * 2 + (1 - y);
        const targetX = (frame % 2) * 2 + x;
        const targetY = Math.floor(frame / 2) * 2 + y;
        const sourceOffset = (sourceY * 4 + sourceX) * 4;
        const targetOffset = (targetY * 4 + targetX) * 4;
        if (pixels[sourceOffset + 3] !== published[targetOffset + 3]) alphaMismatches += 1;
      }
      expect(alphaMismatches).toBe(0);

      const decodedSource = await sharp(path.join(options.sourceDirectory, "fixture/open.webp"))
        .ensureAlpha().raw().toBuffer();
      const staticPixels = await readPixels(path.join(options.spriteDirectory, "fixture.webp"));
      const staticMask = await readPixels(path.join(options.maskDirectory, "fixture.webp"));
      expect(staticPixels).toEqual([...decodedSource.slice(16, 24), ...decodedSource.slice(0, 8)]);
      expect(staticMask).toEqual([0, 0, 0, 255, 0, 0, 0, 255, 255, 255, 255, 255, 0, 0, 0, 255]);
      expect(await readPixels(path.join(options.animationDirectory, "fixture/mask.webp")))
        .toEqual(Array(16).fill(255));
    });
  });

  it("fails fast for an unknown frame transform", async () => {
    await withFixture(async (options) => {
      const manifestPath = path.join(options.sourceDirectory, "fixture/manifest.json");
      const sourceManifest = JSON.parse(await readFile(manifestPath, "utf8"));
      sourceManifest.frameTransform = "flip-diagonal";
      await writeFile(manifestPath, JSON.stringify(sourceManifest), "utf8");
      await expect(publishDeviceSpriteAnimations(options)).rejects.toThrow("frameTransform must be null or flip-top-bottom");
      await expect(access(options.spriteDirectory)).rejects.toThrow();
    });
  });

  it("static sprite crops a selected row before flip and rotation", async () => {
    await withFixture(async (options) => {
      const source = path.join(options.sourceDirectory, "fixture/open.webp");
      const pixels = Buffer.alloc(4 * 4 * 4);
      const setPixel = (x: number, y: number, rgba: [number, number, number, number]) => {
        pixels.set(rgba, (y * 4 + x) * 4);
      };
      setPixel(3, 0, [17, 34, 51, 255]);
      setPixel(2, 1, [91, 82, 73, 128]);
      await sharp(pixels, { raw: { width: 4, height: 4, channels: 4 } }).webp({ lossless: true }).toFile(source);
      const expected = [
        0, 0, 0, 0, 91, 82, 73, 128,
        17, 34, 51, 255, 0, 0, 0, 0,
      ];
      await publishDeviceSprite(source, path.join(options.spriteDirectory, "fixture.webp"),
        path.join(options.maskDirectory, "fixture.webp"), path.join(options.maskOverrideDirectory, "none.webp"), 90,
        { frameTransform: "flip-top-bottom", crop: { left: 2, top: 0, width: 2, height: 2 } });
      expect(await readPixels(path.join(options.spriteDirectory, "fixture.webp"))).toEqual(expected);
      expect(await readPixels(path.join(options.maskDirectory, "fixture.webp"))).toEqual([
        0, 0, 0, 255, 128, 128, 128, 255,
        255, 255, 255, 255, 0, 0, 0, 255,
      ]);
    });
  });

  it("static sprite rejects an unknown frame transform", async () => {
    await withFixture(async (options) => {
      await expect(publishDeviceSprite(
        path.join(options.sourceDirectory, "fixture/open.webp"),
        path.join(options.spriteDirectory, "fixture.webp"),
        path.join(options.maskDirectory, "fixture.webp"),
        path.join(options.maskOverrideDirectory, "none.webp"), 0,
        { frameTransform: "flip-diagonal" as never },
      )).rejects.toThrow("frameTransform must be null or flip-top-bottom");
      await expect(access(options.spriteDirectory)).rejects.toThrow();
    });
  });

  it("accepts absent sources and no animation declarations without writing outputs", async () => {
    await withFixture(async (options) => {
      expect(await publishDeviceSpriteAnimations({ ...options,
        sourceDirectory: path.join(options.sourceDirectory, "missing"), definitions: [] })).toEqual([]);
      await expect(access(options.spriteDirectory)).rejects.toThrow();
    });
  });

  it("validates every declared source but publishes only selected sprite IDs", async () => {
    await withFixture(async (options) => {
      const untouchedDirectory = path.join(options.sourceDirectory, "untouched");
      await mkdir(untouchedDirectory, { recursive: true });
      const sentinel = Buffer.from("untouched-source-sentinel");
      const sentinelPath = path.join(untouchedDirectory, "sentinel.bin");
      await writeFile(sentinelPath, sentinel);
      options.definitions.push({ spriteId: "untouched", spriteAnimation: definition });

      expect(await publishDeviceSpriteAnimations({ ...options, spriteIds: new Set(["fixture"]) })).toEqual([{
        spriteId: "fixture", frameWidth: 2, frameHeight: 2, pageCount: 4,
      }]);
      expect(await readFile(sentinelPath)).toEqual(sentinel);
      await expect(access(path.join(options.animationDirectory, "untouched"))).rejects.toThrow();
    });
  });

  it("rejects an unknown selected sprite ID", async () => {
    await withFixture(async (options) => {
      await expect(publishDeviceSpriteAnimations({ ...options, spriteIds: new Set(["missing"]) }))
        .rejects.toThrow("Selected animation missing has no Registry declaration");
    });
  });

  it("composes one phase from multiple source sheets and preserves a transparent trailing cell", async () => {
    await withFixture(async (options) => {
      const manifestPath = path.join(options.sourceDirectory, "fixture/manifest.json");
      const sourceManifest = JSON.parse(await readFile(manifestPath, "utf8"));
      sourceManifest.pageRows = 2;
      sourceManifest.pageColumns = 2;
      sourceManifest.clips.open = [
        { source: "open", startFrame: 0, frameCount: 2 },
        { source: "open_idle", startFrame: 0, frameCount: 1 },
      ];
      await writeFile(manifestPath, JSON.stringify(sourceManifest), "utf8");

      await publishDeviceSpriteAnimations(options);

      const publishedManifest = JSON.parse(await readFile(
        path.join(options.animationDirectory, "fixture/manifest.json"),
        "utf8",
      ));
      expect(publishedManifest.clips.open).toMatchObject({
        frameCount: 3,
        pages: [{ rows: 2, columns: 2, frameCount: 3 }],
      });
      const publishedPixels = await sharp(path.join(options.animationDirectory, "fixture/open-0.webp"))
        .ensureAlpha().raw().toBuffer();
      const trailingCellAlpha = [
        publishedPixels[(2 * 4 + 2) * 4 + 3],
        publishedPixels[(2 * 4 + 3) * 4 + 3],
        publishedPixels[(3 * 4 + 2) * 4 + 3],
        publishedPixels[(3 * 4 + 3) * 4 + 3],
      ];
      expect(trailingCellAlpha).toEqual([0, 0, 0, 0]);
    });
  });

  it("rejects non-transparent cells after the declared source frame count", async () => {
    await withFixture(async (options) => {
      const manifestPath = path.join(options.sourceDirectory, "fixture/manifest.json");
      const sourceManifest = JSON.parse(await readFile(manifestPath, "utf8"));
      sourceManifest.sources.open.frameCount = 1;
      sourceManifest.clips.open = [{ source: "open", startFrame: 0, frameCount: 1 }];
      await writeFile(manifestPath, JSON.stringify(sourceManifest), "utf8");

      await expect(publishDeviceSpriteAnimations(options)).rejects.toThrow("trailing cell 1");
      await expect(access(options.spriteDirectory)).rejects.toThrow();
    });
  });

  it("fails before publishing when atlas grids mismatch or exceed the configured limit", async () => {
    await withFixture(async (options) => {
      await expect(publishDeviceSpriteAnimations({ ...options, maxTextureSize: 4 })).rejects.toThrow("smaller");
      await sharp({ create: { width: 2, height: 2, channels: 4, background: "white" } }).webp()
        .toFile(path.join(options.sourceDirectory, "fixture/close.webp"));
      await expect(publishDeviceSpriteAnimations(options)).rejects.toThrow("dimensions differ");
      await expect(access(options.spriteDirectory)).rejects.toThrow();
    });
  });

  it("does not silently overwrite an existing custom mask", async () => {
    await withFixture(async (options) => {
      await mkdir(options.maskOverrideDirectory, { recursive: true });
      await sharp({ create: { width: 2, height: 2, channels: 4, background: "white" } }).webp()
        .toFile(path.join(options.maskOverrideDirectory, "fixture.webp"));
      await expect(publishDeviceSpriteAnimations(options)).rejects.toThrow("existing mask override");
      await expect(access(options.spriteDirectory)).rejects.toThrow();
    });
  });
});
