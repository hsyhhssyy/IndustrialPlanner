import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const CELL_SIZE = 128;
const DEVICE_BORDER_INSET = CELL_SIZE / 5;
const DEVICE_BORDER_STROKE_WIDTH = 2;
// Temporary editing aids only. Future drawing steps will remove this background
// and grid, so generated artwork must not depend on either color or the grid.
const DEVELOPMENT_BACKGROUND_COLOR = '#e5e5e5';
const DEVELOPMENT_GRID_LINE_COLOR = '#4a4a4a';
const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(scriptDirectory, '..', '..');
const outputDirectory = path.resolve(projectRoot, '.temp', 'device-blueprint-svgs');

void main();

async function main() {
  try {
    const deviceId = parseDeviceId(process.argv.slice(2));
    if (deviceId === null) {
      process.exitCode = 1;
      return;
    }

    const definition = await loadDeviceDefinition(deviceId);
    const svgMarkup = createDeviceBlueprintSvg(definition);
    const outputFilePath = path.join(outputDirectory, `${deviceId}.svg`);

    await mkdir(outputDirectory, { recursive: true });
    await writeFile(outputFilePath, `${svgMarkup}\n`, 'utf8');

    console.log(`Wrote ${path.relative(projectRoot, outputFilePath)}`);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(message);
    process.exitCode = 1;
  }
}

function parseDeviceId(argv) {
  const [deviceId] = argv;

  if (typeof deviceId === 'string' && deviceId.length > 0) {
    return deviceId;
  }

  console.error('Usage: npm run draw-device-blueprint-svg -- <device-id>');
  return null;
}

async function loadDeviceDefinition(deviceId) {
  const registryContract = await loadRegistryContract();
  const definition = registryContract.entityDefinitions.find((item) => item.id === deviceId) ?? null;

  if (definition === null) {
    throw new Error(`Unknown device id: ${deviceId}`);
  }

  return definition;
}

async function loadRegistryContract() {
  try {
    const registryModule = await import('../registry/index.ts');
    return registryModule.createRegistryContract();
  } catch (error) {
    throw new Error(
      'Failed to load the TypeScript registry. Run this script through "npm run draw-device-blueprint-svg -- <device-id>".',
      { cause: error },
    );
  }
}

function createDeviceBlueprintSvg(definition) {
  const width = definition.footprint.width * CELL_SIZE;
  const height = definition.footprint.height * CELL_SIZE;
  const borderMarkup = createDeviceBorderMarkup(width, height);

  return [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" fill="none">`,
    '  <defs>',
    '    <style>',
    `      .canvas-background { fill: ${DEVELOPMENT_BACKGROUND_COLOR}; }`,
    `      .cell-guide { fill: none; stroke: ${DEVELOPMENT_GRID_LINE_COLOR}; stroke-width: 1; }`,
    '      .device-border { fill: none; stroke: #000000; stroke-width: 2; }',
    '    </style>',
    '  </defs>',
    '  <!-- Temporary editing aids only: do not depend on this background or grid. -->',
    `  <rect class="canvas-background" x="0" y="0" width="${width}" height="${height}" />`,
    ...createCellGuideMarkup(definition.footprint),
    '  <g id="device-blueprint-shape">',
    borderMarkup,
    '  </g>',
    '</svg>',
  ].join('\n');
}

function createDeviceBorderMarkup(width, height) {
  const borderWidth = width - DEVICE_BORDER_INSET * 2;
  const borderHeight = height - DEVICE_BORDER_INSET * 2;

  return `    <rect class="device-border" x="${DEVICE_BORDER_INSET}" y="${DEVICE_BORDER_INSET}" width="${borderWidth}" height="${borderHeight}" />`;
}

function createCellGuideMarkup(footprint) {
  const guides = [];

  for (let cellY = 0; cellY < footprint.height; cellY += 1) {
    for (let cellX = 0; cellX < footprint.width; cellX += 1) {
      guides.push(
        `  <rect class="cell-guide" x="${cellX * CELL_SIZE}" y="${cellY * CELL_SIZE}" width="${CELL_SIZE}" height="${CELL_SIZE}" />`,
      );
    }
  }

  return guides;
}