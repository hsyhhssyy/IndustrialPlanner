import { describe, expect, it } from "vitest";

import { clipSegmentToViewport } from "@/renderer/scene/decorations/DarkPipeLinkGeometry";

describe("DarkPipeLinkGeometry", () => {
  it("clips a dark pipe link segment when both endpoints are outside the viewport", () => {
    const clipped = clipSegmentToViewport({
      start: { x: -40, y: 50 },
      end: { x: 140, y: 50 },
      viewport: {
        left: 0,
        top: 0,
        width: 100,
        height: 100,
      },
    });

    expect(clipped).toEqual({
      start: { x: 0, y: 50 },
      end: { x: 100, y: 50 },
    });
  });

  it("skips a dark pipe link segment that does not intersect the viewport", () => {
    expect(clipSegmentToViewport({
      start: { x: -40, y: -20 },
      end: { x: -10, y: -20 },
      viewport: {
        left: 0,
        top: 0,
        width: 100,
        height: 100,
      },
    })).toBeNull();
  });
});
