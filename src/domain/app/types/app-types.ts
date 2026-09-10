import type { ScreenProfile } from "./screen-profile";
import type { AppTheme, AppThemeId } from "./theme";

export type AppLocale = "zh-CN" | "en-US";

export interface AppSettings {
  readonly locale: AppLocale;
  readonly themeId: AppThemeId;
  // AI-REMOVED 2026-09-10:
  // Reason: 操作模式总开关已废弃，不再保留关闭分支
  // Trigger: 用户要求彻底移除 hypergryphOperationMode。
  // Evidence: 总开关入口已隐藏；手势路由器无 when 时默认启用。
  // Replacement: None（状态不再包含总开关）
  // Risk: 历史 false 设置统一使用当前操作行为。
  // Human Review: Required
  //
  // Original code:
  // readonly hypergryphOperationMode: boolean;
  readonly hypergryphImmediateMove: boolean;
  readonly hypergryphCopyWhileMoving: boolean;
  readonly hypergryphImmediateMarquee: boolean;
  readonly hypergryphAllowEmptyLogisticsEndpoints: boolean;
  readonly hypergryphAutoCreateSplittersAndConvergers: boolean;
  readonly hypergryphSelectionRightDockSync: boolean;
  readonly hypergryphInspectorOpenOnSecondClick: boolean;
  readonly gameUseBlueprintStyleDeviceImages: boolean;
  readonly gamePlayDeviceAnimations: boolean;
  readonly gameShowDeviceNames: boolean;
  readonly gameShowDeviceIcons: boolean;
  readonly gameUseInspectorPanel: boolean;
  readonly gameShowHotkeys: boolean;
  readonly collapseDeviceModes: boolean;
  readonly gameShowPipeExactFluidPosition: boolean;
  readonly gameAlwaysShowGridLines: boolean;
  readonly gameAlwaysShowPowerRange: boolean;
  readonly showGrassBackground: boolean;
  readonly showRegionAnnotations: boolean;
  readonly debugShowFps: boolean;
  readonly debugShowGestureDiagnosticsWindow: boolean;
  readonly debugMode: boolean;
  readonly virtualMousePointer: boolean;
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
  readonly selectedPlacementVariantByCraftGroup: Readonly<Record<string, string>>;
}

export type ActiveTool =
  | "select"
  | "move"
  | "marquee"
  | "blueprint-placement"
  | "single-placement"
  | "logistics-placement"
  | "dark-pipe-link"
  | "region-edit";

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
  readonly moveKind: "ordinary" | "batch" | null;
  readonly toolInfo: ToolInfo;
}
