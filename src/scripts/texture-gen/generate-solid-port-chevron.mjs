import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const TILE_SIZE = 64;

// =============================================================================
// Solid Port Chevron 参数（PC）
// =============================================================================
const CENTER_X = 32;
const TOP_Y = 49;
const WIDTH = 18;
const HEIGHT = 10;
const THICKNESS = 4;

// =============================================================================
// 方向向下（入口）- 独立 SVG 多边形
// =============================================================================
// V 形箭头，尖端朝下，底部 tipY = TOP_Y + HEIGHT = 59
const SOLID_DOWN_POLYGONS = [
  [
    [23, 49], // centerX - halfWidth, tipY - height
    [32, 59], // centerX, tipY
    [41, 49], // centerX + halfWidth, tipY - height
    [37, 49], // centerX + innerHalfWidth, tipY - height
    [32, 55], // centerX, tipY - thickness
    [27, 49], // centerX - innerHalfWidth, tipY - height
  ],
];

// =============================================================================
// 方向向上（出口）- 独立 SVG 多边形
// =============================================================================
// V 形箭头，尖端朝上，顶部 tipY = TOP_Y = 49
const SOLID_UP_POLYGONS = [
  [
    [23, 59], // centerX - halfWidth, tipY + height
    [32, 49], // centerX, tipY
    [41, 59], // centerX + halfWidth, tipY + height
    [37, 59], // centerX + innerHalfWidth, tipY + height
    [32, 53], // centerX, tipY + thickness
    [27, 59], // centerX - innerHalfWidth, tipY + height
  ],
];

// =============================================================================
// Mobile 版本 - Solid Port Chevron
// =============================================================================
// 箭头高度 = 1/2 格 = 32px，水平宽 = 80% 格 = 51px，厚度按比例 ≈ 11px
const MOBILE_SOLID_HALF_WIDTH = 25.5;       // 51 / 2
const MOBILE_SOLID_THICKNESS = 11;
const MOBILE_SOLID_INNER_HALF = 14.5;       // 25.5 - 11

// 方向向上（出口）- 尖端朝上，tip 在 y=16，两翼延伸到 y=48
const SOLID_UP_MOBILE_POLYGONS = [
  [
    [6.5, 48],  // centerX - halfWidth, tipY + height
    [32, 16],   // centerX, tipY
    [57.5, 48], // centerX + halfWidth, tipY + height
    [46.5, 48], // centerX + innerHalfWidth, tipY + height
    [32, 27],   // centerX, tipY + thickness
    [17.5, 48], // centerX - innerHalfWidth, tipY + height
  ],
];

// 方向向下（入口）- 尖端朝下，tip 在 y=48，两翼延伸到 y=16
const SOLID_DOWN_MOBILE_POLYGONS = [
  [
    [6.5, 16],  // centerX - halfWidth, tipY - height
    [32, 48],   // centerX, tipY
    [57.5, 16], // centerX + halfWidth, tipY - height
    [46.5, 16], // centerX + innerHalfWidth, tipY - height
    [32, 37],   // centerX, tipY - thickness
    [17.5, 16], // centerX - innerHalfWidth, tipY - height
  ],
];

// =============================================================================
// 内联渲染工具
// =============================================================================
function formatPoint([x, y]) {
  return `${x},${y}`;
}

function createSvgMarkup(polygons, appearance = {}) {
  const {
    glow = false,
    cornerStrokeWidth = 0,
  } = appearance;
  const filterMarkup = glow
    ? [
        '<defs>',
        '  <filter id="port-glow" x="-50%" y="-50%" width="200%" height="200%">',
        '    <feGaussianBlur stdDeviation="2.5" />',
        '  </filter>',
        '</defs>',
      ].join('')
    : '';
  const glowMarkup = glow
    ? polygons
        .map((polygon) => `<polygon points="${polygon.map(formatPoint).join(' ')}" fill="#ffffff" opacity="0.45" filter="url(#port-glow)" />`)
        .join('')
    : '';
  const polygonMarkup = polygons
    .map((polygon) => [
      `<polygon points="${polygon.map(formatPoint).join(' ')}"`,
      ' fill="#ffffff"',
      cornerStrokeWidth > 0
        ? ` stroke="#ffffff" stroke-width="${cornerStrokeWidth}" stroke-linejoin="round"`
        : '',
      ' />',
    ].join(''))
    .join('');

  return [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${TILE_SIZE}" height="${TILE_SIZE}" viewBox="0 0 ${TILE_SIZE} ${TILE_SIZE}">`,
    filterMarkup,
    glowMarkup,
    polygonMarkup,
    '</svg>',
  ].join('');
}

function resolveOutputDirectory() {
  const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
  const projectRoot = path.resolve(scriptDirectory, '..', '..', '..');
  return path.resolve(process.argv[2] ?? path.join(projectRoot, 'public', 'textures'));
}

async function renderTexture(outputFilePath, polygons, appearance) {
  await mkdir(path.dirname(outputFilePath), { recursive: true });
  await sharp(Buffer.from(createSvgMarkup(polygons, appearance))).png().toFile(outputFilePath);
}

// =============================================================================
// 主流程
// =============================================================================
const TEXTURES = [
  // PC 版本
  { fileName: 'solid-port-chevron-input.png',  polygons: SOLID_DOWN_POLYGONS },
  { fileName: 'solid-port-chevron-output.png', polygons: SOLID_UP_POLYGONS },
  // Mobile 版本
  // AI-CORRECTION 2026-06-18: 移动端参考游戏实机效果增加圆角轮廓与柔光，避免纯硬边多边形显得像临时占位图。
  { fileName: 'solid-port-chevron-input-mobile.png',  polygons: SOLID_DOWN_MOBILE_POLYGONS, appearance: { glow: true, cornerStrokeWidth: 0.75 } },
  { fileName: 'solid-port-chevron-output-mobile.png', polygons: SOLID_UP_MOBILE_POLYGONS, appearance: { glow: true, cornerStrokeWidth: 0.75 } },
];

async function main() {
  const outputDirectory = resolveOutputDirectory();
  const outputFilePaths = [];

  for (const texture of TEXTURES) {
    const outputFilePath = path.join(outputDirectory, texture.fileName);
    await renderTexture(outputFilePath, texture.polygons, texture.appearance);
    outputFilePaths.push(outputFilePath);
  }

  console.log(`generate-solid-port-chevron: generated ${outputFilePaths.length} texture(s).`);
  for (const p of outputFilePaths) {
    console.log(`- ${p}`);
  }
}

main().catch((error) => {
  console.error('Failed to generate solid port chevron textures.');
  console.error(error);
  process.exitCode = 1;
});
