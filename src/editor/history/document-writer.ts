import { isHistoryOperationAvailable } from "../editor-operation-policy";
import type { CanvasOperationAvailability, CanvasOperationId } from "@/domain/shared/canvas-operation";
import { comparer, runInAction } from "mobx";
import { freezeSnapshot } from "@/shared/snapshot/freeze-snapshot";
import type { EditorDocumentTransition } from "@/domain/editor/types/editor-session-types";
import type { EditorHistoryRecord } from "@/domain/editor/editor-history";
import type {
  WorldDocument,
} from "@/domain/document/world-document";
import { isDataMigrationFrozen } from "@/shared/data-migration";
import { removeForbiddenProtocolCoreEntities } from "@/shared/protocol-core";
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

export type EditorDocumentWriteMode =
  | "record"
  | "silent"
  | "replay"
  | "remote-sync";

const DEFAULT_DOCUMENT_ACTION: EditorHistoryActionDescriptor = {
  type: "document.unknown",
  label: "Document update",
};

export interface EditorDocumentWriter {
  /** null 表示拒绝；通过校验的无变化提交返回当前文档，不创建历史或发布事件。 */
  commit(options: {
    action: EditorHistoryActionDescriptor;
    update(current: WorldDocument): WorldDocument;
    mode?: EditorDocumentWriteMode;
    beforePublish?: () => void;
  }): WorldDocument | null;
  setSnapshot(
    nextDocument: WorldDocument,
    options?: {
      action?: EditorHistoryActionDescriptor;
      mode?: EditorDocumentWriteMode;
      replay?: { record: EditorHistoryRecord; direction: "forward" | "inverse"; targetSequence: number };
    },
  ): WorldDocument | null;
}

export interface EditorSessionWriter<TIntent> extends EditorDocumentWriter {
  commitIntent(next: TIntent, action: EditorHistoryActionDescriptor): boolean;
}

export function createEditorDocumentWriter<TIntent = undefined>(options: {
  document: SnapshotStoreReadWrite<WorldDocument>;
  history: EditorHistoryRuntime;
  getOperationAvailability?: (operation: CanvasOperationId) => CanvasOperationAvailability;
  isDisposed?: () => boolean;
  normalizeEdit?: (before: WorldDocument, after: WorldDocument) => WorldDocument;
  session?: {
    getIntent(): TIntent;
    reduceIntent(intent: TIntent, transition: EditorDocumentTransition): TIntent;
    validateTransition(transition: EditorDocumentTransition, intent: TIntent): readonly string[];
    publish(document: WorldDocument, intent: TIntent, origin: "local" | "remote-sync"): WorldDocument;
  };
}): EditorSessionWriter<TIntent> {
  const writeDocument = (
    nextDocument: WorldDocument,
    action: EditorHistoryActionDescriptor,
    mode: EditorDocumentWriteMode,
    intentOverride?: { value: TIntent },
    replay?: { record: EditorHistoryRecord; direction: "forward" | "inverse"; targetSequence: number },
    beforePublish?: () => void,
  ): WorldDocument | null => {
    if (options.isDisposed?.() || (isDataMigrationFrozen() && mode !== "remote-sync")) return null;
    if (mode === "record" && options.getOperationAvailability !== undefined
      && !isHistoryOperationAvailable(options.getOperationAvailability, action.type)) return null;
    const currentDocument = options.document.getSnapshot();
    // 历史重放恢复已记录的关系；只有新的用户编辑需要重新判断覆盖。
    // AI-CORRECTION 2026-10-10: 无核心基地约束适用于所有写入模式，历史重放也不能恢复核心。
    if (mode === "record") nextDocument = options.normalizeEdit?.(currentDocument, nextDocument) ?? nextDocument;
    nextDocument = removeForbiddenProtocolCoreEntities(nextDocument);
    // AI-REMOVED 2026-11-12:
    // Reason: 原先先发布文档再记录历史，无法原子提交会话意图，失败时可能留下半提交。
    // Trigger: REQ-048 统一文档、意图和历史事务。
    // Evidence: setSnapshot 同步通知早于 history.record，且放置预览在提交前已清空。
    // Replacement: 下方先准备全部数据，再批量更新历史并发布文档／意图。
    // Risk: 所有文档写入与历史恢复路径需要回归。
    // Human Review: Required
    // Original code:
    // const documentToWrite = mode === "record"
    // ? stampWorldDocumentUpdatedAt(nextDocument)
    // : nextDocument;
    //
    // if (currentDocument === documentToWrite) {
    // return null;
    // }
    //
    // const delta = createWorldDocumentDelta(currentDocument, documentToWrite);
    //
    // if (delta === null) {
    // return null;
    // }
    //
    // const committedDocument = options.document.setSnapshot(documentToWrite, {
    // origin: mode === "remote-sync" ? "remote-sync" : "local",
    // });
    //
    // if (mode === "record") {
    // options.history.record({
    // documentKey: committedDocument.documentKey,
    // action,
    // delta,
    // });
    // }
    //
    // return committedDocument;
    const transition = { before: currentDocument, after: freezeSnapshot(nextDocument), action };
    const session = options.session;
    const beforeIntent = session?.getIntent();
    const replayIntent = replay === undefined ? undefined : options.history.getIntentChange(replay.record);
    const candidateIntent = session === undefined ? undefined
      : intentOverride !== undefined ? intentOverride.value
      : replayIntent !== undefined && replay !== undefined ? (replay.direction === "inverse" ? replayIntent.before : replayIntent.after) as TIntent
      : mode === "record" ? session.reduceIntent(beforeIntent as TIntent, transition)
      : beforeIntent;
    const intentChanged = session !== undefined && !comparer.structural(beforeIntent, candidateIntent);
    const nextIntent = intentChanged ? freezeSnapshot(structuredClone(candidateIntent)) : beforeIntent;
    if (mode === "record" && session !== undefined
      && session.validateTransition(transition, nextIntent as TIntent).length > 0) return null;

    const delta = createWorldDocumentDelta(currentDocument, nextDocument);
    if (delta === null && !intentChanged && replay === undefined) {
      // 原位确认仍需结束移动／区域编辑；拒绝和无变化不能共享失败信号。
      runInAction(() => { beforePublish?.(); });
      return currentDocument;
    }
    const documentToWrite = freezeSnapshot(delta === null ? currentDocument
      : mode === "record" ? stampWorldDocumentUpdatedAt(nextDocument) : nextDocument);
    const preparedHistory = mode !== "record" ? null : options.history.prepareRecord({
      documentKey: documentToWrite.documentKey,
      action,
      delta: delta ?? { entities: { added: {}, removed: {}, updated: {} }, entityOrder: null, slotLinks: null, regions: null, documentSettings: {} },
      intentChange: session === undefined ? undefined : { before: beforeIntent, after: nextIntent },
    });

    return runInAction(() => {
      // 到此所有归一化、冻结、策略和历史构建均已成功；瞬态清理只能在此执行。
      beforePublish?.();
      preparedHistory?.commit();
      if (replay !== undefined) options.history.setCursorSequence(currentDocument.documentKey, replay.targetSequence);
      const origin = mode === "remote-sync" ? "remote-sync" : "local";
      const committedDocument = session === undefined
        ? options.document.setSnapshot(documentToWrite, { origin })
        : session.publish(documentToWrite, nextIntent as TIntent, origin);
      preparedHistory?.publish();
      return committedDocument;
    });
  };

  return {
    commitIntent: (next, action) => options.session !== undefined && writeDocument(
      options.document.getSnapshot(), action, "record", { value: next },
    ) !== null,
    commit: ({ action, update, mode = "record", beforePublish }) => {
      return writeDocument(
        update(options.document.getSnapshot()),
        action,
        mode,
        undefined,
        undefined,
        beforePublish,
      );
    },
    setSnapshot: (
      nextDocument,
      {
        action = DEFAULT_DOCUMENT_ACTION,
        mode = "record",
        replay,
      } = {},
    ) => {
      return writeDocument(nextDocument, action, mode, undefined, replay);
    },
  };
}

function stampWorldDocumentUpdatedAt(document: WorldDocument): WorldDocument {
  return {
    ...document,
    meta: {
      ...document.meta,
      updatedAt: new Date().toISOString(),
    },
  };
}
