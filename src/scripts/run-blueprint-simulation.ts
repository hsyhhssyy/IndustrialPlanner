import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import process from "node:process";
import { parseArgs } from "node:util";

import { normalizeBlueprintDocument } from "@/shared/blueprints/blueprint-document-codec";
import { createRegistryContract } from "@/registry";
import { runBlueprintSimulation } from "@/simulation/blueprint-runner";

interface CliOptions {
  readonly inputPath: string;
  readonly maxTickNumber: number;
  readonly outputPath: string | null;
}

const DEFAULT_MAX_TICK_NUMBER = 10;

void main();

async function main(): Promise<void> {
  try {
    const cliOptions = parseCliOptions(process.argv.slice(2));
    if (cliOptions === null) {
      return;
    }

    const blueprint = await readBlueprintDocument(cliOptions.inputPath);
    const report = await runBlueprintSimulation({
      blueprint,
      registry: createRegistryContract(),
      maxTickNumber: cliOptions.maxTickNumber,
    });

    if (cliOptions.outputPath !== null) {
      await writeSimulationReport(cliOptions.outputPath, {
        inputPath: cliOptions.inputPath,
        ...report,
      });
    }

    printReportSummary({
      report,
      inputPath: cliOptions.inputPath,
      outputPath: cliOptions.outputPath,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`[blueprint-run] ${message}`);
    process.exitCode = 1;
  }
}

function parseCliOptions(argv: readonly string[]): CliOptions | null {
  const parsed = parseArgs({
    args: [...argv],
    allowPositionals: true,
    strict: true,
    options: {
      ticks: {
        type: "string",
        short: "t",
      },
      output: {
        type: "string",
        short: "o",
      },
      help: {
        type: "boolean",
        short: "h",
      },
    },
  });

  if (parsed.values.help) {
    printUsage();
    return null;
  }

  const inputPath = parsed.positionals[0];
  if (inputPath === undefined) {
    printUsage();
    throw new Error("Missing blueprint JSON path.");
  }

  const maxTickNumber = resolveMaxTickNumber(parsed.values.ticks);

  return {
    inputPath: resolve(process.cwd(), inputPath),
    maxTickNumber,
    outputPath: parsed.values.output === undefined
      ? null
      : resolve(process.cwd(), parsed.values.output),
  };
}

function resolveMaxTickNumber(value: string | undefined): number {
  if (value === undefined) {
    return DEFAULT_MAX_TICK_NUMBER;
  }

  const parsed = Number.parseInt(value, 10);
  if (!Number.isInteger(parsed) || parsed < 0) {
    throw new Error(`Expected --ticks to be a non-negative integer, received: ${value}`);
  }

  return parsed;
}

async function readBlueprintDocument(inputPath: string) {
  const content = await readFile(inputPath, "utf8");
  let payload: unknown;

  try {
    payload = JSON.parse(content) as unknown;
  } catch {
    throw new Error(`Invalid JSON file: ${inputPath}`);
  }

  const blueprint = normalizeBlueprintDocument(payload);
  if (blueprint === null) {
    throw new Error(`Invalid blueprint document payload: ${inputPath}`);
  }

  return blueprint;
}

async function writeSimulationReport(outputPath: string, report: unknown): Promise<void> {
  await mkdir(dirname(outputPath), {
    recursive: true,
  });
  await writeFile(outputPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
}

function printReportSummary(options: {
  readonly report: Awaited<ReturnType<typeof runBlueprintSimulation>>;
  readonly inputPath: string;
  readonly outputPath: string | null;
}): void {
  console.log(`Blueprint: ${options.report.blueprint.name}`);
  console.log(`Input: ${options.inputPath}`);
  console.log(`Base: ${options.report.blueprint.baseId}`);
  console.log(`Entities: ${options.report.blueprint.entityCount}`);
  console.log(`Slot Links: ${options.report.blueprint.slotLinkCount}`);
  console.log(`Compile Diagnostics: ${options.report.topology.diagnosticCount}`);

  for (const tick of options.report.ticks) {
    const activeRecipeCount = Object.values(tick.devices)
      .filter((device) => device.recipeId !== null)
      .length;
    console.log(
      `Tick ${tick.tickNumber}: transfers=${tick.transferCount}, diagnostics=${tick.diagnosticCount}, activeRecipes=${activeRecipeCount}`,
    );
  }

  console.log(`Captured Ticks: ${options.report.summary.totalTicksCaptured}`);
  console.log(`Total Transfers: ${options.report.summary.totalTransferCount}`);
  console.log(`Changed Devices: ${options.report.summary.deviceInventoryChanges.length}`);

  for (const throughput of options.report.summary.transportComponentThroughput.slice(0, 5)) {
    console.log(
      `Throughput ${throughput.transportComponentId} (${throughput.transportClass}): amount=${throughput.totalAmount}, transfers=${throughput.transferCount}`,
    );
  }

  if (options.outputPath === null) {
    console.log("Full JSON report was not written. Pass --output <path> to persist every tick snapshot.");
    return;
  }

  console.log(`Report: ${options.outputPath}`);
}

function printUsage(): void {
  console.log("Usage: npm run blueprint:run -- <blueprint-json-path> [--ticks <max-tick-number>] [--output <report-path>]");
  console.log(`Default max tick number: ${DEFAULT_MAX_TICK_NUMBER}`);
}