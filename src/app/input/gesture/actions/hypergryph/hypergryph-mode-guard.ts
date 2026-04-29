import type { AppHost } from "@/app/host/app-host";
import type { GestureActionContext } from "../types";

export function isHypergryphGestureEnabled(
  context: GestureActionContext<AppHost>,
): boolean {
  return context.appHost.state.settings.hypergryphOperationMode;
}