/// <reference lib="webworker" />

import { createLogCollectorMessageHandler } from "./log-collector-handler";
import type { LogCollectorResponse } from "./log-collector-protocol";

const handler = createLogCollectorMessageHandler();
let operationQueue = Promise.resolve();

const workerScope = globalThis as unknown as {
  onconnect: ((event: MessageEvent) => void) | null;
};

workerScope.onconnect = (event) => {
  const port = event.ports[0];
  if (port === undefined) {
    return;
  }

  port.onmessage = (messageEvent) => {
    const request = messageEvent.data;
    operationQueue = operationQueue
      .then(async () => {
        const response = await handler.handle(request);
        if (response !== null) {
          safePostResponse(port, response);
        }
      })
      .catch(() => {
        const requestId = readRequestId(request);
        safePostResponse(port, {
          type: "collector-error",
          ...(requestId === undefined ? {} : { requestId }),
          code: "collector-operation-failed",
        });
      });
  };
  port.start();
};

function safePostResponse(port: MessagePort, response: LogCollectorResponse): void {
  try {
    port.postMessage(response);
  } catch {
    // Collector 不能借助 console 记录自身错误，否则可能递归。
  }
}

function readRequestId(value: unknown): number | undefined {
  if (typeof value !== "object" || value === null || !("requestId" in value)) {
    return undefined;
  }

  const requestId = (value as { readonly requestId?: unknown }).requestId;
  return typeof requestId === "number" && Number.isInteger(requestId)
    ? requestId
    : undefined;
}
