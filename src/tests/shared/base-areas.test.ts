import { describe, expect, it } from "vitest";
import { BASE_DEFINITIONS } from "@/registry/base-definition";
import {
  isGridPointInBaseArea,
  resolveBaseAreaContainingRect,
  resolveBaseAreas,
  resolveBaseOuterBounds,
} from "@/shared/geometry/base-areas";

const draftBox = BASE_DEFINITIONS.find((base) => base.id === "draft_box")!;

describe("base areas", () => {
  it("resolves the draft box main area and its detached 0×0 area", () => {
    expect(resolveBaseAreas(draftBox)).toMatchObject([
      {
        id: "draft_box",
        placeableRect: { x: 0, y: 0, width: 320, height: 320 },
        outerRect: { x: -20, y: -20, width: 360, height: 360 },
      },
      {
        id: "draft_box_upper_left",
        placeableRect: { x: -60, y: -60, width: 0, height: 0 },
        outerRect: { x: -80, y: -80, width: 40, height: 40 },
      },
    ]);
    expect(resolveBaseOuterBounds(draftBox)).toEqual({
      x: -80, y: -80, width: 420, height: 420,
    });
  });

  it("keeps both 20-cell gaps unbuildable and never treats a spanning footprint as inside", () => {
    expect(isGridPointInBaseArea(draftBox, { x: -41, y: -41 }, "outer")).toBe(true);
    expect(isGridPointInBaseArea(draftBox, { x: -40, y: -40 }, "outer")).toBe(false);
    expect(isGridPointInBaseArea(draftBox, { x: -21, y: -21 }, "outer")).toBe(false);
    expect(isGridPointInBaseArea(draftBox, { x: -20, y: -20 }, "outer")).toBe(true);
    expect(resolveBaseAreaContainingRect(draftBox, {
      x: -45, y: -45, width: 1, height: 1,
    }, "outer")?.id).toBe("draft_box_upper_left");
    expect(resolveBaseAreaContainingRect(draftBox, {
      x: -45, y: -45, width: 1, height: 1,
    }, "placeable")).toBeNull();
    expect(resolveBaseAreaContainingRect(draftBox, {
      x: -45, y: -45, width: 30, height: 30,
    }, "outer")).toBeNull();
  });
});
