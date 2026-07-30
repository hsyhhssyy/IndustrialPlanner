import {
  normalizeWebDavRootPath,
  // AI-CORRECTION 2026-07-30: 以下类型别名来自 webdav-client.ts，底层指向 ../types。
  type WebDavClientOptions,
  type WebDavResourceStat,
  type WebDavStorageClient,
  type WebDavTextFile,
} from "./webdav-client";
import type {
  WebDavWorkerOperation,
  WebDavWorkerRequest,
  WebDavWorkerResponse,
} from "./webdav-worker-protocol";
import type { SyncClientOptions } from "../types";

export interface WebDavWorkerStorageClientOptions extends SyncClientOptions {
  readonly readDebugEnabled?: () => boolean;
  readonly maxConcurrentRequests?: number;
  readonly onRequestActivityChange?: (
    activity: WebDavWorkerRequestActivity,
  ) => void;
  readonly workerFactory?: () => Worker;
}

export interface WebDavWorkerRequestActivity {
  readonly activeRequestCount: number;
  readonly queuedRequestCount: number;
}

export function createWebDavWorkerStorageClient(
  options: WebDavWorkerStorageClientOptions,
): WebDavStorageClient {
  const worker = options.workerFactory?.() ?? new Worker(
    new URL("./webdav-worker.ts", import.meta.url),
    { type: "module" },
  );
  const clientOptions: WebDavClientOptions = {
    baseUrl: options.baseUrl,
    ...(options.username === undefined ? {} : { username: options.username }),
    ...(options.password === undefined ? {} : { password: options.password }),
    ...(options.rootPath === undefined ? {} : { rootPath: options.rootPath }),
    ...(options.requestTimeoutMs === undefined ? {} : { requestTimeoutMs: options.requestTimeoutMs }),
  };
  const pending = new Map<number, {
    readonly resolve: (value: unknown) => void;
    readonly reject: (error: Error) => void;
  }>();
  const requestQueue: Array<{
    readonly request: WebDavWorkerRequest;
    readonly resolve: (value: unknown) => void;
    readonly reject: (error: Error) => void;
  }> = [];
  const maxConcurrentRequests = normalizeMaxConcurrentRequests(
    options.maxConcurrentRequests,
  );
  let nextRequestId = 1;
  let disposed = false;

  const emitRequestActivity = (): void => {
    options.onRequestActivityChange?.({
      activeRequestCount: pending.size,
      queuedRequestCount: requestQueue.length,
    });
  };

  const rejectAll = (error: Error): void => {
    for (const handlers of pending.values()) {
      handlers.reject(error);
    }
    pending.clear();
    while (requestQueue.length > 0) {
      requestQueue.shift()?.reject(error);
    }
    emitRequestActivity();
  };

  const flushRequestQueue = (): void => {
    while (
      !disposed
      && pending.size < maxConcurrentRequests
      && requestQueue.length > 0
    ) {
      const queuedRequest = requestQueue.shift();
      if (queuedRequest === undefined) {
        break;
      }

      pending.set(queuedRequest.request.requestId, {
        resolve: queuedRequest.resolve,
        reject: queuedRequest.reject,
      });
      try {
        worker.postMessage(queuedRequest.request);
      } catch (error) {
        pending.delete(queuedRequest.request.requestId);
        queuedRequest.reject(
          error instanceof Error ? error : new Error(String(error)),
        );
      }
    }
    emitRequestActivity();
  };

  worker.addEventListener("message", (event: MessageEvent<WebDavWorkerResponse>) => {
    const handlers = pending.get(event.data.requestId);
    if (handlers === undefined) {
      return;
    }

    pending.delete(event.data.requestId);
    if (event.data.ok) {
      handlers.resolve(event.data.result);
    } else {
      handlers.reject(deserializeWorkerError(event.data.error));
    }

    flushRequestQueue();
  });
  worker.addEventListener("error", (event) => {
    rejectAll(new Error(event.message || "WebDAV worker crashed."));
  });

  const request = <TValue>(operation: WebDavWorkerOperation): Promise<TValue> => {
    if (disposed) {
      return Promise.reject(new Error("WebDAV worker client is disposed."));
    }

    const requestId = nextRequestId;
    nextRequestId += 1;
    const workerRequest: WebDavWorkerRequest = {
      requestId,
      clientOptions,
      debugEnabled: options.readDebugEnabled?.() === true,
      operation,
    };

    return new Promise<TValue>((resolve, reject) => {
      requestQueue.push({
        request: workerRequest,
        resolve: (value) => {
          resolve(value as TValue);
        },
        reject,
      });
      flushRequestQueue();
    });
  };

  return {
    rootPath: normalizeRootPath(options.rootPath ?? "/industrial-planner"),
    exists: async (relativePath) => await request<boolean>({
      type: "exists",
      relativePath,
    }),
    makeDirectory: async (relativePath) => {
      await request<void>({
        type: "make-directory",
        relativePath,
      });
    },
    listDirectory: async (relativePath) => await request<WebDavResourceStat[]>({
      type: "list-directory",
      relativePath,
    }),
    stat: async (relativePath) => await request<WebDavResourceStat | null>({
      type: "stat",
      relativePath,
    }),
    readTextFile: async (relativePath, readOptions = {}) => await request<WebDavTextFile | null>({
      type: "read-text-file",
      relativePath,
      options: readOptions,
    }),
    writeTextFile: async (relativePath, content, writeOptions = {}) => await request<boolean>({
      type: "write-text-file",
      relativePath,
      content,
      options: writeOptions,
    }),
    deleteResource: async (relativePath) => {
      await request<void>({
        type: "delete-resource",
        relativePath,
      });
    },
    dispose: () => {
      if (disposed) {
        return;
      }

      disposed = true;
      rejectAll(new Error("WebDAV worker client is disposed."));
      worker.terminate();
    },
  };
}

function normalizeMaxConcurrentRequests(value: number | undefined): number {
  if (value === undefined || !Number.isFinite(value)) {
    return 4;
  }

  return Math.max(1, Math.round(value));
}

function deserializeWorkerError(value: {
  readonly name: string;
  readonly message: string;
  readonly stack?: string;
  readonly status?: number;
}): Error {
  const error = new Error(value.message) as Error & { status?: number };
  error.name = value.name;
  if (value.stack !== undefined) {
    error.stack = value.stack;
  }
  if (value.status !== undefined) {
    error.status = value.status;
  }

  return error;
}

function normalizeRootPath(path: string): string {
  return normalizeWebDavRootPath(path);
}
