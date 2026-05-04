


import type { AppLocale } from "@/shared/i18n/messages";
import type { ScreenProfile } from "./screen-profile";
import type { AppTheme, AppThemeId } from "./theme";
import type { ClientPixelRect } from "../types/client-pixel";
import type { GridFloatPoint, GridRect } from "../types/grid";
import type { UiGroup } from "../types/registry/entity-definition";

export interface EntityCollection extends ReadonlyArray<string> {
  contains(entityId: string): boolean;
}

export const EntityCollectionType = {
  selection: "selection",
  marquee: "marquee",
  reverseMarquee: "reverse-marquee",
  preview: "preview",
  ghost: "ghost",
  logisticsHead: "logistics-head",
} as const;

export type EntityCollectionType =
  typeof EntityCollectionType[keyof typeof EntityCollectionType];

export type MarqueeCollectionType =
  | typeof EntityCollectionType.marquee
  | typeof EntityCollectionType.reverseMarquee;

export type EntityCollections = Readonly<Record<EntityCollectionType, EntityCollection>>;

export interface EditorViewportState {
  readonly center: GridFloatPoint;
  readonly clientRect: ClientPixelRect;
  readonly gridSize: number;
  readonly gridCellPixelSize: number;
}

/// Editor State 定义上是Document的包裹层，他为Document提供一层运行时tag
/// 比如 collection 会标记哪些 entity 当前被选中或处于 preview
/// 操作也是通过这个状态来进行的，比如MoveSelectionTo, MovePreviewTo, PlacePreviewTo
export interface EditorState {

  readonly viewport: EditorViewportState;
  readonly marqueeGridRect: GridRect | null;

  readonly collections: EntityCollections;
}

export interface HistoryState {
  readonly undoDepth: number;
  readonly redoDepth: number;
  readonly lastCommandId: string | null;
}

export interface AppSettings {
  readonly locale: AppLocale;
  readonly themeId: AppThemeId;
  readonly hypergryphOperationMode: boolean;
  readonly hypergryphImmediateMove: boolean;
  readonly hypergryphImmediateMarquee: boolean;
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

export type RightDockTabId = "base" | "power" | "selection" | "simulation";

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
  | "single-placement"
  | "logistics-placement";

export interface ToolInfo {
  readonly marqueeType: MarqueeCollectionType;
}

export interface UiState {
  readonly settings: AppSettings;
  readonly workbench: WorkbenchState;
  readonly screenProfile: ScreenProfile;
  readonly theme: AppTheme;
  readonly activeTool: ActiveTool;
  readonly toolInfo: ToolInfo;
}
