import { makeAutoObservable } from "mobx";

import type { AppLocale } from "@/shared/i18n/messages";
import type { AppSettings, UiState, WorkbenchState } from "@/domain/state/types";

export interface AppSettingsReadWrite extends AppSettings {
  locale: AppLocale;
}

export interface WorkbenchStateReadWrite extends WorkbenchState {
  leftDockOpen: boolean;
  rightDockOpen: boolean;
}

const DEFAULT_APP_LOCALE: AppLocale = "zh-CN";

export interface UiStateReadWrite extends UiState {
  settings: AppSettingsReadWrite;
  workbench: WorkbenchStateReadWrite;
  bottomBarOpen: boolean;
  activePanel: "placement" | "delete" | "blueprint" | "history" | null;
}

class WorkbenchStateReadWriteImpl implements WorkbenchStateReadWrite {
  leftDockOpen = true;
  rightDockOpen = true;

  public constructor() {
    makeAutoObservable(this, {}, { autoBind: true });
  }
}

export class UiStateReadWriteImpl implements UiStateReadWrite {
  settings: AppSettingsReadWrite = {
    locale: DEFAULT_APP_LOCALE,
  };

  workbench: WorkbenchStateReadWrite = new WorkbenchStateReadWriteImpl();
  bottomBarOpen = true;
  activePanel: "placement" | "delete" | "blueprint" | "history" | null = null;

  public constructor() {
    makeAutoObservable(this, {}, { autoBind: true });
  }
}

export function createUiStateReadWrite(): UiStateReadWrite {
  return new UiStateReadWriteImpl();
}