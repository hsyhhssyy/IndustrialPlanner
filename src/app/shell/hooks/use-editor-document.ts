import { useMemo, useSyncExternalStore } from "react";

import type { WorldDocument } from "@/domain/document/world-document";
import type { EditorContract } from "@/domain/editor/editor-contract";
import { createSnapshotSelector } from "@/shared/snapshot/snapshot-selector";

const emptySubscribe = () => () => undefined;
const emptySnapshot = () => null;

export function useEditorDocumentSnapshot<T>(
  editor: EditorContract | null,
  select: (document: WorldDocument) => T,
  isEqual: (left: T, right: T) => boolean = Object.is,
): T | null {
  const selection = useMemo(() => editor === null ? null
    : createSnapshotSelector(editor.document, select, isEqual), [editor, select, isEqual]);
  return useSyncExternalStore(
    selection?.subscribe ?? emptySubscribe,
    selection?.getSnapshot ?? emptySnapshot,
    selection?.getSnapshot ?? emptySnapshot,
  );
}
