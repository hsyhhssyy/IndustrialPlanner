import type { AppHost } from "@/app/app-host";
import type { GesturePosition } from "@/app/input/gesture-adapter";
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
          if (event.originButton !== 1) {
            return { status: "ignored" };
          }

          moveViewport(editor, event.startPosition, event.position);

          return { status: "handled" };
        }

        case "touch dragstart": {
          if (event.longPress) {
            return { status: "ignored" };
          }

          moveViewport(editor, event.startPosition, event.position);

          return { status: "handled" };
        }

        case "mouse dragmove": {
          if (event.originButton !== 1) {
            return { status: "ignored" };
          }

          moveViewport(editor, {
            x: event.position.x - event.delta.x,
            y: event.position.y - event.delta.y,
          }, event.position);

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

          return { status: "handled" };
        }

        case "mouse dragend":
          return event.originButton === 1
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
  editor.actions.moveViewportByViewportPixelVector({
    startViewportPixel: resolveViewportPixelPoint(
      startPosition,
      editor.state.viewport.clientRect,
    ),
    endViewportPixel: resolveViewportPixelPoint(
      endPosition,
      editor.state.viewport.clientRect,
    ),
  });
}

function resolveViewportPixelPoint(
  position: GesturePosition,
  clientRect: {
    left: number;
    top: number;
  },
): GesturePosition {
  return {
    x: position.x - clientRect.left,
    y: position.y - clientRect.top,
  };
}