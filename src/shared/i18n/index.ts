import type { AppLocale } from "@/domain/app/types/app-types";
import { DEFAULT_LOCALE } from "@/shared/i18n/types";

export type { UiKey } from "@/shared/i18n/types";
export { DEFAULT_LOCALE, SUPPORTED_LOCALES } from "@/shared/i18n/types";

import zhCnUi from "@/shared/i18n/zh-cn/ui";
import zhCnRegistry from "@/shared/i18n/zh-cn/registry";
import enUsUi from "@/shared/i18n/en-us/ui";
import enUsRegistry from "@/shared/i18n/en-us/registry";

const UI_TRANSLATIONS: Record<AppLocale, Record<string, string>> = {
  "zh-CN": zhCnUi,
  "en-US": enUsUi,
};

const REGISTRY_TRANSLATIONS: Record<AppLocale, Record<string, string>> = {
  "zh-CN": zhCnRegistry,
  "en-US": enUsRegistry,
};

function isRegistryKey(key: string): boolean {
  return key.startsWith("registry.");
}

export function lookupText(locale: AppLocale, key: string): string | undefined {
  const pool = isRegistryKey(key) ? REGISTRY_TRANSLATIONS : UI_TRANSLATIONS;
  const localeData = pool[locale];
  const defaultData = pool[DEFAULT_LOCALE];
  return localeData[key] ?? defaultData[key];
}
