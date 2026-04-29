import { action } from "mobx";

import type { AppAction } from "@/domain/action/app-action";
import type { WorkspaceContract } from "@/domain/contract/workspace-contract";
import type { ScreenProfile } from "@/domain/state/screen-profile";
import type { EntityCollectionType } from "@/domain/state/types";
import type {
  ClientPixelPoint,
  ClientPixelRect,
} from "@/domain/types/client-pixel";
import type { AppLocale } from "@/shared/i18n/messages";
import { lookupMessageText } from "@/shared/i18n/messages";
import { lookupWorkbenchText } from "@/shared/i18n/workbench-placeholders";
import type { KeyboardShortcutManager } from "./keyboard-shortcut-manager";

import type { ActiveTool } from "@/domain/state/types";
import {
  CANVAS_FLOATING_TOOLBAR_BUTTON_IDS,
  CANVAS_RIGHT_DOCK_TOOLBAR_BUTTON_IDS,
  CANVAS_TOP_LEFT_CORNER_TOOLBAR_BUTTON_IDS,
  type CanvasFloatingToolbarButtonId,
  type CanvasFloatingToolbarSize,
  type CanvasRightDockToolbarButtonId,
  type CanvasTopLeftCornerToolbarButtonId,
  clampLeftDockWidth,
  DEFAULT_RIGHT_DOCK_WIDTH,
  resolveLeftDockWidthForScreenProfile,
  type ActivePanel,
  type UiStateReadWrite,
} from "../state/state-impl";

const DEFAULT_CANVAS_FLOATING_TOOLBAR_HEIGHT = 44;

export interface AppInternalAction {
  toggleLeftDock: () => void;
  toggleRightDock: () => void;
  toggleTopBarCollapsed: () => void;
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

  public readonly setActivePanel: AppInternalAction["setActivePanel"] = action((panel) => {
    this.internalState.runtime.activePanel = panel;

    if (panel !== null) {
      this.setLeftDockOpen(true);
    }
  });

  public readonly setActiveTool: AppInternalAction["setActiveTool"] = action((activeTool) => {
    if (this.internalState.activeTool === activeTool) {
      return;
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

    toolbar.anchor = resolveCanvasFloatingToolbarAnchor({
      collectionWidth: collectionRect.width,
      topLeftAboveCellRect,
      toolbarHeight: toolbar.measuredSize?.height ?? DEFAULT_CANVAS_FLOATING_TOOLBAR_HEIGHT,
    });
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
  topLeftAboveCellRect: ClientPixelRect;
  toolbarHeight: number;
}): ClientPixelPoint {
  const cellHeight = options.topLeftAboveCellRect.height;
  const verticalOverflow = Math.max(0, options.toolbarHeight - cellHeight);

  return {
    x:
      options.topLeftAboveCellRect.left
      + options.topLeftAboveCellRect.width * options.collectionWidth / 2,
    y:
      options.topLeftAboveCellRect.top
      + cellHeight / 2
      - verticalOverflow / 2,
  };
}
