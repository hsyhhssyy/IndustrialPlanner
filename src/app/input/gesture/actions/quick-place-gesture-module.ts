import { SHORTCUT_KEY } from "@/app/actions/keyboard-shortcut-manager";
import type { AppHost } from "@/app/host/app-host";
import type { GesturePosition } from "@/app/input/gesture/adapter";
import { runInAction } from "mobx";
import type { GestureActionContext, GestureMappingModule } from "./types";

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

      if (event.type === "mouse double tap" || event.type === "touch double tap") {
        if (
          event.pointerEntity !== null
          || event.longPress
          || hasActiveModifier(event.modifiers)
          || (event.type === "mouse double tap" && event.button !== 0)
        ) {
          return { status: "ignored" };
        }

        if (tryOpenQuickPlaceAt(context, event.position)) {
          return { status: "handled", consume: true };
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

      const matches = context.appHost.internalActions.isShortcutFor(
        SHORTCUT_KEY.QUICK_PLACE,
        event.code,
        event.key,
        event.modifiers,
      );
      if (!matches) {
        return { status: "ignored" };
      }

      if (!tryOpenQuickPlaceAt(context, lastMousePosition)) {
        return { status: "ignored" };
      }

      return { status: "handled", consume: true };
    },
  };
}

// AI-REMOVED 2026-07-12:
// Reason: 快速放置打开条件从快捷键分支内联逻辑抽取为公共函数，供快捷键和空白双击共同复用。
// Trigger: 新增选择模式下空白双击 / double tap 触发快速放置，需要与快捷键保持完全一致的 select、enabled、grid 命中条件。
// Evidence: createQuickPlaceGestureModule 中快捷键路径和 double tap 路径均调用 tryOpenQuickPlaceAt。
// Replacement: tryOpenQuickPlaceAt in this file
// Risk: Low
// Human Review: Required
//
// Original code:
// if (
//   context.appHost.internalState.activeTool !== "select"
//   || !context.appHost.internalState.settings.quickPlaceEnabled
// ) {
//   return { status: "ignored" };
// }
//
// const editor = context.workspace.editor;
// if (
//   editor === null
//   || lastMousePosition === null
//   || editor.queries.findGridCellForClientPixelPoint(lastMousePosition) === null
// ) {
//   return { status: "ignored" };
// }
//
// runInAction(() => {
//   context.appHost.internalState.runtime.quickPlace.visible = true;
//   context.appHost.internalState.runtime.quickPlace.anchor = lastMousePosition;
//   context.appHost.internalState.runtime.quickPlace.searchQuery = "";
// });
function tryOpenQuickPlaceAt(
  context: GestureActionContext<AppHost>,
  position: GesturePosition | null,
): boolean {
  if (
    context.appHost.internalState.activeTool !== "select"
    || !context.appHost.internalState.settings.quickPlaceEnabled
  ) {
    return false;
  }

  const editor = context.workspace.editor;
  if (
    editor === null
    || position === null
    || editor.queries.findGridCellForClientPixelPoint(position) === null
  ) {
    return false;
  }

  runInAction(() => {
    context.appHost.internalState.runtime.quickPlace.visible = true;
    context.appHost.internalState.runtime.quickPlace.anchor = position;
    context.appHost.internalState.runtime.quickPlace.searchQuery = "";
  });

  return true;
}

function closeQuickPlace(appHost: AppHost): void {
  runInAction(() => {
    appHost.internalState.runtime.quickPlace.visible = false;
    appHost.internalState.runtime.quickPlace.anchor = null;
    appHost.internalState.runtime.quickPlace.searchQuery = "";
  });
}

function hasActiveModifier(modifiers: {
  readonly alt: boolean;
  readonly ctrl: boolean;
  readonly meta: boolean;
  readonly shift: boolean;
}): boolean {
  return modifiers.alt || modifiers.ctrl || modifiers.meta || modifiers.shift;
}
