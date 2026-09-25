import type { WorldDocument } from "@/domain/document/world-document";
import { listDocumentRegionalDarkPipeLinks, resolveDarkPipeRole } from "@/shared/dark-pipe-link";
import { isLocalSlotLink } from "@/shared/slot-link";
import { createLogger } from "@/shared/logging/logger";
import { createWorldDocumentDelta } from "./history";
import { emitEditorDocumentChanges, persistEditorDocumentChanges } from "./document-transactions";
import type { EditorHost } from "./editor-host";

const logger = createLogger("dark-pipe-link-lifecycle");

/** 位置变化不改变关系；删除／替换以及停用期间的显式连接配置会覆盖旧关系。 */
export function invalidatedDarkPipeEndpoints(before: WorldDocument, after: WorldDocument, enabled: boolean): ReadonlySet<string> {
  if (before.documentKey !== after.documentKey) return new Set();
  return new Set(Object.values(before.entities).flatMap(entity => {
    if (resolveDarkPipeRole(entity.definitionId) === null) return [];
    const next = after.entities[entity.id];
    if (next === undefined || next.definitionId !== entity.definitionId) return [entity.id];
    if (enabled) return [];
    const localLinks = (document: WorldDocument) => document.slotLinks.filter(link =>
      isLocalSlotLink(link, document.baseId)
      && (link.source.entityId === entity.id || link.target.entityId === entity.id));
    return JSON.stringify(entity.config) !== JSON.stringify(next.config)
      || JSON.stringify(localLinks(before)) !== JSON.stringify(localLinks(after)) ? [entity.id] : [];
  }));
}

/** 本文档持有的关系和用户编辑写入同一历史 delta，不产生一次额外撤销。 */
export function normalizeEditedDarkPipeLinks(before: WorldDocument, after: WorldDocument, enabled: boolean): WorldDocument {
  const invalidated = invalidatedDarkPipeEndpoints(before, after, enabled);
  if (invalidated.size === 0) return after;
  const removed = new Set(listDocumentRegionalDarkPipeLinks([after])
    .filter(link => invalidated.has(link.outlet.entityId)).map(link => link.id));
  return removed.size === 0 ? after : { ...after, slotLinks: after.slotLinks.filter(link => !removed.has(link.id)) };
}

/** 入口改动清理后台出口；同步载入不被当作用户重新配置，失效同步引用留给诊断。 */
export function hookDarkPipeLinkLifecycle(editor: EditorHost): () => void {
  let previous = editor.document.getSnapshot();
  let disposed = false;
  let queue = Promise.resolve();
  const stop = editor.internalDocument.subscribe((after, context) => {
    const before = previous;
    previous = after;
    if (disposed || context.origin !== "local" || editor.internalDocuments.isPublishingChange) return;
    const invalidated = invalidatedDarkPipeEndpoints(before, after, editor.workspace.app?.state.settings.regionalMultiBaseEnabled === true);
    if (invalidated.size === 0) return;
    const task = queue.catch(() => undefined).then(async () => {
      const region = editor.workspace.registry.baseDefinitions.find(base => base.id === after.baseId)?.tag;
      const bases = editor.workspace.registry.baseDefinitions.filter(base => base.tag === region);
      // 并发修改取消时重新读取快照；持久化失败不能声称清理成功。
      for (let attempt = 0; attempt < 3 && !disposed; attempt += 1) {
        const snapshots = await editor.internalDocuments.readMany(bases.map(base => base.id));
        const relations = listDocumentRegionalDarkPipeLinks(snapshots).filter(link =>
          link.inlet.baseId === after.baseId && invalidated.has(link.inlet.entityId));
        if (relations.length === 0) return;
        const changes = snapshots.map(before => {
          const removed = new Set(relations.filter(link => link.outlet.baseId === before.baseId).map(link => link.id));
          return { before, after: removed.size === 0 ? before : {
            ...before, slotLinks: before.slotLinks.filter(link => !removed.has(link.id)),
            meta: { ...before.meta, updatedAt: new Date().toISOString() },
          } };
        });
        for (const change of changes) {
          if (change.before !== change.after) await editor.internalHistory.prepareDocumentHistory(change.after.documentKey);
        }
        const saved = await editor.internalDocuments.commit(changes,
          signal => persistEditorDocumentChanges(changes, signal), () => !disposed);
        if (!saved) continue;
        for (const change of changes) {
          if (change.before === change.after) continue;
          const delta = createWorldDocumentDelta(change.before, change.after);
          if (delta !== null) editor.internalHistory.record({
            documentKey: change.after.documentKey, delta,
            action: { type: "document.unknown", label: "清理已重新配置的暗管链接" },
          });
        }
        emitEditorDocumentChanges(changes);
        return;
      }
      if (!disposed) throw new Error("Could not persist dark-pipe endpoint cleanup.");
    });
    queue = task;
    editor.internalDocuments.trackMaintenance(task);
    void task.catch(error => logger.error("Dark-pipe endpoint cleanup failed.", { error: String(error) }));
  });
  return () => { disposed = true; stop(); };
}
