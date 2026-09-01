import { describe, expect, it } from "vitest";

import {
  collectDefaultModuleIconItemIds,
  migrateModuleIconItemIds,
  parseModuleIconItemIds,
} from "@/app/module-icon";

describe("module icon item ids", () => {
  it("accepts one to four unique item ids and preserves their order", () => {
    expect(parseModuleIconItemIds(["item-a"])).toEqual(["item-a"]);
    expect(parseModuleIconItemIds(["item-a", "item-b", "item-c", "item-d"])).toEqual([
      "item-a",
      "item-b",
      "item-c",
      "item-d",
    ]);
  });

  it("rejects empty, duplicated, or oversized selections", () => {
    expect(parseModuleIconItemIds([])).toBeNull();
    expect(parseModuleIconItemIds(["item-a", "item-a"])).toBeNull();
    expect(parseModuleIconItemIds(["a", "b", "c", "d", "e"])).toBeNull();
  });

  it("migrates old item icons and replaces old device icons with the first output", () => {
    expect(migrateModuleIconItemIds(undefined, "item_iron_ore", ["item-a"], ["item-b"])).toEqual([
      "item_iron_ore",
    ]);
    expect(migrateModuleIconItemIds(undefined, "item_port_grinder_1", ["item-a"], ["item-b"])).toEqual([
      "item-b",
    ]);
  });

  it("collects at most four unique defaults with preferred items first", () => {
    expect(collectDefaultModuleIconItemIds(
      ["item-a", "item-b", "item-a"],
      ["item-c", "item-d", "item-e"],
    )).toEqual(["item-a", "item-b", "item-c", "item-d"]);
  });
});
