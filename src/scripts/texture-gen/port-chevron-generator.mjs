import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

export const TILE_SIZE = 64;

function resolveProjectRoot(scriptUrl) {
  const scriptDirectory = path.dirname(fileURLToPath(scriptUrl));
  return path.resolve(scriptDirectory, '..', '..', '..');
}

function resolveOutputDirectory(scriptUrl, cliDirectory) {
  return path.resolve(cliDirectory ?? path.join(resolveProjectRoot(scriptUrl), 'public', 'textures'));
}

function formatPoint([x, y]) {
  return `${x},${y}`;
}

function createSvgMarkup({ polygons, tileSize = TILE_SIZE }) {
  const polygonMarkup = polygons
    .map((polygon) => `<polygon points="${polygon.map(formatPoint).join(' ')}" fill="#ffffff" />`)
    .join('');

  return [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${tileSize}" height="${tileSize}" viewBox="0 0 ${tileSize} ${tileSize}">`,
    polygonMarkup,
    '</svg>',
  ].join('');
}

export function createChevronBand({ centerX, centerY, tipX, tipY, width, height, thickness, direction }) {
  const halfWidth = width / 2;
  const innerHalfWidth = halfWidth - thickness;

  if (innerHalfWidth <= 0) {
    throw new Error(`Invalid chevron width/thickness combination: width=${width}, thickness=${thickness}`);
  }

  if (direction === 'down') {
    return [
      [centerX - halfWidth, tipY - height],
      [centerX, tipY],
      [centerX + halfWidth, tipY - height],
      [centerX + innerHalfWidth, tipY - height],
      [centerX, tipY - thickness],
      [centerX - innerHalfWidth, tipY - height],
    ];
  }

  if (direction === 'up') {
    return [
      [centerX - halfWidth, tipY + height],
      [centerX, tipY],
      [centerX + halfWidth, tipY + height],
      [centerX + innerHalfWidth, tipY + height],
      [centerX, tipY + thickness],
      [centerX - innerHalfWidth, tipY + height],
    ];
  }

  if (direction === 'right') {
    return [
      [tipX - height, centerY - halfWidth],
      [tipX, centerY],
      [tipX - height, centerY + halfWidth],
      [tipX - height, centerY + innerHalfWidth],
      [tipX - thickness, centerY],
      [tipX - height, centerY - innerHalfWidth],
    ];
  }

  if (direction === 'left') {
    return [
      [tipX + height, centerY - halfWidth],
      [tipX, centerY],
      [tipX + height, centerY + halfWidth],
      [tipX + height, centerY + innerHalfWidth],
      [tipX + thickness, centerY],
      [tipX + height, centerY - innerHalfWidth],
    ];
  }

  throw new Error(`Unsupported chevron direction: ${direction}`);
}

export function createVerticalChevronBand({ centerX, topY, width, height, thickness, direction }) {
  if (direction === 'up') {
    return createChevronBand({
      centerX,
      tipY: topY,
      width,
      height,
      thickness,
      direction,
    });
  }

  if (direction === 'down') {
    return createChevronBand({
      centerX,
      tipY: topY + height,
      width,
      height,
      thickness,
      direction,
    });
  }

  throw new Error(`Unsupported vertical chevron direction: ${direction}`);
}

/**
 * 创建“箭头头部 + 后置横杆”的液体箭头，入口/出口共享同一包围盒。
 *
 * - totalHeight = arrowHeadHeight + gap + blockHeight
 * - width 是三角头底边宽度
 * - blockWidth 是横杆宽度
 * - blockHeight 是横杆厚度
 *
 * 出口朝上：三角形在上、横杆在下
 * 入口朝下：横杆在上、三角形在下
 */
export function createArrowTriangleBlock({
  centerX,
  topY,
  width,
  totalHeight,
  arrowHeadHeight,
  blockWidth,
  blockHeight,
  gap = 0,
  direction,
}) {
  const halfWidth = width / 2;
  const halfBlockWidth = blockWidth / 2;
  const triangleBottomY = topY + arrowHeadHeight;
  const blockTopY = triangleBottomY + gap;
  const blockBottomY = blockTopY + blockHeight;
  const downBarBottomY = topY + blockHeight;
  const downTriangleTopY = downBarBottomY + gap;
  const downTipY = topY + totalHeight;

  if (direction === 'up') {
    return [
      [
        [centerX, topY],
        [centerX - halfWidth, triangleBottomY],
        [centerX + halfWidth, triangleBottomY],
      ],
      [
        [centerX - halfBlockWidth, blockTopY],
        [centerX + halfBlockWidth, blockTopY],
        [centerX + halfBlockWidth, blockBottomY],
        [centerX - halfBlockWidth, blockBottomY],
      ],
    ];
  }

  if (direction === 'down') {
    return [
      [
        [centerX - halfBlockWidth, topY],
        [centerX + halfBlockWidth, topY],
        [centerX + halfBlockWidth, downBarBottomY],
        [centerX - halfBlockWidth, downBarBottomY],
      ],
      [
        [centerX, downTipY],
        [centerX - halfWidth, downTriangleTopY],
        [centerX + halfWidth, downTriangleTopY],
      ],
    ];
  }

  throw new Error(`Unsupported arrow direction: ${direction}`);
}

export async function renderPortChevronTexture({ outputFilePath, polygons }) {
  await mkdir(path.dirname(outputFilePath), { recursive: true });

  await sharp(Buffer.from(createSvgMarkup({ polygons })))
    .png()
    .toFile(outputFilePath);
}

export async function renderPortChevronTextureSet({
  scriptUrl,
  generatorName,
  textures,
}) {
  if (textures.length === 0) {
    console.log(`${generatorName}: no texture variants are configured yet.`);
    return [];
  }

  const outputDirectory = resolveOutputDirectory(scriptUrl, process.argv[2]);
  const outputFilePaths = [];

  for (const texture of textures) {
    const outputFilePath = path.join(outputDirectory, texture.fileName);
    await renderPortChevronTexture({
      outputFilePath,
      polygons: texture.polygons,
    });
    outputFilePaths.push(outputFilePath);
  }

  console.log(`${generatorName}: generated ${outputFilePaths.length} texture(s).`);
  for (const outputFilePath of outputFilePaths) {
    console.log(`- ${outputFilePath}`);
  }

  return outputFilePaths;
}