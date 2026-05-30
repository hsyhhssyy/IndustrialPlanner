import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const TILE_SIZE = 64;

// =============================================================================
// PC 版 — 两线中点 (32, 54)，正方形等宽红色叉号
// =============================================================================
const CROSS_PC_LINES = [
  // NW-SE
  { x1: 26, y1: 48, x2: 38, y2: 60 },
  // NE-SW
  { x1: 38, y1: 48, x2: 26, y2: 60 },
];

// =============================================================================
// Mobile 版 — 两线中点 (32, 32)，正方形等宽红色叉号
// =============================================================================
const CROSS_MOBILE_LINES = [
  // NW-SE
  { x1: 17, y1: 17, x2: 47, y2: 47 },
  // NE-SW
  { x1: 47, y1: 17, x2: 17, y2: 47 },
];

const STROKE_WIDTH = 2;
const STROKE_COLOR = { r: 255, g: 0, b: 0 };

// =============================================================================
// Bresenham 直线光栅化 — 保证纯色像素、无抗锯齿
// =============================================================================
function drawLine(buffer, w, h, x0, y0, x1, y1, r, g, b) {
  const dx = Math.abs(x1 - x0);
  const dy = -Math.abs(y1 - y0);
  const sx = x0 < x1 ? 1 : -1;
  const sy = y0 < y1 ? 1 : -1;
  let err = dx + dy;

  while (true) {
    if (x0 >= 0 && x0 < w && y0 >= 0 && y0 < h) {
      const idx = (y0 * w + x0) * 4;
      buffer[idx] = r;
      buffer[idx + 1] = g;
      buffer[idx + 2] = b;
      buffer[idx + 3] = 255;
    }
    if (x0 === x1 && y0 === y1) break;
    const e2 = 2 * err;
    if (e2 >= dy) {
      err += dy;
      x0 += sx;
    }
    if (e2 <= dx) {
      err += dx;
      y0 += sy;
    }
  }
}

/** 通过偏移复制实现指定线宽的加粗直线 */
function drawThickLine(buffer, w, h, x0, y0, x1, y1, strokeWidth, r, g, b) {
  const half = Math.floor(strokeWidth / 2);
  const isSteep = Math.abs(y1 - y0) > Math.abs(x1 - x0);

  if (isSteep) {
    for (let off = -half; off < strokeWidth - half; off++) {
      drawLine(buffer, w, h, x0 + off, y0, x1 + off, y1, r, g, b);
    }
  } else {
    for (let off = -half; off < strokeWidth - half; off++) {
      drawLine(buffer, w, h, x0, y0 + off, x1, y1 + off, r, g, b);
    }
  }
}

function renderCrossToBuffer(lines) {
  const buffer = Buffer.alloc(TILE_SIZE * TILE_SIZE * 4, 0);
  for (const l of lines) {
    drawThickLine(
      buffer,
      TILE_SIZE,
      TILE_SIZE,
      Math.round(l.x1),
      Math.round(l.y1),
      Math.round(l.x2),
      Math.round(l.y2),
      STROKE_WIDTH,
      STROKE_COLOR.r,
      STROKE_COLOR.g,
      STROKE_COLOR.b,
    );
  }
  return buffer;
}

// =============================================================================
// 工具函数
// =============================================================================
function resolveOutputDirectory() {
  const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
  const projectRoot = path.resolve(scriptDirectory, '..', '..', '..');
  return path.resolve(process.argv[2] ?? path.join(projectRoot, 'public', 'textures'));
}

async function renderTexture(outputFilePath, lines) {
  await mkdir(path.dirname(outputFilePath), { recursive: true });
  const raw = renderCrossToBuffer(lines);
  await sharp(raw, { raw: { width: TILE_SIZE, height: TILE_SIZE, channels: 4 } })
    .png()
    .toFile(outputFilePath);
}

// =============================================================================
// 主流程
// =============================================================================
const TEXTURES = [
  { fileName: 'port-cross.png', lines: CROSS_PC_LINES },
  { fileName: 'port-cross-mobile.png', lines: CROSS_MOBILE_LINES },
];

async function main() {
  const outputDirectory = resolveOutputDirectory();
  const outputFilePaths = [];

  for (const texture of TEXTURES) {
    const outputFilePath = path.join(outputDirectory, texture.fileName);
    await renderTexture(outputFilePath, texture.lines);
    outputFilePaths.push(outputFilePath);
  }

  console.log(`generate-port-cross: generated ${outputFilePaths.length} texture(s).`);
  for (const p of outputFilePaths) {
    console.log(`- ${p}`);
  }
}

main().catch((error) => {
  console.error('Failed to generate port cross textures.');
  console.error(error);
  process.exitCode = 1;
});
