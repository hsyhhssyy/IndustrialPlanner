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
  { x1: 14, y1: 14, x2: 50, y2: 50 },
  // NE-SW
  { x1: 50, y1: 14, x2: 14, y2: 50 },
];

const STROKE_WIDTH = 2;
const STROKE_COLOR = { r: 255, g: 0, b: 0 };
// AI-CORRECTION 2026-06-18: 实机移动端叉号是粗圆头实体标记，原 2px 无抗锯齿线条与目标视觉不符。
const MOBILE_STROKE_WIDTH = 10;

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
    .webp({ lossless: true, effort: 6 })
    .toFile(outputFilePath);
}

async function renderMobileTexture(outputFilePath, lines) {
  await mkdir(path.dirname(outputFilePath), { recursive: true });
  const lineMarkup = lines
    .map(({ x1, y1, x2, y2 }) => `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" />`)
    .join('');
  const svg = [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${TILE_SIZE}" height="${TILE_SIZE}" viewBox="0 0 ${TILE_SIZE} ${TILE_SIZE}">`,
    '<defs>',
    '  <filter id="port-cross-glow" x="-50%" y="-50%" width="200%" height="200%">',
    '    <feGaussianBlur stdDeviation="3.5" />',
    '  </filter>',
    '</defs>',
    `<g fill="none" stroke="#ffffff" stroke-width="${MOBILE_STROKE_WIDTH}" stroke-linecap="butt" opacity="0.58" filter="url(#port-cross-glow)">`,
    lineMarkup,
    '</g>',
    `<g fill="none" stroke="#ffffff" stroke-width="${MOBILE_STROKE_WIDTH}" stroke-linecap="butt">`,
    lineMarkup,
    '</g>',
    '</svg>',
  ].join('');

  await sharp(Buffer.from(svg)).webp({ lossless: true, effort: 6 }).toFile(outputFilePath);
}

// =============================================================================
// 主流程
// =============================================================================
const TEXTURES = [
  { fileName: 'port-cross.webp', lines: CROSS_PC_LINES },
  { fileName: 'port-cross-mobile.webp', lines: CROSS_MOBILE_LINES, mobileAppearance: true },
];

async function main() {
  const outputDirectory = resolveOutputDirectory();
  const outputFilePaths = [];

  for (const texture of TEXTURES) {
    const outputFilePath = path.join(outputDirectory, texture.fileName);
    if (texture.mobileAppearance === true) {
      await renderMobileTexture(outputFilePath, texture.lines);
    } else {
      await renderTexture(outputFilePath, texture.lines);
    }
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
