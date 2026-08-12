import { describe, expect, it, vi } from "vitest";

import { createWorldDocument } from "@/domain/document/world-document";
import {
  createEditorDocumentWriter,
  type EditorHistoryRuntime,
} from "@/editor/history";
import { createSnapshotStore } from "@/shared/snapshot/snapshot-store";

describe("editor document writer origin", () => {
  it("marks synchronized documents as remote-sync snapshots", () => {
    const initialDocument = createWorldDocument();
    const document = createSnapshotStore(initialDocument);
    const origins: string[] = [];
    const history = {
      record: vi.fn(),
    } as unknown as EditorHistoryRuntime;
    const writer = createEditorDocumentWriter({ document, history });
    const unsubscribe = document.subscribe((_snapshot, context) => {
      origins.push(context.origin);
    });

    writer.setSnapshot({
      ...initialDocument,
      documentSettings: {
        ...initialDocument.documentSettings,
        viewport: {
          ...initialDocument.documentSettings.viewport,
          gridSize: initialDocument.documentSettings.viewport.gridSize + 1,
        },
      },
    }, { mode: "remote-sync" });
    unsubscribe();

    expect(origins).toEqual(["initial", "remote-sync"]);
    expect(history.record).not.toHaveBeenCalled();
  });
});
