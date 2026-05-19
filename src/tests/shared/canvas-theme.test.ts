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
