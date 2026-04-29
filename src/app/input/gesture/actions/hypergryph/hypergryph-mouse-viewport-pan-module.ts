import type { AppHost } from "@/app/host/app-host";
import type { GesturePosition } from "@/app/input/gesture/adapter";
import type { ActiveTool } from "@/app/state/state-impl";
import type { GestureMappingModule } from "../types";
import { isHypergryphGestureEnabled } from "./hypergryph-mode-guard";

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
          context.appHost.internalActions.alignCanvasFloatingToolbar();

          return { status: "handled" };
        }

        case "touch dragstart": {
          if (event.longPress) {
            return { status: "ignored" };
          }

          moveViewport(editor, event.startPosition, event.position);
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
          context.appHost.internalActions.alignCanvasFloatingToolbar();

          return { status: "handled" };
        }

        case "touch dragmove": {
          if (event.longPress) {
            return { status: "ignored" };
          }

          moveViewport(editor, {
            x: event.position.x - event.delta.x,
            y: event.position.y - event.delta.y,
          }, event.position);
          context.appHost.internalActions.alignCanvasFloatingToolbar();

          return { status: "handled" };
        }

        case "mouse dragend":
          return isMousePanButtonAllowed(context.appHost.internalState.activeTool, event.originButton)
            ? { status: "handled" }
            : { status: "ignored" };

        case "touch dragend":
          return event.longPress
            ? { status: "ignored" }
            : { status: "handled" };

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

  return activeTool === "select" && originButton === 0;
}
