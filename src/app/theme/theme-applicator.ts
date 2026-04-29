import { reaction } from "mobx";

import type { AppHost } from "@/app/host/app-host";
import {
  APP_THEME_COLOR_KEYS,
  type AppTheme,
} from "@/domain/state/theme";

export function applyAppThemeToDocument(
  theme: AppTheme,
  targetDocument?: Document,
): void {
  const resolvedDocument = targetDocument ?? resolveBrowserDocument();

  if (resolvedDocument === null) {
    return;
  }

  const root = resolvedDocument.documentElement;
  root.dataset.appTheme = theme.id;
  root.style.colorScheme = theme.colorScheme;

  for (const colorKey of APP_THEME_COLOR_KEYS) {
    root.style.setProperty(`--${colorKey}`, theme.colors[colorKey]);
  }
}

export function hookThemeApplicator(
  appHost: Pick<AppHost, "state">,
  targetDocument?: Document,
): () => void {
  applyAppThemeToDocument(appHost.state.theme, targetDocument);

  return reaction(
    () => appHost.state.theme,
    (theme) => {
      applyAppThemeToDocument(theme, targetDocument);
    },
  );
}

function resolveBrowserDocument(): Document | null {
  if (typeof document === "undefined") {
    return null;
  }

  return document;
}
