// Cloudflare 同步 Worker 运行时。
// 在 Worker 线程内处理所有网络 I/O + JSON 解析 + SHA-256 哈希计算。

import { createSha256CanonicalHash } from '@/shared/storage/hash-utils';
// AI-REMOVED 2026-08-08:
// Reason: clientMutationId 现在由主线程 batch 创建并保持稳定，Worker 不再生成新 ID。
// Trigger: 服务端幂等键不能在每次网络重试时变化。
// Evidence: 开发后端 commit 使用 clientMutationId 作为 applied 关联键。
// Replacement: cloudflare-remote.ts CloudflareSyncWriteBatch。
// Risk: Low
// Human Review: Required
//
// Original code:
// import { createUuid } from '@/domain/shared/uuid';
import { readDebugModeEnabled } from '@/shared/logging/debug-mode-runtime';
import { createLogger } from '@/shared/logging/logger';
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
  CfWorkerConflictResponse,
} from './cloudflare-worker-protocol';

// ============================================================================
// 主入口
// ============================================================================

const logger = createLogger('cloudflare-worker');

export async function handleCfRequest(request: CfWorkerRequest): Promise<CfWorkerResponse> {
  const debugEnabled = readDebugModeEnabled();
  const startedAt = debugEnabled ? performance.now() : 0;
  const label = debugEnabled ? formatOperationLabel(request.operation) : '';
  if (debugEnabled) {
    logger.debug(`${label} → started`);
  }

  try {
    const result = await executeOperation(
      request.apiBase,
      request.operation,
      request.requestTimeoutMs,
      request.maxConcurrentRequests,
    );
    if (debugEnabled) {
      logger.debug(`${label} → completed in ${formatElapsedMs(startedAt)}ms`);
    }
    return {
      requestId: request.requestId,
      ok: true,
      result,
    };
  } catch (error) {
    const serializedError = serializeError(error);
    if (debugEnabled) {
      logger.debug(`${label} → failed in ${formatElapsedMs(startedAt)}ms: ${serializedError.message}`);
    }
    return {
      requestId: request.requestId,
      ok: false,
      error: serializedError,
    };
  }
}

function formatElapsedMs(startedAt: number): string {
  return Math.max(0, performance.now() - startedAt).toFixed(1);
}

// ============================================================================
// 操作分发
// ============================================================================

async function executeOperation(
  apiBase: string,
  operation: CfWorkerOperation,
  requestTimeoutMs: number,
  maxConcurrentRequests: number,
): Promise<unknown> {
  switch (operation.type) {
    case 'prefetch-indexes':
      return await doPrefetchIndexes(apiBase, operation.spaceId, operation.appliedHead, operation.epoch, requestTimeoutMs);
    case 'read-asset':
      return await doReadAsset(apiBase, operation, requestTimeoutMs);
    case 'check-collections':
      return await doCheckCollections(apiBase, operation.spaceId, operation.appliedHead, operation.epoch, operation.assetTypes, requestTimeoutMs);
    case 'commit-batch':
      return await doCommitBatch(apiBase, operation.spaceId, operation.epoch, operation.clientBatchId, operation.mutations, requestTimeoutMs, maxConcurrentRequests);
    case 'ensure-space':
      return await doEnsureSpace(apiBase, operation.spaceId, requestTimeoutMs);
    case 'reset-remote':
      await doResetRemote(apiBase, operation.spaceId, requestTimeoutMs);
      return undefined;
  }
}

// ============================================================================
// prefetch-indexes
// ============================================================================

async function doPrefetchIndexes(
  apiBase: string,
  spaceId: string,
  _appliedHead: number | null,
  epoch: string | null,
  requestTimeoutMs: number,
): Promise<CfPrefetchIndexesResult> {
  // AI-CORRECTION 2026-08-08: 适配器消费的是完整 collection index，不能把增量页直接伪装成完整索引。
  // 当前后端即使 mode=incremental 也返回快照，但客户端仍显式请求 full 并完整处理分页，避免协议实现变化后漏资产。
  const modules = new Map<string, CfWorkerPlanResponse['modules'][number]['assets'][number][]>();
  let firstPage: CfWorkerPlanResponse | null = null;
  let pageToken: string | null = null;
  const visitedPageTokens = new Set<string>();

  do {
    const params = new URLSearchParams();
    params.set('mode', 'full');
    if (epoch !== null) params.set('epoch', epoch);
    if (pageToken !== null) params.set('pageToken', pageToken);

    const url = `${createSpaceUrl(apiBase, spaceId, '/plan')}?${params.toString()}`;
    const response = await fetchWithTimeout(url, { cache: 'no-store' }, requestTimeoutMs);
    const page = await readJsonResponse<CfWorkerPlanResponse>(response, 'Plan');
    firstPage ??= page;

    for (const modulePlan of page.modules) {
      const assets = modules.get(modulePlan.moduleType) ?? [];
      assets.push(...modulePlan.assets);
      modules.set(modulePlan.moduleType, assets);
    }

    pageToken = page.nextPageToken;
    if (pageToken !== null) {
      if (visitedPageTokens.has(pageToken)) {
        throw new Error(`Plan pagination loop detected for space "${spaceId}".`);
      }
      visitedPageTokens.add(pageToken);
    }
  } while (pageToken !== null);

  if (firstPage === null) {
    throw new Error(`Plan returned no page for space "${spaceId}".`);
  }

  const plan: CfWorkerPlanResponse = {
    ...firstPage,
    modules: Array.from(modules, ([moduleType, assets]) => ({ moduleType, assets })),
    nextPageToken: null,
  };
  return { plan, epoch: plan.epoch ?? null };

  // AI-REMOVED 2026-08-08:
  // Reason: 非 2xx 被伪装成空 plan，且增量响应被当作完整索引。
  // Trigger: 临时 500 会让适配器把远端资产视为不存在并反向上传本地旧数据。
  // Evidence: sync-adapters.ts 的 local exists / remote absent 分支会直接上传。
  // Replacement: 上方严格错误 + full plan 分页聚合。
  // Risk: Low；网络错误现在会中止同步并显示错误，不再静默继续。
  // Human Review: Required
  //
  // Original code:
  // const params = new URLSearchParams();
  // params.set('mode', appliedHead === null ? 'full' : 'incremental');
  // if (epoch !== null) params.set('epoch', epoch);
  // if (appliedHead !== null) params.set('cursor', String(appliedHead));
  // const url = `${apiBase}/v1/sync/spaces/${spaceId}/plan?${params.toString()}`;
  // const response = await fetch(url, { cache: 'no-store' });
  // if (!response.ok) return { plan: null, epoch: null };
  // const plan = await response.json() as CfWorkerPlanResponse;
  // return { plan, epoch: plan.epoch ?? null };
}

// ============================================================================
// read-asset
// ============================================================================

async function doReadAsset(
  apiBase: string,
  params: CfWorkerOperation & { type: 'read-asset' },
  requestTimeoutMs: number,
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
  const signUrl = createSpaceUrl(apiBase, spaceId, '/downloads:sign');
  const signResp = await fetchWithTimeout(signUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ blobHashes: [blobHash] }),
    cache: 'no-store',
  }, requestTimeoutMs);

  const signResult = await readJsonResponse<CfWorkerDownloadSignResponse>(
    signResp,
    'Download signing',
  );
  const downloadUrl = signResult.urls[0]?.url ?? null;
  if (downloadUrl === null) {
    throw new Error(`Download signing returned no URL for blob "${blobHash}".`);
  }

  // 下载 blob
  const dlResp = await fetchWithTimeout(
    downloadUrl,
    { cache: 'no-store' },
    requestTimeoutMs,
  );
  if (!dlResp.ok) {
    throw await createHttpError(dlResp, 'Blob download');
  }

  const content = await dlResp.text();

  // SHA-256 校验
  const computedHash = await createSha256CanonicalHash(JSON.parse(content));
  const expectedHash = computedHash.startsWith('sha256:')
    ? computedHash.slice(7)
    : computedHash;

  if (expectedHash !== blobHash) {
    throw new Error(
      `Blob hash mismatch for ${params.assetType}/${params.assetId}: `
      + `expected ${blobHash}, received ${expectedHash}.`,
    );
  }

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
  requestTimeoutMs: number,
): Promise<CfCheckCollectionsResult> {
  const params = new URLSearchParams();
  if (epoch !== null) params.set('epoch', epoch);
  if (appliedHead !== null) params.set('cursor', String(appliedHead));

  const url = `${createSpaceUrl(apiBase, spaceId, '/check')}?${params.toString()}`;
  const response = await fetchWithTimeout(
    url,
    { cache: 'no-store' },
    requestTimeoutMs,
  );

  if (response.status === 204) {
    return { changedAssetTypes: [], epoch, head: appliedHead };
  }

  if (!response.ok) {
    throw await createHttpError(response, 'Collection check');
  }

  const result = await response.json() as CfWorkerCheckResponse;

  if (result.epoch === epoch && result.head === appliedHead) {
    return {
      changedAssetTypes: [],
      epoch: result.epoch ?? null,
      head: result.head,
    };
  }

  if (!result.changed) {
    return {
      changedAssetTypes: [],
      epoch: result.epoch ?? null,
      head: result.head,
    };
  }

  const changedAssetTypes: string[] = [];
  for (const change of result.changes) {
    if (assetTypes.includes(change.assetType) && !changedAssetTypes.includes(change.assetType)) {
      changedAssetTypes.push(change.assetType);
    }
  }

  // AI-CORRECTION 2026-08-08: planRequired 或 epoch/head 变化但无 inline changes 时，
  // 必须保守地检查全部请求集合；开发后端当前正是以此形式要求拉取 plan。
  return {
    changedAssetTypes: changedAssetTypes.length > 0
      ? changedAssetTypes
      : [...assetTypes],
    epoch: result.epoch ?? null,
    head: result.head,
  };
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
  requestTimeoutMs: number,
  maxConcurrentRequests: number,
): Promise<CfCommitBatchResult> {
  const unsupportedDelete = mutations.find((mutation) => mutation.operation === 'delete');
  if (unsupportedDelete !== undefined) {
    throw new Error(
      `Cloudflare backend does not advertise tombstone support; refusing to delete `
      + `${unsupportedDelete.assetType}/${unsupportedDelete.assetId}.`,
    );
  }

  // Step 0: 对每个 mutation 计算 blobHash
  const mutationRecords = await Promise.all(mutations.map(async (m) => {
    // AI-CORRECTION 2026-08-08: mutation id 必须由 batch 创建并在重试期间保持稳定，不能在 Worker 内重新生成。
    const mutationId = m.clientMutationId;
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
      baseRevision: m.baseRevision,
      baseContentHash: normalizeProtocolHash(m.baseContentHash),
    };
  }));

  const mutationsUrl = createSpaceUrl(apiBase, spaceId, '/mutations');

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
        baseRevision: r.baseRevision,
        baseContentHash: r.baseContentHash,
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

    const prepareResp = await fetchWithTimeout(mutationsUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(prepareBody),
      cache: 'no-store',
    }, requestTimeoutMs);

    if (prepareResp.status === 409) {
      const conflict = await readConflictResponse(prepareResp, 'Prepare');
      if (!isEpochConflict(conflict)) {
        throw new CfHttpError('Prepare conflict.', 409, conflict);
      }
      // epoch 冲突：从 check 端点获取最新 epoch 后重试
      const checkUrl = createSpaceUrl(apiBase, spaceId, '/check');
      const checkResp = await fetchWithTimeout(
        checkUrl,
        { cache: 'no-store' },
        requestTimeoutMs,
      );
      if (checkResp.ok) {
        const checkResult = await checkResp.json() as CfWorkerCheckResponse;
        if (checkResult.epoch && checkResult.epoch !== currentEpoch) {
          currentEpoch = checkResult.epoch;
          continue;
        }
      }
      throw new CfHttpError('Prepare epoch conflict could not be refreshed.', 409, conflict);
    }

    if (!prepareResp.ok) {
      throw await createHttpError(prepareResp, 'Prepare');
    }

    const prepareResult = await prepareResp.json() as CfWorkerPrepareResponse;

    // Step 2: R2 PUT
    await mapWithConcurrency(prepareResult.uploads, maxConcurrentRequests, async (upload) => {
      if (!upload.required) return;
      if (!upload.url) {
        throw new Error(`Prepare returned no upload URL for ${upload.assetType}/${upload.assetId}.`);
      }
      const rec = mutationRecords.find(
        (r) => r.assetType === upload.assetType && r.assetId === upload.assetId,
      );
      if (!rec || rec.content === null) {
        throw new Error(`Prepare requested unavailable content for ${upload.assetType}/${upload.assetId}.`);
      }

      const headers: Record<string, string> = upload.headers ?? {};
      const uploadResponse = await fetchWithTimeout(upload.url, {
        method: 'PUT',
        headers,
        body: rec.content,
        cache: 'no-store',
      }, requestTimeoutMs);
      if (!uploadResponse.ok) {
        throw await createHttpError(uploadResponse, `Blob upload ${upload.assetType}/${upload.assetId}`);
      }
    });

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
        baseRevision: r.baseRevision,
        baseContentHash: r.baseContentHash,
      })),
    };

    const commitResp = await fetchWithTimeout(mutationsUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(commitBody),
      cache: 'no-store',
    }, requestTimeoutMs);

    if (commitResp.status === 409) {
      const conflict = await readConflictResponse(commitResp, 'Commit');
      if (!isEpochConflict(conflict)) {
        throw new CfHttpError('Commit conflict.', 409, conflict);
      }
      const checkUrl = createSpaceUrl(apiBase, spaceId, '/check');
      const checkResp = await fetchWithTimeout(
        checkUrl,
        { cache: 'no-store' },
        requestTimeoutMs,
      );
      if (checkResp.ok) {
        const checkResult = await checkResp.json() as CfWorkerCheckResponse;
        if (checkResult.epoch && checkResult.epoch !== currentEpoch) {
          currentEpoch = checkResult.epoch;
          continue;
        }
      }
      throw new CfHttpError('Commit epoch conflict could not be refreshed.', 409, conflict);
    }

    if (!commitResp.ok) {
      throw await createHttpError(commitResp, 'Commit');
    }

    const commitResult = await commitResp.json() as CfWorkerCommitResponse;

    return {
      head: commitResult.head,
      epoch: currentEpoch !== epoch ? currentEpoch : null,
      serverTime: commitResult.serverTime,
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
  requestTimeoutMs: number,
): Promise<CfEnsureSpaceResult> {
  const checkUrl = createSpaceUrl(apiBase, spaceId, '/check');
  const checkResp = await fetchWithTimeout(
    checkUrl,
    { cache: 'no-store' },
    requestTimeoutMs,
  );

  if (checkResp.ok) {
    const checked = await checkResp.json() as CfWorkerCheckResponse;
    return { spaceId, epoch: checked.epoch ?? null };
  }

  if (checkResp.status === 404) {
    // 空间不存在，自动创建
    const createUrl = `${apiBase}/v1/sync/spaces`;
    const createResp = await fetchWithTimeout(createUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ spaceId }),
      cache: 'no-store',
    }, requestTimeoutMs);
    if (createResp.ok) {
      const created = await createResp.json() as { activeEpoch: string };
      return { spaceId, epoch: created.activeEpoch ?? null };
    }
    if (createResp.status === 409) {
      // 另一标签页可能在 check 与 create 之间完成了同一空间创建。
      const racedCheckResp = await fetchWithTimeout(
        checkUrl,
        { cache: 'no-store' },
        requestTimeoutMs,
      );
      const checked = await readJsonResponse<CfWorkerCheckResponse>(
        racedCheckResp,
        'Space check after concurrent creation',
      );
      return { spaceId, epoch: checked.epoch ?? null };
    }
    throw await createHttpError(createResp, 'Space creation');
  }

  throw await createHttpError(checkResp, 'Space check');
}

// ============================================================================
// reset-remote
// ============================================================================

async function doResetRemote(
  apiBase: string,
  spaceId: string,
  requestTimeoutMs: number,
): Promise<void> {
  const response = await fetchWithTimeout(
    createSpaceUrl(apiBase, spaceId, '/reset'),
    { method: 'POST', cache: 'no-store' },
    requestTimeoutMs,
  );
  if (response.status === 404) return;
  if (!response.ok) {
    throw await createHttpError(response, 'Remote reset');
  }
}

// ============================================================================
// 辅助函数
// ============================================================================

class CfHttpError extends Error {
  public constructor(
    message: string,
    public readonly status: number,
    public readonly details: unknown,
  ) {
    super(message);
    this.name = 'CfHttpError';
  }
}

async function fetchWithTimeout(
  input: RequestInfo | URL,
  init: RequestInit,
  timeoutMs: number,
): Promise<Response> {
  const controller = new AbortController();
  const timer = globalThis.setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(input, { ...init, signal: controller.signal });
  } catch (error) {
    if (controller.signal.aborted) {
      throw new Error(`Cloudflare request timed out after ${timeoutMs}ms.`);
    }
    throw error;
  } finally {
    globalThis.clearTimeout(timer);
  }
}

async function readJsonResponse<TResult>(
  response: Response,
  operation: string,
): Promise<TResult> {
  if (!response.ok) {
    throw await createHttpError(response, operation);
  }
  try {
    return await response.json() as TResult;
  } catch (error) {
    throw new Error(
      `${operation} returned invalid JSON: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

async function createHttpError(
  response: Response,
  operation: string,
): Promise<CfHttpError> {
  const rawBody = await response.text();
  let details: unknown = rawBody;
  let serverMessage = '';
  if (rawBody !== '') {
    try {
      details = JSON.parse(rawBody) as unknown;
      if (
        typeof details === 'object'
        && details !== null
        && 'message' in details
        && typeof details.message === 'string'
      ) {
        serverMessage = `: ${details.message}`;
      }
    } catch {
      serverMessage = `: ${rawBody.slice(0, 200)}`;
    }
  }
  return new CfHttpError(
    `${operation} failed: HTTP ${response.status}${serverMessage}`,
    response.status,
    details,
  );
}

async function readConflictResponse(
  response: Response,
  operation: string,
): Promise<CfWorkerConflictResponse> {
  try {
    const value = await response.json() as CfWorkerConflictResponse;
    if (value.status === 'conflict' && Array.isArray(value.conflicts)) {
      return value;
    }
    throw new Error('missing conflict payload');
  } catch (error) {
    throw new CfHttpError(
      `${operation} returned HTTP 409 without a valid conflict payload.`,
      409,
      error instanceof Error ? error.message : String(error),
    );
  }
}

function isEpochConflict(response: CfWorkerConflictResponse): boolean {
  return response.conflicts.length > 0
    && response.conflicts.every((conflict) => conflict.reason === 'space-epoch-changed');
}

function normalizeProtocolHash(value: string | null): string | null {
  if (value === null) return null;
  return value.startsWith('sha256:') ? value.slice(7) : value;
}

function createSpaceUrl(apiBase: string, spaceId: string, suffix: string): string {
  return `${apiBase}/v1/sync/spaces/${encodeURIComponent(spaceId)}${suffix}`;
}

async function mapWithConcurrency<TValue>(
  values: readonly TValue[],
  concurrency: number,
  task: (value: TValue) => Promise<void>,
): Promise<void> {
  let nextIndex = 0;
  const workerCount = Math.min(
    values.length,
    Math.max(1, Math.round(concurrency)),
  );
  await Promise.all(Array.from({ length: workerCount }, async () => {
    while (nextIndex < values.length) {
      const index = nextIndex;
      nextIndex += 1;
      const value = values[index];
      if (value !== undefined) await task(value);
    }
  }));
}

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
  readonly details?: unknown;
} {
  if (!(error instanceof Error)) {
    return { name: 'Error', message: String(error) };
  }

  const status = (error as Error & { readonly status?: unknown }).status;
  const details = (error as Error & { readonly details?: unknown }).details;
  return {
    name: error.name,
    message: error.message,
    ...(error.stack === undefined ? {} : { stack: error.stack }),
    ...(typeof status === 'number' && Number.isFinite(status) ? { status } : {}),
    ...(details === undefined ? {} : { details }),
  };
}
