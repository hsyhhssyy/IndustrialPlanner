import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const TILE_SIZE = 64;

// =============================================================================
// 样式 1：细 X（PC）— 对角线交叉，线宽 ≈ 3px
// =============================================================================
const THIN_CROSS_PC_POLYGONS = [
  // NW-SE 斜杠
  [
    [27, 25],
    [39, 37],
    [37, 39],
    [25, 27],
  ],
  // NE-SW 斜杠
  [
    [37, 25],
    [25, 37],
    [27, 39],
    [39, 27],
  ],
];

// =============================================================================
// 样式 2：粗 X（PC）— 对角线交叉，线宽 ≈ 5px
// =============================================================================
const THICK_CROSS_PC_POLYGONS = [
  // NW-SE 斜杠
  [
    [25, 24],
    [41, 38],
    [38, 41],
    [22, 27],
  ],
  // NE-SW 斜杠
  [
    [39, 24],
    [23, 38],
    [26, 41],
    [42, 27],
  ],
];

// =============================================================================
// 样式 1：细 X（Mobile）— 放大至与 solid mobile chevron 协调，线宽 ≈ 5px
// =============================================================================
const THIN_CROSS_MOBILE_POLYGONS = [
  [
    [21, 18],
    [47, 43],
    [43, 47],
    [18, 21],
  ],
  [
    [43, 18],
    [18, 43],
    [21, 47],
    [47, 21],
  ],
];

// =============================================================================
// 样式 2：粗 X（Mobile）— 放大，线宽 ≈ 7px
// =============================================================================
const THICK_CROSS_MOBILE_POLYGONS = [
  [
    [22, 17],
    [47, 42],
    [42, 47],
    [17, 22],
  ],
  [
    [42, 17],
    [17, 42],
    [22, 47],
    [47, 22],
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
  // 细 X — PC
  { fileName: 'port-cross-thin.png', polygons: THIN_CROSS_PC_POLYGONS },
  // 粗 X — PC
  { fileName: 'port-cross-thick.png', polygons: THICK_CROSS_PC_POLYGONS },
  // 细 X — Mobile
  { fileName: 'port-cross-thin-mobile.png', polygons: THIN_CROSS_MOBILE_POLYGONS },
  // 粗 X — Mobile
  { fileName: 'port-cross-thick-mobile.png', polygons: THICK_CROSS_MOBILE_POLYGONS },
];

async function main() {
  const outputDirectory = resolveOutputDirectory();
  const outputFilePaths = [];

  for (const texture of TEXTURES) {
    const outputFilePath = path.join(outputDirectory, texture.fileName);
    await renderTexture(outputFilePath, texture.polygons);
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
