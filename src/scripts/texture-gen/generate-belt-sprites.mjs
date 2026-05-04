import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(scriptDirectory, '..', '..', '..');
const outputSpriteDirectory = path.resolve(
  process.argv[2] ?? path.join(projectRoot, 'public', 'sprites'),
);
const outputMaskDirectory = path.resolve(
  process.argv[3] ?? path.join(projectRoot, 'public', 'sprite-masks'),
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
    fillColor: '#f28c28',
    fillOpacity: 0.72,
    edgeColor: '#b45309',
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

function createTurnLogisticsSvg(spec, turnType) {
  const isCw = turnType === 'cw';

  // CW: bottom-left corner, curve from left to bottom (WEST→SOUTH)
  // CCW: top-left corner, curve from left to top (WEST→NORTH)
  const centerY = isCw ? SPRITE_SIZE : 0;
  const outerRadius = SPRITE_SIZE - spec.sideInset;
  const innerRadius = spec.sideInset;

  const outerStartY = isCw ? SPRITE_SIZE - outerRadius : outerRadius;
  const outerEndX = outerRadius;
  const innerStartY = isCw ? SPRITE_SIZE - innerRadius : innerRadius;
  const innerEndX = innerRadius;

  // Outer arc goes CW for CW turn (sweep=1), CCW for CCW turn (sweep=0)
  const outerSweep = isCw ? 1 : 0;
  // Inner arc goes the opposite direction to close the band
  const innerSweep = isCw ? 0 : 1;

  const fillPath = [
    `M 0 ${outerStartY}`,
    `A ${outerRadius} ${outerRadius} 0 0 ${outerSweep} ${outerEndX} ${centerY}`,
    `L ${innerEndX} ${centerY}`,
    `A ${innerRadius} ${innerRadius} 0 0 ${innerSweep} 0 ${innerStartY}`,
    'Z',
  ].join(' ');

  const outerEdgePath = [
    `M 0 ${outerStartY}`,
    `A ${outerRadius} ${outerRadius} 0 0 ${outerSweep} ${outerEndX} ${centerY}`,
  ].join(' ');

  const innerEdgePath = [
    `M 0 ${innerStartY}`,
    `A ${innerRadius} ${innerRadius} 0 0 ${outerSweep} ${innerEndX} ${centerY}`,
  ].join(' ');

  return `
    <svg xmlns="http://www.w3.org/2000/svg" width="${SPRITE_SIZE}" height="${SPRITE_SIZE}" viewBox="0 0 ${SPRITE_SIZE} ${SPRITE_SIZE}">
      <path
        d="${fillPath}"
        fill="${spec.fillColor}"
        fill-opacity="${spec.fillOpacity}"
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

    for (const [index, spriteId] of spec.turnSpriteIds.entries()) {
      const turnSvg = createTurnLogisticsSvg(spec, index === 0 ? 'cw' : 'ccw');
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