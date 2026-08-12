/// <reference lib="webworker" />

import { installWorkerEndpoint } from "@/shared/worker/worker-endpoint";

import type {
  CfV2WorkerError,
  CfV2WorkerRequest,
  CfV2WorkerResponse,
} from "./cloudflare-v2-worker-protocol";
import { CloudflareV2WorkerRuntime } from "./cloudflare-v2-worker-runtime";
import { CfV2HttpError } from "./cloudflare-v2-types";

const runtime = new CloudflareV2WorkerRuntime();
const workerScope = globalThis as unknown as {
  postMessage(response: CfV2WorkerResponse): void;
};

installWorkerEndpoint({
  workerKind: "cloudflare",
  handleMessage: async (event) => {
    if (!isRequest(event.data)) {
      return;
    }
    const request = event.data;
    try {
      const result = await runtime.execute(
        request.config,
        request.operation,
        (activity) => {
          const response: CfV2WorkerResponse = {
            requestId: request.requestId,
            activity,
          };
          workerScope.postMessage(response);
        },
      );
      const response: CfV2WorkerResponse = {
        requestId: request.requestId,
        ok: true,
        result,
      };
      workerScope.postMessage(response);
    } catch (error) {
      const response: CfV2WorkerResponse = {
        requestId: request.requestId,
        ok: false,
        error: serializeError(error),
      };
      workerScope.postMessage(response);
    }
  },
});

function isRequest(value: unknown): value is CfV2WorkerRequest {
  if (typeof value !== "object" || value === null) {
    return false;
  }
  const candidate = value as Partial<CfV2WorkerRequest>;
  return typeof candidate.requestId === "number"
    && typeof candidate.config === "object"
    && typeof candidate.operation === "object";
}

function serializeError(error: unknown): CfV2WorkerError {
  const normalized = error instanceof Error ? error : new Error(String(error));
  return {
    name: normalized.name,
    message: normalized.message,
    ...(normalized.stack === undefined ? {} : { stack: normalized.stack }),
    ...(error instanceof CfV2HttpError
      ? {
          status: error.status,
          code: error.code,
          details: error.details,
        }
      : {}),
  };
}
