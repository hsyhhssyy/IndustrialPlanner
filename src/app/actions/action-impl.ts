import { action } from "mobx";

import type { AppAction } from "@/domain/app/app-action";
import type { WorkspaceContract } from "@/domain/document/workspace-contract";
import type { ScreenProfile } from "@/domain/app/types/screen-profile";
import type { EntityCollectionType } from "@/domain/editor/types/editor-types";
import type { RightDockTabId } from "@/domain/app/types/app-types";
import type {
  ClientPixelPoint,
  ClientPixelRect,
} from "@/domain/shared/client-pixel";
import type { AppLocale } from "@/shared/i18n/messages";
import { lookupMessageText } from "@/shared/i18n/messages";
import { lookupWorkbenchText } from "@/shared/i18n/workbench-placeholders";
import type { KeyboardShortcutManager } from "./keyboard-shortcut-manager";

import type { ActiveTool } from "@/domain/app/types/app-types";
import {
  CANVAS_FLOATING_TOOLBAR_BUTTON_IDS,
  CANVAS_RIGHT_DOCK_TOOLBAR_BUTTON_IDS,
  CANVAS_TOP_LEFT_CORNER_TOOLBAR_BUTTON_IDS,
  type CanvasFloatingToolbarButtonId,
  type CanvasFloatingToolbarSize,
  type CanvasRightDockToolbarButtonId,
  type CanvasTopLeftCornerToolbarButtonId,
  clampLeftDockWidth,
  createDefaultDialogStateForKey,
  DEFAULT_RIGHT_DOCK_WIDTH,
  DIALOG_KEYS,
  type DialogKey,
  HELP_DIALOG_TAB_IDS,
  resolveDefaultDialogTabId,
  resolveLeftDockWidthForScreenProfile,
  TOOLBOX_DIALOG_TAB_IDS,
  type ActivePanel,
  type UiStateReadWrite,
} from "../state/state-impl";

const DEFAULT_CANVAS_FLOATING_TOOLBAR_HEIGHT = 44;

export interface AppInternalAction {
  toggleLeftDock: () => void;
  toggleRightDock: () => void;
  toggleTopBarCollapsed: () => void;
  setRightDockActiveTab: (tabId: RightDockTabId) => void;
  openDialog: (request: string) => void;
  closeDialog: (dialogKey: string) => void;
  toggleDialogMaximized: (dialogKey: string) => void;
  setDialogTab: (dialogKey: string, tabId: string) => void;
  setDialogOffset: (dialogKey: string, offsetX: number, offsetY: number) => void;
  setDialogSize: (dialogKey: string, width: number | null, height: number | null) => void;
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
    buttonIds: readonly CanvasRightDockToolbarButtonId[],
  ) => void;
  hideCanvasRightDockToolbar: () => void;
  showCanvasTopLeftCornerToolbar: (
    buttonIds: readonly CanvasTopLeftCornerToolbarButtonId[],
  ) => void;
  hideCanvasTopLeftCornerToolbar: () => void;
  setLeftDockWidth: (width: number) => void;
  setScreenProfile: (screenProfile: ScreenProfile) => void;
  setLocale: (locale: AppLocale) => void;
  getKeyboardShortcutFor: (key: string) => string;
  isShortcutFor: (key: string, code: string | null, eventKey?: string | null) => boolean;
  setShortcutFor: (key: string, value: string) => void;
}

export class AppActionImpl implements AppAction, AppInternalAction {
  public constructor(
    private readonly internalState: UiStateReadWrite,
    private readonly workspace: WorkspaceContract,
    private readonly shortcutManager: KeyboardShortcutManager,
  ) {}

  public readonly translate: AppAction["translate"] = (key) => {
    const locale = this.internalState.settings.locale;

    return (
      lookupMessageText(locale, key) ??
      lookupWorkbenchText(locale, key) ??
      key
    );
  };

  public readonly toggleLeftDock: AppInternalAction["toggleLeftDock"] = action(() => {
    this.setLeftDockOpen(!this.internalState.workbench.leftDockOpen);
  });

  public readonly toggleRightDock: AppInternalAction["toggleRightDock"] = action(() => {
    this.applyPredictedViewportRectForDockToggle({
      dock: "right",
      willOpen: !this.internalState.workbench.rightDockOpen,
    });
    this.internalState.workbench.rightDockOpen = !this.internalState.workbench.rightDockOpen;
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

  public readonly openDialog: AppInternalAction["openDialog"] = action((request) => {
    const target = normalizeDialogRequest(request);

    if (target === null) {
      return;
    }

    const dialogState = this.ensureDialogState(target.dialogKey);
    const shouldResetDialogShellState =
      (dialogState.width !== null && dialogState.width > window.innerWidth)
      || (dialogState.height !== null && dialogState.height > window.innerHeight)
      || dialogState.offsetX < 0
      || dialogState.offsetY < 0;

    if (shouldResetDialogShellState) {
      Object.assign(dialogState, createDefaultDialogStateForKey(target.dialogKey));
    }

    dialogState.visible = true;

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
    dialogState.offsetX = Math.round(offsetX);
    dialogState.offsetY = Math.round(offsetY);
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

    const topLeftAboveCellRect = editor.queries.findClientRectForGridCell({
      x: collectionRect.x,
      y: collectionRect.y - 1,
    });
    if (topLeftAboveCellRect === null) {
      return false;
    }

    const toolbarHeight = toolbar.measuredSize?.height ?? DEFAULT_CANVAS_FLOATING_TOOLBAR_HEIGHT;
    const toolbarWidth = toolbar.measuredSize?.width ?? 0;
    const viewport = editor.state.viewport.clientRect;
    const cellHeight = topLeftAboveCellRect.height;

    const aboveAnchor = resolveCanvasFloatingToolbarAnchor({
      collectionWidth: collectionRect.width,
      deviceClass: this.internalState.screenProfile.deviceClass,
      topLeftAboveCellRect,
      toolbarHeight,
    });

    let anchor = aboveAnchor;

    const viewportTopSixth = viewport.top + viewport.height / 6;
    if (aboveAnchor.y < viewportTopSixth) {
      const topLeftBelowCellRect = editor.queries.findClientRectForGridCell({
        x: collectionRect.x,
        y: collectionRect.y + collectionRect.height,
      });
      const viewportBottomFiveSixths = viewport.top + (viewport.height * 5) / 6;

      if (topLeftBelowCellRect !== null) {
        const verticalOverflow = Math.max(0, toolbarHeight - cellHeight);
        const belowY =
          topLeftBelowCellRect.top
          + cellHeight
          + cellHeight / 2
          + verticalOverflow / 2;

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
    buttonIds,
  ) => {
    const nextButtonIds = normalizeCanvasRightDockToolbarButtonIds(buttonIds);

    if (nextButtonIds.length === 0) {
      this.hideCanvasRightDockToolbar();
      return;
    }

    this.internalState.runtime.canvasRightDockToolbar.visible = true;
    this.internalState.runtime.canvasRightDockToolbar.buttonIds = nextButtonIds;
  });

  public readonly hideCanvasRightDockToolbar: AppInternalAction["hideCanvasRightDockToolbar"] = action(() => {
    if (
      !this.internalState.runtime.canvasRightDockToolbar.visible
      && this.internalState.runtime.canvasRightDockToolbar.buttonIds.length === 0
    ) {
      return;
    }

    this.internalState.runtime.canvasRightDockToolbar.visible = false;
    this.internalState.runtime.canvasRightDockToolbar.buttonIds = [];
  });

  public readonly showCanvasTopLeftCornerToolbar: AppInternalAction["showCanvasTopLeftCornerToolbar"] = action((
    buttonIds,
  ) => {
    const nextButtonIds = normalizeCanvasTopLeftCornerToolbarButtonIds(buttonIds);

    if (nextButtonIds.length === 0) {
      this.hideCanvasTopLeftCornerToolbar();
      return;
    }

    this.internalState.runtime.canvasTopLeftCornerToolbar.visible = true;
    this.internalState.runtime.canvasTopLeftCornerToolbar.buttonIds = nextButtonIds;
  });

  public readonly hideCanvasTopLeftCornerToolbar: AppInternalAction["hideCanvasTopLeftCornerToolbar"] = action(() => {
    if (
      !this.internalState.runtime.canvasTopLeftCornerToolbar.visible
      && this.internalState.runtime.canvasTopLeftCornerToolbar.buttonIds.length === 0
    ) {
      return;
    }

    this.internalState.runtime.canvasTopLeftCornerToolbar.visible = false;
    this.internalState.runtime.canvasTopLeftCornerToolbar.buttonIds = [];
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

  public readonly isShortcutFor: AppInternalAction["isShortcutFor"] = (key, code, eventKey) => {
    return this.shortcutManager.isShortcutFor(key, code, eventKey);
  };

  public readonly setShortcutFor: AppInternalAction["setShortcutFor"] = (key, value) => {
    this.shortcutManager.setShortcutFor(key, value);
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

    return this.internalState.workbench.dialogState[dialogKey];
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

function normalizeCanvasRightDockToolbarButtonIds(
  buttonIds: readonly CanvasRightDockToolbarButtonId[],
): CanvasRightDockToolbarButtonId[] {
  const knownButtonIds = new Set<CanvasRightDockToolbarButtonId>(CANVAS_RIGHT_DOCK_TOOLBAR_BUTTON_IDS);
  const deduped: CanvasRightDockToolbarButtonId[] = [];

  for (const buttonId of buttonIds) {
    if (!knownButtonIds.has(buttonId) || deduped.includes(buttonId)) {
      continue;
    }

    deduped.push(buttonId);
  }

  return deduped;
}

function normalizeCanvasTopLeftCornerToolbarButtonIds(
  buttonIds: readonly CanvasTopLeftCornerToolbarButtonId[],
): CanvasTopLeftCornerToolbarButtonId[] {
  const knownButtonIds = new Set<CanvasTopLeftCornerToolbarButtonId>(
    CANVAS_TOP_LEFT_CORNER_TOOLBAR_BUTTON_IDS,
  );
  const deduped: CanvasTopLeftCornerToolbarButtonId[] = [];

  for (const buttonId of buttonIds) {
    if (!knownButtonIds.has(buttonId) || deduped.includes(buttonId)) {
      continue;
    }

    deduped.push(buttonId);
  }

  return deduped;
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

function resolveCanvasFloatingToolbarAnchor(options: {
  collectionWidth: number;
  deviceClass: ScreenProfile["deviceClass"];
  topLeftAboveCellRect: ClientPixelRect;
  toolbarHeight: number;
}): ClientPixelPoint {
  const cellHeight = options.topLeftAboveCellRect.height;
  const verticalOverflow = Math.max(0, options.toolbarHeight - cellHeight);
  const desktopOffset = options.deviceClass === "desktop" ? cellHeight : 0;

  return {
    x:
      options.topLeftAboveCellRect.left
      + options.topLeftAboveCellRect.width * options.collectionWidth / 2,
    y:
      options.topLeftAboveCellRect.top
      - cellHeight / 2
      - verticalOverflow / 2
      + desktopOffset,
  };
}
