import { describe, expect, it } from "vitest";
import { createDecorationActivityGuard, createDecorationRedrawGuard } from "@/renderer/scene/decorations/DecorationRedrawGuard";

describe("装饰层失效状态", () => {
  it("空闲时只清理一次，活跃时不限制更新，退出后仍能清除旧内容", () => {
    const sync = createDecorationActivityGuard();
    expect(sync(false)).toBe(true);
    expect(sync(false)).toBe(false);
    expect(sync(true)).toBe(true);
    expect(sync(true)).toBe(true);
    expect(sync(false)).toBe(true);
    expect(sync(false)).toBe(false);
    expect(sync(true)).toBe(true);
  });

  it("以值快照比较输入，识别同一数组的原地修改以及从有内容到空内容", () => {
    const redraw = createDecorationRedrawGuard();
    const input = [2, 3, 4, 5];
    expect(redraw(input)).toBe(true);
    expect(redraw([...input])).toBe(false);
    input[2] = 9;
    expect(redraw(input)).toBe(true);
    expect(redraw([])).toBe(true);
    expect(redraw([])).toBe(false);
    expect(redraw(input)).toBe(true);
  });
});
