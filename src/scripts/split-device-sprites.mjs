#!/usr/bin/env node

/**
 * split-device-sprites.mjs
 *
 * 将一张包含多个设备的 PNG 大图，自动切分为独立的设备精灵图。
 *
 * 工作原理：
 *   1. 像素级 8-邻域 BFS 连通域检测 — 每个"设备"是一块连续的非白色（非透明）像素
 *   2. 设备之间由白色或透明像素隔开，且包围盒互不重叠
 *   3. 过滤掉过小的连通域（噪点）
 *   4. 对每个设备求最小包围盒（像素坐标）
 *   5. 用 sharp.extract 裁出包围盒区域
 *   6. 用 sharp.trim 移除四周白色/透明边缘
 *   7. 将设备实体及其内部镂空区域与白底合成，烘焙为最终颜色
 *   8. 输出为独立 PNG：<原文件名>-1.png、<原文件名>-2.png …
 *
 * 用法：
 *   node src/scripts/split-device-sprites.mjs <输入PNG路径> [最小像素数] [白色阈值]
 */

import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

// ---------------------------------------------------------------------------
// 常量
// ---------------------------------------------------------------------------

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(scriptDirectory, '..', '..');
const outputDir = path.join(projectRoot, 'resources', 'device-sprite-original');

/** 连通域的最小像素数，少于此值的视为噪点予以过滤 */
const DEFAULT_MIN_PIXELS = 10;

/** 连通域的最小宽/高（像素），宽度或高度小于此值的视为碎片予以过滤 */
const MIN_COMPONENT_DIMENSION = 10;

/** 白色判定阈值：RGB 各通道与 255 的差值 ≤ 此值则视为白色背景 */
const DEFAULT_WHITE_THRESHOLD = 10;

const WHITE_OVERLAY_EDGE_ALPHA_THRESHOLD = 10;

// ---------------------------------------------------------------------------
// 辅助：背景像素判定
// ---------------------------------------------------------------------------

/**
 * 判断像素是否为背景（透明 或 白色）。
 * @param {Uint8Array} rawData - RGBA 原始像素
 * @param {number} pixelIndex - 像素索引
 * @param {number} [threshold] - 白色阈值，默认 DEFAULT_WHITE_THRESHOLD
 * @returns {boolean}
 */
function isBackgroundPixel(rawData, pixelIndex, threshold = DEFAULT_WHITE_THRESHOLD) {
  const offset = pixelIndex * 4;
  const a = rawData[offset + 3];
  // 透明像素视为背景
  if (a === 0) return true;
  const r = rawData[offset];
  const g = rawData[offset + 1];
  const b = rawData[offset + 2];
  return r >= 255 - threshold && g >= 255 - threshold && b >= 255 - threshold;
}

// ---------------------------------------------------------------------------
// 步骤 1：像素级 8-邻域 BFS 连通域检测
// ---------------------------------------------------------------------------

/**
 * @param {Uint8Array} rawData - RGBA 原始像素
 * @param {number} width
 * @param {number} height
 * @returns {Array<{pixelCount: number, bbox: [number,number,number,number]}>}
 */
function findConnectedComponents(rawData, width, height, whiteThreshold = DEFAULT_WHITE_THRESHOLD) {
  const totalPixels = width * height;
  const visited = new Uint8Array(totalPixels);

  // 8 邻域方向偏移 (dx, dy)
  const NEIGHBORS = [
    -1, -1,  -1, 0,  -1, 1,
     0, -1,          0, 1,
     1, -1,   1, 0,   1, 1,
  ];

  const components = [];

  for (let startY = 0; startY < height; startY++) {
    for (let startX = 0; startX < width; startX++) {
      const startIdx = startY * width + startX;
      if (visited[startIdx]) continue;
      // 背景像素（透明/白色）跳过
      if (isBackgroundPixel(rawData, startIdx, whiteThreshold)) continue;

      // BFS
      let minX = startX, maxX = startX;
      let minY = startY, maxY = startY;
      let pixelCount = 0;

      const queueX = [startX];
      const queueY = [startY];
      visited[startIdx] = 1;

      while (queueX.length > 0) {
        const cx = queueX.pop();
        const cy = queueY.pop();
        pixelCount++;

        if (cx < minX) minX = cx;
        if (cx > maxX) maxX = cx;
        if (cy < minY) minY = cy;
        if (cy > maxY) maxY = cy;

        for (let d = 0; d < 16; d += 2) {
          const nx = cx + NEIGHBORS[d];
          const ny = cy + NEIGHBORS[d + 1];
          if (nx < 0 || nx >= width || ny < 0 || ny >= height) continue;

          const nIdx = ny * width + nx;
          if (visited[nIdx]) continue;
          if (isBackgroundPixel(rawData, nIdx, whiteThreshold)) continue;

          visited[nIdx] = 1;
          queueX.push(nx);
          queueY.push(ny);
        }
      }

      components.push({
        pixelCount,
        bbox: [minX, minY, maxX, maxY],
      });
    }
  }

  return components;
}

// ---------------------------------------------------------------------------
// 步骤 2：按包围盒从上到下、从左到右排序
// ---------------------------------------------------------------------------

function sortComponents(components) {
  return components.sort((a, b) => {
    const [, ay1] = a.bbox;
    const [, by1] = b.bbox;
    const rowDiff = ay1 - by1;
    if (Math.abs(rowDiff) > 20) return rowDiff;
    return a.bbox[0] - b.bbox[0];
  });
}

// ---------------------------------------------------------------------------
// 步骤 3：裁切四周白色/透明边缘
// ---------------------------------------------------------------------------

/**
 * 从 rawData 四周裁掉白色或透明边缘，返回紧凑区域。
 * 同时支持透明图和白底图。
 * @param {Uint8Array} rawData
 * @param {number} width
 * @param {number} height
 * @param {number} channels
 * @param {number} [whiteThreshold]
 */
function trimBackgroundEdges(rawData, width, height, channels, whiteThreshold = DEFAULT_WHITE_THRESHOLD) {
  let minX = width;
  let minY = height;
  let maxX = -1;
  let maxY = -1;

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const offset = (y * width + x) * channels;
      const a = rawData[offset + 3];
      // 透明像素视为背景
      if (a === 0) continue;
      // 白色像素视为背景
      const r = rawData[offset];
      const g = rawData[offset + 1];
      const b = rawData[offset + 2];
      if (r >= 255 - whiteThreshold && g >= 255 - whiteThreshold && b >= 255 - whiteThreshold) {
        continue;
      }

      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
    }
  }

  if (maxX === -1 || maxY === -1) {
    return null;
  }

  const trimmedWidth = maxX - minX + 1;
  const trimmedHeight = maxY - minY + 1;
  if (trimmedWidth === width && trimmedHeight === height && minX === 0 && minY === 0) {
    return { data: rawData, width, height, channels };
  }

  const trimmedData = Buffer.alloc(trimmedWidth * trimmedHeight * channels);
  for (let y = 0; y < trimmedHeight; y++) {
    const sourceStart = ((minY + y) * width + minX) * channels;
    const sourceEnd = sourceStart + trimmedWidth * channels;
    rawData.copy(trimmedData, y * trimmedWidth * channels, sourceStart, sourceEnd);
  }

  return {
    data: trimmedData,
    width: trimmedWidth,
    height: trimmedHeight,
    channels,
  };
}

function findEdgeConnectedLowAlphaPixels(rawData, width, height, alphaThreshold) {
  if (width === 0 || height === 0) {
    return new Uint8Array(0);
  }

  const totalPixels = width * height;
  const edgeConnected = new Uint8Array(totalPixels);
  const queueX = [];
  const queueY = [];
  const NEIGHBORS = [
    -1, -1,  -1, 0,  -1, 1,
     0, -1,           0, 1,
     1, -1,   1, 0,   1, 1,
  ];

  function enqueueIfLowAlpha(x, y) {
    const pixelIndex = y * width + x;
    if (edgeConnected[pixelIndex]) {
      return;
    }
    if (rawData[pixelIndex * 4 + 3] >= alphaThreshold) {
      return;
    }

    edgeConnected[pixelIndex] = 1;
    queueX.push(x);
    queueY.push(y);
  }

  for (let x = 0; x < width; x++) {
    enqueueIfLowAlpha(x, 0);
    enqueueIfLowAlpha(x, height - 1);
  }

  for (let y = 1; y < height - 1; y++) {
    enqueueIfLowAlpha(0, y);
    enqueueIfLowAlpha(width - 1, y);
  }

  while (queueX.length > 0) {
    const currentX = queueX.pop();
    const currentY = queueY.pop();

    for (let index = 0; index < NEIGHBORS.length; index += 2) {
      const nextX = currentX + NEIGHBORS[index];
      const nextY = currentY + NEIGHBORS[index + 1];
      if (nextX < 0 || nextX >= width || nextY < 0 || nextY >= height) {
        continue;
      }

      enqueueIfLowAlpha(nextX, nextY);
    }
  }

  return edgeConnected;
}

function compositeSpriteInteriorOverWhite(rawData, width, height) {
  const edgeConnectedLowAlphaPixels = findEdgeConnectedLowAlphaPixels(
    rawData,
    width,
    height,
    WHITE_OVERLAY_EDGE_ALPHA_THRESHOLD,
  );
  const totalPixels = width * height;

  for (let pixelIndex = 0; pixelIndex < totalPixels; pixelIndex++) {
    if (edgeConnectedLowAlphaPixels[pixelIndex]) {
      continue;
    }

    const colorOffset = pixelIndex * 4;
    const alphaOffset = colorOffset + 3;
    const alpha = rawData[alphaOffset];

    if (alpha === 0) {
      rawData[colorOffset] = 255;
      rawData[colorOffset + 1] = 255;
      rawData[colorOffset + 2] = 255;
      rawData[alphaOffset] = 255;
      continue;
    }

    if (alpha === 255) {
      continue;
    }

    const inverseAlpha = 255 - alpha;
    rawData[colorOffset] = Math.round((rawData[colorOffset] * alpha + 255 * inverseAlpha) / 255);
    rawData[colorOffset + 1] = Math.round((rawData[colorOffset + 1] * alpha + 255 * inverseAlpha) / 255);
    rawData[colorOffset + 2] = Math.round((rawData[colorOffset + 2] * alpha + 255 * inverseAlpha) / 255);
    rawData[alphaOffset] = 255;
  }
}

/**
 * 从四边 BFS 扩散，将连通到边缘的近白色像素设为透明。
 * 遇到非近白色像素时停止扩散，避免侵蚀设备内部。
 */
function removeEdgeWhiteFringe(rawData, width, height, whiteThreshold = DEFAULT_WHITE_THRESHOLD) {
  const totalPixels = width * height;
  const visited = new Uint8Array(totalPixels);
  const queueX = [];
  const queueY = [];

  const NEIGHBORS = [
    -1, -1,  -1, 0,  -1, 1,
     0, -1,          0, 1,
     1, -1,   1, 0,   1, 1,
  ];

  function isNearWhite(offset) {
    const r = rawData[offset];
    const g = rawData[offset + 1];
    const b = rawData[offset + 2];
    return r >= 255 - whiteThreshold && g >= 255 - whiteThreshold && b >= 255 - whiteThreshold;
  }

  // 从四边入队
  for (let x = 0; x < width; x++) {
    pushIfEdgeWhite(x, 0);
    pushIfEdgeWhite(x, height - 1);
  }
  for (let y = 1; y < height - 1; y++) {
    pushIfEdgeWhite(0, y);
    pushIfEdgeWhite(width - 1, y);
  }

  function pushIfEdgeWhite(x, y) {
    const idx = y * width + x;
    if (visited[idx]) return;
    visited[idx] = 1;
    const offset = idx * 4;
    if (rawData[offset + 3] === 0) {
      // 透明像素也入队，以便穿透透明区域继续发现白边
      queueX.push(x);
      queueY.push(y);
      return;
    }
    if (!isNearWhite(offset)) return;
    queueX.push(x);
    queueY.push(y);
  }

  // BFS 扩散
  let transparentCount = 0;
  while (queueX.length > 0) {
    const cx = queueX.pop();
    const cy = queueY.pop();

    for (let d = 0; d < 16; d += 2) {
      const nx = cx + NEIGHBORS[d];
      const ny = cy + NEIGHBORS[d + 1];
      if (nx < 0 || nx >= width || ny < 0 || ny >= height) continue;
      const nIdx = ny * width + nx;
      if (visited[nIdx]) continue;
      const offset = nIdx * 4;
      if (rawData[offset + 3] === 0) {
        // 透明像素：入队以穿透透明区域，但不标记为白边移除目标
        visited[nIdx] = 1;
        transparentCount++;
        queueX.push(nx);
        queueY.push(ny);
        continue;
      }
      if (!isNearWhite(offset)) continue;
      visited[nIdx] = 1;
      queueX.push(nx);
      queueY.push(ny);
    }
  }

  // 将 BFS 标记到的近白像素设为透明（已是透明的像素无需处理）
  for (let i = 0; i < totalPixels; i++) {
    if (visited[i] && rawData[i * 4 + 3] !== 0) {
      const offset = i * 4;
      rawData[offset] = 0;
      rawData[offset + 1] = 0;
      rawData[offset + 2] = 0;
      rawData[offset + 3] = 0;
    }
  }
}

async function buildProcessedSprite(extractedBuffer, shouldTrimTransparentEdges, whiteThreshold = DEFAULT_WHITE_THRESHOLD) {
  const image = sharp(extractedBuffer);
  const { data, info } = await image.ensureAlpha().raw().toBuffer({ resolveWithObject: true });

  const processedSprite = shouldTrimTransparentEdges
    ? trimBackgroundEdges(data, info.width, info.height, info.channels, whiteThreshold) ?? {
      data,
      width: info.width,
      height: info.height,
      channels: info.channels,
    }
    : {
      data,
      width: info.width,
      height: info.height,
      channels: info.channels,
    };

  compositeSpriteInteriorOverWhite(
    processedSprite.data,
    processedSprite.width,
    processedSprite.height,
  );

  // 移除边缘白边：从四边 BFS 扩散，将连通的近白色像素变为透明
  removeEdgeWhiteFringe(
    processedSprite.data,
    processedSprite.width,
    processedSprite.height,
    whiteThreshold,
  );

  return {
    pipeline: sharp(processedSprite.data, {
      raw: {
        width: processedSprite.width,
        height: processedSprite.height,
        channels: processedSprite.channels,
      },
    }),
    width: processedSprite.width,
    height: processedSprite.height,
  };
}

// ---------------------------------------------------------------------------
// 步骤 4：提取矩形 + 裁切透明边
// ---------------------------------------------------------------------------

/**
 * 从原图中裁出 bbox 区域，然后裁掉四周白色/透明边缘
 */
async function extractAndTrim(sourceImage, bbox, whiteThreshold = DEFAULT_WHITE_THRESHOLD) {
  const [minX, minY, maxX, maxY] = bbox;
  const extractWidth = maxX - minX + 1;
  const extractHeight = maxY - minY + 1;

  let extracted;
  try {
    extracted = await sourceImage
      .clone()
      .extract({ left: minX, top: minY, width: extractWidth, height: extractHeight })
      .png()
      .toBuffer();
  } catch {
    return null;
  }

  try {
    return await buildProcessedSprite(extracted, true, whiteThreshold);
  } catch {
    return buildProcessedSprite(extracted, false, whiteThreshold);
  }
}

// ---------------------------------------------------------------------------
// 主流程
// ---------------------------------------------------------------------------

async function main() {
  const inputPath = process.argv[2];
  if (!inputPath) {
    console.error('用法: node src/scripts/split-device-sprites.mjs <输入PNG路径> [最小像素数] [白色阈值]');
    process.exit(1);
  }

  const minPixels = parseInt(process.argv[3], 10) || DEFAULT_MIN_PIXELS;
  const whiteThreshold = parseInt(process.argv[4], 10);
  // 若指定了白色阈值则覆盖默认值（isNaN 表示未指定，使用默认）
  const effectiveWhiteThreshold = Number.isNaN(whiteThreshold) ? DEFAULT_WHITE_THRESHOLD : whiteThreshold;

  const inputAbsPath = path.resolve(inputPath);
  const inputBasename = path.basename(inputAbsPath, path.extname(inputAbsPath));

  console.log(`📥 输入: ${inputAbsPath}`);
  console.log(`📐 最小设备像素数: ${minPixels}`);
  console.log(`🎨 白色阈值: ${effectiveWhiteThreshold}`);

  const { data, info } = await sharp(inputAbsPath)
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });

  console.log(`🖼️  图像尺寸: ${info.width}×${info.height}`);

  // 像素级连通域检测
  const allComponents = findConnectedComponents(data, info.width, info.height, effectiveWhiteThreshold);
  console.log(`📦 检测到 ${allComponents.length} 个连通域`);

  // 过滤噪点
  const pixelFiltered = allComponents.filter((c) => c.pixelCount >= minPixels);
  const pixelFilteredCount = allComponents.length - pixelFiltered.length;
  if (pixelFilteredCount > 0) {
    console.log(`🧹 过滤 ${pixelFilteredCount} 个噪点（< ${minPixels} px）`);
  }

  // 过滤分隔线（宽度或高度过小的细线）
  const components = pixelFiltered.filter((c) => {
    const [minX, minY, maxX, maxY] = c.bbox;
    const w = maxX - minX + 1;
    const h = maxY - minY + 1;
    return w >= MIN_COMPONENT_DIMENSION && h >= MIN_COMPONENT_DIMENSION;
  });
  const dimFiltered = pixelFiltered.length - components.length;
  if (dimFiltered > 0) {
    console.log(`🧹 过滤 ${dimFiltered} 个碎片（宽或高 < ${MIN_COMPONENT_DIMENSION} px）`);
  }

  // 排序
  sortComponents(components);
  console.log(`📦 有效设备: ${components.length} 个`);

  if (components.length === 0) {
    console.log('⚠️  未检测到有效设备，退出。');
    process.exit(0);
  }

  await mkdir(outputDir, { recursive: true });

  const sourceImage = sharp(inputAbsPath);

  for (let i = 0; i < components.length; i++) {
    const { bbox, pixelCount } = components[i];
    const [minX, minY, maxX, maxY] = bbox;
    const rawW = maxX - minX + 1;
    const rawH = maxY - minY + 1;

    console.log(
      `  设备 ${i + 1}: ${pixelCount}px, ` +
      `包围盒[${minX},${minY} ${rawW}×${rawH}]`,
    );

    const result = await extractAndTrim(sourceImage, bbox, effectiveWhiteThreshold);

    if (!result) {
      console.log(`    ⏭️  裁切失败，跳过`);
      continue;
    }

    const outputPath = path.join(outputDir, `${inputBasename}-${i + 1}.png`);
    await result.pipeline.png().toFile(outputPath);
    console.log(`    ✅ ${inputBasename}-${i + 1}.png (${result.width}×${result.height})`);
  }

  console.log(`\n🎉 完成! 输出: ${outputDir}`);
}

main().catch((err) => {
  console.error('❌ 错误:', err);
  process.exit(1);
});
