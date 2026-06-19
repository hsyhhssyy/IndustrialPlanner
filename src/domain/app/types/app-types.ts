import type { ScreenProfile } from "./screen-profile";
import type { AppTheme, AppThemeId } from "./theme";

export type AppLocale = "zh-CN" | "en-US";

export interface AppSettings {
  readonly locale: AppLocale;
  readonly themeId: AppThemeId;
  readonly hypergryphOperationMode: boolean;
  readonly hypergryphImmediateMove: boolean;
  readonly hypergryphCopyWhileMoving: boolean;
  readonly hypergryphImmediateMarquee: boolean;
  readonly hypergryphAllowEmptyLogisticsEndpoints: boolean;
  readonly hypergryphAutoCreateLogisticsDevices: boolean;
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
}

export type ActiveTool =
  | "select"
  | "move"
  | "marquee"
  | "blueprint-placement"
  | "single-placement"
  | "logistics-placement"
  | "dark-pipe-link";

export interface DarkPipeLinkToolState {
  readonly sourceEntityId: string;
  readonly sourceRole: "inlet" | "outlet";
  readonly candidateEntityIds: readonly string[];
  readonly returnTool: ActiveTool;
}

export interface ToolInfo {
  readonly marqueeType: "marquee" | "reverse-marquee";
  readonly darkPipeLink: DarkPipeLinkToolState | null;
}

export interface UiState {
  readonly settings: AppSettings;
  readonly workbench: WorkbenchState;
  readonly screenProfile: ScreenProfile;
  readonly theme: AppTheme;
  readonly activeTool: ActiveTool;
  readonly toolInfo: ToolInfo;
}
