import { createLogger } from "@/shared/logging/logger";
import { readDebugModeEnabled } from "@/shared/logging/debug-mode-runtime";
import {
  createWebDavStorageClient,
  type WebDavClientOptions,
  type WebDavStorageClient,
} from "./webdav-client";
import type {
  WebDavWorkerOperation,
  WebDavWorkerRequest,
  WebDavWorkerResponse,
} from "./webdav-worker-protocol";

const logger = createLogger("webdav-worker");

export interface WebDavWorkerRuntimeOptions {
  readonly createClient?: (options: WebDavClientOptions) => WebDavStorageClient;
}

export class WebDavWorkerRuntime {
  private readonly createClient: (options: WebDavClientOptions) => WebDavStorageClient;
  private client: WebDavStorageClient | null = null;
  private clientKey: string | null = null;

  public constructor(options: WebDavWorkerRuntimeOptions = {}) {
    this.createClient = options.createClient ?? createWebDavStorageClient;
  }

  public async handleRequest(request: WebDavWorkerRequest): Promise<WebDavWorkerResponse> {
    // AI-REMOVED 2026-08-08:
    // Reason: 并发请求不能各自修改 Worker 进程级日志级别。
    // Trigger: ST2-RQ-009 将 debugMode 同步移到公共 controlPort。
    // Evidence: maxConcurrentRequests 默认允许四个请求同时执行。
    // Replacement: worker-endpoint.ts 在 bootstrap/control 消息时设置 logger 级别。
    // Risk: Low
    // Human Review: Required
    //
    // Original code:
    // setLogLevel(request.debugEnabled ? "debug" : "silent");
    const debugEnabled = readDebugModeEnabled();
    const startedAt = debugEnabled ? performance.now() : 0;
    const operationLabel = debugEnabled ? formatOperationLabel(request.operation) : "";
    if (debugEnabled) {
      logger.debug(`${operationLabel} → started`);
    }

    try {
      const result = await runOperation(
        this.resolveClient(request.clientOptions),
        request.operation,
      );
      if (debugEnabled) {
        logger.debug(`${operationLabel} → completed in ${formatElapsedMs(startedAt)}ms`);
      }
      return {
        requestId: request.requestId,
        ok: true,
        result,
      };
    } catch (error) {
      const serializedError = serializeWorkerError(error);
      if (debugEnabled) {
        logger.debug(
          `${operationLabel} → failed in ${formatElapsedMs(startedAt)}ms: ${serializedError.message}`,
        );
      }
      return {
        requestId: request.requestId,
        ok: false,
        error: serializedError,
      };
    }
  }

  public dispose(): void {
    this.client?.dispose?.();
    this.client = null;
    this.clientKey = null;
  }

  private resolveClient(options: WebDavClientOptions): WebDavStorageClient {
    const clientKey = JSON.stringify(options);
    if (this.client !== null && this.clientKey === clientKey) {
      return this.client;
    }

    this.client?.dispose?.();
    this.client = this.createClient(options);
    this.clientKey = clientKey;
    return this.client;
  }
}

async function runOperation(
  client: WebDavStorageClient,
  operation: WebDavWorkerOperation,
): Promise<unknown> {
  if (operation.type === "exists") {
    return await client.exists(operation.relativePath);
  }

  if (operation.type === "make-directory") {
    await client.makeDirectory(operation.relativePath);
    return undefined;
  }

  if (operation.type === "list-directory") {
    return await client.listDirectory(operation.relativePath);
  }

  if (operation.type === "stat") {
    return await client.stat(operation.relativePath);
  }

  if (operation.type === "read-text-file") {
    return await client.readTextFile(operation.relativePath, operation.options);
  }

  if (operation.type === "write-text-file") {
    return await client.writeTextFile(
      operation.relativePath,
      operation.content,
      operation.options,
    );
  }

  await client.deleteResource(operation.relativePath);
  return undefined;
}

function formatOperationLabel(operation: WebDavWorkerOperation): string {
  const method = operation.type === "exists" || operation.type === "stat" || operation.type === "list-directory"
    ? "PROPFIND"
    : operation.type === "make-directory"
      ? "MKCOL"
      : operation.type === "read-text-file"
        ? "GET"
        : operation.type === "write-text-file"
          ? "PUT"
          : "DELETE";
  const byteSuffix = operation.type === "write-text-file"
    ? ` (${new Blob([operation.content]).size} bytes)`
    : "";

  return `${method} ${operation.relativePath || "/"}${byteSuffix}`;
}

function formatElapsedMs(startedAt: number): string {
  return Math.max(0, performance.now() - startedAt).toFixed(1);
}

function serializeWorkerError(error: unknown): {
  readonly name: string;
  readonly message: string;
  readonly stack?: string;
  readonly status?: number;
} {
  if (!(error instanceof Error)) {
    return {
      name: "Error",
      message: String(error),
    };
  }

  const status = readErrorStatus(error);
  return {
    name: error.name,
    message: error.message,
    ...(error.stack === undefined ? {} : { stack: error.stack }),
    ...(status === undefined ? {} : { status }),
  };
}

function readErrorStatus(error: Error): number | undefined {
  const status = (error as Error & { readonly status?: unknown }).status;

  return typeof status === "number" && Number.isFinite(status) ? status : undefined;
}
