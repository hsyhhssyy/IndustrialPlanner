import { execSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));

const generators = [
  'generate-blueprint-mask.mjs',
  'generate-scanline-texture.mjs',
  'generate-liquid-port-chevron.mjs',
  'generate-solid-port-chevron.mjs',
  'generate-port-cross.mjs',
  'generate-flow-texture.mjs',
  'generate-belt-highlight-strip-texture.mjs',
];

// AI-REMOVED 2026-09-19:
// Reason: 物流精灵来自网站交付，不再有仓库内原件供通用纹理命令重建。
// Trigger: 用户要求网站展开素材只存在于 .temp/.trash 导入批次。
// Evidence: generate-belt-sprites 现在要求显式 BUILDING_ASSET_SOURCE_ROOT；正式入口为 import-building-assets。
// Replacement: .agents/skills/import-building-assets/SKILL.md。
// Risk: generate-textures 不再刷新物流精灵；需单独执行网站导入。
// Human Review: Required
//
// Original code:
// 'generate-belt-sprites.mjs',

let failed = 0;

for (const generator of generators) {
  const scriptPath = path.join(scriptDirectory, generator);
  console.log(`\n▶ Running ${generator}...`);
  try {
    execSync(`node "${scriptPath}"`, {
      cwd: path.resolve(scriptDirectory, '..', '..', '..'),
      stdio: 'inherit',
    });
    console.log(`✓ ${generator} done`);
  } catch {
    console.error(`✗ ${generator} failed`);
    failed += 1;
  }
}

if (failed > 0) {
  console.error(`\n${failed}/${generators.length} texture generators failed.`);
  process.exit(1);
}

console.log(`\nAll ${generators.length} texture generators completed successfully.`);
