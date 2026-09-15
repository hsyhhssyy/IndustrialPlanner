import { readdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";

import { BLUEPRINT_SCHEMA_VERSION, type BlueprintDocument } from "@/domain/document/blueprint-document";
import { createRegistryContract } from "@/registry";
import { normalizeBlueprintDocument } from "@/shared/blueprints/blueprint-document-codec";
import { loadBlueprintFromFile, loadBlueprintVariantFromFile } from "../simulation/blueprint-test-helpers";

interface FixtureEntry {
  file: string;
  role: "migration-input" | "system-blueprint" | "test-scene";
  schemaVersion: number;
  version: string;
  unknownDefinitionIds: string[];
}

const root = "src/tests/fixtures/blueprints";
const manifest = JSON.parse(readFileSync(join(root, "manifest.json"), "utf8")) as {
  formatVersion: number;
  fixtureRevision: number;
  entries: FixtureEntry[];
  catalogs: string[];
};
const knownDefinitions = new Set(createRegistryContract().entityDefinitions.map((definition) => definition.id));

function listJsonFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const filename = join(directory, entry.name);
    return entry.isDirectory() ? listJsonFiles(filename) : filename.endsWith(".json") ? [filename] : [];
  });
}

describe("versioned blueprint fixtures", () => {
  it("indexes every scene and records fixture revisions", () => {
    expect(manifest.formatVersion).toBe(1);
    expect(manifest.fixtureRevision).toBeGreaterThan(0);
    const actualFiles = [...listJsonFiles(root), ...listJsonFiles("public/blueprints")].filter((file) => {
      const payload = JSON.parse(readFileSync(file, "utf8")) as Partial<BlueprintDocument>;
      return typeof payload.blueprintId === "string";
    });
    expect(manifest.entries.map((entry) => entry.file).sort()).toEqual(actualFiles.sort());
    expect(new Set(manifest.entries.map((entry) => entry.file)).size).toBe(manifest.entries.length);
  });

  it.each(manifest.entries)("validates schema, references and registry requirements: $file", (entry) => {
    const raw = JSON.parse(readFileSync(entry.file, "utf8")) as BlueprintDocument;
    expect(raw.schemaVersion).toBe(entry.schemaVersion);
    expect(raw.version).toBe(entry.version);
    expect(raw.version.trim()).not.toBe("");
    if (entry.role !== "migration-input") {
      expect(raw.schemaVersion).toBe(BLUEPRINT_SCHEMA_VERSION);
      expect(normalizeBlueprintDocument(raw)).toEqual(raw);
    }
    const blueprint = loadBlueprintFromFile(entry.file);
    expect(blueprint.schemaVersion).toBe(BLUEPRINT_SCHEMA_VERSION);
    expect(new Set(blueprint.entityOrder).size).toBe(blueprint.entityOrder.length);
    expect([...blueprint.entityOrder].sort()).toEqual(Object.keys(blueprint.entities).sort());
    for (const [id, entity] of Object.entries(blueprint.entities)) expect(entity.id).toBe(id);
    for (const link of blueprint.slotLinks) {
      for (const endpoint of [link.source, link.target]) {
        expect(endpoint.entityId === "warehouse" || endpoint.entityId in blueprint.entities).toBe(true);
      }
    }
    const unknown = [...new Set(Object.values(raw.entities).map((entity) => entity.definitionId))]
      .filter((id) => !knownDefinitions.has(id)).sort();
    expect(unknown).toEqual(entry.unknownDefinitionIds);
    expect(loadBlueprintFromFile(entry.file)).not.toBe(blueprint);
  });

  it.each(manifest.catalogs)("resolves every parameter variant without rebuilding entities: %s", (catalogPath) => {
    const catalog = JSON.parse(readFileSync(catalogPath, "utf8")) as {
      fixtureRevision: number;
      scenes: Record<string, { parameters: Record<string, unknown>; file: string }[]>;
    };
    expect(catalog.fixtureRevision).toBeGreaterThan(0);
    for (const [scene, entries] of Object.entries(catalog.scenes)) {
      for (const entry of entries) {
        const expected = loadBlueprintFromFile(resolve(catalogPath, "..", entry.file));
        expect(loadBlueprintVariantFromFile(catalogPath, scene, entry.parameters)).toEqual(expected);
      }
    }
    expect(() => loadBlueprintVariantFromFile(catalogPath, "missing-scene", {})).toThrow("exactly one");
  });
});
