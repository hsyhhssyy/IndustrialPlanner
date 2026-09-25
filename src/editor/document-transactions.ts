import { applyIndexedDbTransactionMutations, readFromIndexedDb, type IndexedDbStoreMutationBatch } from "@/shared/storage/browser-storage";
import { normalizeWorldDocument, WORLD_DOCUMENT_DATABASE_LOCATION } from "@/shared/storage/world-document-storage";
import { createStableJsonHash } from "@/shared/storage/hash-utils";
import { emitStorageChange } from "@/shared/storage/storage-change-event";
import type { EditorDocumentChange } from "./document-repository";

/** 自动保存队列之后执行；版本变化或任一写入失败时，所有参与文档一起回滚。 */
export async function persistEditorDocumentChanges(changes: readonly EditorDocumentChange[], signal: AbortSignal, additional?: {
  readonly batches: readonly IndexedDbStoreMutationBatch<unknown>[];
  readonly expectedValues: readonly { readonly storeName: string; readonly key: IDBValidKey; readonly value: unknown }[];
}): Promise<boolean> {
  const expectedValues: Array<{ storeName: string; key: IDBValidKey; value: unknown }> = [...additional?.expectedValues ?? []];
  for (const { before } of changes) {
    if (signal.aborted) return false;
    const raw = await readFromIndexedDb<unknown>({ ...WORLD_DOCUMENT_DATABASE_LOCATION, key: before.documentKey });
    if (raw !== null && createStableJsonHash(normalizeWorldDocument(raw)) !== createStableJsonHash(before)) return false;
    expectedValues.push({ storeName: WORLD_DOCUMENT_DATABASE_LOCATION.storeName, key: before.documentKey, value: raw });
  }
  return applyIndexedDbTransactionMutations<unknown>(WORLD_DOCUMENT_DATABASE_LOCATION, [{
    storeName: WORLD_DOCUMENT_DATABASE_LOCATION.storeName,
    operations: changes.filter(({ before, after }) => before !== after).map(({ after }) => ({
      type: "put" as const, key: after.documentKey, value: after,
    })),
  }, ...additional?.batches ?? []], {}, { signal, expectedValues });
}

/** 仅在 Editor 统一发布内存结果后通知同步消费者。 */
export function emitEditorDocumentChanges(changes: readonly EditorDocumentChange[]): void {
  for (const { before, after } of changes) {
    if (before === after) continue;
    emitStorageChange({ assetType: "world-document", assetId: after.documentKey, origin: "local", timestamp: Date.now() });
  }
}
