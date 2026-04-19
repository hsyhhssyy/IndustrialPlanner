import { makeAutoObservable } from "mobx";

import type { AppLocale } from "@/shared/i18n/messages";
import type { AppSettings, UiState } from "@/domain/state/types";

export interface AppSettingsReadWrite extends AppSettings {
  locale: AppLocale;
}

const DEFAULT_APP_LOCALE: AppLocale = "zh-CN";

export interface UiStateReadWrite extends UiState {
  settings: AppSettingsReadWrite;
  leftDockOpen: boolean;
  rightDockOpen: boolean;
  bottomBarOpen: boolean;
  activePanel: "placement" | "delete" | "blueprint" | "history" | null;
}

export class UiStateReadWriteImpl implements UiStateReadWrite {
  settings: AppSettingsReadWrite = {
    locale: DEFAULT_APP_LOCALE,
  };

  leftDockOpen = true;
  rightDockOpen = true;
  bottomBarOpen = true;
  activePanel: "placement" | "delete" | "blueprint" | "history" | null = null;

  public constructor() {
    makeAutoObservable(this, {}, { autoBind: true });
  }
}

export function createUiStateReadWrite(): UiStateReadWrite {
  return new UiStateReadWriteImpl();
}