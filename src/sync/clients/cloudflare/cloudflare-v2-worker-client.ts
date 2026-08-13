import {
  attachWorkerRuntime,
  type WorkerRuntimeAttachment,
} from "@/shared/worker/attach-worker-runtime";
import { createLogger } from "@/shared/logging/logger";

import type {
  CfV2WorkerConfig,
  CfV2WorkerError,
  CfV2WorkerOperation,
  CfV2WorkerRequest,
  CfV2WorkerResponse,
} from "./cloudflare-v2-worker-protocol";
import type { CloudflareV2WorkerRuntime } from "./cloudflare-v2-worker-runtime";
import { CfV2HttpError } from "./cloudflare-v2-types";

const logger = createLogger("cf-v2-worker-client");

export interface CloudflareV2WorkerActivity {
  readonly activeRequestCount: number;
  readonly queuedRequestCount: number;
}

export interface CloudflareV2WorkerClientOptions {
  readonly workerFactory?: () => Worker;
  readonly runtimeFactory?: () => CloudflareV2WorkerRuntime;
}

interface QueuedRequest {
  readonly request: CfV2WorkerRequest;
  readonly resolve: (value: unknown) => void;
  readonly reject: (error: Error) => void;
  readonly onActivity?: (activity: CloudflareV2WorkerActivity) => void;
}

export interface CloudflareV2WorkerBridge {
  request<TResult>(
    config: CfV2WorkerConfig,
    operation: CfV2WorkerOperation,
    onActivity?: (activity: CloudflareV2WorkerActivity) => void,
  ): Promise<TResult>;
  dispose(): void;
}

/**
 * 长生命周期 Cloudflare Worker 传输层。
 *
 * SyncRemote 会话结束不会终止它；只有 SyncHost 销毁时才 dispose。Worker 崩溃后，当前请求
 * 失败并释放实例，下一次请求会创建新 Worker，由持久上传日志继续事务。
 */
export class CloudflareV2WorkerClient implements CloudflareV2WorkerBridge {
  private worker: Worker | null = null;
  private runtimeAttachment: WorkerRuntimeAttachment | null = null;
  private readonly inProcessRuntime: CloudflareV2WorkerRuntime | null;
  private readonly pending = new Map<number, QueuedRequest>();
  private readonly queue: QueuedRequest[] = [];
  private nextRequestId = 1;
  private disposed = false;

  public constructor(private readonly options: CloudflareV2WorkerClientOptions = {}) {
    if (typeof Worker === "undefined" && options.workerFactory === undefined) {
      if (options.runtimeFactory === undefined) {
        throw new Error("Cloudflare sync requires Dedicated Worker support.");
      }
      this.inProcessRuntime = options.runtimeFactory();
    } else {
      this.inProcessRuntime = null;
    }
  }

  public request<TResult>(
    config: CfV2WorkerConfig,
    operation: CfV2WorkerOperation,
    onActivity?: (activity: CloudflareV2WorkerActivity) => void,
  ): Promise<TResult> {
    if (this.disposed) {
      return Promise.reject(new Error("Cloudflare worker client is disposed."));
    }
    const request: CfV2WorkerRequest = {
      requestId: this.nextRequestId,
      config,
      operation,
    };
    this.nextRequestId += 1;
    return new Promise<TResult>((resolve, reject) => {
      this.queue.push({
        request,
        resolve: (value) => resolve(value as TResult),
        reject,
        ...(onActivity === undefined ? {} : { onActivity }),
      });
      this.flush();
    });
  }

  public dispose(): void {
    if (this.disposed) {
      return;
    }
    this.disposed = true;
    this.rejectAll(new Error("Cloudflare worker client is disposed."));
    this.destroyWorker();
  }

  private flush(): void {
    const first = this.queue[0];
    const concurrency = first === undefined
      ? 1
      : normalizeConcurrency(first.request.config.maxConcurrentRequests);
    while (!this.disposed && this.pending.size < concurrency && this.queue.length > 0) {
      const queued = this.queue.shift();
      if (queued === undefined) {
        break;
      }
      this.pending.set(queued.request.requestId, queued);
      queued.onActivity?.({
        activeRequestCount: this.pending.size,
        queuedRequestCount: this.queue.length,
      });
      if (this.inProcessRuntime !== null) {
        void this.inProcessRuntime.execute(
          queued.request.config,
          queued.request.operation,
          (activity) => queued.onActivity?.(activity),
        ).then(
          (result) => this.finish(queued.request.requestId, null, result),
          (error) => this.finish(
            queued.request.requestId,
            error instanceof Error ? error : new Error(String(error)),
          ),
        );
        continue;
      }
      try {
        const worker = this.ensureWorker();
        worker.postMessage(queued.request);
      } catch (error) {
        logger.debug(
          `postMessage failed for requestId=${queued.request.requestId} ` +
          `op=${queued.request.operation.type} ` +
          `workerAlive=${this.worker !== null} ` +
          `jsonSerializable=${isJsonSerializable(queued.request)} ` +
          `error=${error instanceof Error ? error.message : String(error)}`,
        );
        // postMessage 克隆失败意味着 Worker 可能已处于异常状态，销毁以便下轮重建
        this.destroyWorker();
        this.finish(
          queued.request.requestId,
          error instanceof Error ? error : new Error(String(error)),
        );
      }
    }
  }

  private ensureWorker(): Worker {
    if (this.worker !== null) {
      return this.worker;
    }
    const worker = this.options.workerFactory?.() ?? new Worker(
      new URL("./cloudflare-v2-worker.ts", import.meta.url),
      { type: "module", name: "cloudflare-sync-v2" },
    );
    worker.addEventListener("message", this.handleMessage);
    worker.addEventListener("error", this.handleWorkerError);
    this.runtimeAttachment = attachWorkerRuntime(worker, "cloudflare", {
      onFault: (fault) => {
        this.handleWorkerFailure(new Error(`Cloudflare worker failed: ${fault.message}`));
      },
    });
    this.worker = worker;
    return worker;
  }

  private readonly handleMessage = (event: MessageEvent<CfV2WorkerResponse>): void => {
    const queued = this.pending.get(event.data.requestId);
    if (queued === undefined) {
      return;
    }
    if ("activity" in event.data) {
      queued.onActivity?.(event.data.activity);
      return;
    }
    if (event.data.ok) {
      this.finish(event.data.requestId, null, event.data.result);
    } else {
      this.finish(event.data.requestId, deserializeError(event.data.error));
    }
  };

  private readonly handleWorkerError = (event: ErrorEvent): void => {
    this.handleWorkerFailure(new Error(event.message || "Cloudflare worker crashed."));
  };

  private handleWorkerFailure(error: Error): void {
    this.rejectAll(error);
    this.destroyWorker();
  }

  private finish(requestId: number, error: Error | null, result?: unknown): void {
    const queued = this.pending.get(requestId);
    if (queued === undefined) {
      return;
    }
    this.pending.delete(requestId);
    queued.onActivity?.({ activeRequestCount: 0, queuedRequestCount: 0 });
    if (error === null) {
      queued.resolve(result);
    } else {
      queued.reject(error);
    }
    this.flush();
  }

  private rejectAll(error: Error): void {
    for (const queued of this.pending.values()) {
      queued.onActivity?.({ activeRequestCount: 0, queuedRequestCount: 0 });
      queued.reject(error);
    }
    this.pending.clear();
    while (this.queue.length > 0) {
      const queued = this.queue.shift();
      queued?.onActivity?.({ activeRequestCount: 0, queuedRequestCount: 0 });
      queued?.reject(error);
    }
  }

  private destroyWorker(): void {
    if (this.worker !== null) {
      this.worker.removeEventListener("message", this.handleMessage);
      this.worker.removeEventListener("error", this.handleWorkerError);
      this.worker.terminate();
      this.worker = null;
    }
    this.runtimeAttachment?.dispose();
    this.runtimeAttachment = null;
  }
}

function deserializeError(value: CfV2WorkerError): Error {
  const error = value.status === undefined
    ? new Error(value.message)
    : new CfV2HttpError(
        value.status,
        value.code ?? "unknown",
        value.message,
        isRecord(value.details) ? value.details : undefined,
      );
  error.name = value.name;
  if (value.stack !== undefined) {
    error.stack = value.stack;
  }
  return error;
}

function isJsonSerializable(value: unknown): boolean {
  try {
    JSON.stringify(value);
    return true;
  } catch {
    return false;
  }
}

function normalizeConcurrency(value: number): number {
  return Number.isFinite(value) ? Math.max(1, Math.min(16, Math.round(value))) : 4;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
