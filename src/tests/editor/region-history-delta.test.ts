import { describe, expect, it } from "vitest";

import {
  applyWorldDocumentDelta,
  createWorldDocumentDelta,
} from "@/editor/history/history-delta";
import { createDummyWorldDocument } from "@/tests/helpers/dummy-document";

describe("region history delta", () => {
  it("records a pure region edit and restores it in both directions", () => {
    const before = createDummyWorldDocument();
    const after = {
      ...before,
      regions: [{
        id: "region-1",
        name: "仓储区",
        description: "",
        color: "#10B981",
        rects: [{ x: 3, y: 3, width: 5, height: 4 }],
      }],
    };
    const delta = createWorldDocumentDelta(before, after);

    expect(delta).not.toBeNull();
    expect(delta?.regions).toEqual({
      before: [],
      after: after.regions,
    });
    expect(delta?.entityOrder).toBeNull();
    expect(delta?.slotLinks).toBeNull();

    const forward = applyWorldDocumentDelta(before, delta!, "forward");
    const inverse = applyWorldDocumentDelta(forward, delta!, "inverse");
    expect(forward.regions).toEqual(after.regions);
    expect(inverse.regions).toEqual([]);
  });
});
