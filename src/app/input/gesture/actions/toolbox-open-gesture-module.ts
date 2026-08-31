import type { AppHost } from "@/app/host/app-host";
import { SHORTCUT_KEY } from "@/app/actions/keyboard-shortcut-manager";
import type { GestureMappingModule } from "./types";
import { ALL_SHORTCUT_ACTIVE_TOOLS } from "./shortcut-route-matching";

/**
 * T 键打开工具箱（单向，不关闭）。
 * 工具箱打开后，dialog shell 会拦截所有键盘事件，因此 T 键不会触发二次打开或关闭。
 */
export function createToolboxOpenGestureModule(): GestureMappingModule<AppHost> {
  return {
    id: "toolbox-open-shortcut",
    shortcutRoutes: [{
      id: "open-toolbox.canvas",
      actionId: SHORTCUT_KEY.OPEN_TOOLBOX,
      binding: { kind: "configurable", shortcutId: SHORTCUT_KEY.OPEN_TOOLBOX },
      scope: { inputLayers: ["canvas"], activeTools: ALL_SHORTCUT_ACTIVE_TOOLS },
      triggerPolicy: { kind: "exact" },
      claimsBrowserDefault: true,
      handle(_event, context) {
        context.appHost.internalActions.openDialog("toolbox");
        return { status: "handled", consume: true };
      },
    }],
    // AI-REMOVED 2026-08-30:
    // Reason: 工具箱快捷键改由同模块的可执行 Shortcut Route 匹配和执行，避免运行时与冲突检查双真相。
    // Trigger: ST2-RQ-020 Action 路由统一。
    // Evidence: open-toolbox.canvas 同时声明作用域、触发策略和 handler。
    // Replacement: shortcutRoutes[open-toolbox.canvas] in this module
    // Risk: Low
    // Human Review: Required
    //
    // Original code:
    // handle(event, context) {
    //   if (event.type !== "key down") {
    //     return { status: "ignored" };
    //   }
    //   const internalActions = context.appHost.internalActions;
    //   const matches = internalActions.isShortcutFor(
    //     SHORTCUT_KEY.OPEN_TOOLBOX,
    //     event.code,
    //     event.key?.trim() ?? null,
    //     event.modifiers,
    //   );
    //   if (!matches) {
    //     return { status: "ignored" };
    //   }
    //   context.appHost.internalActions.openDialog("toolbox");
    //   return { status: "handled", consume: true };
    // },
    handle() {
      return { status: "ignored" };
    },
  };
}
