import {
  access,
  copyFile,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rename,
  rm,
  writeFile,
} from 'node:fs/promises';
import path from 'node:path';

import sharp from 'sharp';

function requireRecord(value, label) {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error(`${label} must be an object`);
  }
  return value;
}

function requirePositiveInteger(value, label) {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new Error(`${label} must be a positive safe integer`);
  }
  return value;
}

function requireSourceName(value, label) {
  if (typeof value !== 'string' || !/^[a-zA-Z0-9_-]+$/.test(value)) {
    throw new Error(`${label} must be a safe source name`);
  }
  return value;
}

function requireWebpFile(value, label) {
  if (typeof value !== 'string' || !/^[a-zA-Z0-9_-]+\.webp$/.test(value)) {
    throw new Error(`${label} must be a local WebP file name`);
  }
  return value;
}

function createMaskBuffer(rgba, width, height) {
  const output = Buffer.alloc(width * height * 4);
  for (let pixel = 0; pixel < width * height; pixel += 1) {
    const alpha = rgba[pixel * 4 + 3];
    output[pixel * 4] = alpha;
    output[pixel * 4 + 1] = alpha;
    output[pixel * 4 + 2] = alpha;
    output[pixel * 4 + 3] = 255;
  }
  return output;
}

async function fileExists(filePath) {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function readSourceManifest(sourceRoot, phases, maxTextureSize) {
  const manifestPath = path.join(sourceRoot, 'manifest.json');
  const source = requireRecord(JSON.parse(await readFile(manifestPath, 'utf8')), 'source manifest');
  if (source.schemaVersion !== 1) {
    throw new Error('source manifest.schemaVersion must be 1');
  }
  const frameWidth = requirePositiveInteger(source.frameWidth, 'source manifest.frameWidth');
  const frameHeight = requirePositiveInteger(source.frameHeight, 'source manifest.frameHeight');
  const pageRows = requirePositiveInteger(source.pageRows, 'source manifest.pageRows');
  const pageColumns = requirePositiveInteger(source.pageColumns, 'source manifest.pageColumns');
  if (frameWidth * pageColumns >= maxTextureSize || frameHeight * pageRows >= maxTextureSize) {
    throw new Error(`generated pages must be smaller than the texture limit ${maxTextureSize}`);
  }
  if (typeof source.fps !== 'number' || !Number.isFinite(source.fps) || source.fps <= 0) {
    throw new Error('source manifest.fps must be finite and positive');
  }
  const sourceDefinitions = requireRecord(source.sources, 'source manifest.sources');
  const sources = new Map();
  for (const [name, sourceValue] of Object.entries(sourceDefinitions)) {
    requireSourceName(name, `sources.${name}`);
    const sourceDefinition = requireRecord(sourceValue, `sources.${name}`);
    const rows = requirePositiveInteger(sourceDefinition.rows, `sources.${name}.rows`);
    const columns = requirePositiveInteger(sourceDefinition.columns, `sources.${name}.columns`);
    const frameCount = requirePositiveInteger(sourceDefinition.frameCount, `sources.${name}.frameCount`);
    if (frameCount > rows * columns) {
      throw new Error(`sources.${name}.frameCount exceeds its grid capacity`);
    }
    sources.set(name, Object.freeze({
      name,
      file: requireWebpFile(sourceDefinition.file, `sources.${name}.file`),
      rows,
      columns,
      frameCount,
    }));
  }
  const clipDefinitions = requireRecord(source.clips, 'source manifest.clips');
  const clips = {};
  for (const phase of phases) {
    const ranges = clipDefinitions[phase];
    if (!Array.isArray(ranges) || ranges.length === 0) {
      throw new Error(`source manifest.clips.${phase} must be a non-empty array`);
    }
    clips[phase] = Object.freeze(ranges.map((rangeValue, rangeIndex) => {
      const range = requireRecord(rangeValue, `clips.${phase}[${rangeIndex}]`);
      const sourceName = requireSourceName(range.source, `clips.${phase}[${rangeIndex}].source`);
      const sourceDefinition = sources.get(sourceName);
      if (sourceDefinition === undefined) {
        throw new Error(`clips.${phase}[${rangeIndex}] references an unknown source`);
      }
      const startFrame = Number.isSafeInteger(range.startFrame) && range.startFrame >= 0
        ? range.startFrame
        : -1;
      const frameCount = requirePositiveInteger(range.frameCount, `clips.${phase}[${rangeIndex}].frameCount`);
      if (startFrame < 0 || startFrame + frameCount > sourceDefinition.frameCount) {
        throw new Error(`clips.${phase}[${rangeIndex}] exceeds its source frame range`);
      }
      return Object.freeze({ source: sourceName, startFrame, frameCount });
    }));
  }
  return Object.freeze({
    frameWidth,
    frameHeight,
    pageRows,
    pageColumns,
    frameDurationMs: 1000 / source.fps,
    sources,
    clips: Object.freeze(clips),
  });
}

function createOutputPlan(sourceManifest, phases) {
  const pagesByPhase = {};
  const mappingsBySource = new Map([...sourceManifest.sources.keys()].map((name) => [name, []]));
  for (const phase of phases) {
    const logicalFrames = sourceManifest.clips[phase].flatMap((range) => (
      Array.from({ length: range.frameCount }, (_, offset) => ({
        source: range.source,
        sourceFrameIndex: range.startFrame + offset,
      }))
    ));
    const pages = [];
    const maximumCapacity = sourceManifest.pageRows * sourceManifest.pageColumns;
    for (let firstFrameIndex = 0; firstFrameIndex < logicalFrames.length; firstFrameIndex += maximumCapacity) {
      const frameCount = Math.min(maximumCapacity, logicalFrames.length - firstFrameIndex);
      const columns = Math.min(sourceManifest.pageColumns, frameCount);
      const rows = Math.ceil(frameCount / columns);
      const pageIndex = pages.length;
      const page = {
        phase,
        pageIndex,
        file: `${phase}-${pageIndex}.webp`,
        firstFrameIndex,
        frameCount,
        rows,
        columns,
        filledFrames: 0,
        buffer: null,
      };
      pages.push(page);
      for (let localFrameIndex = 0; localFrameIndex < frameCount; localFrameIndex += 1) {
        const frame = logicalFrames[firstFrameIndex + localFrameIndex];
        mappingsBySource.get(frame.source).push({ page, localFrameIndex, sourceFrameIndex: frame.sourceFrameIndex });
      }
    }
    pagesByPhase[phase] = pages;
  }
  return { pagesByPhase, mappingsBySource };
}

function copyFrameToPage(sourceData, sourceWidth, sourceFrameIndex, sourceColumns, page, localFrameIndex, frameWidth, frameHeight) {
  page.buffer ??= Buffer.alloc(page.columns * frameWidth * page.rows * frameHeight * 4);
  const sourceLeft = (sourceFrameIndex % sourceColumns) * frameWidth;
  const sourceTop = Math.floor(sourceFrameIndex / sourceColumns) * frameHeight;
  const targetLeft = (localFrameIndex % page.columns) * frameWidth;
  const targetTop = Math.floor(localFrameIndex / page.columns) * frameHeight;
  const sourceStride = sourceWidth * 4;
  const targetStride = page.columns * frameWidth * 4;
  const rowBytes = frameWidth * 4;
  for (let y = 0; y < frameHeight; y += 1) {
    const sourceOffset = (sourceTop + y) * sourceStride + sourceLeft * 4;
    const targetOffset = (targetTop + y) * targetStride + targetLeft * 4;
    sourceData.copy(page.buffer, targetOffset, sourceOffset, sourceOffset + rowBytes);
  }
  page.filledFrames += 1;
  return { sourceLeft, sourceTop };
}

function mergeFrameAlpha(sourceData, sourceWidth, sourceLeft, sourceTop, unionAlpha, frameWidth, frameHeight) {
  let hasTransparentPixel = false;
  let hasVisiblePixel = false;
  for (let y = 0; y < frameHeight; y += 1) {
    let sourceOffset = ((sourceTop + y) * sourceWidth + sourceLeft) * 4 + 3;
    let targetOffset = y * frameWidth;
    for (let x = 0; x < frameWidth; x += 1) {
      const alpha = sourceData[sourceOffset];
      if (alpha > unionAlpha[targetOffset]) {
        unionAlpha[targetOffset] = alpha;
      }
      hasTransparentPixel ||= alpha < 255;
      hasVisiblePixel ||= alpha > 0;
      sourceOffset += 4;
      targetOffset += 1;
    }
  }
  return { hasTransparentPixel, hasVisiblePixel };
}

function assertUnusedSourceCellsTransparent(
  spriteId,
  sourceDefinition,
  sourceData,
  sourceWidth,
  frameWidth,
  frameHeight,
) {
  const capacity = sourceDefinition.rows * sourceDefinition.columns;
  for (let frameIndex = sourceDefinition.frameCount; frameIndex < capacity; frameIndex += 1) {
    const left = (frameIndex % sourceDefinition.columns) * frameWidth;
    const top = Math.floor(frameIndex / sourceDefinition.columns) * frameHeight;
    for (let y = 0; y < frameHeight; y += 1) {
      let alphaOffset = ((top + y) * sourceWidth + left) * 4 + 3;
      for (let x = 0; x < frameWidth; x += 1) {
        if (sourceData[alphaOffset] !== 0) {
          throw new Error(
            `${spriteId}/${sourceDefinition.file} trailing cell ${frameIndex} must be transparent`,
          );
        }
        alphaOffset += 4;
      }
    }
  }
}

function extractFrame(sourceData, sourceWidth, sourceLeft, sourceTop, frameWidth, frameHeight) {
  const frame = Buffer.alloc(frameWidth * frameHeight * 4);
  const sourceStride = sourceWidth * 4;
  const rowBytes = frameWidth * 4;
  for (let y = 0; y < frameHeight; y += 1) {
    const sourceOffset = (sourceTop + y) * sourceStride + sourceLeft * 4;
    sourceData.copy(frame, y * rowBytes, sourceOffset, sourceOffset + rowBytes);
  }
  return frame;
}

async function encodeCompletedPage(page, outputDirectory, frameWidth, frameHeight) {
  if (page.buffer === null || page.filledFrames !== page.frameCount) {
    return;
  }
  await sharp(page.buffer, {
    raw: {
      width: page.columns * frameWidth,
      height: page.rows * frameHeight,
      channels: 4,
    },
  }).webp({ quality: 85, alphaQuality: 100, effort: 4 }).toFile(path.join(outputDirectory, page.file));
  page.buffer = null;
}

async function publishOneAnimation({
  spriteId,
  sourceDirectory,
  spriteDirectory,
  maskDirectory,
  animationDirectory,
  maskOverrideDirectory,
  maxTextureSize,
  phases,
  registryDefinition,
  normalizeDeviceSpriteAnimationDefinition,
}) {
  if (await fileExists(path.join(maskOverrideDirectory, `${spriteId}.webp`))) {
    throw new Error(`Animation ${spriteId} has an existing mask override; resolve it before publishing`);
  }
  const sourceRoot = path.join(sourceDirectory, spriteId);
  const sourceManifest = await readSourceManifest(sourceRoot, phases, maxTextureSize);
  const { pagesByPhase, mappingsBySource } = createOutputPlan(sourceManifest, phases);
  const stagingRootParent = path.resolve('.temp/.trash');
  await mkdir(stagingRootParent, { recursive: true });
  const stagingRoot = await mkdtemp(path.join(stagingRootParent, `device-animation-${spriteId}-`));
  const stagingAnimationDirectory = path.join(stagingRoot, 'animation');
  await mkdir(stagingAnimationDirectory, { recursive: true });
  const unionAlpha = Buffer.alloc(sourceManifest.frameWidth * sourceManifest.frameHeight);
  let firstFrame = null;

  try {
    for (const sourceDefinition of sourceManifest.sources.values()) {
      const sourceFile = path.join(sourceRoot, sourceDefinition.file);
      const metadata = await sharp(sourceFile).metadata();
      const expectedWidth = sourceDefinition.columns * sourceManifest.frameWidth;
      const expectedHeight = sourceDefinition.rows * sourceManifest.frameHeight;
      if (metadata.format !== 'webp' || (metadata.pages ?? 1) !== 1) {
        throw new Error(`${spriteId}/${sourceDefinition.file} must be a static WebP`);
      }
      if (metadata.width !== expectedWidth || metadata.height !== expectedHeight) {
        throw new Error(`${spriteId}/${sourceDefinition.file} dimensions differ from its source grid`);
      }
      if (!metadata.hasAlpha) {
        throw new Error(`${spriteId}/${sourceDefinition.file} must have Alpha`);
      }
      const { data, info } = await sharp(sourceFile).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
      if (info.channels !== 4) {
        throw new Error(`${spriteId}/${sourceDefinition.file} must decode to RGBA`);
      }
      assertUnusedSourceCellsTransparent(
        spriteId,
        sourceDefinition,
        data,
        info.width,
        sourceManifest.frameWidth,
        sourceManifest.frameHeight,
      );
      for (const mapping of mappingsBySource.get(sourceDefinition.name)) {
        const { sourceLeft, sourceTop } = copyFrameToPage(
          data,
          info.width,
          mapping.sourceFrameIndex,
          sourceDefinition.columns,
          mapping.page,
          mapping.localFrameIndex,
          sourceManifest.frameWidth,
          sourceManifest.frameHeight,
        );
        const alphaCoverage = mergeFrameAlpha(
          data,
          info.width,
          sourceLeft,
          sourceTop,
          unionAlpha,
          sourceManifest.frameWidth,
          sourceManifest.frameHeight,
        );
        if (!alphaCoverage.hasTransparentPixel || !alphaCoverage.hasVisiblePixel) {
          throw new Error(
            `${spriteId}/${sourceDefinition.file} frame ${mapping.sourceFrameIndex}`
              + ' needs a transparent background and visible content',
          );
        }
        if (mapping.page.phase === 'open' && mapping.page.firstFrameIndex === 0 && mapping.localFrameIndex === 0) {
          firstFrame = extractFrame(
            data,
            info.width,
            sourceLeft,
            sourceTop,
            sourceManifest.frameWidth,
            sourceManifest.frameHeight,
          );
        }
        await encodeCompletedPage(
          mapping.page,
          stagingAnimationDirectory,
          sourceManifest.frameWidth,
          sourceManifest.frameHeight,
        );
      }
    }
    if (firstFrame === null) {
      throw new Error(`Animation ${spriteId} has no logical open first frame`);
    }
    for (const phase of phases) {
      for (const page of pagesByPhase[phase]) {
        if (page.buffer !== null || page.filledFrames !== page.frameCount) {
          throw new Error(`Animation ${spriteId}/${page.file} was not fully assembled`);
        }
      }
    }
    const unionRgba = Buffer.alloc(sourceManifest.frameWidth * sourceManifest.frameHeight * 4);
    for (let pixel = 0; pixel < unionAlpha.length; pixel += 1) {
      unionRgba[pixel * 4 + 3] = unionAlpha[pixel];
    }
    const raw = { width: sourceManifest.frameWidth, height: sourceManifest.frameHeight, channels: 4 };
    const stagingStatic = path.join(stagingRoot, 'static.webp');
    const stagingStaticMask = path.join(stagingRoot, 'static-mask.webp');
    await sharp(firstFrame, { raw }).webp({ lossless: true, effort: 6 }).toFile(stagingStatic);
    await sharp(createMaskBuffer(firstFrame, raw.width, raw.height), { raw })
      .webp({ lossless: true, effort: 6 }).toFile(stagingStaticMask);
    await sharp(createMaskBuffer(unionRgba, raw.width, raw.height), { raw })
      .webp({ lossless: true, effort: 6 }).toFile(path.join(stagingAnimationDirectory, 'mask.webp'));
    const outputManifest = {
      schemaVersion: 1,
      frameWidth: sourceManifest.frameWidth,
      frameHeight: sourceManifest.frameHeight,
      maskFile: 'mask.webp',
      clips: Object.fromEntries(phases.map((phase) => [phase, {
        frameDurationMs: sourceManifest.frameDurationMs,
        frameCount: pagesByPhase[phase].reduce((total, page) => total + page.frameCount, 0),
        pages: pagesByPhase[phase].map((page) => ({
          file: page.file,
          rows: page.rows,
          columns: page.columns,
          frameCount: page.frameCount,
        })),
      }])),
    };
    normalizeDeviceSpriteAnimationDefinition(registryDefinition, outputManifest);
    await writeFile(
      path.join(stagingAnimationDirectory, 'manifest.json'),
      `${JSON.stringify(outputManifest, null, 2)}\n`,
      'utf8',
    );
    const outputDirectory = path.join(animationDirectory, spriteId);
    await Promise.all([
      mkdir(spriteDirectory, { recursive: true }),
      mkdir(maskDirectory, { recursive: true }),
      mkdir(animationDirectory, { recursive: true }),
    ]);
    await rm(outputDirectory, { recursive: true, force: true });
    await rename(stagingAnimationDirectory, outputDirectory);
    await copyFile(stagingStatic, path.join(spriteDirectory, `${spriteId}.webp`));
    await copyFile(stagingStaticMask, path.join(maskDirectory, `${spriteId}.webp`));
    return {
      spriteId,
      frameWidth: sourceManifest.frameWidth,
      frameHeight: sourceManifest.frameHeight,
      pageCount: phases.reduce((total, phase) => total + pagesByPhase[phase].length, 0),
    };
  } finally {
    await rm(stagingRoot, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
  }
}

export async function publishPaginatedDeviceSpriteAnimations({
  definitions,
  sourceDirectory,
  spriteDirectory,
  maskDirectory,
  animationDirectory,
  maskOverrideDirectory,
  maxTextureSize,
  animationProtocol,
  readRegistryAnimationDefinitions,
}) {
  const {
    DEVICE_SPRITE_ANIMATION_PHASES: phases,
    getDeviceSpriteAnimationSignature,
    normalizeDeviceSpriteAnimationDefinition,
    validateDeviceSpriteAnimationId,
  } = animationProtocol;
  const bySpriteId = new Map();
  for (const entity of definitions ?? await readRegistryAnimationDefinitions()) {
    if (entity.spriteAnimation === undefined) continue;
    validateDeviceSpriteAnimationId(entity.spriteId);
    const signature = getDeviceSpriteAnimationSignature(entity.spriteAnimation);
    const previous = bySpriteId.get(entity.spriteId);
    if (previous && previous.signature !== signature) {
      throw new Error(`Conflicting animation definitions for ${entity.spriteId}`);
    }
    bySpriteId.set(entity.spriteId, {
      registryDefinition: entity.spriteAnimation,
      signature,
    });
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
  for (const [spriteId, { registryDefinition }] of bySpriteId) {
    results.push(await publishOneAnimation({
      spriteId,
      sourceDirectory,
      spriteDirectory,
      maskDirectory,
      animationDirectory,
      maskOverrideDirectory,
      maxTextureSize,
      phases,
      registryDefinition,
      normalizeDeviceSpriteAnimationDefinition,
    }));
  }
  return results;
}
