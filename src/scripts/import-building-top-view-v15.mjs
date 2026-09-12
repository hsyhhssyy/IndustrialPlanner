#!/usr/bin/env node

/**
 * 从 buildings_frontend_v1.5.zip 导入普通建筑 top-view 素材。
 * 源图像轴为 +sourceZ，Registry 图像轴为 projectY = depth - 1 - sourceZ，
 * 因此必须在每个帧单元内上下翻转，不能对整张分页图集翻转。
 */
import { access, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { promisify } from 'node:util';
import { execFile } from 'node:child_process';
import path from 'node:path';
import crypto from 'node:crypto';
import sharp from 'sharp';
import { tsImport } from 'tsx/esm/api';
import { fileURLToPath } from 'node:url';
import { publishDeviceSprite } from './sync-device-sprites.mjs';

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(scriptDirectory, '..', '..');
const defaultArchive = path.join(projectRoot, '.temp', '.trash', '动画素材包', 'buildings_frontend_v1.5.zip');
const animationRoot = path.join(projectRoot, 'resources', 'device-sprite-animation');
const originalRoot = path.join(projectRoot, 'resources', 'device-sprite-original', 'v15');
const spriteRoot = path.join(projectRoot, 'public', '3d-top-view', 'sprites');
const maskRoot = path.join(projectRoot, 'public', '3d-top-view', 'sprite-masks');
const collectionPath = path.join(projectRoot, 'resources', 'building-top-view-v15.json');

const ADDITIONAL_ENTRIES = [
  ['cmpt_mc_1', 'item_port_cmpt_mc_1', 'component_mc_1', true],
  ['mix_pool_1', 'item_port_mix_pool_1', 'mix_pool_1', true],
  ['filling_pd_mc_1_liquid', 'item_port_liquid_filling_pd_mc_1', 'filling_powder_mc_1', true],
  ['log_admission', 'item_log_admission', 'log_conditioner', false],
  ['log_connector', 'item_log_connector', 'log_connector', false],
  ['log_converger', 'item_log_converger', 'log_converger', false],
  ['log_splitter', 'item_log_splitter', 'log_splitter', false],
  ['pipe_admission', 'item_pipe_admission', 'pipe_conditioner', false],
  ['pipe_connector', 'item_pipe_connector', 'pipe_connector', false],
  ['pipe_converger', 'item_pipe_converger', 'pipe_converger', false],
  ['pipe_splitter', 'item_pipe_splitter', 'pipe_splitter', false],
];

const json = (file) => readFile(file, 'utf8').then(JSON.parse);
const exists = async (file) => { try { await access(file); return true; } catch { return false; } };

async function ensureAnimationManifest(entry, sourceTopPath, manifestPath) {
  const existing = await exists(manifestPath) ? await json(manifestPath) : null;
  const phaseEntries = (await readdir(path.join(sourceTopPath, 'animations'), { withFileTypes: true }))
    .filter((item) => item.isDirectory()).map((item) => item.name);
  const sources = {};
  const clips = { open: [], open_idle: [], close: [], close_idle: [] };
  let frameWidth; let frameHeight; let fps;
  for (const phase of phaseEntries) {
    const meta = await json(path.join(sourceTopPath, 'animations', phase, 'spritesheet.json'));
    const animation = await json(path.join(sourceTopPath, 'animations', phase, 'animation.json'));
    frameWidth ??= meta.cellWidth; frameHeight ??= meta.cellHeight;
    fps ??= animation.fps;
    if (meta.cellWidth !== frameWidth || meta.cellHeight !== frameHeight
      || !Number.isFinite(fps) || fps <= 0) throw new Error(`Invalid animation dimensions or FPS: ${entry.entityId}/${phase}`);
    const ranges = [];
    for (const page of meta.pages) {
      const index = String(page.index).padStart(3, '0');
      const sourceName = `${phase}_${index}`;
      const rows = page.height / frameHeight, columns = page.width / frameWidth;
      if (![rows, columns, page.frameCount].every((value) => Number.isSafeInteger(value) && value > 0)
        || page.frameCount > rows * columns || !Number.isSafeInteger(page.frameStart) || page.frameStart < 0) {
        throw new Error(`Invalid source grid: ${entry.entityId}/${sourceName}`);
      }
      const frameDurationsMs = animation.frames.slice(page.frameStart, page.frameStart + page.frameCount).map((frame) => frame.durationMs);
      if (frameDurationsMs.length !== page.frameCount || frameDurationsMs.some((duration) => !Number.isFinite(duration) || duration <= 0)) {
        throw new Error(`Invalid source durations: ${entry.entityId}/${sourceName}`);
      }
      const sourcePath = `animations/${phase}/${page.image ?? page.file}`;
      const bytes = await readFile(path.join(sourceTopPath, sourcePath));
      const sha256 = crypto.createHash('sha256').update(bytes).digest('hex');
      if (page.sha256 && page.sha256 !== sha256) throw new Error(`Source hash mismatch: ${entry.entityId}/${sourceName}`);
      const dimensions = await sharp(bytes).metadata();
      if (dimensions.width !== page.width || dimensions.height !== page.height) {
        throw new Error(`Source pixels differ from JSON: ${entry.entityId}/${sourceName}`);
      }
      sources[sourceName] = { file: `${sourceName}.webp`, rows, columns, frameCount: page.frameCount,
        frameDurationsMs, sourcePath, sha256 };
      ranges.push({ source: sourceName, startFrame: 0, frameCount: page.frameCount });
    }
    if (clips[phase]) clips[phase].push(...ranges);
  }
  const fallbackClose = clips.close_idle[0] && { ...clips.close_idle[0], frameCount: 1 };
  const fallbackOpen = fallbackClose ?? (clips.open_idle[0] && { ...clips.open_idle[0], frameCount: 1 });
  if (!fallbackOpen || !fallbackClose) throw new Error(`Missing idle source phases: ${entry.entityId}`);
  if (clips.open.length === 0) clips.open.push(fallbackOpen);
  if (clips.open_idle.length === 0) clips.open_idle.push(fallbackOpen);
  if (clips.close.length === 0) clips.close.push(fallbackClose);
  if (clips.close_idle.length === 0) clips.close_idle.push(fallbackClose);
  // 只有源帧布局及时间线仍一致时，才复用已确认的四阶段切分；新交付以自己的完整阶段为准。
  const retainClips = existing?.frameWidth === frameWidth && existing?.frameHeight === frameHeight
    && Object.keys(existing.sources).length === Object.keys(sources).length
    && Object.entries(sources).every(([name, source]) => {
      const previous = existing.sources[name];
      return previous?.frameCount === source.frameCount && previous?.columns === source.columns
        && JSON.stringify(previous.frameDurationsMs) === JSON.stringify(source.frameDurationsMs);
    });
  const selectedClips = retainClips ? existing.clips : clips;
  for (const [phase, ranges] of Object.entries(selectedClips)) for (const range of ranges) {
    const source = sources[range.source];
    if (!source || !Number.isSafeInteger(range.startFrame) || range.startFrame < 0
      || !Number.isSafeInteger(range.frameCount) || range.frameCount <= 0
      || range.startFrame + range.frameCount > source.frameCount) {
      throw new Error(`Invalid retained range: ${entry.entityId}/${phase}`);
    }
  }
  const manifest = { ...existing, schemaVersion: 1, frameWidth, frameHeight, fps,
    pageRows: Math.min(7, Math.floor(4095 / frameHeight)),
    pageColumns: Math.min(5, Math.floor(4095 / frameWidth)), sources, clips: selectedClips,
    clipSelection: retainClips ? (existing.clipSelection ?? 'validated-existing-ranges') : 'source-phases' };
  return manifest;
}

// AI-REMOVED 2026-09-11:
// Reason: 导入时不重编码源图，时间线与布局必须在同一入口校验。
// Trigger: ZIP 原字节保留和逐帧时间线更新要求。
// Evidence: ensureAnimationManifest 同时校验页面尺寸、hash 和 duration；flipFrames 无有效调用。
// Replacement: ensureAnimationManifest、device-sprite-animation-publisher.mjs、publishDeviceSprite。
// Risk: Low
// Human Review: Required
//
// Original code:
// async function applySourceDurations(manifest, sourceTopPath) {
//   for (const [sourceName, source] of Object.entries(manifest.sources)) {
//     const phase = sourceName.replace(/_\d{3}$/, '');
//     const pageIndex = Number(sourceName.match(/_(\d{3})$/)?.[1] ?? 0);
//     const animation = await json(path.join(sourceTopPath, 'animations', phase, 'animation.json'));
//     const sheet = await json(path.join(sourceTopPath, 'animations', phase, 'spritesheet.json'));
//     const page = sheet.pages.find((candidate) => candidate.index === pageIndex);
//     if (!page || !Array.isArray(animation.frames)) throw new Error(`Missing frame timing metadata: ${phase}/${sourceName}`);
//     const durations = animation.frames.slice(page.frameStart, page.frameStart + page.frameCount).map((frame) => frame.durationMs);
//     if (durations.length !== source.frameCount || durations.some((duration) => !Number.isFinite(duration) || duration <= 0)) {
//       throw new Error(`Frame timing count mismatch: ${sourceName}`);
//     }
//     source.frameDurationsMs = durations;
//   }
// }
// 
// function flipFrames(data, width, height, frameWidth, frameHeight, columns, frameCount) {
//   const output = Buffer.alloc(data.length);
//   const pagesRows = Math.ceil(frameCount / columns);
//   for (let frame = 0; frame < frameCount; frame += 1) {
//     const sx = (frame % columns) * frameWidth;
//     const sy = Math.floor(frame / columns) * frameHeight;
//     for (let y = 0; y < frameHeight; y += 1) {
//       const source = ((sy + y) * width + sx) * 4;
//       const target = ((sy + frameHeight - 1 - y) * width + sx) * 4;
//       data.copy(output, target, source, source + frameWidth * 4);
//     }
//   }
//   // Preserve any unused transparent cells exactly as decoded pixels.
//   for (let row = pagesRows; row < Math.ceil(height / frameHeight); row += 1) {
//     const start = row * width * 4;
//     data.copy(output, start, start, start + width * 4);
//   }
//   return output;
// }

// AI-REMOVED 2026-09-11:
// Reason: 源页不得在导入阶段重编码；发布变换统一由 publisher / publishDeviceSprite 执行。
// Trigger: 源 ZIP 原字节保留要求。
// Evidence: source 页需与 ZIP hash 一致。
// Replacement: applySourceDurations 与统一发布入口。
// Risk: Low
// Human Review: Required
//
// Original code:
// AI-CORRECTION 2026-09-11: 补齐此前被错误省略的原函数全文；以上 applySourceDurations 也已归档，替代入口为 ensureAnimationManifest。
// async function transformSheet(input, output, frameWidth, frameHeight, columns, frameCount) {
//   const decoded = await sharp(input).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
//   const transformed = flipFrames(decoded.data, decoded.info.width, decoded.info.height,
//     frameWidth, frameHeight, columns, frameCount);
//   await mkdir(path.dirname(output), { recursive: true });
//   await sharp(transformed, { raw: { width: decoded.info.width, height: decoded.info.height, channels: 4 } })
//     .webp({ quality: 85, alphaQuality: 100, lossless: true, effort: 4 }).toFile(output);
// }
// 
// async function extractFirstFrame(input, output, frameWidth, frameHeight, columns, frameCount) {
//   const decoded = await sharp(input).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
//   const transformed = flipFrames(decoded.data, decoded.info.width, decoded.info.height,
//     frameWidth, frameHeight, columns, frameCount);
//   await mkdir(path.dirname(output), { recursive: true });
//   await sharp(transformed, { raw: { width: decoded.info.width, height: decoded.info.height, channels: 4 } })
//     .extract({ left: 0, top: 0, width: frameWidth, height: frameHeight })
//     .webp({ lossless: true, effort: 6 }).toFile(output);
// }

async function runImport(archiveArgument, extractedArgument) {
  const entityFilter = new Set(process.argv.slice(2).filter((argument) => argument.startsWith('--entity-id=')).map((argument) => argument.slice('--entity-id='.length)));
  const positional = process.argv.slice(2).filter((argument) => !argument.startsWith('--'));
  const archive = path.resolve(archiveArgument ?? positional[0] ?? defaultArchive);
  const extractedRoot = path.resolve(extractedArgument ?? positional[1]);
  const archiveSha256 = crypto.createHash('sha256').update(await readFile(archive)).digest('hex');
  const collection = await json(collectionPath);
  if (entityFilter.size > 0) {
    const knownIds = new Set(collection.entries.map((entry) => entry.entityId));
    for (const entityId of entityFilter) {
      if (!knownIds.has(entityId) && !ADDITIONAL_ENTRIES.some((entry) => entry[0] === entityId)) {
        throw new Error(`Unknown --entity-id: ${entityId}`);
      }
    }
  }
  const existingIds = new Set(collection.entries.map((entry) => entry.entityId));
  for (const [entityId, spriteId, building, animated] of ADDITIONAL_ENTRIES) {
    if (entityFilter.size > 0 && !entityFilter.has(entityId)) continue;
    if (!existingIds.has(entityId)) {
      const packageData = await json(path.join(extractedRoot, building, 'top', 'package.json'));
      const spatial = await json(path.join(extractedRoot, building, 'top', 'spatial.json'));
      collection.entries.push({
        entityId, spriteId, package: path.basename(archive), sourcePath: `${building}/top`,
        spriteOffset: {
          x: -spatial.footprintRectCells.left,
          y: spatial.footprintRectCells.top + spatial.footprintRectCells.height - spatial.canvasCells.height,
          width: spatial.canvasCells.width,
          height: spatial.canvasCells.height,
        },
        animated,
        sourceMetadata: { spatial, package: packageData, sourceArchiveSha256: archiveSha256 },
      });
    }
  }
  if (entityFilter.size === 0) {
    collection.sourceArchive = path.basename(archive);
    collection.sourceArchiveSha256 = archiveSha256;
    collection.sourceCoordinateTransform = {
      imageAxes: { x: '+sourceX', y: '+sourceZ' },
      operation: 'projectY = depth - 1 - sourceZ',
      rasterOperation: 'flip-top-bottom per frame cell',
    };
  }

  for (const entry of collection.entries) {
    if (entityFilter.size > 0 && !entityFilter.has(entry.entityId)) continue;
    const sourceRoot = path.join(extractedRoot, entry.sourcePath.replace(/\/top(?:-(?:gas|solidtrans))?$/, ''));
    const sourceTop = path.join(sourceRoot, 'top');
    const phasePath = entry.sourcePath.includes('-gas') ? 'gas' : entry.sourcePath.includes('-solidtrans') ? 'solidtrans' : null;
    const sourceTopPath = phasePath ? path.join(sourceRoot, `top-${phasePath}`) : sourceTop;
    const spatial = await json(path.join(sourceTopPath, 'spatial.json'));
    const packageData = await json(path.join(sourceTopPath, 'package.json'));
    if (spatial.imageOrigin !== 'top-left' || spatial.imageAxes?.x !== '+sourceX'
      || spatial.imageAxes?.y !== '+sourceZ' || spatial.pixelsPerCell?.x !== 128 || spatial.pixelsPerCell?.y !== 128
      || spatial.framePixels?.width !== spatial.canvasCells.width * 128
      || spatial.framePixels?.height !== spatial.canvasCells.height * 128) {
      throw new Error(`Unsupported spatial coordinate contract: ${entry.entityId}`);
    }
    entry.package = path.basename(archive);
    entry.spriteOffset = {
      x: -spatial.footprintRectCells.left,
      y: spatial.footprintRectCells.top + spatial.footprintRectCells.height - spatial.canvasCells.height,
      width: spatial.canvasCells.width,
      height: spatial.canvasCells.height,
    };
    entry.sourceMetadata = { ...entry.sourceMetadata, spatial, package: packageData, sourceArchiveSha256: archiveSha256 };
    entry.sourceMetadata.publishedTransform = {
      operation: 'flip-top-bottom per frame',
      sourceImageAxisY: '+sourceZ',
      resultImageAxisY: '+projectY',
      coordinateRule: 'projectY = depth - 1 - sourceZ',
    };

    if (entry.animated) {
      const manifestPath = path.join(animationRoot, entry.spriteId, 'manifest.json');
      const manifest = await ensureAnimationManifest(entry, sourceTopPath, manifestPath);
      if (manifest.frameWidth !== spatial.framePixels.width || manifest.frameHeight !== spatial.framePixels.height) {
        throw new Error(`Animation and spatial dimensions differ: ${entry.entityId}`);
      }
      // AI-CORRECTION 2026-09-11: ensureAnimationManifest 已在读取每页布局时校验并同步真实时长。
      manifest.frameTransform = 'flip-top-bottom';
      manifest.coordinateTransform = 'projectY = depth - 1 - sourceZ';
      manifest.sourceArchiveSha256 = archiveSha256;
      await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
      for (const source of Object.values(manifest.sources)) {
        const sourcePage = path.join(sourceTopPath, source.sourcePath);
        if (!(await exists(sourcePage))) throw new Error(`Missing ZIP sheet: ${sourcePage}`);
        await mkdir(path.dirname(path.join(animationRoot, entry.spriteId, source.file)), { recursive: true });
        await writeFile(path.join(animationRoot, entry.spriteId, source.file), await readFile(sourcePage));
      }
    } else {
      const staticPhase = (await exists(path.join(sourceTopPath, 'animations', 'static', 'spritesheet.json')))
        ? 'static'
        : (await exists(path.join(sourceTopPath, 'animations', 'bind_pose', 'spritesheet.json')) ? 'bind_pose' : 'close_idle');
      const sheetMeta = await json(path.join(sourceTopPath, 'animations', staticPhase, 'spritesheet.json'));
      const page = path.join(sourceTopPath, 'animations', staticPhase, sheetMeta.pages[0].image ?? sheetMeta.pages[0].file);
      const bytes = await readFile(page);
      if (sheetMeta.cellWidth !== spatial.framePixels.width || sheetMeta.cellHeight !== spatial.framePixels.height
        || (sheetMeta.pages[0].sha256 && crypto.createHash('sha256').update(bytes).digest('hex') !== sheetMeta.pages[0].sha256)) {
        throw new Error(`Static frame differs from JSON: ${entry.entityId}`);
      }
      await mkdir(originalRoot, { recursive: true });
      await writeFile(path.join(originalRoot, `${entry.spriteId}.webp`), bytes);
      await publishDeviceSprite(
        path.join(originalRoot, `${entry.spriteId}.webp`),
        path.join(spriteRoot, `${entry.spriteId}.webp`),
        path.join(maskRoot, `${entry.spriteId}.webp`),
        path.join(projectRoot, 'resources', 'device-sprite-mask-overrides', `${entry.spriteId}.webp`),
        0,
        { frameTransform: 'flip-top-bottom', crop: { left: 0, top: 0, width: sheetMeta.cellWidth, height: sheetMeta.cellHeight } },
      );
    }
  }
  await writeFile(collectionPath, `${JSON.stringify(collection, null, 2)}\n`);
  if (process.argv.includes('--prepare-only')) {
    console.log(`Prepared ${entityFilter.size || collection.entries.length} building sources; animation publication deferred.`);
    return;
  }

  const { createRegistryContract } = await tsImport('../registry/index.ts', {
    parentURL: import.meta.url, tsconfig: path.join(projectRoot, 'tsconfig.app.json'),
  });
  const { publishPaginatedDeviceSpriteAnimations } = await import('./device-sprite-animation-publisher.mjs');
  const animationProtocol = await tsImport('../shared/device-sprite-animation.ts', {
    parentURL: import.meta.url, tsconfig: path.join(projectRoot, 'tsconfig.app.json'),
  });
  const selectedEntries = entityFilter.size > 0
    ? collection.entries.filter((entry) => entityFilter.has(entry.entityId))
    : collection.entries;
  const selectedSpriteIds = new Set(selectedEntries.filter((entry) => entry.animated).map((entry) => entry.spriteId));
  await publishPaginatedDeviceSpriteAnimations({
    definitions: createRegistryContract().entityDefinitions,
    spriteIds: selectedSpriteIds,
    sourceDirectory: animationRoot,
    spriteDirectory: spriteRoot,
    maskDirectory: maskRoot,
    animationDirectory: path.join(projectRoot, 'public', '3d-top-view', 'animations'),
    maskOverrideDirectory: path.join(projectRoot, 'resources', 'device-sprite-mask-overrides'),
    maxTextureSize: animationProtocol.DEVICE_SPRITE_ANIMATION_MAX_TEXTURE_SIZE,
    animationProtocol,
    readRegistryAnimationDefinitions: async () => createRegistryContract().entityDefinitions,
    // AI-REMOVED 2026-09-11: 禁止绕过 Registry 动画声明校验；仅准备源文件可使用 --prepare-only。
    // Trigger: 资源准备与 Registry 显示声明待授权的状态需要区分。
    // Evidence: 发布器本身严格拒绝未声明的动画源目录。
    // Replacement: 默认 Registry 校验；Risk: Low; Human Review: Required
    // Original code:
    // allowUnregisteredSourceIds: new Set([...selectedSpriteIds].filter((spriteId) => !createRegistryContract().entityDefinitions.some((definition) => definition.spriteId === spriteId))),
  });
  console.log(`Imported ${selectedEntries.length} mapped buildings from ${path.basename(archive)} (${archiveSha256}).`);
}

async function main() {
  const positional = process.argv.slice(2).filter((argument) => !argument.startsWith('--'));
  const archive = path.resolve(positional[0] ?? defaultArchive);
  await mkdir(path.join(projectRoot, '.temp', '.trash'), { recursive: true });
  const extractionParent = await mkdtemp(path.join(projectRoot, '.temp', '.trash', 'luna-assets-run-'));
  const extractedRoot = path.join(extractionParent, 'assets', 'buildings');
  try {
    await promisify(execFile)('python3', ['-c', [
      'import sys, zipfile',
      'archive, target = sys.argv[1:]',
      'with zipfile.ZipFile(archive) as z:',
      '    bad = z.testzip()',
      '    if bad: raise SystemExit("corrupt zip member: " + bad)',
      '    z.extractall(target)',
    ].join('\n'), archive, extractionParent]);
    await runImport(archive, extractedRoot);
  } finally {
    sharp.cache(false);
    await rm(extractionParent, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => { console.error(error); process.exitCode = 1; });
}
