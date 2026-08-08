import type {
  SyncClientOptions,
  SyncReadOptions,
  SyncWriteOptions,
} from "../types";

export type WebDavWorkerOperation =
  | {
    readonly type: "exists";
    readonly relativePath: string;
  }
  | {
    readonly type: "make-directory";
    readonly relativePath: string;
  }
  | {
    readonly type: "list-directory";
    readonly relativePath: string;
  }
  | {
    readonly type: "stat";
    readonly relativePath: string;
  }
  | {
    readonly type: "read-text-file";
    readonly relativePath: string;
    readonly options: SyncReadOptions;
  }
  | {
    readonly type: "write-text-file";
    readonly relativePath: string;
    readonly content: string;
    readonly options: SyncWriteOptions;
  }
  | {
    readonly type: "delete-resource";
    readonly relativePath: string;
  };

export interface WebDavWorkerRequest {
  readonly requestId: number;
  readonly clientOptions: SyncClientOptions;
  // AI-REMOVED 2026-08-08:
  // Reason: 每请求 debugEnabled 会在并发请求间争用 Worker 全局 logger 级别。
  // Trigger: ST2-RQ-009 改由 controlPort 同步唯一 debugMode 设置。
  // Evidence: WebDavWorkerRuntime 原先在每次 handleRequest 开头调用 setLogLevel。
  // Replacement: WorkerBootstrapV1.debugModeEnabled + debug-mode-changed。
  // Risk: Low；日志级别现在按 Worker 生命周期更新，而不是按请求更新。
  // Human Review: Required
  //
  // Original code:
  // readonly debugEnabled: boolean;
  readonly operation: WebDavWorkerOperation;
}

export interface WebDavWorkerError {
  readonly name: string;
  readonly message: string;
  readonly stack?: string;
  readonly status?: number;
}

export type WebDavWorkerResponse =
  | {
    readonly requestId: number;
    readonly ok: true;
    readonly result: unknown;
  }
  | {
    readonly requestId: number;
    readonly ok: false;
    readonly error: WebDavWorkerError;
  };
