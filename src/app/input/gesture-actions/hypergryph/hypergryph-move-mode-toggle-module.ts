import type { AppHost } from "@/app/app-host";
import type { GestureMappingModule } from "../types";
import { isHypergryphGestureEnabled } from "./hypergryph-mode-guard";

export function createHypergryphMoveModeToggleModule(): GestureMappingModule<AppHost> {
  return {
    id: "hypergryph-move-mode-toggle",
    when: isHypergryphGestureEnabled,
    handle(event, context) {
      switch (event.type) {
        case "mouse-long-press-ready":
        case "tap-long-press-ready":
          return tryEnterMoveMode(context.appHost, event.pointerEntity !== null);

        case "mouse tap":
          if (
            context.appHost.internalState.runtime.activeTool === "move"
            && event.button === 2
          ) {
            context.appHost.internalActions.setActiveTool("select");
            return { status: "handled" };
          }

          return tryEnterMoveMode(
            context.appHost,
            event.longPress && event.pointerEntity !== null,
          );

        case "touch tap":
          return tryEnterMoveMode(
            context.appHost,
            event.longPress && event.pointerEntity !== null,
          );

        case "mouse dragstart":
        case "touch dragstart":
          return tryEnterMoveMode(
            context.appHost,
            event.longPress && event.pointerEntity !== null,
          );

        default:
          return { status: "ignored" };
      }
    },
  };
}

function tryEnterMoveMode(
  appHost: AppHost,
  canEnterMoveMode: boolean,
): { readonly status: "ignored" | "handled" } {
  if (!canEnterMoveMode) {
    return { status: "ignored" };
  }

  appHost.internalActions.setActiveTool("move");
  return { status: "handled" };
}