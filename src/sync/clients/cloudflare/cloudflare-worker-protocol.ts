// Cloudflare 同步 Worker 协议类型定义。
// 定义主线程与 Worker 之间通信的消息格式。

// -- Worker 操作类型 -- //

export type CfWorkerOperation =
  | {
      readonly type: 'prefetch-indexes';
      readonly spaceId: string;
      readonly appliedHead: number | null;
      readonly epoch: string | null;
    }
  | {
      readonly type: 'read-asset';
      readonly spaceId: string;
      readonly assetType: string;
      readonly assetId: string;
      readonly blobHash: string;
      readonly contentHash: string | null;
      readonly revision: number;
      readonly deletedAt: string | null;
    }
  | {
      readonly type: 'check-collections';
      readonly spaceId: string;
      readonly appliedHead: number | null;
      readonly epoch: string | null;
      readonly assetTypes: readonly string[];
    }
  | {
      readonly type: 'commit-batch';
      readonly spaceId: string;
      readonly epoch: string;
      readonly clientBatchId: string;
      readonly mutations: readonly CfWorkerMutationRecord[];
    }
  | {
      readonly type: 'ensure-space';
      readonly spaceId: string;
    }
  | {
      readonly type: 'reset-remote';
      readonly spaceId: string;
    };

export interface CfWorkerMutationRecord {
  readonly clientMutationId: string;
  readonly assetType: string;
  readonly assetId: string;
  readonly content: string | null;
  readonly contentHash: string | null;
}

// -- Worker 请求/响应 -- //

export interface CfWorkerRequest {
  readonly requestId: number;
  readonly apiBase: string;
  readonly operation: CfWorkerOperation;
}

export interface CfWorkerError {
  readonly name: string;
  readonly message: string;
  readonly stack?: string;
  readonly status?: number;
}

export type CfWorkerResponse =
  | {
      readonly requestId: number;
      readonly ok: true;
      readonly result: unknown;
    }
  | {
      readonly requestId: number;
      readonly ok: false;
      readonly error: CfWorkerError;
    };

// -- 各操作的结果类型（供 Worker 内运行时返回给主线程） -- //

export interface CfPrefetchIndexesResult {
  readonly plan: CfWorkerPlanResponse | null;
  readonly epoch: string | null;
}

export interface CfReadAssetResult {
  readonly revision: number;
  readonly content: string;
  readonly contentHash: string;
}

export interface CfCheckCollectionsResult {
  readonly changedAssetTypes: string[];
  readonly epoch: string | null;
}

export interface CfCommitBatchResult {
  readonly head: number;
  readonly epoch: string | null;
  readonly applied: readonly CfWorkerAppliedMutation[];
}

export interface CfWorkerAppliedMutation {
  readonly clientMutationId: string;
  readonly assetType: string;
  readonly assetId: string;
  readonly revision: number;
  readonly contentHash: string;
}

export interface CfEnsureSpaceResult {
  readonly spaceId: string;
  readonly epoch: string | null;
}

// -- Worker 内使用的后端协议类型 -- //

export interface CfWorkerPlanResponse {
  readonly head: number;
  readonly epoch: string;
  readonly snapshotHead: number;
  readonly modules: readonly CfWorkerPlanModule[];
  readonly capabilities: Record<string, unknown>;
  readonly nextPageToken: string | null;
  readonly minRetainedHead: number;
  readonly serverTime: string;
}

export interface CfWorkerPlanModule {
  readonly moduleType: string;
  readonly assets: readonly CfWorkerPlanAsset[];
}

export interface CfWorkerPlanAsset {
  readonly assetType: string;
  readonly assetId: string;
  readonly revision: number;
  readonly contentHash: string;
  readonly blobHash: string;
  readonly byteSize: number;
  readonly deletedAt: string | null;
}

export interface CfWorkerCheckResponse {
  readonly head: number;
  readonly epoch: string;
  readonly changed: boolean;
  readonly planRequired: boolean;
  readonly changes: readonly CfWorkerPlanAsset[];
  readonly moduleHeads: readonly { readonly moduleType: string; readonly head: number }[];
  readonly serverTime: string;
}

export interface CfWorkerPrepareResponse {
  readonly status: 'ready';
  readonly commitToken: string;
  readonly uploads: readonly CfWorkerUploadSlot[];
}

export interface CfWorkerUploadSlot {
  readonly assetType: string;
  readonly assetId: string;
  readonly required: boolean;
  readonly url?: string | null;
  readonly headers?: Record<string, string>;
}

export interface CfWorkerDownloadSignResponse {
  readonly urls: readonly { readonly blobHash: string; readonly url: string }[];
}

export interface CfWorkerCommitResponse {
  readonly status: 'committed' | 'already-committed';
  readonly head: number;
  readonly applied: readonly CfWorkerAppliedMutation[];
  readonly serverTime: string;
}
