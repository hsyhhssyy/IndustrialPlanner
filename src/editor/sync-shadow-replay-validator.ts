import {
  appendLocalSyncDiagnosticEvent,
  compactWorldDocumentShadowOutbox,
  markWorldDocumentShadowEntryValidated,
  type LocalSyncDataOwner,
  type LocalSyncOutboxEntry,
} from "@/shared/storage";
import { ENABLE_LOCAL_SYNC_SHADOW_MODE } from "@/shared/storage/sync-shadow-build-flags";
import type { WorldDocument } from "@/domain/document/world-document";

import type {
  SyncShadowReplayWorkerRequest,
  SyncShadowReplayWorkerResponse,
} from "./sync-shadow-replay-worker";

export interface SyncShadowReplayValidationInput {
  readonly baseDocument: WorldDocument;
  readonly outboxEntry: LocalSyncOutboxEntry;
}

export interface SyncShadowReplayValidator {
  validate(input: SyncShadowReplayValidationInput): void;
  dispose(): void;
}

export function createSyncShadowReplayValidator(): SyncShadowReplayValidator {
  let disposed = false;
  let worker: Worker | null = null;
  let sequence = 0;
  let queue = Promise.resolve();
  const pendingRequests = new Map<string, {
    readonly resolve: (response: SyncShadowReplayWorkerResponse) => void;
  }>();

  const ensureWorker = (): Worker | null => {
    if (!ENABLE_LOCAL_SYNC_SHADOW_MODE || disposed) {
      return null;
    }

    if (typeof globalThis.Worker === "undefined") {
      return null;
    }

    if (worker !== null) {
      return worker;
    }

    worker = new Worker(new URL("./sync-shadow-replay-worker.ts", import.meta.url), {
      type: "module",
    });
    worker.addEventListener(
      "message",
      (event: MessageEvent<SyncShadowReplayWorkerResponse>) => {
        const pendingRequest = pendingRequests.get(event.data.id);

        if (pendingRequest === undefined) {
          return;
        }

        pendingRequests.delete(event.data.id);
        pendingRequest.resolve(event.data);
      },
    );

    return worker;
  };

  const validate = (input: SyncShadowReplayValidationInput): void => {
    if (!ENABLE_LOCAL_SYNC_SHADOW_MODE || disposed) {
      return;
    }

    queue = queue
      .catch(() => undefined)
      .then(() => validateSequentially(input));
  };

  const validateSequentially = async (
    input: SyncShadowReplayValidationInput,
  ): Promise<void> => {
    if (disposed) {
      return;
    }

    const payload = input.outboxEntry.operationPayload;

    if (payload.type !== "world-document.history-delta") {
      return;
    }

    const activeWorker = ensureWorker();

    if (activeWorker === null) {
      await appendLocalSyncDiagnosticEvent({
        owner: input.outboxEntry.owner,
        severity: "warning",
        category: "replay",
        code: "replay.worker_unavailable",
        assetType: "world-document",
        assetId: input.outboxEntry.assetId,
        localSequence: input.outboxEntry.localSequence,
      });
      return;
    }

    const request: SyncShadowReplayWorkerRequest = {
      id: `shadow-replay:${Date.now()}:${sequence += 1}`,
      documentKey: input.outboxEntry.assetId,
      localSequence: input.outboxEntry.localSequence,
      baseDocument: input.baseDocument,
      delta: payload.delta,
      targetMeta: payload.targetMeta,
      expectedHash: payload.targetContentHash,
    };
    const response = await postReplayRequest(activeWorker, request);

    await handleReplayResponse(response, input.outboxEntry.owner);
  };

  const postReplayRequest = async (
    activeWorker: Worker,
    request: SyncShadowReplayWorkerRequest,
  ): Promise<SyncShadowReplayWorkerResponse> => {
    return await new Promise((resolve) => {
      const timeoutId = globalThis.setTimeout(() => {
        pendingRequests.delete(request.id);
        resolve({
          id: request.id,
          status: "failed",
          documentKey: request.documentKey,
          localSequence: request.localSequence,
          expectedHash: request.expectedHash,
          errorMessage: "Replay worker timed out.",
        });
      }, 15_000);

      pendingRequests.set(request.id, {
        resolve: (response) => {
          globalThis.clearTimeout(timeoutId);
          resolve(response);
        },
      });
      try {
        activeWorker.postMessage(request);
      } catch (error) {
        pendingRequests.delete(request.id);
        globalThis.clearTimeout(timeoutId);
        resolve({
          id: request.id,
          status: "failed",
          documentKey: request.documentKey,
          localSequence: request.localSequence,
          expectedHash: request.expectedHash,
          errorMessage: `DataCloneError: ${error instanceof Error ? error.message : String(error)}`,
        });
      }
    });
  };

  const dispose = (): void => {
    disposed = true;
    pendingRequests.clear();
    worker?.terminate();
    worker = null;
  };

  return {
    validate,
    dispose,
  };
}

async function handleReplayResponse(
  response: SyncShadowReplayWorkerResponse,
  owner: LocalSyncDataOwner,
): Promise<void> {
  if (response.status === "validated") {
    await markWorldDocumentShadowEntryValidated({
      owner,
      documentKey: response.documentKey,
      localSequence: response.localSequence,
    });
    await compactWorldDocumentShadowOutbox({
      owner,
      documentKey: response.documentKey,
      throughLocalSequence: response.localSequence,
      baseContentHash: response.actualHash,
    });
    return;
  }

  await appendLocalSyncDiagnosticEvent({
    owner,
    severity: response.status === "mismatch" ? "error" : "warning",
    category: "replay",
    code: response.status === "mismatch" ? "replay.mismatch" : "replay.failed",
    assetType: "world-document",
    assetId: response.documentKey,
    localSequence: response.localSequence,
    details: response.status === "mismatch"
      ? {
        expectedHash: response.expectedHash,
        actualHash: response.actualHash,
      }
      : {
        expectedHash: response.expectedHash,
        errorMessage: response.errorMessage,
      },
  });
}
