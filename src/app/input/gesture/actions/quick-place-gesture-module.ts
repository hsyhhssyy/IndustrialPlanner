import { SHORTCUT_KEY } from "@/app/actions/keyboard-shortcut-manager";
import type { AppHost } from "@/app/host/app-host";
import type { GesturePosition } from "@/app/input/gesture/adapter";
import { runInAction } from "mobx";
import type { GestureMappingModule } from "./types";

export function createQuickPlaceGestureModule(): GestureMappingModule<AppHost> {
  let lastMousePosition: GesturePosition | null = null;

  return {
    id: "quick-place-shortcut",
    handle(event, context) {
      if (event.type === "mouse move") {
        lastMousePosition = event.position;
        return { status: "ignored" };
      }

      if (event.type === "on-exit-active-tool") {
        if (context.appHost.internalState.runtime.quickPlace.visible) {
          closeQuickPlace(context.appHost);
          return { status: "handled" };
        }

        return { status: "ignored" };
      }

      if (event.type !== "key down") {
        return { status: "ignored" };
      }

      if (context.appHost.internalState.runtime.quickPlace.visible && event.code === "Escape") {
        closeQuickPlace(context.appHost);
        return { status: "handled", consume: true };
      }

      if (
        context.appHost.internalState.activeTool !== "select"
        || !context.appHost.internalState.settings.quickPlaceEnabled
      ) {
        return { status: "ignored" };
      }

      const matches = context.appHost.internalActions.isShortcutFor(
        SHORTCUT_KEY.QUICK_PLACE,
        event.code,
        event.key,
        event.modifiers,
      );
      if (!matches) {
        return { status: "ignored" };
      }

      const editor = context.workspace.editor;
      if (
        editor === null
        || lastMousePosition === null
        || editor.queries.findGridCellForClientPixelPoint(lastMousePosition) === null
      ) {
        return { status: "ignored" };
      }

      runInAction(() => {
        context.appHost.internalState.runtime.quickPlace.visible = true;
        context.appHost.internalState.runtime.quickPlace.anchor = lastMousePosition;
        context.appHost.internalState.runtime.quickPlace.searchQuery = "";
      });

      return { status: "handled", consume: true };
    },
  };
}

function closeQuickPlace(appHost: AppHost): void {
  runInAction(() => {
    appHost.internalState.runtime.quickPlace.visible = false;
    appHost.internalState.runtime.quickPlace.anchor = null;
    appHost.internalState.runtime.quickPlace.searchQuery = "";
  });
}
