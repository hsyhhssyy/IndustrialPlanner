import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(scriptDirectory, '..', '..', '..');
const outputFilePath = path.resolve(
  process.argv[2] ?? path.join(projectRoot, 'public', 'textures', 'blueprint-mask-80opacity.png'),
);

// ── 蓝图配色 ──────────────────────────────────────────────
const TILE_SIZE     = 64;
const OPACITY       = Math.round(255 * 0.8);   // 80% 不透明度 → alpha=204

const BG_COLOR      = [ 10,  30,  80, OPACITY];  // 深蓝图底色
const MAJOR_GRID    = [ 80, 140, 220, OPACITY];  // 主网格线（16px）
const MINOR_GRID    = [ 50, 100, 170, OPACITY];  // 辅网格线（8px）
const CROSSHAIR     = [180, 210, 255, OPACITY];  // 十字准星标记

const MAJOR_STEP    = 16;  // 主网格间距
const MINOR_STEP    = 8;   // 辅网格间距
const CROSS_RADIUS  = 2;   // 十字准星半长

// ── 工具 ──────────────────────────────────────────────────
function positiveModulo(value, divisor) {
  return ((value % divisor) + divisor) % divisor;
}

/** 在 tile 的 (x, y) 位置绘制指定颜色 */
function setPixel(buf, x, y, [r, g, b, a]) {
  const offset = (y * TILE_SIZE + x) * 4;
  buf[offset]     = r;
  buf[offset + 1] = g;
  buf[offset + 2] = b;
  buf[offset + 3] = a;
}

/** 判断像素是否在主网格线上（含边界，保证可平铺时左右/上下衔接） */
function isMajorGrid(x, y) {
  return positiveModulo(x, MAJOR_STEP) === 0 || positiveModulo(y, MAJOR_STEP) === 0;
}

/** 判断像素是否在辅网格线上 */
function isMinorGrid(x, y) {
  return positiveModulo(x, MINOR_STEP) === 0 || positiveModulo(y, MINOR_STEP) === 0;
}

/** 判断像素是否属于十字准星（以主网格交叉点为中心，支持跨边界平铺） */
function isCrosshair(x, y) {
  // 检查 x 方向最近的 3 个交叉点（跨越左右边界）
  for (let cxOff = -MAJOR_STEP; cxOff <= MAJOR_STEP; cxOff += MAJOR_STEP) {
    const cx = Math.round(x / MAJOR_STEP) * MAJOR_STEP + cxOff;
    const dxAbs = Math.abs(x - cx);
    if (dxAbs > CROSS_RADIUS) continue;

    // 同理检查 y 方向
    for (let cyOff = -MAJOR_STEP; cyOff <= MAJOR_STEP; cyOff += MAJOR_STEP) {
      const cy = Math.round(y / MAJOR_STEP) * MAJOR_STEP + cyOff;
      const dyAbs = Math.abs(y - cy);
      if (dyAbs > CROSS_RADIUS) continue;

      // 十字准星：水平线或竖直线穿过中心
      if (dyAbs === 0 || dxAbs === 0) return true;
    }
  }
  return false;
}

// ── 生成像素缓冲 ──────────────────────────────────────────
function createTextureBuffer() {
  const buf = Buffer.alloc(TILE_SIZE * TILE_SIZE * 4, 0);

  for (let y = 0; y < TILE_SIZE; y += 1) {
    for (let x = 0; x < TILE_SIZE; x += 1) {
      // 绘制优先级：十字准星 > 主网格 > 辅网格 > 背景
      if (isCrosshair(x, y)) {
        setPixel(buf, x, y, CROSSHAIR);
      } else if (isMajorGrid(x, y)) {
        setPixel(buf, x, y, MAJOR_GRID);
      } else if (isMinorGrid(x, y)) {
        setPixel(buf, x, y, MINOR_GRID);
      } else {
        setPixel(buf, x, y, BG_COLOR);
      }
    }
  }

  return buf;
}

// ── 入口 ──────────────────────────────────────────────────
async function main() {
  await mkdir(path.dirname(outputFilePath), { recursive: true });

  await sharp(createTextureBuffer(), {
    raw: {
      width: TILE_SIZE,
      height: TILE_SIZE,
      channels: 4,
    },
  })
    .png()
    .toFile(outputFilePath);

  console.log(`Generated blueprint mask tile at ${outputFilePath}`);
}

main().catch((error) => {
  console.error('Failed to generate blueprint mask texture.');
  console.error(error);
  process.exitCode = 1;
});
