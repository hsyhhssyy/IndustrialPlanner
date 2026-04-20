import { makeAutoObservable } from "mobx";

import type { AppLocale } from "@/shared/i18n/messages";
import type { AppSettings, UiState, WorkbenchState } from "@/domain/state/types";

export const MIN_LEFT_DOCK_WIDTH = 375;
export const MAX_LEFT_DOCK_WIDTH = 600;
export const DEFAULT_LEFT_DOCK_WIDTH = 375;

export function clampLeftDockWidth(width: number): number {
  return Math.min(MAX_LEFT_DOCK_WIDTH, Math.max(MIN_LEFT_DOCK_WIDTH, Math.round(width)));
}

export interface AppSettingsReadWrite extends AppSettings {
  locale: AppLocale;
}

export interface WorkbenchStateReadWrite extends WorkbenchState {
  leftDockOpen: boolean;
  rightDockOpen: boolean;
  leftDockWidth: number;
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
  /// runtimeState 不进Contract，这是纯私有的状态。
  runtime: RuntimeStateReadWrite;
}

class WorkbenchStateReadWriteImpl implements WorkbenchStateReadWrite {
  leftDockOpen = true;
  rightDockOpen = true;
  leftDockWidth = DEFAULT_LEFT_DOCK_WIDTH;

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