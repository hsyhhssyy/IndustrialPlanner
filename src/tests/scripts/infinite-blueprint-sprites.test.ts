import path from "node:path";

import sharp from "sharp";
import { describe, expect, it } from "vitest";

// @ts-expect-error 此脚本是直接由 Node 执行的 mjs，没有单独维护声明文件。
import { DIRECT_BLUEPRINT_SPRITE_IDS, INFINITE_BLUEPRINT_SPRITE_MAPPINGS } from "../../scripts/blueprint-direct-sprite-mappings.mjs";

const PROJECT_ROOT = process.cwd();
const SPRITE_SIZE = 128;
const ICON_SIZE = 72;
const ICON_OFFSET = (SPRITE_SIZE - ICON_SIZE) / 2;
const BLUEPRINT_AVATAR_GRAY = 124;

describe("infinite blueprint sprites", () => {
  it("registers all infinite devices as repository-backed direct sprites", () => {
    expect(INFINITE_BLUEPRINT_SPRITE_MAPPINGS).toEqual([
      {
        deviceId: "cheat_infinite_solid",
        spriteId: "cheat_infinite_solid",
        iconAssetPath: "public/assets/machine-mode-icons/icon_port_solidtrans_infinite.png",
        repositoryAssetPath: "resources/blueprint-direct-sprites/cheat_infinite_solid.png",
        trimPx: 0,
      },
      {
        deviceId: "cheat_infinite_liquid",
        spriteId: "cheat_infinite_liquid",
        iconAssetPath: "public/assets/machine-mode-icons/icon_port_liquidtrans_infinite.png",
        repositoryAssetPath: "resources/blueprint-direct-sprites/cheat_infinite_liquid.png",
        trimPx: 0,
      },
      {
        deviceId: "cheat_infinite_gas",
        spriteId: "cheat_infinite_gas",
        iconAssetPath: "public/assets/machine-mode-icons/icon_port_gastrans_infinite.png",
        repositoryAssetPath: "resources/blueprint-direct-sprites/cheat_infinite_gas.png",
        trimPx: 0,
      },
    ]);

    for (const mapping of INFINITE_BLUEPRINT_SPRITE_MAPPINGS) {
      expect(DIRECT_BLUEPRINT_SPRITE_IDS.has(mapping.spriteId)).toBe(true);
    }
  });

  for (const mapping of INFINITE_BLUEPRINT_SPRITE_MAPPINGS) {
    it(`publishes a port-free centered-icon sprite for ${mapping.deviceId}`, async () => {
      const icon = await readRgba(mapping.iconAssetPath);
      const resource = await readRgba(mapping.repositoryAssetPath);
      const published = await readRgba(`public/blueprint-view/sprites/${mapping.spriteId}.png`);
      const maskMetadata = await sharp(
        path.resolve(PROJECT_ROOT, `public/blueprint-view/sprite-masks/${mapping.spriteId}.png`),
      ).metadata();

      expect({ width: icon.width, height: icon.height }).toEqual({
        width: ICON_SIZE,
        height: ICON_SIZE,
      });
      expect({ width: resource.width, height: resource.height }).toEqual({
        width: SPRITE_SIZE,
        height: SPRITE_SIZE,
      });
      expect({ width: published.width, height: published.height }).toEqual({
        width: SPRITE_SIZE,
        height: SPRITE_SIZE,
      });
      expect({ width: maskMetadata.width, height: maskMetadata.height }).toEqual({
        width: SPRITE_SIZE,
        height: SPRITE_SIZE,
      });

      const centeredIcon = extractRgba(resource, ICON_OFFSET, ICON_OFFSET, ICON_SIZE, ICON_SIZE);
      expect(extractAlpha(centeredIcon)).toEqual(extractAlpha(icon.data));
      expect(countNonTransparentPixelsOutsideColor(centeredIcon, BLUEPRINT_AVATAR_GRAY)).toBe(0);
      expect(published.data).toEqual(resource.data);
      expect(countPixelsOutsideBorderAndIcon(resource)).toBe(0);
    });
  }
});

async function readRgba(relativePath: string) {
  const { data, info } = await sharp(path.resolve(PROJECT_ROOT, relativePath))
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });

  return {
    data,
    width: info.width,
    height: info.height,
    channels: info.channels,
  };
}

function extractRgba(
  image: Awaited<ReturnType<typeof readRgba>>,
  left: number,
  top: number,
  width: number,
  height: number,
) {
  const extracted = Buffer.alloc(width * height * image.channels);

  for (let row = 0; row < height; row += 1) {
    const sourceStart = ((top + row) * image.width + left) * image.channels;
    const sourceEnd = sourceStart + width * image.channels;
    image.data.copy(extracted, row * width * image.channels, sourceStart, sourceEnd);
  }

  return extracted;
}

function countPixelsOutsideBorderAndIcon(image: Awaited<ReturnType<typeof readRgba>>) {
  let unexpectedPixelCount = 0;

  for (let y = 0; y < image.height; y += 1) {
    for (let x = 0; x < image.width; x += 1) {
      const alpha = image.data[(y * image.width + x) * image.channels + 3] ?? 0;
      if (alpha === 0) {
        continue;
      }

      const isInsideIcon = x >= ICON_OFFSET
        && x < ICON_OFFSET + ICON_SIZE
        && y >= ICON_OFFSET
        && y < ICON_OFFSET + ICON_SIZE;
      const isInsideHorizontalBorder = x >= 18
        && x < 110
        && ((y >= 18 && y < 22) || (y >= 106 && y < 110));
      const isInsideVerticalBorder = y >= 18
        && y < 110
        && ((x >= 18 && x < 22) || (x >= 106 && x < 110));

      if (!isInsideIcon && !isInsideHorizontalBorder && !isInsideVerticalBorder) {
        unexpectedPixelCount += 1;
      }
    }
  }

  return unexpectedPixelCount;
}

function extractAlpha(rgba: Buffer) {
  const alpha = Buffer.alloc(rgba.length / 4);

  for (let sourceOffset = 3, targetOffset = 0; sourceOffset < rgba.length; sourceOffset += 4) {
    alpha[targetOffset] = rgba[sourceOffset] ?? 0;
    targetOffset += 1;
  }

  return alpha;
}

function countNonTransparentPixelsOutsideColor(rgba: Buffer, expectedChannel: number) {
  let unexpectedPixelCount = 0;

  for (let offset = 0; offset < rgba.length; offset += 4) {
    const alpha = rgba[offset + 3] ?? 0;
    if (alpha === 0) {
      continue;
    }

    if (
      rgba[offset] !== expectedChannel
      || rgba[offset + 1] !== expectedChannel
      || rgba[offset + 2] !== expectedChannel
    ) {
      unexpectedPixelCount += 1;
    }
  }

  return unexpectedPixelCount;
}
