import { SHORTCUT_KEY } from "@/app/actions/keyboard-shortcut-manager";
import { canSaveSelectionAsBlueprint } from "@/app/blueprint/save-blueprint";
import type { AppHost } from "@/app/host/app-host";

import type { GestureHandleResult, GestureMappingModule } from "../types";
import { isHypergryphGestureEnabled } from "./hypergryph-mode-guard";

const FLOATING_SAVE_BUTTON_ID = "canvas-floating-toolbar-button-save-blueprint";
const RIGHT_DOCK_SAVE_BUTTON_ID = "canvas-right-dock-toolbar-button-save-blueprint";

export function createHypergryphSaveBlueprintGestureModule(): GestureMappingModule<AppHost> {
  return {
    id: "hypergryph-save-blueprint-gesture",
    when: isHypergryphGestureEnabled,
    handle(event, context) {
      const activeTool = context.appHost.internalState.activeTool;

      if (!canSaveBlueprintFromTool(activeTool) || !canSaveSelectionAsBlueprint(context.workspace)) {
        return { status: "ignored" };
      }

      switch (event.type) {
        case "key down":
          if (!context.appHost.internalActions.isShortcutFor(
            SHORTCUT_KEY.SAVE_BLUEPRINT,
            event.code,
            event.key,
            event.modifiers,
          )) {
            return { status: "ignored" };
          }

          context.appHost.saveBlueprintDialog.openSelection();
          return { status: "handled" };

        case "ui-button-touch-tap":
          return isSaveBlueprintButton(event.uiButtonId)
            ? openSaveBlueprintDialog(context.appHost)
            : { status: "ignored" };

        case "ui-button-mouse-tap":
          if (event.button !== 0 || !isSaveBlueprintButton(event.uiButtonId)) {
            return { status: "ignored" };
          }

          return openSaveBlueprintDialog(context.appHost);

        default:
          return { status: "ignored" };
      }
    },
  };
}

function canSaveBlueprintFromTool(activeTool: AppHost["internalState"]["activeTool"]): boolean {
  return activeTool === "select" || activeTool === "marquee";
}

function isSaveBlueprintButton(uiButtonId: string): boolean {
  return uiButtonId === FLOATING_SAVE_BUTTON_ID || uiButtonId === RIGHT_DOCK_SAVE_BUTTON_ID;
}

function openSaveBlueprintDialog(appHost: AppHost): GestureHandleResult {
  appHost.saveBlueprintDialog.openSelection();
  return { status: "handled" };
}
