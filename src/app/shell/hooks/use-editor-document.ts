import { useSyncExternalStore } from "react";

import type { WorldDocument } from "@/domain/document/world-document";
import type { EditorContract } from "@/domain/editor/editor-contract";

export function useEditorDocumentSnapshot(
  editor: EditorContract | null,
): WorldDocument | null {
  return useSyncExternalStore(
    (onStoreChange) => editor?.document.subscribe(onStoreChange) ?? (() => undefined),
    () => editor?.document.getSnapshot() ?? null,
    () => editor?.document.getSnapshot() ?? null,
  );
}
