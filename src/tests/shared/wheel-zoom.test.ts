import { describe, expect, it } from "vitest";
import { resolveWheelZoomDirection } from "@/shared/browser/wheel-zoom";

describe("滚轮缩放方向", () => {
  it.each([0.1, 1, 120, 1000])("增量 %s 的大小不影响方向，反转设置只翻转方向", delta => {
    expect(resolveWheelZoomDirection(-delta, false)).toBe(1);
    expect(resolveWheelZoomDirection(delta, false)).toBe(-1);
    expect(resolveWheelZoomDirection(-delta, true)).toBe(-1);
    expect(resolveWheelZoomDirection(delta, true)).toBe(1);
  });

  it.each([0, -0, NaN, Infinity, -Infinity])("增量 %s 无有效方向时不缩放", delta => {
    expect(resolveWheelZoomDirection(delta, false)).toBe(0);
    expect(resolveWheelZoomDirection(delta, true)).toBe(0);
  });
});
