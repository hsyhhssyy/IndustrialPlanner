import type { AppHost } from "@/app/host/app-host";
import type { GestureMappingModule } from "../types";
import { isHypergryphGestureEnabled } from "./hypergryph-mode-guard";

export function createHypergryphSelectToolButtonModule(): GestureMappingModule<AppHost> {
  return {
    id: "hypergryph-select-tool-button",
    when: isHypergryphGestureEnabled,
    handle(event, context) {
      if (event.type !== "ui-button-touch-tap" && event.type !== "ui-button-mouse-tap") {
        return { status: "ignored" };
      }

      if (event.uiButtonId !== "placement-tool-select") {
        return { status: "ignored" };
      }

      if (event.type === "ui-button-mouse-tap" && event.button !== 0) {
        return { status: "ignored" };
      }

      context.appHost.internalActions.setActiveTool("select");
      return { status: "handled" };
    },
  };
}