import { describe, expect, it } from "vitest";

import {
  normalizeRecommendedCanvas,
  normalizeRecommendedCanvasIndex,
} from "@/app/shell/module-balancing/recommended-canvas-library";

describe("recommended-canvas-library", () => {
  it("normalizes a versioned public canvas index and canvas document", () => {
    expect(normalizeRecommendedCanvasIndex({
      version: "1",
      canvases: ["starter", "iron-smelting"],
    })).toEqual({
      version: "1",
      canvases: ["starter", "iron-smelting"],
    });

    expect(normalizeRecommendedCanvas({
      id: "recommended-canvas:starter",
      name: "Starter",
      globalInputs: [
        { itemId: "ore", perMinute: 30 },
        { itemId: "water", infinite: true },
      ],
      stages: [{
        id: "recommended-stage:smelting",
        name: "Smelting",
        entries: [{ moduleId: "smelt-ore", quantity: 1.5 }],
      }],
      warehouseCapacity: 1000,
    })).toEqual({
      id: "recommended-canvas:starter",
      name: "Starter",
      folderId: null,
      globalInputs: [
        { itemId: "ore", perMinute: 30 },
        { itemId: "water", perMinute: 0, infinite: true },
      ],
      stages: [{
        id: "recommended-stage:smelting",
        name: "Smelting",
        entries: [{ moduleId: "smelt-ore", quantity: 1.5 }],
      }],
      warehouseCapacity: 1000,
    });
  });

  it("rejects unsafe asset names, duplicate stage ids, and non-positive values", () => {
    expect(normalizeRecommendedCanvasIndex({
      version: "1",
      canvases: ["../outside"],
    })).toBeNull();

    const stage = {
      id: "stage",
      name: "Stage",
      entries: [{ moduleId: "recipe", quantity: 1 }],
    };
    expect(normalizeRecommendedCanvas({
      id: "recommended-canvas:invalid",
      name: "Invalid",
      globalInputs: [],
      stages: [stage, stage],
      warehouseCapacity: null,
    })).toBeNull();
    expect(normalizeRecommendedCanvas({
      id: "recommended-canvas:invalid",
      name: "Invalid",
      globalInputs: [{ itemId: "ore", perMinute: 0 }],
      stages: [],
      warehouseCapacity: null,
    })).toBeNull();
  });
});
