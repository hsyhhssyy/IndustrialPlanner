import {
  createLogCollectorProducerPort,
} from "@/shared/logging/log-collector-client";
import { createInstanceId } from "@/shared/logging/debug-logging-runtime";
import {
  readDebugModeEnabled,
  subscribeDebugModeEnabled,
} from "@/shared/logging/debug-mode-runtime";
import type {
  WorkerBootstrapV1,
  WorkerFaultMessage,
  WorkerKind,
} from "./worker-runtime-protocol";

export interface WorkerRuntimeAttachment {
  readonly instanceId: string;
  dispose(): void;
}

export function attachWorkerRuntime(
  worker: Worker,
  workerKind: WorkerKind,
  options: {
    readonly onFault?: (fault: WorkerFaultMessage) => void;
  } = {},
): WorkerRuntimeAttachment {
  const instanceId = createInstanceId(workerKind);
  const controlChannel = new MessageChannel();
  const logPort = createLogCollectorProducerPort();
  let disposed = false;

  const handleControlMessage = (event: MessageEvent<unknown>) => {
    if (isWorkerFaultMessage(event.data)) {
      try {
        options.onFault?.(event.data);
      } catch {
        // 业务生命周期回调不得破坏 control port 消息循环。
      }
    }
  };
  controlChannel.port1.addEventListener("message", handleControlMessage);
  controlChannel.port1.start();

  const bootstrap: WorkerBootstrapV1 = {
    type: "industrial-planner/worker-bootstrap",
    version: 1,
    workerKind,
    instanceId,
    debugModeEnabled: readDebugModeEnabled(),
    controlPort: controlChannel.port2,
    logPort,
  };
  try {
    worker.postMessage(bootstrap, [controlChannel.port2, logPort]);
  } catch (error) {
    controlChannel.port1.removeEventListener("message", handleControlMessage);
    controlChannel.port1.close();
    controlChannel.port2.close();
    logPort.close();
    throw error;
  }

  const unsubscribeDebugMode = subscribeDebugModeEnabled((enabled) => {
    try {
      controlChannel.port1.postMessage({
        type: "debug-mode-changed",
        debugModeEnabled: enabled,
      });
    } catch {
      // Worker 结束与设置更新竞态时无需影响主线程。
    }
  });

  return {
    instanceId,
    dispose(): void {
      if (disposed) {
        return;
      }
      disposed = true;
      unsubscribeDebugMode();
      controlChannel.port1.removeEventListener("message", handleControlMessage);
      controlChannel.port1.close();
    },
  };
}

function isWorkerFaultMessage(value: unknown): value is WorkerFaultMessage {
  if (typeof value !== "object" || value === null) {
    return false;
  }

  const candidate = value as Partial<WorkerFaultMessage>;
  return candidate.type === "worker-fault"
    && typeof candidate.faultId === "string"
    && typeof candidate.message === "string";
}
