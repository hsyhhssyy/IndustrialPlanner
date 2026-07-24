import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { BLUEPRINT_SCHEMA_VERSION } from "@/domain/document/blueprint-document";
import { createRegistryContract } from "@/registry";
import { runBlueprintSimulation } from "./blueprint-runner";
import {
  getDevice,
  loadBlueprintFromFile,
} from "./blueprint-test-helpers";

const BLUEPRINT_PATH = "src/tests/fixtures/blueprints/schema-v3-admission-rate.json";
const ADMISSION_RULE_PATH = "portGroups[0].ports[0].admissionRule";

describe("schema 3 admission blueprint migration", () => {
  it("keeps a real schema 3 fixture, migrates it through the loader, and runs with normalized rate semantics", async () => {
    const raw = JSON.parse(readFileSync(BLUEPRINT_PATH, "utf8")) as {
      readonly schemaVersion?: unknown;
      readonly entities?: Record<string, {
        readonly config?: Record<string, unknown>;
      }>;
    };

    expect(raw.schemaVersion).toBe(3);
    expect(raw.entities?.admission?.config?.[ADMISSION_RULE_PATH]).toMatchObject({
      perMinuteLimit: 7,
    });

    const blueprint = loadBlueprintFromFile(BLUEPRINT_PATH);
    const migratedRule = blueprint.entities.admission?.config[ADMISSION_RULE_PATH];
    const registry = createRegistryContract();
    const registeredDefinitionIds = new Set(
      registry.entityDefinitions.map((definition) => definition.id),
    );

    expect(blueprint.schemaVersion).toBe(BLUEPRINT_SCHEMA_VERSION);
    expect(migratedRule).toMatchObject({
      itemId: "item_iron_ore",
      limit: null,
      perMinuteLimit: 12,
    });
    expect(Object.values(blueprint.entities).every((entity) =>
      registeredDefinitionIds.has(entity.definitionId)
    )).toBe(true);

    const report = await runBlueprintSimulation({
      blueprint,
      registry,
      maxTickNumber: 260,
    });
    const admissionOutputTicks = report.ticks.flatMap((tick) =>
      tick.transfers
        .filter((transfer) =>
          transfer.sourceSlotId.includes("device:admission")
          && transfer.targetSlotId.includes("device:belt")
        )
        .map(() => tick.tickNumber)
    );

    expect(admissionOutputTicks).toEqual([41, 81, 241]);
    expect(getDevice(report, 260, "admission").admissionCounters?.["item_input:in_w"])
      .toMatchObject({
        count: 3,
        perMinuteLimit: 12,
        rateWindowCount: 1,
      });
  });
});
