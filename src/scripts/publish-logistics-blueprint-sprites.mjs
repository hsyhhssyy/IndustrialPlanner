import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';
import {
  DEFAULT_BLUEPRINT_ASSET_TRIM_PX,
  DIRECT_BLUEPRINT_SPRITE_MAPPINGS,
} from './blueprint-direct-sprite-mappings.mjs';

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(scriptDirectory, '..', '..');
const blueprintAssetDirectory = path.resolve(projectRoot, '.temp', '解包素材库', '设备蓝图资源');
const defaultOutputDirectory = path.resolve(projectRoot, 'public', 'blueprint-view', 'sprites');

void main();

async function main() {
  try {
    const outputDirectory = resolveOutputDirectory(process.argv[2]);

    await mkdir(outputDirectory, { recursive: true });

    for (const mapping of DIRECT_BLUEPRINT_SPRITE_MAPPINGS) {
      const sourceFilePath = path.join(blueprintAssetDirectory, mapping.assetFileName);
      const outputFilePath = path.join(outputDirectory, `${mapping.spriteId}.png`);

      await publishTrimmedBlueprintSprite(
        sourceFilePath,
        outputFilePath,
        mapping.trimPx ?? DEFAULT_BLUEPRINT_ASSET_TRIM_PX,
        mapping.rotationDegrees ?? 0,
      );
      console.log(`Wrote ${path.relative(projectRoot, outputFilePath)}`);
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(message);
    process.exitCode = 1;
  }
}

function resolveOutputDirectory(outputDirectoryArgument) {
  if (typeof outputDirectoryArgument === 'string' && outputDirectoryArgument.length > 0) {
    return path.resolve(outputDirectoryArgument);
  }

  return defaultOutputDirectory;
}

async function publishTrimmedBlueprintSprite(sourceFilePath, outputFilePath, trimPx, rotationDegrees) {
  const metadata = await sharp(sourceFilePath).metadata();

  if (typeof metadata.width !== 'number' || typeof metadata.height !== 'number') {
    throw new Error(`Failed to read blueprint asset metadata: ${path.basename(sourceFilePath)}`);
  }

  const trimmedWidth = metadata.width - trimPx * 2;
  const trimmedHeight = metadata.height - trimPx * 2;

  if (trimmedWidth <= 0 || trimmedHeight <= 0) {
    throw new Error(`Blueprint asset is too small to trim: ${path.basename(sourceFilePath)}`);
  }

  const pipeline = sharp(sourceFilePath)
    .extract({
      left: trimPx,
      top: trimPx,
      width: trimmedWidth,
      height: trimmedHeight,
    });

  if (rotationDegrees !== 0) {
    pipeline.rotate(rotationDegrees, {
      background: { r: 0, g: 0, b: 0, alpha: 0 },
    });
  }

  await pipeline.png().toFile(outputFilePath);
}