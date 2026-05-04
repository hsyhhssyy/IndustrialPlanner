


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
  undoDepth: number;
  redoDepth: number;
  lastCommandId: string | null;
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
  type: ToolboxWikiNavigationEntryType;
  id: string;
}

export type ToolboxWikiOpenedPage =
  | { kind: "browser" }
  | { kind: "item"; id: string }
  | { kind: "entity"; id: string };

export interface ToolboxWikiState {
  searchQuery: string;
  desktopCategory: ToolboxWikiDesktopCategory;
  mobileSelectedCategories: ToolboxWikiMobileFilterOption[];
  navigationStack: ToolboxWikiNavigationEntry[];
  openedPage: ToolboxWikiOpenedPage;
}

export interface ModuleBalancingIOPort {
  itemId: string;
  perMinute: number;
}

export interface ModuleBalancingCustomModule {
  id: string;
  name: string;
  color: string;
  iconId: string;
  inputs: ModuleBalancingIOPort[];
  outputs: ModuleBalancingIOPort[];
  sourceType: "custom";
}

export interface ModuleBalancingSystemRecipeModule {
  id: string;
  sourceType: "system-recipe";
  recipeId: string;
}

export type ModuleBalancingModule =
  | ModuleBalancingCustomModule
  | ModuleBalancingSystemRecipeModule;

export interface ModuleBalancingStageModuleEntry {
  moduleId: string;
  quantity: number;
}

export interface ModuleBalancingStage {
  id: string;
  name: string;
  entries: ModuleBalancingStageModuleEntry[];
}

export interface ModuleBalancingCanvas {
  id: string;
  name: string;
  globalInputs: ModuleBalancingIOPort[];
  stages: ModuleBalancingStage[];
  warehouseCapacity: number | null;
}

export interface ModuleBalancingState {
  canvases: ModuleBalancingCanvas[];
  customModules: ModuleBalancingCustomModule[];
  activeCanvasId: string | null;
}

export interface ToolboxState {
  wiki: ToolboxWikiState;
  moduleBalancing: ModuleBalancingState;
}

export type RightDockTabId = "base" | "power" | "selection" | "simulation";

export interface WorkbenchState {
  readonly leftDockOpen: boolean;
  readonly rightDockOpen: boolean;
  readonly leftDockWidth: number;
  readonly topBarCollapsed: boolean;
  readonly rightDockActiveTab: RightDockTabId;
  readonly dialogState: Record<string, DialogState | undefined>;
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
