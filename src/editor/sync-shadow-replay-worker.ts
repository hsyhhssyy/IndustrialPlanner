/// <reference lib="webworker" />

import type { WorldDocument } from "@/domain/document/world-document";
import type { EditorHistoryDocumentDelta } from "@/domain/editor/editor-history";
import { createStableJsonHash } from "@/shared/storage/sync-shadow-storage";

import { applyWorldDocumentDelta } from "./history";

export interface SyncShadowReplayWorkerRequest {
  readonly id: string;
  readonly documentKey: string;
  readonly localSequence: number;
  readonly baseDocument: WorldDocument;
  readonly delta: EditorHistoryDocumentDelta;
  readonly targetMeta: WorldDocument["meta"];
  readonly expectedHash: string;
}

export type SyncShadowReplayWorkerResponse =
  | {
    readonly id: string;
    readonly status: "validated";
    readonly documentKey: string;
    readonly localSequence: number;
    readonly expectedHash: string;
    readonly actualHash: string;
  }
  | {
    readonly id: string;
    readonly status: "mismatch";
    readonly documentKey: string;
    readonly localSequence: number;
    readonly expectedHash: string;
    readonly actualHash: string;
  }
  | {
    readonly id: string;
    readonly status: "failed";
    readonly documentKey: string;
    readonly localSequence: number;
    readonly expectedHash: string;
    readonly errorMessage: string;
  };

export function validateWorldDocumentShadowReplay(
  request: SyncShadowReplayWorkerRequest,
): SyncShadowReplayWorkerResponse {
  try {
    const replayedDocument: WorldDocument = {
      ...applyWorldDocumentDelta(request.baseDocument, request.delta, "forward"),
      meta: {
        ...request.targetMeta,
      },
    };
    const actualHash = createStableJsonHash(replayedDocument);

    if (actualHash !== request.expectedHash) {
      return {
        id: request.id,
        status: "mismatch",
        documentKey: request.documentKey,
        localSequence: request.localSequence,
        expectedHash: request.expectedHash,
        actualHash,
      };
    }

    return {
      id: request.id,
      status: "validated",
      documentKey: request.documentKey,
      localSequence: request.localSequence,
      expectedHash: request.expectedHash,
      actualHash,
    };
  } catch (error) {
    return {
      id: request.id,
      status: "failed",
      documentKey: request.documentKey,
      localSequence: request.localSequence,
      expectedHash: request.expectedHash,
      errorMessage: error instanceof Error ? error.message : "Unknown replay error.",
    };
  }
}

const maybeWorkerScope = typeof self === "undefined"
  ? null
  : self as DedicatedWorkerGlobalScope & { importScripts?: unknown };

if (typeof maybeWorkerScope?.importScripts === "function") {
  maybeWorkerScope.addEventListener(
    "message",
    (event: MessageEvent<SyncShadowReplayWorkerRequest>) => {
      maybeWorkerScope.postMessage(validateWorldDocumentShadowReplay(event.data));
    },
  );
}
