// Cloudflare cf-sync-v2 Dedicated Worker 协议。
// 这里只传递纯数据；assetId codec 与 SyncRemoteCollection 函数始终留在主线程边界。

import type {
  CfV2PlanAsset,
  CfV2PlanResponse,
  CfV2Revision,
} from "./cloudflare-v2-types";
import type {
  SyncContentHashRequest,
} from "../remote-types";

export interface CfV2WorkerConfig {
  readonly apiBase: string;
  readonly spaceId: string;
  readonly accessToken?: string;
  readonly maxConcurrentRequests: number;
  readonly requestTimeoutMs: number;
}

export interface CfV2WorkerMutation {
  readonly clientMutationId: string;
  readonly operation: "put" | "delete";
  readonly adapterId: string;
  readonly adapterAssetId: string;
  readonly assetType: string;
  readonly assetId: string;
  readonly value: unknown;
  readonly adapterContentHash: string | null;
  readonly deletedAt: string | null;
}

export interface CfV2WorkerAppliedMutation {
  readonly clientMutationId: string;
  readonly adapterId: string;
  readonly adapterAssetId: string;
  readonly assetType: string;
  readonly assetId: string;
  readonly revision: number;
  readonly contentHash: string | null;
  readonly deletedAt: string | null;
  readonly committedAt: string;
}

export interface CfV2CommitBatchResult {
  readonly revision: CfV2Revision;
  readonly applied: readonly CfV2WorkerAppliedMutation[];
  readonly recovered: boolean;
}

export interface CfV2ReadAssetResult {
  readonly revision: number;
  readonly value: unknown;
  readonly contentHash: string;
  readonly committedAt: string;
}

export interface CfV2TransactionRecoveryResult {
  readonly recovered: boolean;
  readonly commit: CfV2CommitBatchResult | null;
}

export type CfV2WorkerOperation =
  | {
      readonly type: "recover-pending-upload";
    }
  | {
      readonly type: "ack-pending-upload";
    }
  | {
      readonly type: "compute-content-hashes";
      readonly requests: readonly SyncContentHashRequest[];
    }
  | {
      readonly type: "load-plan";
    }
  | {
      readonly type: "check";
      readonly knownRevision: string;
    }
  | {
      readonly type: "read-asset";
      readonly asset: CfV2PlanAsset;
      readonly planRevision: CfV2Revision;
      readonly planServerTime: string;
    }
  | {
      readonly type: "commit-batch";
      readonly baseRevision: CfV2Revision;
      readonly clientBatchId: string;
      readonly mutations: readonly CfV2WorkerMutation[];
    }
  | {
      readonly type: "reset-remote";
    }
  | {
      readonly type: "abort-transaction";
    }
  | {
      readonly type: "state-read-applied-revision";
    }
  | {
      readonly type: "state-write-applied-revision";
      readonly revision: string;
    }
  | {
      readonly type: "state-get-last-synced-hash";
      readonly assetKey: string;
    }
  | {
      readonly type: "state-set-last-synced-hash";
      readonly assetKey: string;
      readonly hash: string | null;
    }
  | {
      readonly type: "state-get-remote-revision";
      readonly key: string;
    }
  | {
      readonly type: "state-set-remote-revision";
      readonly key: string;
      readonly revision: number | null;
    }
  | {
      readonly type: "state-get-remote-etag";
      readonly key: string;
    }
  | {
      readonly type: "state-set-remote-etag";
      readonly key: string;
      readonly etag: string | null;
    }
  | {
      readonly type: "state-read-comparable-hashes";
      readonly assets: readonly {
        readonly assetKey: string;
        readonly protocolContentHash: string;
      }[];
    }
  | {
      readonly type: "state-note-remote-hash";
      readonly assetKey: string;
      readonly protocolContentHash: string;
      readonly adapterContentHash?: string;
    }
  | {
      readonly type: "state-reset";
    };

export interface CfV2WorkerRequest {
  readonly requestId: number;
  readonly config: CfV2WorkerConfig;
  readonly operation: CfV2WorkerOperation;
}

export interface CfV2WorkerError {
  readonly name: string;
  readonly message: string;
  readonly stack?: string;
  readonly status?: number;
  readonly code?: string;
  readonly details?: unknown;
}

export type CfV2WorkerResponse =
  | {
      readonly requestId: number;
      readonly activity: {
        readonly activeRequestCount: number;
        readonly queuedRequestCount: number;
      };
    }
  | {
      readonly requestId: number;
      readonly ok: true;
      readonly result: unknown;
    }
  | {
      readonly requestId: number;
      readonly ok: false;
      readonly error: CfV2WorkerError;
    };

export type CfV2LoadPlanResult = CfV2PlanResponse;
