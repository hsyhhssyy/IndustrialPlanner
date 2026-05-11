import { execSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));

const generators = [
  'generate-blueprint-mask.mjs',
  'generate-scanline-texture.mjs',
  'generate-liquid-port-chevron.mjs',
  'generate-solid-port-chevron.mjs',
  'generate-flow-texture.mjs',
  'generate-belt-highlight-strip-texture.mjs',
  'generate-belt-sprites.mjs',
];

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
