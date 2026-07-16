#!/usr/bin/env node

/**
 * 将 public/blueprint-view/avatar 下的纯白色 avatar 转换为深灰色。
 *
 * 蓝图模式的 avatar 应为深灰色 (#7c7c7c = 124)，但部分新加入的图标仍然是纯白色。
 * 此脚本检查所有 avatar，对仅含纯白色的进行着色处理。
 *
 * 用法：
 *   node src/scripts/colorize-blueprint-avatars.mjs
 *   node src/scripts/colorize-blueprint-avatars.mjs --all   # 强制全部重新着色
 */

import { readdir, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const DARK_GRAY = 124; // 0x7c7c7c

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(scriptDirectory, '..', '..');
const avatarDir = path.join(projectRoot, 'public', 'blueprint-view', 'avatar');

async function isPureWhiteOnly(filePath) {
  const { data } = await sharp(filePath).raw().toBuffer({ resolveWithObject: true });
  for (let i = 0; i < data.length; i += 4) {
    const a = data[i + 3];
    if (a > 0 && data[i] !== 255) {
      return false;
    }
  }
  return true;
}

async function colorizeToDarkGray(sourcePath, outputPath) {
  await mkdir(path.dirname(outputPath), { recursive: true });

  const { data, info } = await sharp(sourcePath)
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });

  const pixelCount = info.width * info.height;
  const output = Buffer.alloc(pixelCount * 4);

  for (let i = 0; i < pixelCount; i++) {
    const srcOffset = i * 4;
    const alpha = data[srcOffset + 3];
    const dstOffset = i * 4;

    if (alpha > 0) {
      output[dstOffset] = DARK_GRAY;
      output[dstOffset + 1] = DARK_GRAY;
      output[dstOffset + 2] = DARK_GRAY;
    } else {
      output[dstOffset] = 0;
      output[dstOffset + 1] = 0;
      output[dstOffset + 2] = 0;
    }
    output[dstOffset + 3] = alpha;
  }

  await sharp(output, {
    raw: { width: info.width, height: info.height, channels: 4 },
  })
    .webp({ lossless: true, effort: 6 })
    .toFile(outputPath);

  return { width: info.width, height: info.height };
}

async function main() {
  const forceAll = process.argv.includes('--all');
  const files = (await readdir(avatarDir)).filter(f => f.endsWith('.webp')).sort();

  let converted = 0;
  let skipped = 0;

  for (const fileName of files) {
    const filePath = path.join(avatarDir, fileName);

    if (!forceAll && !(await isPureWhiteOnly(filePath))) {
      skipped++;
      continue;
    }

    const { width, height } = await colorizeToDarkGray(filePath, filePath);
    console.log(`  ${fileName}: ${width}x${height} → dark gray`);
    converted++;
  }

  console.log(`\nConverted: ${converted}, Skipped: ${skipped}`);
  console.log(`Total: ${files.length}`);
}

main().catch((error) => {
  console.error('Failed:', error);
  process.exitCode = 1;
});
