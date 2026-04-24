import type { AppTheme, AppThemeId } from "@/domain/state/theme";

import { AYU_DARK_THEME } from "./ayu-dark";
import { AYU_LIGHT_THEME } from "./ayu-light";

export { AYU_DARK_THEME } from "./ayu-dark";
export { AYU_LIGHT_THEME } from "./ayu-light";

export const DEFAULT_APP_THEME_ID: AppThemeId = "ayu-light";

export const SUPPORTED_APP_THEMES = [
  AYU_DARK_THEME,
  AYU_LIGHT_THEME,
] as const satisfies readonly AppTheme[];

const APP_THEMES_BY_ID: Record<AppThemeId, AppTheme> = {
  "ayu-dark": AYU_DARK_THEME,
  "ayu-light": AYU_LIGHT_THEME,
};

export function isAppThemeId(value: unknown): value is AppThemeId {
  return value === "ayu-dark" || value === "ayu-light";
}

export function resolveAppTheme(themeId: AppThemeId): AppTheme {
  return APP_THEMES_BY_ID[themeId];
}

export function resolveNextAppThemeId(themeId: AppThemeId): AppThemeId {
  return themeId === "ayu-dark" ? "ayu-light" : "ayu-dark";
}
