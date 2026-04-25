import type { AppHost } from "@/app/app-host";
import type { GestureMappingModule } from "./types";

export function createPlacementToolButtonModule(): GestureMappingModule<AppHost> {
  return {
    id: "app-placement-tool-button",
    handle(event, context) {
      if (event.type !== "ui-button-touch-tap" && event.type !== "ui-button-mouse-tap") {
        return { status: "ignored" };
      }

      if (event.type === "ui-button-mouse-tap" && event.button !== 0) {
        return { status: "ignored" };
      }

      switch (event.uiButtonId) {
        case "placement-tool-select":
          context.appHost.internalActions.setActiveTool("select");
          return { status: "handled" };
        case "placement-tool-marquee":
          if (!context.appHost.state.settings.hypergryphOperationMode) {
            return { status: "ignored" };
          }

          context.appHost.internalActions.setActiveTool("marquee");
          return { status: "handled" };
        default:
          return { status: "ignored" };
      }
    },
  };
}
