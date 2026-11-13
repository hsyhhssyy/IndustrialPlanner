import type {
  EditorHistoryRecord,
} from "@/domain/editor/editor-history";
import type {
  EditorAction,
} from "@/domain/editor/editor-action";

import {
  applyWorldDocumentDelta,
} from "../history";
import { action } from "mobx";
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
  workspace: _workspace,
}: EditorActionsContext): EditorHistoryActions {
  return {
    undoDocumentHistory: action(() => {
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

      const committed = documentWriter.setSnapshot(nextDocument, {
        action: createRestoreAction("撤销", record),
        mode: "replay",
        replay: { record, direction: "inverse", targetSequence: record.sequence - 1 },
      });
      if (committed === null) return false;
      // AI-REMOVED 2026-11-12:
      // Reason: 游标与文档必须在一次发布中更新。
      // Trigger: REQ-048 原子历史恢复。
      // Evidence: 原 document 订阅先于游标更新。
      // Replacement: documentWriter 的 replay 事务。
      // Risk: Low
      // Human Review: Required
      // Original code:
      // history.setCursorSequence(currentDocument.documentKey, record.sequence - 1);
      state.regionAnnotations.moveFeedback = null;

      return true;
    }),

    redoDocumentHistory: action(() => {
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

      const committed = documentWriter.setSnapshot(nextDocument, {
        action: createRestoreAction("重做", record),
        mode: "replay",
        replay: { record, direction: "forward", targetSequence: record.sequence },
      });
      if (committed === null) return false;
      // AI-REMOVED 2026-11-12:
      // Reason: 游标与文档必须在一次发布中更新。
      // Trigger: REQ-048 原子历史恢复。
      // Evidence: 原 document 订阅先于游标更新。
      // Replacement: documentWriter 的 replay 事务。
      // Risk: Low
      // Human Review: Required
      // Original code:
      // history.setCursorSequence(currentDocument.documentKey, record.sequence);
      state.regionAnnotations.moveFeedback = null;

      return true;
    }),

    restoreDocumentHistoryTo: action((sequence) => {
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

      if (restoreRecords.length !== Math.abs(targetSequence - state.history.cursorSequence)) {
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

      const record = restoreRecords.at(-1)!;
      const committed = documentWriter.setSnapshot(nextDocument, {
        action: createRestoreAction("还原历史", record),
        mode: "replay",
        replay: {
          record,
          direction: targetSequence > state.history.cursorSequence ? "forward" : "inverse",
          targetSequence,
        },
      });
      if (committed === null) return false;
      // AI-REMOVED 2026-11-12:
      // Reason: 游标与文档必须在一次发布中更新。
      // Trigger: REQ-048 原子历史恢复。
      // Evidence: 原 document 订阅先于游标更新。
      // Replacement: documentWriter 的 replay 事务。
      // Risk: Low
      // Human Review: Required
      // Original code:
      // history.setCursorSequence(currentDocument.documentKey, targetSequence);
      state.regionAnnotations.moveFeedback = null;

      return true;
    }),

    clearDocumentHistory: action(() => {
      history.clear(document.getSnapshot().documentKey);
    }),
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
