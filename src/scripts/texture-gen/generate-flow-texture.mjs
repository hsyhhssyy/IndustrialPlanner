import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(scriptDirectory, '..', '..', '..');
const outputFilePath = path.resolve(
  process.argv[2] ?? path.join(projectRoot, 'public', 'textures', 'flow-glow.webp'),
);

const TEXTURE_WIDTH = 512;
const TEXTURE_HEIGHT = 512;

/**
 * 创建流光特效 texture 的 RGBA 缓冲区。
 *
 * 512×512，从中心向左右两侧发出扇形光：
 *   - 中心白色核心最亮
 *   - 沿水平轴向两侧扇开（总张角约 60°）
 *   - 径向高斯衰减：离中心越远越暗
 *   - 角度高斯衰减：偏离主轴越远越暗
 * 亮度通过 alpha 通道表达，颜色固定为白色。
 */
function createFlowTextureBuffer() {
  const pixelCount = TEXTURE_WIDTH * TEXTURE_HEIGHT;
  const textureBuffer = Buffer.alloc(pixelCount * 4, 0);

  const cx = (TEXTURE_WIDTH - 1) / 2;
  const cy = (TEXTURE_HEIGHT - 1) / 2;

  // 径向 sigma：控制光束延伸距离，σ ≈ 纹理半宽的 1/3
  const radialSigma = TEXTURE_WIDTH / 6;
  // 角度 sigma：控制扇形张角，约 30°（π/6）使得边缘合理衰减
  const angularSigma = Math.PI / 12; // 15°

  for (let y = 0; y < TEXTURE_HEIGHT; y += 1) {
    for (let x = 0; x < TEXTURE_WIDTH; x += 1) {
      const dx = x - cx;
      const dy = y - cy;

      const dist = Math.sqrt(dx * dx + dy * dy);
      // 角度偏离量：取与主轴（水平轴，0° / 180°）的最小夹角
      const absAngle = Math.abs(Math.atan2(dy, dx));
      const angleDeviation = Math.min(absAngle, Math.PI - absAngle);

      // 径向衰减
      const radialAlpha = Math.exp(-(dist * dist) / (2 * radialSigma * radialSigma));
      // 角度衰减
      const angularAlpha = Math.exp(-(angleDeviation * angleDeviation) / (2 * angularSigma * angularSigma));

      const alpha = Math.round(radialAlpha * angularAlpha * 255);

      if (alpha === 0) {
        continue; // 全透明像素保持默认 0
      }

      const pixelOffset = (y * TEXTURE_WIDTH + x) * 4;
      textureBuffer[pixelOffset] = 255;       // R - 白色
      textureBuffer[pixelOffset + 1] = 255;   // G
      textureBuffer[pixelOffset + 2] = 255;   // B
      textureBuffer[pixelOffset + 3] = alpha; // A - 渐变不透明度
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
    .webp({ lossless: true, effort: 6 })
    .toFile(outputFilePath);

  console.log(`Generated flow-glow texture (${TEXTURE_WIDTH}×${TEXTURE_HEIGHT}) at ${outputFilePath}`);
}

main().catch((error) => {
  console.error('Failed to generate flow-glow texture.');
  console.error(error);
  process.exitCode = 1;
});
