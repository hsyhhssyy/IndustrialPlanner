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
  type PersistedEditorHistoryState,
} from "./history-storage";

/** 每张地图最多保留的历史记录条数 */
const MAX_HISTORY_PER_DOCUMENT = 100;

export class EditorHistoryRuntime {
  private loadSerial = 0;
  private writeQueue = Promise.resolve();
  private requestedDocumentKey: string | null = null;
  private readonly documents = new Map<string, PersistedEditorHistoryState>();
  private readonly loads = new Map<string, Promise<PersistedEditorHistoryState>>();

  public constructor(
    private readonly state: EditorHistoryStateReadWrite,
  ) {}

  public loadDocumentHistory(documentKey: string): void {
    const serial = ++this.loadSerial;
    this.requestedDocumentKey = documentKey;

    runInAction(() => {
      this.state.isReady = false;
    });

    void (async () => {
      const persistedState = await this.readDocumentHistory(documentKey);

      if (serial !== this.loadSerial) {
        return;
      }

      // 磁盘记录只在首次加载时规范化；驻留历史保留原 sequence 与 cursor。
      const records = persistedState.records;
      const headSequence = resolveHeadSequence(records);
      const cursorSequence = Math.min(
        headSequence,
        Math.max(0, persistedState?.cursorSequence ?? headSequence),
      );

      runInAction(() => {
        this.state.documentKey = documentKey;
        this.state.records.replace([...records]);
        this.state.cursorSequence = cursorSequence;
        this.state.headSequence = headSequence;
        this.state.lastRecordId = records.at(-1)?.id ?? null;
        this.state.isReady = true;
      });
    })();
  }

  /** 跨文档事务提交前准备出口历史，不改变当前历史面板。 */
  public async prepareDocumentHistory(documentKey: string): Promise<void> {
    await this.readDocumentHistory(documentKey);
  }

  /** 等待历史读取（含迁移写回）及保存完成；等待期间追加的写入也必须排空。 */
  public async flush(): Promise<void> {
    let pending: Promise<void>;
    do {
      pending = this.writeQueue;
      await pending;
      await Promise.all(this.loads.values());
    } while (pending !== this.writeQueue || this.loads.size > 0);
  }

  public record(options: {
    documentKey: string;
    action: EditorHistoryActionDescriptor;
    delta: EditorHistoryDocumentDelta;
  }): EditorHistoryRecord {
    this.requestedDocumentKey ??= options.documentKey;
    const isActive = this.requestedDocumentKey === options.documentKey;
    if (isActive) this.loadSerial += 1;
    const previous = this.documents.get(options.documentKey);
    const cursor = previous?.cursorSequence
      ?? (this.state.documentKey === options.documentKey ? this.state.cursorSequence : 0);
    const records = previous?.records
      ?? (this.state.documentKey === options.documentKey ? [...this.state.records] : []);

    const nextSequence = cursor + 1;
    const recordsBeforeCursor = records.filter((record) =>
      record.sequence <= cursor,
    );
    const record: EditorHistoryRecord = {
      schemaVersion: 2,
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

    if (isActive) {
      runInAction(() => {
        this.state.documentKey = options.documentKey;
        this.state.records.replace(trimmedRecords);
        this.state.cursorSequence = nextSequence;
        this.state.headSequence = nextSequence;
        this.state.lastRecordId = record.id;
        this.state.isReady = true;
      });
    }

    this.enqueuePersistSnapshot({
      schemaVersion: 3, documentKey: options.documentKey,
      cursorSequence: nextSequence, records: trimmedRecords,
    });

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
      // AI-CORRECTION 2026-09-09: 持久化包装升级为 schema 3；record schema 2 增加区域差量。
      schemaVersion: 3 as const,
      documentKey,
      cursorSequence: this.state.cursorSequence,
      records: this.state.records.map((record) => record),
    };

    this.enqueuePersistSnapshot(snapshot);
  }

  private enqueuePersistSnapshot(snapshot: PersistedEditorHistoryState): void {
    this.documents.set(snapshot.documentKey, snapshot);
    this.writeQueue = this.writeQueue
      .catch(() => undefined)
      .then(() => writeEditorHistoryState(snapshot));
  }

  private async readDocumentHistory(documentKey: string): Promise<PersistedEditorHistoryState> {
    const cached = this.documents.get(documentKey);
    if (cached !== undefined) return cached;
    const pending = this.loads.get(documentKey);
    if (pending !== undefined) return pending;
    const load = (async () => {
      await this.writeQueue;
      const persisted = await readEditorHistoryState(documentKey);
      const latest = this.documents.get(documentKey);
      if (latest !== undefined) return latest;
      const records = normalizeRecordList(persisted?.records ?? [], documentKey);
      const head = resolveHeadSequence(records);
      const snapshot: PersistedEditorHistoryState = {
        schemaVersion: 3, documentKey, records,
        cursorSequence: Math.min(head, Math.max(0, persisted?.cursorSequence ?? head)),
      };
      this.documents.set(documentKey, snapshot);
      return snapshot;
    })().finally(() => this.loads.delete(documentKey));
    this.loads.set(documentKey, load);
    return load;
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
