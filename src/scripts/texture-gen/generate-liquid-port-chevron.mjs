import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const TILE_SIZE = 64;

// =============================================================================
// Liquid Port Chevron 参数（PC）
// =============================================================================
// 结构：箭头头部 + 间隙 + 横杆，totalHeight = arrowHeadHeight + gap + blockHeight
const CENTER_X = 32;
const TOP_Y = 45;
const HALF_WIDTH = 9;            // width / 2 = 18 / 2
const ARROW_HEAD_HEIGHT = 8;
const HALF_BLOCK_WIDTH = 10;    // blockWidth / 2 = 20 / 2
const BLOCK_HEIGHT = 4;
const GAP = 2;

// =============================================================================
// 方向向上（出口）- 独立 SVG 多边形
// =============================================================================
// 三角形在上、横杆在下
// triangleBottomY = TOP_Y + ARROW_HEAD_HEIGHT = 45 + 8 = 53
// blockTopY = triangleBottomY + GAP = 53 + 2 = 55
// blockBottomY = blockTopY + BLOCK_HEIGHT = 55 + 4 = 59
const LIQUID_UP_POLYGONS = [
  // 箭头三角形
  [
    [32, 45], // centerX, topY
    [23, 53], // centerX - halfWidth, triangleBottomY
    [41, 53], // centerX + halfWidth, triangleBottomY
  ],
  // 横杆
  [
    [22, 55], // centerX - halfBlockWidth, blockTopY
    [42, 55], // centerX + halfBlockWidth, blockTopY
    [42, 59], // centerX + halfBlockWidth, blockBottomY
    [22, 59], // centerX - halfBlockWidth, blockBottomY
  ],
];

// =============================================================================
// 方向向下（入口）- 独立 SVG 多边形
// =============================================================================
// 横杆在上、三角形在下
// downBarBottomY = TOP_Y + BLOCK_HEIGHT = 45 + 4 = 49
// downTriangleTopY = downBarBottomY + GAP = 49 + 2 = 51
// downTipY = TOP_Y + totalHeight = 45 + 14 = 59
const LIQUID_DOWN_POLYGONS = [
  // 横杆
  [
    [22, 45], // centerX - halfBlockWidth, topY
    [42, 45], // centerX + halfBlockWidth, topY
    [42, 49], // centerX + halfBlockWidth, downBarBottomY
    [22, 49], // centerX - halfBlockWidth, downBarBottomY
  ],
  // 箭头三角形
  [
    [32, 59], // centerX, downTipY
    [23, 51], // centerX - halfWidth, downTriangleTopY
    [41, 51], // centerX + halfWidth, downTriangleTopY
  ],
];

// =============================================================================
// Mobile 版本 - Liquid Port Chevron
// =============================================================================
// 三角尾巴在 50% 处（y=32），三角高度 = 3/8 格 = 24px
// 横杆高 = 1/6 格 ≈ 10.7px，位于下半部分正中（y≈48）
const MOBILE_LIQUID_TRIANGLE_HALF = 25.6;     // 80% 格 / 2 = 51.2 / 2
const MOBILE_LIQUID_BAR_HALF = 25.6;          // 80% 格 / 2，与三角同宽
const MOBILE_LIQUID_BAR_TOP_UP = 128 / 3;     // 48 - 32/6 ≈ 42.7
const MOBILE_LIQUID_BAR_BOTTOM_UP = 160 / 3;  // 48 + 32/6 ≈ 53.3
const MOBILE_LIQUID_BAR_TOP_DOWN = 32 / 3;    // 16 - 32/6 ≈ 10.7
const MOBILE_LIQUID_BAR_BOTTOM_DOWN = 64 / 3; // 16 + 32/6 ≈ 21.3

// 方向向上（出口）- 三角形在上、横杆在下半部分
const LIQUID_UP_MOBILE_POLYGONS = [
  // 箭头三角形：基边在 y=32，尖端在 y=8
  [
    [32, 8],
    [6.4, 32],
    [57.6, 32],
  ],
  // 横杆：位于下半部分正中
  [
    [6.4, MOBILE_LIQUID_BAR_TOP_UP],
    [57.6, MOBILE_LIQUID_BAR_TOP_UP],
    [57.6, MOBILE_LIQUID_BAR_BOTTOM_UP],
    [6.4, MOBILE_LIQUID_BAR_BOTTOM_UP],
  ],
];

// 方向向下（入口）- 横杆在上半部分、三角形在下
const LIQUID_DOWN_MOBILE_POLYGONS = [
  // 横杆：位于上半部分正中
  [
    [6.4, MOBILE_LIQUID_BAR_TOP_DOWN],
    [57.6, MOBILE_LIQUID_BAR_TOP_DOWN],
    [57.6, MOBILE_LIQUID_BAR_BOTTOM_DOWN],
    [6.4, MOBILE_LIQUID_BAR_BOTTOM_DOWN],
  ],
  // 箭头三角形：基边在 y=32，尖端在 y=56
  [
    [32, 56],
    [6.4, 32],
    [57.6, 32],
  ],
];

// =============================================================================
// 内联渲染工具
// =============================================================================
function formatPoint([x, y]) {
  return `${x},${y}`;
}

function createSvgMarkup(polygons) {
  const polygonMarkup = polygons
    .map((polygon) => `<polygon points="${polygon.map(formatPoint).join(' ')}" fill="#ffffff" />`)
    .join('');

  return [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${TILE_SIZE}" height="${TILE_SIZE}" viewBox="0 0 ${TILE_SIZE} ${TILE_SIZE}">`,
    polygonMarkup,
    '</svg>',
  ].join('');
}

function resolveOutputDirectory() {
  const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
  const projectRoot = path.resolve(scriptDirectory, '..', '..', '..');
  return path.resolve(process.argv[2] ?? path.join(projectRoot, 'public', 'textures'));
}

async function renderTexture(outputFilePath, polygons) {
  await mkdir(path.dirname(outputFilePath), { recursive: true });
  await sharp(Buffer.from(createSvgMarkup(polygons))).png().toFile(outputFilePath);
}

// =============================================================================
// 主流程
// =============================================================================
const TEXTURES = [
  // PC 版本
  { fileName: 'liquid-port-chevron-input.png',  polygons: LIQUID_DOWN_POLYGONS },
  { fileName: 'liquid-port-chevron-output.png', polygons: LIQUID_UP_POLYGONS },
  // Mobile 版本
  { fileName: 'liquid-port-chevron-input-mobile.png',  polygons: LIQUID_DOWN_MOBILE_POLYGONS },
  { fileName: 'liquid-port-chevron-output-mobile.png', polygons: LIQUID_UP_MOBILE_POLYGONS },
];

async function main() {
  const outputDirectory = resolveOutputDirectory();
  const outputFilePaths = [];

  for (const texture of TEXTURES) {
    const outputFilePath = path.join(outputDirectory, texture.fileName);
    await renderTexture(outputFilePath, texture.polygons);
    outputFilePaths.push(outputFilePath);
  }

  console.log(`generate-liquid-port-chevron: generated ${outputFilePaths.length} texture(s).`);
  for (const p of outputFilePaths) {
    console.log(`- ${p}`);
  }
}

main().catch((error) => {
  console.error('Failed to generate liquid port chevron textures.');
  console.error(error);
  process.exitCode = 1;
});