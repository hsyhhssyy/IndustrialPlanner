import { makeAutoObservable } from "mobx";

import type { ScreenProfile } from "@/domain/app/types/screen-profile";
import type { AppTheme, AppThemeId } from "@/domain/app/types/theme";
import {
  EntityCollectionType,
} from "@/domain/editor/types/editor-types";
import type {
  MarqueeCollectionType,
} from "@/domain/editor/types/editor-types";
import type {
  ActiveTool,
  AppSettings,
  ModuleBalancingCanvas,
  ModuleBalancingCustomModule,
  ModuleBalancingIOPort,
  ModuleBalancingStage,
  ModuleBalancingStageModuleEntry,
  ModuleBalancingState,
  RightDockTabId,
  ToolboxState,
  ToolboxWikiDesktopCategory,
  ToolboxWikiEntityGroupCategory,
  ToolboxWikiMobileCategory,
  ToolboxWikiMobileFilterOption,
  ToolboxWikiNavigationEntry,
  ToolboxWikiOpenedPage,
  ToolboxWikiState,
  ToolInfo,
  UiState,
  WorkbenchState,
} from "@/domain/app/types/app-types";
import type { ClientPixelPoint } from "@/domain/shared/client-pixel";
import type { GridPoint } from "@/domain/shared/grid";
import type { LogisticsKind, LogisticsRouteOrder } from "@/domain/shared/logistics";
import type { UiGroup } from "@/domain/registry/types/entity-definition";
import type { AppLocale } from "@/shared/i18n/messages";
import type { BlueprintLibraryRecord } from "@/shared/blueprints/blueprint-library";
import {
  isMobileOrTabletScreenProfile,
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

// 2026-05-09: 当前版本要求 mobile 和 tablet 始终共用窄左栏；只有 PC 使用宽左栏与双列布局。
export function resolveLeftDockWidthForScreenProfile(
  width: number,
  screenProfile: Pick<ScreenProfile, "deviceClass">,
): number {
  if (isMobileOrTabletScreenProfile(screenProfile)) {
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
  hypergryphSelectionRightDockSync: boolean;
  hypergryphInspectorOpenOnSecondClick: boolean;
  gameUseSimplifiedDeviceIcons: boolean;
  gameShowDeviceNames: boolean;
  gameShowDeviceIcons: boolean;
  gameUseInspectorPanel: boolean;
  gameShowHotkeys: boolean;
  gameAlwaysShowGridLines: boolean;
  showGrassBackground: boolean;
  debugShowFps: boolean;
  debugShowGestureDiagnosticsWindow: boolean;
  debugMode: boolean;
}

export interface WorkbenchStateReadWrite extends WorkbenchState {
  leftDockOpen: boolean;
  rightDockOpen: boolean;
  leftDockWidth: number;
  topBarCollapsed: boolean;
  rightDockActiveTab: RightDockTabId;
  dialogState: DialogStateMapReadWrite;
  toolbox: ToolboxStateReadWrite;
}

export interface ToolboxStateReadWrite extends ToolboxState {
  dockPreference: ToolboxDockPreference;
  bottomDockCollapsed: boolean;
  bottomDockHeight: number;
  wiki: ToolboxWikiStateReadWrite;
  moduleBalancing: ModuleBalancingStateReadWrite;
}

export interface ToolboxWikiStateReadWrite extends ToolboxWikiState {
  searchQuery: string;
  desktopCategory: ToolboxWikiDesktopCategory;
  mobileSelectedCategories: ToolboxWikiMobileFilterOption[];
  navigationStack: ToolboxWikiNavigationEntry[];
  openedPage: ToolboxWikiOpenedPage;
}

export interface ModuleBalancingStateReadWrite extends ModuleBalancingState {
  canvases: ModuleBalancingCanvasReadWrite[];
  customModules: ModuleBalancingCustomModuleReadWrite[];
  activeCanvasId: string | null;
}

export interface ModuleBalancingCanvasReadWrite extends ModuleBalancingCanvas {
  id: string;
  name: string;
  globalInputs: ModuleBalancingIOPortReadWrite[];
  stages: ModuleBalancingStageReadWrite[];
  warehouseCapacity: number | null;
}

export interface ModuleBalancingStageReadWrite extends ModuleBalancingStage {
  id: string;
  name: string;
  entries: ModuleBalancingStageModuleEntryReadWrite[];
}

export interface ModuleBalancingCustomModuleReadWrite extends ModuleBalancingCustomModule {
  id: string;
  name: string;
  color: string;
  iconId: string;
  inputs: ModuleBalancingIOPortReadWrite[];
  outputs: ModuleBalancingIOPortReadWrite[];
  sourceType: "custom";
}

export interface ModuleBalancingIOPortReadWrite extends ModuleBalancingIOPort {
  itemId: string;
  perMinute: number;
}

export interface ModuleBalancingStageModuleEntryReadWrite extends ModuleBalancingStageModuleEntry {
  moduleId: string;
  quantity: number;
}

export const CANVAS_FLOATING_TOOLBAR_BUTTON_IDS = [
  "canvas-floating-toolbar-button-ok",
  "canvas-floating-toolbar-button-cancel",
  "canvas-floating-toolbar-button-rotate",
  "canvas-floating-toolbar-button-switch-mode",
  "canvas-floating-toolbar-button-move",
  "canvas-floating-toolbar-button-save-blueprint",
  "canvas-floating-toolbar-button-delete",
  "canvas-floating-toolbar-button-delete-many",
  "canvas-floating-toolbar-button-delete-upstream-segment",
  "canvas-floating-toolbar-button-delete-downstream-segment",
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
  "canvas-top-left-corner-toolbar-button-toggle-continuous-placement",
] as const;

export type CanvasTopLeftCornerToolbarButtonId =
  typeof CANVAS_TOP_LEFT_CORNER_TOOLBAR_BUTTON_IDS[number];

export type CanvasTopLeftCornerToolbarShowButtonId =
  | CanvasTopLeftCornerToolbarButtonId
  | `${CanvasTopLeftCornerToolbarButtonId}-off`;

export const TOOLBOX_DIALOG_TAB_IDS = [
  "item-encyclopedia",
  "production-planning",
  "module-balancing",
] as const;

export type ToolboxDialogTabId = typeof TOOLBOX_DIALOG_TAB_IDS[number];
export const DEFAULT_TOOLBOX_DIALOG_TAB_ID: ToolboxDialogTabId = TOOLBOX_DIALOG_TAB_IDS[0];
export const TOOLBOX_DOCK_PREFERENCES = ["floating", "bottom"] as const;
export type ToolboxDockPreference = typeof TOOLBOX_DOCK_PREFERENCES[number];
export const DEFAULT_TOOLBOX_DOCK_PREFERENCE: ToolboxDockPreference = "floating";
export const MIN_TOOLBOX_BOTTOM_DOCK_HEIGHT = 220;
export const DEFAULT_TOOLBOX_BOTTOM_DOCK_HEIGHT = 320;
export const MAX_TOOLBOX_BOTTOM_DOCK_HEIGHT = 720;
export const COLLAPSED_TOOLBOX_BOTTOM_DOCK_HEIGHT = 44;

export function isToolboxDockPreference(value: unknown): value is ToolboxDockPreference {
  return typeof value === "string"
    && TOOLBOX_DOCK_PREFERENCES.includes(value as ToolboxDockPreference);
}

export function clampToolboxBottomDockHeight(height: number): number {
  return Math.min(
    MAX_TOOLBOX_BOTTOM_DOCK_HEIGHT,
    Math.max(MIN_TOOLBOX_BOTTOM_DOCK_HEIGHT, Math.round(height)),
  );
}

export const TOOLBOX_WIKI_ENTITY_GROUP_CATEGORY_IDS = [
  "basicProduction",
  "advancedManufacturing",
  "beltLogistics",
  "pipeLogistics",
  "resourcePower",
  "warehouse",
] as const satisfies readonly ToolboxWikiEntityGroupCategory[];

export const TOOLBOX_WIKI_MOBILE_CATEGORY_IDS = [
  "item",
  "entity",
  ...TOOLBOX_WIKI_ENTITY_GROUP_CATEGORY_IDS,
] as const satisfies readonly ToolboxWikiMobileCategory[];

export const TOOLBOX_WIKI_MOBILE_FILTER_OPTION_IDS = [
  "excludeBottledLiquid",
  ...TOOLBOX_WIKI_MOBILE_CATEGORY_IDS,
] as const satisfies readonly ToolboxWikiMobileFilterOption[];

export const TOOLBOX_WIKI_DESKTOP_CATEGORY_IDS = [
  "all",
  ...TOOLBOX_WIKI_MOBILE_CATEGORY_IDS,
] as const satisfies readonly ToolboxWikiDesktopCategory[];

export function isToolboxWikiDesktopCategory(value: unknown): value is ToolboxWikiDesktopCategory {
  return typeof value === "string"
    && TOOLBOX_WIKI_DESKTOP_CATEGORY_IDS.includes(value as ToolboxWikiDesktopCategory);
}

export function isToolboxWikiMobileCategory(value: unknown): value is ToolboxWikiMobileCategory {
  return typeof value === "string"
    && TOOLBOX_WIKI_MOBILE_CATEGORY_IDS.includes(value as ToolboxWikiMobileCategory);
}

export function isToolboxWikiMobileFilterOption(value: unknown): value is ToolboxWikiMobileFilterOption {
  return typeof value === "string"
    && TOOLBOX_WIKI_MOBILE_FILTER_OPTION_IDS.includes(value as ToolboxWikiMobileFilterOption);
}

export function createDefaultToolboxWikiOpenedPage(): ToolboxWikiOpenedPage {
  return { kind: "browser" };
}

export const DEFAULT_MODULE_BALANCING_CANVAS_ID = "module-balancing-canvas-main";
export const DEFAULT_MODULE_BALANCING_STAGE_ID = "module-balancing-stage-1";

export function createDefaultModuleBalancingStage(): ModuleBalancingStageReadWrite {
  return {
    id: DEFAULT_MODULE_BALANCING_STAGE_ID,
    name: "Stage 1",
    entries: [],
  };
}

export function createDefaultModuleBalancingCanvas(): ModuleBalancingCanvasReadWrite {
  return {
    id: DEFAULT_MODULE_BALANCING_CANVAS_ID,
    name: "主基地配平",
    globalInputs: [],
    stages: [createDefaultModuleBalancingStage()],
    warehouseCapacity: null,
  };
}

export function createDefaultModuleBalancingState(): ModuleBalancingStateReadWrite {
  return {
    canvases: [createDefaultModuleBalancingCanvas()],
    customModules: [],
    activeCanvasId: DEFAULT_MODULE_BALANCING_CANVAS_ID,
  };
}

export const HELP_DIALOG_TAB_IDS = [
  "overview",
  "shortcuts",
  "faq",
  "version",
] as const;

export type HelpDialogTabId = typeof HELP_DIALOG_TAB_IDS[number];
export const DEFAULT_HELP_DIALOG_TAB_ID: HelpDialogTabId = HELP_DIALOG_TAB_IDS[0];

export const RIGHT_DOCK_TAB_IDS = [
  "selection",
] as const satisfies readonly RightDockTabId[];

export const DEFAULT_RIGHT_DOCK_TAB_ID: RightDockTabId = RIGHT_DOCK_TAB_IDS[0];

export function isRightDockTabId(value: unknown): value is RightDockTabId {
  return typeof value === "string" && RIGHT_DOCK_TAB_IDS.includes(value as RightDockTabId);
}

export const DIALOG_KEYS = ["toolbox", "help", "settings", "debug-log", "inspector", "save-blueprint", "base-select"] as const;
export type DialogKey = typeof DIALOG_KEYS[number];

export interface DialogStateReadWrite {
  visible: boolean;
  maximized: boolean;
  offsetX: number;
  offsetY: number;
  width: number | null;
  height: number | null;
  activeTab: string | null;
}

export interface DialogStateMapReadWrite extends Record<string, DialogStateReadWrite | undefined> {
  toolbox: DialogStateReadWrite;
  help: DialogStateReadWrite;
  settings: DialogStateReadWrite;
  "debug-log": DialogStateReadWrite | undefined;
  inspector: DialogStateReadWrite;
  "save-blueprint": DialogStateReadWrite;
  "base-select": DialogStateReadWrite;
}

export function resolveDefaultDialogTabId(dialogKey: string): string | null {
  if (dialogKey === "toolbox") {
    return DEFAULT_TOOLBOX_DIALOG_TAB_ID;
  }

  if (dialogKey === "help") {
    return DEFAULT_HELP_DIALOG_TAB_ID;
  }

  return null;
}

export function createDefaultDialogStateForKey(dialogKey: string): DialogStateReadWrite {
  return new DialogStateReadWriteImpl(resolveDefaultDialogTabId(dialogKey));
}

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
  mode: "icon" | "shortcut";
}

export interface CanvasTopLeftCornerToolbarStateReadWrite {
  visible: boolean;
  buttonIds: CanvasTopLeftCornerToolbarButtonId[];
  initialOffButtonIds: CanvasTopLeftCornerToolbarButtonId[];
}

export interface RuntimeStateReadWrite {
  activePanel: ActivePanel;
  moveAnchor: GridPoint | null;
  moveEnterFrom: ActiveTool | null;
  movePointerMode: "mouse" | "touch" | null;
  placementAnchor: GridPoint | null;
  blueprintPlacementRecord: BlueprintLibraryRecord | null;
  blueprintPlacementPointerMode: "mouse" | "touch" | null;
  blueprintPlacementRotationSteps: number;
  singlePlacementDeviceId: string | null;
  singlePlacementPointerMode: "mouse" | "touch" | null;
  singlePlacementContinuous: boolean;
  selectingPlacementGroup: PlacementGroup | null;
  logisticsPlacement: LogisticsPlacementRuntimeStateReadWrite;
  marqueeAnchor: GridPoint | null;
  canvasFloatingToolbar: CanvasFloatingToolbarStateReadWrite;
  canvasRightDockToolbar: CanvasRightDockToolbarStateReadWrite;
  canvasTopLeftCornerToolbar: CanvasTopLeftCornerToolbarStateReadWrite;
}

export interface LogisticsPlacementRuntimeStateReadWrite {
  kind: LogisticsKind | null;
  shortcutPlacementGroup: "beltLogistics" | "pipeLogistics" | null;
  pointerMode: "mouse" | "touch" | null;
  phase: "idle" | "waiting-touch-device-exit" | "drawing" | "snapped-target";
  isHoverPreview: boolean;
  routeOrder: LogisticsRouteOrder;
  sourceEntityId: string | null;
  targetEntityId: string | null;
  anchorGridPoint: GridPoint | null;
  headGridPoint: GridPoint | null;
  lastPreviewGridPoint: GridPoint | null;
  lastMousePosition: ClientPixelPoint | null;
  statusMessageKey: string | null;
}

export interface ToolInfoReadWrite extends ToolInfo {
  marqueeType: MarqueeCollectionType;
}

const DEFAULT_APP_LOCALE: AppLocale = "zh-CN";

export type ActivePanel =
  | "placement"
  // AI-REMOVED 2026-05-10:
  // Reason: 左侧删除模式与删除面板已废弃，activePanel 不再接受 delete。
  // Trigger: 产品要求移除左侧“删除模式”和整个删除面板。
  // Evidence: 左侧工具栏与左侧 dock 的 delete 注册已同步移除，runtime.activePanel 也明确标记为不持久化。
  // Replacement: src/app/shell/layout/left-toolbar.tsx, src/app/shell/layout/left-dock.tsx
  // Risk: Low
  // Human Review: Required
  //
  // Original code:
  // | "delete"
  | "blueprint"
  | "history"
  | "base"
  | "simulation"
  | null;
export type PlacementGroup = Exclude<UiGroup, "hidden">;

export interface UiStateReadWrite extends UiState {
  /// settings存储用户显式在设置页面配置的设置，这里面所有的内容都要持久化
  settings: AppSettingsReadWrite;
  /// workbenchState存储用户没有显式配置，但是仍然需要存储的状态，比如dock的开合状态等等。
  workbench: WorkbenchStateReadWrite;
  /// screenProfile 是当前 browser viewport / device profile 的公共 UI 运行态，不进入持久化。
  screenProfile: ScreenProfile;
  /// activeTool 是当前激活的工具，属于公共 contract 状态。
  activeTool: ActiveTool;
  /// toolInfo 是当前工具的运行参数，属于公共 contract 状态。
  toolInfo: ToolInfoReadWrite;
  /// runtimeState存储一些不需要持久化的状态，比如当前打开的panel是什么等等，每次页面刷新时，这些状态都会被重置回默认值。
  /// runtimeState 不进Contract，这是纯私有的状态。
  runtime: RuntimeStateReadWrite;
}

class WorkbenchStateReadWriteImpl implements WorkbenchStateReadWrite {
  leftDockOpen = true;
  rightDockOpen = true;
  leftDockWidth = DEFAULT_LEFT_DOCK_WIDTH;
  topBarCollapsed = false;
  rightDockActiveTab = DEFAULT_RIGHT_DOCK_TAB_ID;
  dialogState: DialogStateMapReadWrite = {
    toolbox: createDefaultDialogStateForKey("toolbox"),
    help: createDefaultDialogStateForKey("help"),
    settings: createDefaultDialogStateForKey("settings"),
    "debug-log": undefined,
    inspector: createDefaultDialogStateForKey("inspector"),
    "save-blueprint": createDefaultDialogStateForKey("save-blueprint"),
    "base-select": createDefaultDialogStateForKey("base-select"),
  };
  toolbox: ToolboxStateReadWrite = new ToolboxStateReadWriteImpl();

  public constructor() {
    makeAutoObservable(this, {}, { autoBind: true });
  }
}

class ToolboxStateReadWriteImpl implements ToolboxStateReadWrite {
  dockPreference: ToolboxDockPreference = DEFAULT_TOOLBOX_DOCK_PREFERENCE;
  bottomDockCollapsed = false;
  bottomDockHeight = DEFAULT_TOOLBOX_BOTTOM_DOCK_HEIGHT;
  wiki: ToolboxWikiStateReadWrite = new ToolboxWikiStateReadWriteImpl();
  moduleBalancing: ModuleBalancingStateReadWrite = createDefaultModuleBalancingState();

  public constructor() {
    makeAutoObservable(this, {}, { autoBind: true });
  }
}

class ToolboxWikiStateReadWriteImpl implements ToolboxWikiStateReadWrite {
  searchQuery = "";
  desktopCategory: ToolboxWikiDesktopCategory = "all";
  mobileSelectedCategories: ToolboxWikiMobileFilterOption[] = ["excludeBottledLiquid"];
  navigationStack: ToolboxWikiNavigationEntry[] = [];
  openedPage: ToolboxWikiOpenedPage = createDefaultToolboxWikiOpenedPage();

  public constructor() {
    makeAutoObservable(this, {}, { autoBind: true });
  }
}

class DialogStateReadWriteImpl implements DialogStateReadWrite {
  visible = false;
  maximized = false;
  offsetX = 0;
  offsetY = 0;
  width: number | null = null;
  height: number | null = null;
  activeTab: string | null;

  public constructor(activeTab: string | null) {
    this.activeTab = activeTab;
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
  mode: "icon" | "shortcut" = "icon";

  public constructor() {
    makeAutoObservable(this, {}, { autoBind: true });
  }
}

class CanvasTopLeftCornerToolbarStateReadWriteImpl implements CanvasTopLeftCornerToolbarStateReadWrite {
  visible = false;
  buttonIds: CanvasTopLeftCornerToolbarButtonId[] = [];
  initialOffButtonIds: CanvasTopLeftCornerToolbarButtonId[] = [];

  public constructor() {
    makeAutoObservable(this, {}, { autoBind: true });
  }
}

class LogisticsPlacementRuntimeStateReadWriteImpl implements LogisticsPlacementRuntimeStateReadWrite {
  kind: LogisticsKind | null = null;
  shortcutPlacementGroup: "beltLogistics" | "pipeLogistics" | null = null;
  pointerMode: "mouse" | "touch" | null = null;
  phase: "idle" | "waiting-touch-device-exit" | "drawing" | "snapped-target" = "idle";
  isHoverPreview = false;
  routeOrder: LogisticsRouteOrder = "vertical-first";
  sourceEntityId: string | null = null;
  targetEntityId: string | null = null;
  anchorGridPoint: GridPoint | null = null;
  headGridPoint: GridPoint | null = null;
  lastPreviewGridPoint: GridPoint | null = null;
  lastMousePosition: ClientPixelPoint | null = null;
  statusMessageKey: string | null = null;

  public constructor() {
    makeAutoObservable(this, {}, { autoBind: true });
  }
}

class RuntimeStateReadWriteImpl implements RuntimeStateReadWrite {
  activePanel: ActivePanel = null;
  moveAnchor: GridPoint | null = null;
  moveEnterFrom: ActiveTool | null = null;
  movePointerMode: "mouse" | "touch" | null = null;
  placementAnchor: GridPoint | null = null;
  blueprintPlacementRecord: BlueprintLibraryRecord | null = null;
  blueprintPlacementPointerMode: "mouse" | "touch" | null = null;
  blueprintPlacementRotationSteps = 0;
  singlePlacementDeviceId: string | null = null;
  singlePlacementPointerMode: "mouse" | "touch" | null = null;
  singlePlacementContinuous = false;
  selectingPlacementGroup: PlacementGroup | null = null;
  logisticsPlacement: LogisticsPlacementRuntimeStateReadWrite = new LogisticsPlacementRuntimeStateReadWriteImpl();
  marqueeAnchor: GridPoint | null = null;
  canvasFloatingToolbar: CanvasFloatingToolbarStateReadWrite = new CanvasFloatingToolbarStateReadWriteImpl();
  canvasRightDockToolbar: CanvasRightDockToolbarStateReadWrite = new CanvasRightDockToolbarStateReadWriteImpl();
  canvasTopLeftCornerToolbar: CanvasTopLeftCornerToolbarStateReadWrite = new CanvasTopLeftCornerToolbarStateReadWriteImpl();

  public constructor() {
    makeAutoObservable(this, {}, { autoBind: true });
  }
}

class ToolInfoReadWriteImpl implements ToolInfoReadWrite {
  marqueeType: MarqueeCollectionType = EntityCollectionType.marquee;

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
    hypergryphSelectionRightDockSync: true,
    hypergryphInspectorOpenOnSecondClick: false,
    gameUseSimplifiedDeviceIcons: false,
    gameShowDeviceNames: true,
    gameShowDeviceIcons: false,
    gameUseInspectorPanel: false,
    gameShowHotkeys: false,
    gameAlwaysShowGridLines: true,
    showGrassBackground: false,
    debugShowFps: false,
    debugShowGestureDiagnosticsWindow: false,
    debugMode: false,
  };

  workbench: WorkbenchStateReadWrite = new WorkbenchStateReadWriteImpl();
  screenProfile: ScreenProfile = resolveScreenProfileFromWindow();
  activeTool: ActiveTool = "select";
  toolInfo: ToolInfoReadWrite = new ToolInfoReadWriteImpl();
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
