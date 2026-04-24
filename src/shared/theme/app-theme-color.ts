import type { AppTheme, AppThemeColorKey } from "@/domain/state/theme";

export function resolveAppThemeColor(
  theme: AppTheme,
  colorKey: AppThemeColorKey,
): string {
  return theme.colors[colorKey];
}

export function resolveAppThemeColorNumber(
  theme: AppTheme,
  colorKey: AppThemeColorKey,
): number {
  const color = resolveAppThemeColor(theme, colorKey).trim();

  if (!/^#[0-9a-fA-F]{6}$/.test(color)) {
    throw new Error(`Theme color "${colorKey}" must be a 6-digit hex color for renderer usage.`);
  }

  return Number.parseInt(color.slice(1), 16);
}