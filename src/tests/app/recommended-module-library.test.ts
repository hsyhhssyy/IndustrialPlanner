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
        iconId: "gear",
        notes: "",
        inputs: [{ itemId: "plate", perMinute: 30 }],
        outputs: [{ itemId: "gear", perMinute: 15 }],
        sourceType: "recommended",
      }],
    });
  });

  it("rejects duplicated ids and malformed ports", () => {
    const module = {
      id: "recommended:starter",
      name: "Starter",
      iconId: "gear",
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
