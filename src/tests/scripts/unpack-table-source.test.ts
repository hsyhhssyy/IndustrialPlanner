import { createHash } from "node:crypto";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";

import { afterEach, beforeAll, describe, expect, it } from "vitest";

// @ts-expect-error 项目级 mjs 脚本没有单独维护声明文件。
import { openUnpackTableSource } from "../../../.agents/skills/unpack-data-analysis/scripts/unpack-table-source.mjs";

const PROJECT_ROOT = resolve(import.meta.dirname, "../../..");
const TEMP_ROOT = resolve(PROJECT_ROOT, ".temp/.trash");
const createdDirectories: string[] = [];

function sha256(content: string): string {
  return createHash("sha256").update(content).digest("hex");
}

async function createRawSource(tableContent: string): Promise<string> {
  const sourcePath = await mkdtemp(join(TEMP_ROOT, "unpack-source-test-"));
  createdDirectories.push(sourcePath);
  const tableDirectory = join(sourcePath, "TableCfg");
  await mkdir(tableDirectory);
  await writeFile(join(tableDirectory, "FactoryBuildingTable.json"), tableContent);
  await writeFile(join(sourcePath, "source-manifest.json"), JSON.stringify({
    schemaVersion: 1,
    source: "local",
    sourceVersion: "fixture@1",
    gameVersion: "fixture",
    hotfixVersion: "1",
    exportedAt: "2026-08-31T00:00:00.000Z",
    tables: {
      FactoryBuildingTable: {
        file: "TableCfg/FactoryBuildingTable.json",
        sha256: sha256(tableContent),
      },
    },
  }));
  return sourcePath;
}

beforeAll(async () => {
  await mkdir(TEMP_ROOT, { recursive: true });
});

afterEach(async () => {
  await Promise.all(createdDirectories.splice(0).map((directory) =>
    rm(directory, { recursive: true, force: true })
  ));
});

describe("unpack-table-source", () => {
  it("preserves unsafe Int64 tokens from a validated raw table", async () => {
    const sourcePath = await createRawSource(
      '{"machine":{"name":{"id":6693873765078043271},"range":{"width":3}}}',
    );

    const source = openUnpackTableSource(sourcePath);
    const table = source.readTable("FactoryBuildingTable") as {
      machine: { name: { id: string }; range: { width: number } };
    };

    expect(source.authority).toBe("raw-table");
    expect(table.machine.name.id).toBe("6693873765078043271");
    expect(table.machine.range.width).toBe(3);
  });

  it("fails fast when a raw table hash differs from its manifest", async () => {
    const sourcePath = await createRawSource('{"machine":{}}');
    await writeFile(join(sourcePath, "TableCfg/FactoryBuildingTable.json"), "{}");

    const source = openUnpackTableSource(sourcePath);

    expect(() => source.readTable("FactoryBuildingTable")).toThrow("SHA-256 不一致");
  });

  it("exposes only confirmed legacy table mappings", async () => {
    const sourcePath = await mkdtemp(join(TEMP_ROOT, "unpack-legacy-test-"));
    createdDirectories.push(sourcePath);
    const legacyPath = join(sourcePath, "json-export.json");
    await writeFile(legacyPath, JSON.stringify({
      meta: { version: "legacy-fixture" },
      buildings: {
        buildingItemTable: { item_machine: { buildingId: "machine" } },
        buildingTable: { machine: { id: "machine" } },
        machineCrafterTable: {
          machine: {
            modeMap: [
              { groupName: "group_machine_normal", isEnvMode: false, modeName: "normal" },
            ],
          },
        },
      },
      recipes: {
        formula_normal: {
          id: "formula_normal",
          formulaGroupId: "group_machine_normal",
          machineId: "machine",
        },
      },
    }));

    const source = openUnpackTableSource(legacyPath);

    expect(source.authority).toBe("legacy-lossy");
    expect(source.readTable("FactoryBuildingTable")).toEqual({
      machine: { id: "machine" },
    });
    expect(source.readTable("FactoryMachineCrafterTable")).toEqual({
      machine: {
        modeMap: [
          { groupName: "group_machine_normal", isEnvMode: false, modeName: "normal" },
        ],
      },
    });
    expect(source.readTable("FactoryMachineCraftTable")).toEqual({
      formula_normal: {
        id: "formula_normal",
        formulaGroupId: "group_machine_normal",
        machineId: "machine",
      },
    });
    expect(() => source.readTable("I18nTextTable_CN")).toThrow(
      "legacy json-export 不支持 raw table I18nTextTable_CN",
    );
  });
});
