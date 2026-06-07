import { SHORTCUT_KEY } from "@/app/actions/keyboard-shortcut-manager";
import type { AppHost } from "@/app/host/app-host";
import { EntityCollectionType } from "@/domain/editor/types/editor-types";

import type { GestureMappingModule } from "../types";
import { isHypergryphGestureEnabled } from "./hypergryph-mode-guard";

export function createHypergryphSelectGestureModule(): GestureMappingModule<AppHost> {
  return {
    id: "hypergryph-select-gesture",
    priority: 100,
    when: isHypergryphGestureEnabled,
    handle(event, context) {
      if (event.type === "key down") {
        if (!context.appHost.internalActions.isShortcutFor(
          SHORTCUT_KEY.RETURN_SELECT,
          event.code,
          event.key,
          event.modifiers,
        )) {
          return { status: "ignored" };
        }

        context.appHost.internalActions.setActiveTool("select");
        return { status: "handled" };
      }

      if (event.type === "ui-button-touch-tap" || event.type === "ui-button-mouse-tap") {
        if (event.uiButtonId !== "placement-tool-select") {
          return { status: "ignored" };
        }

        if (event.type === "ui-button-mouse-tap" && event.button !== 0) {
          return { status: "ignored" };
        }

        context.appHost.internalActions.setActiveTool("select");
        return { status: "handled" };
      }

      if (event.type === "on-exit-active-tool") {
        if (event.from !== "select" || event.to === "select") {
          return { status: "ignored" };
        }

        context.appHost.internalActions.hideCanvasFloatingToolbar();
        return { status: "handled" };
      }

      if (event.type === "on-enter-active-tool") {
        if (event.to !== "select") {
          return { status: "ignored" };
        }

        context.appHost.internalActions.hideCanvasFloatingToolbar();
        return { status: "handled" };
      }

      const editor = context.workspace.editor;
      if (editor === null || context.appHost.internalState.activeTool !== "select") {
        return { status: "ignored" };
      }

      const revealInspector = () => {
        if (context.appHost.state.settings.gameUseInspectorPanel) {
          context.appHost.internalActions.setRightDockActiveTab("selection");
          if (!context.appHost.internalState.workbench.rightDockOpen) {
            context.appHost.internalActions.toggleRightDock();
          }
          return;
        }

        context.appHost.internalActions.openDialog("inspector");
      };

      const selectEntity = (options: {
        entityId: string;
        definitionId: string;
      }) => {
        const selection = editor.state.collections.selection;
        const openInspectorOnSecondClick =
          context.appHost.state.settings.hypergryphInspectorOpenOnSecondClick;

        if (selection.length === 1 && selection.contains(options.entityId)) {
          if (openInspectorOnSecondClick) {
            revealInspector();
            return;
          }

          clearSelection();
          return;
        }

        if (!selection.contains(options.entityId)) {
          editor.actions.clearCollection(EntityCollectionType.selection);
        }

        editor.actions.addToCollection({
          collectionType: EntityCollectionType.selection,
          entityId: options.entityId,
        });

        if (
          context.appHost.state.settings.gameUseInspectorPanel
          && context.appHost.state.settings.hypergryphSelectionRightDockSync
          && !openInspectorOnSecondClick
        ) {
          context.appHost.internalActions.setRightDockActiveTab("selection");
          if (!context.appHost.internalState.workbench.rightDockOpen) {
            context.appHost.internalActions.toggleRightDock();
          }
        }
      };

      const clearSelection = () => {
        editor.actions.clearCollection(EntityCollectionType.selection);
        context.appHost.internalActions.hideCanvasFloatingToolbar();

        if (
          context.appHost.state.settings.gameUseInspectorPanel
          && context.appHost.internalState.workbench.rightDockOpen
        ) {
          context.appHost.internalActions.toggleRightDock();
        }
      };

      switch (event.type) {
        case "mouse move": {
          if (editor.state.collections.selection.length === 0) {
            editor.actions.setHoverPoint(event.position);
          } else {
            editor.actions.clearHoverPoint();
          }
          return { status: "handled", consume: false };
        }

        case "mouse tap":
          if (event.button === 2) {
            clearSelection();
            return { status: "handled" };
          }

          if (event.button !== 0 || event.pointerEntity === null) {
            return { status: "ignored" };
          }

          selectEntity({
            entityId: event.pointerEntity.id,
            definitionId: event.pointerEntity.definitionId,
          });
          return { status: "handled" };

        case "touch tap":
          if (event.pointerEntity === null) {
            return { status: "ignored" };
          }

          selectEntity({
            entityId: event.pointerEntity.id,
            definitionId: event.pointerEntity.definitionId,
          });
          return { status: "handled" };

        default:
          return { status: "ignored" };
      }
    },
  };
}