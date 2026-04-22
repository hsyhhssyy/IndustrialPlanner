import { action } from "mobx";

import type { AppAction } from "@/domain/action/app-action";
import type { WorkspaceContract } from "@/domain/contract/workspace-contract";
import type { EditorViewportClientRect } from "@/domain/state/types";
import { lookupMessageText } from "@/shared/i18n/messages";
import { lookupWorkbenchText } from "@/shared/i18n/workbench-placeholders";

import {
  clampLeftDockWidth,
  DEFAULT_RIGHT_DOCK_WIDTH,
  type ActivePanel,
  type UiStateReadWrite,
} from "./state-impl";

export interface AppInternalAction {
  toggleLeftDock: () => void;
  toggleRightDock: () => void;
  setActivePanel: (panel: ActivePanel) => void;
  setLeftDockWidth: (width: number) => void;
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
    this.applyPredictedViewportRectForDockToggle({
      dock: "left",
      willOpen: !this.internalState.workbench.leftDockOpen,
    });
    this.internalState.workbench.leftDockOpen = !this.internalState.workbench.leftDockOpen;
  });

  public readonly toggleRightDock: AppInternalAction["toggleRightDock"] = action(() => {
    this.applyPredictedViewportRectForDockToggle({
      dock: "right",
      willOpen: !this.internalState.workbench.rightDockOpen,
    });
    this.internalState.workbench.rightDockOpen = !this.internalState.workbench.rightDockOpen;
  });

  public readonly setActivePanel: AppInternalAction["setActivePanel"] = action((panel) => {
    this.internalState.runtime.activePanel = panel;

    if (panel !== null) {
      this.internalState.workbench.leftDockOpen = true;
    }
  });

  public readonly setLeftDockWidth: AppInternalAction["setLeftDockWidth"] = action((width) => {
    this.internalState.workbench.leftDockWidth = clampLeftDockWidth(width);
  });

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
      leftDockWidth: this.internalState.workbench.leftDockWidth,
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
  currentRect: EditorViewportClientRect;
  leftDockWidth: number;
  rightDockWidth: number;
  dock: "left" | "right";
  willOpen: boolean;
}): EditorViewportClientRect {
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