// AI-REMOVED 2026-08-03:
// Reason: 返回选择模式的 Escape 必须硬编码，不再读取可配置快捷键。
// Trigger: ST2-RQ-002 禁止任何快捷键绑定 Escape。
// Evidence: key down 分支已直接匹配 event.code / event.key。
// Replacement: createHypergryphSelectGestureModule 的 key down 分支。
// Risk: Low
// Human Review: Required
//
// Original code:
// import { SHORTCUT_KEY } from "@/app/actions/keyboard-shortcut-manager";
import type { AppHost } from "@/app/host/app-host";
import { EntityCollectionType } from "@/domain/editor/types/editor-types";

import type { GestureMappingModule } from "../types";
import { isHypergryphGestureEnabled } from "./hypergryph-mode-guard";
import { openOverlapEntityMenuIfNeeded } from "./overlap-entity-candidates";

export function createHypergryphSelectGestureModule(): GestureMappingModule<AppHost> {
  return {
    id: "hypergryph-select-gesture",
    priority: 100,
    when: isHypergryphGestureEnabled,
    handle(event, context) {
      if (event.type === "key down") {
        if (event.code !== "Escape" && event.key !== "Escape") {
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

          if (
            openOverlapEntityMenuIfNeeded({
              appHost: context.appHost,
              editor,
              position: event.position,
              pointerEntity: event.pointerEntity,
              onSelect: (entity) => {
                selectEntity({
                  entityId: entity.id,
                  definitionId: entity.definitionId,
                });
              },
            })
          ) {
            return { status: "handled" };
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

          if (
            openOverlapEntityMenuIfNeeded({
              appHost: context.appHost,
              editor,
              position: event.position,
              pointerEntity: event.pointerEntity,
              onSelect: (entity) => {
                selectEntity({
                  entityId: entity.id,
                  definitionId: entity.definitionId,
                });
              },
            })
          ) {
            return { status: "handled" };
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
