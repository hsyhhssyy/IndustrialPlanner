import type { LogSource } from "@/shared/logging/log-collector-protocol";

export type WorkerKind = Exclude<LogSource, "main">;

export interface WorkerBootstrapV1 {
  readonly type: "industrial-planner/worker-bootstrap";
  readonly version: 1;
  readonly workerKind: WorkerKind;
  readonly instanceId: string;
  readonly debugModeEnabled: boolean;
  readonly controlPort: MessagePort;
  readonly logPort: MessagePort;
}

export interface DebugModeChangedMessage {
  readonly type: "debug-mode-changed";
  readonly debugModeEnabled: boolean;
}

export interface WorkerFaultMessage {
  readonly type: "worker-fault";
  readonly faultId: string;
  readonly message: string;
  readonly stack?: string;
}

export function isWorkerBootstrapV1(value: unknown): value is WorkerBootstrapV1 {
  if (typeof value !== "object" || value === null) {
    return false;
  }

  const candidate = value as Partial<WorkerBootstrapV1>;
  return candidate.type === "industrial-planner/worker-bootstrap"
    && candidate.version === 1
    && typeof candidate.workerKind === "string"
    && typeof candidate.instanceId === "string"
    && typeof candidate.debugModeEnabled === "boolean"
    && candidate.controlPort instanceof MessagePort
    && candidate.logPort instanceof MessagePort;
}
