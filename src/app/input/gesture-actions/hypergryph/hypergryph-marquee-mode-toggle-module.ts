import type { AppHost } from "@/app/app-host";
import { matchesHypergryphMarqueeToggleShortcut } from "@/app/workbench-keybinding-policy";
import type { GestureMappingModule } from "../types";
import { isHypergryphGestureEnabled } from "./hypergryph-mode-guard";

export function createHypergryphMarqueeModeToggleModule(): GestureMappingModule<AppHost> {
  return {
    id: "hypergryph-marquee-mode-toggle",
    when: isHypergryphGestureEnabled,
    handle(event, context) {
      switch (event.type) {
        case "key down":
          if (!matchesHypergryphMarqueeToggleShortcut({
            code: event.code,
            key: event.key,
            modifiers: event.modifiers,
          })) {
            return { status: "ignored" };
          }

          toggleMarqueeMode(context.appHost);
          return { status: "handled" };

        case "ui-button-touch-tap":
          if (event.uiButtonId !== "placement-tool-marquee") {
            return { status: "ignored" };
          }

          toggleMarqueeMode(context.appHost);
          return { status: "handled" };

        case "ui-button-mouse-tap":
          if (event.uiButtonId !== "placement-tool-marquee" || event.button !== 0) {
            return { status: "ignored" };
          }

          toggleMarqueeMode(context.appHost);
          return { status: "handled" };

        case "mouse tap":
          if (event.button !== 2 || context.appHost.internalState.runtime.activeTool !== "marquee") {
            return { status: "ignored" };
          }

          context.appHost.internalActions.setActiveTool("select");
          return { status: "handled" };

        default:
          return { status: "ignored" };
      }
    },
  };
}

function toggleMarqueeMode(appHost: AppHost): void {
  appHost.internalActions.setActiveTool(
    appHost.internalState.runtime.activeTool === "marquee"
      ? "select"
      : "marquee",
  );
}