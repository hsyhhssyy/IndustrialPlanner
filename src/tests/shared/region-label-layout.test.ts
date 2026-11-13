import { describe, expect, it } from "vitest";
import { resolveRegionLabelLayout, resolveRegionLabelRect, resolveRegionLabelText } from "@/shared/geometry/region-label-layout";

describe("shared region label layout", () => {
  it("uses the largest rectangle with deterministic ties and leaves the input unchanged", () => {
    const rects = [{ x: 10, y: 0, width: 4, height: 2 }, { x: 0, y: 0, width: 2, height: 4 }];
    const before = structuredClone(rects);
    expect(resolveRegionLabelRect(rects)).toEqual(rects[1]);
    expect(rects).toEqual(before);
    expect(resolveRegionLabelRect([])).toBeNull();
  });

  it.each([0, 90, 180, 270] as const)("projects rotation %i with identical local and client bounds", displayRotation => {
    const options = { rects: [{ x: 1, y: 2, width: 4, height: 6 }], viewportCenter: { x: 0, y: 0 },
      gridCellPixelSize: 16, displayRotation, labelWidth: 80, labelHeight: 30 };
    const local = resolveRegionLabelLayout({ ...options, viewportBounds: { left: 0, top: 0, width: 400, height: 300 } })!;
    const client = resolveRegionLabelLayout({ ...options, viewportBounds: { left: 173, top: 91, width: 400, height: 300 } })!;
    expect(client).toEqual({ ...local, left: local.left + 173, top: local.top + 91 });
    expect(local.left).toBeGreaterThanOrEqual(8);
    expect(local.top).toBeGreaterThanOrEqual(8);
    expect(local.left + local.width).toBeLessThanOrEqual(392);
    expect(local.top + local.height).toBeLessThanOrEqual(292);
  });

  it("clamps offscreen labels and keeps oversized text anchored at the inset", () => {
    const options = { rects: [{ x: 1000, y: -1000, width: 1, height: 1 }], viewportCenter: { x: 0, y: 0 },
      viewportBounds: { left: 100, top: 50, width: 400, height: 300 }, gridCellPixelSize: 16 };
    expect(resolveRegionLabelLayout({ ...options, labelWidth: 80, labelHeight: 30 }))
      .toEqual({ left: 412, top: 58, width: 80, height: 30 });
    expect(resolveRegionLabelLayout({ ...options, labelWidth: 500, labelHeight: 400 }))
      .toEqual({ left: 108, top: 58, width: 500, height: 400 });
    const region = { id: "r", name: "一区", description: "", color: "#ffffff", rects: options.rects };
    expect(resolveRegionLabelText(region, false, "格")).toBe("一区");
    expect(resolveRegionLabelText(region, true, "格")).toContain("一区\n");
  });
});
