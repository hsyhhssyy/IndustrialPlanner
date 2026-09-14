import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { gzipSync } from 'node:zlib';
import sharp from 'sharp';
import { publishedImageSize, resizeAssetRgba } from './building-asset-image.mjs';
import { compositeLogisticsLayers, publishAtlas } from './publish-logistics-materials.mjs';

const digest = (value) => createHash('sha256').update(value).digest('hex');
const save = (file, value) => writeFile(file, `${JSON.stringify(value, null, 2)}\n`);

/** 逐帧恢复源画布后缩放、裁切并重排；不同帧之间不参与滤波。数值场保留原始通道。 */
export async function publishLogisticsBaked({ sourceDirectory, outputDirectory, spriteDirectory, maskDirectory, resolution, sourceSite }) {
  const source = JSON.parse(await readFile(path.join(sourceDirectory, 'logistics-baked.json'), 'utf8'));
  if (source.schemaVersion !== 2 || source.format !== 'logistics-spritesheet-v2'
    || source.fluidPlayback?.kind !== 'baked-spatial-field-v2' || source.pixelsPerCell !== 128) {
    throw new Error('Unsupported baked logistics protocol');
  }
  const size = publishedImageSize(128, 128, resolution).width;
  const directory = path.join(outputDirectory, 'baked');
  const staticDirectory = path.join(outputDirectory, 'static');
  for (const folder of [directory, staticDirectory, spriteDirectory, maskDirectory]) await mkdir(folder, { recursive: true });
  const manifest = {
    schemaVersion: 2, format: source.format, resolution, pixelsPerCell: size, sourceSite,
    pages: {}, frames: {}, clips: source.clips,
    staticResources: Object.fromEntries(Object.entries(source.staticResources).map(([key, resource]) => [key, resource.frame])),
    parametersByResourceId: Object.fromEntries(Object.entries(source.parametersByResourceId)
      .map(([key, value]) => [key, Object.fromEntries(Object.entries(value).filter(([, v]) => typeof v === 'number'))])),
    fluidProfiles: Object.fromEntries(Object.entries(source.fluidProfiles).map(([id, profile]) => [id, {
      phase: profile.phase,
      colors: Object.fromEntries(['body', 'skin', 'skin2', 'splash'].map((role) => [role, (profile.colors[role] ?? profile.colors.skin).hex])),
    }])),
    cycle: source.cycle,
    // 只提取播放器使用的协议，原始含大整数的来源元数据留在 resources 原件中。
    fluidPlayback: { referenceShader: source.fluidPlayback.referenceShader },
    endpointConnector: { composite: source.endpointConnector.composite, whitening: source.endpointConnector.whitening },
  };
  for (const key of ['fillCellsPerSecond', 'drainDuration', 'refillDuration', 'edgeWidth']) {
    if (!(manifest.cycle[key] > 0)) throw new Error(`Invalid fluid timing: ${key}`);
  }
  const originals = new Map();
  for (const [id, page] of Object.entries(source.pages)) {
    const file = path.resolve(sourceDirectory, page.file);
    if (!file.startsWith(`${path.resolve(sourceDirectory)}${path.sep}`)) throw new Error(`Unsafe baked source: ${page.file}`);
    const bytes = await readFile(file);
    if (digest(bytes) !== page.sha256 || bytes.length !== page.bytes) throw new Error(`Baked source hash differs: ${id}`);
    const decoded = await sharp(bytes).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    if (decoded.info.width !== page.width || decoded.info.height !== page.height) throw new Error(`Baked source dimensions differ: ${id}`);
    if (page.group === 'fluid-field') {
      const scaled = await resizeAssetRgba(decoded.data, page.width, page.height, resolution, true);
      const encoded = gzipSync(scaled.data);
      const target = `${id}-${digest(encoded).slice(0, 16)}.rgba.bin`;
      await writeFile(path.join(directory, target), encoded);
      manifest.pages[id] = { file: target, width: scaled.width, height: scaled.height, data: true, sha256: digest(encoded) };
    } else originals.set(id, decoded);
  }
  const fullFrames = new Map();
  const groups = new Map();
  const requiredFrames = new Set(Object.values(manifest.clips).flatMap((clip) => clip.frames));
  for (const [key, frame] of Object.entries(source.frames)) if (key.startsWith('static/') && frame.sourceSize.every((value) => value === 128)) requiredFrames.add(key);
  manifest.staticResources = Object.fromEntries(Object.entries(manifest.staticResources).filter(([, frame]) => requiredFrames.has(frame)));
  for (const [key, frame] of Object.entries(source.frames)) {
    // 原始 pattern/chevron 长图已烘焙为相位帧，运行时不再加载这两个未消费的原贴图。
    if (!requiredFrames.has(key)) continue;
    const original = originals.get(frame.page);
    const [x, y, width, height] = frame.rect;
    const [left, top, trimWidth, trimHeight] = frame.spriteSourceSize;
    if (!original || frame.rotated || frame.sourceSize.some((value) => value !== 128)
      || ![x, y, width, height, left, top].every(Number.isSafeInteger)
      || x < 0 || y < 0 || width <= 0 || height <= 0 || x + width > original.info.width || y + height > original.info.height
      || left < 0 || top < 0 || left + width > 128 || top + height > 128 || trimWidth !== width || trimHeight !== height) {
      throw new Error(`Invalid baked frame: ${key}`);
    }
    const full = Buffer.alloc(128 * 128 * 4);
    for (let row = 0; row < height; row++) {
      const offset = ((y + row) * original.info.width + x) * 4;
      original.data.copy(full, ((top + row) * 128 + left) * 4, offset, offset + width * 4);
    }
    if (key.startsWith('static/')) fullFrames.set(key, full);
    const scaled = await resizeAssetRgba(full, 128, 128, resolution);
    // 裁切向外覆盖采样核边缘，保持原画布/pivot，不能将窄帧拉伸为整格。
    const sx = Math.max(0, Math.floor(left * resolution) - 2);
    const sy = Math.max(0, Math.floor(top * resolution) - 2);
    const sw = Math.min(size, Math.ceil((left + width) * resolution) + 2) - sx;
    const sh = Math.min(size, Math.ceil((top + height) * resolution) + 2) - sy;
    const group = source.pages[frame.page].group;
    if (!groups.has(group)) groups.set(group, []);
    groups.get(group).push({ key, scaled: scaled.data, sx, sy, width: sw, height: sh });
  }
  for (const [group, frames] of groups) {
    let x = 2, y = 2, rowHeight = 0, pageIndex = 0, pending = [];
    const limit = 2048;
    const flush = async () => {
      if (!pending.length) return;
      const width = Math.max(...pending.map((f) => f.x + f.width + 2));
      const height = Math.max(...pending.map((f) => f.y + f.height + 2));
      const pixels = Buffer.alloc(width * height * 4);
      const pageId = `${group}-${pageIndex++}`;
      for (const frame of pending) {
        for (let row = -2; row < frame.height + 2; row++) for (let column = -2; column < frame.width + 2; column++) {
          const src = ((frame.sy + Math.max(0, Math.min(frame.height - 1, row))) * size
            + frame.sx + Math.max(0, Math.min(frame.width - 1, column))) * 4;
          frame.scaled.copy(pixels, ((frame.y + row) * width + frame.x + column) * 4, src, src + 4);
        }
        manifest.frames[frame.key] = { page: pageId, rect: [frame.x, frame.y, frame.width, frame.height],
          sourceSize: [size, size], spriteSourceSize: [frame.sx, frame.sy, frame.width, frame.height] };
      }
      const bytes = await sharp(pixels, { raw: { width, height, channels: 4 } }).webp({ lossless: true }).toBuffer();
      const file = `${pageId}-${digest(bytes).slice(0, 16)}.webp`;
      await writeFile(path.join(directory, file), bytes);
      manifest.pages[pageId] = { file, width, height, data: false, sha256: digest(bytes) };
      pending = []; x = 2; y = 2; rowHeight = 0;
    };
    for (const frame of frames) {
      if (x + frame.width + 2 > limit) { x = 2; y += rowHeight + 4; rowHeight = 0; }
      if (y + frame.height + 2 > limit) await flush();
      pending.push({ ...frame, x, y });
      x += frame.width + 4; rowHeight = Math.max(rowHeight, frame.height);
    }
    await flush();
  }
  for (const [key, clip] of Object.entries(manifest.clips)) {
    if (clip.phaseSamples !== clip.frames.length || clip.frames.some((frame) => !manifest.frames[frame])) throw new Error(`Incomplete phase clip: ${key}`);
  }
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
      if (marker) push('static-marker');
      if (support) push('support-front');
      const pixels = compositeLogisticsLayers(layers);
      entries.push([`pipe/empty/${shape}/${Number(support)}${Number(marker)}`, pixels]);
      if (support && marker) defaults.push(['pipe', shape, pixels]);
    }
  }
  entries.push(['belt/straight-base', get('conveyor.straight.base')]);
  await publishAtlas(staticDirectory, 'baked-static', entries, statics, resolution);
  await save(path.join(staticDirectory, 'manifest.json'), statics);
  for (const [kind, shape, pixels] of defaults) {
    const rotation = shape === 'straight' ? 270 : shape === 'left' ? 90 : 0;
    const image = await sharp(pixels, { raw: { width: 128, height: 128, channels: 4 } }).rotate(rotation).raw().toBuffer();
    const scaled = await resizeAssetRgba(image, 128, 128, resolution);
    const file = `${kind}_${shape === 'straight' ? 'straight' : shape === 'left' ? 'turn_cw' : 'turn_ccw'}_1x1.webp`;
    await sharp(scaled.data, { raw: { width: size, height: size, channels: 4 } }).webp({ lossless: true }).toFile(path.join(spriteDirectory, file));
    const mask = Buffer.from(scaled.data);
    for (let i = 0; i < mask.length; i += 4) { mask[i] = mask[i + 1] = mask[i + 2] = 255; mask[i + 3] = mask[i + 3] > 0 ? 255 : 0; }
    await sharp(mask, { raw: { width: size, height: size, channels: 4 } }).webp({ lossless: true }).toFile(path.join(maskDirectory, file));
  }
  return { frames: Object.keys(manifest.frames).length, pages: Object.keys(manifest.pages).length, resolution };
}
