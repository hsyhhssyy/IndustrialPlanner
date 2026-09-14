import { describe, expect, it } from "vitest";

import {
  FALLBACK_FLUID_COLOR,
  fluidColorToNumber,
  resolveFluidColor,
} from "@/shared/fluid-color";

describe("流体颜色解析", () => {
  it("按分层读取 Registry 配色", () => {
    const colors = {
      body: "#5c9fe0",
      skin: "#52b1d1",
      skin2: "#07243a",
      splash: "#afe7ee",
    };

    expect(resolveFluidColor(colors)).toBe("#5c9fe0");
    expect(resolveFluidColor(colors, "skin")).toBe("#52b1d1");
    expect(resolveFluidColor(colors, "skin2")).toBe("#07243a");
    expect(resolveFluidColor(colors, "splash")).toBe("#afe7ee");
  });

  it("未知流体或不存在的分层统一回退灰色", () => {
    expect(resolveFluidColor(null)).toBe(FALLBACK_FLUID_COLOR);
    expect(resolveFluidColor(undefined)).toBe("#808080");
    expect(resolveFluidColor({ body: "#00d5ff", skin: "#6bf7ff" }, "splash"))
      .toBe("#808080");
    expect(fluidColorToNumber(FALLBACK_FLUID_COLOR)).toBe(0x808080);
  });
});
