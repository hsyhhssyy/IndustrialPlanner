import { SHORTCUT_KEY } from "@/app/actions/keyboard-shortcut-manager";
import type { AppHost } from "@/app/host/app-host";
import type { EditorContract } from "@/domain/editor/editor-contract";
import { EntityCollectionType } from "@/domain/editor/types/editor-types";

import type { GestureHandleResult, GestureMappingModule } from "../types";
import { isHypergryphGestureEnabled } from "./hypergryph-mode-guard";

const FLOATING_DELETE_BUTTON_ID = "canvas-floating-toolbar-button-delete";
const RIGHT_DOCK_DELETE_BUTTON_ID = "canvas-right-dock-toolbar-button-delete";

export function createHypergryphDeleteSelectionGestureModule(): GestureMappingModule<AppHost> {
  return {
    id: "hypergryph-delete-selection-gesture",
    when: isHypergryphGestureEnabled,
    handle(event, context) {
      const editor = context.workspace.editor;
      const activeTool = context.appHost.internalState.activeTool;

      if (editor === null || !canDeleteSelectionFromTool(activeTool)) {
        return { status: "ignored" };
      }

      switch (event.type) {
        case "key down":
          if (!context.appHost.internalActions.isShortcutFor(
            SHORTCUT_KEY.DELETE_DEVICE,
            event.code,
            event.key,
            event.modifiers,
          )) {
            return { status: "ignored" };
          }

          return deleteSelection(context.appHost, editor, activeTool);

        case "ui-button-touch-tap":
          return isDeleteSelectionButton(event.uiButtonId)
            ? deleteSelection(context.appHost, editor, activeTool)
            : { status: "ignored" };

        case "ui-button-mouse-tap":
          if (event.button !== 0 || !isDeleteSelectionButton(event.uiButtonId)) {
            return { status: "ignored" };
          }

          return deleteSelection(context.appHost, editor, activeTool);

        default:
          return { status: "ignored" };
      }
    },
  };
}

function canDeleteSelectionFromTool(activeTool: AppHost["internalState"]["activeTool"]): boolean {
  return activeTool === "select" || activeTool === "marquee";
}

function isDeleteSelectionButton(uiButtonId: string): boolean {
  return uiButtonId === FLOATING_DELETE_BUTTON_ID || uiButtonId === RIGHT_DOCK_DELETE_BUTTON_ID;
}

function deleteSelection(
  appHost: AppHost,
  editor: EditorContract,
  activeTool: AppHost["internalState"]["activeTool"],
): GestureHandleResult {
  if (editor.state.collections.selection.length === 0) {
    return { status: "ignored" };
  }

  editor.actions.deleteCollection(EntityCollectionType.selection);

  if (activeTool === "select") {
    appHost.internalActions.hideCanvasFloatingToolbar();
    appHost.internalActions.hideCanvasRightDockToolbar();
  }

  return { status: "handled" };
}