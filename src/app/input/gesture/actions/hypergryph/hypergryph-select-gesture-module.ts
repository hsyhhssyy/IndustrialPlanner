import { SHORTCUT_KEY } from "@/app/actions/keyboard-shortcut-manager";
import type { AppHost } from "@/app/host/app-host";
import type { CanvasFloatingToolbarButtonId } from "@/app/state/state-impl";
import { EntityCollectionType } from "@/domain/state/types";

import type { GestureMappingModule } from "../types";
import { isHypergryphGestureEnabled } from "./hypergryph-mode-guard";

const SELECT_FLOATING_TOOLBAR_BUTTON_IDS = [
  "canvas-floating-toolbar-button-move",
  "canvas-floating-toolbar-button-delete",
] as const satisfies readonly CanvasFloatingToolbarButtonId[];

const SELECT_STRICT_LOGISTICS_FLOATING_TOOLBAR_BUTTON_IDS = [
  ...SELECT_FLOATING_TOOLBAR_BUTTON_IDS,
  "canvas-floating-toolbar-button-delete-many",
] as const satisfies readonly CanvasFloatingToolbarButtonId[];

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

        restoreSelectionToolbar(context.appHost);
        return { status: "handled" };
      }

      const editor = context.workspace.editor;
      if (editor === null || context.appHost.internalState.activeTool !== "select") {
        return { status: "ignored" };
      }

      const selectEntity = (options: {
        entityId: string;
        definitionId: string;
      }) => {
        const selection = editor.state.collections.selection;

        if (selection.length === 1 && selection.contains(options.entityId)) {
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

        context.appHost.internalActions.setRightDockActiveTab("selection");
        if (!context.appHost.internalState.workbench.rightDockOpen) {
          context.appHost.internalActions.toggleRightDock();
        }

        context.appHost.internalActions.showCanvasFloatingToolbarForCollection(
          resolveSelectionToolbarButtonIds(
            context.workspace.registry.queries.isDedicatedLogisticsDevice(options.definitionId),
          ),
          EntityCollectionType.selection,
        );
      };

      const clearSelection = () => {
        editor.actions.clearCollection(EntityCollectionType.selection);
        context.appHost.internalActions.hideCanvasFloatingToolbar();
      };

      switch (event.type) {
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

function restoreSelectionToolbar(appHost: AppHost): void {
  const editor = appHost.workspace.editor;
  if (editor === null) {
    return;
  }

  const selection = editor.state.collections.selection;
  if (selection.length === 0) {
    return;
  }

  const shouldShowDeleteMany = [...selection].every((entityId) => {
    const entity = editor.queries.getEntityById(entityId);

    return (
      entity !== null
      && appHost.workspace.registry.queries.isDedicatedLogisticsDevice(entity.definitionId)
    );
  });

  appHost.internalActions.showCanvasFloatingToolbarForCollection(
    resolveSelectionToolbarButtonIds(shouldShowDeleteMany),
    EntityCollectionType.selection,
  );
}

function resolveSelectionToolbarButtonIds(
  isDedicatedLogisticsDevice: boolean,
): readonly CanvasFloatingToolbarButtonId[] {
  return isDedicatedLogisticsDevice
    ? SELECT_STRICT_LOGISTICS_FLOATING_TOOLBAR_BUTTON_IDS
    : SELECT_FLOATING_TOOLBAR_BUTTON_IDS;
}