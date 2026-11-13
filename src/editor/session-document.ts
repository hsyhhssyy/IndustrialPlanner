import type { WorldDocument } from "@/domain/document/world-document";
import type { EditorSessionSnapshot } from "@/domain/editor/types/editor-session-types";
import { freezeSnapshot } from "@/shared/snapshot/freeze-snapshot";
import { createSnapshotSelector } from "@/shared/snapshot/snapshot-selector";
import { createSnapshotStore, type SnapshotStoreReadWrite } from "@/shared/snapshot/snapshot-store";

/** 文档订阅是完整会话快照的投影，回调中始终可读取同一次提交的意图。 */
export function createSessionDocument<TIntent>(initialDocument: WorldDocument, initialIntent: TIntent, beforeDocumentChange?: () => void) {
  const snapshot = createSnapshotStore<EditorSessionSnapshot<TIntent>>({
    document: freezeSnapshot(initialDocument),
    intent: freezeSnapshot(structuredClone(initialIntent)),
    revision: 0,
  }, freezeSnapshot);
  const selectedDocument = createSnapshotSelector(snapshot, (value) => value.document);
  const publish = (document: WorldDocument, intent: TIntent, origin: "local" | "remote-sync") => {
    if (snapshot.getSnapshot().document.documentKey !== document.documentKey) beforeDocumentChange?.();
    const current = snapshot.getSnapshot();
    if (current.document === document && current.intent === intent) return document;
    snapshot.setSnapshot({ document, intent, revision: current.revision + 1 }, { origin });
    return document;
  };
  const document: SnapshotStoreReadWrite<WorldDocument> = {
    getSnapshot: selectedDocument.getSnapshot,
    subscribe: selectedDocument.subscribe,
    setSnapshot: (next, options) => publish(freezeSnapshot(next), snapshot.getSnapshot().intent, options?.origin ?? "local"),
    update: (updater, options) => document.setSnapshot(
      typeof updater === "function" ? updater(document.getSnapshot()) : updater, options,
    ),
  };
  return { snapshot, document, publish };
}
