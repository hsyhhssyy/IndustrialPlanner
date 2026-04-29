import {
  createVerticalChevronBand,
  renderPortChevronTextureSet,
} from './port-chevron-generator.mjs';

const SOLID_CHEVRON_BAND = {
  centerX: 32,
  topY: 49,
  width: 18,
  height: 10,
  thickness: 4,
};

function createSolidPortPolygons(direction) {
  return [
    createVerticalChevronBand({
      ...SOLID_CHEVRON_BAND,
      direction,
    }),
  ];
}

const SOLID_PORT_TEXTURES = [
  {
    fileName: 'solid-port-chevron-input.png',
    polygons: createSolidPortPolygons('down'),
  },
  {
    fileName: 'solid-port-chevron-output.png',
    polygons: createSolidPortPolygons('up'),
  },
];

async function main() {
  await renderPortChevronTextureSet({
    scriptUrl: import.meta.url,
    generatorName: 'generate-solid-port-chevron',
    textures: SOLID_PORT_TEXTURES,
  });
}

main().catch((error) => {
  console.error('Failed to generate solid port chevron textures.');
  console.error(error);
  process.exitCode = 1;
});