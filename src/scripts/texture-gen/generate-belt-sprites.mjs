import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(scriptDirectory, '..', '..', '..');
const outputSpriteDirectory = path.resolve(
  process.argv[2] ?? path.join(projectRoot, 'public', '3d-top-view', 'sprites'),
);
const outputMaskDirectory = path.resolve(
  process.argv[3] ?? path.join(projectRoot, 'public', '3d-top-view', 'sprite-masks'),
);

const SPRITE_SIZE = 256;
const LOGISTICS_SPRITE_SPECS = [
  {
    label: 'belt',
    straightSpriteId: 'belt_straight_1x1',
    turnSpriteIds: [
      'belt_turn_cw_1x1',
      'belt_turn_ccw_1x1',
    ],
    sideInset: SPRITE_SIZE * 0.05,
    fillColor: '#ffffff',
    fillOpacity: 0.50,
    edgeColor: '#ffffff',
    edgeWidth: Math.max(6, Math.round(SPRITE_SIZE * 0.035)),
  },
  {
    label: 'pipe',
    straightSpriteId: 'pipe_straight_1x1',
    turnSpriteIds: [
      'pipe_turn_cw_1x1',
      'pipe_turn_ccw_1x1',
    ],
    sideInset: SPRITE_SIZE * 0.3,
    fillColor: '#ffffff',
    fillOpacity: 0.56,
    edgeColor: '#000000',
    edgeWidth: Math.max(4, Math.round(SPRITE_SIZE * 0.024)),
  },
];

function createMaskBuffer(sourceBuffer, width, height, channels) {
  const pixelCount = width * height;
  const maskBuffer = Buffer.alloc(pixelCount * 4);

  for (let pixelIndex = 0; pixelIndex < pixelCount; pixelIndex += 1) {
    const alpha = sourceBuffer[pixelIndex * channels + 3];
    const outputOffset = pixelIndex * 4;

    maskBuffer[outputOffset] = alpha;
    maskBuffer[outputOffset + 1] = alpha;
    maskBuffer[outputOffset + 2] = alpha;
    maskBuffer[outputOffset + 3] = 255;
  }

  return maskBuffer;
}

function createStraightLogisticsSvg(spec) {
  const bandY = spec.sideInset;
  const bandHeight = SPRITE_SIZE - spec.sideInset * 2;
  const bottomEdgeY = bandY + bandHeight - spec.edgeWidth;

  return `
    <svg xmlns="http://www.w3.org/2000/svg" width="${SPRITE_SIZE}" height="${SPRITE_SIZE}" viewBox="0 0 ${SPRITE_SIZE} ${SPRITE_SIZE}">
      <rect
        x="0"
        y="${bandY}"
        width="${SPRITE_SIZE}"
        height="${bandHeight}"
        fill="${spec.fillColor}"
        fill-opacity="${spec.fillOpacity}"
      />
      <rect
        x="0"
        y="${bandY}"
        width="${SPRITE_SIZE}"
        height="${spec.edgeWidth}"
        fill="${spec.edgeColor}"
      />
      <rect
        x="0"
        y="${bottomEdgeY}"
        width="${SPRITE_SIZE}"
        height="${spec.edgeWidth}"
        fill="${spec.edgeColor}"
      />
    </svg>
  `;
}

function createTurnLogisticsSvg(spec) {
  // 订正（2026-05-10）：3d-top 的基础 turn sprite 只表达管线/带体几何，
  // 不表达流向；在当前基准下，cw(E→N) 与 ccw(N→E) 共用同一张右上角四分之一圆弧轮廓。
  // 订正（2026-05-10）：turn 条带需要填充 tile 内“位于外圆以内、内圆以外”的区域；
  // 不能直接用 top/right 边界把两条弧连起来，否则会变成贴着右上角的一条窄弧带。
  const centerX = SPRITE_SIZE;
  const centerY = 0;
  const outerRadius = SPRITE_SIZE - spec.sideInset;
  const innerRadius = spec.sideInset;
  const edgeInset = spec.edgeWidth / 2;
  const outerEdgeRadius = outerRadius - edgeInset;
  const innerEdgeRadius = innerRadius + edgeInset;

  const outerStartX = SPRITE_SIZE - outerRadius;
  const outerEndY = outerRadius;
  const innerStartX = SPRITE_SIZE - innerRadius;
  const innerEndY = innerRadius;
  const outerEdgeStartX = SPRITE_SIZE - outerEdgeRadius;
  const outerEdgeEndY = outerEdgeRadius;
  const innerEdgeStartX = SPRITE_SIZE - innerEdgeRadius;
  const innerEdgeEndY = innerEdgeRadius;

  const outerShellPath = [
    `M ${outerStartX} 0`,
    `H ${SPRITE_SIZE}`,
    `V ${outerEndY}`,
    `A ${outerRadius} ${outerRadius} 0 0 1 ${outerStartX} 0`,
    'Z',
  ].join(' ');

  const innerHolePath = [
    `M ${innerStartX} 0`,
    `H ${SPRITE_SIZE}`,
    `V ${innerEndY}`,
    `A ${innerRadius} ${innerRadius} 0 0 1 ${innerStartX} 0`,
    'Z',
  ].join(' ');

  const outerEdgePath = [
    `M ${outerEdgeStartX} 0`,
    `A ${outerEdgeRadius} ${outerEdgeRadius} 0 0 0 ${centerX} ${outerEdgeEndY}`,
  ].join(' ');

  const innerEdgePath = [
    `M ${innerEdgeStartX} 0`,
    `A ${innerEdgeRadius} ${innerEdgeRadius} 0 0 0 ${centerX} ${innerEdgeEndY}`,
  ].join(' ');

  return `
    <svg xmlns="http://www.w3.org/2000/svg" width="${SPRITE_SIZE}" height="${SPRITE_SIZE}" viewBox="0 0 ${SPRITE_SIZE} ${SPRITE_SIZE}">
      <path
        d="${outerShellPath} ${innerHolePath}"
        fill="${spec.fillColor}"
        fill-opacity="${spec.fillOpacity}"
        fill-rule="evenodd"
      />
      <path
        d="${outerEdgePath}"
        fill="none"
        stroke="${spec.edgeColor}"
        stroke-width="${spec.edgeWidth}"
        stroke-linecap="butt"
      />
      <path
        d="${innerEdgePath}"
        fill="none"
        stroke="${spec.edgeColor}"
        stroke-width="${spec.edgeWidth}"
        stroke-linecap="butt"
      />
    </svg>
  `;
}

async function writeSpriteAndMask(spriteId, svgMarkup) {
  const svgBuffer = Buffer.from(svgMarkup);
  const spriteOutputFilePath = path.join(outputSpriteDirectory, `${spriteId}.webp`);
  const maskOutputFilePath = path.join(outputMaskDirectory, `${spriteId}.webp`);

  await sharp(svgBuffer)
    .webp({ lossless: true })
    .toFile(spriteOutputFilePath);

  const { data, info } = await sharp(svgBuffer)
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  const maskBuffer = createMaskBuffer(data, info.width, info.height, info.channels);

  await sharp(maskBuffer, {
    raw: {
      width: info.width,
      height: info.height,
      channels: 4,
    },
  })
    .webp({ lossless: true })
    .toFile(maskOutputFilePath);

  return {
    spriteOutputFilePath,
    maskOutputFilePath,
  };
}

async function main() {
  await mkdir(outputSpriteDirectory, { recursive: true });
  await mkdir(outputMaskDirectory, { recursive: true });

  for (const spec of LOGISTICS_SPRITE_SPECS) {
    const straightOutputs = await writeSpriteAndMask(
      spec.straightSpriteId,
      createStraightLogisticsSvg(spec),
    );
    console.log(`Generated ${spec.straightSpriteId} sprite (${SPRITE_SIZE}x${SPRITE_SIZE}) at ${straightOutputs.spriteOutputFilePath}`);
    console.log(`Generated ${spec.straightSpriteId} mask (${SPRITE_SIZE}x${SPRITE_SIZE}) at ${straightOutputs.maskOutputFilePath}`);

    const turnSvg = createTurnLogisticsSvg(spec);
    for (const spriteId of spec.turnSpriteIds) {
      const turnOutputs = await writeSpriteAndMask(spriteId, turnSvg);
      console.log(`Generated ${spriteId} sprite (${SPRITE_SIZE}x${SPRITE_SIZE}) at ${turnOutputs.spriteOutputFilePath}`);
      console.log(`Generated ${spriteId} mask (${SPRITE_SIZE}x${SPRITE_SIZE}) at ${turnOutputs.maskOutputFilePath}`);
    }
  }
}

main().catch((error) => {
  console.error('Failed to generate logistics sprites.');
  console.error(error);
  process.exitCode = 1;
});