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
    shortcutRoutes: [{
      id: "save-blueprint.selection",
      actionId: SHORTCUT_KEY.SAVE_BLUEPRINT,
      binding: { kind: "configurable", shortcutId: SHORTCUT_KEY.SAVE_BLUEPRINT },
      scope: { inputLayers: ["canvas"], activeTools: ["select", "marquee"] },
      triggerPolicy: { kind: "exact" },
      claimsBrowserDefault: true,
      handle(_event, context) {
        if (!canSaveSelectionAsBlueprint(context.workspace)) {
          return { status: "ignored" };
        }

        context.appHost.saveBlueprintDialog.openSelection();
        return { status: "handled" };
      },
    }],
    handle(event, context) {
      const activeTool = context.appHost.internalState.activeTool;

      if (!canSaveBlueprintFromTool(activeTool) || !canSaveSelectionAsBlueprint(context.workspace)) {
        return { status: "ignored" };
      }

      switch (event.type) {
        // AI-REMOVED 2026-08-30:
        // Reason: 保存蓝图快捷键由 save-blueprint.selection Route 统一匹配和执行。
        // Trigger: ST2-RQ-020 可执行 Shortcut Route 迁移。
        // Evidence: Route 作用域覆盖 select/marquee，并保留 canSaveSelectionAsBlueprint 瞬时条件。
        // Replacement: shortcutRoutes[save-blueprint.selection] in this module
        // Risk: Low
        // Human Review: Required
        //
        // Original code:
        // case "key down":
        //   if (!context.appHost.internalActions.isShortcutFor(
        //     SHORTCUT_KEY.SAVE_BLUEPRINT,
        //     event.code,
        //     event.key,
        //     event.modifiers,
        //   )) {
        //     return { status: "ignored" };
        //   }
        //   context.appHost.saveBlueprintDialog.openSelection();
        //   return { status: "handled" };

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
