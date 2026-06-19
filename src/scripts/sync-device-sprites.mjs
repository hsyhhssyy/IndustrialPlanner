#!/usr/bin/env node

/**
 * 同步设备原始精灵图到运行时资源目录。
 *
 * 作用：
 * 1. 从 resources/device-sprite-original 读取按中文设备名命名的 PNG 原图。
 * 2. 按 DEVICE_SPRITE_MAPPINGS 映射为运行时使用的 spriteId。
 * 3. 输出无损 WebP 精灵图到 public/3d-top-view/sprites。
 * 4. 基于原图 alpha 通道生成对应的遮罩图到 public/3d-top-view/sprite-masks。
 *
 * 用法：
 *   node src/scripts/sync-device-sprites.mjs [sourceDir] [spriteDir] [maskDir]
 *   node src/scripts/sync-device-sprites.mjs --blueprint
 *
 * 参数：
 * - sourceDir: 原始 PNG 目录，默认 resources/device-sprite-original
 * - spriteDir: 精灵图输出目录，默认 public/3d-top-view/sprites
 * - maskDir: 遮罩图输出目录，默认 public/3d-top-view/sprite-masks
 * - --blueprint: 为 public/blueprint-view/sprites 下的蓝图精灵生成 mask
 */

import { mkdir, readdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(scriptDirectory, '..', '..');
const defaultSourceDirectory = path.join(projectRoot, 'resources', 'device-sprite-original');
const defaultSpriteDirectory = path.join(projectRoot, 'public', '3d-top-view', 'sprites');
const defaultMaskDirectory = path.join(projectRoot, 'public', '3d-top-view', 'sprite-masks');

// 资源目录使用中文设备名，运行时资源使用 registry spriteId。
// 三元组：[中文名, spriteId, rotation?]
// rotation 为顺时针旋转角度（度），默认 0。
// 图片输入端口在 N 方向，设备定义 0° 输入端口在 S 方向时需要 rotation: 180。
const DEVICE_SPRITE_MAPPINGS = [
  ['塑形机', 'item_port_shaper_1', 180],
  ['种植机', 'item_port_planter_1', 180],
  ['粉碎机', 'item_port_grinder_1', 180],
  ['精炼炉', 'item_port_furnance_1', 180],
  ['配件机', 'item_port_cmpt_mc_1', 180],
  ['采种机', 'item_port_seedcol_1', 180],
  ['存取线基段', 'item_port_log_hongs_bus'],
  ['存取线源桩', 'item_port_log_hongs_bus_source'],
  ['反应池', 'item_port_mix_pool_1', 180],
  ['天有洪炉', 'item_port_xiranite_oven_1', 180],
  ['拆解机', 'item_port_dismantler_1', 180],
  ['装备原件机', 'item_port_winder_1', 180],
  ['封装机', 'item_port_tools_asm_mc_1', 180],
  ['灌装机', 'item_port_filling_pd_mc_1', 180],
  ['研磨机', 'item_port_thickener_1', 180],
  ['仓库存货口-紧凑-3x2', 'item_port_loader_1', 180],
  ['仓库取货口-紧凑-3x2', 'item_port_unloader_1'],
];

function createMaskBuffer(sourceBuffer, width, height, channels) {
  const pixelCount = width * height;
  const maskBuffer = Buffer.alloc(pixelCount * 4);

  for (let pixelIndex = 0; pixelIndex < pixelCount; pixelIndex += 1) {
    const alpha = sourceBuffer[pixelIndex * channels + 3];
    const outputOffset = pixelIndex * 4;

    maskBuffer[outputOffset] = alpha;
    maskBuffer[outputOffset + 1] = alpha;
    maskBuffer[outputOffset + 2] = alpha;
    maskBuffer[outputOffset + 3] = 255;
  }

  return maskBuffer;
}

async function publishDeviceSprite(sourceFilePath, spriteOutputFilePath, maskOutputFilePath, rotation = 0) {
  await mkdir(path.dirname(spriteOutputFilePath), { recursive: true });
  await mkdir(path.dirname(maskOutputFilePath), { recursive: true });

  // 先构建旋转后的像素数据用于遮罩生成
  const rotatedPipeline = sharp(sourceFilePath)
    .ensureAlpha();

  if (rotation !== 0) {
    rotatedPipeline.rotate(rotation, { background: { r: 0, g: 0, b: 0, alpha: 0 } });
  }

  const { data, info } = await rotatedPipeline
    .raw()
    .toBuffer({ resolveWithObject: true });

  // 输出旋转后的 WebP sprite
  const webpPipeline = sharp(sourceFilePath)
    .ensureAlpha();

  if (rotation !== 0) {
    webpPipeline.rotate(rotation, { background: { r: 0, g: 0, b: 0, alpha: 0 } });
  }

  await webpPipeline
    .webp({ lossless: true, effort: 6 })
    .toFile(spriteOutputFilePath);

  const maskBuffer = createMaskBuffer(data, info.width, info.height, info.channels);

  await sharp(maskBuffer, {
    raw: {
      width: info.width,
      height: info.height,
      channels: 4,
    },
  })
    .webp({ lossless: true, effort: 6 })
    .toFile(maskOutputFilePath);

  return {
    width: info.width,
    height: info.height,
  };
}

async function generateMaskOnly(sourceFilePath, maskOutputFilePath) {
  await mkdir(path.dirname(maskOutputFilePath), { recursive: true });

  const { data, info } = await sharp(sourceFilePath)
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });

  const maskBuffer = createMaskBuffer(data, info.width, info.height, info.channels);

  await sharp(maskBuffer, {
    raw: {
      width: info.width,
      height: info.height,
      channels: 4,
    },
  })
    .png()
    .toFile(maskOutputFilePath);

  return {
    width: info.width,
    height: info.height,
  };
}

async function processBlueprintMasks() {
  const spriteDir = path.join(projectRoot, 'public', 'blueprint-view', 'sprites');
  const maskDir = path.join(projectRoot, 'public', 'blueprint-view', 'sprite-masks');

  const entries = await readdir(spriteDir, { withFileTypes: true });
  const pngFiles = entries
    .filter((entry) => entry.isFile() && entry.name.endsWith('.png'))
    .map((entry) => entry.name);

  if (pngFiles.length === 0) {
    console.log('No PNG files found in blueprint-view/sprites.');
    return;
  }

  console.log(`Found ${pngFiles.length} blueprint sprites. Generating masks...`);

  for (const fileName of pngFiles) {
    const spriteId = fileName.replace(/\.png$/, '');
    const sourceFilePath = path.join(spriteDir, fileName);
    const maskOutputFilePath = path.join(maskDir, `${spriteId}.png`);

    const { width, height } = await generateMaskOnly(sourceFilePath, maskOutputFilePath);
    console.log(`  ${spriteId}: ${width}x${height}`);
  }

  console.log('Blueprint masks generated.');
}

async function main() {
  const isBlueprintMode = process.argv.includes('--blueprint');

  if (isBlueprintMode) {
    await processBlueprintMasks();
    return;
  }

  const sourceDirectory = path.resolve(process.argv[2] ?? defaultSourceDirectory);
  const spriteDirectory = path.resolve(process.argv[3] ?? defaultSpriteDirectory);
  const maskDirectory = path.resolve(process.argv[4] ?? defaultMaskDirectory);

  for (const [sourceName, spriteId, rotation = 0] of DEVICE_SPRITE_MAPPINGS) {
    const sourceFilePath = path.join(sourceDirectory, `${sourceName}.png`);
    const spriteOutputFilePath = path.join(spriteDirectory, `${spriteId}.webp`);
    const maskOutputFilePath = path.join(maskDirectory, `${spriteId}.webp`);
    const { width, height } = await publishDeviceSprite(
      sourceFilePath,
      spriteOutputFilePath,
      maskOutputFilePath,
      rotation,
    );

    console.log(`${spriteId}: ${width}x${height}${rotation ? ` (rotated ${rotation}°)` : ''}`);
  }
}

main().catch((error) => {
  console.error('Failed to sync device sprites.');
  console.error(error);
  process.exitCode = 1;
});