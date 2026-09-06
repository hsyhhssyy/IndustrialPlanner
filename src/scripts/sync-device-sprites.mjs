#!/usr/bin/env node

/**
 * 同步设备原始精灵图到运行时资源目录。
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

import { access, copyFile, mkdir, readdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';
import { tsImport } from 'tsx/esm/api';

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(scriptDirectory, '..', '..');
const defaultSourceDirectory = path.join(projectRoot, 'resources', 'device-sprite-original');
const defaultSpriteDirectory = path.join(projectRoot, 'public', '3d-top-view', 'sprites');
const defaultMaskDirectory = path.join(projectRoot, 'public', '3d-top-view', 'sprite-masks');
const defaultMaskOverrideDirectory = path.join(projectRoot, 'resources', 'device-sprite-mask-overrides');
const defaultAnimationSourceDirectory = path.join(projectRoot, 'resources', 'device-sprite-animation');
const defaultAnimationDirectory = path.join(projectRoot, 'public', '3d-top-view', 'animations');
const animationProtocol = await tsImport('../shared/device-sprite-animation.ts', {
  parentURL: import.meta.url,
  tsconfig: path.join(projectRoot, 'tsconfig.app.json'),
});

// 资源目录使用中文设备名，运行时资源使用 registry spriteId。
// 三元组：[中文名, spriteId, rotation?]
// AI-CORRECTION 2026-08-20: 第一项可为不带扩展名的中文名，也可为含扩展名的源文件名。
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
  ['暗管入口-旧注册表0度.webp', 'item_port_udpipe_loader_1', 180],
  ['暗管出口-旧注册表0度.webp', 'item_port_udpipe_unloader_1', 180],
  ['抽水泵-旧注册表0度.webp', 'item_port_water_pump_1', 180],
  ['多口暗管入口-旧注册表0度.webp', 'item_port_udpipe_loader_2', 180],
  ['废水处理机-旧注册表0度.webp', 'item_liquid_cleaner_1', 180],
  ['储液罐-旧注册表0度.webp', 'item_port_liquid_storager_1', 180],
  ['储气罐', 'gas_storager_1', 180],
  ['固气转化机-固到气', 'transmuter_2_gastrans', 180],
  ['固气转化机-气到固', 'transmuter_2_solidtrans', 180],
  ['提纯机气体', 'liquid_purifier_1_gas', 180],
  // AI-REMOVED 2026-08-20:
  // Reason: resources 中的 426px 提纯机原图并非当前发布精灵的 813px 像素源，直接切换会引入无关视觉替换。
  // Trigger: 本次只订正默认朝向，不应同时改变现有精灵内容与分辨率。
  // Evidence: 同步输出尺寸从 813x819 降为 426x422。
  // Replacement: 下方提纯机-旧注册表0度.webp 的稳定像素源。
  // Risk: Low
  // Human Review: Required
  //
  // Original code:
  // ['提纯机', 'item_port_liquid_purifier_1', 270],
  ['提纯机-旧注册表0度.webp', 'item_port_liquid_purifier_1', 270],
  ['液气转化机', 'transmuter_1_gastrans', 180],
  ['液气转化机', 'transmuter_1_liquidtrans', 180],
  ['气体扩散机', 'vaporizer_1', 180],
  ['气体反应炉', 'item_port_gas_reactor_1', 180],
  ['气体收集泵', 'gas_pump_1', 180],
  ['无限箱-1', 'cheat_infinite_solid'],
  ['无限水-1', 'cheat_infinite_liquid'],
  ['无限气-1', 'cheat_infinite_gas'],
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

async function fileExists(filePath) {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function publishDeviceSprite(
  sourceFilePath,
  spriteOutputFilePath,
  maskOutputFilePath,
  maskOverrideFilePath,
  rotation = 0,
) {
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

  if (await fileExists(maskOverrideFilePath)) {
    await copyFile(maskOverrideFilePath, maskOutputFilePath);
  } else {
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
  }

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
export async function publishDeviceSpriteAnimations({
  definitions,
  sourceDirectory = defaultAnimationSourceDirectory,
  spriteDirectory = defaultSpriteDirectory,
  maskDirectory = defaultMaskDirectory,
  animationDirectory = defaultAnimationDirectory,
  maskOverrideDirectory = defaultMaskOverrideDirectory,
  maxTextureSize = animationProtocol.DEVICE_SPRITE_ANIMATION_MAX_TEXTURE_SIZE,
} = {}) {
  const { DEVICE_SPRITE_ANIMATION_PHASES: phases, normalizeDeviceSpriteAnimationDefinition,
    getDeviceSpriteAnimationSignature, resolveDeviceSpriteAnimationGrid,
    validateDeviceSpriteAnimationId } = animationProtocol;
  const bySpriteId = new Map();
  for (const entity of definitions ?? await readRegistryAnimationDefinitions()) {
    if (entity.spriteAnimation === undefined) continue;
    validateDeviceSpriteAnimationId(entity.spriteId);
    const definition = normalizeDeviceSpriteAnimationDefinition(entity.spriteAnimation);
    const signature = getDeviceSpriteAnimationSignature(definition);
    const previous = bySpriteId.get(entity.spriteId);
    if (previous && previous.signature !== signature) {
      throw new Error(`Conflicting animation definitions for ${entity.spriteId}`);
    }
    bySpriteId.set(entity.spriteId, { definition, signature });
  }
  if (await fileExists(sourceDirectory)) {
    const entries = await readdir(sourceDirectory, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.isDirectory() && !bySpriteId.has(entry.name)) {
        throw new Error(`Animation source ${entry.name} has no Registry declaration`);
      }
    }
  }
  const results = [];
  for (const [spriteId, { definition }] of bySpriteId) {
    // 定制 mask 的语义必须在素材接入时人工核对，不能静默改成首帧或并集。
    if (await fileExists(path.join(maskOverrideDirectory, `${spriteId}.webp`))) {
      throw new Error(`Animation ${spriteId} has an existing mask override; resolve it before publishing`);
    }
    const decoded = {};
    const dimensions = {};
    for (const phase of phases) {
      const filePath = path.join(sourceDirectory, spriteId, `${phase}.webp`);
      const metadata = await sharp(filePath).metadata();
      if (metadata.format !== 'webp' || !metadata.hasAlpha || (metadata.pages ?? 1) !== 1) {
        throw new Error(`${spriteId}/${phase} must be a static WebP with Alpha`);
      }
      dimensions[phase] = { width: metadata.width, height: metadata.height };
    }
    const { frameWidth, frameHeight } = resolveDeviceSpriteAnimationGrid(definition, dimensions, maxTextureSize);
    const unionAlpha = Buffer.alloc(frameWidth * frameHeight);
    let firstFrame;
    for (const phase of phases) {
      const { data, info } = await sharp(path.join(sourceDirectory, spriteId, `${phase}.webp`))
        .ensureAlpha().raw().toBuffer({ resolveWithObject: true });
      if (info.channels !== 4) throw new Error(`${spriteId}/${phase} must decode to RGBA`);
      decoded[phase] = { data, info };
      const clip = definition.clips[phase];
      for (let frameIndex = 0; frameIndex < clip.frameCount; frameIndex += 1) {
        const left = (frameIndex % clip.columns) * frameWidth;
        const top = Math.floor(frameIndex / clip.columns) * frameHeight;
        const current = phase === 'open' && frameIndex === 0
          ? Buffer.alloc(frameWidth * frameHeight * 4) : null;
        let hasTransparentPixel = false;
        let hasVisiblePixel = false;
        for (let y = 0; y < frameHeight; y += 1) {
          for (let x = 0; x < frameWidth; x += 1) {
            const pixel = y * frameWidth + x;
            const offset = ((top + y) * info.width + left + x) * 4;
            const alpha = data[offset + 3];
            unionAlpha[pixel] = Math.max(unionAlpha[pixel], alpha);
            hasTransparentPixel ||= alpha < 255;
            hasVisiblePixel ||= alpha > 0;
            if (current !== null) data.copy(current, pixel * 4, offset, offset + 4);
          }
        }
        if (!hasTransparentPixel || !hasVisiblePixel) {
          throw new Error(`${spriteId}/${phase} frame ${frameIndex} needs a transparent background and visible content`);
        }
        if (current !== null) firstFrame = current;
      }
    }
    const unionRgba = Buffer.alloc(frameWidth * frameHeight * 4);
    for (let pixel = 0; pixel < unionAlpha.length; pixel += 1) unionRgba[pixel * 4 + 3] = unionAlpha[pixel];
    const raw = { width: frameWidth, height: frameHeight, channels: 4 };
    const outputDirectory = path.join(animationDirectory, spriteId);
    await Promise.all([spriteDirectory, maskDirectory, outputDirectory].map((directory) => mkdir(directory, { recursive: true })));
    // 校验全部通过才写该设备的产物；静态 mask 与动画并集 mask 始终分开。
    await sharp(firstFrame, { raw }).webp({ lossless: true, effort: 6 }).toFile(path.join(spriteDirectory, `${spriteId}.webp`));
    await sharp(createMaskBuffer(firstFrame, frameWidth, frameHeight, 4), { raw })
      .webp({ lossless: true, effort: 6 }).toFile(path.join(maskDirectory, `${spriteId}.webp`));
    await sharp(createMaskBuffer(unionRgba, frameWidth, frameHeight, 4), { raw })
      .webp({ lossless: true, effort: 6 }).toFile(path.join(outputDirectory, 'mask.webp'));
    for (const phase of phases) {
      const { data, info } = decoded[phase];
      await sharp(data, { raw: { width: info.width, height: info.height, channels: 4 } })
        .webp({ lossless: true, effort: 6 }).toFile(path.join(outputDirectory, `${phase}.webp`));
    }
    results.push({ spriteId, frameWidth, frameHeight });
  }
  return results;
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
    const [sourceDirectory, spriteDirectory, maskDirectory, animationDirectory] = process.argv.slice(2)
      .filter((argument) => argument !== '--animations');
    const results = await publishDeviceSpriteAnimations({ sourceDirectory, spriteDirectory, maskDirectory, animationDirectory });
    console.log(`Published ${results.length} device animations.`);
    return;
  }

  const sourceDirectory = path.resolve(process.argv[2] ?? defaultSourceDirectory);
  const spriteDirectory = path.resolve(process.argv[3] ?? defaultSpriteDirectory);
  const maskDirectory = path.resolve(process.argv[4] ?? defaultMaskDirectory);
  const definitions = await readRegistryAnimationDefinitions();
  const animatedSpriteIds = new Set(definitions.filter((entity) => entity.spriteAnimation !== undefined)
    .map((entity) => entity.spriteId));

  for (const [sourceName, spriteId, rotation = 0] of DEVICE_SPRITE_MAPPINGS) {
    if (animatedSpriteIds.has(spriteId)) continue;
    const sourceFileName = path.extname(sourceName) === '' ? `${sourceName}.png` : sourceName;
    const sourceFilePath = path.join(sourceDirectory, sourceFileName);
    const spriteOutputFilePath = path.join(spriteDirectory, `${spriteId}.webp`);
    const maskOutputFilePath = path.join(maskDirectory, `${spriteId}.webp`);
    const maskOverrideFilePath = path.join(defaultMaskOverrideDirectory, `${spriteId}.webp`);
    const { width, height } = await publishDeviceSprite(
      sourceFilePath,
      spriteOutputFilePath,
      maskOutputFilePath,
      maskOverrideFilePath,
      rotation,
    );

    console.log(`${spriteId}: ${width}x${height}${rotation ? ` (rotated ${rotation}°)` : ''}`);
  }
  await publishDeviceSpriteAnimations({ definitions, spriteDirectory, maskDirectory });
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
