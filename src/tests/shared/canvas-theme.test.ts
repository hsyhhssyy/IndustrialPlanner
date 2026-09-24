import { describe, expect, it } from "vitest";

import { AYU_DARK_THEME, AYU_LIGHT_THEME } from "@/app/theme";
import {
  BLUEPRINT_CANVAS_THEME_COLOR_PATCH,
  resolveEffectiveCanvasTheme,
  resolveInCanvasThemeCssVariables,
} from "@/shared/theme/canvas-theme";

describe("resolveEffectiveCanvasTheme", () => {
  it("returns the active theme unchanged when blueprint style is off", () => {
    expect(resolveEffectiveCanvasTheme(AYU_DARK_THEME, false)).toBe(AYU_DARK_THEME);
  });

  it("applies a partial light canvas and renderer color patch without changing global theme semantics", () => {
    const theme = resolveEffectiveCanvasTheme(AYU_DARK_THEME, true);

    expect(theme).not.toBe(AYU_DARK_THEME);
    expect(theme.id).toBe("ayu-dark");
    expect(theme.colorScheme).toBe("dark");
    expect(theme.renderer).toBe(AYU_DARK_THEME.renderer);
    expect(theme.colors["shell-bg"]).toBe(AYU_DARK_THEME.colors["shell-bg"]);
    expect(theme.colors["surface-1"]).toBe(AYU_DARK_THEME.colors["surface-1"]);
    expect(theme.colors["canvas-bg"]).toBe(AYU_DARK_THEME.colors["canvas-bg"]);
    expect(theme.colors["in-canvas-bg"]).toBe(BLUEPRINT_CANVAS_THEME_COLOR_PATCH["in-canvas-bg"]);
    expect(theme.colors["renderer-grid-line"]).toBe(BLUEPRINT_CANVAS_THEME_COLOR_PATCH["renderer-grid-line"]);
    expect(theme.colors["renderer-flow-glow-tint"]).toBe(
      BLUEPRINT_CANVAS_THEME_COLOR_PATCH["renderer-flow-glow-tint"],
    );
  });

  it.each([AYU_LIGHT_THEME, AYU_DARK_THEME])("$id 草地使用白色提示与深色衬底，保持全局主题和画布底色", (baseTheme) => {
    const theme = resolveEffectiveCanvasTheme(baseTheme, false, true);

    expect(theme.colors["renderer-port-chevron"]).toBe("#ffffff");
    expect(theme.colors["in-canvas-toolbar-button-text"]).toBe("#ffffff");
    expect(theme.colors["in-canvas-toolbar-label-text"]).toBe("#ffffff");
    expect(theme.colors["in-canvas-toolbar-active-text"]).toBe("#ffffff");
    expect(theme.colors["in-canvas-toolbar-active-border"]).toBe("#82d4ff");
    expect(theme.colorScheme).toBe(baseTheme.colorScheme);
    for (const key of ["text-0", "text-1", "surface-1", "shell-bg"] as const) {
      expect(theme.colors[key]).toBe(baseTheme.colors[key]);
    }

    // 按最亮的白色地面合成半透明底，白色文字仍需满足 4.5:1 的对比度。
    for (const key of [
      "in-canvas-toolbar-button-bg",
      "in-canvas-toolbar-button-hover-bg",
      "in-canvas-gesture-panel-bg",
      "in-canvas-gesture-button-bg",
      "in-canvas-gesture-button-hover-bg",
    ] as const) {
      const channels = theme.colors[key].match(/[\d.]+/g)!.map(Number);
      const alpha = channels[3]!;
      const luminance = channels.slice(0, 3).reduce((sum, channel, index) => {
        const value = (channel * alpha + 255 * (1 - alpha)) / 255;
        const linear = value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
        return sum + linear * [0.2126, 0.7152, 0.0722][index]!;
      }, 0);
      expect(1.05 / (luminance + 0.05)).toBeGreaterThanOrEqual(4.5);
    }
    expect(theme.colors["renderer-grid-line"]).toBe(
      baseTheme.colors["renderer-grid-line"],
    );
    expect(theme.colors["in-canvas-bg"]).toBe(baseTheme.colors["in-canvas-bg"]);
    expect(resolveEffectiveCanvasTheme(baseTheme, false, false)).toBe(baseTheme);
  });

  it("蓝图和草地标记异常并存时由蓝图浅色画布配色覆盖草地配色", () => {
    const theme = resolveEffectiveCanvasTheme(AYU_DARK_THEME, true, true);

    expect(theme.colors["renderer-port-chevron"]).toBe(
      BLUEPRINT_CANVAS_THEME_COLOR_PATCH["renderer-port-chevron"],
    );
    expect(theme.colors["in-canvas-toolbar-button-bg"]).toBe(
      BLUEPRINT_CANVAS_THEME_COLOR_PATCH["in-canvas-toolbar-button-bg"],
    );
    expect(theme.colors["in-canvas-toolbar-label-text"]).toBe(
      BLUEPRINT_CANVAS_THEME_COLOR_PATCH["in-canvas-toolbar-label-text"],
    );
    expect(theme.colors["in-canvas-gesture-panel-bg"]).toBe(
      BLUEPRINT_CANVAS_THEME_COLOR_PATCH["in-canvas-gesture-panel-bg"],
    );
  });
});

describe("resolveInCanvasThemeCssVariables", () => {
  it("exports only in-canvas css variables from the effective canvas theme", () => {
    const cssVariables = resolveInCanvasThemeCssVariables(
      resolveEffectiveCanvasTheme(AYU_DARK_THEME, true),
    );

    expect(cssVariables["--in-canvas-bg"]).toBe(AYU_LIGHT_THEME.colors["in-canvas-bg"]);
    expect(cssVariables["--in-canvas-toolbar-button-text"]).toBe(
      AYU_LIGHT_THEME.colors["in-canvas-toolbar-button-text"],
    );
    expect(Object.keys(cssVariables).some((key) => key === "--surface-1")).toBe(false);
    expect(Object.keys(cssVariables).some((key) => key === "--renderer-grid-line")).toBe(false);
  });
});
