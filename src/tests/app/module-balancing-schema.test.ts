import { describe, expect, it } from "vitest";

import {
  isUnsupportedModuleBalancingCustomModuleVersion,
  migrateModuleBalancingCustomModuleIconItemIds,
  MODULE_BALANCING_CUSTOM_MODULE_SCHEMA_VERSION,
  resolveModuleBalancingCustomModuleSchemaVersion,
} from "@/app/module-balancing-schema";

function migrateIcon(options: {
  readonly schemaVersion?: unknown;
  readonly iconItemIds?: unknown;
  readonly legacyIconId?: unknown;
}): string[] | null {
  return migrateModuleBalancingCustomModuleIconItemIds({
    schemaVersion: options.schemaVersion,
    iconItemIds: options.iconItemIds,
    legacyIconId: options.legacyIconId,
    inputItemIds: ["input-a"],
    outputItemIds: ["output-a"],
  });
}

describe("module-balancing custom module schema", () => {
  it("treats a missing version as v1 and migrates its single icon", () => {
    expect(resolveModuleBalancingCustomModuleSchemaVersion(undefined)).toBe(1);
    expect(migrateIcon({ legacyIconId: "item_a" })).toEqual(["item_a"]);
    expect(migrateIcon({ legacyIconId: "grinder_1" })).toEqual(["output-a"]);
  });

  it("accepts only the current v2 icon array shape", () => {
    expect(migrateIcon({
      schemaVersion: MODULE_BALANCING_CUSTOM_MODULE_SCHEMA_VERSION,
      iconItemIds: ["item-a", "item-b", "item-c", "item-d"],
    })).toEqual(["item-a", "item-b", "item-c", "item-d"]);
    expect(migrateIcon({
      schemaVersion: MODULE_BALANCING_CUSTOM_MODULE_SCHEMA_VERSION,
      iconItemIds: undefined,
      legacyIconId: "item-a",
    })).toBeNull();
  });

  it("identifies a future schema without attempting migration", () => {
    const futureVersion = MODULE_BALANCING_CUSTOM_MODULE_SCHEMA_VERSION + 1;

    expect(isUnsupportedModuleBalancingCustomModuleVersion({
      schemaVersion: futureVersion,
    })).toBe(true);
    expect(migrateIcon({
      schemaVersion: futureVersion,
      iconItemIds: ["item-a"],
    })).toBeNull();
  });

  it("rejects invalid versions instead of treating them as a future schema", () => {
    expect(isUnsupportedModuleBalancingCustomModuleVersion({
      schemaVersion: "3",
    })).toBe(false);
    expect(migrateIcon({
      schemaVersion: "3",
      iconItemIds: ["item-a"],
    })).toBeNull();
  });
});
