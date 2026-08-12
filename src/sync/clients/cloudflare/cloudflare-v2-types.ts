// cf-sync-v2 协议类型定义。
// 对应后端 /home/coder/IndustrialPlanner-Backend/packages/sync/src/space_model.ts
// 协议版本: cf-sync-v2，直接 HTTP fetch，不需要 Web Worker。
// AI-CORRECTION 2026-08-12: 协议本身与执行线程无关；浏览器生产链路现由 Dedicated Worker 发起 fetch。

export const CF_SYNC_V2_PROTOCOL = "cf-sync-v2";

/** 服务端 revision 是不透明字符串；客户端只允许比较相等性，不做大小运算。 */
export type CfV2Revision = string;

// ============================================================================
// 后端响应类型
// ============================================================================

export interface CfV2PlanResponse {
  readonly spaceId: string;
  readonly revision: CfV2Revision;
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
  readonly lastModifiedRevision: CfV2Revision;
  readonly downloadUrl: string;
}

export interface CfV2CheckResponse {
  readonly revision: CfV2Revision;
  readonly epoch: number;
  readonly changed: boolean;
  readonly planRequired: boolean;
  readonly serverTime: string;
}

export interface CfV2PrepareRequest {
  readonly protocol: typeof CF_SYNC_V2_PROTOCOL;
  readonly action: "prepare";
  readonly baseRevision: CfV2Revision;
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
  readonly baseRevision: CfV2Revision;
  readonly targetRevision: CfV2Revision;
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
  readonly revision: CfV2Revision;
  readonly epoch: number;
  readonly assets: readonly CfV2CommittedAsset[];
  readonly deletedAssets: readonly CfV2DeletedAsset[];
  readonly serverTime: string;
}

export interface CfV2CommittedAsset {
  readonly assetType: string;
  readonly assetId: string;
  readonly contentHash: string;
  readonly lastModifiedRevision: CfV2Revision;
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
  readonly revision: CfV2Revision;
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
