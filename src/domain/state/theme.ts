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
  "sprite-preview-border-box",
  "renderer-belt-tile-fill",
  "renderer-belt-tile-stroke",
  "renderer-belt-track",
  "renderer-belt-lane",
] as const;

export type AppThemeColorKey = typeof APP_THEME_COLOR_KEYS[number];
export type AppThemeColorMap = Readonly<Record<AppThemeColorKey, string>>;

export interface AppThemeRendererColorKeys {
  readonly worldGridLineColorKey: AppThemeColorKey;
  readonly worldEntitySelectionStrokeColorKey: AppThemeColorKey;
  readonly spritePreviewBorderBoxColorKey: AppThemeColorKey;
  readonly beltTileFillColorKey: AppThemeColorKey;
  readonly beltTileStrokeColorKey: AppThemeColorKey;
  readonly beltTrackColorKey: AppThemeColorKey;
  readonly beltLaneColorKey: AppThemeColorKey;
}

export interface AppTheme {
  readonly id: AppThemeId;
  readonly name: string;
  readonly colorScheme: "dark" | "light";
  readonly colors: AppThemeColorMap;
  readonly renderer: AppThemeRendererColorKeys;
}
