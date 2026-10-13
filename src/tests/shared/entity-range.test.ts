import { describe, expect, it } from "vitest";
import { resolveLocalRangeGridRect } from "@/shared/geometry/entity-range";
import { resolveRangeAnimationPlacement, type RangeAnimationInstance, type RangeFrameContext } from "@/renderer/ranges";
import type { GridRotation } from "@/domain/shared/grid";

const rotations: readonly GridRotation[] = [0, 90, 180, 270];

describe("偏移矩形范围", () => {
  it.each([
    [0, { x: 13, y: 19, width: 4, height: 5 }],
    [90, { x: 9, y: 23, width: 5, height: 4 }],
    [180, { x: 6, y: 19, width: 4, height: 5 }],
    [270, { x: 9, y: 16, width: 5, height: 4 }],
  ] as const)("洒水机 %i° 保持前方 4×5 范围", (rotation, expected) => {
    expect(resolveLocalRangeGridRect({ x: 10, y: 20 }, { width: 3, height: 3 }, rotation,
      { x: 3, y: -1, width: 4, height: 5 })).toEqual(expected);
  });
  it("支持与设备分离、非方形占地的范围", () => {
    expect(resolveLocalRangeGridRect({ x: 10, y: 20 }, { width: 2, height: 3 }, 90,
      { x: 5, y: 1, width: 4, height: 2 })).toEqual({ x: 10, y: 25, width: 2, height: 4 });
  });
  it.each(rotations.flatMap((rotation) => rotations.map((displayRotation) => ({ rotation, displayRotation }))))(
    "设备 $rotation°、视角 $displayRotation° 的动画不丢朝向、不重复交换宽高", ({ rotation, displayRotation }) => {
      const gridRect = resolveLocalRangeGridRect({ x: 10, y: 20 }, { width: 3, height: 3 }, rotation,
        { x: 3, y: -1, width: 4, height: 5 });
      const instance: RangeAnimationInstance = { key: "test", gridRect, rotation, color: 0xffffff, assetRoot: "test" };
      const ctx: RangeFrameContext = { viewportBounds: { left: 0, top: 0, width: 800, height: 600 },
        viewportCenter: { x: 11.5, y: 21.5 }, gridCellPixelSize: 10, displayRotation,
        visibleGridRect: { x: 0, y: 0, width: 100, height: 100 }, nowMs: 0, initializeTexture: () => {} };
      const result = resolveRangeAnimationPlacement(ctx, instance, [-2, -2.5, 2, 2.5]);
      expect(result.scaleX).toBe(10);
      expect(result.scaleY).toBe(10);
      expect(result.rotation).toBeCloseTo((rotation + displayRotation) * Math.PI / 180);
      const turn = ((rotation + displayRotation) % 360) as GridRotation;
      const centerByRotation = { 0: [435, 300], 90: [400, 335], 180: [365, 300], 270: [400, 265] };
      expect([result.x, result.y]).toEqual(centerByRotation[turn]);
    },
  );
});
