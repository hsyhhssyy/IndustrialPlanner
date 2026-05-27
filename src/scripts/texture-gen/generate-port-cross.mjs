import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const TILE_SIZE = 64;

// =============================================================================
// PC 版 — 两杆中心均为 (32,54)，长度一致（y:49-59），线宽 ≈ 2px
// =============================================================================
const CROSS_PC_POLYGONS = [
  // NW-SE 斜杠
  [
    [23, 49],
    [39, 59],
    [41, 58],
    [25, 50],
  ],
  // NE-SW 斜杠
  [
    [39, 49],
    [23, 59],
    [25, 58],
    [41, 50],
  ],
];

// =============================================================================
// Mobile 版 — 两杆中心均为 (32,32)，长度一致
// =============================================================================
const CROSS_MOBILE_POLYGONS = [
  // NW-SE 斜杠
  [
    [17, 19],
    [45, 47],
    [47, 45],
    [19, 17],
  ],
  // NE-SW 斜杠
  [
    [47, 19],
    [19, 47],
    [17, 45],
    [45, 17],
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
    `<svg xmlns="http://www.w3.org/2000/svg" width="${TILE_SIZE}" height="${TILE_SIZE}" viewBox="0 0 ${TILE_SIZE} ${TILE_SIZE}" shape-rendering="crispEdges">`,
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
  { fileName: 'port-cross.png', polygons: CROSS_PC_POLYGONS },
  { fileName: 'port-cross-mobile.png', polygons: CROSS_MOBILE_POLYGONS },
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
