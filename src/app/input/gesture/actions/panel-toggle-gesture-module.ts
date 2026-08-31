import type { AppHost } from "@/app/host/app-host";
import { SHORTCUT_KEY, type ShortcutKeyId } from "@/app/actions/keyboard-shortcut-manager";
import type { GestureMappingModule } from "./types";
import { ALL_SHORTCUT_ACTIVE_TOOLS } from "./shortcut-route-matching";

const TOGGLE_KEY_TO_PANEL = {
  [SHORTCUT_KEY.TOGGLE_PLACEMENT_PANEL]: "placement",
  [SHORTCUT_KEY.TOGGLE_BLUEPRINT_PANEL]: "blueprint",
  [SHORTCUT_KEY.TOGGLE_HISTORY_PANEL]: "history",
  [SHORTCUT_KEY.TOGGLE_BASE_PANEL]: "base",
} as const;

export function createPanelToggleGestureModule(): GestureMappingModule<AppHost> {
  return {
    id: "panel-toggle-shortcut",
    shortcutRoutes: (Object.entries(TOGGLE_KEY_TO_PANEL) as Array<[
      ShortcutKeyId,
      "placement" | "blueprint" | "history" | "base",
    ]>).map(([shortcutId, panel]) => ({
      id: `toggle-panel.${panel}`,
      actionId: shortcutId,
      binding: { kind: "configurable" as const, shortcutId },
      scope: { inputLayers: ["canvas"], activeTools: ALL_SHORTCUT_ACTIVE_TOOLS },
      triggerPolicy: { kind: "exact" as const },
      claimsBrowserDefault: true,
      handle: (_event, context) => togglePanel(context.appHost, panel),
    })),
    // AI-REMOVED 2026-08-30:
    // Reason: 面板快捷键的匹配与作用域已迁入同模块 Shortcut Route。
    // Trigger: ST2-RQ-020 要求运行时与设置冲突检查消费同一可执行路由。
    // Evidence: toggle-panel.* Route 直接调用 togglePanel。
    // Replacement: shortcutRoutes and togglePanel in this module
    // Risk: Low
    // Human Review: Required
    //
    // Original code:
    // handle(event, context) {
    //   if (event.type !== "key down") return { status: "ignored" };
    //   const targetPanel = resolveTargetPanel(
    //     context.appHost.internalActions, event.code, event.key, event.modifiers,
    //   );
    //   if (targetPanel === null) return { status: "ignored" };
    //   const appHost = context.appHost;
    //   const leftDockOpen = appHost.state.workbench.leftDockOpen;
    //   const activePanel = appHost.internalState.runtime.activePanel ?? "placement";
    //   if (leftDockOpen && activePanel === targetPanel) {
    //     appHost.internalActions.toggleLeftDock();
    //     return { status: "handled", consume: true };
    //   }
    //   appHost.internalActions.setActivePanel(targetPanel);
    //   return { status: "handled", consume: true };
    // },
    handle() {
      return { status: "ignored" };
    },
  };
}

// AI-REMOVED 2026-08-30:
// Reason: Route 已按 Action 拆分，运行时不再先遍历绑定反查面板。
// Trigger: ST2-RQ-020 可执行 Shortcut Route 迁移。
// Evidence: shortcutRoutes 由 TOGGLE_KEY_TO_PANEL 生成并直接携带 panel。
// Replacement: shortcutRoutes in createPanelToggleGestureModule
// Risk: Low
// Human Review: Required
//
// Original code:
/*
function resolveTargetPanel(
  internalActions: AppHost["internalActions"],
  code: string | null,
  key: string | null,
  modifiers: {
    readonly alt: boolean;
    readonly ctrl: boolean;
    readonly meta: boolean;
    readonly shift: boolean;
  },
): "placement" | "blueprint" | "history" | "base" | null {
  for (const [shortcutKeyId, panel] of Object.entries(TOGGLE_KEY_TO_PANEL)) {
    if (
      internalActions.isShortcutFor(
        shortcutKeyId,
        code,
        key?.trim() ?? null,
        modifiers,
      )
    ) {
      return panel;
    }
  }
  return null;
}
*/
function togglePanel(
  appHost: AppHost,
  targetPanel: "placement" | "blueprint" | "history" | "base",
) {
  const leftDockOpen = appHost.state.workbench.leftDockOpen;
  const activePanel = appHost.internalState.runtime.activePanel ?? "placement";
  if (leftDockOpen && activePanel === targetPanel) {
    appHost.internalActions.toggleLeftDock();
    return { status: "handled" as const, consume: true };
  }

  appHost.internalActions.setActivePanel(targetPanel);
  return { status: "handled" as const, consume: true };
}
