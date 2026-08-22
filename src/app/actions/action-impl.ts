import { action } from "mobx";

import type { AppAction } from "@/domain/app/app-action";
import type { WorkspaceContract } from "@/domain/document/workspace-contract";
import type { ScreenProfile } from "@/domain/app/types/screen-profile";
import { EntityCollectionType } from "@/domain/editor/types/editor-types";
import type { RightDockTabId } from "@/domain/app/types/app-types";
import type {
  ClientPixelPoint,
  ClientPixelRect,
} from "@/domain/shared/client-pixel";
import type { AppLocale } from "@/domain/app";
import { lookupText } from "@/shared/i18n";
import type { KeyboardShortcutManager, ShortcutEventModifiers } from "./keyboard-shortcut-manager";

import type { ActiveTool } from "@/domain/app/types/app-types";
import {
  CANVAS_FLOATING_TOOLBAR_BUTTON_IDS,
  // AI-REMOVED 2026-08-22:
  // Reason: 右侧工具列状态按功能请求归一化，不再直接保存按钮 ID。
  // Trigger: 用户要求呼起方仅声明功能及 button/shortcut/both 展示意图。
  // Evidence: CANVAS_RIGHT_DOCK_TOOLBAR_OPERATION_IDS 是新的有效功能集合。
  // Replacement: CANVAS_RIGHT_DOCK_TOOLBAR_OPERATION_IDS。
  // Risk: Low
  // Human Review: Required
  //
  // Original code:
  // CANVAS_RIGHT_DOCK_TOOLBAR_BUTTON_IDS,
  CANVAS_RIGHT_DOCK_TOOLBAR_OPERATION_IDS,
  CANVAS_TOP_LEFT_CORNER_TOOLBAR_BUTTON_IDS,
  type CanvasFloatingToolbarButtonId,
  type CanvasFloatingToolbarSize,
  // AI-REMOVED 2026-08-22:
  // Reason: 呼起接口不再接收按钮 ID 数组。
  // Trigger: 右侧工具列改为逐项功能展示请求。
  // Evidence: showCanvasRightDockToolbar 接收 CanvasRightDockToolbarItemRequest。
  // Replacement: CanvasRightDockToolbarItemRequest。
  // Risk: Low
  // Human Review: Required
  //
  // Original code:
  // type CanvasRightDockToolbarButtonId,
  type CanvasRightDockToolbarItemRequest,
  type CanvasRightDockToolbarOperationId,
  type CanvasRightDockToolbarPresentation,
  type CanvasTopLeftCornerToolbarButtonId,
  type CanvasTopLeftCornerToolbarShowButtonId,
  clampLeftDockWidth,
  clampTimelineBottomDockHeight,
  clampToolboxBottomDockHeight,
  createDefaultDialogStateForKey,
  DEFAULT_RIGHT_DOCK_WIDTH,
  DIALOG_KEYS,
  type DialogKey,
  HELP_DIALOG_TAB_IDS,
  resolveDefaultDialogTabId,
  resolveLeftDockWidthForScreenProfile,
  TOOLBOX_DIALOG_TAB_IDS,
  type ActivePanel,
  type TimelineDockPreference,
  type ToolboxDockPreference,
  type UiStateReadWrite,
} from "../state/state-impl";

const DEFAULT_CANVAS_FLOATING_TOOLBAR_HEIGHT = 44;
const FLOATING_TOOLBAR_DEVICE_GAP_PX = 6;

// DialogShell 默认最大尺寸（对应 dialog-shell.module.scss 中 .dialog-shell 的 width/height）
const DIALOG_DEFAULT_MAX_WIDTH = 980;
const DIALOG_DEFAULT_MAX_HEIGHT = 620;
// dialog-shell-header padding: 12px top + ~20px content + 12px bottom + 1px border ≈ 44px
const DIALOG_HEADER_HEIGHT = 44;
// 标题栏水平至少露出 1/3
const DIALOG_TITLE_BAR_MIN_VISIBLE_RATIO = 1 / 3;

/**
 * 根据对话框在视口中的实际屏幕坐标 clamp offset。
 * backdrop 使用 flex 居中，dialog 在此基础上叠加 transform: translate(offsetX, offsetY)。
 * 限制：
 * 1. 标题栏上下始终在屏幕内
 * 2. 标题栏宽度至少 1/3 可见
 */
function clampDialogOffset(
  offsetX: number,
  offsetY: number,
  effectiveWidth: number,
  effectiveHeight: number,
  viewportWidth: number,
  viewportHeight: number,
): { x: number; y: number } {
  const centerLeft = (viewportWidth - effectiveWidth) / 2;
  const centerTop = (viewportHeight - effectiveHeight) / 2;

  let actualLeft = centerLeft + offsetX;
  let actualTop = centerTop + offsetY;

  // 约束 1：标题栏高度始终在屏幕内
  actualTop = Math.max(0, Math.min(actualTop, viewportHeight - DIALOG_HEADER_HEIGHT));

  // 约束 2：标题栏至少 1/3 宽度可见
  const minLeft = (-1 + DIALOG_TITLE_BAR_MIN_VISIBLE_RATIO) * effectiveWidth;
  const maxLeft = viewportWidth - DIALOG_TITLE_BAR_MIN_VISIBLE_RATIO * effectiveWidth;
  actualLeft = Math.max(minLeft, Math.min(actualLeft, maxLeft));

  return { x: Math.round(actualLeft - centerLeft), y: Math.round(actualTop - centerTop) };
}

export interface AppInternalAction {
  toggleLeftDock: () => void;
  setLeftDockSuppressed: (suppressed: boolean) => void;
  toggleRightDock: () => void;
  setRightDockOpen: (open: boolean, options?: { preserveSingleSelection?: boolean }) => void;
  toggleTopBarCollapsed: () => void;
  setRightDockActiveTab: (tabId: RightDockTabId) => void;
  openDialog: (request: string) => void;
  closeDialog: (dialogKey: string) => void;
  toggleDialogMaximized: (dialogKey: string) => void;
  setDialogTab: (dialogKey: string, tabId: string) => void;
  setDialogOffset: (dialogKey: string, offsetX: number, offsetY: number) => void;
  setDialogSize: (dialogKey: string, width: number | null, height: number | null) => void;
  setToolboxDockPreference: (preference: ToolboxDockPreference) => void;
  setToolboxBottomDockCollapsed: (collapsed: boolean) => void;
  setToolboxBottomDockHeight: (height: number) => void;
  setTimelineDockPreference: (preference: TimelineDockPreference) => void;
  setTimelineBottomDockCollapsed: (collapsed: boolean) => void;
  setTimelineBottomDockHeight: (height: number) => void;
  setActivePanel: (panel: ActivePanel) => void;
  setActiveTool: (activeTool: ActiveTool) => void;
  showCanvasFloatingToolbar: (
    buttonIds: readonly CanvasFloatingToolbarButtonId[],
    clientPixelPoint: ClientPixelPoint,
  ) => void;
  showCanvasFloatingToolbarForCollection: (
    buttonIds: readonly CanvasFloatingToolbarButtonId[],
    collectionType: EntityCollectionType,
  ) => boolean;
  moveCanvasFloatingToolbar: (clientPixelPoint: ClientPixelPoint) => void;
  alignCanvasFloatingToolbar: () => boolean;
  setCanvasFloatingToolbarSize: (size: CanvasFloatingToolbarSize | null) => void;
  hideCanvasFloatingToolbar: () => void;
  showCanvasRightDockToolbar: (
    items: readonly CanvasRightDockToolbarItemRequest[],
  ) => void;
  // AI-REMOVED 2026-08-22:
  // Reason: 呼起方现在逐项指定 presentation，工具列级 mode 无法表达混排。
  // Trigger: 用户要求纯快捷键、按钮加快捷键和纯按钮可同时存在。
  // Evidence: showCanvasRightDockToolbar 的 items 参数携带逐项 presentation。
  // Replacement: showCanvasRightDockToolbar(items)。
  // Risk: Low
  // Human Review: Required
  //
  // Original code:
  // showCanvasRightDockToolbar: (
  //   buttonIds: readonly CanvasRightDockToolbarButtonId[],
  //   mode?: "icon" | "shortcut",
  // ) => void;
  hideCanvasRightDockToolbar: () => void;
  showCanvasTopLeftCornerToolbar: (
    buttonIds: readonly CanvasTopLeftCornerToolbarShowButtonId[],
  ) => void;
  hideCanvasTopLeftCornerToolbar: () => void;
  setLeftDockWidth: (width: number) => void;
  setScreenProfile: (screenProfile: ScreenProfile) => void;
  setLocale: (locale: AppLocale) => void;
  getKeyboardShortcutFor: (key: string) => string;
  isShortcutFor: (
    key: string,
    code: string | null,
    eventKey?: string | null,
    modifiers?: ShortcutEventModifiers,
  ) => boolean;
  matchesAnyShortcut: (
    code: string | null,
    eventKey?: string | null,
    modifiers?: ShortcutEventModifiers,
  ) => boolean;
  setShortcutFor: (key: string, value: string) => void;
  resetAllShortcutsToDefaults: () => void;
}

export class AppActionImpl implements AppAction, AppInternalAction {
  public constructor(
    private readonly internalState: UiStateReadWrite,
    private readonly workspace: WorkspaceContract,
    private readonly shortcutManager: KeyboardShortcutManager,
  ) {}

  public readonly translate: AppAction["translate"] = (key) => {
    const locale = this.internalState.settings.locale;

    return lookupText(locale, key) ?? key;
  };

  public readonly toggleLeftDock: AppInternalAction["toggleLeftDock"] = action(() => {
    this.setLeftDockOpen(!this.internalState.workbench.leftDockOpen);
  });

  public readonly setLeftDockSuppressed: AppInternalAction["setLeftDockSuppressed"] = action((suppressed) => {
    if (this.internalState.workbench.leftDockSuppressed === suppressed) {
      return;
    }

    const wasEffectiveOpen = this.internalState.workbench.leftDockOpen
      && !this.internalState.workbench.leftDockSuppressed;

    this.internalState.workbench.leftDockSuppressed = suppressed;

    const isEffectiveOpen = this.internalState.workbench.leftDockOpen
      && !this.internalState.workbench.leftDockSuppressed;

    if (wasEffectiveOpen !== isEffectiveOpen) {
      this.applyPredictedViewportRectForDockToggle({
        dock: "left",
        willOpen: isEffectiveOpen,
      });
    }
  });

  public readonly toggleRightDock: AppInternalAction["toggleRightDock"] = action(() => {
    this.setRightDockOpen(!this.internalState.workbench.rightDockOpen);
  });

  public readonly setRightDockOpen: AppInternalAction["setRightDockOpen"] = action((open, options = {}) => {
    if (this.internalState.workbench.rightDockOpen === open) {
      return;
    }

    this.applyPredictedViewportRectForDockToggle({
      dock: "right",
      willOpen: open,
    });

    if (!open && !options.preserveSingleSelection) {
      this.clearSingleSelectionForRightDockClose();
    }

    this.internalState.workbench.rightDockOpen = open;
  });

  public readonly toggleTopBarCollapsed: AppInternalAction["toggleTopBarCollapsed"] = action(() => {
    this.internalState.workbench.topBarCollapsed = !this.internalState.workbench.topBarCollapsed;
  });

  public readonly setRightDockActiveTab: AppInternalAction["setRightDockActiveTab"] = action((tabId) => {
    if (this.internalState.workbench.rightDockActiveTab === tabId) {
      return;
    }

    this.internalState.workbench.rightDockActiveTab = tabId;
  });

  private clearSingleSelectionForRightDockClose(): void {
    if (
      this.internalState.activeTool !== "select"
    ) {
      return;
    }

    const editor = this.workspace.editor;
    if (editor === null || editor.state.collections.selection.length !== 1) {
      return;
    }

    editor.actions.clearCollection(EntityCollectionType.selection);
    this.hideCanvasFloatingToolbar();
  }

  public readonly openDialog: AppInternalAction["openDialog"] = action((request) => {
    const target = normalizeDialogRequest(request);

    if (target === null) {
      return;
    }

    if (target.dialogKey === "debug-log" && !this.internalState.settings.debugMode) {
      return;
    }

    const dialogState = this.ensureDialogState(target.dialogKey);

    // 兜底：窗口尺寸变化后 clamp
    if (!dialogState.maximized) {
      const effectiveWidth = Math.min(
        dialogState.width ?? Math.min(DIALOG_DEFAULT_MAX_WIDTH, window.innerWidth),
        window.innerWidth,
      );
      const effectiveHeight = Math.min(
        dialogState.height ?? Math.min(DIALOG_DEFAULT_MAX_HEIGHT, window.innerHeight),
        window.innerHeight,
      );
      const clamped = clampDialogOffset(
        dialogState.offsetX,
        dialogState.offsetY,
        effectiveWidth,
        effectiveHeight,
        window.innerWidth,
        window.innerHeight,
      );
      if (clamped.x !== dialogState.offsetX || clamped.y !== dialogState.offsetY) {
        console.debug(
          `[DialogOffset] open clamp ${target.dialogKey}: (${dialogState.offsetX}, ${dialogState.offsetY}) → (${clamped.x}, ${clamped.y})`,
        );
        dialogState.offsetX = clamped.x;
        dialogState.offsetY = clamped.y;
      }
    }

    dialogState.visible = true;

    if (target.dialogKey === "toolbox") {
      this.internalState.workbench.toolbox.bottomDockCollapsed = false;
      if (this.internalState.workbench.toolbox.dockPreference === "bottom") {
        this.internalState.workbench.dialogState.timeline.visible = false;
        this.workspace.simulation?.actions.disableTimeline();
      }
    }

    if (target.dialogKey === "timeline") {
      this.internalState.workbench.timelineBottomDockCollapsed = false;
      void this.workspace.simulation?.actions.enableTimeline();
      if (
        this.internalState.workbench.timelineDockPreference === "bottom"
        || this.internalState.screenProfile.deviceClass === "mobile"
      ) {
        this.internalState.workbench.dialogState.toolbox.visible = false;
      }
    }

    if (target.tabId !== null) {
      const nextTab = normalizeDialogTab(target.dialogKey, target.tabId);

      if (nextTab !== null) {
        dialogState.activeTab = nextTab;
      }
    } else if (dialogState.activeTab === null) {
      dialogState.activeTab = resolveDefaultDialogTabId(target.dialogKey);
    }
  });

  public readonly closeDialog: AppInternalAction["closeDialog"] = action((dialogKey) => {
    const normalizedDialogKey = normalizeDialogKey(dialogKey);

    if (normalizedDialogKey === null) {
      return;
    }

    this.ensureDialogState(normalizedDialogKey).visible = false;
    if (normalizedDialogKey === "timeline") {
      this.workspace.simulation?.actions.disableTimeline();
    }
  });

  public readonly toggleDialogMaximized: AppInternalAction["toggleDialogMaximized"] = action((dialogKey) => {
    const normalizedDialogKey = normalizeDialogKey(dialogKey);

    if (normalizedDialogKey === null) {
      return;
    }

    const dialogState = this.ensureDialogState(normalizedDialogKey);

    if (!dialogState.visible) {
      return;
    }

    dialogState.maximized = !dialogState.maximized;
  });

  public readonly setDialogTab: AppInternalAction["setDialogTab"] = action((dialogKey, tabId) => {
    const normalizedDialogKey = normalizeDialogKey(dialogKey);

    if (normalizedDialogKey === null) {
      return;
    }

    const nextTab = normalizeDialogTab(normalizedDialogKey, tabId);

    if (nextTab === null) {
      return;
    }

    const dialogState = this.ensureDialogState(normalizedDialogKey);

    if (dialogState.activeTab === nextTab) {
      return;
    }

    dialogState.activeTab = nextTab;
  });

  public readonly setDialogOffset: AppInternalAction["setDialogOffset"] = action((dialogKey, offsetX, offsetY) => {
    const normalizedDialogKey = normalizeDialogKey(dialogKey);

    if (
      normalizedDialogKey === null
      || !Number.isFinite(offsetX)
      || !Number.isFinite(offsetY)
    ) {
      return;
    }

    const dialogState = this.ensureDialogState(normalizedDialogKey);

    const effectiveWidth = Math.min(
      dialogState.width ?? Math.min(DIALOG_DEFAULT_MAX_WIDTH, window.innerWidth),
      window.innerWidth,
    );
    const effectiveHeight = Math.min(
      dialogState.height ?? Math.min(DIALOG_DEFAULT_MAX_HEIGHT, window.innerHeight),
      window.innerHeight,
    );
    const clamped = clampDialogOffset(
      Math.round(offsetX),
      Math.round(offsetY),
      effectiveWidth,
      effectiveHeight,
      window.innerWidth,
      window.innerHeight,
    );
    const prevOffsetX = dialogState.offsetX;
    const prevOffsetY = dialogState.offsetY;
    dialogState.offsetX = clamped.x;
    dialogState.offsetY = clamped.y;
    if (prevOffsetX !== clamped.x || prevOffsetY !== clamped.y) {
      console.debug(
        `[DialogOffset] set ${normalizedDialogKey} offset: (${prevOffsetX}, ${prevOffsetY}) → (${clamped.x}, ${clamped.y})`,
      );
    }
  });

  public readonly setDialogSize: AppInternalAction["setDialogSize"] = action((dialogKey, width, height) => {
    const normalizedDialogKey = normalizeDialogKey(dialogKey);

    if (normalizedDialogKey === null) {
      return;
    }

    const dialogState = this.ensureDialogState(normalizedDialogKey);

    if (width !== null && (!Number.isFinite(width) || width <= 0)) {
      return;
    }

    if (height !== null && (!Number.isFinite(height) || height <= 0)) {
      return;
    }

    dialogState.width = width === null ? null : Math.round(width);
    dialogState.height = height === null ? null : Math.round(height);
  });

  public readonly setToolboxDockPreference: AppInternalAction["setToolboxDockPreference"] = action((preference) => {
    if (this.internalState.workbench.toolbox.dockPreference === preference) {
      return;
    }

    this.internalState.workbench.toolbox.dockPreference = preference;
    this.internalState.workbench.toolbox.bottomDockCollapsed = false;

    if (preference === "bottom") {
      this.internalState.workbench.dialogState.toolbox.maximized = false;
      this.internalState.workbench.dialogState.timeline.visible = false;
      this.workspace.simulation?.actions.disableTimeline();
    }
  });

  public readonly setToolboxBottomDockCollapsed: AppInternalAction["setToolboxBottomDockCollapsed"] = action((collapsed) => {
    if (this.internalState.workbench.toolbox.bottomDockCollapsed === collapsed) {
      return;
    }

    this.internalState.workbench.toolbox.bottomDockCollapsed = collapsed;
  });

  public readonly setToolboxBottomDockHeight: AppInternalAction["setToolboxBottomDockHeight"] = action((height) => {
    if (!Number.isFinite(height)) {
      return;
    }

    this.internalState.workbench.toolbox.bottomDockHeight = clampToolboxBottomDockHeight(height);
  });

  public readonly setTimelineDockPreference: AppInternalAction["setTimelineDockPreference"] = action((preference) => {
    if (this.internalState.workbench.timelineDockPreference === preference) {
      return;
    }

    this.internalState.workbench.timelineDockPreference = preference;
    this.internalState.workbench.timelineBottomDockCollapsed = false;

    if (preference === "bottom") {
      this.internalState.workbench.dialogState.timeline.maximized = false;
      this.internalState.workbench.dialogState.toolbox.visible = false;
    }
  });

  public readonly setTimelineBottomDockCollapsed: AppInternalAction["setTimelineBottomDockCollapsed"] = action((collapsed) => {
    if (this.internalState.workbench.timelineBottomDockCollapsed === collapsed) {
      return;
    }

    this.internalState.workbench.timelineBottomDockCollapsed = collapsed;
  });

  public readonly setTimelineBottomDockHeight: AppInternalAction["setTimelineBottomDockHeight"] = action((height) => {
    if (!Number.isFinite(height)) {
      return;
    }

    this.internalState.workbench.timelineBottomDockHeight = clampTimelineBottomDockHeight(height);
  });

  public readonly setActivePanel: AppInternalAction["setActivePanel"] = action((panel) => {
    this.internalState.runtime.activePanel = panel;

    if (panel !== null) {
      this.setLeftDockOpen(true);
    }
  });

  public readonly setActiveTool: AppInternalAction["setActiveTool"] = action((activeTool) => {
    const previousActiveTool = this.internalState.activeTool;
    if (previousActiveTool === activeTool) {
      return;
    }

    if (!(previousActiveTool === "select" && activeTool === "single-placement")) {
      this.internalState.runtime.selectingPlacementGroup = null;
    }

    if (activeTool !== "dark-pipe-link") {
      this.internalState.toolInfo.darkPipeLink = null;
    }

    this.internalState.activeTool = activeTool;
  });

  public readonly showCanvasFloatingToolbar: AppInternalAction["showCanvasFloatingToolbar"] = action((
    buttonIds,
    clientPixelPoint,
  ) => {
    const nextButtonIds = normalizeCanvasFloatingToolbarButtonIds(buttonIds);
    const nextAnchor = normalizeClientPixelPoint(clientPixelPoint);

    if (nextButtonIds.length === 0 || nextAnchor === null) {
      this.hideCanvasFloatingToolbar();
      return;
    }

    this.internalState.runtime.canvasFloatingToolbar.visible = true;
    this.internalState.runtime.canvasFloatingToolbar.buttonIds = nextButtonIds;
    this.internalState.runtime.canvasFloatingToolbar.anchor = nextAnchor;
    this.internalState.runtime.canvasFloatingToolbar.attachedCollection = null;
  });

  public readonly showCanvasFloatingToolbarForCollection: AppInternalAction["showCanvasFloatingToolbarForCollection"] = action((
    buttonIds,
    collectionType,
  ) => {
    const nextButtonIds = normalizeCanvasFloatingToolbarButtonIds(buttonIds);

    if (nextButtonIds.length === 0) {
      this.hideCanvasFloatingToolbar();
      return false;
    }

    this.internalState.runtime.canvasFloatingToolbar.visible = true;
    this.internalState.runtime.canvasFloatingToolbar.buttonIds = nextButtonIds;
    this.internalState.runtime.canvasFloatingToolbar.attachedCollection = collectionType;

    if (!this.alignCanvasFloatingToolbar()) {
      this.hideCanvasFloatingToolbar();
      return false;
    }

    return true;
  });

  public readonly moveCanvasFloatingToolbar: AppInternalAction["moveCanvasFloatingToolbar"] = action((
    clientPixelPoint,
  ) => {
    if (!this.internalState.runtime.canvasFloatingToolbar.visible) {
      return;
    }

    const nextAnchor = normalizeClientPixelPoint(clientPixelPoint);
    if (nextAnchor === null) {
      return;
    }

    this.internalState.runtime.canvasFloatingToolbar.anchor = nextAnchor;
  });

  public readonly alignCanvasFloatingToolbar: AppInternalAction["alignCanvasFloatingToolbar"] = action(() => {
    const toolbar = this.internalState.runtime.canvasFloatingToolbar;
    if (!toolbar.visible || toolbar.attachedCollection === null) {
      return false;
    }

    const editor = this.workspace.editor;
    if (editor === null) {
      return false;
    }

    const collectionRect = editor.queries.findEntityCollectionGridRect(
      toolbar.attachedCollection,
    );
    if (collectionRect === null) {
      return false;
    }

    const topLeftCellRect = editor.queries.findClientRectForGridCell({
      x: collectionRect.x,
      y: collectionRect.y,
    });
    if (topLeftCellRect === null) {
      return false;
    }

    const toolbarHeight = toolbar.measuredSize?.height ?? DEFAULT_CANVAS_FLOATING_TOOLBAR_HEIGHT;
    const toolbarWidth = toolbar.measuredSize?.width ?? 0;
    const viewport = editor.state.viewport.clientRect;
    const cellWidth = topLeftCellRect.width;

    const halfToolbarHeight = toolbarHeight / 2;

    const aboveAnchor: ClientPixelPoint = {
      x:
        topLeftCellRect.left
        + cellWidth * collectionRect.width / 2,
      y:
        topLeftCellRect.top
        - halfToolbarHeight
        - FLOATING_TOOLBAR_DEVICE_GAP_PX,
    };

    let anchor = aboveAnchor;

    const viewportTopSixth = viewport.top + viewport.height / 6;
    if (aboveAnchor.y < viewportTopSixth) {
      const bottomCellY = collectionRect.y + collectionRect.height - 1;
      const bottomCellRect = editor.queries.findClientRectForGridCell({
        x: collectionRect.x,
        y: bottomCellY,
      });
      const viewportBottomFiveSixths = viewport.top + (viewport.height * 5) / 6;

      if (bottomCellRect !== null) {
        const belowY =
          bottomCellRect.top
          + bottomCellRect.height
          + halfToolbarHeight
          + FLOATING_TOOLBAR_DEVICE_GAP_PX;

        if (belowY <= viewportBottomFiveSixths) {
          anchor = {
            x: aboveAnchor.x,
            y: belowY,
          };
        } else {
          anchor = {
            x: aboveAnchor.x,
            y: viewport.top + toolbarHeight * 1.5,
          };
        }
      } else {
        anchor = {
          x: aboveAnchor.x,
          y: viewport.top + toolbarHeight * 1.5,
        };
      }
    }

    if (toolbarWidth > 0) {
      const halfWidth = toolbarWidth / 2;
      const viewportLeft = viewport.left;
      const viewportRight = viewport.left + viewport.width;

      if (anchor.x - halfWidth < viewportLeft) {
        anchor = {
          x: viewportLeft + halfWidth,
          y: anchor.y,
        };
      } else if (anchor.x + halfWidth > viewportRight) {
        anchor = {
          x: viewportRight - halfWidth,
          y: anchor.y,
        };
      }
    }

    toolbar.anchor = anchor;
    return true;
  });

  public readonly setCanvasFloatingToolbarSize: AppInternalAction["setCanvasFloatingToolbarSize"] = action((size) => {
    const nextSize = normalizeCanvasFloatingToolbarSize(size);
    const currentSize = this.internalState.runtime.canvasFloatingToolbar.measuredSize;

    if (
      currentSize?.width === nextSize?.width
      && currentSize?.height === nextSize?.height
    ) {
      return;
    }

    this.internalState.runtime.canvasFloatingToolbar.measuredSize = nextSize;
    this.alignCanvasFloatingToolbar();
  });

  public readonly hideCanvasFloatingToolbar: AppInternalAction["hideCanvasFloatingToolbar"] = action(() => {
    if (
      !this.internalState.runtime.canvasFloatingToolbar.visible
      && this.internalState.runtime.canvasFloatingToolbar.buttonIds.length === 0
      && this.internalState.runtime.canvasFloatingToolbar.anchor === null
      && this.internalState.runtime.canvasFloatingToolbar.attachedCollection === null
    ) {
      return;
    }

    this.internalState.runtime.canvasFloatingToolbar.visible = false;
    this.internalState.runtime.canvasFloatingToolbar.buttonIds = [];
    this.internalState.runtime.canvasFloatingToolbar.anchor = null;
    this.internalState.runtime.canvasFloatingToolbar.attachedCollection = null;
  });

  public readonly showCanvasRightDockToolbar: AppInternalAction["showCanvasRightDockToolbar"] = action((
    items,
  ) => {
    const nextItems = normalizeCanvasRightDockToolbarItems(items);

    if (nextItems.length === 0) {
      this.hideCanvasRightDockToolbar();
      return;
    }

    this.internalState.runtime.canvasRightDockToolbar.visible = true;
    this.internalState.runtime.canvasRightDockToolbar.items = nextItems;
    // AI-REMOVED 2026-08-22:
    // Reason: 右侧工具列不再保存按钮数组和全局 mode。
    // Trigger: 每个功能请求独立声明 button/shortcut/both。
    // Evidence: nextItems 已包含归一化后的 operationId 与 presentation。
    // Replacement: canvasRightDockToolbar.items = nextItems。
    // Risk: Low
    // Human Review: Required
    //
    // Original code:
    // this.internalState.runtime.canvasRightDockToolbar.buttonIds = nextButtonIds;
    // this.internalState.runtime.canvasRightDockToolbar.mode = mode;
  });

  public readonly hideCanvasRightDockToolbar: AppInternalAction["hideCanvasRightDockToolbar"] = action(() => {
    if (
      !this.internalState.runtime.canvasRightDockToolbar.visible
      && this.internalState.runtime.canvasRightDockToolbar.items.length === 0
    ) {
      return;
    }

    this.internalState.runtime.canvasRightDockToolbar.visible = false;
    this.internalState.runtime.canvasRightDockToolbar.items = [];
    // AI-REMOVED 2026-08-22:
    // Reason: 隐藏动作清理新的逐项请求状态。
    // Trigger: canvasRightDockToolbar.buttonIds 已被 items 替代。
    // Evidence: WorkbenchApp 从 items 渲染右侧工具列。
    // Replacement: canvasRightDockToolbar.items = []。
    // Risk: Low
    // Human Review: Required
    //
    // Original code:
    // this.internalState.runtime.canvasRightDockToolbar.buttonIds = [];
  });

  public readonly showCanvasTopLeftCornerToolbar: AppInternalAction["showCanvasTopLeftCornerToolbar"] = action((
    buttonIds,
  ) => {
    const nextToolbarState = normalizeCanvasTopLeftCornerToolbarButtons(buttonIds);

    if (nextToolbarState.buttonIds.length === 0) {
      this.hideCanvasTopLeftCornerToolbar();
      return;
    }

    this.internalState.runtime.canvasTopLeftCornerToolbar.visible = true;
    this.internalState.runtime.canvasTopLeftCornerToolbar.buttonIds = nextToolbarState.buttonIds;
    this.internalState.runtime.canvasTopLeftCornerToolbar.initialOffButtonIds =
      nextToolbarState.initialOffButtonIds;
  });

  public readonly hideCanvasTopLeftCornerToolbar: AppInternalAction["hideCanvasTopLeftCornerToolbar"] = action(() => {
    if (
      !this.internalState.runtime.canvasTopLeftCornerToolbar.visible
      && this.internalState.runtime.canvasTopLeftCornerToolbar.buttonIds.length === 0
      && this.internalState.runtime.canvasTopLeftCornerToolbar.initialOffButtonIds.length === 0
    ) {
      return;
    }

    this.internalState.runtime.canvasTopLeftCornerToolbar.visible = false;
    this.internalState.runtime.canvasTopLeftCornerToolbar.buttonIds = [];
    this.internalState.runtime.canvasTopLeftCornerToolbar.initialOffButtonIds = [];
  });

  public readonly setLeftDockWidth: AppInternalAction["setLeftDockWidth"] = action((width) => {
    this.internalState.workbench.leftDockWidth = clampLeftDockWidth(width);
  });

  public readonly setScreenProfile: AppInternalAction["setScreenProfile"] = action((screenProfile) => {
    if (areScreenProfilesEqual(this.internalState.screenProfile, screenProfile)) {
      return;
    }

    this.internalState.screenProfile = screenProfile;
  });

  public readonly setLocale: AppInternalAction["setLocale"] = action((locale) => {
    if (this.internalState.settings.locale === locale) {
      return;
    }

    this.internalState.settings.locale = locale;
  });

  public readonly getKeyboardShortcutFor: AppInternalAction["getKeyboardShortcutFor"] = (key) => {
    return this.shortcutManager.getKeyboardShortcutFor(key);
  };

  public readonly isShortcutFor: AppInternalAction["isShortcutFor"] = (
    key,
    code,
    eventKey,
    modifiers,
  ) => {
    return this.shortcutManager.isShortcutFor(key, code, eventKey, modifiers);
  };

  public readonly matchesAnyShortcut: AppInternalAction["matchesAnyShortcut"] = (
    code,
    eventKey,
    modifiers,
  ) => {
    return this.shortcutManager.matchesAnyShortcut(code, eventKey, modifiers);
  };

  public readonly setShortcutFor: AppInternalAction["setShortcutFor"] = (key, value) => {
    this.shortcutManager.setShortcutFor(key, value);
  };

  public readonly resetAllShortcutsToDefaults: AppInternalAction["resetAllShortcutsToDefaults"] = () => {
    this.shortcutManager.resetAllShortcutsToDefaults();
  };

  private setLeftDockOpen(nextOpen: boolean): void {
    if (this.internalState.workbench.leftDockOpen === nextOpen) {
      return;
    }

    this.applyPredictedViewportRectForDockToggle({
      dock: "left",
      willOpen: nextOpen,
    });
    this.internalState.workbench.leftDockOpen = nextOpen;
  }

  private applyPredictedViewportRectForDockToggle(options: {
    dock: "left" | "right";
    willOpen: boolean;
  }): void {
    const editor = this.workspace.editor;
    if (editor === null) {
      return;
    }

    const currentRect = editor.state.viewport.clientRect;
    const predictedRect = resolvePredictedViewportRectForDockToggle({
      currentRect,
      leftDockWidth: resolveLeftDockWidthForScreenProfile(
        this.internalState.workbench.leftDockWidth,
        this.internalState.screenProfile,
      ),
      rightDockWidth: DEFAULT_RIGHT_DOCK_WIDTH,
      dock: options.dock,
      willOpen: options.willOpen,
    });

    if (
      predictedRect.left === currentRect.left
      && predictedRect.top === currentRect.top
      && predictedRect.width === currentRect.width
      && predictedRect.height === currentRect.height
    ) {
      return;
    }

    editor.actions.setViewportClientRect(predictedRect);
  }

  private ensureDialogState(dialogKey: DialogKey) {
    this.internalState.workbench.dialogState[dialogKey] ??= createDefaultDialogStateForKey(dialogKey);

    return this.internalState.workbench.dialogState[dialogKey] as NonNullable<
      UiStateReadWrite["workbench"]["dialogState"][DialogKey]
    >;
  }
}

function normalizeDialogRequest(request: string): { dialogKey: DialogKey; tabId: string | null } | null {
  const [rawDialogKey = "", ...tabParts] = request.split(":");
  const dialogKey = normalizeDialogKey(rawDialogKey);

  if (dialogKey === null) {
    return null;
  }

  const rawTabId = tabParts.join(":").trim();

  return {
    dialogKey,
    tabId: rawTabId === "" ? null : rawTabId,
  };
}

function normalizeDialogKey(dialogKey: string): DialogKey | null {
  const trimmedDialogKey = dialogKey.trim();

  return DIALOG_KEYS.includes(trimmedDialogKey as DialogKey)
    ? trimmedDialogKey as DialogKey
    : null;
}

function normalizeDialogTab(dialogKey: DialogKey, tabId: string): string | null {
  if (dialogKey === "toolbox") {
    return normalizeToolboxDialogTab(tabId);
  }

  if (dialogKey === "help") {
    return normalizeHelpDialogTab(tabId);
  }

  return null;
}

function resolvePredictedViewportRectForDockToggle(options: {
  currentRect: ClientPixelRect;
  leftDockWidth: number;
  rightDockWidth: number;
  dock: "left" | "right";
  willOpen: boolean;
}): ClientPixelRect {
  const delta = options.dock === "left"
    ? options.leftDockWidth
    : options.rightDockWidth;

  if (options.dock === "left") {
    return {
      left: options.willOpen
        ? options.currentRect.left + delta
        : options.currentRect.left - delta,
      top: options.currentRect.top,
      width: options.willOpen
        ? Math.max(0, options.currentRect.width - delta)
        : options.currentRect.width + delta,
      height: options.currentRect.height,
    };
  }

  return {
    left: options.currentRect.left,
    top: options.currentRect.top,
    width: options.willOpen
      ? Math.max(0, options.currentRect.width - delta)
      : options.currentRect.width + delta,
    height: options.currentRect.height,
  };
}

function areScreenProfilesEqual(left: ScreenProfile, right: ScreenProfile): boolean {
  return (
    left.viewportWidth === right.viewportWidth
    && left.viewportHeight === right.viewportHeight
    && left.devicePixelRatio === right.devicePixelRatio
    && left.deviceClass === right.deviceClass
    && left.screenShape === right.screenShape
    && left.aspectRatio === right.aspectRatio
    && left.hasTouch === right.hasTouch
  );
}

function normalizeCanvasFloatingToolbarButtonIds(
  buttonIds: readonly CanvasFloatingToolbarButtonId[],
): CanvasFloatingToolbarButtonId[] {
  const knownButtonIds = new Set<CanvasFloatingToolbarButtonId>(CANVAS_FLOATING_TOOLBAR_BUTTON_IDS);
  const deduped: CanvasFloatingToolbarButtonId[] = [];

  for (const buttonId of buttonIds) {
    if (!knownButtonIds.has(buttonId) || deduped.includes(buttonId)) {
      continue;
    }

    deduped.push(buttonId);
  }

  return deduped;
}

function normalizeCanvasRightDockToolbarItems(
  items: readonly CanvasRightDockToolbarItemRequest[],
): CanvasRightDockToolbarItemRequest[] {
  const knownOperationIds = new Set<CanvasRightDockToolbarOperationId>(
    CANVAS_RIGHT_DOCK_TOOLBAR_OPERATION_IDS,
  );
  const knownPresentations = new Set<CanvasRightDockToolbarPresentation>([
    "button",
    "shortcut",
    "both",
  ]);
  const seenOperationIds = new Set<CanvasRightDockToolbarOperationId>();
  const deduped: CanvasRightDockToolbarItemRequest[] = [];

  for (const item of items) {
    if (
      !knownOperationIds.has(item.operationId)
      || !knownPresentations.has(item.presentation)
      || seenOperationIds.has(item.operationId)
    ) {
      continue;
    }

    seenOperationIds.add(item.operationId);
    deduped.push({
      operationId: item.operationId,
      presentation: item.presentation,
    });
  }

  return deduped;
}

// AI-REMOVED 2026-08-22:
// Reason: 右侧工具列不再归一化按钮 ID，而是归一化功能展示请求。
// Trigger: 用户要求呼起方仅指定功能和本次展示形态。
// Evidence: normalizeCanvasRightDockToolbarItems 同时校验 operationId、presentation 并按功能去重。
// Replacement: normalizeCanvasRightDockToolbarItems。
// Risk: Low
// Human Review: Required
//
// Original code:
// function normalizeCanvasRightDockToolbarButtonIds(
//   buttonIds: readonly CanvasRightDockToolbarButtonId[],
// ): CanvasRightDockToolbarButtonId[] {
//   const knownButtonIds = new Set<CanvasRightDockToolbarButtonId>(CANVAS_RIGHT_DOCK_TOOLBAR_BUTTON_IDS);
//   const deduped: CanvasRightDockToolbarButtonId[] = [];
//
//   for (const buttonId of buttonIds) {
//     if (!knownButtonIds.has(buttonId) || deduped.includes(buttonId)) {
//       continue;
//     }
//
//     deduped.push(buttonId);
//   }
//
//   return deduped;
// }

function normalizeCanvasTopLeftCornerToolbarButtons(
  buttonIds: readonly CanvasTopLeftCornerToolbarShowButtonId[],
): {
  buttonIds: CanvasTopLeftCornerToolbarButtonId[];
  initialOffButtonIds: CanvasTopLeftCornerToolbarButtonId[];
} {
  const knownButtonIds = new Set<CanvasTopLeftCornerToolbarButtonId>(
    CANVAS_TOP_LEFT_CORNER_TOOLBAR_BUTTON_IDS,
  );
  const deduped: CanvasTopLeftCornerToolbarButtonId[] = [];
  const initialOffButtonIds: CanvasTopLeftCornerToolbarButtonId[] = [];

  for (const requestedButtonId of buttonIds) {
    const isInitialOffButton = requestedButtonId.endsWith("-off");
    const buttonId = (isInitialOffButton
      ? requestedButtonId.slice(0, -4)
      : requestedButtonId) as CanvasTopLeftCornerToolbarButtonId;

    if (!knownButtonIds.has(buttonId) || deduped.includes(buttonId)) {
      continue;
    }

    deduped.push(buttonId);

    if (isInitialOffButton) {
      initialOffButtonIds.push(buttonId);
    }
  }

  return {
    buttonIds: deduped,
    initialOffButtonIds,
  };
}

function normalizeHelpDialogTab(tabId: string): string | null {
  const knownTabs = new Set<string>(HELP_DIALOG_TAB_IDS);

  return knownTabs.has(tabId) ? tabId : null;
}

function normalizeToolboxDialogTab(tabId: string): string | null {
  const knownTabs = new Set<string>(TOOLBOX_DIALOG_TAB_IDS);

  return knownTabs.has(tabId) ? tabId : null;
}

function normalizeClientPixelPoint(
  clientPixelPoint: ClientPixelPoint,
): ClientPixelPoint | null {
  if (!Number.isFinite(clientPixelPoint.x) || !Number.isFinite(clientPixelPoint.y)) {
    return null;
  }

  return {
    x: clientPixelPoint.x,
    y: clientPixelPoint.y,
  };
}

function normalizeCanvasFloatingToolbarSize(
  size: CanvasFloatingToolbarSize | null,
): CanvasFloatingToolbarSize | null {
  if (
    size === null
    || !Number.isFinite(size.width)
    || !Number.isFinite(size.height)
    || size.width <= 0
    || size.height <= 0
  ) {
    return null;
  }

  return {
    width: size.width,
    height: size.height,
  };
}

// AI-REMOVED 2026-06-15:
// Reason: 重构为像素偏移锚点，不再需要基于格子和 deviceClass 的间距计算。
// Trigger: 用户需求 — toolbar 改为距离设备包围盒 0 格 + 半按钮高 + 6px，统一桌面/移动。
// Evidence: alignCanvasFloatingToolbar 内已直接计算 aboveAnchor，不再调用此函数。
// Replacement: alignCanvasFloatingToolbar 方法内直接计算。
// Risk: Low
// Human Review: Not required
//
// Original code:
// function resolveCanvasFloatingToolbarAnchor(options: {
//   collectionWidth: number;
//   deviceClass: ScreenProfile["deviceClass"];
//   topLeftAboveCellRect: ClientPixelRect;
//   toolbarHeight: number;
// }): ClientPixelPoint {
//   const cellHeight = options.topLeftAboveCellRect.height;
//   const verticalOverflow = Math.max(0, options.toolbarHeight - cellHeight);
//   const desktopOffset = options.deviceClass === "desktop" ? cellHeight : 0;
//
//   return {
//     x:
//       options.topLeftAboveCellRect.left
//       + options.topLeftAboveCellRect.width * options.collectionWidth / 2,
//     y:
//       options.topLeftAboveCellRect.top
//       - cellHeight / 2
//       - verticalOverflow / 2
//       + desktopOffset,
//   };
// }
