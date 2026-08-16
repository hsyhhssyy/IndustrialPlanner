import { createUuid } from "@/domain/shared/uuid";
import {
  createSha256CanonicalHash,
  createSha256Hash,
  createStableJsonHash,
} from "@/shared/storage/hash-utils";

import { CloudflareV2LocalStateStore } from "./cloudflare-v2-local-state";
import {
  CloudflareV2UploadJournal,
  type CfV2PersistedMutation,
  type CfV2UploadJournalRecord,
} from "./cloudflare-v2-upload-journal";
import {
  CF_SYNC_V2_PROTOCOL,
  CfV2HttpError,
  type CfV2CheckResponse,
  type CfV2CommitResult,
  type CfV2PlanResponse,
  type CfV2PrepareDeletion,
  type CfV2PrepareObject,
  type CfV2PrepareRequest,
  type CfV2PrepareResponse,
  type CfV2Revision,
} from "./cloudflare-v2-types";
import type {
  CfV2CommitBatchResult,
  CfV2TransactionRecoveryResult,
  CfV2WorkerAppliedMutation,
  CfV2WorkerConfig,
  CfV2WorkerMutation,
  CfV2WorkerOperation,
} from "./cloudflare-v2-worker-protocol";

export type CfV2WorkerActivityReporter = (activity: {
  readonly activeRequestCount: number;
  readonly queuedRequestCount: number;
}) => void;

export class CloudflareV2WorkerRuntime {
  private readonly stateStores = new Map<string, CloudflareV2LocalStateStore>();
  private readonly recoveryPromises = new Map<string, Promise<CfV2TransactionRecoveryResult>>();
  private readonly mutationTails = new Map<string, Promise<void>>();

  public async execute(
    config: CfV2WorkerConfig,
    operation: CfV2WorkerOperation,
    reportActivity: CfV2WorkerActivityReporter = () => {},
  ): Promise<unknown> {
    const normalized = normalizeConfig(config);
    const state = this.getStateStore(normalized);

    switch (operation.type) {
      case "recover-pending-upload":
        return await this.recoverPendingUpload(normalized, state, reportActivity);
      case "ack-pending-upload":
        await this.runMutationExclusive(normalized, async () => {
          await new CloudflareV2UploadJournal(normalized).clear();
        });
        return undefined;
      case "compute-content-hashes":
        return await Promise.all(operation.requests.map(async (request) =>
          request.algorithm === "sha256-canonical-json-v1"
            ? await createSha256CanonicalHash(request.value)
            : createStableJsonHash(request.value)
        ));
      case "load-plan":
        await this.recoverPendingUpload(normalized, state, reportActivity);
        return await ensureSpaceAndLoadPlan(normalized);
      case "check":
        await this.recoverPendingUpload(normalized, state, reportActivity);
        return await checkSpace(normalized, operation.knownRevision);
      case "read-asset":
        return await readAsset(normalized, operation);
      case "commit-batch":
        return await this.runMutationExclusive(normalized, async () =>
          await this.commitBatch(
            normalized,
            state,
            operation.baseRevision,
            operation.clientBatchId,
            operation.mutations,
            reportActivity,
          )
        );
      case "reset-remote":
        await this.runMutationExclusive(normalized, async () => {
          await this.resetRemote(normalized, state, reportActivity);
        });
        return undefined;
      case "abort-transaction":
        await this.runMutationExclusive(normalized, async () => {
          await postJson(
            normalized,
            `/v1/sync/spaces/${encodeURIComponent(normalized.spaceId)}/transaction/abort`,
            {},
          );
          await new CloudflareV2UploadJournal(normalized).clear();
        });
        return undefined;
      case "state-read-applied-revision":
        return await state.readAppliedRevision();
      case "state-write-applied-revision":
        await state.writeAppliedRevision(operation.revision);
        return undefined;
      case "state-get-last-synced-hash":
        return await state.getLastSyncedHash(operation.assetKey);
      case "state-set-last-synced-hash":
        await state.setLastSyncedHash(operation.assetKey, operation.hash);
        return undefined;
      case "state-get-remote-revision":
        return await state.getRemoteRevision(operation.key);
      case "state-set-remote-revision":
        await state.setRemoteRevision(operation.key, operation.revision);
        return undefined;
      case "state-get-remote-etag":
        return await state.getRemoteEtag(operation.key);
      case "state-set-remote-etag":
        await state.setRemoteEtag(operation.key, operation.etag);
        return undefined;
      case "state-read-comparable-hashes":
        return await state.readComparableHashes(operation.assets);
      case "state-note-remote-hash":
        await state.noteRemoteHash(
          operation.assetKey,
          operation.protocolContentHash,
          operation.adapterContentHash,
        );
        return undefined;
      case "state-reset":
        await state.reset();
        return undefined;
    }
  }

  private getStateStore(config: CfV2WorkerConfig): CloudflareV2LocalStateStore {
    const key = createScopeKey(config);
    const existing = this.stateStores.get(key);
    if (existing !== undefined) {
      return existing;
    }
    const created = new CloudflareV2LocalStateStore(config.apiBase, config.spaceId);
    this.stateStores.set(key, created);
    return created;
  }

  private async runMutationExclusive<TResult>(
    config: CfV2WorkerConfig,
    task: () => Promise<TResult>,
  ): Promise<TResult> {
    const scopeKey = createScopeKey(config);
    const previous = this.mutationTails.get(scopeKey) ?? Promise.resolve();
    const result = previous.catch(() => undefined).then(task);
    const tail = result.then(() => undefined, () => undefined);
    this.mutationTails.set(scopeKey, tail);
    try {
      return await result;
    } finally {
      if (this.mutationTails.get(scopeKey) === tail) {
        this.mutationTails.delete(scopeKey);
      }
    }
  }

  private async commitBatch(
    config: CfV2WorkerConfig,
    state: CloudflareV2LocalStateStore,
    baseRevision: CfV2Revision,
    clientBatchId: string,
    mutations: readonly CfV2WorkerMutation[],
    reportActivity: CfV2WorkerActivityReporter,
  ): Promise<CfV2CommitBatchResult> {
    const recovery = await this.recoverPendingUpload(config, state, reportActivity);
    const journal = new CloudflareV2UploadJournal(config);
    if (recovery.commit !== null) {
      // 新提交只会在同步引擎已经读取并比较上一笔结果后发生，此处可释放上一笔已提交日志。
      await journal.clear();
    }
    if (mutations.length === 0) {
      return { revision: baseRevision, applied: [], recovered: false };
    }
    if (mutations.length > 32) {
      throw new Error("Cloudflare mutation batch exceeds the protocol limit of 32.");
    }

    const objects: CfV2PrepareObject[] = [];
    const deletions: CfV2PrepareDeletion[] = [];
    const payloads = await Promise.all(mutations.map(async (mutation) => {
      if (mutation.operation === "delete") {
        deletions.push({
          clientMutationId: mutation.clientMutationId,
          assetType: mutation.assetType,
          assetId: mutation.assetId,
        });
        return { mutation, bytes: null };
      }

      const content = JSON.stringify(mutation.value);
      if (content === undefined) {
        throw new Error(
          `Cloudflare asset ${mutation.assetType}/${mutation.assetId} is not JSON serializable.`,
        );
      }
      const bytes = new TextEncoder().encode(content);
      const blobHash = stripSha256Prefix(await createSha256Hash(bytes));
      objects.push({
        clientMutationId: mutation.clientMutationId,
        assetType: mutation.assetType,
        assetId: mutation.assetId,
        metadata: "{}",
        blobHash,
        blobByteSize: bytes.byteLength,
        storageMode: "full",
        schemaVersion: 1,
        encoding: "identity",
        writerAppVersion: "0.1.0",
        writerBuildId: "browser-worker",
      });
      return { mutation, bytes };
    }));
    const prepareRequest: CfV2PrepareRequest = {
      protocol: CF_SYNC_V2_PROTOCOL,
      action: "prepare",
      baseRevision,
      clientBatchId,
      objects,
      deletions,
    };
    const record = await journal.seal({
      journalId: createUuid(),
      prepareRequest,
      payloads,
    });
    const result = await this.executeJournal(config, state, journal, record, reportActivity);
    if (result === null) {
      throw new Error("Cloudflare upload journal expired before it could be committed.");
    }
    return result;
  }

  private async recoverPendingUpload(
    config: CfV2WorkerConfig,
    state: CloudflareV2LocalStateStore,
    reportActivity: CfV2WorkerActivityReporter,
  ): Promise<CfV2TransactionRecoveryResult> {
    const scopeKey = createScopeKey(config);
    const existing = this.recoveryPromises.get(scopeKey);
    if (existing !== undefined) {
      return await existing;
    }
    const recovery = this.recoverPendingUploadInternal(config, state, reportActivity)
      .finally(() => {
        this.recoveryPromises.delete(scopeKey);
      });
    this.recoveryPromises.set(scopeKey, recovery);
    return await recovery;
  }

  private async recoverPendingUploadInternal(
    config: CfV2WorkerConfig,
    state: CloudflareV2LocalStateStore,
    reportActivity: CfV2WorkerActivityReporter,
  ): Promise<CfV2TransactionRecoveryResult> {
    const journal = new CloudflareV2UploadJournal(config);
    const record = await journal.read();
    if (record === null) {
      return { recovered: false, commit: null };
    }
    if (record.phase === "committed" && record.result !== null) {
      return { recovered: true, commit: { ...record.result, recovered: true } };
    }
    const result = await this.executeJournal(config, state, journal, record, reportActivity);
    return {
      recovered: result !== null,
      commit: result === null ? null : { ...result, recovered: true },
    };
  }

  private async executeJournal(
    config: CfV2WorkerConfig,
    state: CloudflareV2LocalStateStore,
    journal: CloudflareV2UploadJournal,
    initialRecord: CfV2UploadJournalRecord,
    reportActivity: CfV2WorkerActivityReporter,
  ): Promise<CfV2CommitBatchResult | null> {
    let record = initialRecord;
    if (record.phase === "committed" && record.result !== null) {
      return record.result;
    }

    let prepare: CfV2PrepareResponse;
    try {
      // prepare 自身以 clientBatchId + 完整 descriptor 幂等；恢复时重新调用可刷新上传票据。
      prepare = normalizePrepareResponse(await postJson<unknown>(
        config,
        `/v1/sync/spaces/${encodeURIComponent(config.spaceId)}/mutations`,
        record.prepareRequest,
      ));
      record = await journal.update(record, { phase: "prepared", prepare });
    } catch (error) {
      if (error instanceof CfV2HttpError && error.code === "batch_already_committed") {
        return await this.reconcileCommittedJournal(config, state, journal, record);
      }
      if (
        error instanceof CfV2HttpError
        && (error.status === 404 || error.status === 410 || error.code === "batch_cancelled")
      ) {
        await journal.clear(record);
        return null;
      }
      throw error;
    }

    record = await journal.update(record, { phase: "uploading", prepare });
    const requiredUploads = prepare.uploads.filter((instruction) =>
      instruction.required && typeof instruction.url === "string"
    );
    await runConcurrent(
      requiredUploads,
      config.maxConcurrentRequests,
      async (instruction) => {
        const mutation = record.mutations.find((candidate) =>
          candidate.operation === "put"
          && candidate.assetType === instruction.assetType
          && candidate.assetId === instruction.assetId
        );
        if (mutation === undefined || instruction.url === undefined) {
          throw new Error(
            `Cloudflare upload instruction has no matching payload for ${instruction.assetType}/${instruction.assetId}.`,
          );
        }
        const bytes = await journal.readPayload(mutation);
        if (bytes === null) {
          throw new Error(
            `Cloudflare upload payload is missing for ${instruction.assetType}/${instruction.assetId}.`,
          );
        }
        const response = await fetchWithTimeout(instruction.url, {
          method: "PUT",
          headers: {
            "content-type": "application/octet-stream",
            ...instruction.headers,
          },
          body: bytes,
        }, config.requestTimeoutMs);
        if (!response.ok) {
          let responseBody = "";
          try {
            responseBody = await response.text();
          } catch {
            // 响应正文只用于诊断。
          }
          throw new CfV2HttpError(
            response.status,
            "upload_failed",
            `Failed to upload ${instruction.assetType}/${instruction.assetId}: ${responseBody || `HTTP ${response.status}`}`,
          );
        }
      },
      reportActivity,
    );

    record = await journal.update(record, { phase: "committing", prepare });
    let commit: CfV2CommitResult;
    try {
      commit = normalizeCommitResult(await postJson<unknown>(
        config,
        `/v1/sync/spaces/${encodeURIComponent(config.spaceId)}/mutations`,
        {
          protocol: CF_SYNC_V2_PROTOCOL,
          action: "commit",
          uploadId: prepare.uploadId,
          commitToken: prepare.commitToken,
        },
      ));
    } catch (error) {
      if (error instanceof CfV2HttpError && error.code === "batch_already_committed") {
        return await this.reconcileCommittedJournal(config, state, journal, record);
      }
      throw error;
    }

    const result = mapCommitResult(record.mutations, commit, false);
    await noteCommittedHashes(state, record.mutations, result);
    await journal.update(record, { phase: "committed", result });
    return result;
  }

  private async reconcileCommittedJournal(
    config: CfV2WorkerConfig,
    state: CloudflareV2LocalStateStore,
    journal: CloudflareV2UploadJournal,
    record: CfV2UploadJournalRecord,
  ): Promise<CfV2CommitBatchResult> {
    const plan = await ensureSpaceAndLoadPlan(config);
    const objectByMutationId = new Map(
      record.prepareRequest.objects.map((object) => [object.clientMutationId, object]),
    );
    const isApplied = record.mutations.every((mutation) => {
      const remoteAsset = plan.assets.find((asset) =>
        asset.assetType === mutation.assetType && asset.assetId === mutation.assetId
      );
      if (mutation.operation === "delete") {
        return remoteAsset === undefined;
      }
      const object = objectByMutationId.get(mutation.clientMutationId);
      return object !== undefined
        && remoteAsset !== undefined
        && stripSha256Prefix(remoteAsset.contentHash) === stripSha256Prefix(object.blobHash);
    });
    if (!isApplied) {
      await journal.clear(record);
      throw new CfV2HttpError(
        409,
        "recovery_diverged",
        "The recovered Cloudflare transaction no longer matches the remote plan.",
      );
    }

    const applied: CfV2WorkerAppliedMutation[] = record.mutations.map((mutation) => {
      const remoteAsset = plan.assets.find((asset) =>
        asset.assetType === mutation.assetType && asset.assetId === mutation.assetId
      );
      return {
        clientMutationId: mutation.clientMutationId,
        adapterId: mutation.adapterId,
        adapterAssetId: mutation.adapterAssetId,
        assetType: mutation.assetType,
        assetId: mutation.assetId,
        revision: toAdapterRevision(plan.revision),
        contentHash: remoteAsset === undefined
          ? null
          : toProtocolContentHash(remoteAsset.contentHash),
        deletedAt: mutation.operation === "delete" ? mutation.deletedAt : null,
        committedAt: plan.serverTime,
      };
    });
    const result: CfV2CommitBatchResult = {
      revision: plan.revision,
      applied,
      recovered: true,
    };
    await noteCommittedHashes(state, record.mutations, result);
    await journal.update(record, { phase: "committed", result });
    return result;
  }

  private async resetRemote(
    config: CfV2WorkerConfig,
    state: CloudflareV2LocalStateStore,
    reportActivity: CfV2WorkerActivityReporter,
  ): Promise<void> {
    const recovered = await this.recoverPendingUpload(config, state, reportActivity);
    const journal = new CloudflareV2UploadJournal(config);
    if (recovered.commit !== null) {
      await journal.clear();
    }
    const plan = await ensureSpaceAndLoadPlan(config);
    let baseRevision = plan.revision;
    for (let offset = 0; offset < plan.assets.length; offset += 32) {
      const chunk = plan.assets.slice(offset, offset + 32);
      const result = await this.commitBatch(
        config,
        state,
        baseRevision,
        createUuid(),
        chunk.map((asset) => ({
          clientMutationId: createUuid(),
          operation: "delete" as const,
          adapterId: "cloudflare-reset",
          adapterAssetId: asset.assetId,
          assetType: asset.assetType,
          assetId: asset.assetId,
          value: null,
          adapterContentHash: null,
          deletedAt: new Date().toISOString(),
        })),
        reportActivity,
      );
      baseRevision = result.revision;
      await journal.clear();
    }
    await state.reset();
  }
}

async function ensureSpaceAndLoadPlan(config: CfV2WorkerConfig): Promise<CfV2PlanResponse> {
  const path = `/v1/sync/spaces/${encodeURIComponent(config.spaceId)}/plan`;
  try {
    return normalizePlanResponse(await getJson<unknown>(config, path));
  } catch (error) {
    if (!(error instanceof CfV2HttpError && error.status === 404)) {
      throw error;
    }
    await postJson(config, "/v1/sync/spaces", { spaceId: config.spaceId });
    return normalizePlanResponse(await getJson<unknown>(config, path));
  }
}

async function checkSpace(
  config: CfV2WorkerConfig,
  knownRevision: string,
): Promise<CfV2CheckResponse | null> {
  const path = `/v1/sync/spaces/${encodeURIComponent(config.spaceId)}`
    + `/check?knownRevision=${encodeURIComponent(knownRevision)}`;
  let response: Response;
  try {
    response = await request(config, path);
  } catch (error) {
    if (!(error instanceof CfV2HttpError && error.status === 404)) {
      throw error;
    }
    await postJson(config, "/v1/sync/spaces", { spaceId: config.spaceId });
    response = await request(config, path);
  }
  return response.status === 204
    ? null
    : normalizeCheckResponse(await response.json());
}

async function readAsset(
  config: CfV2WorkerConfig,
  operation: Extract<CfV2WorkerOperation, { readonly type: "read-asset" }>,
): Promise<{
  readonly revision: number;
  readonly value: unknown;
  readonly contentHash: string;
  readonly committedAt: string;
}> {
  // 423（空间锁）是后端上一轮 commit 后的瞬时状态，锁释放窗口很短。
  // 固定 200ms 间隔重试，含首次共 10 次尝试（总窗口约 2s）；仍 423 则原样抛错，
  // 由引擎放弃本轮同步，等待下一轮小检查或下一次编辑提供新的同步机会。
  const maxAttempts = 10;
  const retryDelayMs = 200;
  let response = await fetchWithTimeout(
    operation.asset.downloadUrl,
    undefined,
    config.requestTimeoutMs,
  );
  for (
    let attempt = 1;
    attempt < maxAttempts && !response.ok && response.status === 423;
    attempt += 1
  ) {
    await wait(retryDelayMs);
    response = await fetchWithTimeout(
      operation.asset.downloadUrl,
      undefined,
      config.requestTimeoutMs,
    );
  }
  if (!response.ok) {
    // 定位埋点：解析后端错误体，把 error code 与 details 附加到异常上，
    // 供主线程 409 → RemoteDownloadStaleError 转换与 sync restart 日志追溯。
    let details: Record<string, unknown> = {};
    try {
      details = await response.json() as Record<string, unknown>;
    } catch {
      // 非 JSON 错误体：仅保留状态码。
    }
    throw new CfV2HttpError(
      response.status,
      typeof details.error === "string" ? details.error : "download_failed",
      typeof details.message === "string"
        ? `Failed to download ${operation.asset.assetType}/${operation.asset.assetId}: ${details.message}`
        : `Failed to download ${operation.asset.assetType}/${operation.asset.assetId}: HTTP ${response.status}`,
      details,
    );
  }
  const bytes = new Uint8Array(await response.arrayBuffer());
  const receivedHash = stripSha256Prefix(await createSha256Hash(bytes));
  const expectedHash = stripSha256Prefix(operation.asset.contentHash);
  if (receivedHash !== expectedHash) {
    throw new Error(
      `Downloaded content hash mismatch for ${operation.asset.assetType}/${operation.asset.assetId}: `
      + `expected ${expectedHash}, received ${receivedHash}.`,
    );
  }
  const content = new TextDecoder().decode(bytes);
  let value: unknown;
  try {
    value = JSON.parse(content) as unknown;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(
      `Cloudflare asset ${operation.asset.assetType}/${operation.asset.assetId} contains invalid JSON: ${message}`,
      { cause: error },
    );
  }
  return {
    revision: toAdapterRevision(operation.planRevision),
    value,
    contentHash: toProtocolContentHash(operation.asset.contentHash),
    committedAt: operation.planServerTime,
  };
}

async function noteCommittedHashes(
  state: CloudflareV2LocalStateStore,
  mutations: readonly CfV2PersistedMutation[],
  result: CfV2CommitBatchResult,
): Promise<void> {
  await Promise.all(result.applied.map(async (applied) => {
    const mutation = mutations.find((candidate) =>
      candidate.clientMutationId === applied.clientMutationId
    );
    if (
      mutation === undefined
      || mutation.operation !== "put"
      || applied.contentHash === null
      || mutation.adapterContentHash === null
    ) {
      return;
    }
    await state.noteRemoteHash(
      `${mutation.adapterId}:${mutation.adapterAssetId}`,
      applied.contentHash,
      mutation.adapterContentHash,
    );
  }));
}

function mapCommitResult(
  mutations: readonly CfV2PersistedMutation[],
  commit: CfV2CommitResult,
  recovered: boolean,
): CfV2CommitBatchResult {
  const applied = mutations.flatMap((mutation): CfV2WorkerAppliedMutation[] => {
    const asset = commit.assets.find((candidate) =>
      candidate.assetType === mutation.assetType && candidate.assetId === mutation.assetId
    );
    if (asset !== undefined) {
      return [{
        clientMutationId: mutation.clientMutationId,
        adapterId: mutation.adapterId,
        adapterAssetId: mutation.adapterAssetId,
        assetType: mutation.assetType,
        assetId: mutation.assetId,
        revision: toAdapterRevision(commit.revision),
        contentHash: toProtocolContentHash(asset.contentHash),
        deletedAt: null,
        committedAt: commit.serverTime,
      }];
    }
    const deleted = commit.deletedAssets.some((candidate) =>
      candidate.assetType === mutation.assetType && candidate.assetId === mutation.assetId
    );
    return deleted
      ? [{
          clientMutationId: mutation.clientMutationId,
          adapterId: mutation.adapterId,
          adapterAssetId: mutation.adapterAssetId,
          assetType: mutation.assetType,
          assetId: mutation.assetId,
          revision: toAdapterRevision(commit.revision),
          contentHash: null,
          deletedAt: mutation.deletedAt,
          committedAt: commit.serverTime,
        }]
      : [];
  });
  return { revision: commit.revision, applied, recovered };
}

async function getJson<TResult>(
  config: CfV2WorkerConfig,
  path: string,
): Promise<TResult> {
  const response = await request(config, path);
  return await response.json() as TResult;
}

async function postJson<TResult = unknown>(
  config: CfV2WorkerConfig,
  path: string,
  body: unknown,
): Promise<TResult> {
  const response = await request(config, path, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  return await response.json() as TResult;
}

async function request(
  config: CfV2WorkerConfig,
  path: string,
  init?: RequestInit,
): Promise<Response> {
  const response = await fetchWithTimeout(
    `${config.apiBase}${path}`,
    init,
    config.requestTimeoutMs,
  );
  if (!response.ok && response.status !== 204) {
    let body: Record<string, unknown> = {};
    try {
      body = await response.json() as Record<string, unknown>;
    } catch {
      // 非 JSON 错误仍保留 HTTP 状态。
    }
    throw new CfV2HttpError(
      response.status,
      typeof body.error === "string" ? body.error : "unknown",
      typeof body.message === "string" ? body.message : `HTTP ${response.status}`,
      body,
    );
  }
  return response;
}

async function fetchWithTimeout(
  input: RequestInfo | URL,
  init: RequestInit | undefined,
  timeoutMs: number,
): Promise<Response> {
  const controller = new AbortController();
  const timeoutId = globalThis.setTimeout(() => {
    controller.abort(new DOMException(`Cloudflare request timed out after ${timeoutMs} ms.`, "TimeoutError"));
  }, timeoutMs);
  try {
    return await fetch(input, { ...init, signal: controller.signal });
  } finally {
    globalThis.clearTimeout(timeoutId);
  }
}

function wait(delayMs: number): Promise<void> {
  return new Promise((resolve) => {
    globalThis.setTimeout(resolve, delayMs);
  });
}

async function runConcurrent<TValue>(
  values: readonly TValue[],
  concurrency: number,
  task: (value: TValue) => Promise<void>,
  reportActivity: CfV2WorkerActivityReporter,
): Promise<void> {
  if (values.length === 0) {
    reportActivity({ activeRequestCount: 0, queuedRequestCount: 0 });
    return;
  }
  let nextIndex = 0;
  let active = 0;
  const report = () => {
    reportActivity({
      activeRequestCount: active,
      queuedRequestCount: Math.max(0, values.length - nextIndex),
    });
  };
  const worker = async (): Promise<void> => {
    while (nextIndex < values.length) {
      const index = nextIndex;
      nextIndex += 1;
      active += 1;
      report();
      try {
        const value = values[index];
        if (value !== undefined) {
          await task(value);
        }
      } finally {
        active -= 1;
        report();
      }
    }
  };
  await Promise.all(Array.from(
    { length: Math.min(concurrency, values.length) },
    async () => await worker(),
  ));
}

function normalizeConfig(config: CfV2WorkerConfig): CfV2WorkerConfig {
  return {
    apiBase: config.apiBase.replace(/\/$/, ""),
    spaceId: config.spaceId.trim() || "default",
    maxConcurrentRequests: Number.isFinite(config.maxConcurrentRequests)
      ? Math.max(1, Math.min(16, Math.round(config.maxConcurrentRequests)))
      : 4,
    requestTimeoutMs: Number.isFinite(config.requestTimeoutMs)
      ? Math.max(1_000, Math.round(config.requestTimeoutMs))
      : 30_000,
  };
}

function createScopeKey(config: CfV2WorkerConfig): string {
  return `${config.apiBase}\u0000${config.spaceId}`;
}

function stripSha256Prefix(hash: string): string {
  return hash.startsWith("sha256:") ? hash.slice(7) : hash;
}

function toProtocolContentHash(hash: string): string {
  return hash.startsWith("sha256:") ? hash : `sha256:${hash}`;
}

function normalizePlanResponse(value: unknown): CfV2PlanResponse {
  const record = requireRecord(value, "Cloudflare plan");
  if (!Array.isArray(record.assets)) {
    throw new Error("Cloudflare plan has no assets array.");
  }
  return {
    ...(record as unknown as CfV2PlanResponse),
    revision: normalizeRevision(record.revision),
    assets: record.assets.map((assetValue) => {
      const asset = requireRecord(assetValue, "Cloudflare plan asset");
      return {
        ...(asset as unknown as CfV2PlanResponse["assets"][number]),
        lastModifiedRevision: normalizeRevision(asset.lastModifiedRevision),
      };
    }),
  };
}

function normalizeCheckResponse(value: unknown): CfV2CheckResponse {
  const record = requireRecord(value, "Cloudflare check response");
  return {
    ...(record as unknown as CfV2CheckResponse),
    revision: normalizeRevision(record.revision),
  };
}

function normalizePrepareResponse(value: unknown): CfV2PrepareResponse {
  const record = requireRecord(value, "Cloudflare prepare response");
  return {
    ...(record as unknown as CfV2PrepareResponse),
    baseRevision: normalizeRevision(record.baseRevision),
    targetRevision: normalizeRevision(record.targetRevision),
  };
}

function normalizeCommitResult(value: unknown): CfV2CommitResult {
  const record = requireRecord(value, "Cloudflare commit response");
  if (!Array.isArray(record.assets)) {
    throw new Error("Cloudflare commit response has no assets array.");
  }
  return {
    ...(record as unknown as CfV2CommitResult),
    revision: normalizeRevision(record.revision),
    assets: record.assets.map((assetValue) => {
      const asset = requireRecord(assetValue, "Cloudflare committed asset");
      return {
        ...(asset as unknown as CfV2CommitResult["assets"][number]),
        lastModifiedRevision: normalizeRevision(asset.lastModifiedRevision),
      };
    }),
  };
}

function normalizeRevision(value: unknown): CfV2Revision {
  if (typeof value === "string" && value.trim() !== "") {
    return value;
  }
  if (typeof value === "number" && Number.isFinite(value)) {
    // 兼容旧部署与测试夹具，写回协议时统一使用字符串。
    return String(value);
  }
  throw new Error("Cloudflare response contains an invalid revision.");
}

function toAdapterRevision(revision: CfV2Revision): number {
  if (/^\d+$/.test(revision)) {
    const numeric = Number(revision);
    if (Number.isSafeInteger(numeric)) {
      return numeric;
    }
  }
  const timestampMatch = /-(\d+)$/.exec(revision);
  if (timestampMatch?.[1] !== undefined) {
    const timestamp = Number(timestampMatch[1]);
    if (Number.isSafeInteger(timestamp)) {
      return timestamp;
    }
  }
  let hash = 0x811c9dc5;
  for (let index = 0; index < revision.length; index += 1) {
    hash ^= revision.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

function requireRecord(value: unknown, label: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null) {
    throw new Error(`${label} is not an object.`);
  }
  return value as Record<string, unknown>;
}
