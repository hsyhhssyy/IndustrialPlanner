// cf-sync-v2 协议类型定义。
// 对应后端 /home/coder/IndustrialPlanner-Backend/packages/sync/src/space_model.ts
// 协议版本: cf-sync-v2，直接 HTTP fetch，不需要 Web Worker。

export const CF_SYNC_V2_PROTOCOL = "cf-sync-v2";

// ============================================================================
// 后端响应类型
// ============================================================================

export interface CfV2PlanResponse {
  readonly spaceId: string;
  readonly revision: number;
  readonly epoch: number;
  readonly assets: readonly CfV2PlanAsset[];
  readonly serverTime: string;
}

export interface CfV2PlanAsset {
  readonly assetType: string;
  readonly assetId: string;
  readonly contentHash: string; // SHA-256 hex
  readonly byteSize: number;
  readonly encoding: string;
  readonly metadata: string;
  readonly schemaVersion: number;
  readonly storageMode: "full";
  readonly backend: "d1" | "r2";
  readonly lastModifiedRevision: number;
  readonly downloadUrl: string;
}

export interface CfV2CheckResponse {
  readonly revision: number;
  readonly epoch: number;
  readonly changed: boolean;
  readonly planRequired: boolean;
  readonly serverTime: string;
}

export interface CfV2PrepareRequest {
  readonly protocol: typeof CF_SYNC_V2_PROTOCOL;
  readonly action: "prepare";
  readonly baseRevision: number;
  readonly clientBatchId: string;
  readonly objects: readonly CfV2PrepareObject[];
  readonly deletions: readonly CfV2PrepareDeletion[];
}

export interface CfV2PrepareObject {
  readonly clientMutationId: string;
  readonly assetType: string;
  readonly assetId: string;
  readonly metadata: string;
  readonly blobHash: string;
  readonly blobByteSize: number;
  readonly storageMode: "full";
  readonly schemaVersion: number;
  readonly encoding: "identity";
  readonly writerAppVersion: string;
  readonly writerBuildId: string;
}

export interface CfV2PrepareDeletion {
  readonly clientMutationId: string;
  readonly assetType: string;
  readonly assetId: string;
}

export interface CfV2PrepareResponse {
  readonly status: "ready";
  readonly uploadId: string;
  readonly commitToken: string;
  readonly baseRevision: number;
  readonly targetRevision: number;
  readonly targetEpoch: number;
  readonly expiresAt: string;
  readonly uploads: readonly CfV2UploadInstruction[];
}

export interface CfV2UploadInstruction {
  readonly assetType: string;
  readonly assetId: string;
  readonly required: boolean;
  readonly backend: "d1" | "r2";
  readonly url?: string;
  readonly headers?: Record<string, string>;
}

export interface CfV2CommitRequest {
  readonly protocol: typeof CF_SYNC_V2_PROTOCOL;
  readonly action: "commit";
  readonly uploadId: string;
  readonly commitToken: string;
}

export interface CfV2CancelRequest {
  readonly protocol: typeof CF_SYNC_V2_PROTOCOL;
  readonly action: "cancel";
  readonly uploadId: string;
  readonly commitToken: string;
}

export interface CfV2CommitResult {
  readonly status: "committed" | "already-committed";
  readonly uploadId: string;
  readonly revision: number;
  readonly epoch: number;
  readonly assets: readonly CfV2CommittedAsset[];
  readonly deletedAssets: readonly CfV2DeletedAsset[];
  readonly serverTime: string;
}

export interface CfV2CommittedAsset {
  readonly assetType: string;
  readonly assetId: string;
  readonly contentHash: string;
  readonly lastModifiedRevision: number;
}

export interface CfV2DeletedAsset {
  readonly assetType: string;
  readonly assetId: string;
}

export interface CfV2CancelResult {
  readonly status: "cancelled" | "already-cancelled";
  readonly uploadId: string;
}

export interface CfV2CreateSpaceResult {
  readonly ok: boolean;
  readonly spaceId: string;
  readonly revision: number;
  readonly epoch: number;
  readonly createdAt: string;
}

export interface CfV2Capabilities {
  readonly protocol: string;
  readonly concurrency: string;
  readonly uploadTtlSeconds: number;
  readonly maxMutationsPerBatch: number;
  readonly maxMetadataSize: number;
  readonly supportedStorageModes: readonly string[];
  readonly supportedEncodings: readonly string[];
  readonly schemaVersions: readonly number[];
  readonly r2EnterThresholdBytes: number;
  readonly d1ReturnThresholdBytes: number;
  readonly maxR2BlobBytes: number;
}

// ============================================================================
// API 错误类型
// ============================================================================

export interface CfV2ApiError {
  readonly error: string;
  readonly message: string;
  readonly details?: Record<string, unknown>;
}

export class CfV2HttpError extends Error {
  public constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
    public readonly details?: Record<string, unknown>,
  ) {
    super(message);
    this.name = "CfV2HttpError";
  }
}
