import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(SCRIPT_DIR, '..', '..', '..');

const SPRITE_DIR = path.join(PROJECT_ROOT, 'public', 'blueprint-view', 'sprites');
const OUTPUT_DIR = path.join(PROJECT_ROOT, 'public', 'textures');
const CELL_SIZE = 128;

// 亮度阈值：介于这两个值之间的像素视为内腔（排除纯黑管壁和纯白背景）
const CHANNEL_BRIGHTNESS_MIN = 20;
const CHANNEL_BRIGHTNESS_MAX = 240;

async function main() {
  await mkdir(OUTPUT_DIR, { recursive: true });

  // --- 直管液体贴图：内腔矩形 y=53~76，全宽 ---
  const straightRect = `<rect x="0" y="53" width="128" height="24" fill="white"/>`;
  const straightSvg = `<svg width="128" height="128" xmlns="http://www.w3.org/2000/svg">${straightRect}</svg>`;
  const straightPath = path.join(OUTPUT_DIR, 'pipe_straight_1x1_liquid.png');
  await sharp(Buffer.from(straightSvg)).png().toFile(straightPath);
  console.log(`  ✓ ${path.relative(PROJECT_ROOT, straightPath)}`);

  // --- 弯管液体贴图：从任意一个弯管贴图检测内腔 ---
  // 两个弯管的内腔形状完全相同（差异仅在外壁），贴图可共用
  const turnSpritePath = path.join(SPRITE_DIR, 'pipe_turn_cw_1x1.png');
  const turnBuffer = await generateTurnLiquidBuffer(turnSpritePath);

  const turnCwPath = path.join(OUTPUT_DIR, 'pipe_turn_cw_1x1_liquid.png');
  const turnCcwPath = path.join(OUTPUT_DIR, 'pipe_turn_ccw_1x1_liquid.png');

  await sharp(turnBuffer, { raw: { width: CELL_SIZE, height: CELL_SIZE, channels: 4 } })
    .png().toFile(turnCwPath);
  await sharp(turnBuffer, { raw: { width: CELL_SIZE, height: CELL_SIZE, channels: 4 } })
    .png().toFile(turnCcwPath);

  console.log(`  ✓ ${path.relative(PROJECT_ROOT, turnCwPath)}`);
  console.log(`  ✓ ${path.relative(PROJECT_ROOT, turnCcwPath)}`);

  console.log('\nAll pipe liquid textures generated.');
}

/**
 * 从弯管贴图检测内腔像素，返回 RGBA 缓冲区
 * 内腔 = 亮度在 CHANNEL_BRIGHTNESS_MIN ~ CHANNEL_BRIGHTNESS_MAX 之间的像素
 * 两个弯管（cw/ccw）的内腔形状相同，共用生成结果
 */
async function generateTurnLiquidBuffer(spritePath) {
  const { data, info } = await sharp(spritePath)
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });

  const outData = Buffer.alloc(info.width * info.height * 4, 0);

  for (let i = 0; i < data.length; i += 4) {
    const brightness = (data[i] + data[i + 1] + data[i + 2]) / 3;

    if (brightness > CHANNEL_BRIGHTNESS_MIN && brightness < CHANNEL_BRIGHTNESS_MAX) {
      outData[i] = 255;     // R
      outData[i + 1] = 255; // G
      outData[i + 2] = 255; // B
      outData[i + 3] = 255; // A
    }
  }

  return outData;
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
