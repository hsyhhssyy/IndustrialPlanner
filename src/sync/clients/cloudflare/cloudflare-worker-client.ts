// Cloudflare 同步 Worker 主线程客户端。
// 管理 Worker 生命周期、并发控制、请求队列与 postMessage 通信。

import type {
  CfWorkerOperation,
  CfWorkerRequest,
  CfWorkerResponse,
} from './cloudflare-worker-protocol';
import { attachWorkerRuntime, type WorkerRuntimeAttachment } from '@/shared/worker/attach-worker-runtime';

export interface CfWorkerClientOptions {
  readonly maxConcurrentRequests?: number;
  readonly requestTimeoutMs?: number;
  readonly onRequestActivityChange?: (activity: CfWorkerRequestActivity) => void;
  readonly workerFactory?: () => Worker;
}

export interface CfWorkerRequestActivity {
  readonly activeRequestCount: number;
  readonly queuedRequestCount: number;
}

export class CfWorkerClient {
  private readonly worker: Worker;
  private readonly runtimeAttachment: WorkerRuntimeAttachment;
  private readonly pending = new Map<number, {
    readonly resolve: (value: unknown) => void;
    readonly reject: (error: Error) => void;
  }>();
  private readonly requestQueue: Array<{
    readonly request: CfWorkerRequest;
    readonly resolve: (value: unknown) => void;
    readonly reject: (error: Error) => void;
  }> = [];
  private readonly maxConcurrent: number;
  private nextRequestId = 1;
  private disposed = false;
  private readonly apiBase: string;
  private readonly requestTimeoutMs: number;
  private readonly maxConcurrentRequests: number;
  private readonly onRequestActivityChange?: (activity: CfWorkerRequestActivity) => void;

  public constructor(
    apiBase: string,
    options: CfWorkerClientOptions = {},
  ) {
    this.apiBase = apiBase;
    this.requestTimeoutMs = normalizeRequestTimeout(options.requestTimeoutMs);
    this.maxConcurrent = normalizeMaxConcurrent(options.maxConcurrentRequests);
    this.maxConcurrentRequests = this.maxConcurrent;
    this.onRequestActivityChange = options.onRequestActivityChange;

    this.worker = options.workerFactory?.() ?? new Worker(
      new URL('./cloudflare-worker.ts', import.meta.url),
      { type: 'module' },
    );
    this.runtimeAttachment = attachWorkerRuntime(this.worker, 'cloudflare', {
      onFault: (fault) => {
        this.rejectAll(new Error(`Cloudflare worker failed: ${fault.message}`));
      },
    });

    this.worker.addEventListener('message', this.handleMessage);
    this.worker.addEventListener('error', this.handleWorkerError);
  }

  // -- 公开方法 -- //

  public request<TResult>(operation: CfWorkerOperation): Promise<TResult> {
    if (this.disposed) {
      return Promise.reject(new Error('Cloudflare worker client is disposed.'));
    }

    const requestId = this.nextRequestId;
    this.nextRequestId += 1;

    const workerRequest: CfWorkerRequest = {
      requestId,
      apiBase: this.apiBase,
      requestTimeoutMs: this.requestTimeoutMs,
      maxConcurrentRequests: this.maxConcurrentRequests,
      operation,
    };

    return new Promise<TResult>((resolve, reject) => {
      this.requestQueue.push({
        request: workerRequest,
        resolve: (value) => resolve(value as TResult),
        reject,
      });
      this.flushQueue();
    });
  }

  public dispose(): void {
    if (this.disposed) return;

    this.disposed = true;
    const error = new Error('Cloudflare worker client is disposed.');
    this.rejectAll(error);
    this.worker.removeEventListener('message', this.handleMessage);
    this.worker.removeEventListener('error', this.handleWorkerError);
    this.runtimeAttachment.dispose();
    this.worker.terminate();
    this.emitActivity();
  }

  // -- 内部方法 -- //

  private readonly handleMessage = (event: MessageEvent<CfWorkerResponse>): void => {
    const handlers = this.pending.get(event.data.requestId);
    if (handlers === undefined) return;

    this.pending.delete(event.data.requestId);

    if (event.data.ok) {
      handlers.resolve(event.data.result);
    } else {
      const err = new Error(event.data.error.message) as Error & {
        status?: number;
        details?: unknown;
      };
      err.name = event.data.error.name;
      if (event.data.error.stack) err.stack = event.data.error.stack;
      if (event.data.error.status !== undefined) err.status = event.data.error.status;
      if (event.data.error.details !== undefined) err.details = event.data.error.details;
      handlers.reject(err);
    }

    this.flushQueue();
  };

  private readonly handleWorkerError = (event: ErrorEvent): void => {
    this.rejectAll(new Error(event.message || 'Cloudflare worker crashed.'));
  };

  private flushQueue(): void {
    while (
      !this.disposed
      && this.pending.size < this.maxConcurrent
      && this.requestQueue.length > 0
    ) {
      const queued = this.requestQueue.shift();
      if (queued === undefined) break;

      this.pending.set(queued.request.requestId, {
        resolve: queued.resolve,
        reject: queued.reject,
      });

      try {
        this.worker.postMessage(queued.request);
      } catch (error) {
        this.pending.delete(queued.request.requestId);
        queued.reject(error instanceof Error ? error : new Error(String(error)));
      }
    }
    this.emitActivity();
  }

  private rejectAll(error: Error): void {
    for (const handlers of this.pending.values()) {
      handlers.reject(error);
    }
    this.pending.clear();
    while (this.requestQueue.length > 0) {
      this.requestQueue.shift()?.reject(error);
    }
    this.emitActivity();
  }

  private emitActivity(): void {
    this.onRequestActivityChange?.({
      activeRequestCount: this.pending.size,
      queuedRequestCount: this.requestQueue.length,
    });
  }
}

function normalizeMaxConcurrent(value: number | undefined): number {
  if (value === undefined || !Number.isFinite(value)) return 4;
  return Math.max(1, Math.min(value, 16));
}

function normalizeRequestTimeout(value: number | undefined): number {
  if (value === undefined || !Number.isFinite(value)) return 30_000;
  return Math.max(1_000, Math.round(value));
}
