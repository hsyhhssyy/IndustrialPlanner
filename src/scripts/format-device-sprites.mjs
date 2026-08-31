import { access, copyFile, mkdir, readdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(scriptDirectory, '..', '..');
const defaultSourceDirectory = path.join(projectRoot, 'public', '3d-top-view', 'sprites');
const defaultOutputDirectory = path.join(projectRoot, 'public', '3d-top-view', 'sprite-masks');
const defaultOverrideDirectory = path.join(projectRoot, 'resources', 'device-sprite-mask-overrides');

async function collectWebpFiles(directoryPath) {
  const entries = await readdir(directoryPath, { withFileTypes: true });
  const sortedEntries = entries.sort((left, right) => left.name.localeCompare(right.name));
  const files = await Promise.all(
    sortedEntries.map(async (entry) => {
      const entryPath = path.join(directoryPath, entry.name);

      if (entry.isDirectory()) {
        return collectWebpFiles(entryPath);
      }

      if (entry.isFile() && entry.name.toLowerCase().endsWith('.webp')) {
        return [entryPath];
      }

      return [];
    }),
  );

  return files.flat();
}

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

async function fileExists(filePath) {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function convertSpriteToMask(sourceFilePath, sourceDirectory, outputDirectory, overrideDirectory) {
  const relativeFilePath = path.relative(sourceDirectory, sourceFilePath);
  const outputFilePath = path.join(outputDirectory, relativeFilePath);
  const overrideFilePath = path.join(overrideDirectory, relativeFilePath);

  await mkdir(path.dirname(outputFilePath), { recursive: true });

  if (await fileExists(overrideFilePath)) {
    await copyFile(overrideFilePath, outputFilePath);
    return { outputFilePath, source: 'override' };
  }

  const { data, info } = await sharp(sourceFilePath)
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
    .toFile(outputFilePath);

  return { outputFilePath, source: 'generated' };
}

async function main() {
  const sourceDirectory = path.resolve(process.argv[2] ?? defaultSourceDirectory);
  const outputDirectory = path.resolve(process.argv[3] ?? defaultOutputDirectory);
  const overrideDirectory = path.resolve(process.argv[4] ?? defaultOverrideDirectory);
  const sourceFiles = await collectWebpFiles(sourceDirectory);

  if (sourceFiles.length === 0) {
    console.log(`No .webp files found in ${sourceDirectory}`);
    return;
  }

  let overrideCount = 0;
  for (const sourceFilePath of sourceFiles) {
    const result = await convertSpriteToMask(
      sourceFilePath,
      sourceDirectory,
      outputDirectory,
      overrideDirectory,
    );
    if (result.source === 'override') {
      overrideCount += 1;
    }
  }

  console.log(`Generated ${sourceFiles.length - overrideCount} sprite masks and copied ${overrideCount} overrides in ${outputDirectory}`);
}

main().catch((error) => {
  console.error('Failed to format device sprites.');
  console.error(error);
  process.exitCode = 1;
});
