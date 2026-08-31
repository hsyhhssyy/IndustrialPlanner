import { SHORTCUT_KEY } from "@/app/actions/keyboard-shortcut-manager";
import type { AppHost } from "@/app/host/app-host";

import type { GestureMappingModule } from "../types";
import { ALL_SHORTCUT_ACTIVE_TOOLS } from "../shortcut-route-matching";
import { isHypergryphGestureEnabled } from "./hypergryph-mode-guard";

export function createHypergryphHistoryGestureModule(): GestureMappingModule<AppHost> {
  return {
    id: "hypergryph-history-gesture",
    when: isHypergryphGestureEnabled,
    shortcutRoutes: [
      {
        id: "history.undo",
        actionId: SHORTCUT_KEY.UNDO,
        binding: { kind: "configurable", shortcutId: SHORTCUT_KEY.UNDO },
        scope: { inputLayers: ["canvas"], activeTools: ALL_SHORTCUT_ACTIVE_TOOLS },
        triggerPolicy: { kind: "exact" },
        claimsBrowserDefault: true,
        handle(_event, context) {
          const editor = context.workspace.editor;
          if (editor === null) return { status: "ignored" };
          editor.actions.undoDocumentHistory();
          return { status: "handled", consume: true };
        },
      },
      {
        id: "history.redo",
        actionId: SHORTCUT_KEY.REDO,
        binding: { kind: "configurable", shortcutId: SHORTCUT_KEY.REDO },
        scope: { inputLayers: ["canvas"], activeTools: ALL_SHORTCUT_ACTIVE_TOOLS },
        triggerPolicy: { kind: "exact" },
        claimsBrowserDefault: true,
        handle(_event, context) {
          const editor = context.workspace.editor;
          if (editor === null) return { status: "ignored" };
          editor.actions.redoDocumentHistory();
          return { status: "handled", consume: true };
        },
      },
    ],
    // AI-REMOVED 2026-08-30:
    // Reason: 撤销和重做改由同模块的两条可执行 Shortcut Route 驱动。
    // Trigger: ST2-RQ-020 Action 路由统一。
    // Evidence: history.undo/history.redo 直接持有 handler 与 canvas 全工具作用域。
    // Replacement: shortcutRoutes in createHypergryphHistoryGestureModule
    // Risk: Low
    // Human Review: Required
    //
    // Original code:
    // handle(event, context) {
    //   const editor = context.workspace.editor;
    //   if (editor === null || event.type !== "key down") return { status: "ignored" };
    //   const { internalActions } = context.appHost;
    //   if (internalActions.isShortcutFor(SHORTCUT_KEY.UNDO, event.code, event.key, event.modifiers)) {
    //     editor.actions.undoDocumentHistory();
    //     return { status: "handled", consume: true };
    //   }
    //   if (internalActions.isShortcutFor(SHORTCUT_KEY.REDO, event.code, event.key, event.modifiers)) {
    //     editor.actions.redoDocumentHistory();
    //     return { status: "handled", consume: true };
    //   }
    //   return { status: "ignored" };
    // },
    handle() {
      return { status: "ignored" };
    },
  };
}
