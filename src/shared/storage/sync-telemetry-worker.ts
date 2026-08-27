/// <reference lib="webworker" />

import { installWorkerEndpoint } from "@/shared/worker/worker-endpoint";
import {
  CLIENT_TELEMETRY_INTERVAL_MS,
  isClientTelemetryWorkerRequest,
  type ClientTelemetryUploadPayload,
} from "./client-telemetry-protocol";

// 独立遥测上报 Worker。
//
// AI-CORRECTION 2026-08-08: 创建方必须先通过 attachWorkerRuntime() 发送 bootstrap，
// 再通过业务 postMessage 推送 upload-telemetry payload；直接发送业务消息会被入口忽略。
// Worker 自动执行 health check → POST，失败静默丢弃。
// 自带 15 分钟节流，重复调用直接跳过。

const TELEMETRY_TIMEOUT_MS = 3000;
const TELEMETRY_MIN_INTERVAL_MS = CLIENT_TELEMETRY_INTERVAL_MS;

let lastUploadAttemptAt = 0;

export interface SyncTelemetryWorkerRequest {
  readonly type: "upload-telemetry";
  readonly apiBaseUrl: string;
  readonly payload: ClientTelemetryUploadPayload;
}

installWorkerEndpoint({
  workerKind: "sync-telemetry",
  handleMessage: async (event) => {
    const request = event.data as Partial<SyncTelemetryWorkerRequest> | null;

    if (
      request?.type !== "upload-telemetry"
      || !isClientTelemetryWorkerRequest(request)
    ) {
      return;
    }

    await handleUploadTelemetry(request.apiBaseUrl, request.payload);
  },
});

async function handleUploadTelemetry(
  apiBaseUrl: string,
  payload: ClientTelemetryUploadPayload,
): Promise<void> {
  const nowMs = Date.now();

  if (nowMs - lastUploadAttemptAt < TELEMETRY_MIN_INTERVAL_MS) {
    return;
  }

  lastUploadAttemptAt = nowMs;

  try {
    const healthResponse = await fetchWithTimeout(`${apiBaseUrl}/health`, {
      method: "GET",
      cache: "no-store",
      credentials: "omit",
    });

    if (healthResponse.status !== 200) {
      return;
    }

    await fetchWithTimeout(`${apiBaseUrl}/v1/telemetry/sync-shadow`, {
      method: "POST",
      cache: "no-store",
      credentials: "omit",
      headers: {
        "content-type": "application/json",
      },
      body: JSON.stringify(payload),
    });
  } catch {
    // 所有错误静默丢弃。
  }
}

async function fetchWithTimeout(
  input: RequestInfo | URL,
  init: RequestInit,
): Promise<Response> {
  const controller = new AbortController();
  const timeoutId = globalThis.setTimeout(() => {
    controller.abort();
  }, TELEMETRY_TIMEOUT_MS);

  try {
    return await fetch(input, {
      ...init,
      signal: controller.signal,
    });
  } finally {
    globalThis.clearTimeout(timeoutId);
  }
}
