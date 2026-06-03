import type { AppHost } from "@/app/host/app-host";
import { SHORTCUT_KEY } from "@/app/actions/keyboard-shortcut-manager";
import type { GestureMappingModule } from "./types";

const TOGGLE_KEY_TO_PANEL = {
  [SHORTCUT_KEY.TOGGLE_PLACEMENT_PANEL]: "placement",
  [SHORTCUT_KEY.TOGGLE_BLUEPRINT_PANEL]: "blueprint",
  [SHORTCUT_KEY.TOGGLE_HISTORY_PANEL]: "history",
  [SHORTCUT_KEY.TOGGLE_BASE_PANEL]: "base",
} as const;

export function createPanelToggleGestureModule(): GestureMappingModule<AppHost> {
  return {
    id: "panel-toggle-shortcut",
    handle(event, context) {
      if (event.type !== "key down") {
        return { status: "ignored" };
      }

      const internalActions = context.appHost.internalActions;
      const targetPanel = resolveTargetPanel(
        internalActions,
        event.code,
        event.key,
        event.modifiers,
      );

      if (targetPanel === null) {
        return { status: "ignored" };
      }

      const appHost = context.appHost;
      const leftDockOpen = appHost.state.workbench.leftDockOpen;
      const activePanel = appHost.internalState.runtime.activePanel ?? "placement";

      if (leftDockOpen && activePanel === targetPanel) {
        appHost.internalActions.toggleLeftDock();
        return { status: "handled", consume: true };
      }

      appHost.internalActions.setActivePanel(targetPanel);
      return { status: "handled", consume: true };
    },
  };
}

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