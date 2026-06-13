#!/usr/bin/env node

import { mkdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";

const CELL_SIZE = 128;

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(scriptDirectory, "..", "..");
const defaultSourceDirectory = path.join(projectRoot, ".temp", "素材库", "解包素材库", "设备蓝图资源");
const outputDirectory = scriptDirectory;

const partSpecs = [
  {
    kind: "item",
    direction: "input",
    source: "port_in_6_4.png",
    blankSource: "port_in_5_2.png",
    cells: { left: 0, port: 2, blank: 2, right: 5 },
  },
  {
    kind: "item",
    direction: "output",
    source: "port_out_6_4.png",
    blankSource: "port_out_5_2.png",
    cells: { left: 0, port: 2, blank: 2, right: 5 },
  },
  {
    kind: "fluid",
    direction: "input",
    source: "pipe_port_in_5_2.png",
    blankSource: "pipe_port_in_5_2.png",
    cells: { left: 0, port: 1, blank: 2, right: 4 },
  },
  {
    kind: "fluid",
    direction: "output",
    source: "pipe_port_out_5_2.png",
    blankSource: "pipe_port_out_5_2.png",
    cells: { left: 0, port: 1, blank: 2, right: 4 },
  },
];

await main();

async function main() {
  const sourceDirectory = path.resolve(process.argv[2] ?? defaultSourceDirectory);

  await mkdir(outputDirectory, { recursive: true });

  for (const spec of partSpecs) {
    for (const part of ["left", "port", "blank", "right"]) {
      const sourceFileName = part === "blank" ? spec.blankSource : spec.source;
      const outputFileName = `${spec.kind}-${spec.direction}-${part}.png`;

      await cropCell({
        sourceFilePath: path.join(sourceDirectory, sourceFileName),
        cellIndex: spec.cells[part],
        outputFilePath: path.join(outputDirectory, outputFileName),
      });

      console.log(outputFileName);
    }
  }
}

async function cropCell(options) {
  const metadata = await sharp(options.sourceFilePath).metadata();

  if (typeof metadata.height !== "number") {
    throw new Error(`Failed to read source height: ${options.sourceFilePath}`);
  }

  await sharp(options.sourceFilePath)
    .extract({
      left: options.cellIndex * CELL_SIZE,
      top: 0,
      width: CELL_SIZE,
      height: metadata.height,
    })
    .png()
    .toFile(options.outputFilePath);
}
