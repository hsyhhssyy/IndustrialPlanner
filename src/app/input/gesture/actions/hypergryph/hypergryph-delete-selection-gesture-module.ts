import { SHORTCUT_KEY } from "@/app/actions/keyboard-shortcut-manager";
import type { AppHost } from "@/app/host/app-host";
import type { EditorContract } from "@/domain/editor/editor-contract";
import { EntityCollectionType } from "@/domain/editor/types/editor-types";

import type { GestureHandleResult, GestureMappingModule } from "../types";
import { isHypergryphGestureEnabled } from "./hypergryph-mode-guard";
import { showMarqueeRightDockToolbar } from "./hypergryph-marquee-gesture-module";

const FLOATING_DELETE_BUTTON_ID = "canvas-floating-toolbar-button-delete";
const FLOATING_DELETE_MANY_BUTTON_ID = "canvas-floating-toolbar-button-delete-many";
const FLOATING_DELETE_UPSTREAM_BUTTON_ID = "canvas-floating-toolbar-button-delete-upstream-segment";
const FLOATING_DELETE_DOWNSTREAM_BUTTON_ID = "canvas-floating-toolbar-button-delete-downstream-segment";
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
          if (event.uiButtonId === FLOATING_DELETE_UPSTREAM_BUTTON_ID) {
            return directionalDeleteStrictLogistics(editor, activeTool, context.appHost, "upstream");
          }
          if (event.uiButtonId === FLOATING_DELETE_DOWNSTREAM_BUTTON_ID) {
            return directionalDeleteStrictLogistics(editor, activeTool, context.appHost, "downstream");
          }
          if (event.uiButtonId === FLOATING_DELETE_MANY_BUTTON_ID) {
            return batchDeleteStrictLogistics(editor, activeTool, context.appHost);
          }
          return isDeleteSelectionButton(event.uiButtonId)
            ? deleteSelection(context.appHost, editor, activeTool)
            : { status: "ignored" };

        case "ui-button-mouse-tap":
          if (event.button !== 0) {
            return { status: "ignored" };
          }
          if (event.uiButtonId === FLOATING_DELETE_UPSTREAM_BUTTON_ID) {
            return directionalDeleteStrictLogistics(editor, activeTool, context.appHost, "upstream");
          }
          if (event.uiButtonId === FLOATING_DELETE_DOWNSTREAM_BUTTON_ID) {
            return directionalDeleteStrictLogistics(editor, activeTool, context.appHost, "downstream");
          }
          if (event.uiButtonId === FLOATING_DELETE_MANY_BUTTON_ID) {
            return batchDeleteStrictLogistics(editor, activeTool, context.appHost);
          }
          if (!isDeleteSelectionButton(event.uiButtonId)) {
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
  } else {
    showMarqueeRightDockToolbar(appHost, editor);
  }

  return { status: "handled" };
}

function batchDeleteStrictLogistics(
  editor: EditorContract,
  activeTool: AppHost["internalState"]["activeTool"],
  appHost: AppHost,
): GestureHandleResult {
  const selectionIds = [...editor.state.collections.selection];

  if (selectionIds.length === 0) {
    return { status: "ignored" };
  }

  for (const entityId of selectionIds) {
    editor.actions.removeTransportComponent(entityId);
  }

  if (activeTool === "select") {
    appHost.internalActions.hideCanvasFloatingToolbar();
    appHost.internalActions.hideCanvasRightDockToolbar();
  }

  return { status: "handled" };
}

function directionalDeleteStrictLogistics(
  editor: EditorContract,
  activeTool: AppHost["internalState"]["activeTool"],
  appHost: AppHost,
  direction: "upstream" | "downstream",
): GestureHandleResult {
  const selectionIds = [...editor.state.collections.selection];

  if (selectionIds.length === 0) {
    return { status: "ignored" };
  }

  for (const entityId of selectionIds) {
    if (direction === "upstream") {
      editor.actions.removeTransportComponentUpstream(entityId);
    } else {
      editor.actions.removeTransportComponentDownstream(entityId);
    }
  }

  if (activeTool === "select") {
    appHost.internalActions.hideCanvasFloatingToolbar();
    appHost.internalActions.hideCanvasRightDockToolbar();
  }

  return { status: "handled" };
}
