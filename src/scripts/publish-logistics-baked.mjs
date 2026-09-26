import { createHash } from 'node:crypto';
import { copyFile, mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { gzipSync } from 'node:zlib';
import sharp from 'sharp';
import { publishedImageSize, resizeAssetRgba, resolveAssetScale } from './building-asset-image.mjs';
import { compositeLogisticsLayers, publishAtlas } from './publish-logistics-materials.mjs';

const digest = (value) => createHash('sha256').update(value).digest('hex');
const save = (file, value) => writeFile(file, `${JSON.stringify(value, null, 2)}\n`);

/** 逐帧恢复源画布后缩放、裁切并重排；不同帧之间不参与滤波。数值场保留原始通道。 */
export async function publishLogisticsBaked({ sourceDirectory, outputDirectory, spriteDirectory, maskDirectory,
  sourceResolution = 1, resolution, sourceSite, fluidPlaybackDirectory }) {
  const source = JSON.parse(await readFile(path.join(sourceDirectory, 'logistics-baked.json'), 'utf8'));
  if (source.schemaVersion !== 2 || source.format !== 'logistics-spritesheet-v2'
    || source.fluidPlayback?.kind !== 'baked-spatial-field-v2' || source.pixelsPerCell !== 128
    || source.textureProfile?.resolution !== sourceResolution) {
    throw new Error('Unsupported baked logistics protocol');
  }
  const scale = resolveAssetScale(sourceResolution, resolution);
  const size = publishedImageSize(128, 128, resolution).width;
  const directory = path.join(outputDirectory, 'baked');
  const staticDirectory = path.join(outputDirectory, 'static');
  for (const folder of [directory, staticDirectory, spriteDirectory, maskDirectory]) await mkdir(folder, { recursive: true });
  const manifest = {
    schemaVersion: 2, format: source.format, sourceResolution, resolution, pixelsPerCell: size, sourceSite,
    pages: {}, frames: {}, clips: source.clips,
    tintableConveyor: source.tintableConveyor,
    sceneTransmission: source.sceneTransmission && {
      glassLinearRGB: source.sceneTransmission.glassLinearRGB,
      reflectionEncodingScale: source.sceneTransmission.reflectionEncodingScale,
    },
    staticResources: Object.fromEntries(Object.entries(source.staticResources).map(([key, resource]) => [key, resource.frame])),
    parametersByResourceId: Object.fromEntries(Object.entries(source.parametersByResourceId)
      .map(([key, value]) => [key, Object.fromEntries(Object.entries(value).filter(([, v]) => typeof v === 'number'))])),
    // AI-REMOVED 2026-09-14:
    // Reason: baked 资源清单不再复制物品流体配色。
    // Trigger: 用户要求 ItemDefinition.fluidColors 成为唯一运行时颜色来源。
    // Evidence: 独立美术表覆盖 20 项，而当前 baked manifest 仅有 2 项，版本绑定已导致事实分裂。
    // Replacement: Registry item-definition.ts 中的 fluidColors；本发布器只处理物流纹理协议。
    // Risk: Low
    // Human Review: Required
    // Original code:
    // fluidProfiles: Object.fromEntries(Object.entries(source.fluidProfiles).map(([id, profile]) => [id, {
    //   phase: profile.phase,
    //   colors: Object.fromEntries(['body', 'skin', 'skin2', 'splash'].map((role) => [role, (profile.colors[role] ?? profile.colors.skin).hex])),
    // }])),
    cycle: source.cycle,
    // 只提取播放器使用的协议，原始含大整数的来源元数据留在 resources 原件中。
    fluidPlayback: { referenceShader: source.fluidPlayback.referenceShader },
    endpointConnector: { composite: source.endpointConnector.composite, whitening: source.endpointConnector.whitening },
  };
  const cargoDirectory = path.join(sourceDirectory, 'composite_cube_1_001_01/top/static');
  const cargoSource = JSON.parse(await readFile(path.join(cargoDirectory, 'manifest.json'), 'utf8'));
  const cargo = cargoSource.cargo;
  const cargoResource = cargoSource.resources?.[cargo?.resource];
  if (cargo?.resource !== 'static/cargo.empty-box' || cargoSource.textureProfile?.resolution !== sourceResolution
    || cargoResource?.file !== 'cargo-empty-box.webp' || cargoResource.resolution !== sourceResolution
    || cargoResource.width !== 128 * sourceResolution || cargoResource.height !== 128 * sourceResolution
    || cargo.visibleFootprintCells?.[0] !== 0.5 || cargo.visibleFootprintCells?.[1] !== 0.5
    || cargo.itemIconBaked !== false) throw new Error('Unsupported cargo box delivery');
  const cargoBytes = await readFile(path.join(cargoDirectory, cargoResource.file));
  if (digest(cargoBytes) !== cargoResource.sha256) throw new Error('Cargo box source hash differs');
  const cargoDecoded = await sharp(cargoBytes).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  if (cargoDecoded.info.width !== cargoResource.width || cargoDecoded.info.height !== cargoResource.height) {
    throw new Error('Cargo box source dimensions differ');
  }
  const cargoOutputDirectory = path.join(outputDirectory, 'cargo');
  await mkdir(cargoOutputDirectory, { recursive: true });
  const cargoOutputBytes = scale === 1 ? cargoBytes : await (async () => {
    const resized = await resizeAssetRgba(cargoDecoded.data, cargoDecoded.info.width, cargoDecoded.info.height, scale);
    return sharp(resized.data, { raw: { width: resized.width, height: resized.height, channels: 4 } })
      .webp({ lossless: true }).toBuffer();
  })();
  await writeFile(path.join(cargoOutputDirectory, 'empty-box.webp'), cargoOutputBytes);
  manifest.cargoBox = { file: 'cargo/empty-box.webp', width: 128 * resolution, height: 128 * resolution,
    visibleFootprintCells: cargo.visibleFootprintCells, sha256: digest(cargoOutputBytes) };
  // 当前播放器只支持双数值场。液体资源和 Shader 作为一个完整协议保留，不能混入新版 water-field。
  const retainFluid = source.fluidPlayback.referenceShader.fragment.includes('uWater');
  if (retainFluid) {
    if (!fluidPlaybackDirectory) throw new Error('The water-field player requires an explicit supported fluid baseline');
    const previous = JSON.parse(await readFile(path.join(fluidPlaybackDirectory, 'manifest.json'), 'utf8'));
    if (previous.resolution !== resolution || previous.fluidPlayback.referenceShader.fragment.includes('uWater')) {
      throw new Error('Unsupported retained fluid baseline');
    }
    manifest.fluidPlayback = previous.fluidPlayback;
    manifest.cycle = previous.cycle;
    manifest.fluidSourceSite = previous.fluidSourceSite ?? previous.sourceSite;
    for (const id of ['fluid-data', 'gas-field']) {
      const page = previous.pages[id];
      if (!page?.data || path.basename(page.file) !== page.file) throw new Error(`Invalid fluid baseline: ${id}`);
      const bytes = await readFile(path.join(fluidPlaybackDirectory, page.file));
      if (digest(bytes) !== page.sha256) throw new Error(`Fluid baseline hash differs: ${id}`);
      await writeFile(path.join(directory, page.file), bytes);
      manifest.pages[id] = page;
    }
  }
  for (const key of ['fillCellsPerSecond', 'drainDuration', 'refillDuration', 'edgeWidth']) {
    if (!(manifest.cycle[key] > 0)) throw new Error(`Invalid fluid timing: ${key}`);
  }
  const originals = new Map();
  for (const [id, page] of Object.entries(source.pages)) {
    if (retainFluid && page.group === 'fluid-field') continue;
    const file = path.resolve(sourceDirectory, page.file);
    if (!file.startsWith(`${path.resolve(sourceDirectory)}${path.sep}`)) throw new Error(`Unsafe baked source: ${page.file}`);
    const bytes = await readFile(file);
    if (digest(bytes) !== page.sha256 || bytes.length !== page.bytes) throw new Error(`Baked source hash differs: ${id}`);
    const decoded = await sharp(bytes).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    if (decoded.info.width !== page.width || decoded.info.height !== page.height) throw new Error(`Baked source dimensions differ: ${id}`);
    if (page.group === 'fluid-field') {
      const scaled = await resizeAssetRgba(decoded.data, page.width, page.height, scale, true);
      const encoded = gzipSync(scaled.data);
      const target = `${id}-${digest(encoded).slice(0, 16)}.rgba.bin`;
      await writeFile(path.join(directory, target), encoded);
      manifest.pages[id] = { file: target, width: scaled.width, height: scaled.height, data: true,
        filter: page.filter ?? 'linear', sha256: digest(encoded) };
    } else {
      let outputBytes = bytes;
      let width = page.width, height = page.height;
      if (scale !== 1) {
        const scaled = await resizeAssetRgba(decoded.data, page.width, page.height, scale);
        width = scaled.width; height = scaled.height;
        outputBytes = await sharp(scaled.data, { raw: { width, height, channels: 4 } }).webp({ lossless: true }).toBuffer();
      }
      const target = `${id}-${digest(outputBytes).slice(0, 16)}.webp`;
      if (scale === 1) await copyFile(file, path.join(directory, target));
      else await writeFile(path.join(directory, target), outputBytes);
      manifest.pages[id] = { file: target, width, height, data: false,
        filter: page.filter ?? 'linear', sha256: digest(outputBytes) };
      originals.set(id, decoded);
    }
  }
  const fullFrames = new Map();
  const requiredFrames = new Set(Object.values(manifest.clips).flatMap((clip) => [...clip.frames, ...(clip.tintFrames ?? [])]));
  for (const frame of Object.values(manifest.staticResources)) requiredFrames.add(frame);
  manifest.staticResources = Object.fromEntries(Object.entries(manifest.staticResources).filter(([, frame]) => source.frames[frame]));
  for (const [key, frame] of Object.entries(source.frames)) {
    // 原始 pattern/chevron 长图已烘焙为相位帧，运行时不再加载这两个未消费的原贴图。
    // AI-CORRECTION 2026-09-20: 新版移除直管 pattern clip，并直接交付 64px 物理图集；这里只保留清单引用帧。
    if (!requiredFrames.has(key)) continue;
    const original = originals.get(frame.page);
    const [x, y, width, height] = frame.physicalRect ?? [];
    const [left, top, trimWidth, trimHeight] = frame.spriteSourceSize;
    const sourceWidth = frame.sourceSize[0] * sourceResolution;
    const sourceHeight = frame.sourceSize[1] * sourceResolution;
    if (!original || frame.rotated || ![sourceWidth, sourceHeight].every(Number.isSafeInteger)
      || ![x, y, width, height, left, top, trimWidth, trimHeight].every(Number.isFinite)
      || x < 0 || y < 0 || width <= 0 || height <= 0
      || x + width > original.info.width || y + height > original.info.height) {
      throw new Error(`Invalid baked frame: ${key}`);
    }
    manifest.frames[key] = {
      page: frame.page,
      rect: [x * scale, y * scale, width * scale, height * scale],
      sourceSize: frame.sourceSize.map((value) => value * resolution),
      spriteSourceSize: frame.spriteSourceSize.map((value) => value * resolution),
    };
    if (!key.startsWith('static/') || sourceWidth !== 128 * sourceResolution || sourceHeight !== 128 * sourceResolution) continue;
    const full = Buffer.alloc(sourceWidth * sourceHeight * 4);
    const sourceLeft = Math.ceil(x), sourceTop = Math.ceil(y);
    const sourceRight = Math.floor(x + width), sourceBottom = Math.floor(y + height);
    const targetLeft = Math.ceil(left * sourceResolution), targetTop = Math.ceil(top * sourceResolution);
    const copyWidth = Math.min(sourceRight - sourceLeft, sourceWidth - targetLeft);
    const copyHeight = Math.min(sourceBottom - sourceTop, sourceHeight - targetTop);
    if (copyWidth <= 0 || copyHeight <= 0) throw new Error(`Baked frame has no safe physical interior: ${key}`);
    for (let row = 0; row < copyHeight; row++) {
      const offset = ((sourceTop + row) * original.info.width + sourceLeft) * 4;
      original.data.copy(full, ((targetTop + row) * sourceWidth + targetLeft) * 4, offset, offset + copyWidth * 4);
    }
    // 裁切向外覆盖采样核边缘，保持原画布/pivot，不能将窄帧拉伸为整格。
    // AI-CORRECTION 2026-09-20: 直接保留网站图集与 physicalRect；静态回退只安全复制完整归属像素。
    fullFrames.set(key, full);
  }
  for (const [key, clip] of Object.entries(manifest.clips)) {
    if (clip.phaseSamples !== clip.frames.length || clip.frames.some((frame) => !manifest.frames[frame])) throw new Error(`Incomplete phase clip: ${key}`);
    if (clip.tintFrames && (clip.tintFrames.length !== clip.phaseSamples || clip.tintFrames.some((frame) => !manifest.frames[frame]))) {
      throw new Error(`Incomplete tint phase clip: ${key}`);
    }
  }
  if (source.tintableConveyor) await publishInteractionMasks(directory, manifest, fullFrames, 128 * sourceResolution);
  await save(path.join(directory, 'manifest.json'), manifest);
  const statics = { schemaVersion: 1, materialContractVersion: 2, pixelsPerCell: size, pages: {}, frames: {}, sourceSite };
  const get = (key) => {
    const pixels = fullFrames.get(`static/${key}`);
    if (!pixels) throw new Error(`Missing baked static layer: ${key}`);
    return pixels;
  };
  const entries = [];
  const defaults = [];
  for (const shape of ['straight', 'left', 'right']) {
    entries.push([`belt/${shape}`, get(`conveyor.${shape}.static`)]);
    defaults.push(['belt', shape, get(`conveyor.${shape}.static`)]);
    for (const support of [false, true]) for (const marker of [false, true]) {
      const layers = [];
      const push = (suffix) => layers.push({ pixels: get(`pipe.${shape}.${suffix}`) });
      if (support) push('support-back');
      if (support) push('support-middle');
      push('shell');
      if (marker) push('static-chevron');
      if (marker && shape === 'straight') push('static-logo-glow');
      if (marker && shape === 'straight') push('static-logo-core');
      if (support) push('support-front');
      const pixels = compositeLogisticsLayers(layers);
      entries.push([`pipe/empty/${shape}/${Number(support)}${Number(marker)}`, pixels]);
      if (support && marker) defaults.push(['pipe', shape, pixels]);
    }
  }
  entries.push(['belt/straight-base', get('conveyor.straight.base')]);
  await publishAtlas(staticDirectory, 'baked-static', entries, statics, resolution, sourceResolution);
  await save(path.join(staticDirectory, 'manifest.json'), statics);
  for (const [kind, shape, pixels] of defaults) {
    const rotation = shape === 'straight' ? 270 : shape === 'left' ? 90 : 0;
    const image = await sharp(pixels, { raw: { width: size, height: size, channels: 4 } }).rotate(rotation).raw().toBuffer();
    const scaled = await resizeAssetRgba(image, size, size, scale);
    const file = `${kind}_${shape === 'straight' ? 'straight' : shape === 'left' ? 'turn_cw' : 'turn_ccw'}_1x1.webp`;
    await sharp(scaled.data, { raw: { width: size, height: size, channels: 4 } }).webp({ lossless: true }).toFile(path.join(spriteDirectory, file));
    const mask = Buffer.from(scaled.data);
    for (let i = 0; i < mask.length; i += 4) { mask[i] = mask[i + 1] = mask[i + 2] = 255; mask[i + 3] = mask[i + 3] > 0 ? 255 : 0; }
    await sharp(mask, { raw: { width: size, height: size, channels: 4 } }).webp({ lossless: true }).toFile(path.join(maskDirectory, file));
  }
  return { frames: Object.keys(manifest.frames).length, pages: Object.keys(manifest.pages).length, resolution };
}

/** 状态纹理只在发布时生成；运行时与物流标记一样走普通 Sprite 批次。 */
async function publishInteractionMasks(directory, manifest, fullFrames, size) {
  const effects = ['hover', 'connectable', 'selected', 'preview', 'belt-connectable'];
  const width = size * effects.length, height = size * 3;
  const pixels = Buffer.alloc(width * height * 4);
  for (const [row, shape] of ['straight', 'left', 'right'].entries()) {
    const pipeMask = fullFrames.get(`static/pipe.${shape}.body-mask`);
    const beltMask = fullFrames.get(`static/conveyor.${shape}.surface-tint`);
    if (!pipeMask || !beltMask) throw new Error(`Missing interaction mask: ${shape}`);
    for (const [column, effect] of effects.entries()) {
      const mask = effect === 'belt-connectable' ? beltMask : pipeMask;
      for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
        const offset = ((row * size + y) * width + column * size + x) * 4;
        const coverage = mask[(y * size + x) * 4 + 3] / 255;
        // 整数散列给出稳定颗粒；斜纹和细网纹均限定在真实管身/带面覆盖内。
        const noise = ((x * 73 + y * 151 + x * y * 19) % 101) / 100;
        const alpha = effect === 'hover' ? ((x + y) % 6 < 2 ? .94 : .32)
          : effect === 'connectable' ? ((x + y) % 6 < 3 ? .96 : .63)
          : effect === 'belt-connectable' ? ((x + y) % 3 === 0 ? .38 : .07)
          : .36 + noise * .48;
        pixels[offset] = pixels[offset + 1] = pixels[offset + 2] = 255;
        pixels[offset + 3] = Math.round(255 * coverage * alpha);
      }
      const key = `ui/${effect}/${shape}`;
      const targetSize = manifest.pixelsPerCell;
      manifest.frames[key] = { page: 'interaction', rect: [column * targetSize, row * targetSize, targetSize, targetSize],
        sourceSize: [targetSize, targetSize], spriteSourceSize: [0, 0, targetSize, targetSize] };
    }
  }
  const scaled = await resizeAssetRgba(pixels, width, height, manifest.pixelsPerCell / size);
  const bytes = await sharp(scaled.data, { raw: { width: scaled.width, height: scaled.height, channels: 4 } }).webp({ lossless: true }).toBuffer();
  const file = `interaction-${digest(bytes).slice(0, 16)}.webp`;
  await writeFile(path.join(directory, file), bytes);
  manifest.pages.interaction = { file, width: scaled.width, height: scaled.height, data: false, filter: 'nearest', sha256: digest(bytes) };
}
