import type {
  WebDavClientOptions,
  WebDavReadOptions,
  WebDavWriteOptions,
} from "./webdav-client";

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
    readonly options: WebDavReadOptions;
  }
  | {
    readonly type: "write-text-file";
    readonly relativePath: string;
    readonly content: string;
    readonly options: WebDavWriteOptions;
  }
  | {
    readonly type: "delete-resource";
    readonly relativePath: string;
  };

export interface WebDavWorkerRequest {
  readonly requestId: number;
  readonly clientOptions: WebDavClientOptions;
  readonly debugEnabled: boolean;
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
