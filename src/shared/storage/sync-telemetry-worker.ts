/// <reference lib="webworker" />

// 独立遥测上报 Worker。
//
// 用法：任何前台线程通过 postMessage 推送 payload：
//   worker.postMessage({ type: 'upload-telemetry', apiBaseUrl, payload });
// Worker 自动执行 health check → POST，失败静默丢弃。
// 自带 15 分钟节流，重复调用直接跳过。

const TELEMETRY_TIMEOUT_MS = 3000;
const TELEMETRY_MIN_INTERVAL_MS = 15 * 60 * 1000;

let lastUploadAttemptAt = 0;

export interface SyncTelemetryWorkerRequest {
  readonly type: "upload-telemetry";
  readonly apiBaseUrl: string;
  readonly payload: object;
}

const workerScope = globalThis as unknown as {
  addEventListener(
    type: "message",
    listener: (event: MessageEvent<SyncTelemetryWorkerRequest>) => void,
  ): void;
};

workerScope.addEventListener("message", (event) => {
  const request = event.data;

  if (request.type !== "upload-telemetry") {
    return;
  }

  void handleUploadTelemetry(request.apiBaseUrl, request.payload);
});

async function handleUploadTelemetry(
  apiBaseUrl: string,
  payload: object,
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
