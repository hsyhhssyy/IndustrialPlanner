import sharp from 'sharp';
import { mkdir } from 'node:fs/promises';
import path from 'node:path';

/** 目标 resolution 是相对 128px 逻辑坐标的绝对密度；发布倍率只由目标/来源计算。 */
export function resolveAssetScale(sourceResolution, targetResolution) {
  if (!Number.isFinite(sourceResolution) || sourceResolution <= 0 || sourceResolution > 1
    || !Number.isFinite(targetResolution) || targetResolution <= 0 || targetResolution > sourceResolution) {
    throw new Error(`Invalid source/target resolutions: ${sourceResolution} -> ${targetResolution}`);
  }
  return targetResolution / sourceResolution;
}

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

/** 从来源 physicalRect 只复制完整归属像素；半像素边界落为透明补边，禁止读取相邻帧。 */
function extractPhysicalFrame(data, pageWidth, pageHeight, rect, logicalWidth, logicalHeight, sourceResolution, flipVertical) {
  if (!Array.isArray(rect) || rect.length !== 4 || rect.some((value) => !Number.isFinite(value))) {
    throw new Error('Effect physicalRect is invalid');
  }
  const [left, top, width, height] = rect;
  const expectedWidth = logicalWidth * sourceResolution;
  const expectedHeight = logicalHeight * sourceResolution;
  const close = (a, b) => Math.abs(a - b) < 1e-9;
  if (left < 0 || top < 0 || width <= 0 || height <= 0 || left + width > pageWidth || top + height > pageHeight
    || !close(width, expectedWidth) || !close(height, expectedHeight)) {
    throw new Error('Effect physicalRect differs from its logical frame');
  }
  const outputWidth = Math.ceil(width), outputHeight = Math.ceil(height);
  const sourceLeft = Math.ceil(left), sourceTop = Math.ceil(top);
  const sourceRight = Math.floor(left + width), sourceBottom = Math.floor(top + height);
  const copyWidth = sourceRight - sourceLeft, copyHeight = sourceBottom - sourceTop;
  const outputLeft = close(left, sourceLeft) ? 0 : 1;
  const outputTop = close(top, sourceTop) ? 0 : 1;
  if (copyWidth <= 0 || copyHeight <= 0 || outputLeft + copyWidth > outputWidth || outputTop + copyHeight > outputHeight) {
    throw new Error('Effect physicalRect has no safe pixel interior');
  }
  const output = Buffer.alloc(outputWidth * outputHeight * 4);
  for (let y = 0; y < copyHeight; y += 1) {
    const sourceOffset = ((sourceTop + y) * pageWidth + sourceLeft) * 4;
    const targetY = flipVertical ? outputHeight - 1 - (outputTop + y) : outputTop + y;
    data.copy(output, (targetY * outputWidth + outputLeft) * 4, sourceOffset, sourceOffset + copyWidth * 4);
  }
  return { data: output, width: outputWidth, height: outputHeight };
}

/** 裁切特效逐帧反射、补透明边界并缩放后重新分页，避免跨帧滤波和半像素图集坐标。 */
export async function publishEffectFrames({ sourceRoot, outputRoot, directory, effect, sheet,
  sourceResolution = 1, resolution, flipVertical }) {
  const first = effect.frames[0];
  if (!first) throw new Error('Effect has no frames');
  const scale = resolveAssetScale(sourceResolution, resolution);
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
      const physicalRect = frame.physicalRect ?? [frame.x, frame.y, frame.width, frame.height];
      const extracted = extractPhysicalFrame(sourcePage.data, sourcePage.info.width, sourcePage.info.height,
        physicalRect, frame.width, frame.height, sourceResolution, flipVertical);
      const scaled = await resizeAssetRgba(extracted.data, extracted.width, extracted.height, scale, false, true);
      if (scaled.width !== size.width || scaled.height !== size.height) {
        throw new Error('Effect target dimensions differ from its logical frame');
      }
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
