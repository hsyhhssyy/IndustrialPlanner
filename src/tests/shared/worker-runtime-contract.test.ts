// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from "vitest";

import {
  publishDebugModeEnabled,
} from "@/shared/logging/debug-mode-runtime";
import { DEFAULT_WORKBENCH_LOG_LEVEL, setLogLevel } from "@/shared/logging/logger";
import { attachWorkerRuntime } from "@/shared/worker/attach-worker-runtime";
import { installWorkerEndpoint } from "@/shared/worker/worker-endpoint";
import type {
  DebugModeChangedMessage,
  WorkerBootstrapV1,
  WorkerFaultMessage,
} from "@/shared/worker/worker-runtime-protocol";
import type { LogCollectorRequest } from "@/shared/logging/log-collector-protocol";

afterEach(() => {
  publishDebugModeEnabled(false);
  setLogLevel(DEFAULT_WORKBENCH_LOG_LEVEL);
  vi.restoreAllMocks();
});

class BootstrapCapturingWorker {
  public readonly messages: unknown[] = [];

  public postMessage(message: unknown): void {
    this.messages.push(message);
  }
}

describe("Worker Runtime Contract", () => {
  it("sends bootstrap before business traffic and publishes debugMode changes", async () => {
    publishDebugModeEnabled(false);
    const worker = new BootstrapCapturingWorker();
    const attachment = attachWorkerRuntime(worker as unknown as Worker, "webdav");
    const bootstrap = worker.messages[0] as WorkerBootstrapV1;

    expect(bootstrap).toMatchObject({
      type: "industrial-planner/worker-bootstrap",
      version: 1,
      workerKind: "webdav",
      debugModeEnabled: false,
    });
    expect(bootstrap.controlPort).toBeInstanceOf(MessagePort);
    expect(bootstrap.logPort).toBeInstanceOf(MessagePort);

    const changed = waitForPortMessage<DebugModeChangedMessage>(bootstrap.controlPort);
    publishDebugModeEnabled(true);
    await expect(changed).resolves.toEqual({
      type: "debug-mode-changed",
      debugModeEnabled: true,
    });

    attachment.dispose();
    bootstrap.controlPort.close();
    bootstrap.logPort.close();
  });

  it("boots one endpoint, captures Worker console and keeps business messages separate", async () => {
    const originalWarn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const businessMessages: unknown[] = [];
    const controlChannel = new MessageChannel();
    const logChannel = new MessageChannel();
    const dispose = installWorkerEndpoint({
      workerKind: "timeline",
      handleMessage: (event) => {
        businessMessages.push(event.data);
      },
    });
    const bootstrap: WorkerBootstrapV1 = {
      type: "industrial-planner/worker-bootstrap",
      version: 1,
      workerKind: "timeline",
      instanceId: "timeline-test",
      debugModeEnabled: true,
      controlPort: controlChannel.port2,
      logPort: logChannel.port2,
    };

    dispatchGlobalMessage(bootstrap);
    const logged = waitForPortMessage<LogCollectorRequest>(logChannel.port1);
    console.warn("worker console smoke");
    await expect(logged).resolves.toMatchObject({
      type: "log",
      entry: {
        source: "timeline",
        instanceId: "timeline-test",
        level: "warn",
        message: "worker console smoke",
      },
    });
    expect(originalWarn).toHaveBeenCalledWith("worker console smoke");

    dispatchGlobalMessage({ type: "business-message", payload: 1 });
    expect(businessMessages).toEqual([{ type: "business-message", payload: 1 }]);

    const faultMessage = waitForPortMessage<WorkerFaultMessage>(controlChannel.port1);
    const globalErrorLog = waitForPortMessage<LogCollectorRequest>(logChannel.port1);
    const errorEvent = new Event("error", { cancelable: true });
    Object.defineProperties(errorEvent, {
      message: { value: "worker global boom" },
      error: { value: new Error("worker global boom") },
    });
    globalThis.dispatchEvent(errorEvent);
    await expect(faultMessage).resolves.toMatchObject({
      type: "worker-fault",
      faultId: "timeline-test:1",
      message: "worker global boom",
    });
    await expect(globalErrorLog).resolves.toMatchObject({
      type: "log",
      entry: {
        source: "timeline",
        message: expect.stringContaining("[global.error]"),
      },
    });
    expect(errorEvent.defaultPrevented).toBe(true);

    dispose();
    controlChannel.port1.close();
    logChannel.port1.close();
  });
});

function dispatchGlobalMessage(data: unknown): void {
  globalThis.dispatchEvent(new MessageEvent("message", { data }));
}

function waitForPortMessage<TMessage>(port: MessagePort): Promise<TMessage> {
  return new Promise((resolve, reject) => {
    const timeoutId = setTimeout(() => reject(new Error("MessagePort response timed out.")), 1_000);
    port.addEventListener("message", (event: MessageEvent<TMessage>) => {
      clearTimeout(timeoutId);
      resolve(event.data);
    }, { once: true });
    port.start();
  });
}
