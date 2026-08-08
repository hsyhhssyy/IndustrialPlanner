// Cloudflare 同步 Worker 运行时。
// 在 Worker 线程内处理所有网络 I/O + JSON 解析 + SHA-256 哈希计算。

import { createSha256CanonicalHash } from '@/shared/storage/hash-utils';
import { createUuid } from '@/domain/shared/uuid';
import type {
  CfWorkerRequest,
  CfWorkerResponse,
  CfWorkerOperation,
  CfPrefetchIndexesResult,
  CfReadAssetResult,
  CfCheckCollectionsResult,
  CfCommitBatchResult,
  CfEnsureSpaceResult,
  CfWorkerPlanResponse,
  CfWorkerCheckResponse,
  CfWorkerPrepareResponse,
  CfWorkerDownloadSignResponse,
  CfWorkerCommitResponse,
  CfWorkerMutationRecord,
} from './cloudflare-worker-protocol';

// ============================================================================
// 主入口
// ============================================================================

export async function handleCfRequest(request: CfWorkerRequest): Promise<CfWorkerResponse> {
  const startedAt = performance.now();
  const label = formatOperationLabel(request.operation);

  try {
    const result = await executeOperation(request.apiBase, request.operation);
    const elapsed = Math.max(0, performance.now() - startedAt).toFixed(1);
    return {
      requestId: request.requestId,
      ok: true,
      result,
    };
  } catch (error) {
    const elapsed = Math.max(0, performance.now() - startedAt).toFixed(1);
    return {
      requestId: request.requestId,
      ok: false,
      error: serializeError(error),
    };
  }
}

// ============================================================================
// 操作分发
// ============================================================================

async function executeOperation(
  apiBase: string,
  operation: CfWorkerOperation,
): Promise<unknown> {
  switch (operation.type) {
    case 'prefetch-indexes':
      return await doPrefetchIndexes(apiBase, operation.spaceId, operation.appliedHead, operation.epoch);
    case 'read-asset':
      return await doReadAsset(apiBase, operation);
    case 'check-collections':
      return await doCheckCollections(apiBase, operation.spaceId, operation.appliedHead, operation.epoch, operation.assetTypes);
    case 'commit-batch':
      return await doCommitBatch(apiBase, operation.spaceId, operation.epoch, operation.clientBatchId, operation.mutations);
    case 'ensure-space':
      return await doEnsureSpace(apiBase, operation.spaceId);
    case 'reset-remote':
      await doResetRemote(apiBase, operation.spaceId);
      return undefined;
  }
}

// ============================================================================
// prefetch-indexes
// ============================================================================

async function doPrefetchIndexes(
  apiBase: string,
  spaceId: string,
  appliedHead: number | null,
  epoch: string | null,
): Promise<CfPrefetchIndexesResult> {
  const params = new URLSearchParams();
  params.set('mode', appliedHead === null ? 'full' : 'incremental');
  if (epoch !== null) params.set('epoch', epoch);
  if (appliedHead !== null) params.set('cursor', String(appliedHead));

  const url = `${apiBase}/v1/sync/spaces/${spaceId}/plan?${params.toString()}`;
  const response = await fetch(url, { cache: 'no-store' });

  if (!response.ok) {
    return { plan: null, epoch: null };
  }

  const plan = await response.json() as CfWorkerPlanResponse;
  return { plan, epoch: plan.epoch ?? null };
}

// ============================================================================
// read-asset
// ============================================================================

async function doReadAsset(
  apiBase: string,
  params: CfWorkerOperation & { type: 'read-asset' },
): Promise<CfReadAssetResult | null> {
  const { spaceId, blobHash, contentHash } = params;

  // 无 blob hash 且无内容 hash — 空资产
  if (!blobHash && !contentHash) {
    return {
      revision: params.revision,
      content: '',
      contentHash: '',
    };
  }

  // 获取下载签名 URL
  const signUrl = `${apiBase}/v1/sync/spaces/${spaceId}/downloads:sign`;
  const signResp = await fetch(signUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ blobHashes: [blobHash] }),
    cache: 'no-store',
  });

  if (!signResp.ok) return null;

  const signResult = await signResp.json() as CfWorkerDownloadSignResponse;
  const downloadUrl = signResult.urls[0]?.url ?? null;
  if (downloadUrl === null) return null;

  // 下载 blob
  const dlResp = await fetch(downloadUrl, { cache: 'no-store' });
  if (!dlResp.ok) return null;

  const content = await dlResp.text();

  // SHA-256 校验
  const computedHash = await createSha256CanonicalHash(JSON.parse(content));
  const expectedHash = computedHash.startsWith('sha256:')
    ? computedHash.slice(7)
    : computedHash;

  if (expectedHash !== blobHash) return null;

  return {
    revision: params.revision,
    content,
    contentHash: contentHash ?? '',
  };
}

// ============================================================================
// check-collections
// ============================================================================

async function doCheckCollections(
  apiBase: string,
  spaceId: string,
  appliedHead: number | null,
  epoch: string | null,
  assetTypes: readonly string[],
): Promise<CfCheckCollectionsResult> {
  const params = new URLSearchParams();
  if (epoch !== null) params.set('epoch', epoch);
  if (appliedHead !== null) params.set('cursor', String(appliedHead));

  const url = `${apiBase}/v1/sync/spaces/${spaceId}/check?${params.toString()}`;
  const response = await fetch(url, { cache: 'no-store' });

  if (response.status === 204) {
    return { changedAssetTypes: [], epoch: null };
  }

  if (!response.ok) {
    return { changedAssetTypes: [], epoch: null };
  }

  const result = await response.json() as CfWorkerCheckResponse;

  if (!result.changed || result.changes.length === 0) {
    return { changedAssetTypes: [], epoch: result.epoch ?? null };
  }

  const changedAssetTypes: string[] = [];
  for (const change of result.changes) {
    if (assetTypes.includes(change.assetType) && !changedAssetTypes.includes(change.assetType)) {
      changedAssetTypes.push(change.assetType);
    }
  }

  return { changedAssetTypes, epoch: result.epoch ?? null };
}

// ============================================================================
// commit-batch
// ============================================================================

async function doCommitBatch(
  apiBase: string,
  spaceId: string,
  epoch: string,
  clientBatchId: string,
  mutations: readonly CfWorkerMutationRecord[],
): Promise<CfCommitBatchResult> {
  // Step 0: 对每个 mutation 计算 blobHash
  const mutationRecords = await Promise.all(mutations.map(async (m) => {
    const mutationId = createUuid();
    let blobHash = '';
    let blobByteSize = 0;
    if (m.content !== null) {
      const contentBytes = new TextEncoder().encode(m.content);
      blobByteSize = contentBytes.length;
      blobHash = await createSha256CanonicalHash(JSON.parse(m.content));
      blobHash = blobHash.startsWith('sha256:') ? blobHash.slice(7) : blobHash;
    }
    return {
      clientMutationId: mutationId,
      assetType: m.assetType,
      assetId: m.assetId,
      blobHash,
      blobByteSize,
      content: m.content,
      contentHash: m.contentHash,
    };
  }));

  const mutationsUrl = `${apiBase}/v1/sync/spaces/${spaceId}/mutations`;

  // 最多重试一次：首次用传入 epoch，409 时刷新 epoch 后重试
  let currentEpoch = epoch;
  for (let attempt = 0; attempt < 2; attempt++) {
    // Step 1: POST /prepare
    const prepareBody = {
      protocol: 'cf-sync-v1',
      action: 'prepare',
      spaceEpoch: currentEpoch ?? '',
      clientBatchId,
      mutations: mutationRecords.map((r) => ({
        clientMutationId: r.clientMutationId,
        assetType: r.assetType,
        assetId: r.assetId,
        baseRevision: null,
        baseContentHash: null,
        metadata: '{}',
        blobHash: r.blobHash,
        blobByteSize: r.blobByteSize,
        storageMode: 'full',
        schemaVersion: 1,
        encoding: 'identity',
        writerAppVersion: '0.1.0',
        writerBuildId: 'dev',
      })),
    };

    const prepareResp = await fetch(mutationsUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(prepareBody),
      cache: 'no-store',
    });

    if (prepareResp.status === 409) {
      // epoch 冲突：从 check 端点获取最新 epoch 后重试
      const checkUrl = `${apiBase}/v1/sync/spaces/${spaceId}/check`;
      const checkResp = await fetch(checkUrl, { cache: 'no-store' });
      if (checkResp.ok) {
        const checkResult = await checkResp.json() as CfWorkerCheckResponse;
        if (checkResult.epoch && checkResult.epoch !== currentEpoch) {
          currentEpoch = checkResult.epoch;
          continue;
        }
      }
      throw new Error(`Prepare failed: HTTP 409 (epoch conflict)`);
    }

    if (!prepareResp.ok) {
      throw new Error(`Prepare failed: HTTP ${prepareResp.status}`);
    }

    const prepareResult = await prepareResp.json() as CfWorkerPrepareResponse;

    // Step 2: R2 PUT
    for (const upload of prepareResult.uploads) {
      if (!upload.required || !upload.url) continue;
      const rec = mutationRecords.find(
        (r) => r.assetType === upload.assetType && r.assetId === upload.assetId,
      );
      if (!rec || rec.content === null) continue;

      const headers: Record<string, string> = upload.headers ?? {};
      await fetch(upload.url, {
        method: 'PUT',
        headers,
        body: rec.content,
        cache: 'no-store',
      });
    }

    // Step 3: POST /commit
    const commitBody = {
      protocol: 'cf-sync-v1',
      action: 'commit',
      spaceEpoch: currentEpoch ?? '',
      clientBatchId,
      commitToken: prepareResult.commitToken,
      mutations: mutationRecords.map((r) => ({
        clientMutationId: r.clientMutationId,
        assetType: r.assetType,
        assetId: r.assetId,
      })),
    };

    const commitResp = await fetch(mutationsUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(commitBody),
      cache: 'no-store',
    });

    if (commitResp.status === 409) {
      const checkUrl = `${apiBase}/v1/sync/spaces/${spaceId}/check`;
      const checkResp = await fetch(checkUrl, { cache: 'no-store' });
      if (checkResp.ok) {
        const checkResult = await checkResp.json() as CfWorkerCheckResponse;
        if (checkResult.epoch && checkResult.epoch !== currentEpoch) {
          currentEpoch = checkResult.epoch;
          continue;
        }
      }
      throw new Error(`Commit failed: HTTP 409 (epoch conflict)`);
    }

    if (!commitResp.ok) {
      throw new Error(`Commit failed: HTTP ${commitResp.status}`);
    }

    const commitResult = await commitResp.json() as CfWorkerCommitResponse;

    return {
      head: commitResult.head,
      epoch: currentEpoch !== epoch ? currentEpoch : null,
      applied: commitResult.applied.map((a) => ({
        clientMutationId: a.clientMutationId,
        assetType: a.assetType,
        assetId: a.assetId,
        revision: a.revision,
        contentHash: a.contentHash,
      })),
    };
  }

  throw new Error(`Commit failed: epoch conflict not resolved after retry`);
}

// ============================================================================
// ensure-space
// ============================================================================

async function doEnsureSpace(
  apiBase: string,
  spaceId: string,
): Promise<CfEnsureSpaceResult> {
  const checkUrl = `${apiBase}/v1/sync/spaces/${spaceId}/check`;
  const checkResp = await fetch(checkUrl, { cache: 'no-store' });

  if (checkResp.status === 404) {
    // 空间不存在，自动创建
    const createUrl = `${apiBase}/v1/sync/spaces`;
    const createResp = await fetch(createUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ spaceId }),
      cache: 'no-store',
    });
    if (createResp.ok) {
      const created = await createResp.json() as { activeEpoch: string };
      return { spaceId, epoch: created.activeEpoch ?? null };
    }
  }

  return { spaceId, epoch: null };
}

// ============================================================================
// reset-remote
// ============================================================================

async function doResetRemote(apiBase: string, spaceId: string): Promise<void> {
  await fetch(
    `${apiBase}/v1/sync/spaces/${spaceId}/reset`,
    { method: 'POST', cache: 'no-store' },
  );
}

// ============================================================================
// 辅助函数
// ============================================================================

function formatOperationLabel(operation: CfWorkerOperation): string {
  switch (operation.type) {
    case 'prefetch-indexes':
      return `PLAN ${operation.spaceId}`;
    case 'read-asset':
      return `DOWNLOAD ${operation.assetType}/${operation.assetId}`;
    case 'check-collections':
      return `CHECK ${operation.spaceId}`;
    case 'commit-batch':
      return `COMMIT ${operation.spaceId} (${operation.mutations.length} mutations)`;
    case 'ensure-space':
      return `ENSURE ${operation.spaceId}`;
    case 'reset-remote':
      return `RESET ${operation.spaceId}`;
  }
}

function serializeError(error: unknown): {
  readonly name: string;
  readonly message: string;
  readonly stack?: string;
  readonly status?: number;
} {
  if (!(error instanceof Error)) {
    return { name: 'Error', message: String(error) };
  }

  const status = (error as Error & { readonly status?: unknown }).status;
  return {
    name: error.name,
    message: error.message,
    ...(error.stack === undefined ? {} : { stack: error.stack }),
    ...(typeof status === 'number' && Number.isFinite(status) ? { status } : {}),
  };
}
