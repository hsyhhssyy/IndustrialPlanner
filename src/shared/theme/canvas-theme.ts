import type { AppTheme, AppThemeColorKey } from "@/domain/app/types/theme";

export const IN_CANVAS_THEME_COLOR_KEYS = [
  "in-canvas-bg",
  "in-canvas-focus-ring",
  "in-canvas-marquee-bg",
  "in-canvas-marquee-shadow",
  "in-canvas-toolbar-button-border",
  "in-canvas-toolbar-button-bg",
  "in-canvas-toolbar-button-hover-border",
  "in-canvas-toolbar-button-hover-bg",
  "in-canvas-toolbar-button-text",
  "in-canvas-toolbar-shadow",
  "in-canvas-toolbar-cancel",
  "in-canvas-toolbar-confirm",
  "in-canvas-toolbar-active-border",
  "in-canvas-toolbar-active-bg",
  "in-canvas-toolbar-active-text",
  "in-canvas-toolbar-label-text",
  "in-canvas-toolbar-label-shadow",
  "in-canvas-touch-hold-track",
  "in-canvas-touch-hold-core-border",
  "in-canvas-touch-hold-core-bg",
  "in-canvas-touch-hold-core-shadow",
  "in-canvas-gesture-panel-border",
  "in-canvas-gesture-panel-bg",
  "in-canvas-gesture-panel-shadow",
  "in-canvas-gesture-button-border",
  "in-canvas-gesture-button-bg",
  "in-canvas-gesture-button-hover-border",
  "in-canvas-gesture-button-hover-bg",
  "in-canvas-gesture-events-border",
] as const satisfies readonly AppThemeColorKey[];

type AppThemeColorPatch = Readonly<Partial<Record<AppThemeColorKey, string>>>;
type InCanvasThemeColorKey = typeof IN_CANVAS_THEME_COLOR_KEYS[number];
type InCanvasThemeCssVariableName = `--${InCanvasThemeColorKey}`;

export type InCanvasThemeCssVariables = Readonly<Record<InCanvasThemeCssVariableName, string>>;

export const BLUEPRINT_CANVAS_THEME_COLOR_PATCH = {
  "in-canvas-bg": "#eef3f8",
  "in-canvas-focus-ring": "rgb(31 127 179 / 0.32)",
  "in-canvas-marquee-bg": "rgb(31 127 179 / 0.1)",
  "in-canvas-marquee-shadow": "rgb(31 127 179 / 0.08)",
  "in-canvas-toolbar-button-border": "rgb(51 65 85 / 0.08)",
  "in-canvas-toolbar-button-bg": "rgb(255 255 255 / 0.96)",
  "in-canvas-toolbar-button-hover-border": "rgb(51 65 85 / 0.18)",
  "in-canvas-toolbar-button-hover-bg": "rgb(241 245 249 / 0.98)",
  "in-canvas-toolbar-button-text": "rgb(51 65 85)",
  "in-canvas-toolbar-shadow": "rgb(15 23 42 / 0.16)",
  "in-canvas-toolbar-cancel": "rgb(194 58 58)",
  "in-canvas-toolbar-confirm": "rgb(28 146 95)",
  "in-canvas-toolbar-active-border": "#1f7fb3",
  "in-canvas-toolbar-active-bg": "rgb(57 158 230 / 0.14)",
  "in-canvas-toolbar-active-text": "#334155",
  "in-canvas-toolbar-label-text": "rgb(51 65 85)",
  "in-canvas-toolbar-label-shadow": "rgb(255 255 255 / 0.72)",
  "in-canvas-touch-hold-track": "rgb(31 127 179 / 0.18)",
  "in-canvas-touch-hold-core-border": "rgb(31 127 179 / 0.34)",
  "in-canvas-touch-hold-core-bg": "rgb(255 255 255 / 0.96)",
  "in-canvas-touch-hold-core-shadow": "rgb(15 23 42 / 0.14)",
  "in-canvas-gesture-panel-border": "rgb(31 127 179 / 0.22)",
  "in-canvas-gesture-panel-bg": "rgb(255 255 255 / 0.88)",
  "in-canvas-gesture-panel-shadow": "rgb(15 23 42 / 0.16)",
  "in-canvas-gesture-button-border": "rgb(31 127 179 / 0.22)",
  "in-canvas-gesture-button-bg": "rgb(31 127 179 / 0.06)",
  "in-canvas-gesture-button-hover-border": "rgb(31 127 179 / 0.34)",
  "in-canvas-gesture-button-hover-bg": "rgb(31 127 179 / 0.12)",
  "in-canvas-gesture-events-border": "rgb(31 127 179 / 0.12)",
  "renderer-grid-line": "#5c6773",
  "renderer-marquee-stroke": "#000000",
  "renderer-mode-label-shadow": "#000000",
  "renderer-belt-tile-fill": "#e6ecf3",
  "renderer-belt-tile-stroke": "#d9822b",
  "renderer-belt-track": "#94a3b8",
  "renderer-belt-lane": "#334155",
  "renderer-port-chevron": "#334155",
  "renderer-preview-rect-fill": "#399ee6",
  "renderer-flow-glow-stroke": "#555555",
  "renderer-flow-glow-tint": "#ffffff",
  "renderer-pipe-body-tint": "#1f7fb3",
  "renderer-dedicated-logistic-focus-tint": "#8795a8",
} satisfies AppThemeColorPatch;

export function resolveEffectiveCanvasTheme(
  theme: AppTheme,
  isBlueprintStyleEnabled: boolean,
): AppTheme {
  if (!isBlueprintStyleEnabled) {
    return theme;
  }

  return {
    ...theme,
    colors: {
      ...theme.colors,
      ...BLUEPRINT_CANVAS_THEME_COLOR_PATCH,
    },
  };
}

export function resolveInCanvasThemeCssVariables(theme: AppTheme): InCanvasThemeCssVariables {
  return Object.fromEntries(
    IN_CANVAS_THEME_COLOR_KEYS.map((colorKey) => [
      `--${colorKey}`,
      theme.colors[colorKey],
    ]),
  ) as InCanvasThemeCssVariables;
}
