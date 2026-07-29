import { describe, expect, it } from "vitest";

import {
  applyJsonPatch,
  generateJsonPatch,
} from "@/shared/storage/json-patch-codec";

describe("json-patch-codec", () => {
  it("generates and applies JSON Patch without mutating the source object", () => {
    const source = {
      entities: {
        deviceA: {
          position: { x: 1, y: 2 },
          slots: ["input"],
        },
      },
    };
    const target = {
      entities: {
        deviceA: {
          position: { x: 3, y: 2 },
          slots: ["input", "output"],
        },
        deviceB: {
          position: { x: 4, y: 5 },
          slots: [],
        },
      },
    };

    const patch = generateJsonPatch(source, target);
    const applied = applyJsonPatch(source, patch);

    expect(applied).toEqual(target);
    expect(source).toEqual({
      entities: {
        deviceA: {
          position: { x: 1, y: 2 },
          slots: ["input"],
        },
      },
    });
    expect(patch.length).toBeGreaterThan(0);
  });
});