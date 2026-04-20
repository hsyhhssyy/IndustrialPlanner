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

export interface RuntimeStateReadWrite {
  activePanel: ActivePanel;
}

const DEFAULT_APP_LOCALE: AppLocale = "zh-CN";

export type ActivePanel = "placement" | "delete" | "blueprint" | "history" | null;

export interface UiStateReadWrite extends UiState {
  /// settings存储用户显式在设置页面配置的设置，这里面所有的内容都要持久化
  settings: AppSettingsReadWrite;
  /// workbenchState存储用户没有显式配置，但是仍然需要存储的状态，比如dock的开合状态等等。
  workbench: WorkbenchStateReadWrite;
  /// runtimeState存储一些不需要持久化的状态，比如当前打开的panel是什么，手持的工具是什么等等，每次页面刷新时，这些状态都会被重置回默认值。
  runtime: RuntimeStateReadWrite;
}

class WorkbenchStateReadWriteImpl implements WorkbenchStateReadWrite {
  leftDockOpen = true;
  rightDockOpen = true;

  public constructor() {
    makeAutoObservable(this, {}, { autoBind: true });
  }
}

class RuntimeStateReadWriteImpl implements RuntimeStateReadWrite {
  activePanel: ActivePanel = null;

  public constructor() {
    makeAutoObservable(this, {}, { autoBind: true });
  }
}

export class UiStateReadWriteImpl implements UiStateReadWrite {
  settings: AppSettingsReadWrite = {
    locale: DEFAULT_APP_LOCALE,
  };

  workbench: WorkbenchStateReadWrite = new WorkbenchStateReadWriteImpl();
  runtime: RuntimeStateReadWrite = new RuntimeStateReadWriteImpl();

  public constructor() {
    makeAutoObservable(this, {}, { autoBind: true });
  }
}

export function createUiStateReadWrite(): UiStateReadWrite {
  return new UiStateReadWriteImpl();
}