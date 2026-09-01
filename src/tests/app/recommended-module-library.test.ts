import { describe, expect, it } from "vitest";

import {
  normalizeRecommendedModuleLibrary,
} from "@/app/shell/module-balancing/recommended-module-library";

describe("recommended-module-library", () => {
  it("normalizes the versioned public module index", () => {
    expect(normalizeRecommendedModuleLibrary({
      version: "1",
      modules: [{
        id: "recommended:starter",
        name: "Starter",
        color: "#4f8cff",
        iconId: "gear",
        notes: "",
        inputs: [{ itemId: "plate", perMinute: 30 }],
        outputs: [{ itemId: "gear", perMinute: 15 }],
        sourceType: "recommended",
      }],
    })).toEqual({
      version: "1",
      modules: [{
        id: "recommended:starter",
        name: "Starter",
        color: "#4f8cff",
        iconItemIds: ["gear"],
        notes: "",
        inputs: [{ itemId: "plate", perMinute: 30 }],
        outputs: [{ itemId: "gear", perMinute: 15 }],
        sourceType: "recommended",
      }],
    });
  });

  it("preserves the selected item order for composite icons", () => {
    expect(normalizeRecommendedModuleLibrary({
      version: "2",
      modules: [{
        id: "recommended:composite",
        name: "Composite",
        iconItemIds: ["gear", "plate", "ore"],
        inputs: [{ itemId: "ore", perMinute: 30 }],
        outputs: [{ itemId: "gear", perMinute: 15 }],
        sourceType: "recommended",
      }],
    })?.modules[0]?.iconItemIds).toEqual(["gear", "plate", "ore"]);
  });

  it("rejects duplicated ids and malformed ports", () => {
    const module = {
      id: "recommended:starter",
      name: "Starter",
      iconItemIds: ["gear"],
      inputs: [],
      outputs: [{ itemId: "gear", perMinute: 15 }],
      sourceType: "recommended",
    };

    expect(normalizeRecommendedModuleLibrary({
      version: "1",
      modules: [module, module],
    })).toBeNull();
    expect(normalizeRecommendedModuleLibrary({
      version: "1",
      modules: [{
        ...module,
        outputs: [{ itemId: "gear", perMinute: 0 }],
      }],
    })).toBeNull();
  });
});
