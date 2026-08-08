import {
  initializeLogCollectorClient,
  postLogEntry,
} from "./log-collector-client";
import { readDebugModeEnabled } from "./debug-mode-runtime";
import { installConsoleIntercept } from "./install-console-intercept";
import { installGlobalErrorCapture } from "./install-global-error-capture";

const MAIN_INSTANCE_ID = createInstanceId("main");
const SESSION_STARTED_AT = Date.now();

let initialized = false;

export function initializeDebugLogging(): void {
  if (initialized || typeof window === "undefined") {
    return;
  }
  initialized = true;

  initializeLogCollectorClient();
  installConsoleIntercept({
    source: "main",
    instanceId: MAIN_INSTANCE_ID,
    readEnabled: readDebugModeEnabled,
    send: postLogEntry,
  });
  installGlobalErrorCapture(window);
}

export function getDebugLogSessionStartedAt(): number {
  return SESSION_STARTED_AT;
}

export function createInstanceId(prefix: string): string {
  const uuid = typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
    ? crypto.randomUUID()
    : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
  return `${prefix}-${uuid}`;
}
