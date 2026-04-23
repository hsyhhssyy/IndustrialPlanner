import type { AppHost } from "@/app/app-host";
import type {
  GestureEvent,
  GesturePosition,
} from "@/app/input/gesture-adapter";
import type { GestureMappingModule } from "@/app/input/gesture-actions";

export function createMouseViewportPanModule(): GestureMappingModule<AppHost> {
  return {
    id: "app.mouse-viewport-pan",
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

          editor.actions.moveViewportByViewportPixelVector({
            startViewportPixel: resolveViewportPixelPoint(
              event.startPosition,
              editor.state.viewport.clientRect,
            ),
            endViewportPixel: resolveViewportPixelPoint(
              event.position,
              editor.state.viewport.clientRect,
            ),
          });

          return { status: "handled" };
        }

        case "mouse dragmove": {
          if (event.originButton !== 1) {
            return { status: "ignored" };
          }

          editor.actions.moveViewportByViewportPixelVector({
            startViewportPixel: resolveViewportPixelPoint(
              {
                x: event.position.x - event.delta.x,
                y: event.position.y - event.delta.y,
              },
              editor.state.viewport.clientRect,
            ),
            endViewportPixel: resolveViewportPixelPoint(
              event.position,
              editor.state.viewport.clientRect,
            ),
          });

          return { status: "handled" };
        }

        case "mouse dragend":
          return event.originButton === 1
            ? { status: "handled" }
            : { status: "ignored" };

        default:
          return { status: "ignored" };
      }
    },
  };
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