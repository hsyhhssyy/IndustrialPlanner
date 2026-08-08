import {
  publishDebugModeEnabled,
  readDebugModeEnabled,
} from "@/shared/logging/debug-mode-runtime";
import { installConsoleIntercept } from "@/shared/logging/install-console-intercept";
import { installGlobalErrorCapture } from "@/shared/logging/install-global-error-capture";
import { DEFAULT_WORKBENCH_LOG_LEVEL, setLogLevel } from "@/shared/logging/logger";
import type { LogCollectorRequest } from "@/shared/logging/log-collector-protocol";
import {
  isWorkerBootstrapV1,
  type DebugModeChangedMessage,
  type WorkerFaultMessage,
  type WorkerKind,
} from "./worker-runtime-protocol";

interface WorkerScopeLike {
  addEventListener(type: string, listener: EventListener): void;
  removeEventListener(type: string, listener: EventListener): void;
}

export interface WorkerEndpointOptions {
  readonly workerKind: WorkerKind;
  readonly handleMessage: (event: MessageEvent<unknown>) => void | Promise<void>;
}

export function installWorkerEndpoint(options: WorkerEndpointOptions): () => void {
  const workerScope = globalThis as unknown as WorkerScopeLike;
  let controlPort: MessagePort | null = null;
  let logPort: MessagePort | null = null;
  let disposeConsole = () => {};
  let disposeGlobalErrors = () => {};
  let faultSequence = 1;
  let instanceId: string = options.workerKind;
  let bootstrapped = false;

  const reportFault = (error: unknown, writeConsole = true): void => {
    const normalized = error instanceof Error ? error : new Error(String(error));
    if (writeConsole) {
      console.error(`[${options.workerKind}-worker]`, normalized);
    }
    if (controlPort === null) {
      return;
    }

    const fault: WorkerFaultMessage = {
      type: "worker-fault",
      faultId: `${instanceId}:${faultSequence}`,
      message: normalized.message,
      ...(normalized.stack === undefined ? {} : { stack: normalized.stack }),
    };
    faultSequence += 1;
    try {
      controlPort.postMessage(fault);
    } catch {
      // 生命周期故障上报不能再次抛错。
    }
  };

  const handleControlMessage = (event: MessageEvent<unknown>) => {
    if (!isDebugModeChangedMessage(event.data)) {
      return;
    }
    publishDebugModeEnabled(event.data.debugModeEnabled);
    setLogLevel(event.data.debugModeEnabled ? "debug" : DEFAULT_WORKBENCH_LOG_LEVEL);
  };

  const handleMessage: EventListener = (rawEvent) => {
    const event = rawEvent as MessageEvent<unknown>;
    if (!bootstrapped) {
      if (!isWorkerBootstrapV1(event.data) || event.data.workerKind !== options.workerKind) {
        return;
      }

      const bootstrap = event.data;
      bootstrapped = true;
      instanceId = bootstrap.instanceId;
      controlPort = bootstrap.controlPort;
      logPort = bootstrap.logPort;
      publishDebugModeEnabled(bootstrap.debugModeEnabled);
      setLogLevel(bootstrap.debugModeEnabled ? "debug" : DEFAULT_WORKBENCH_LOG_LEVEL);
      controlPort.addEventListener("message", handleControlMessage);
      controlPort.start();
      disposeConsole = installConsoleIntercept({
        source: bootstrap.workerKind,
        instanceId: bootstrap.instanceId,
        readEnabled: readDebugModeEnabled,
        send: (entry) => {
          try {
            const request: LogCollectorRequest = { type: "log", entry };
            bootstrap.logPort.postMessage(request);
          } catch {
            // Collector 断开不能影响业务 Worker。
          }
        },
      });
      disposeGlobalErrors = installGlobalErrorCapture(workerScope, {
        preventDefault: true,
        onCaptured: (error) => {
          reportFault(error, false);
        },
      });
      return;
    }

    try {
      const result = options.handleMessage(event);
      if (result instanceof Promise) {
        void result.catch(reportFault);
      }
    } catch (error) {
      reportFault(error);
    }
  };

  workerScope.addEventListener("message", handleMessage);
  return () => {
    workerScope.removeEventListener("message", handleMessage);
    disposeGlobalErrors();
    disposeConsole();
    if (controlPort !== null) {
      controlPort.removeEventListener("message", handleControlMessage);
      controlPort.close();
    }
    logPort?.close();
  };
}

function isDebugModeChangedMessage(value: unknown): value is DebugModeChangedMessage {
  if (typeof value !== "object" || value === null) {
    return false;
  }

  const candidate = value as Partial<DebugModeChangedMessage>;
  return candidate.type === "debug-mode-changed"
    && typeof candidate.debugModeEnabled === "boolean";
}
