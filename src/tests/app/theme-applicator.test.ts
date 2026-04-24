// @vitest-environment jsdom

import { afterEach, describe, expect, it } from "vitest";

import { AYU_DARK_THEME, AYU_LIGHT_THEME } from "@/app/theme";
import { applyAppThemeToDocument } from "@/app/theme/theme-applicator";

afterEach(() => {
  document.documentElement.removeAttribute("data-app-theme");
  document.documentElement.removeAttribute("style");
});

describe("applyAppThemeToDocument", () => {
  it("mounts the active theme onto the document root", () => {
    applyAppThemeToDocument(AYU_DARK_THEME);

    expect(document.documentElement.dataset.appTheme).toBe("ayu-dark");
    expect(document.documentElement.style.colorScheme).toBe("dark");
    expect(document.documentElement.style.getPropertyValue("--shell-bg")).toBe("#0f1419");
    expect(document.documentElement.style.getPropertyValue("--renderer-grid-line")).toBe("#ffffff");

    applyAppThemeToDocument(AYU_LIGHT_THEME);

    expect(document.documentElement.dataset.appTheme).toBe("ayu-light");
    expect(document.documentElement.style.colorScheme).toBe("light");
    expect(document.documentElement.style.getPropertyValue("--shell-bg")).toBe("#f5f7fa");
    expect(document.documentElement.style.getPropertyValue("--renderer-grid-line")).toBe("#5c6773");
  });
});
