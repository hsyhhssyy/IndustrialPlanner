import sharp from 'sharp';
import { mkdir } from 'node:fs/promises';
import path from 'node:path';

/** 缩放必须落在完整像素上；逻辑坐标由各自 manifest 保留。 */
// AI-CORRECTION 2026-09-13: 裁切特效可向右、下补透明像素至采样周期边界，保持原采样密度及 pivot。
export function publishedImageSize(width, height, resolution, padToPixel = false) {
  if (![width, height].every((v) => Number.isSafeInteger(v) && v > 0)) throw new Error('Source dimensions must be positive integers');
  if (padToPixel && Number.isSafeInteger(1 / resolution)) {
    return publishedImageSize(Math.ceil(width * resolution) / resolution, Math.ceil(height * resolution) / resolution, resolution);
  }
  if (!Number.isFinite(resolution) || resolution <= 0 || resolution > 1
    || ![width, height, width * resolution, height * resolution].every((v) => Number.isSafeInteger(v) && v > 0)) {
    throw new Error(`Invalid integer image dimensions: ${width}x${height} at resolution ${resolution}`);
  }
  return { width: width * resolution, height: height * resolution };
}

/** 数值纹理按像素中心取最近样本，完整复制 RGBA，避免插值破坏 RG16/UV 编码。 */
export async function resizeAssetRgba(data, width, height, resolution, numeric = false, padToPixel = false) {
  const size = publishedImageSize(width, height, resolution, padToPixel);
  if (data.length !== width * height * 4) throw new Error('Expected RGBA image bytes');
  if (resolution === 1) return { data, ...size };
  if (!numeric) {
    const right = size.width / resolution - width;
    const bottom = size.height / resolution - height;
    // AI-REMOVED 2026-09-14:
    // Reason: Sharp 在同一流水线中总是先 resize 后 extend，输出尺寸与声明不符。
    // Trigger: 奇数宽端口特效发布后逐行错位，出现斜纹。
    // Evidence: 165×74 的半尺寸输出实际为 84×37，而图集按 83×37 复制。
    // Replacement: 下方先物化补边结果，再单独缩放并检查真实尺寸。
    // Risk: Low；仅改变需要补边的颜色图，数值纹理采样保持不变。
    // Human Review: Required
    //
    // Original code:
    // let input = sharp(data, { raw: { width, height, channels: 4 } });
    // if (right || bottom) input = input.extend({ right, bottom, left: 0, top: 0, background: { r: 0, g: 0, b: 0, alpha: 0 } });
    // return { data: await input
    //   .resize(size.width, size.height, { kernel: 'lanczos3' }).raw().toBuffer(), ...size };
    let input = sharp(data, { raw: { width, height, channels: 4 } });
    if (right || bottom) {
      const padded = await input.extend({ right, bottom, left: 0, top: 0,
        background: { r: 0, g: 0, b: 0, alpha: 0 } }).raw().toBuffer();
      input = sharp(padded, { raw: { width: width + right, height: height + bottom, channels: 4 } });
    }
    const scaled = await input.resize(size.width, size.height, { kernel: 'lanczos3' })
      .raw().toBuffer({ resolveWithObject: true });
    if (scaled.info.width !== size.width || scaled.info.height !== size.height
      || scaled.info.channels !== 4 || scaled.data.length !== size.width * size.height * 4) {
      throw new Error(`Resized RGBA dimensions differ from declared ${size.width}x${size.height}`);
    }
    return { data: scaled.data, ...size };
  }
  const output = Buffer.alloc(size.width * size.height * 4);
  for (let y = 0; y < size.height; y++) for (let x = 0; x < size.width; x++) {
    const sx = Math.floor((x + .5) / resolution);
    const sy = Math.floor((y + .5) / resolution);
    if (sx >= width || sy >= height) continue;
    data.copy(output, (y * size.width + x) * 4, (sy * width + sx) * 4, (sy * width + sx) * 4 + 4);
  }
  return { data: output, ...size };
}

/** 裁切特效逐帧反射、补透明边界并缩放后重新分页，避免跨帧滤波和半像素图集坐标。 */
export async function publishEffectFrames({ sourceRoot, outputRoot, directory, effect, sheet, resolution, flipVertical }) {
  const first = effect.frames[0];
  if (!first) throw new Error('Effect has no frames');
  const size = publishedImageSize(first.width, first.height, resolution, true);
  const columns = Math.min(8, effect.frames.length, Math.floor(2047 / size.width));
  const rows = Math.floor(2047 / size.height);
  if (!columns || !rows) throw new Error('Effect frame exceeds texture limit');
  const capacity = columns * rows;
  const pages = [], frames = [];
  let cachedIndex = -1, sourcePage;
  for (let start = 0; start < effect.frames.length; start += capacity) {
    const count = Math.min(capacity, effect.frames.length - start);
    const width = columns * size.width, height = Math.ceil(count / columns) * size.height;
    const pixels = Buffer.alloc(width * height * 4);
    for (let local = 0; local < count; local++) {
      const frame = effect.frames[start + local];
      if (frame.width !== first.width || frame.height !== first.height) throw new Error('Effect frame sizes differ');
      if (cachedIndex !== frame.page) {
        const page = sheet.pages[frame.page];
        const file = path.resolve(sourceRoot, directory, page.image);
        if (!file.startsWith(`${path.resolve(sourceRoot)}${path.sep}`)) throw new Error('Effect page escapes source root');
        sourcePage = await sharp(file).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
        if (sourcePage.info.width !== page.width || sourcePage.info.height !== page.height) throw new Error('Effect page dimensions differ');
        cachedIndex = frame.page;
      }
      if (![frame.x, frame.y, frame.width, frame.height].every(Number.isSafeInteger)
        || frame.x < 0 || frame.y < 0 || frame.x + frame.width > sourcePage.info.width
        || frame.y + frame.height > sourcePage.info.height) throw new Error('Effect frame rectangle is invalid');
      const extracted = Buffer.alloc(frame.width * frame.height * 4);
      for (let y = 0; y < frame.height; y++) {
        const sy = frame.y + (flipVertical ? frame.height - 1 - y : y);
        const offset = (sy * sourcePage.info.width + frame.x) * 4;
        sourcePage.data.copy(extracted, y * frame.width * 4, offset, offset + frame.width * 4);
      }
      const scaled = await resizeAssetRgba(extracted, frame.width, frame.height, resolution, false, true);
      const x = local % columns * size.width, y = Math.floor(local / columns) * size.height;
      for (let row = 0; row < size.height; row++) {
        scaled.data.copy(pixels, ((y + row) * width + x) * 4, row * size.width * 4, (row + 1) * size.width * 4);
      }
      frames.push({ page: pages.length, x, y, width: size.width, height: size.height, durationMs: frame.durationMs });
    }
    const file = `${directory.replace(/^assets\//, '')}/published-${pages.length}.webp`;
    await mkdir(path.dirname(path.join(outputRoot, file)), { recursive: true });
    await sharp(pixels, { raw: { width, height, channels: 4 } }).webp({ lossless: true }).toFile(path.join(outputRoot, file));
    pages.push({ file, width, height });
  }
  return { pages, frames };
}
