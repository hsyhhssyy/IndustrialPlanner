// TEMPORARILY UNUSED 2026-05-09:
// This script is currently parked and should not be treated as an active
// production asset pipeline entry until it is explicitly resumed.

import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const CELL_SIZE = 128;
const DEVICE_BORDER_INSET_RATIO = 21 / 128;
const DEVICE_BORDER_INSET = CELL_SIZE * DEVICE_BORDER_INSET_RATIO;
const DEVICE_BORDER_STROKE_WIDTH = 4;
const FLUID_INPUT_OUTER_PORT_DIAMETER = CELL_SIZE;
const FLUID_INPUT_OUTER_PORT_RADIUS = FLUID_INPUT_OUTER_PORT_DIAMETER / 2;
const FLUID_INPUT_OUTER_PORT_STROKE_WIDTH = 2;
const FLUID_INPUT_CHEVRON_STROKE_WIDTH = 8;
const FLUID_INPUT_CHEVRON_WIDTH = CELL_SIZE / 3;
const FLUID_INPUT_CHEVRON_HEIGHT = CELL_SIZE / 8;
const FLUID_PORT_CHEVRON_VISIBLE_GAP = 2;
const FLUID_INPUT_PORT_DIAMETER = CELL_SIZE / 5;
const FLUID_INPUT_PORT_RADIUS = FLUID_INPUT_PORT_DIAMETER / 2;
const FLUID_INPUT_PORT_STROKE_WIDTH = 5;
const SOLID_INPUT_PLACEHOLDER_SIZE = CELL_SIZE * 4 / 5;
const SOLID_INPUT_PLACEHOLDER_STROKE_WIDTH = 2;
// Temporary editing aids only. Future drawing steps will remove this background
// and grid, so generated artwork must not depend on either color or the grid.
const DEVELOPMENT_BACKGROUND_COLOR = '#e9e9e9';
const DEVELOPMENT_GRID_LINE_COLOR = '#c9c9c9';
const DEVICE_BORDER_COLOR = '#2a2a2a';
const FLUID_INPUT_OUTER_PORT_COLOR = '#b8b8b8';
const FLUID_OUTPUT_PORT_FILL_COLOR = '#f0d24a';
const SOLID_INPUT_PLACEHOLDER_FILL_COLOR = '#efefef';
const SOLID_INPUT_PLACEHOLDER_STROKE_COLOR = '#7a7a7a';
// Some devices are still empty-shell registry definitions and do not expose
// static port coordinates yet. Blueprint drawing uses local overrides until the
// registry migration is finished.
const BLUEPRINT_PORT_LAYOUT_OVERRIDES = new Map([
  ['mix_pool_2', [
    { kind: 'item', direction: 'input', localCellX: 1, localCellY: 4, edge: 'SOUTH' },
    { kind: 'item', direction: 'input', localCellX: 4, localCellY: 4, edge: 'SOUTH' },
    { kind: 'fluid', direction: 'output', localCellX: 0, localCellY: 1, edge: 'WEST' },
    { kind: 'fluid', direction: 'output', localCellX: 0, localCellY: 3, edge: 'WEST' },
    { kind: 'fluid', direction: 'input', localCellX: 5, localCellY: 1, edge: 'EAST' },
    { kind: 'fluid', direction: 'input', localCellX: 5, localCellY: 3, edge: 'EAST' },
  ]],
]);
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
  const fluidPortMarkup = createFluidPortMarkup(definition);
  const solidInputPlaceholderMarkup = createSolidInputPlaceholderMarkup(definition);

  return [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" fill="none">`,
    '  <defs>',
    '    <style>',
    `      .canvas-background { fill: ${DEVELOPMENT_BACKGROUND_COLOR}; }`,
    `      .cell-guide { fill: none; stroke: ${DEVELOPMENT_GRID_LINE_COLOR}; stroke-width: 1; }`,
    `      .device-border { fill: none; stroke: ${DEVICE_BORDER_COLOR}; stroke-width: ${DEVICE_BORDER_STROKE_WIDTH}; }`,
    `      .fluid-port-outer { fill: none; stroke: ${FLUID_INPUT_OUTER_PORT_COLOR}; stroke-width: ${FLUID_INPUT_OUTER_PORT_STROKE_WIDTH}; }`,
    `      .fluid-input-port { fill: #ffffff; stroke: ${DEVICE_BORDER_COLOR}; stroke-width: ${FLUID_INPUT_PORT_STROKE_WIDTH}; }`,
    `      .fluid-output-port { fill: ${FLUID_OUTPUT_PORT_FILL_COLOR}; stroke: ${DEVICE_BORDER_COLOR}; stroke-width: ${FLUID_INPUT_PORT_STROKE_WIDTH}; }`,
    `      .fluid-input-port-chevron { fill: none; stroke: ${FLUID_INPUT_OUTER_PORT_COLOR}; stroke-width: ${FLUID_INPUT_CHEVRON_STROKE_WIDTH}; stroke-linecap: round; stroke-linejoin: round; }`,
    `      .solid-input-port-placeholder { fill: ${SOLID_INPUT_PLACEHOLDER_FILL_COLOR}; stroke: ${SOLID_INPUT_PLACEHOLDER_STROKE_COLOR}; stroke-width: ${SOLID_INPUT_PLACEHOLDER_STROKE_WIDTH}; }`,
    '    </style>',
    '  </defs>',
    '  <!-- Temporary editing aids only: do not depend on this background or grid. -->',
    `  <rect class="canvas-background" x="0" y="0" width="${width}" height="${height}" />`,
    ...createCellGuideMarkup(definition.footprint),
    '  <g id="device-blueprint-shape">',
    borderMarkup,
    ...solidInputPlaceholderMarkup,
    ...fluidPortMarkup,
    '  </g>',
    '</svg>',
  ].join('\n');
}

function createDeviceBorderMarkup(width, height) {
  const borderWidth = width - DEVICE_BORDER_INSET * 2;
  const borderHeight = height - DEVICE_BORDER_INSET * 2;

  return `    <rect class="device-border" x="${DEVICE_BORDER_INSET}" y="${DEVICE_BORDER_INSET}" width="${borderWidth}" height="${borderHeight}" />`;
}

function createFluidPortMarkup(definition) {
  return resolveBlueprintPorts(definition)
    .filter((port) => port.kind === 'fluid' && (port.direction === 'input' || port.direction === 'output'))
    .flatMap((port) => [
      `    <path class="fluid-port-outer" d="${createSemicirclePath(definition.footprint, port, FLUID_INPUT_OUTER_PORT_RADIUS)}" />`,
      `    <path class="${resolveFluidPortClassName(port.direction)}" d="${createClosedSemicirclePath(definition.footprint, port, FLUID_INPUT_PORT_RADIUS)}" />`,
      `    <path class="fluid-input-port-chevron" d="${createChevronPath(definition.footprint, port)}" />`,
    ]);
}

function createSolidInputPlaceholderMarkup(definition) {
  return resolveBlueprintPorts(definition)
    .filter((port) => port.kind === 'item' && port.direction === 'input')
    .map((port) => {
      const originX = port.localCellX * CELL_SIZE + (CELL_SIZE - SOLID_INPUT_PLACEHOLDER_SIZE) / 2;
      const originY = port.localCellY * CELL_SIZE + (CELL_SIZE - SOLID_INPUT_PLACEHOLDER_SIZE) / 2;

      return `    <rect class="solid-input-port-placeholder" x="${originX}" y="${originY}" width="${SOLID_INPUT_PLACEHOLDER_SIZE}" height="${SOLID_INPUT_PLACEHOLDER_SIZE}" />`;
    });
}

function resolveFluidPortClassName(direction) {
  switch (direction) {
    case 'input':
      return 'fluid-input-port';
    case 'output':
      return 'fluid-output-port';
    default:
      throw new Error(`Unsupported fluid port direction: ${direction}`);
  }
}

function resolveBlueprintPorts(definition) {
  const registryPorts = definition.portGroups.flatMap((group) => (
    group.ports.map((port) => ({
      kind: group.kind,
      direction: group.direction,
      localCellX: port.localCellX,
      localCellY: port.localCellY,
      edge: port.edge,
    }))
  ));
  const overridePorts = BLUEPRINT_PORT_LAYOUT_OVERRIDES.get(definition.id) ?? [];

  return [...registryPorts, ...overridePorts];
}

function createSemicirclePath(footprint, port, radius) {
  const width = footprint.width * CELL_SIZE;
  const height = footprint.height * CELL_SIZE;
  const center = resolveBorderMidpoint({ width, height, port });

  switch (port.edge) {
    case 'EAST':
      return [
        `M ${center.x} ${center.y - radius}`,
        `A ${radius} ${radius} 0 0 0 ${center.x} ${center.y + radius}`,
      ].join(' ');
    case 'WEST':
      return [
        `M ${center.x} ${center.y - radius}`,
        `A ${radius} ${radius} 0 0 1 ${center.x} ${center.y + radius}`,
      ].join(' ');
    case 'NORTH':
      return [
        `M ${center.x - radius} ${center.y}`,
        `A ${radius} ${radius} 0 0 0 ${center.x + radius} ${center.y}`,
      ].join(' ');
    case 'SOUTH':
      return [
        `M ${center.x - radius} ${center.y}`,
        `A ${radius} ${radius} 0 0 1 ${center.x + radius} ${center.y}`,
      ].join(' ');
    default:
      throw new Error(`Unsupported grid edge: ${port.edge}`);
  }
}

function createClosedSemicirclePath(footprint, port, radius) {
  return `${createSemicirclePath(footprint, port, radius)} Z`;
}

function createChevronPath(footprint, port) {
  const width = footprint.width * CELL_SIZE;
  const height = footprint.height * CELL_SIZE;
  const borderMidpoint = resolveBorderMidpoint({ width, height, port });
  const anchorDirection = resolveInteriorDirection(port.edge);
  const tipDirection = resolveChevronTipDirection(port);
  const perpendicular = { x: -tipDirection.y, y: tipDirection.x };
  const chevronGeometry = port.direction === 'output'
    ? createOutputChevronGeometry(borderMidpoint, anchorDirection)
    : createInputChevronGeometry(borderMidpoint, anchorDirection, tipDirection);
  const { tailCenter, tip } = chevronGeometry;
  const branchA = {
    x: tailCenter.x + perpendicular.x * (FLUID_INPUT_CHEVRON_WIDTH / 2),
    y: tailCenter.y + perpendicular.y * (FLUID_INPUT_CHEVRON_WIDTH / 2),
  };
  const branchB = {
    x: tailCenter.x - perpendicular.x * (FLUID_INPUT_CHEVRON_WIDTH / 2),
    y: tailCenter.y - perpendicular.y * (FLUID_INPUT_CHEVRON_WIDTH / 2),
  };

  return [
    `M ${branchA.x} ${branchA.y}`,
    `L ${tip.x} ${tip.y}`,
    `L ${branchB.x} ${branchB.y}`,
  ].join(' ');
}

function createInputChevronGeometry(borderMidpoint, anchorDirection, tipDirection) {
  const visibleTailInset = resolveFluidPortVisibleInset()
    + FLUID_PORT_CHEVRON_VISIBLE_GAP
    + resolveChevronTailCapProjection();
  const tailCenter = {
    x: borderMidpoint.x + anchorDirection.x * visibleTailInset,
    y: borderMidpoint.y + anchorDirection.y * visibleTailInset,
  };

  return {
    tailCenter,
    tip: {
      x: tailCenter.x + tipDirection.x * FLUID_INPUT_CHEVRON_HEIGHT,
      y: tailCenter.y + tipDirection.y * FLUID_INPUT_CHEVRON_HEIGHT,
    },
  };
}

function createOutputChevronGeometry(borderMidpoint, anchorDirection) {
  const tip = {
    x: borderMidpoint.x + anchorDirection.x * (
      resolveFluidPortVisibleInset()
      + FLUID_PORT_CHEVRON_VISIBLE_GAP
      + resolveChevronTipProjection()
    ),
    y: borderMidpoint.y + anchorDirection.y * (
      resolveFluidPortVisibleInset()
      + FLUID_PORT_CHEVRON_VISIBLE_GAP
      + resolveChevronTipProjection()
    ),
  };

  return {
    tip,
    tailCenter: {
      x: tip.x + anchorDirection.x * FLUID_INPUT_CHEVRON_HEIGHT,
      y: tip.y + anchorDirection.y * FLUID_INPUT_CHEVRON_HEIGHT,
    },
  };
}

function resolveChevronTailCapProjection() {
  const chevronHalfWidth = FLUID_INPUT_CHEVRON_WIDTH / 2;
  const chevronArmLength = Math.hypot(FLUID_INPUT_CHEVRON_HEIGHT, chevronHalfWidth);

  return (FLUID_INPUT_CHEVRON_STROKE_WIDTH / 2) * (FLUID_INPUT_CHEVRON_HEIGHT / chevronArmLength);
}

function resolveChevronTipProjection() {
  return FLUID_INPUT_CHEVRON_STROKE_WIDTH / 2;
}

function resolveFluidPortVisibleInset() {
  return FLUID_INPUT_PORT_RADIUS + FLUID_INPUT_PORT_STROKE_WIDTH / 2;
}

function resolveChevronTipDirection(port) {
  const interiorDirection = resolveInteriorDirection(port.edge);

  if (port.direction === 'input') {
    return interiorDirection;
  }

  if (port.direction === 'output') {
    return {
      x: -interiorDirection.x,
      y: -interiorDirection.y,
    };
  }

  throw new Error(`Unsupported fluid port direction: ${port.direction}`);
}

function resolveInteriorDirection(edge) {
  switch (edge) {
    case 'NORTH':
      return { x: 0, y: 1 };
    case 'EAST':
      return { x: -1, y: 0 };
    case 'SOUTH':
      return { x: 0, y: -1 };
    case 'WEST':
      return { x: 1, y: 0 };
    default:
      throw new Error(`Unsupported grid edge: ${edge}`);
  }
}

function resolveBorderMidpoint({ width, height, port }) {
  const cellCenterX = port.localCellX * CELL_SIZE + CELL_SIZE / 2;
  const cellCenterY = port.localCellY * CELL_SIZE + CELL_SIZE / 2;

  switch (port.edge) {
    case 'NORTH':
      return { x: cellCenterX, y: DEVICE_BORDER_INSET };
    case 'EAST':
      return { x: width - DEVICE_BORDER_INSET, y: cellCenterY };
    case 'SOUTH':
      return { x: cellCenterX, y: height - DEVICE_BORDER_INSET };
    case 'WEST':
      return { x: DEVICE_BORDER_INSET, y: cellCenterY };
    default:
      throw new Error(`Unsupported grid edge: ${port.edge}`);
  }
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
