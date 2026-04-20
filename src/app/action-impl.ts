import { action } from "mobx";

import type { AppAction } from "@/domain/action/app-action";
import { lookupMessageText } from "@/shared/i18n/messages";
import { lookupWorkbenchText } from "@/shared/i18n/workbench-placeholders";

import {
  clampLeftDockWidth,
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
    this.internalState.workbench.leftDockOpen = !this.internalState.workbench.leftDockOpen;
  });

  public readonly toggleRightDock: AppInternalAction["toggleRightDock"] = action(() => {
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
}