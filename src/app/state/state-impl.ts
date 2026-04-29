import { makeAutoObservable } from "mobx";

import type { ScreenProfile } from "@/domain/state/screen-profile";
import type { AppTheme, AppThemeId } from "@/domain/state/theme";
import type {
  ActiveTool,
  AppSettings,
  EntityCollectionType,
  UiState,
  WorkbenchState,
} from "@/domain/state/types";
import type { ClientPixelPoint } from "@/domain/types/client-pixel";
import type { GridPoint } from "@/domain/types/grid";
import type { AppLocale } from "@/shared/i18n/messages";
import {
  resolveScreenProfileFromWindow,
} from "@/shared/browser/screen-profile";
import { DEFAULT_APP_THEME_ID, resolveAppTheme } from "../theme";

export const MIN_LEFT_DOCK_WIDTH = 375;
export const MAX_LEFT_DOCK_WIDTH = 600;
export const DEFAULT_LEFT_DOCK_WIDTH = 375;
export const DEFAULT_RIGHT_DOCK_WIDTH = 340;
export const MOBILE_LEFT_DOCK_WIDTH = 180;

export function clampLeftDockWidth(width: number): number {
  return Math.min(MAX_LEFT_DOCK_WIDTH, Math.max(MIN_LEFT_DOCK_WIDTH, Math.round(width)));
}

export function resolveLeftDockWidthForScreenProfile(
  width: number,
  screenProfile: Pick<ScreenProfile, "deviceClass">,
): number {
  if (screenProfile.deviceClass === "mobile") {
    return MOBILE_LEFT_DOCK_WIDTH;
  }

  return clampLeftDockWidth(width);
}

export interface AppSettingsReadWrite extends AppSettings {
  locale: AppLocale;
  themeId: AppThemeId;
  hypergryphOperationMode: boolean;
  hypergryphImmediateMove: boolean;
  hypergryphImmediateMarquee: boolean;
  gameShowHotkeys: boolean;
  debugShowFps: boolean;
  debugShowGestureDiagnosticsWindow: boolean;
}

export interface WorkbenchStateReadWrite extends WorkbenchState {
  leftDockOpen: boolean;
  rightDockOpen: boolean;
  leftDockWidth: number;
  topBarCollapsed: boolean;
}

export const CANVAS_FLOATING_TOOLBAR_BUTTON_IDS = [
  "canvas-floating-toolbar-button-ok",
  "canvas-floating-toolbar-button-cancel",
  "canvas-floating-toolbar-button-rotate",
  "canvas-floating-toolbar-button-delete",
  "canvas-floating-toolbar-button-delete-many",
] as const;

export type CanvasFloatingToolbarButtonId = typeof CANVAS_FLOATING_TOOLBAR_BUTTON_IDS[number];

export const CANVAS_RIGHT_DOCK_TOOLBAR_BUTTON_IDS = [
  "canvas-right-dock-toolbar-button-exit",
  "canvas-right-dock-toolbar-button-move",
  "canvas-right-dock-toolbar-button-save-blueprint",
  "canvas-right-dock-toolbar-button-copy",
  "canvas-right-dock-toolbar-button-delete",
] as const;

export type CanvasRightDockToolbarButtonId = typeof CANVAS_RIGHT_DOCK_TOOLBAR_BUTTON_IDS[number];

export const CANVAS_TOP_LEFT_CORNER_TOOLBAR_BUTTON_IDS = [
  "canvas-top-left-corner-toolbar-button-toggle-pipe",
  "canvas-top-left-corner-toolbar-button-toggle-reverse-marquee",
] as const;

export type CanvasTopLeftCornerToolbarButtonId =
  typeof CANVAS_TOP_LEFT_CORNER_TOOLBAR_BUTTON_IDS[number];

export interface CanvasFloatingToolbarSize {
  readonly width: number;
  readonly height: number;
}

export interface CanvasFloatingToolbarStateReadWrite {
  visible: boolean;
  buttonIds: CanvasFloatingToolbarButtonId[];
  anchor: ClientPixelPoint | null;
  attachedCollection: EntityCollectionType | null;
  measuredSize: CanvasFloatingToolbarSize | null;
}

export interface CanvasRightDockToolbarStateReadWrite {
  visible: boolean;
  buttonIds: CanvasRightDockToolbarButtonId[];
}

export interface CanvasTopLeftCornerToolbarStateReadWrite {
  visible: boolean;
  buttonIds: CanvasTopLeftCornerToolbarButtonId[];
}

export interface RuntimeStateReadWrite {
  activePanel: ActivePanel;
  moveAnchor: GridPoint | null;
  placementAnchor: GridPoint | null;
  singlePlacementDeviceId: string | null;
  marqueeAnchor: GridPoint | null;
  isReverseMarquee: boolean;
  canvasFloatingToolbar: CanvasFloatingToolbarStateReadWrite;
  canvasRightDockToolbar: CanvasRightDockToolbarStateReadWrite;
  canvasTopLeftCornerToolbar: CanvasTopLeftCornerToolbarStateReadWrite;
}

const DEFAULT_APP_LOCALE: AppLocale = "zh-CN";

export type ActivePanel = "placement" | "delete" | "blueprint" | "history" | null;

export interface UiStateReadWrite extends UiState {
  /// settings存储用户显式在设置页面配置的设置，这里面所有的内容都要持久化
  settings: AppSettingsReadWrite;
  /// workbenchState存储用户没有显式配置，但是仍然需要存储的状态，比如dock的开合状态等等。
  workbench: WorkbenchStateReadWrite;
  /// screenProfile 是当前 browser viewport / device profile 的公共 UI 运行态，不进入持久化。
  screenProfile: ScreenProfile;
  /// activeTool 是当前激活的工具，属于公共 contract 状态。
  activeTool: ActiveTool;
  /// runtimeState存储一些不需要持久化的状态，比如当前打开的panel是什么等等，每次页面刷新时，这些状态都会被重置回默认值。
  /// runtimeState 不进Contract，这是纯私有的状态。
  runtime: RuntimeStateReadWrite;
}

class WorkbenchStateReadWriteImpl implements WorkbenchStateReadWrite {
  leftDockOpen = true;
  rightDockOpen = true;
  leftDockWidth = DEFAULT_LEFT_DOCK_WIDTH;
  topBarCollapsed = false;

  public constructor() {
    makeAutoObservable(this, {}, { autoBind: true });
  }
}

class CanvasFloatingToolbarStateReadWriteImpl implements CanvasFloatingToolbarStateReadWrite {
  visible = false;
  buttonIds: CanvasFloatingToolbarButtonId[] = [];
  anchor: ClientPixelPoint | null = null;
  attachedCollection: EntityCollectionType | null = null;
  measuredSize: CanvasFloatingToolbarSize | null = null;

  public constructor() {
    makeAutoObservable(this, {}, { autoBind: true });
  }
}

class CanvasRightDockToolbarStateReadWriteImpl implements CanvasRightDockToolbarStateReadWrite {
  visible = false;
  buttonIds: CanvasRightDockToolbarButtonId[] = [];

  public constructor() {
    makeAutoObservable(this, {}, { autoBind: true });
  }
}

class CanvasTopLeftCornerToolbarStateReadWriteImpl implements CanvasTopLeftCornerToolbarStateReadWrite {
  visible = false;
  buttonIds: CanvasTopLeftCornerToolbarButtonId[] = [];

  public constructor() {
    makeAutoObservable(this, {}, { autoBind: true });
  }
}

class RuntimeStateReadWriteImpl implements RuntimeStateReadWrite {
  activePanel: ActivePanel = null;
  moveAnchor: GridPoint | null = null;
  placementAnchor: GridPoint | null = null;
  singlePlacementDeviceId: string | null = null;
  marqueeAnchor: GridPoint | null = null;
  isReverseMarquee = false;
  canvasFloatingToolbar: CanvasFloatingToolbarStateReadWrite = new CanvasFloatingToolbarStateReadWriteImpl();
  canvasRightDockToolbar: CanvasRightDockToolbarStateReadWrite = new CanvasRightDockToolbarStateReadWriteImpl();
  canvasTopLeftCornerToolbar: CanvasTopLeftCornerToolbarStateReadWrite = new CanvasTopLeftCornerToolbarStateReadWriteImpl();

  public constructor() {
    makeAutoObservable(this, {}, { autoBind: true });
  }
}

export class UiStateReadWriteImpl implements UiStateReadWrite {
  settings: AppSettingsReadWrite = {
    locale: DEFAULT_APP_LOCALE,
    themeId: DEFAULT_APP_THEME_ID,
    hypergryphOperationMode: true,
    hypergryphImmediateMove: true,
    hypergryphImmediateMarquee: false,
    gameShowHotkeys: false,
    debugShowFps: false,
    debugShowGestureDiagnosticsWindow: false,
  };

  workbench: WorkbenchStateReadWrite = new WorkbenchStateReadWriteImpl();
  screenProfile: ScreenProfile = resolveScreenProfileFromWindow();
  activeTool: ActiveTool = "select";
  runtime: RuntimeStateReadWrite = new RuntimeStateReadWriteImpl();

  public constructor() {
    makeAutoObservable(this, {}, { autoBind: true });
  }

  public get theme(): AppTheme {
    return resolveAppTheme(this.settings.themeId);
  }
}

export function createUiStateReadWrite(): UiStateReadWrite {
  return new UiStateReadWriteImpl();
}
