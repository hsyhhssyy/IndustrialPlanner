import { describe, expect, it, vi } from "vitest";

import { createWorldDocument } from "@/domain/document/world-document";
import {
  createEditorDocumentWriter,
  EditorHistoryRuntime,
} from "@/editor/history";
import { createSnapshotStore } from "@/shared/snapshot/snapshot-store";
import { createEditorStateReadWrite } from "@/editor/state-impl";

describe("editor document writer origin", () => {
  it("notifies new successful local edits without replaying loaded, silent, remote or replay snapshots", async () => {
    const initial = createWorldDocument();
    const document = createSnapshotStore(initial);
    const history = new EditorHistoryRuntime(createEditorStateReadWrite().history);
    const writer = createEditorDocumentWriter({ document, history });
    const received: string[] = [];
    const unsubscribe = history.subscribeCommittedEdits((record) => received.push(record.action.label));
    history.loadDocumentHistory(initial.documentKey);
    await history.flush();
    expect(received).toEqual([]);
    const update = (label: string, mode: "record" | "silent" | "remote-sync" | "replay") => {
      writer.commit({ mode, action: { type: "document.settings.patch", label },
        update: (current) => ({ ...current, documentSettings: { ...current.documentSettings, custom: label } }) });
    };
    update("local", "record");
    update("local", "record");
    update("remote", "remote-sync");
    update("silent", "silent");
    update("replay", "replay");
    history.setCursorSequence(initial.documentKey, 0);
    expect(received).toEqual(["local"]);
    unsubscribe();
    update("after unsubscribe", "record");
    expect(received).toEqual(["local"]);
    history.dispose();
    await history.flush();
  });

  it("isolates observer errors after commit and continues notifying other subscribers", async () => {
    const document = createSnapshotStore(createWorldDocument());
    const history = new EditorHistoryRuntime(createEditorStateReadWrite().history);
    const writer = createEditorDocumentWriter({ document, history });
    const log = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const received: string[] = [];
    history.subscribeCommittedEdits(() => { throw new Error("observer failed"); });
    history.subscribeCommittedEdits((record) => received.push(record.documentKey));
    try {
      writer.commit({ action: { type: "document.settings.patch", label: "edit" },
        update: (current) => ({ ...current, documentSettings: { ...current.documentSettings, custom: true } }) });
      expect(document.getSnapshot().documentSettings.custom).toBe(true);
      expect(received).toEqual([document.getSnapshot().documentKey]);
      expect(log).toHaveBeenCalledOnce();
      await history.flush();
    } finally {
      log.mockRestore();
      history.dispose();
    }
  });
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
