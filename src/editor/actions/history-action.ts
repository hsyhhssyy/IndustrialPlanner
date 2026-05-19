import type {
  EditorHistoryRecord,
} from "@/domain/editor/editor-history";
import type {
  EditorAction,
} from "@/domain/editor/editor-action";

import {
  applyWorldDocumentDelta,
} from "../history";
import { syncPoweredEntityCollection } from "./powered-collection";
import type {
  EditorActionsContext,
} from "./types";

type EditorHistoryActions = Pick<
  EditorAction,
  | "clearDocumentHistory"
  | "redoDocumentHistory"
  | "restoreDocumentHistoryTo"
  | "undoDocumentHistory"
>;

export function createEditorHistoryActions({
  document,
  documentWriter,
  history,
  state,
  workspace,
}: EditorActionsContext): EditorHistoryActions {
  return {
    undoDocumentHistory: () => {
      const currentDocument = document.getSnapshot();
      const record = history.getUndoRecord();

      if (record === null || record.documentKey !== currentDocument.documentKey) {
        return false;
      }

      const nextDocument = applyWorldDocumentDelta(
        currentDocument,
        record.delta,
        "inverse",
      );

      const committedDocument = documentWriter.setSnapshot(nextDocument, {
        action: createRestoreAction("撤销", record),
        mode: "replay",
      });
      if (committedDocument !== null) {
        syncPoweredEntityCollection({
          document: committedDocument,
          state,
          workspace,
        });
      }
      history.setCursorSequence(currentDocument.documentKey, record.sequence - 1);

      return true;
    },

    redoDocumentHistory: () => {
      const currentDocument = document.getSnapshot();
      const record = history.getRedoRecord();

      if (record === null || record.documentKey !== currentDocument.documentKey) {
        return false;
      }

      const nextDocument = applyWorldDocumentDelta(
        currentDocument,
        record.delta,
        "forward",
      );

      const committedDocument = documentWriter.setSnapshot(nextDocument, {
        action: createRestoreAction("重做", record),
        mode: "replay",
      });
      if (committedDocument !== null) {
        syncPoweredEntityCollection({
          document: committedDocument,
          state,
          workspace,
        });
      }
      history.setCursorSequence(currentDocument.documentKey, record.sequence);

      return true;
    },

    restoreDocumentHistoryTo: (sequence) => {
      const targetSequence = normalizeTargetSequence(sequence);

      if (targetSequence === null) {
        return false;
      }

      const currentDocument = document.getSnapshot();

      if (
        state.history.documentKey !== currentDocument.documentKey
        || targetSequence < 0
        || targetSequence > state.history.headSequence
        || targetSequence === state.history.cursorSequence
      ) {
        return false;
      }

      const restoreRecords = resolveRestoreRecords({
        records: state.history.records,
        cursorSequence: state.history.cursorSequence,
        targetSequence,
      });

      if (restoreRecords.length === 0) {
        return false;
      }

      const nextDocument = restoreRecords.reduce(
        (workingDocument, record) => applyWorldDocumentDelta(
          workingDocument,
          record.delta,
          targetSequence > state.history.cursorSequence ? "forward" : "inverse",
        ),
        currentDocument,
      );

      const committedDocument = documentWriter.setSnapshot(nextDocument, {
        action: createRestoreAction("还原历史", restoreRecords.at(-1) ?? restoreRecords[0]),
        mode: "replay",
      });
      if (committedDocument !== null) {
        syncPoweredEntityCollection({
          document: committedDocument,
          state,
          workspace,
        });
      }
      history.setCursorSequence(currentDocument.documentKey, targetSequence);

      return true;
    },

    clearDocumentHistory: () => {
      history.clear(document.getSnapshot().documentKey);
    },
  };
}

function resolveRestoreRecords(options: {
  records: readonly EditorHistoryRecord[];
  cursorSequence: number;
  targetSequence: number;
}): EditorHistoryRecord[] {
  if (options.targetSequence > options.cursorSequence) {
    return options.records.filter((record) =>
      record.sequence > options.cursorSequence
      && record.sequence <= options.targetSequence,
    );
  }

  return options.records
    .filter((record) =>
      record.sequence <= options.cursorSequence
      && record.sequence > options.targetSequence,
    )
    .slice()
    .sort((left, right) => right.sequence - left.sequence);
}

function normalizeTargetSequence(sequence: number): number | null {
  if (!Number.isFinite(sequence)) {
    return null;
  }

  return Math.floor(sequence);
}

function createRestoreAction(
  label: string,
  record: EditorHistoryRecord | undefined,
) {
  return {
    type: "document.restore" as const,
    label,
    detail: record?.action.label,
    entityIds: record?.action.entityIds,
    definitionIds: record?.action.definitionIds,
    blueprintId: record?.action.blueprintId,
    blueprintName: record?.action.blueprintName,
    count: record?.action.count,
  };
}
