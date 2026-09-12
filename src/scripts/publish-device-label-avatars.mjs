#!/usr/bin/env node

/**
 * 以蓝图 avatar 的透明度轮廓为准，发布白色右下投影的设备标签头像。
 *
 * 输入目录保持灰色蓝图语义，输出统一写入现有 3D View avatar 目录。
 * 右下投影使用画布短边的 4%，同时保持原画布尺寸和前景像素位置不变。
 * AI-CORRECTION 2026-09-12: 对照游戏内覆盖层后，输出改为白色主体、全向深色轮廓与右下硬阴影三层；阴影偏移同步提高以避免缩放后与轮廓粘连。
 *
 * 用法：
 *   node src/scripts/publish-device-label-avatars.mjs
 */

import { mkdir, readdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

export const OUTLINE_CHANNEL = 37;
export const OUTLINE_OPACITY = 0.96;
export const OUTLINE_RADIUS_RATIO = 0.025;
export const SHADOW_CHANNEL = 76;
export const SHADOW_OPACITY = 0.72;
export const SHADOW_OFFSET_RATIO = 0.07;

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(scriptDirectory, '..', '..');
const sourceDirectory = path.join(projectRoot, 'public', 'blueprint-view', 'avatar');
const outputDirectory = path.join(projectRoot, 'public', '3d-top-view', 'avatar');

export function resolveShadowOffset(width, height) {
  return Math.max(1, Math.round(Math.min(width, height) * SHADOW_OFFSET_RATIO));
}

export function resolveOutlineRadius(width, height) {
  return Math.max(1, Math.round(Math.min(width, height) * OUTLINE_RADIUS_RATIO));
}

export function createWhiteShadowPixels(source, width, height) {
  const output = Buffer.alloc(width * height * 4);
  const outlineAlpha = Buffer.alloc(width * height);
  const shadowOffset = resolveShadowOffset(width, height);
  const outlineRadius = resolveOutlineRadius(width, height);

  const compositeSolidPixel = (pixelOffset, channel, alpha) => {
    if (alpha === 0) {
      return;
    }

    const sourceAlpha = alpha / 255;
    const destinationAlpha = output[pixelOffset + 3] / 255;
    const resultAlpha = sourceAlpha + destinationAlpha * (1 - sourceAlpha);

    for (let channelOffset = 0; channelOffset < 3; channelOffset += 1) {
      const destinationChannel = output[pixelOffset + channelOffset];
      output[pixelOffset + channelOffset] = Math.round(
        (channel * sourceAlpha
          + destinationChannel * destinationAlpha * (1 - sourceAlpha))
          / resultAlpha,
      );
    }
    output[pixelOffset + 3] = Math.round(resultAlpha * 255);
  };

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const sourceOffset = (y * width + x) * 4;
      const sourceAlpha = source[sourceOffset + 3] ?? 0;
      const shadowX = x + shadowOffset;
      const shadowY = y + shadowOffset;

      if (sourceAlpha === 0 || shadowX >= width || shadowY >= height) {
        continue;
      }

      const shadowPixelOffset = (shadowY * width + shadowX) * 4;
      compositeSolidPixel(
        shadowPixelOffset,
        SHADOW_CHANNEL,
        Math.round(sourceAlpha * SHADOW_OPACITY),
      );
    }
  }

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const sourceOffset = (y * width + x) * 4;
      const sourceAlpha = source[sourceOffset + 3] ?? 0;

      if (sourceAlpha === 0) {
        continue;
      }

      const outlineValue = Math.round(sourceAlpha * OUTLINE_OPACITY);

      for (let offsetY = -outlineRadius; offsetY <= outlineRadius; offsetY += 1) {
        for (let offsetX = -outlineRadius; offsetX <= outlineRadius; offsetX += 1) {
          if (offsetX * offsetX + offsetY * offsetY > outlineRadius * outlineRadius) {
            continue;
          }

          const outlineX = x + offsetX;
          const outlineY = y + offsetY;

          if (outlineX < 0 || outlineX >= width || outlineY < 0 || outlineY >= height) {
            continue;
          }

          const outlineOffset = outlineY * width + outlineX;
          outlineAlpha[outlineOffset] = Math.max(outlineAlpha[outlineOffset], outlineValue);
        }
      }
    }
  }

  for (let pixelIndex = 0; pixelIndex < width * height; pixelIndex += 1) {
    compositeSolidPixel(
      pixelIndex * 4,
      OUTLINE_CHANNEL,
      outlineAlpha[pixelIndex],
    );
  }

  for (let pixelIndex = 0; pixelIndex < width * height; pixelIndex += 1) {
    const pixelOffset = pixelIndex * 4;
    const sourceAlpha = source[pixelOffset + 3] ?? 0;

    if (sourceAlpha === 0) {
      continue;
    }

    compositeSolidPixel(pixelOffset, 255, sourceAlpha);
  }

  return output;
}

async function publishAvatar(fileName) {
  const sourcePath = path.join(sourceDirectory, fileName);
  const outputPath = path.join(outputDirectory, fileName);
  const { data, info } = await sharp(sourcePath)
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  const output = createWhiteShadowPixels(data, info.width, info.height);

  await sharp(output, {
    raw: { width: info.width, height: info.height, channels: 4 },
  })
    .webp({ lossless: true, effort: 6 })
    .toFile(outputPath);

  return {
    width: info.width,
    height: info.height,
    outlineRadius: resolveOutlineRadius(info.width, info.height),
    shadowOffset: resolveShadowOffset(info.width, info.height),
  };
}

async function main() {
  await mkdir(outputDirectory, { recursive: true });
  const sourceFiles = (await readdir(sourceDirectory))
    .filter(fileName => fileName.endsWith('.webp'))
    .sort();
  const outputFiles = (await readdir(outputDirectory))
    .filter(fileName => fileName.endsWith('.webp'))
    .sort();
  const unexpectedOutputFiles = outputFiles.filter(fileName => !sourceFiles.includes(fileName));

  if (unexpectedOutputFiles.length > 0) {
    throw new Error(`3D View avatar 目录存在无对应蓝图来源的文件：${unexpectedOutputFiles.join(', ')}`);
  }

  for (const fileName of sourceFiles) {
    const { width, height, outlineRadius, shadowOffset } = await publishAvatar(fileName);
    console.log(`  ${fileName}: ${width}x${height}, outline ${outlineRadius}px, shadow +${shadowOffset}/+${shadowOffset}`);
  }

  console.log(`\nPublished ${sourceFiles.length} white-shadow device avatar(s) to ${outputDirectory}`);
}

const isEntrypoint = process.argv[1]
  && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (isEntrypoint) {
  main().catch((error) => {
    console.error('Failed:', error);
    process.exitCode = 1;
  });
}
