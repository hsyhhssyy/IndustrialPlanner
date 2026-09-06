// @vitest-environment node

import { access, mkdir, mkdtemp, readdir, rm } from "node:fs/promises";
import path from "node:path";

import sharp from "sharp";
import { describe, expect, it } from "vitest";

import type { DeviceSpriteAnimationDefinition } from "@/domain/registry";
import { DEVICE_SPRITE_ANIMATION_PHASES } from "@/shared/device-sprite-animation";
// @ts-expect-error 既有生成入口为 Node mjs；测试直接复用，不另建运行时声明。
import { publishDeviceSpriteAnimations } from "../../scripts/sync-device-sprites.mjs";

const definition: DeviceSpriteAnimationDefinition = {
  clips: {
    open: { rows: 1, columns: 2 }, open_idle: { rows: 1, columns: 2 },
    close: { rows: 1, columns: 2 }, close_idle: { rows: 1, columns: 2 },
  },
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
  it("publishes the open first frame, separate static mask and four-phase union mask", async () => {
    await withFixture(async (options) => {
      expect(await publishDeviceSpriteAnimations(options)).toEqual([{ spriteId: "fixture", frameWidth: 2, frameHeight: 2 }]);
      const first = await sharp(path.join(options.sourceDirectory, "fixture/open.webp"))
        .extract({ left: 0, top: 0, width: 2, height: 2 }).ensureAlpha().raw().toBuffer();
      expect(await readPixels(path.join(options.spriteDirectory, "fixture.webp"))).toEqual([...first]);
      expect(await readPixels(path.join(options.maskDirectory, "fixture.webp")))
        .toEqual([255, 255, 255, 255, 0, 0, 0, 255, 0, 0, 0, 255, 0, 0, 0, 255]);
      expect(await readPixels(path.join(options.animationDirectory, "fixture/mask.webp"))).toEqual(Array(16).fill(255));
      expect((await readdir(path.join(options.animationDirectory, "fixture"))).sort())
        .toEqual(["close.webp", "close_idle.webp", "mask.webp", "open.webp", "open_idle.webp"]);
    });
  });

  it("accepts absent sources and no animation declarations without writing outputs", async () => {
    await withFixture(async (options) => {
      expect(await publishDeviceSpriteAnimations({ ...options,
        sourceDirectory: path.join(options.sourceDirectory, "missing"), definitions: [] })).toEqual([]);
      await expect(access(options.spriteDirectory)).rejects.toThrow();
    });
  });

  it("fails before publishing when atlas grids mismatch or exceed the configured limit", async () => {
    await withFixture(async (options) => {
      await expect(publishDeviceSpriteAnimations({ ...options, maxTextureSize: 2 })).rejects.toThrow("GPU texture limit");
      const invalid = { ...definition, clips: { ...definition.clips, close: { rows: 1, columns: 1 } } };
      await expect(publishDeviceSpriteAnimations({ ...options,
        definitions: [{ spriteId: "fixture", spriteAnimation: invalid }] })).rejects.toThrow("differ");
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
