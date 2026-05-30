import type { AppHost } from "@/app/host/app-host";
import type { GesturePosition } from "@/app/input/gesture/adapter";
import { canCurrentBaseAcceptWulingOnlyEntities } from "@/app/placement-zone-availability";
import type { EditorContract } from "@/domain/editor/editor-contract";
import {
  EntityCollectionType,
  type MarqueeCollectionType,
} from "@/domain/editor/types/editor-types";
import type { GridPoint, GridRect } from "@/domain/shared/grid";

import type { GestureHandleResult, GestureMappingModule } from "../types";
import { isHypergryphGestureEnabled } from "./hypergryph-mode-guard";

const MARQUEE_RIGHT_DOCK_BUTTON_IDS = [
  "canvas-right-dock-toolbar-button-exit",
  "canvas-right-dock-toolbar-button-move",
  "canvas-right-dock-toolbar-button-save-blueprint",
  "canvas-right-dock-toolbar-button-delete",
] as const;

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
          return { status: "handled" };

        case "key down":
          if (event.code === "Escape" && context.appHost.internalState.activeTool === "marquee") {
            exitMarqueeToSelect(context.appHost, editor);
            return { status: "handled" };
          }

          if (event.code !== "KeyX") {
            return { status: "ignored" };
          }

          if (context.appHost.internalState.activeTool === "marquee") {
            exitMarqueeToSelect(context.appHost, editor);
            return { status: "handled" };
          }

          enterMarqueeMode({
            appHost: context.appHost,
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

        case "mouse tap":
          if (context.appHost.internalState.activeTool !== "marquee") {
            return { status: "ignored" };
          }

          if (event.button === 2) {
            exitMarqueeToSelect(context.appHost, editor);
            return { status: "handled" };
          }

          if (event.button === 0 && editor !== null && event.pointerEntity !== null) {
            toggleEntityInSelection(editor, event.pointerEntity.id);
            return { status: "handled" };
          }

          return { status: "ignored" };

        case "touch tap":
          if (context.appHost.internalState.activeTool !== "marquee") {
            return { status: "ignored" };
          }

          if (editor !== null && event.pointerEntity !== null) {
            toggleEntityInSelection(editor, event.pointerEntity.id);
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
              source: "mouse",
            });
          }

          if (context.appHost.internalState.activeTool !== "marquee") {
            return { status: "ignored" };
          }

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
      options.appHost.workspace.editor?.actions.setLogisticsSuppression("pipe", true);
      return { status: "handled" };

    case TOGGLE_PIPE_OFF:
      options.appHost.workspace.editor?.actions.setLogisticsSuppression("pipe", false);
      return { status: "handled" };

    case TOGGLE_BELT_ON:
      options.appHost.workspace.editor?.actions.setLogisticsSuppression("belt", true);
      return { status: "handled" };

    case TOGGLE_BELT_OFF:
      options.appHost.workspace.editor?.actions.setLogisticsSuppression("belt", false);
      return { status: "handled" };

    default:
      return { status: "ignored" };
  }
}

function enterMarqueeMode(options: {
  appHost: AppHost;
  source: "mouse" | "touch";
}): void {
  options.appHost.internalActions.setActiveTool("marquee");
  // options.appHost.workspace.editor?.actions.clearCollection(EntityCollectionType.selection);

  if (options.source === "touch") {
    options.appHost.internalActions.showCanvasRightDockToolbar(MARQUEE_RIGHT_DOCK_BUTTON_IDS);
    if (options.appHost.internalState.workbench.rightDockOpen) {
      options.appHost.internalActions.toggleRightDock();
    }
  } else {
    options.appHost.internalActions.showCanvasRightDockToolbar(
      MARQUEE_RIGHT_DOCK_BUTTON_IDS,
      "shortcut",
    );
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
  if (
    (deviceClass !== "mobile" && deviceClass !== "tablet")
    || !appHost.state.workbench.leftDockOpen
  ) {
    return;
  }

  appHost.internalActions.toggleLeftDock();
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
  const anchor = options.editor.queries.findGridCellForClientPixlePoint(options.position);
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
  const currentPoint = options.editor.queries.findGridCellForClientPixlePoint(options.position);
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
  appHost.internalState.runtime.marqueeAnchor = null;
  appHost.internalState.toolInfo.marqueeType = EntityCollectionType.marquee;
  appHost.internalActions.hideCanvasRightDockToolbar();
}

function toggleEntityInSelection(editor: EditorContract, entityId: string): void {
  if (editor.state.collections.selection.contains(entityId)) {
    editor.actions.removeFromCollection({
      collectionType: EntityCollectionType.selection,
      entityId,
    });
  } else {
    editor.actions.addToCollection({
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
