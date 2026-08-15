import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(scriptDirectory, '..', '..');
const sourceDirectory = path.join(projectRoot, '.temp', '素材库', '手工素材');

const DEFAULT_SOURCE_FILES = [
  '无限气图标.png',
  '无限箱图标.png',
  '无限水图标.png',
].map((fileName) => path.join(sourceDirectory, fileName));

// 背景颜色存在轻微的 253~255 灰度波动，因此使用颜色距离而不是精确白色匹配。
const BACKGROUND_DISTANCE_THRESHOLD = 32;
const FULLY_TRANSPARENT_DISTANCE = 5;

function colorDistance(data, offset, backgroundColor) {
  return Math.max(
    Math.abs(data[offset] - backgroundColor[0]),
    Math.abs(data[offset + 1] - backgroundColor[1]),
    Math.abs(data[offset + 2] - backgroundColor[2]),
  );
}

function estimateBackgroundColor(data, width, height, channels) {
  const borderPixels = [];
  const addPixel = (x, y) => {
    const offset = (y * width + x) * channels;
    borderPixels.push([data[offset], data[offset + 1], data[offset + 2]]);
  };

  for (let x = 0; x < width; x += 1) {
    addPixel(x, 0);
    addPixel(x, height - 1);
  }
  for (let y = 1; y < height - 1; y += 1) {
    addPixel(0, y);
    addPixel(width - 1, y);
  }

  const medianChannel = (channel) => {
    const values = borderPixels.map((pixel) => pixel[channel]).sort((left, right) => left - right);
    return values[Math.floor(values.length / 2)];
  };

  return [medianChannel(0), medianChannel(1), medianChannel(2)];
}

function removeConnectedBackground(data, width, height, channels) {
  const backgroundColor = estimateBackgroundColor(data, width, height, channels);
  const pixelCount = width * height;
  const visited = new Uint8Array(pixelCount);
  const queue = new Uint32Array(pixelCount);
  let queueStart = 0;
  let queueEnd = 0;

  const enqueueIfBackground = (pixelIndex) => {
    if (visited[pixelIndex] !== 0) {
      return;
    }

    const offset = pixelIndex * channels;
    if (colorDistance(data, offset, backgroundColor) > BACKGROUND_DISTANCE_THRESHOLD) {
      return;
    }

    visited[pixelIndex] = 1;
    queue[queueEnd] = pixelIndex;
    queueEnd += 1;
  };

  for (let x = 0; x < width; x += 1) {
    enqueueIfBackground(x);
    enqueueIfBackground((height - 1) * width + x);
  }
  for (let y = 1; y < height - 1; y += 1) {
    enqueueIfBackground(y * width);
    enqueueIfBackground(y * width + width - 1);
  }

  while (queueStart < queueEnd) {
    const pixelIndex = queue[queueStart];
    queueStart += 1;
    const x = pixelIndex % width;
    const y = Math.floor(pixelIndex / width);

    if (x > 0) {
      enqueueIfBackground(pixelIndex - 1);
    }
    if (x + 1 < width) {
      enqueueIfBackground(pixelIndex + 1);
    }
    if (y > 0) {
      enqueueIfBackground(pixelIndex - width);
    }
    if (y + 1 < height) {
      enqueueIfBackground(pixelIndex + width);
    }
  }

  let removedPixelCount = 0;
  for (let pixelIndex = 0; pixelIndex < pixelCount; pixelIndex += 1) {
    if (visited[pixelIndex] === 0) {
      continue;
    }

    const offset = pixelIndex * channels;
    const distance = colorDistance(data, offset, backgroundColor);
    if (distance <= FULLY_TRANSPARENT_DISTANCE) {
      data[offset] = 0;
      data[offset + 1] = 0;
      data[offset + 2] = 0;
      data[offset + 3] = 0;
      removedPixelCount += 1;
      continue;
    }

    // 输入边缘像素是“前景色 + 白色背景”的混合色，必须反混合 RGB，否则透明边缘会留下白边。
    const alpha = Math.max(
      (backgroundColor[0] - data[offset]) / backgroundColor[0],
      (backgroundColor[1] - data[offset + 1]) / backgroundColor[1],
      (backgroundColor[2] - data[offset + 2]) / backgroundColor[2],
    );
    const clampedAlpha = Math.max(0, Math.min(1, alpha));

    if (clampedAlpha === 0) {
      data[offset] = 0;
      data[offset + 1] = 0;
      data[offset + 2] = 0;
      data[offset + 3] = 0;
      removedPixelCount += 1;
      continue;
    }

    for (let channel = 0; channel < 3; channel += 1) {
      const foreground = (
        data[offset + channel]
        - backgroundColor[channel] * (1 - clampedAlpha)
      ) / clampedAlpha;
      data[offset + channel] = Math.max(0, Math.min(255, Math.round(foreground)));
    }
    data[offset + 3] = Math.round(clampedAlpha * 255);
    removedPixelCount += 1;
  }

  return { backgroundColor, removedPixelCount };
}

function resolveOutputPath(sourceFilePath, inPlace) {
  if (inPlace) {
    return sourceFilePath;
  }

  const parsedPath = path.parse(sourceFilePath);
  return path.join(parsedPath.dir, `${parsedPath.name}-透明${parsedPath.ext}`);
}

async function processImage(sourceFilePath, inPlace) {
  const { data, info } = await sharp(sourceFilePath)
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  const { backgroundColor, removedPixelCount } = removeConnectedBackground(
    data,
    info.width,
    info.height,
    info.channels,
  );
  const outputFilePath = resolveOutputPath(sourceFilePath, inPlace);

  await mkdir(path.dirname(outputFilePath), { recursive: true });
  await sharp(data, {
    raw: {
      width: info.width,
      height: info.height,
      channels: 4,
    },
  })
    .png({ compressionLevel: 9 })
    .toFile(outputFilePath);

  return { outputFilePath, backgroundColor, removedPixelCount };
}

function parseArguments() {
  const argumentsWithoutFlag = process.argv.slice(2);
  const inPlace = argumentsWithoutFlag.includes('--in-place');
  const sourceFiles = argumentsWithoutFlag.filter((argument) => argument !== '--in-place');

  return {
    inPlace,
    sourceFiles: sourceFiles.length > 0 ? sourceFiles.map((filePath) => path.resolve(filePath)) : DEFAULT_SOURCE_FILES,
  };
}

async function main() {
  const { inPlace, sourceFiles } = parseArguments();

  for (const sourceFilePath of sourceFiles) {
    const result = await processImage(sourceFilePath, inPlace);
    console.log(`Generated: ${result.outputFilePath}`);
    console.log(`Background: rgb(${result.backgroundColor.join(', ')})`);
    console.log(`Removed connected pixels: ${result.removedPixelCount}`);
  }
}

main().catch((error) => {
  console.error('Failed to remove white backgrounds.');
  console.error(error);
  process.exitCode = 1;
});
