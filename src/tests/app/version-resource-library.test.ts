import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

import {
  applyVersionResourcePreset,
  normalizeVersionResourceIndex,
  normalizeVersionResourcePreset,
} from "@/app/shell/module-balancing/version-resource-library";

describe("version-resource-library", () => {
  it("loads the public Wuling 1.4 and 1.5 resource presets with the 1.5 increases", () => {
    const resourceRoot = resolve(process.cwd(), "public/module-balancing/version-resources");
    const index = normalizeVersionResourceIndex(JSON.parse(
      readFileSync(resolve(resourceRoot, "index.json"), "utf8"),
    ));

    expect(index).toEqual({
      version: "1",
      resources: ["wuling-1.5", "wuling-1.4"],
    });

    const wuling14 = normalizeVersionResourcePreset(JSON.parse(
      readFileSync(resolve(resourceRoot, "wuling-1.4.json"), "utf8"),
    ));
    const wuling15 = normalizeVersionResourcePreset(JSON.parse(
      readFileSync(resolve(resourceRoot, "wuling-1.5.json"), "utf8"),
    ));

    expect(wuling14?.inputs).toContainEqual({ itemId: "item_copper_ore", perMinute: 420 });
    expect(wuling14?.inputs).toContainEqual({ itemId: "item_gas_xiranite", perMinute: 100 });
    expect(wuling15).toMatchObject({
      id: "version-resource:wuling-1.5",
      name: "武陵1.5版本资源",
      regionTag: "武陵",
    });
    expect(wuling15?.inputs).toContainEqual({ itemId: "item_copper_ore", perMinute: 510 });
    expect(wuling15?.inputs).toContainEqual({ itemId: "item_gas_xiranite", perMinute: 150 });
  });

  it("normalizes a versioned index and finite or infinite resource inputs", () => {
    expect(normalizeVersionResourceIndex({
      version: "1",
      resources: ["wuling-1.4"],
    })).toEqual({
      version: "1",
      resources: ["wuling-1.4"],
    });

    expect(normalizeVersionResourcePreset({
      id: "version-resource:wuling-1.4",
      name: "武陵1.4版本资源",
      inputs: [
        { itemId: "item_originium_ore", perMinute: 540 },
        { itemId: "item_liquid_water", infinite: true },
      ],
    })).toEqual({
      id: "version-resource:wuling-1.4",
      name: "武陵1.4版本资源",
      inputs: [
        { itemId: "item_originium_ore", perMinute: 540 },
        { itemId: "item_liquid_water", perMinute: 0, infinite: true },
      ],
    });
  });

  it("rejects unsafe paths, duplicate items, and invalid finite quantities", () => {
    expect(normalizeVersionResourceIndex({
      version: "1",
      resources: ["../outside"],
    })).toBeNull();
    expect(normalizeVersionResourcePreset({
      id: "duplicate",
      name: "Duplicate",
      inputs: [
        { itemId: "ore", perMinute: 10 },
        { itemId: "ore", perMinute: 20 },
      ],
    })).toBeNull();
    expect(normalizeVersionResourcePreset({
      id: "invalid",
      name: "Invalid",
      inputs: [{ itemId: "ore", perMinute: 0 }],
    })).toBeNull();
  });

  it("precisely replaces existing preset items, removes duplicate matches, and keeps unrelated inputs", () => {
    const result = applyVersionResourcePreset([
      { itemId: "ore", perMinute: 10, infinite: true },
      { itemId: "other", perMinute: 25 },
      { itemId: "ore", perMinute: 15 },
    ], {
      inputs: [
        { itemId: "ore", perMinute: 540 },
        { itemId: "water", perMinute: 0, infinite: true },
      ],
    });

    expect(result).toEqual([
      { itemId: "ore", perMinute: 540 },
      { itemId: "other", perMinute: 25 },
      { itemId: "water", perMinute: 0, infinite: true },
    ]);
  });
});
