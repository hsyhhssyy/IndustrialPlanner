export type AppThemeId = "ayu-dark" | "ayu-light";

export const APP_THEME_COLOR_KEYS = [
  "transparent",
  "shell-bg",
  "surface-1",
  "surface-2",
  "surface-3",
  "surface-4",
  "status-bg",
  "canvas-bg",
  "line",
  "line-strong",
  "text-0",
  "text-1",
  "text-2",
  "accent",
  "accent-strong",
  "accent-soft",
  "warn",
  "danger",
  "scrollbar-track",
  "scrollbar-thumb",
  "scrollbar-thumb-hover",
  "floating-control-border",
  "floating-control-bg",
  "floating-control-bg-hover",
  "shadow-floating-control",
  "dock-resize-hover",
  "status-chip-border",
  "status-chip-bg",
  "status-separator",
  "highlight-ring",
  "placement-shortcut-border",
  "placement-shortcut-bg",
  "placement-shortcut-text",
  "placement-shortcut-shadow",
  "placement-button-bg-end",
  "pill-accent-border",
  "pill-warn-border",
  "pill-danger-border",
  "canvas-focus-ring",
  "canvas-marquee-bg",
  "canvas-marquee-shadow",
  "touch-hold-track",
  "touch-hold-core-border",
  "touch-hold-core-bg",
  "touch-hold-core-shadow",
  "gesture-panel-border",
  "gesture-panel-bg",
  "gesture-panel-shadow",
  "gesture-button-border",
  "gesture-button-bg",
  "gesture-button-hover-border",
  "gesture-button-hover-bg",
  "gesture-events-border",
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
  "canvas-floating-toolbar-border",
  "canvas-floating-toolbar-bg",
  "canvas-floating-toolbar-shadow",
  "canvas-floating-toolbar-button-border",
  "canvas-floating-toolbar-button-bg",
  "canvas-floating-toolbar-button-text",
  "canvas-floating-toolbar-button-hover-border",
  "canvas-floating-toolbar-button-hover-bg",
  "canvas-floating-toolbar-cancel",
  "canvas-floating-toolbar-confirm",
  "renderer-grid-line",
  "renderer-selection-stroke",
  "renderer-marquee-stroke",
  "sprite-preview-border-box",
  "renderer-belt-tile-fill",
  "renderer-belt-tile-stroke",
  "renderer-belt-track",
  "renderer-belt-lane",
  "renderer-port-chevron",
  "renderer-preview-rect-fill",
  "renderer-flow-glow-stroke",
  "renderer-flow-glow-tint",
  "renderer-pipe-body-tint",
  "renderer-dedicated-logistic-focus-tint",
] as const;

export type AppThemeColorKey = typeof APP_THEME_COLOR_KEYS[number];
export type AppThemeColorMap = Readonly<Record<AppThemeColorKey, string>>;

export interface AppThemeRendererColorKeys {
  readonly worldGridLineColorKey: AppThemeColorKey;
  readonly worldEntitySelectionStrokeColorKey: AppThemeColorKey;
  readonly worldMarqueeStrokeColorKey: AppThemeColorKey;
  readonly spritePreviewBorderBoxColorKey: AppThemeColorKey;
  readonly beltTileFillColorKey: AppThemeColorKey;
  readonly beltTileStrokeColorKey: AppThemeColorKey;
  readonly beltTrackColorKey: AppThemeColorKey;
  readonly beltLaneColorKey: AppThemeColorKey;
  readonly portChevronColorKey: AppThemeColorKey;
  readonly worldPreviewRectFillColorKey: AppThemeColorKey;
  readonly flowGlowStrokeColorKey: AppThemeColorKey;
  readonly flowGlowTintColorKey: AppThemeColorKey;
  readonly pipeBodyTintColorKey: AppThemeColorKey;
  readonly dedicatedLogisticFocusTintColorKey: AppThemeColorKey;
}

export interface AppTheme {
  readonly id: AppThemeId;
  readonly name: string;
  readonly colorScheme: "dark" | "light";
  readonly colors: AppThemeColorMap;
  readonly renderer: AppThemeRendererColorKeys;
}
