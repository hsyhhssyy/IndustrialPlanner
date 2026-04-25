import { action } from "mobx";

import type { AppAction } from "@/domain/action/app-action";
import type { WorkspaceContract } from "@/domain/contract/workspace-contract";
import type { ScreenProfile } from "@/domain/state/screen-profile";
import type { ClientPixelPoint } from "@/domain/types/client-pixel";
import type { ClientPixelRect } from "@/domain/types/client-pixel";
import type { AppLocale } from "@/shared/i18n/messages";
import { lookupMessageText } from "@/shared/i18n/messages";
import { lookupWorkbenchText } from "@/shared/i18n/workbench-placeholders";

import {
  type ActiveTool,
  CANVAS_TOOLBAR_BUTTON_IDS,
  type CanvasToolbarButtonId,
  clampLeftDockWidth,
  DEFAULT_RIGHT_DOCK_WIDTH,
  resolveLeftDockWidthForScreenProfile,
  type ActivePanel,
  type UiStateReadWrite,
} from "./state-impl";

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
  moveCanvasToolbar: (clientPixelPoint: ClientPixelPoint) => void;
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

  public readonly hideCanvasToolbar: AppInternalAction["hideCanvasToolbar"] = action(() => {
    if (
      !this.internalState.runtime.canvasToolbar.visible
      && this.internalState.runtime.canvasToolbar.buttonIds.length === 0
      && this.internalState.runtime.canvasToolbar.anchor === null
    ) {
      return;
    }

    this.internalState.runtime.canvasToolbar.visible = false;
    this.internalState.runtime.canvasToolbar.buttonIds = [];
    this.internalState.runtime.canvasToolbar.anchor = null;
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
