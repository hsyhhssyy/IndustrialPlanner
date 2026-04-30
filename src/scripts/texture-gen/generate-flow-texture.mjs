import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(scriptDirectory, '..', '..', '..');
const outputFilePath = path.resolve(
  process.argv[2] ?? path.join(projectRoot, 'public', 'textures', 'flow-glow.png'),
);

const TEXTURE_WIDTH = 256;
const TEXTURE_HEIGHT = 32;

/**
 * 高斯函数：exp(-(x - μ)² / (2σ²))
 * 返回归一化值 [0, 1]，峰值在 μ 处为 1
 */
function gaussian(x, mu, sigma) {
  const exponent = -((x - mu) ** 2) / (2 * sigma ** 2);
  return Math.exp(exponent);
}

/**
 * 创建流光特效 texture 的 RGBA 缓冲区。
 *
 * 横向 512×64，从左到右：
 *   透明 → 高斯渐变柔光 → 白色核心 → 高斯渐变柔光 → 透明
 * 亮度通过 alpha 通道（不透明度）表达，颜色固定为白色。
 */
function createFlowTextureBuffer() {
  const pixelCount = TEXTURE_WIDTH * TEXTURE_HEIGHT;
  const textureBuffer = Buffer.alloc(pixelCount * 4, 0);

  const centerX = (TEXTURE_WIDTH - 1) / 2;
  // sigma 控制柔光扩散范围：3σ ≈ 半宽时边缘 alpha 趋近于 0
  const sigma = TEXTURE_WIDTH / 6;

  for (let y = 0; y < TEXTURE_HEIGHT; y += 1) {
    for (let x = 0; x < TEXTURE_WIDTH; x += 1) {
      // alpha = gaussian(x, centerX, sigma) 映射到 [0, 255]
      const alpha = Math.round(gaussian(x, centerX, sigma) * 255);

      if (alpha === 0) {
        continue; // 全透明像素保持默认 0
      }

      const pixelOffset = (y * TEXTURE_WIDTH + x) * 4;
      textureBuffer[pixelOffset] = 255;     // R - 白色
      textureBuffer[pixelOffset + 1] = 255; // G
      textureBuffer[pixelOffset + 2] = 255; // B
      textureBuffer[pixelOffset + 3] = alpha; // A - 高斯渐变不透明度
    }
  }

  return textureBuffer;
}

async function main() {
  await mkdir(path.dirname(outputFilePath), { recursive: true });

  await sharp(createFlowTextureBuffer(), {
    raw: {
      width: TEXTURE_WIDTH,
      height: TEXTURE_HEIGHT,
      channels: 4,
    },
  })
    .png()
    .toFile(outputFilePath);

  console.log(`Generated flow-glow texture (${TEXTURE_WIDTH}×${TEXTURE_HEIGHT}) at ${outputFilePath}`);
}

main().catch((error) => {
  console.error('Failed to generate flow-glow texture.');
  console.error(error);
  process.exitCode = 1;
});
