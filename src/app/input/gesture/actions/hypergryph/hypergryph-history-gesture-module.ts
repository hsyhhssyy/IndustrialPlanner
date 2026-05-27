import { SHORTCUT_KEY } from "@/app/actions/keyboard-shortcut-manager";
import type { AppHost } from "@/app/host/app-host";

import type { GestureMappingModule } from "../types";
import { isHypergryphGestureEnabled } from "./hypergryph-mode-guard";

export function createHypergryphHistoryGestureModule(): GestureMappingModule<AppHost> {
  return {
    id: "hypergryph-history-gesture",
    when: isHypergryphGestureEnabled,
    handle(event, context) {
      const editor = context.workspace.editor;
      if (editor === null) {
        return { status: "ignored" };
      }

      if (event.type !== "key down") {
        return { status: "ignored" };
      }

      const { internalActions } = context.appHost;

      if (internalActions.isShortcutFor(
        SHORTCUT_KEY.UNDO,
        event.code,
        event.key,
        event.modifiers,
      )) {
        editor.actions.undoDocumentHistory();
        return { status: "handled", consume: true };
      }

      if (internalActions.isShortcutFor(
        SHORTCUT_KEY.REDO,
        event.code,
        event.key,
        event.modifiers,
      )) {
        editor.actions.redoDocumentHistory();
        return { status: "handled", consume: true };
      }

      return { status: "ignored" };
    },
  };
}
