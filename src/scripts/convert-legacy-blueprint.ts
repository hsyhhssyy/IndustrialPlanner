import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import process from "node:process";
import { parseArgs } from "node:util";

import type { BlueprintDocument } from "@/domain/document/blueprint-document";
import { normalizeBlueprintDocument } from "@/shared/blueprints/blueprint-document-codec";
import { convertLegacyBlueprintJson } from "@/shared/storage/legacy-blueprint-import";

interface CliOptions {
  readonly inputPath: string;
  readonly outputPath: string | null;
  readonly overwrite: boolean;
}

void main();

async function main(): Promise<void> {
  try {
    const cliOptions = parseCliOptions(process.argv.slice(2));
    if (cliOptions === null) {
      return;
    }

    const raw = JSON.parse(await readFile(cliOptions.inputPath, "utf-8")) as unknown;

    // 新格式也要经过 normalize，确保历史设备 id 一步到位更新到最新 id。
    const normalized = normalizeBlueprintDocument(raw);
    if (normalized !== null) {
      if (isSameJsonPayload(raw, normalized)) {
        console.log(`"${cliOptions.inputPath}" 已是最新版蓝图格式，无需转换。`);
        return;
      }

      await writeConvertedBlueprint(cliOptions, normalized);
      return;
    }

    // 旧格式转换
    const converted = convertLegacyBlueprintJson(raw);
    if (converted === null) {
      console.error(`错误：无法识别蓝图格式 "${cliOptions.inputPath}"。`);
      process.exit(1);
    }

    await writeConvertedBlueprint(cliOptions, converted);
  } catch (error) {
    console.error(`错误：${error instanceof Error ? error.message : String(error)}`);
    process.exit(1);
  }
}

async function writeConvertedBlueprint(
  cliOptions: CliOptions,
  document: BlueprintDocument,
): Promise<void> {
  const outputPath = cliOptions.outputPath ?? (cliOptions.overwrite ? cliOptions.inputPath : `${cliOptions.inputPath}.converted.json`);
  await mkdir(dirname(resolve(outputPath)), { recursive: true });
  await writeFile(outputPath, JSON.stringify(document, null, 2) + "\n", "utf-8");

  console.log(`已转换 → "${outputPath}"`);
}

function isSameJsonPayload(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

function parseCliOptions(args: readonly string[]): CliOptions | null {
  const { values, positionals } = parseArgs({
    args: [...args],
    options: {
      output: { type: "string", short: "o" },
      overwrite: { type: "boolean", short: "w", default: false },
    },
    allowPositionals: true,
  });

  if (positionals.length === 0) {
    console.error("用法: npm run blueprint:convert -- <旧蓝图路径> [-o <输出路径>] [-w]");
    return null;
  }

  return {
    inputPath: positionals[0] ?? "",
    outputPath: values.output ?? null,
    overwrite: values.overwrite ?? false,
  };
}
