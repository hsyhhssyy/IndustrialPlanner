import type { AppHost } from "@/app/host/app-host";
import type { GesturePosition } from "@/app/input/gesture/adapter";
import { SHORTCUT_KEY } from "@/app/actions/keyboard-shortcut-manager";
import { canCurrentBaseAcceptWulingOnlyEntities } from "@/app/placement-zone-availability";
import type { WorldEntity } from "@/domain/document/world-document";
import type { EditorContract } from "@/domain/editor/editor-contract";
import {
  EntityCollectionType,
  type MarqueeCollectionType,
} from "@/domain/editor/types/editor-types";
import type { GridPoint, GridRect } from "@/domain/shared/grid";
import { LOGISTICS_KIND } from "@/domain/shared/logistics";
import { collectConnectedStrictLogisticsEntityIds } from "@/shared/transport-component";

import type { GestureHandleResult, GestureMappingModule } from "../types";
import { isHypergryphGestureEnabled } from "./hypergryph-mode-guard";
import { openOverlapEntityMenuIfNeeded } from "./overlap-entity-candidates";

const MARQUEE_RIGHT_DOCK_OPERATION_IDS = [
  "exit",
  "move",
  "copy",
  "save-blueprint",
  "delete",
] as const;

const EMPTY_MARQUEE_RIGHT_DOCK_OPERATION_IDS = [
  "exit",
] as const;

// AI-REMOVED 2026-08-22:
// Reason: 框选手势现在声明功能与本次 presentation，不再直接声明按钮 ID。
// Trigger: 用户要求呼起方只决定展示按钮、快捷键或两者。
// Evidence: showMarqueeRightDockToolbar 将 operationIds 映射为逐项请求。
// Replacement: MARQUEE_RIGHT_DOCK_OPERATION_IDS 与 EMPTY_MARQUEE_RIGHT_DOCK_OPERATION_IDS。
// Risk: Low
// Human Review: Required
//
// Original code:
// const MARQUEE_RIGHT_DOCK_BUTTON_IDS = [
//   "canvas-right-dock-toolbar-button-exit",
//   "canvas-right-dock-toolbar-button-move",
//   "canvas-right-dock-toolbar-button-copy",
//   "canvas-right-dock-toolbar-button-save-blueprint",
//   "canvas-right-dock-toolbar-button-delete",
// ] as const;
//
// const EMPTY_MARQUEE_RIGHT_DOCK_BUTTON_IDS = [
//   "canvas-right-dock-toolbar-button-exit",
// ] as const;

const MARQUEE_TOP_LEFT_BUTTON_IDS = [
  "canvas-top-left-corner-toolbar-button-toggle-pipe",
  "canvas-top-left-corner-toolbar-button-toggle-belt",
  "canvas-top-left-corner-toolbar-button-toggle-reverse-marquee",
] as const;

const TOGGLE_REVERSE_MARQUEE_ON =
  "canvas-top-left-corner-toolbar-button-toggle-reverse-marquee-on";
const TOGGLE_REVERSE_MARQUEE_OFF =
  "canvas-top-left-corner-toolbar-button-toggle-reverse-marquee-off";
const TOGGLE_PIPE_ON = "canvas-top-left-corner-toolbar-button-toggle-pipe-on";
const TOGGLE_PIPE_OFF = "canvas-top-left-corner-toolbar-button-toggle-pipe-off";
const TOGGLE_BELT_ON = "canvas-top-left-corner-toolbar-button-toggle-belt-on";
const TOGGLE_BELT_OFF = "canvas-top-left-corner-toolbar-button-toggle-belt-off";

export function createHypergryphMarqueeGestureModule(): GestureMappingModule<AppHost> {
  return {
    id: "hypergryph-marquee-gesture",
    when: isHypergryphGestureEnabled,
    acceptsLongPress(context, gridHasEntity) {
      const tool = context.appHost.internalState.activeTool;
      if (tool === "marquee") {
        return true;
      }

      if (
        tool === "select"
        && context.appHost.state.settings.hypergryphImmediateMarquee
        && !gridHasEntity
      ) {
        return true;
      }

      return false;
    },
    handle(event, context) {
      const editor = context.workspace.editor;

      switch (event.type) {
        case "on-enter-active-tool":
          if (event.to !== "marquee") {
            return { status: "ignored" };
          }

          closeCompactLeftDockOnMarqueeEnter(context.appHost);
          return { status: "handled" };

        case "on-exit-active-tool":
          if (event.from !== "marquee" || event.to === "marquee") {
            return { status: "ignored" };
          }

          cleanupMarquee(context.appHost, editor, event.to === "move");
          if (event.to !== "logistics-placement") {
            context.appHost.internalActions.hideCanvasTopLeftCornerToolbar();
          }
          if (event.to === "select") {
            context.appHost.internalActions.setLeftDockSuppressed(false);
          }
          return { status: "handled" };

        case "key down":
          if (event.code === "Escape" && context.appHost.internalState.activeTool === "marquee") {
            exitMarqueeToSelect(context.appHost, editor);
            return { status: "handled" };
          }

          if (!context.appHost.internalActions.isShortcutFor(
            SHORTCUT_KEY.MARQUEE,
            event.code,
            event.key,
            event.modifiers,
          )) {
            return { status: "ignored" };
          }

          if (context.appHost.internalState.activeTool === "marquee") {
            exitMarqueeToSelect(context.appHost, editor);
            return { status: "handled" };
          }

          enterMarqueeMode({
            appHost: context.appHost,
            editor,
            source: "mouse",
          });
          return { status: "handled" };

        case "ui-button-touch-tap":
          return handleUiButtonTap({
            appHost: context.appHost,
            editor,
            uiButtonId: event.uiButtonId,
            source: "touch",
          });

        case "ui-button-mouse-tap":
          if (event.button !== 0) {
            return { status: "ignored" };
          }

          return handleUiButtonTap({
            appHost: context.appHost,
            editor,
            uiButtonId: event.uiButtonId,
            source: "mouse",
          });

        case "mouse move":
          if (editor !== null) {
            editor.actions.setHoverPoint(event.position);
          }
          return { status: "handled", consume: false };

        case "mouse tap":
          if (context.appHost.internalState.activeTool !== "marquee") {
            return { status: "ignored" };
          }

          if (event.button === 2) {
            exitMarqueeToSelect(context.appHost, editor);
            return { status: "handled" };
          }

          if (event.button === 0 && editor !== null && event.pointerEntity !== null) {
            if (
              openOverlapEntityMenuIfNeeded({
                appHost: context.appHost,
                editor,
                position: event.position,
                pointerEntity: event.pointerEntity,
                onSelect: (entity) => {
                  toggleEntityOrStrictLogisticsSegmentInSelection({
                    appHost: context.appHost,
                    editor,
                    entity,
                  });
                  showMarqueeRightDockToolbar(context.appHost, editor);
                },
              })
            ) {
              return { status: "handled" };
            }

            toggleEntityOrStrictLogisticsSegmentInSelection({
              appHost: context.appHost,
              editor,
              entity: event.pointerEntity,
            });
            showMarqueeRightDockToolbar(context.appHost, editor);
            return { status: "handled" };
          }

          return { status: "ignored" };

        case "touch tap":
          if (context.appHost.internalState.activeTool !== "marquee") {
            return { status: "ignored" };
          }

          if (editor !== null && event.pointerEntity !== null) {
            if (
              openOverlapEntityMenuIfNeeded({
                appHost: context.appHost,
                editor,
                position: event.position,
                pointerEntity: event.pointerEntity,
                onSelect: (entity) => {
                  toggleEntityOrStrictLogisticsSegmentInSelection({
                    appHost: context.appHost,
                    editor,
                    entity,
                  });
                  showMarqueeRightDockToolbar(context.appHost, editor);
                },
              })
            ) {
              return { status: "handled" };
            }

            toggleEntityOrStrictLogisticsSegmentInSelection({
              appHost: context.appHost,
              editor,
              entity: event.pointerEntity,
            });
            showMarqueeRightDockToolbar(context.appHost, editor);
            return { status: "handled" };
          }

          return { status: "ignored" };

        case "mouse dragstart":
          if (editor === null) {
            return { status: "ignored" };
          }

          if (
            context.appHost.internalState.activeTool === "select"
            && context.appHost.state.settings.hypergryphImmediateMarquee
            && event.pointerEntity === null
            && event.originButton !== 1
          ) {
            enterMarqueeMode({
              appHost: context.appHost,
              editor,
              source: "mouse",
            });
          }

          if (context.appHost.internalState.activeTool !== "marquee") {
            return { status: "ignored" };
          }

          editor.actions.clearHoverPoint();
          return startMouseMarqueeDrag({
            appHost: context.appHost,
            editor,
            originButton: event.originButton,
            position: event.position,
          });

        case "touch dragstart":
          if (
            editor === null
            || !event.longPress
          ) {
            return { status: "ignored" };
          }

          if (
            context.appHost.internalState.activeTool === "select"
            && context.appHost.state.settings.hypergryphImmediateMarquee
            && event.pointerEntity === null
          ) {
            enterMarqueeMode({
              appHost: context.appHost,
              editor,
              source: "touch",
            });
          }

          if (context.appHost.internalState.activeTool !== "marquee") {
            return { status: "ignored" };
          }

          return startMarqueeDrag({
            appHost: context.appHost,
            editor,
            position: event.position,
            marqueeType: context.appHost.state.toolInfo.marqueeType,
          });

        case "mouse dragmove":
        case "touch dragmove":
          if (
            editor === null
            || context.appHost.internalState.activeTool !== "marquee"
            || context.appHost.internalState.runtime.marqueeAnchor === null
          ) {
            return { status: "ignored" };
          }

          return updateMarqueeRange({
            appHost: context.appHost,
            editor,
            position: event.position,
          });

        case "mouse dragend":
        case "touch dragend":
          if (
            editor === null
            || context.appHost.internalState.activeTool !== "marquee"
            || context.appHost.internalState.runtime.marqueeAnchor === null
          ) {
            return { status: "ignored" };
          }

          editor.actions.applyMarquee();
          context.appHost.internalState.runtime.marqueeAnchor = null;
          editor.actions.setHoverPoint(event.position);
          showMarqueeRightDockToolbar(context.appHost, editor);
          return { status: "handled" };

        default:
          return { status: "ignored" };
      }
    },
  };
}

function handleUiButtonTap(options: {
  appHost: AppHost;
  editor: EditorContract | null;
  uiButtonId: string;
  source: "mouse" | "touch";
}): GestureHandleResult {
  switch (options.uiButtonId) {
    case "placement-tool-marquee":
      enterMarqueeMode({
        appHost: options.appHost,
        editor: options.editor,
        source: options.source,
      });
      return { status: "handled" };

    case "canvas-right-dock-toolbar-button-exit":
      if (options.appHost.internalState.activeTool !== "marquee") {
        return { status: "ignored" };
      }

      exitMarqueeToSelect(options.appHost, options.editor);
      return { status: "handled" };

    case TOGGLE_REVERSE_MARQUEE_ON:
      if (options.appHost.internalState.activeTool !== "marquee") {
        return { status: "ignored" };
      }

      options.appHost.internalState.toolInfo.marqueeType = EntityCollectionType.reverseMarquee;
      return { status: "handled" };

    case TOGGLE_REVERSE_MARQUEE_OFF:
      if (options.appHost.internalState.activeTool !== "marquee") {
        return { status: "ignored" };
      }

      options.appHost.internalState.toolInfo.marqueeType = EntityCollectionType.marquee;
      return { status: "handled" };

    case TOGGLE_PIPE_ON:
      options.appHost.workspace.editor?.actions.setLogisticsSuppression(LOGISTICS_KIND.pipe, true);
      return { status: "handled" };

    case TOGGLE_PIPE_OFF:
      options.appHost.workspace.editor?.actions.setLogisticsSuppression(LOGISTICS_KIND.pipe, false);
      return { status: "handled" };

    case TOGGLE_BELT_ON:
      options.appHost.workspace.editor?.actions.setLogisticsSuppression(LOGISTICS_KIND.belt, true);
      return { status: "handled" };

    case TOGGLE_BELT_OFF:
      options.appHost.workspace.editor?.actions.setLogisticsSuppression(LOGISTICS_KIND.belt, false);
      return { status: "handled" };

    default:
      return { status: "ignored" };
  }
}

function enterMarqueeMode(options: {
  appHost: AppHost;
  editor: EditorContract | null;
  source: "mouse" | "touch";
}): void {
  const wasMarquee = options.appHost.internalState.activeTool === "marquee";
  options.appHost.internalActions.setActiveTool("marquee");
  // options.appHost.workspace.editor?.actions.clearCollection(EntityCollectionType.selection);
  if (!wasMarquee) {
    resetMarqueeLogisticsSuppression(options.editor);
  }

  if (options.source === "touch") {
    showMarqueeRightDockToolbar(options.appHost, options.editor, "button");
    if (options.appHost.internalState.workbench.rightDockOpen) {
      options.appHost.internalActions.toggleRightDock();
    }
  } else {
    showMarqueeRightDockToolbar(options.appHost, options.editor, "shortcut");
  }
  options.appHost.internalActions.showCanvasTopLeftCornerToolbar(
    resolveMarqueeTopLeftButtonIds(options.appHost),
  );
}

function resolveMarqueeTopLeftButtonIds(appHost: AppHost) {
  return MARQUEE_TOP_LEFT_BUTTON_IDS.filter((buttonId) => {
    if (buttonId === "canvas-top-left-corner-toolbar-button-toggle-pipe") {
      return canCurrentBaseAcceptWulingOnlyEntities(appHost);
    }
    return true;
  });
}

function closeCompactLeftDockOnMarqueeEnter(appHost: AppHost): void {
  const deviceClass = appHost.state.screenProfile.deviceClass;
  if (deviceClass !== "mobile" && deviceClass !== "tablet") {
    return;
  }

  appHost.internalActions.setLeftDockSuppressed(true);
}

function startMouseMarqueeDrag(options: {
  appHost: AppHost;
  editor: EditorContract;
  originButton: number;
  position: GesturePosition;
}): GestureHandleResult {
  if (options.originButton === 1) {
    return { status: "ignored" };
  }

  if (options.originButton !== 0 && options.originButton !== 2) {
    return { status: "ignored" };
  }

  return startMarqueeDrag({
    appHost: options.appHost,
    editor: options.editor,
    position: options.position,
    marqueeType: options.originButton === 2
      ? EntityCollectionType.reverseMarquee
      : EntityCollectionType.marquee,
  });
}

function startMarqueeDrag(options: {
  appHost: AppHost;
  editor: EditorContract;
  position: GesturePosition;
  marqueeType: MarqueeCollectionType;
}): GestureHandleResult {
  const anchor = options.editor.queries.findGridCellForClientPixelPoint(options.position);
  if (anchor === null) {
    return { status: "ignored" };
  }

  options.appHost.internalState.runtime.marqueeAnchor = anchor;
  options.appHost.internalState.toolInfo.marqueeType = options.marqueeType;
  options.editor.actions.setMarqueeRange(
    options.marqueeType,
    resolveGridRectFromPoints(anchor, anchor),
  );
  return { status: "handled" };
}

function updateMarqueeRange(options: {
  appHost: AppHost;
  editor: EditorContract;
  position: GesturePosition;
}): GestureHandleResult {
  const anchor = options.appHost.internalState.runtime.marqueeAnchor;
  const currentPoint = options.editor.queries.findGridCellForClientPixelPoint(options.position);
  if (anchor === null || currentPoint === null) {
    return { status: "ignored" };
  }

  options.editor.actions.setMarqueeRange(
    options.appHost.state.toolInfo.marqueeType,
    resolveGridRectFromPoints(anchor, currentPoint),
  );
  return { status: "handled" };
}

function exitMarqueeToSelect(appHost: AppHost, editor: EditorContract | null): void {
  cleanupMarquee(appHost, editor);
  appHost.internalActions.hideCanvasTopLeftCornerToolbar();
  appHost.internalActions.setActiveTool("select");
}

export function cleanupMarquee(appHost: AppHost, editor: EditorContract | null, skipClearSelection = false): void {
  editor?.actions.cancelMarquee();
  if (!skipClearSelection) {
    editor?.actions.clearCollection(EntityCollectionType.selection);
  }
  resetMarqueeLogisticsSuppression(editor);
  appHost.internalState.runtime.marqueeAnchor = null;
  appHost.internalState.toolInfo.marqueeType = EntityCollectionType.marquee;
  appHost.internalActions.hideCanvasRightDockToolbar();
}

function resetMarqueeLogisticsSuppression(editor: EditorContract | null): void {
  editor?.actions.setLogisticsSuppression(LOGISTICS_KIND.belt, false);
  editor?.actions.setLogisticsSuppression(LOGISTICS_KIND.pipe, false);
}

export function showMarqueeRightDockToolbar(
  appHost: AppHost,
  editor: EditorContract | null,
  presentation = appHost.internalState.runtime.canvasRightDockToolbar.items.find(
    (item) => item.operationId === "exit",
  )?.presentation ?? "button",
): void {
  const operationIds = (editor?.state.collections.selection?.length ?? 0) > 0
    ? MARQUEE_RIGHT_DOCK_OPERATION_IDS
    : EMPTY_MARQUEE_RIGHT_DOCK_OPERATION_IDS;

  appHost.internalActions.showCanvasRightDockToolbar(
    operationIds.map((operationId) => ({ operationId, presentation })),
  );
}

// AI-REMOVED 2026-08-22:
// Reason: 框选工具列刷新不再复用工具列级 mode，也不再传递按钮 ID。
// Trigger: presentation 已成为逐项展示请求。
// Evidence: 新实现从退出功能请求继承 presentation，并为每个 operationId 构造请求。
// Replacement: 上方 showMarqueeRightDockToolbar 实现。
// Risk: Low
// Human Review: Required
//
// Original code:
// export function showMarqueeRightDockToolbar(
//   appHost: AppHost,
//   editor: EditorContract | null,
//   mode = appHost.internalState.runtime.canvasRightDockToolbar.mode,
// ): void {
//   const buttonIds = (editor?.state.collections.selection?.length ?? 0) > 0
//     ? MARQUEE_RIGHT_DOCK_BUTTON_IDS
//     : EMPTY_MARQUEE_RIGHT_DOCK_BUTTON_IDS;
//
//   appHost.internalActions.showCanvasRightDockToolbar(buttonIds, mode);
// }

function toggleEntityOrStrictLogisticsSegmentInSelection(options: {
  appHost: AppHost;
  editor: EditorContract;
  entity: WorldEntity;
}): void {
  const entityIds = resolveStrictLogisticsSegmentSelectionIds(options);
  const shouldRemove = options.editor.state.collections.selection.contains(options.entity.id);

  for (const entityId of entityIds) {
    if (shouldRemove) {
      removeEntityFromSelection(options.editor, entityId);
    } else {
      addEntityToSelection(options.editor, entityId);
    }
  }
}

function resolveStrictLogisticsSegmentSelectionIds(options: {
  appHost: AppHost;
  editor: EditorContract;
  entity: WorldEntity;
}): readonly string[] {
  const registry = options.appHost.workspace.registry;
  if (!registry.queries.isDedicatedLogisticsDevice(options.entity.definitionId)) {
    return [options.entity.id];
  }

  const kind = registry.queries.resolveDedicatedLogisticsKind(options.entity.definitionId);
  if (kind === null) {
    return [options.entity.id];
  }

  const entityDefinitionMap = new Map(
    registry.entityDefinitions.map((definition) => [
      definition.id,
      definition,
    ]),
  );
  const segmentEntityIds = collectConnectedStrictLogisticsEntityIds({
    startEntityId: options.entity.id,
    startEntity: options.entity,
    kind,
    document: options.editor.document.getSnapshot(),
    entityDefinitionMap,
    isDedicatedLogisticsDevice: registry.queries.isDedicatedLogisticsDevice.bind(registry.queries),
    resolveDedicatedLogisticsKind: registry.queries.resolveDedicatedLogisticsKind.bind(registry.queries),
    directions: ["input", "output"],
  });

  return segmentEntityIds.size > 0 ? Array.from(segmentEntityIds) : [options.entity.id];
}

function addEntityToSelection(editor: EditorContract, entityId: string): void {
  if (editor.state.collections.selection.contains(entityId)) {
    return;
  }

  editor.actions.addToCollection({
    collectionType: EntityCollectionType.selection,
    entityId,
  });
}

function removeEntityFromSelection(editor: EditorContract, entityId: string): void {
  if (editor.state.collections.selection.contains(entityId)) {
    editor.actions.removeFromCollection({
      collectionType: EntityCollectionType.selection,
      entityId,
    });
  }
}

function resolveGridRectFromPoints(start: GridPoint, end: GridPoint): GridRect {
  const x = Math.min(start.x, end.x);
  const y = Math.min(start.y, end.y);

  return {
    x,
    y,
    width: Math.abs(end.x - start.x) + 1,
    height: Math.abs(end.y - start.y) + 1,
  };
}
