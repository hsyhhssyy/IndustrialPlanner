import {
  applyRawIndexedDbTransactionMutations,
  readRawFromIndexedDb,
  type IndexedDbStoreMutationBatch,
} from "@/shared/storage/browser-storage";

import type {
  CfV2PrepareRequest,
  CfV2PrepareResponse,
} from "./cloudflare-v2-types";
import { CF_V2_DATABASE_NAME } from "./cloudflare-v2-local-state";
import type {
  CfV2CommitBatchResult,
  CfV2WorkerConfig,
  CfV2WorkerMutation,
} from "./cloudflare-v2-worker-protocol";

const CF_UPLOAD_JOURNAL_STORE = "cf-sync-upload-journal";
const CF_UPLOAD_PAYLOAD_STORE = "cf-sync-upload-payloads";

export type CfV2UploadJournalPhase =
  | "sealed"
  | "prepared"
  | "uploading"
  | "committing"
  | "committed";

export interface CfV2PersistedMutation extends Omit<CfV2WorkerMutation, "value"> {
  readonly payloadKey: string | null;
}

export interface CfV2UploadJournalRecord {
  readonly schemaVersion: 1;
  readonly scopeKey: string;
  readonly journalId: string;
  readonly phase: CfV2UploadJournalPhase;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly prepareRequest: CfV2PrepareRequest;
  readonly mutations: readonly CfV2PersistedMutation[];
  readonly prepare: CfV2PrepareResponse | null;
  readonly result: CfV2CommitBatchResult | null;
}

export interface CfV2SealedPayload {
  readonly mutation: CfV2WorkerMutation;
  readonly bytes: Uint8Array<ArrayBuffer> | null;
}

export class CloudflareV2UploadJournal {
  private readonly scopeKey: string;

  public constructor(config: CfV2WorkerConfig) {
    this.scopeKey = `${config.apiBase}\u0000${config.spaceId}`;
  }

  public async read(): Promise<CfV2UploadJournalRecord | null> {
    const value = await readRawFromIndexedDb<unknown>({
      databaseName: CF_V2_DATABASE_NAME,
      storeName: CF_UPLOAD_JOURNAL_STORE,
      key: this.scopeKey,
    });
    return normalizeJournal(value, this.scopeKey);
  }

  public async seal(options: {
    readonly journalId: string;
    readonly prepareRequest: CfV2PrepareRequest;
    readonly payloads: readonly CfV2SealedPayload[];
  }): Promise<CfV2UploadJournalRecord> {
    const now = new Date().toISOString();
    const mutations: CfV2PersistedMutation[] = options.payloads.map(({ mutation, bytes }) =>
      toPersistedMutation(
        mutation,
        bytes === null
          ? null
          : this.createPayloadKey(options.journalId, mutation.clientMutationId),
      )
    );
    const record: CfV2UploadJournalRecord = {
      schemaVersion: 1,
      scopeKey: this.scopeKey,
      journalId: options.journalId,
      phase: "sealed",
      createdAt: now,
      updatedAt: now,
      prepareRequest: options.prepareRequest,
      mutations,
      prepare: null,
      result: null,
    };

    const batches: Array<IndexedDbStoreMutationBatch<unknown>> = [{
      storeName: CF_UPLOAD_JOURNAL_STORE,
      operations: [{ type: "put", key: this.scopeKey, value: record }],
    }, {
      storeName: CF_UPLOAD_PAYLOAD_STORE,
      operations: options.payloads.flatMap(({ mutation, bytes }) =>
        bytes === null
          ? []
          : [{
              type: "put" as const,
              key: this.createPayloadKey(options.journalId, mutation.clientMutationId),
              value: bytes,
            }]
      ),
    }];
    const saved = await applyRawIndexedDbTransactionMutations(
      { databaseName: CF_V2_DATABASE_NAME },
      batches,
    );
    if (!saved) {
      throw new Error("Failed to persist Cloudflare upload journal.");
    }
    return record;
  }

  public async update(
    record: CfV2UploadJournalRecord,
    patch: Partial<Pick<CfV2UploadJournalRecord, "phase" | "prepare" | "result">>,
  ): Promise<CfV2UploadJournalRecord> {
    const next: CfV2UploadJournalRecord = {
      ...record,
      ...patch,
      updatedAt: new Date().toISOString(),
    };
    const saved = await applyRawIndexedDbTransactionMutations(
      { databaseName: CF_V2_DATABASE_NAME },
      [{
        storeName: CF_UPLOAD_JOURNAL_STORE,
        operations: [{ type: "put", key: this.scopeKey, value: next }],
      }],
    );
    if (!saved) {
      throw new Error("Failed to advance Cloudflare upload journal.");
    }
    return next;
  }

  public async readPayload(
    mutation: CfV2PersistedMutation,
  ): Promise<Uint8Array<ArrayBuffer> | null> {
    if (mutation.payloadKey === null) {
      return null;
    }
    const value = await readRawFromIndexedDb<unknown>({
      databaseName: CF_V2_DATABASE_NAME,
      storeName: CF_UPLOAD_PAYLOAD_STORE,
      key: mutation.payloadKey,
    });
    if (ArrayBuffer.isView(value)) {
      const view = value as ArrayBufferView;
      const bytes = new Uint8Array(view.buffer, view.byteOffset, view.byteLength);
      return new Uint8Array(bytes);
    }
    if (value instanceof ArrayBuffer) {
      return new Uint8Array(value.slice(0));
    }
    return null;
  }

  public async clear(record?: CfV2UploadJournalRecord | null): Promise<void> {
    const current = record ?? await this.read();
    const payloadKeys = current?.mutations.flatMap((mutation) =>
      mutation.payloadKey === null ? [] : [mutation.payloadKey]
    ) ?? [];
    const cleared = await applyRawIndexedDbTransactionMutations(
      { databaseName: CF_V2_DATABASE_NAME },
      [{
        storeName: CF_UPLOAD_JOURNAL_STORE,
        operations: [{ type: "delete", key: this.scopeKey }],
      }, {
        storeName: CF_UPLOAD_PAYLOAD_STORE,
        operations: payloadKeys.map((key) => ({ type: "delete", key })),
      }],
    );
    if (!cleared) {
      throw new Error("Failed to clear Cloudflare upload journal.");
    }
  }

  private createPayloadKey(journalId: string, mutationId: string): string {
    return `${this.scopeKey}\u0000${journalId}\u0000${mutationId}`;
  }
}

function normalizeJournal(
  value: unknown,
  scopeKey: string,
): CfV2UploadJournalRecord | null {
  if (typeof value !== "object" || value === null) {
    return null;
  }
  const record = value as Partial<CfV2UploadJournalRecord>;
  return record.schemaVersion === 1
    && record.scopeKey === scopeKey
    && typeof record.journalId === "string"
    && typeof record.phase === "string"
    && typeof record.createdAt === "string"
    && typeof record.updatedAt === "string"
    && typeof record.prepareRequest === "object"
    && Array.isArray(record.mutations)
    ? record as CfV2UploadJournalRecord
    : null;
}

function toPersistedMutation(
  mutation: CfV2WorkerMutation,
  payloadKey: string | null,
): CfV2PersistedMutation {
  return {
    clientMutationId: mutation.clientMutationId,
    operation: mutation.operation,
    adapterId: mutation.adapterId,
    adapterAssetId: mutation.adapterAssetId,
    assetType: mutation.assetType,
    assetId: mutation.assetId,
    adapterContentHash: mutation.adapterContentHash,
    deletedAt: mutation.deletedAt,
    payloadKey,
  };
}
