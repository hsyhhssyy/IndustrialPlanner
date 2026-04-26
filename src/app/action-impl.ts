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

import {
  type ActiveTool,
  CANVAS_TOOLBAR_BUTTON_IDS,
  type CanvasToolbarButtonId,
  type CanvasToolbarSize,
  clampLeftDockWidth,
  DEFAULT_RIGHT_DOCK_WIDTH,
  resolveLeftDockWidthForScreenProfile,
  type ActivePanel,
  type UiStateReadWrite,
} from "./state-impl";

const DEFAULT_CANVAS_TOOLBAR_HEIGHT = 44;

export interface AppInternalAction {
  toggleLeftDock: () => void;
  toggleRightDock: () => void;
  toggleTopBarCollapsed: () => void;
  setActivePanel: (panel: ActivePanel) => void;
  setActiveTool: (activeTool: ActiveTool) => void;
  showCanvasToolbar: (
    buttonIds: readonly CanvasToolbarButtonId[],
    clientPixelPoint: ClientPixelPoint,
  ) => void;
  showCanvasToolbarForCollection: (
    buttonIds: readonly CanvasToolbarButtonId[],
    collectionType: EntityCollectionType,
  ) => boolean;
  moveCanvasToolbar: (clientPixelPoint: ClientPixelPoint) => void;
  alignCanvasToolbar: () => boolean;
  setCanvasToolbarSize: (size: CanvasToolbarSize | null) => void;
  hideCanvasToolbar: () => void;
  setLeftDockWidth: (width: number) => void;
  setScreenProfile: (screenProfile: ScreenProfile) => void;
  setLocale: (locale: AppLocale) => void;
}

export class AppActionImpl implements AppAction, AppInternalAction {
  public constructor(
    private readonly internalState: UiStateReadWrite,
    private readonly workspace: WorkspaceContract,
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
    if (this.internalState.runtime.activeTool === activeTool) {
      return;
    }

    this.internalState.runtime.activeTool = activeTool;
  });

  public readonly showCanvasToolbar: AppInternalAction["showCanvasToolbar"] = action((
    buttonIds,
    clientPixelPoint,
  ) => {
    const nextButtonIds = normalizeCanvasToolbarButtonIds(buttonIds);
    const nextAnchor = normalizeClientPixelPoint(clientPixelPoint);

    if (nextButtonIds.length === 0 || nextAnchor === null) {
      this.hideCanvasToolbar();
      return;
    }

    this.internalState.runtime.canvasToolbar.visible = true;
    this.internalState.runtime.canvasToolbar.buttonIds = nextButtonIds;
    this.internalState.runtime.canvasToolbar.anchor = nextAnchor;
    this.internalState.runtime.canvasToolbar.attachedCollection = null;
  });

  public readonly showCanvasToolbarForCollection: AppInternalAction["showCanvasToolbarForCollection"] = action((
    buttonIds,
    collectionType,
  ) => {
    const nextButtonIds = normalizeCanvasToolbarButtonIds(buttonIds);

    if (nextButtonIds.length === 0) {
      this.hideCanvasToolbar();
      return false;
    }

    this.internalState.runtime.canvasToolbar.visible = true;
    this.internalState.runtime.canvasToolbar.buttonIds = nextButtonIds;
    this.internalState.runtime.canvasToolbar.attachedCollection = collectionType;

    if (!this.alignCanvasToolbar()) {
      this.hideCanvasToolbar();
      return false;
    }

    return true;
  });

  public readonly moveCanvasToolbar: AppInternalAction["moveCanvasToolbar"] = action((
    clientPixelPoint,
  ) => {
    if (!this.internalState.runtime.canvasToolbar.visible) {
      return;
    }

    const nextAnchor = normalizeClientPixelPoint(clientPixelPoint);
    if (nextAnchor === null) {
      return;
    }

    this.internalState.runtime.canvasToolbar.anchor = nextAnchor;
  });

  public readonly alignCanvasToolbar: AppInternalAction["alignCanvasToolbar"] = action(() => {
    const toolbar = this.internalState.runtime.canvasToolbar;
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

    toolbar.anchor = resolveCanvasToolbarAnchor({
      collectionWidth: collectionRect.width,
      topLeftAboveCellRect,
      toolbarHeight: toolbar.measuredSize?.height ?? DEFAULT_CANVAS_TOOLBAR_HEIGHT,
    });
    return true;
  });

  public readonly setCanvasToolbarSize: AppInternalAction["setCanvasToolbarSize"] = action((size) => {
    const nextSize = normalizeCanvasToolbarSize(size);
    const currentSize = this.internalState.runtime.canvasToolbar.measuredSize;

    if (
      currentSize?.width === nextSize?.width
      && currentSize?.height === nextSize?.height
    ) {
      return;
    }

    this.internalState.runtime.canvasToolbar.measuredSize = nextSize;
    this.alignCanvasToolbar();
  });

  public readonly hideCanvasToolbar: AppInternalAction["hideCanvasToolbar"] = action(() => {
    if (
      !this.internalState.runtime.canvasToolbar.visible
      && this.internalState.runtime.canvasToolbar.buttonIds.length === 0
      && this.internalState.runtime.canvasToolbar.anchor === null
      && this.internalState.runtime.canvasToolbar.attachedCollection === null
    ) {
      return;
    }

    this.internalState.runtime.canvasToolbar.visible = false;
    this.internalState.runtime.canvasToolbar.buttonIds = [];
    this.internalState.runtime.canvasToolbar.anchor = null;
    this.internalState.runtime.canvasToolbar.attachedCollection = null;
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

function normalizeCanvasToolbarButtonIds(
  buttonIds: readonly CanvasToolbarButtonId[],
): CanvasToolbarButtonId[] {
  const knownButtonIds = new Set<CanvasToolbarButtonId>(CANVAS_TOOLBAR_BUTTON_IDS);
  const deduped: CanvasToolbarButtonId[] = [];

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

function normalizeCanvasToolbarSize(
  size: CanvasToolbarSize | null,
): CanvasToolbarSize | null {
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

function resolveCanvasToolbarAnchor(options: {
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
