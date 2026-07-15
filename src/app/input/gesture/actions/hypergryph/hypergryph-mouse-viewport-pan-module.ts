import type { AppHost } from "@/app/host/app-host";
import type { GesturePosition } from "@/app/input/gesture/adapter";
import type { ActiveTool } from "@/domain/app/types/app-types";
import type { GestureMappingModule } from "../types";
import { isHypergryphGestureEnabled } from "./hypergryph-mode-guard";
import {
  nudgeMobilePreviewIntoSafeViewport,
} from "./mobile-preview-bounds";

export function createHypergryphMouseViewportPanModule(): GestureMappingModule<AppHost> {
  return {
    id: "hypergryph-mouse-viewport-pan",
    when: isHypergryphGestureEnabled,
    handle(event, context) {
      const editor = context.workspace.editor;
      if (editor === null) {
        return { status: "ignored" };
      }

      switch (event.type) {
        case "mouse dragstart": {
          if (!isMousePanButtonAllowed(context.appHost.internalState.activeTool, event.originButton)) {
            return { status: "ignored" };
          }

          moveViewport(editor, event.startPosition, event.position);
          nudgeMobilePreviewIntoSafeViewport({
            appHost: context.appHost,
            editor,
          });
          context.appHost.internalActions.alignCanvasFloatingToolbar();

          return { status: "handled" };
        }

        case "touch dragstart": {
          if (!canPanTouchDrag(
            context.appHost.internalState.activeTool,
            event.longPress,
          )) {
            return { status: "ignored" };
          }

          moveViewport(editor, event.startPosition, event.position);
          nudgeMobilePreviewIntoSafeViewport({
            appHost: context.appHost,
            editor,
          });
          context.appHost.internalActions.alignCanvasFloatingToolbar();

          return { status: "handled" };
        }

        case "mouse dragmove": {
          if (!isMousePanButtonAllowed(context.appHost.internalState.activeTool, event.originButton)) {
            return { status: "ignored" };
          }

          moveViewport(editor, {
            x: event.position.x - event.delta.x,
            y: event.position.y - event.delta.y,
          }, event.position);
          nudgeMobilePreviewIntoSafeViewport({
            appHost: context.appHost,
            editor,
          });
          context.appHost.internalActions.alignCanvasFloatingToolbar();

          return { status: "handled" };
        }

        case "touch dragmove": {
          if (!canPanTouchDrag(
            context.appHost.internalState.activeTool,
            event.longPress,
          )) {
            return { status: "ignored" };
          }

          moveViewport(editor, {
            x: event.position.x - event.delta.x,
            y: event.position.y - event.delta.y,
          }, event.position);
          nudgeMobilePreviewIntoSafeViewport({
            appHost: context.appHost,
            editor,
          });
          context.appHost.internalActions.alignCanvasFloatingToolbar();

          return { status: "handled" };
        }

        case "mouse dragend":
          return isMousePanButtonAllowed(context.appHost.internalState.activeTool, event.originButton)
            ? { status: "handled" }
            : { status: "ignored" };

        case "touch dragend":
          return canPanTouchDrag(
            context.appHost.internalState.activeTool,
            event.longPress,
          )
            ? { status: "handled" }
            : { status: "ignored" };

        default:
          return { status: "ignored" };
      }
    },
  };
}

function moveViewport(
  editor: NonNullable<AppHost["workspace"]["editor"]>,
  startPosition: GesturePosition,
  endPosition: GesturePosition,
): void {
  editor.actions.moveViewportByClientPixelVector({
    startClientPixel: startPosition,
    endClientPixel: endPosition,
  });
}

function isMousePanButtonAllowed(activeTool: ActiveTool, originButton: number): boolean {
  if (originButton === 1) {
    return true;
  }

  return (
    activeTool === "select"
    || activeTool === "logistics-placement"
    || activeTool === "dark-pipe-link"
  ) && originButton === 0;
}

function canPanTouchDrag(activeTool: ActiveTool, longPress: boolean): boolean {
  return !longPress
    || activeTool === "single-placement"
    || activeTool === "blueprint-placement";
}
