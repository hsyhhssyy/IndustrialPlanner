import {
  createArrowTriangleBlock,
  renderPortChevronTextureSet,
} from './port-chevron-generator.mjs';

const LIQUID_ARROW_PARAMS = {
  centerX: 32,
  topY: 45,
  width: 18,
  totalHeight: 14,
  arrowHeadHeight: 8,
  blockWidth: 20,
  blockHeight: 4,
  gap: 2,
};

function createLiquidPortPolygons(direction) {
  return createArrowTriangleBlock({
    ...LIQUID_ARROW_PARAMS,
    direction,
  });
}

const LIQUID_PORT_TEXTURES = [
  {
    fileName: 'liquid-port-chevron-output.png',
    polygons: createLiquidPortPolygons('up'),
  },
  {
    fileName: 'liquid-port-chevron-input.png',
    polygons: createLiquidPortPolygons('down'),
  },
];

async function main() {
  await renderPortChevronTextureSet({
    scriptUrl: import.meta.url,
    generatorName: 'generate-liquid-port-chevron',
    textures: LIQUID_PORT_TEXTURES,
  });
}

main().catch((error) => {
  console.error('Failed to generate liquid port chevron textures.');
  console.error(error);
  process.exitCode = 1;
});