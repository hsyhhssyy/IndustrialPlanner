import { describe, expect, it } from "vitest";

import {
  createWorldDocument,
  type WorldDocument,
} from "@/domain/document/world-document";
import { createStableJsonHash } from "@/shared/storage/sync-shadow-storage";
import { createWorldDocumentDelta } from "@/editor/history";
import { validateWorldDocumentShadowReplay } from "@/editor/sync-shadow-replay-worker";

describe("sync shadow replay worker", () => {
  it("validates a replayed world document delta against the expected hash", () => {
    const baseDocument = createWorldDocument();
    const nextDocument: WorldDocument = {
      ...baseDocument,
      meta: {
        ...baseDocument.meta,
        updatedAt: "2026-07-15T00:10:00.000Z",
      },
      entities: {
        "entity-1": {
          id: "entity-1",
          definitionId: "item_port_storager_1",
          position: { x: 1, y: 2 },
          rotation: 0,
          config: {},
          tags: [],
        },
      },
      entityOrder: ["entity-1"],
    };
    const delta = createWorldDocumentDelta(baseDocument, nextDocument);

    expect(delta).not.toBeNull();

    const response = validateWorldDocumentShadowReplay({
      id: "request-1",
      documentKey: nextDocument.documentKey,
      localSequence: 1,
      baseDocument,
      delta: delta!,
      targetMeta: nextDocument.meta,
      expectedHash: createStableJsonHash(nextDocument),
    });

    expect(response).toMatchObject({
      id: "request-1",
      status: "validated",
      documentKey: nextDocument.documentKey,
      localSequence: 1,
      expectedHash: createStableJsonHash(nextDocument),
      actualHash: createStableJsonHash(nextDocument),
    });
  });

  it("reports a mismatch when replay does not match the target hash", () => {
    const baseDocument = createWorldDocument();
    const nextDocument: WorldDocument = {
      ...baseDocument,
      meta: {
        ...baseDocument.meta,
        updatedAt: "2026-07-15T00:10:00.000Z",
      },
      entities: {
        "entity-1": {
          id: "entity-1",
          definitionId: "item_port_storager_1",
          position: { x: 1, y: 2 },
          rotation: 0,
          config: {},
          tags: [],
        },
      },
      entityOrder: ["entity-1"],
    };
    const delta = createWorldDocumentDelta(baseDocument, nextDocument);

    expect(delta).not.toBeNull();

    const response = validateWorldDocumentShadowReplay({
      id: "request-2",
      documentKey: nextDocument.documentKey,
      localSequence: 1,
      baseDocument,
      delta: delta!,
      targetMeta: nextDocument.meta,
      expectedHash: "fnv1a32:00000000",
    });

    expect(response).toMatchObject({
      id: "request-2",
      status: "mismatch",
      documentKey: nextDocument.documentKey,
      localSequence: 1,
      expectedHash: "fnv1a32:00000000",
      actualHash: createStableJsonHash(nextDocument),
    });
  });
});
