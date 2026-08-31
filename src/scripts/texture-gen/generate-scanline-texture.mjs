import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(scriptDirectory, '..', '..', '..');
const outputFilePath = path.resolve(
  process.argv[2] ?? path.join(projectRoot, 'public', 'textures', 'scanline-45deg-50opacity.webp'),
);

const tileSize = 64;
const lineWidth = 2;
const gapWidth = 6;
const patternSize = lineWidth + gapWidth;
const lineColor = { red: 255, green: 255, blue: 255, alpha: 128 };

function positiveModulo(value, divisor) {
  return ((value % divisor) + divisor) % divisor;
}

function createTextureBuffer() {
  const textureBuffer = Buffer.alloc(tileSize * tileSize * 4, 0);

  for (let y = 0; y < tileSize; y += 1) {
    for (let x = 0; x < tileSize; x += 1) {
      const diagonalOffset = positiveModulo(x - y, patternSize);

      if (diagonalOffset >= lineWidth) {
        continue;
      }

      const pixelOffset = (y * tileSize + x) * 4;
      textureBuffer[pixelOffset] = lineColor.red;
      textureBuffer[pixelOffset + 1] = lineColor.green;
      textureBuffer[pixelOffset + 2] = lineColor.blue;
      textureBuffer[pixelOffset + 3] = lineColor.alpha;
    }
  }

  return textureBuffer;
}

async function main() {
  await mkdir(path.dirname(outputFilePath), { recursive: true });

  await sharp(createTextureBuffer(), {
    raw: {
      width: tileSize,
      height: tileSize,
      channels: 4,
    },
  })
    .webp({ lossless: true, effort: 6 })
    .toFile(outputFilePath);

  console.log(`Generated tileable scanline texture at ${outputFilePath}`);
}

main().catch((error) => {
  console.error('Failed to generate scanline texture.');
  console.error(error);
  process.exitCode = 1;
});
