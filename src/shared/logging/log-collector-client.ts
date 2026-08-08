import {
  isLogCollectorResponse,
  LOG_COLLECTOR_MAX_ENTRIES,
  type LogCollectorRequest,
  type LogCollectorResponse,
  type LogEntryInput,
  type PersistedLogEntry,
} from "./log-collector-protocol";

export type LogCollectorStatus = "uninitialized" | "ready" | "unavailable" | "error";

export interface LogQueryResult {
  readonly entries: PersistedLogEntry[];
  readonly nextBeforeId?: number;
  readonly total: number;
}

type PendingRequest = {
  readonly resolve: (response: LogCollectorResponse) => void;
  readonly reject: (error: Error) => void;
  readonly timeoutId: ReturnType<typeof setTimeout>;
};

const REQUEST_TIMEOUT_MS = 5_000;
const statusListeners = new Set<() => void>();
const pendingRequests = new Map<number, PendingRequest>();

let status: LogCollectorStatus = "uninitialized";
let adminWorker: SharedWorker | null = null;
let nextRequestId = 1;

export function initializeLogCollectorClient(): LogCollectorStatus {
  if (status !== "uninitialized") {
    return status;
  }

  if (typeof SharedWorker !== "function") {
    setStatus("unavailable");
    return status;
  }

  try {
    adminWorker = createCollectorConnection();
    adminWorker.port.addEventListener("message", handleResponse);
    adminWorker.addEventListener("error", handleWorkerError);
    adminWorker.port.start();
    setStatus("ready");
  } catch {
    adminWorker = null;
    setStatus("error");
  }

  return status;
}

export function getLogCollectorStatus(): LogCollectorStatus {
  return status;
}

export function subscribeLogCollectorStatus(listener: () => void): () => void {
  statusListeners.add(listener);
  return () => {
    statusListeners.delete(listener);
  };
}

export function postLogEntry(entry: LogEntryInput): void {
  if (status !== "ready" || adminWorker === null) {
    return;
  }

  try {
    const request: LogCollectorRequest = { type: "log", entry };
    adminWorker.port.postMessage(request);
  } catch {
    setStatus("error");
  }
}

export async function queryLogEntries(options: {
  readonly beforeId?: number;
  readonly limit?: number;
} = {}): Promise<LogQueryResult> {
  const requestId = createRequestId();
  const response = await sendRequest({
    type: "query",
    requestId,
    ...(options.beforeId === undefined ? {} : { beforeId: options.beforeId }),
    limit: options.limit ?? LOG_COLLECTOR_MAX_ENTRIES,
  });

  if (response.type !== "query-result") {
    throw new Error("Unexpected log collector response.");
  }

  return {
    entries: response.entries,
    ...(response.nextBeforeId === undefined ? {} : { nextBeforeId: response.nextBeforeId }),
    total: response.total,
  };
}

export async function clearLogEntries(): Promise<void> {
  const requestId = createRequestId();
  const response = await sendRequest({ type: "clear", requestId });
  if (response.type !== "cleared") {
    throw new Error("Unexpected log collector response.");
  }
}

export function createLogCollectorProducerPort(): MessagePort {
  if (status === "ready") {
    try {
      return createCollectorConnection().port;
    } catch {
      setStatus("error");
    }
  }

  const sink = new MessageChannel();
  sink.port1.close();
  return sink.port2;
}

function createCollectorConnection(): SharedWorker {
  return new SharedWorker(
    new URL("./log-collector-worker.ts", import.meta.url),
    { type: "module", name: "industrial-planner-log-collector" },
  );
}

function sendRequest(request: LogCollectorRequest): Promise<LogCollectorResponse> {
  if (status !== "ready" || adminWorker === null) {
    return Promise.reject(new Error("Log collector is unavailable."));
  }

  const requestId = "requestId" in request ? request.requestId : undefined;
  if (requestId === undefined) {
    return Promise.reject(new Error("Log collector request id is missing."));
  }

  return new Promise((resolve, reject) => {
    const timeoutId = setTimeout(() => {
      pendingRequests.delete(requestId);
      setStatus("error");
      reject(new Error("Log collector request timed out."));
    }, REQUEST_TIMEOUT_MS);
    pendingRequests.set(requestId, { resolve, reject, timeoutId });

    try {
      adminWorker?.port.postMessage(request);
    } catch (error) {
      clearTimeout(timeoutId);
      pendingRequests.delete(requestId);
      setStatus("error");
      reject(error instanceof Error ? error : new Error(String(error)));
    }
  });
}

function handleResponse(event: MessageEvent<unknown>): void {
  if (!isLogCollectorResponse(event.data)) {
    return;
  }

  const response = event.data;
  const requestId = "requestId" in response ? response.requestId : undefined;
  if (response.type === "collector-error") {
    setStatus("error");
  }
  if (requestId === undefined) {
    return;
  }

  const pending = pendingRequests.get(requestId);
  if (pending === undefined) {
    return;
  }

  clearTimeout(pending.timeoutId);
  pendingRequests.delete(requestId);
  if (response.type === "collector-error") {
    pending.reject(new Error(`Log collector failed: ${response.code}`));
  } else {
    pending.resolve(response);
  }
}

function handleWorkerError(): void {
  setStatus("error");
  const error = new Error("Log collector SharedWorker failed.");
  for (const pending of pendingRequests.values()) {
    clearTimeout(pending.timeoutId);
    pending.reject(error);
  }
  pendingRequests.clear();
}

function createRequestId(): number {
  const requestId = nextRequestId;
  nextRequestId += 1;
  return requestId;
}

function setStatus(nextStatus: LogCollectorStatus): void {
  if (status === nextStatus) {
    return;
  }
  status = nextStatus;
  for (const listener of statusListeners) {
    listener();
  }
}
