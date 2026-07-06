import type { AppHost } from "@/app/host/app-host";

import type { GestureMappingModule } from "../types";
import { isHypergryphGestureEnabled } from "./hypergryph-mode-guard";

export function createHypergryphOverlapEntityMenuGuardModule(): GestureMappingModule<AppHost> {
  return {
    id: "hypergryph-overlap-entity-menu-guard",
    priority: 1000,
    when: isHypergryphGestureEnabled,
    handle(event, context) {
      const menu = (context.appHost as AppHost & {
        overlapEntityMenu?: AppHost["overlapEntityMenu"];
      }).overlapEntityMenu;
      if (menu === undefined || !menu.visible) {
        return { status: "ignored" };
      }

      if (event.type === "key down" && event.code === "Escape") {
        menu.cancel();
        return { status: "handled" };
      }

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
