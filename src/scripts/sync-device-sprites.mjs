#!/usr/bin/env node

/**
 * 同步设备原始精灵图到运行时资源目录。
 * AI-CORRECTION 2026-09-13: 旧静态导入与文件名映射已移至 archived-building-imports/sync-device-sprites-legacy.mjs 注释存档。
 * 下文旧来源、映射和无选项用法已失效；当前仅保留通用发布函数、--animations 和 --blueprint。
 * AI-CORRECTION 2026-09-19: 仓库不再保存动画原件，--animations 本地重发入口已停用；动画只能由网站导入批次发布。
 * 网站导入统一使用 .agents/skills/import-building-assets/SKILL.md。
 *
 * 作用：
 * 1. 从 resources/device-sprite-original 读取按中文设备名命名的 PNG 原图。
 * AI-CORRECTION 2026-08-20: 源文件也可显式携带扩展名，以接纳既有无损 WebP 原始精灵。
 * 2. 按 DEVICE_SPRITE_MAPPINGS 映射为运行时使用的 spriteId。
 * 3. 输出无损 WebP 精灵图到 public/3d-top-view/sprites。
 * 4. 基于原图 alpha 通道生成对应的遮罩图到 public/3d-top-view/sprite-masks。
 * AI-CORRECTION 2026-08-31: 13 个定制遮罩优先复制 resources/device-sprite-mask-overrides 中的 WebP，其余遮罩继续由 alpha 生成。
 * AI-CORRECTION 2026-09-05: 已声明动画的设备从 open 首帧生成静态图；四阶段与并集遮罩经同一入口校验并发布。
 *
 * 用法：
 *   node src/scripts/sync-device-sprites.mjs [sourceDir] [spriteDir] [maskDir]
 *   node src/scripts/sync-device-sprites.mjs --blueprint
 *   node src/scripts/sync-device-sprites.mjs --animations [sourceDir] [spriteDir] [maskDir] [animationDir]
 * AI-CORRECTION 2026-08-31: blueprint 模式可追加 [spriteDir] [maskDir]，用于隔离验证 WebP 生成结果。
 *
 * 参数：
 * - sourceDir: 原始 PNG 目录，默认 resources/device-sprite-original
 * - spriteDir: 精灵图输出目录，默认 public/3d-top-view/sprites
 * - maskDir: 遮罩图输出目录，默认 public/3d-top-view/sprite-masks
 * - --blueprint: 为 public/blueprint-view/sprites 下的蓝图精灵生成 mask
 */

// AI-REMOVED 2026-09-13: copyFile 已由按发布比例生成遮罩替代；Trigger: 同批多规格发布；Evidence: 本文件无复制调用；Replacement: publishDeviceSprite；Risk: Low；Human Review: Required。
// Original code: import { access, copyFile, mkdir, readdir } from 'node:fs/promises';
import { access, mkdir, readdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';
import { tsImport } from 'tsx/esm/api';


import { publishPaginatedDeviceSpriteAnimations } from './device-sprite-animation-publisher.mjs';
import { publishedImageSize } from './building-asset-image.mjs';

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(scriptDirectory, '..', '..');
const defaultSpriteDirectory = path.join(projectRoot, 'public', '3d-top-view', 'sprites');
const defaultMaskDirectory = path.join(projectRoot, 'public', '3d-top-view', 'sprite-masks');
const defaultMaskOverrideDirectory = path.join(projectRoot, 'resources', 'device-sprite-mask-overrides');
const defaultAnimationSourceDirectory = path.join(projectRoot, 'resources', 'device-sprite-animation');
const defaultAnimationDirectory = path.join(projectRoot, 'public', '3d-top-view', 'animations');
const animationProtocol = await tsImport('../shared/device-sprite-animation.ts', {
  parentURL: import.meta.url,
  tsconfig: path.join(projectRoot, 'tsconfig.app.json'),
});

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

async function fileExists(filePath) {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}

export async function publishDeviceSprite(
  sourceFilePath,
  spriteOutputFilePath,
  maskOutputFilePath,
  maskOverrideFilePath,
  rotation = 0,
  { frameTransform = null, crop = null, resolution = 1 } = {},
) {
  if (frameTransform !== null && frameTransform !== 'flip-top-bottom') {
    throw new Error('frameTransform must be null or flip-top-bottom');
  }
  await mkdir(path.dirname(spriteOutputFilePath), { recursive: true });
  await mkdir(path.dirname(maskOutputFilePath), { recursive: true });

  // 先构建旋转后的像素数据用于遮罩生成
  // AI-CORRECTION 2026-09-11: 先提取源帧，再按源坐标契约反射和旋转；颜色与遮罩使用相同顺序。
  const rotatedPipeline = sharp(sourceFilePath)
    .ensureAlpha();

  if (crop) rotatedPipeline.extract(crop);
  if (frameTransform === 'flip-top-bottom') rotatedPipeline.flip();
  if (rotation !== 0) {
    rotatedPipeline.rotate(rotation, { background: { r: 0, g: 0, b: 0, alpha: 0 } });
  }

  const { data, info } = await rotatedPipeline
    .raw()
    .toBuffer({ resolveWithObject: true });

  const published = publishedImageSize(info.width, info.height, resolution);

  // 输出旋转后的 WebP sprite
  // AI-CORRECTION 2026-09-11: 裁剪、反射与上方生成遮罩的顺序一致。
  // AI-CORRECTION 2026-09-13: 复用已经裁切、反射和旋转的 RGBA，再独立缩放，避免 Sharp 重排组合操作。
  // AI-REMOVED 2026-09-13:
  // Reason: 重复解码并组合 resize 会改变裁切/旋转顺序。
  // Trigger: 网站多比例发布；Evidence: static sprite crops a selected row before flip and rotation 回归测试。
  // Replacement: 下方从 data 创建的 webpPipeline；Risk: Low；Human Review: Required。
  // Original code:
  // const webpPipeline = sharp(sourceFilePath).ensureAlpha();
  // if (crop) webpPipeline.extract(crop);
  // if (frameTransform === 'flip-top-bottom') webpPipeline.flip();
  // if (rotation !== 0) {
  //   webpPipeline.rotate(rotation, { background: { r: 0, g: 0, b: 0, alpha: 0 } });
  // }
  const webpPipeline = sharp(data, { raw: { width: info.width, height: info.height, channels: info.channels } });
  if (resolution !== 1) webpPipeline.resize(published.width, published.height, { kernel: 'lanczos3' });
  await webpPipeline
    .webp({ lossless: true, effort: 6 })
    .toFile(spriteOutputFilePath);

  if (await fileExists(maskOverrideFilePath)) {
    const override = await sharp(maskOverrideFilePath).metadata();
    if (override.width !== info.width || override.height !== info.height) throw new Error('Mask override dimensions differ from source frame');
    await sharp(maskOverrideFilePath).resize(published.width, published.height, { kernel: 'lanczos3' })
      .webp({ lossless: true, effort: 6 }).toFile(maskOutputFilePath);
  } else {
    const maskBuffer = createMaskBuffer(data, info.width, info.height, info.channels);

    await sharp(maskBuffer, {
      raw: {
        width: info.width,
        height: info.height,
        channels: 4,
      },
    })
      .resize(published.width, published.height, { kernel: 'lanczos3' })
      .webp({ lossless: true, effort: 6 })
      .toFile(maskOutputFilePath);
  }

  return {
    width: published.width,
    height: published.height,
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
    .webp({ lossless: true, effort: 6 })
    .toFile(maskOutputFilePath);

  return {
    width: info.width,
    height: info.height,
  };
}

async function processBlueprintMasks(spriteDirectoryArgument, maskDirectoryArgument) {
  const spriteDir = path.resolve(
    spriteDirectoryArgument ?? path.join(projectRoot, 'public', 'blueprint-view', 'sprites'),
  );
  const maskDir = path.resolve(
    maskDirectoryArgument ?? path.join(projectRoot, 'public', 'blueprint-view', 'sprite-masks'),
  );

  const entries = await readdir(spriteDir, { withFileTypes: true });
  const webpFiles = entries
    .filter((entry) => entry.isFile() && entry.name.endsWith('.webp'))
    .map((entry) => entry.name);

  if (webpFiles.length === 0) {
    console.log('No WebP files found in blueprint-view/sprites.');
    return;
  }

  console.log(`Found ${webpFiles.length} blueprint sprites. Generating masks...`);

  for (const fileName of webpFiles) {
    const spriteId = fileName.replace(/\.webp$/, '');
    const sourceFilePath = path.join(spriteDir, fileName);
    const maskOutputFilePath = path.join(maskDir, `${spriteId}.webp`);

    const { width, height } = await generateMaskOnly(sourceFilePath, maskOutputFilePath);
    console.log(`  ${spriteId}: ${width}x${height}`);
  }

  console.log('Blueprint masks generated.');
}

async function readRegistryAnimationDefinitions() {
  const { createRegistryContract } = await tsImport('../registry/index.ts', {
    parentURL: import.meta.url,
    tsconfig: path.join(projectRoot, 'tsconfig.app.json'),
  });
  return createRegistryContract().entityDefinitions;
}

/** 直接消费 Registry 声明，生成链不维护独立的行列或帧时长清单。 */
/** AI-CORRECTION 2026-09-06: Registry 只声明能力；源清单负责重切分，发布 manifest 负责分页布局与时序。 */
export async function publishDeviceSpriteAnimations({
  definitions,
  spriteIds,
  sourceDirectory = defaultAnimationSourceDirectory,
  sourceAssetRoot,
  spriteDirectory = defaultSpriteDirectory,
  maskDirectory = defaultMaskDirectory,
  animationDirectory = defaultAnimationDirectory,
  maskOverrideDirectory = defaultMaskOverrideDirectory,
  maxTextureSize = animationProtocol.DEVICE_SPRITE_ANIMATION_MAX_TEXTURE_SIZE,
  resolution,
} = {}) {
  return publishPaginatedDeviceSpriteAnimations({
    definitions,
    spriteIds,
    sourceDirectory,
    sourceAssetRoot,
    spriteDirectory,
    maskDirectory,
    animationDirectory,
    maskOverrideDirectory,
    maxTextureSize,
    resolution,
    animationProtocol,
    readRegistryAnimationDefinitions,
  });
}

async function main() {
  const isBlueprintMode = process.argv.includes('--blueprint');

  if (isBlueprintMode) {
    const [spriteDirectoryArgument, maskDirectoryArgument] = process.argv
      .slice(2)
      .filter((argument) => argument !== '--blueprint');
    await processBlueprintMasks(spriteDirectoryArgument, maskDirectoryArgument);
    return;
  }

  if (process.argv.includes('--animations')) {
    // AI-REMOVED 2026-09-19:
    // Reason: 仓库不再保存动画 WebP 原件，本地重发会依赖已删除的展开素材。
    // Trigger: 用户要求网站素材只在 .temp/.trash 导入批次中存在。
    // Evidence: import-building-assets 显式传入 sourceAssetRoot，并在同批完成下载、校验和发布。
    // Replacement: .agents/skills/import-building-assets/SKILL.md 网站导入流程。
    // Risk: 网站不可用时无法重发动画。
    // Human Review: Required
    //
    // Original code:
    // const [sourceDirectory, spriteDirectory, maskDirectory, animationDirectory] = process.argv.slice(2)
    //   .filter((argument) => argument !== '--animations');
    // const results = await publishDeviceSpriteAnimations({ sourceDirectory, spriteDirectory, maskDirectory, animationDirectory });
    // console.log(`Published ${results.length} device animations.`);
    // return;
    throw new Error('动画原件不再保存在仓库；请通过 import-building-assets 技能从网站下载并发布。');
  }

  throw new Error('旧静态素材导入入口已移除；网站导入请使用 import-building-assets 技能。本地仅支持 --blueprint。');
}

// AI-REMOVED 2026-09-05:
// Reason: 导入生成函数进行隔离测试时不得自动写入正式资源目录。
// Trigger: REQ-025 无素材基础设施验收需要复用实际生成入口。
// Evidence: 原模块在 import 时无条件执行 main()。
// Replacement: 下方仅直接执行时运行的 CLI 入口。
// Risk: Low
// Human Review: Required
//
// Original code:
// main().catch((error) => {
//   console.error('Failed to sync device sprites.');
//   console.error(error);
//   process.exitCode = 1;
// });
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error('Failed to sync device sprites.');
    console.error(error);
    process.exitCode = 1;
  });
}
