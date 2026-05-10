import type {
  WorldDocument,
} from "@/domain/document/world-document";
import type {
  EditorHistoryActionDescriptor,
} from "@/domain/editor/editor-history";
import type {
  SnapshotStoreReadWrite,
} from "@/shared/snapshot/snapshot-store";

import {
  createWorldDocumentDelta,
} from "./history-delta";
import type {
  EditorHistoryRuntime,
} from "./history-runtime";

export type EditorDocumentWriteMode = "record" | "silent" | "replay";

export interface EditorDocumentWriter {
  commit(options: {
    action: EditorHistoryActionDescriptor;
    update(current: WorldDocument): WorldDocument;
    mode?: EditorDocumentWriteMode;
  }): WorldDocument | null;
  setSnapshot(
    nextDocument: WorldDocument,
    options?: {
      action?: EditorHistoryActionDescriptor;
      mode?: EditorDocumentWriteMode;
    },
  ): WorldDocument | null;
}

export function createEditorDocumentWriter(options: {
  document: SnapshotStoreReadWrite<WorldDocument>;
  history: EditorHistoryRuntime;
}): EditorDocumentWriter {
  const writeDocument = (
    nextDocument: WorldDocument,
    action: EditorHistoryActionDescriptor,
    mode: EditorDocumentWriteMode,
  ): WorldDocument | null => {
    const currentDocument = options.document.getSnapshot();

    if (currentDocument === nextDocument) {
      return null;
    }

    const delta = createWorldDocumentDelta(currentDocument, nextDocument);

    if (delta === null) {
      return null;
    }

    const committedDocument = options.document.setSnapshot(nextDocument);

    if (mode === "record") {
      options.history.record({
        documentKey: committedDocument.documentKey,
        action,
        delta,
      });
    }

    return committedDocument;
  };

  return {
    commit: ({ action, update, mode = "record" }) => {
      return writeDocument(
        update(options.document.getSnapshot()),
        action,
        mode,
      );
    },
    setSnapshot: (
      nextDocument,
      {
        action = {
          type: "document.unknown",
          label: "Document update",
        },
        mode = "record",
      } = {},
    ) => {
      return writeDocument(nextDocument, action, mode);
    },
  };
}
