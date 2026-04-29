import type { AppHost } from "@/app/host/app-host";
import type { GestureDiagnosticsStore } from "@/app/input/gesture/diagnostics/gesture-diagnostics";
import type { GestureMappingModule } from "../types";
import { isHypergryphGestureEnabled } from "./hypergryph-mode-guard";

export function createHypergryphGestureDiagnosticsModule(
  store: GestureDiagnosticsStore,
): GestureMappingModule<AppHost> {
  return {
    id: "hypergryph-gesture-diagnostics",
    priority: Number.MAX_SAFE_INTEGER,
    when: isHypergryphGestureEnabled,
    handle(event) {
      store.recordGesture(event);
      return {
        status: "handled",
        consume: false,
      };
    },
  };
}