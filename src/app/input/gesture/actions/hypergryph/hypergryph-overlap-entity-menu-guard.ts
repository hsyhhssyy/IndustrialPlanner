import type { AppHost } from "@/app/host/app-host";

import type { GestureMappingModule } from "../types";
import { isHypergryphGestureEnabled } from "./hypergryph-mode-guard";

export function createHypergryphOverlapEntityMenuGuardModule(): GestureMappingModule<AppHost> {
  return {
    id: "hypergryph-overlap-entity-menu-guard",
    priority: 1000,
    when: isHypergryphGestureEnabled,
    shortcutRoutes: [{
      id: "overlap-entity-menu.cancel",
      actionId: "fixed.overlap-entity-menu.cancel",
      binding: { kind: "fixed", value: "Esc" },
      scope: {
        inputLayers: ["overlap-entity-menu"],
        activeTools: [
          "select",
          "move",
          "marquee",
          "blueprint-placement",
          "single-placement",
          "logistics-placement",
          "dark-pipe-link",
        ],
      },
      triggerPolicy: { kind: "exact" },
      handle(_event, context) {
        context.appHost.overlapEntityMenu.cancel();
        return { status: "handled" };
      },
    }],
    handle(event, context) {
      const menu = (context.appHost as AppHost & {
        overlapEntityMenu?: AppHost["overlapEntityMenu"];
      }).overlapEntityMenu;
      if (menu === undefined || !menu.visible) {
        return { status: "ignored" };
      }

      // AI-REMOVED 2026-08-30:
      // Reason: 重叠菜单 Escape 已迁入最高输入层固定 Route。
      // Trigger: ST2-RQ-020 输入层统一。
      // Evidence: overlap-entity-menu.cancel 仅在 overlap-entity-menu 层可达。
      // Replacement: shortcutRoutes[overlap-entity-menu.cancel] in this module
      // Risk: Low
      // Human Review: Required
      //
      // Original code:
      // if (event.type === "key down" && event.code === "Escape") {
      //   menu.cancel();
      //   return { status: "handled" };
      // }

      if (event.type === "on-exit-active-tool" || event.type === "on-enter-active-tool") {
        menu.cancel();
        return { status: "handled", consume: false };
      }

      if (
        event.type === "mouse move"
        || event.type === "mouse tap"
        || event.type === "mouse dragstart"
        || event.type === "mouse dragmove"
        || event.type === "mouse dragend"
        || event.type === "mouse-long-press-ready"
        || event.type === "touch tap"
        || event.type === "touch dragstart"
        || event.type === "touch dragmove"
        || event.type === "touch dragend"
        || event.type === "tap-long-press-ready"
      ) {
        return { status: "handled" };
      }

      return { status: "ignored" };
    },
  };
}
