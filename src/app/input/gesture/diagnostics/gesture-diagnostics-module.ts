import type { AppHost } from "@/app/host/app-host";
import type { GestureMappingModule } from "../actions/types";
import type { GestureDiagnosticsStore } from "./gesture-diagnostics";

export function createGestureDiagnosticsModule(
  store: GestureDiagnosticsStore,
): GestureMappingModule<AppHost> {
  return {
    id: "gesture-diagnostics",
    priority: Number.MAX_SAFE_INTEGER,
    handle(event) {
      store.recordGesture(event);
      if (event.type === "on-enter-active-tool" || event.type === "on-exit-active-tool") {
        return {
          status: "ignored",
        };
      }

      return {
        status: "handled",
        consume: false,
      };
    },
  };
}