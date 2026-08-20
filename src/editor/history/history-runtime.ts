import {
  runInAction,
} from "mobx";

import type {
  EditorHistoryActionDescriptor,
  EditorHistoryDocumentDelta,
  EditorHistoryRecord,
} from "@/domain/editor/editor-history";
import { createUuid } from "@/domain/shared/uuid";

import type {
  EditorHistoryStateReadWrite,
} from "../state-impl";
import {
  readEditorHistoryState,
  writeEditorHistoryState,
} from "./history-storage";

/** 每张地图最多保留的历史记录条数 */
const MAX_HISTORY_PER_DOCUMENT = 100;

export class EditorHistoryRuntime {
  private loadSerial = 0;
  private writeQueue = Promise.resolve();

  public constructor(
    private readonly state: EditorHistoryStateReadWrite,
  ) {}

  public loadDocumentHistory(documentKey: string): void {
    const serial = ++this.loadSerial;

    runInAction(() => {
      this.state.isReady = false;
    });

    void (async () => {
      const persistedState = await readEditorHistoryState(documentKey);

      if (serial !== this.loadSerial) {
        return;
      }

      const records = normalizeRecordList(
        persistedState?.records ?? [],
        documentKey,
      );
      const headSequence = resolveHeadSequence(records);
      const cursorSequence = Math.min(
        headSequence,
        Math.max(0, persistedState?.cursorSequence ?? headSequence),
      );

      runInAction(() => {
        this.state.documentKey = documentKey;
        this.state.records.replace(records);
        this.state.cursorSequence = cursorSequence;
        this.state.headSequence = headSequence;
        this.state.lastRecordId = records.at(-1)?.id ?? null;
        this.state.isReady = true;
      });
    })();
  }

  public record(options: {
    documentKey: string;
    action: EditorHistoryActionDescriptor;
    delta: EditorHistoryDocumentDelta;
  }): EditorHistoryRecord {
    this.loadSerial += 1;

    const nextSequence = this.state.cursorSequence + 1;
    const recordsBeforeCursor = this.state.records.filter((record) =>
      record.sequence <= this.state.cursorSequence,
    );
    const record: EditorHistoryRecord = {
      schemaVersion: 1,
      id: createUuid(),
      documentKey: options.documentKey,
      sequence: nextSequence,
      createdAt: new Date().toISOString(),
      action: options.action,
      delta: options.delta,
    };
    const nextRecords = [
      ...recordsBeforeCursor,
      record,
    ];

    // 限制每张地图最多保留 MAX_HISTORY_PER_DOCUMENT 条记录
    const trimmedRecords = nextRecords.length > MAX_HISTORY_PER_DOCUMENT
      ? nextRecords.slice(nextRecords.length - MAX_HISTORY_PER_DOCUMENT)
      : nextRecords;

    runInAction(() => {
      this.state.documentKey = options.documentKey;
      this.state.records.replace(trimmedRecords);
      this.state.cursorSequence = nextSequence;
      this.state.headSequence = nextSequence;
      this.state.lastRecordId = record.id;
      this.state.isReady = true;
    });

    this.enqueuePersist();

    return record;
  }

  public setCursorSequence(documentKey: string, cursorSequence: number): void {
    this.loadSerial += 1;

    if (this.state.documentKey !== documentKey) {
      return;
    }

    const nextCursorSequence = Math.min(
      this.state.headSequence,
      Math.max(0, Math.floor(cursorSequence)),
    );

    runInAction(() => {
      this.state.cursorSequence = nextCursorSequence;
    });

    this.enqueuePersist();
  }

  public clear(documentKey: string): void {
    this.loadSerial += 1;

    runInAction(() => {
      this.state.documentKey = documentKey;
      this.state.records.replace([]);
      this.state.cursorSequence = 0;
      this.state.headSequence = 0;
      this.state.lastRecordId = null;
      this.state.isReady = true;
    });

    this.enqueuePersist();
  }

  public getUndoRecord(): EditorHistoryRecord | null {
    return this.state.records.find((record) =>
      record.sequence === this.state.cursorSequence,
    ) ?? null;
  }

  public getRedoRecord(): EditorHistoryRecord | null {
    return this.state.records.find((record) =>
      record.sequence === this.state.cursorSequence + 1,
    ) ?? null;
  }

  public getRecordBySequence(sequence: number): EditorHistoryRecord | null {
    return this.state.records.find((record) =>
      record.sequence === sequence,
    ) ?? null;
  }

  private enqueuePersist(): void {
    const documentKey = this.state.documentKey;

    if (documentKey === null) {
      return;
    }

    const snapshot = {
      // AI-CORRECTION 2026-08-20: 持久化包装升级为 schema 2；record 自身仍使用领域定义的 schema 1。
      schemaVersion: 2 as const,
      documentKey,
      cursorSequence: this.state.cursorSequence,
      records: this.state.records.map((record) => record),
    };

    this.writeQueue = this.writeQueue
      .catch(() => undefined)
      .then(() => writeEditorHistoryState(snapshot));
  }
}

function normalizeRecordList(
  records: readonly EditorHistoryRecord[],
  documentKey: string,
): EditorHistoryRecord[] {
  return records
    .filter((record) => record.documentKey === documentKey)
    .slice()
    .sort((left, right) => left.sequence - right.sequence)
    .map((record, index) => ({
      ...record,
      sequence: index + 1,
    }));
}

function resolveHeadSequence(records: readonly EditorHistoryRecord[]): number {
  return records.length === 0
    ? 0
    : Math.max(...records.map((record) => record.sequence));
}
