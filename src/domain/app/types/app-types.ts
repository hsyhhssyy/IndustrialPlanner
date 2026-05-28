import type { ScreenProfile } from "./screen-profile";
import type { AppTheme, AppThemeId } from "./theme";

export type AppLocale = "zh-CN" | "en-US";

export interface AppSettings {
  readonly locale: AppLocale;
  readonly themeId: AppThemeId;
  readonly hypergryphOperationMode: boolean;
  readonly hypergryphImmediateMove: boolean;
  readonly hypergryphImmediateMarquee: boolean;
  readonly hypergryphSelectionRightDockSync: boolean;
  readonly hypergryphInspectorOpenOnSecondClick: boolean;
  readonly gameUseSimplifiedDeviceIcons: boolean;
  readonly gameShowDeviceNames: boolean;
  readonly gameShowDeviceIcons: boolean;
  readonly gameUseInspectorPanel: boolean;
  readonly gameShowHotkeys: boolean;
  readonly gameAlwaysShowGridLines: boolean;
  readonly showGrassBackground: boolean;
  readonly debugShowFps: boolean;
  readonly debugShowGestureDiagnosticsWindow: boolean;
  readonly debugMode: boolean;
}

export interface DialogState {
  readonly visible: boolean;
  readonly maximized: boolean;
  readonly offsetX: number;
  readonly offsetY: number;
  readonly width: number | null;
  readonly height: number | null;
  readonly activeTab: string | null;
}

// ToolboxWiki* / ModuleBalancing* / ToolboxState 类型已搬迁至 src/app/toolbox-types.ts
// AI-CORRECTION 2026-05-28: 搬迁原因 — 这些是 App UI 层类型，不应在 domain 层定义；
//   同时消除 domain/app → domain/registry 跨子模块引用违规。

export type RightDockTabId = "selection";

export interface WorkbenchState {
  readonly leftDockOpen: boolean;
  readonly rightDockOpen: boolean;
  readonly leftDockWidth: number;
  readonly topBarCollapsed: boolean;
  readonly rightDockActiveTab: RightDockTabId;
  readonly dialogState: Readonly<Record<string, DialogState | undefined>>;
}

export type ActiveTool =
  | "select"
  | "move"
  | "marquee"
  | "blueprint-placement"
  | "single-placement"
  | "logistics-placement";

export interface ToolInfo {
  readonly marqueeType: "marquee" | "reverse-marquee";
}

export interface UiState {
  readonly settings: AppSettings;
  readonly workbench: WorkbenchState;
  readonly screenProfile: ScreenProfile;
  readonly theme: AppTheme;
  readonly activeTool: ActiveTool;
  readonly toolInfo: ToolInfo;
}
