import type { ScreenProfile } from "./screen-profile";
import type { AppTheme, AppThemeId } from "./theme";
import type { UiGroup } from "../../registry/types/entity-definition";

export type AppLocale = "zh-CN" | "en-US";

export interface AppSettings {
  readonly locale: AppLocale;
  readonly themeId: AppThemeId;
  readonly hypergryphOperationMode: boolean;
  readonly hypergryphImmediateMove: boolean;
  readonly hypergryphImmediateMarquee: boolean;
  readonly hypergryphSelectionRightDockSync: boolean;
  readonly hypergryphInspectorOpenOnSecondClick: boolean;
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

export type ToolboxWikiNavigationEntryType = "item" | "entity";
export type ToolboxWikiEntityGroupCategory = Exclude<UiGroup, "hidden">;
export type ToolboxWikiDesktopCategory =
  | "all"
  | "item"
  | "entity"
  | ToolboxWikiEntityGroupCategory;
export type ToolboxWikiMobileCategory = Exclude<ToolboxWikiDesktopCategory, "all">;
export type ToolboxWikiMobileFilterOption =
  | ToolboxWikiMobileCategory
  | "excludeBottledLiquid";

export interface ToolboxWikiNavigationEntry {
  readonly type: ToolboxWikiNavigationEntryType;
  readonly id: string;
}

export type ToolboxWikiOpenedPage =
  | { readonly kind: "browser" }
  | { readonly kind: "item"; readonly id: string }
  | { readonly kind: "entity"; readonly id: string };

export interface ToolboxWikiState {
  readonly searchQuery: string;
  readonly desktopCategory: ToolboxWikiDesktopCategory;
  readonly mobileSelectedCategories: readonly ToolboxWikiMobileFilterOption[];
  readonly navigationStack: readonly ToolboxWikiNavigationEntry[];
  readonly openedPage: ToolboxWikiOpenedPage;
}

export interface ModuleBalancingIOPort {
  readonly itemId: string;
  readonly perMinute: number;
}

export interface ModuleBalancingCustomModule {
  readonly id: string;
  readonly name: string;
  readonly color: string;
  readonly iconId: string;
  readonly inputs: readonly ModuleBalancingIOPort[];
  readonly outputs: readonly ModuleBalancingIOPort[];
  readonly sourceType: "custom";
}

export interface ModuleBalancingSystemRecipeModule {
  readonly id: string;
  readonly sourceType: "system-recipe";
  readonly recipeId: string;
}

export type ModuleBalancingModule =
  | ModuleBalancingCustomModule
  | ModuleBalancingSystemRecipeModule;

export interface ModuleBalancingStageModuleEntry {
  readonly moduleId: string;
  readonly quantity: number;
}

export interface ModuleBalancingStage {
  readonly id: string;
  readonly name: string;
  readonly entries: readonly ModuleBalancingStageModuleEntry[];
}

export interface ModuleBalancingCanvas {
  readonly id: string;
  readonly name: string;
  readonly globalInputs: readonly ModuleBalancingIOPort[];
  readonly stages: readonly ModuleBalancingStage[];
  readonly warehouseCapacity: number | null;
}

export interface ModuleBalancingState {
  readonly canvases: readonly ModuleBalancingCanvas[];
  readonly customModules: readonly ModuleBalancingCustomModule[];
  readonly activeCanvasId: string | null;
}

export interface ToolboxState {
  readonly wiki: ToolboxWikiState;
  readonly moduleBalancing: ModuleBalancingState;
}

export type RightDockTabId = "selection";

export interface WorkbenchState {
  readonly leftDockOpen: boolean;
  readonly rightDockOpen: boolean;
  readonly leftDockWidth: number;
  readonly topBarCollapsed: boolean;
  readonly rightDockActiveTab: RightDockTabId;
  readonly dialogState: Readonly<Record<string, DialogState | undefined>>;
  readonly toolbox: ToolboxState;
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
