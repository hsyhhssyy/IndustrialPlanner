import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(scriptDirectory, '..', '..', '..');
const outputFilePath = path.resolve(
  process.argv[2] ?? path.join(projectRoot, 'public', 'textures', 'belt-highlight-strip-texture.webp'),
);

const TEXTURE_WIDTH = 256;
const TEXTURE_HEIGHT = 128;
const CORE_WIDTH = TEXTURE_WIDTH * 3 / 16;
const CORE_HALF_WIDTH = CORE_WIDTH / 2;
const CENTER_X = (TEXTURE_WIDTH - 1) / 2;
const MAX_HORIZONTAL_DISTANCE = CENTER_X;
const GLOW_FADE_DISTANCE = MAX_HORIZONTAL_DISTANCE - CORE_HALF_WIDTH;
const FADE_CURVE_POWER = 1.8;

function createBeltHighlightStripTextureBuffer() {
  const textureBuffer = Buffer.alloc(TEXTURE_WIDTH * TEXTURE_HEIGHT * 4, 0);

  for (let y = 0; y < TEXTURE_HEIGHT; y += 1) {
    for (let x = 0; x < TEXTURE_WIDTH; x += 1) {
      const horizontalDistance = Math.abs(x - CENTER_X);

      let alpha = 0;

      if (horizontalDistance <= CORE_HALF_WIDTH) {
        alpha = 255;
      } else if (horizontalDistance < MAX_HORIZONTAL_DISTANCE) {
        const fadeProgress = (horizontalDistance - CORE_HALF_WIDTH) / GLOW_FADE_DISTANCE;
        const inverseFade = 1 - fadeProgress;
        const curvedFade = inverseFade ** FADE_CURVE_POWER;
        alpha = Math.round(curvedFade * 255);
      }

      if (alpha === 0) {
        continue;
      }

      const pixelOffset = (y * TEXTURE_WIDTH + x) * 4;
      textureBuffer[pixelOffset] = 255;
      textureBuffer[pixelOffset + 1] = 255;
      textureBuffer[pixelOffset + 2] = 255;
      textureBuffer[pixelOffset + 3] = alpha;
    }
  }

  return textureBuffer;
}

async function main() {
  await mkdir(path.dirname(outputFilePath), { recursive: true });

  await sharp(createBeltHighlightStripTextureBuffer(), {
    raw: {
      width: TEXTURE_WIDTH,
      height: TEXTURE_HEIGHT,
      channels: 4,
    },
  })
    .webp({ lossless: true, effort: 6 })
    .toFile(outputFilePath);

  console.log(`Generated belt highlight strip texture (${TEXTURE_WIDTH}×${TEXTURE_HEIGHT}) at ${outputFilePath}`);
}

main().catch((error) => {
  console.error('Failed to generate belt highlight strip texture.');
  console.error(error);
  process.exitCode = 1;
});
