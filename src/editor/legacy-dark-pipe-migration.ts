import { createLogger } from "@/shared/logging/logger";
import { readFromIndexedDb } from "@/shared/storage/browser-storage";
import { emitStorageChange, subscribeToStorageChanges } from "@/shared/storage/storage-change-event";
import {
  LEGACY_REGIONAL_SETTINGS_LOCATION,
  planLegacyRegionalDarkPipeMigration,
  readLegacyRegionalDarkPipeAsset,
} from "@/shared/legacy-regional-dark-pipe";
import { emitEditorDocumentChanges, persistEditorDocumentChanges } from "./document-transactions";
import type { EditorHost } from "./editor-host";

const logger = createLogger("legacy-dark-pipe-migration");

/** 旧资产仅输入迁移；启动与晚到同步使用同一原子迁移入口。 */
export function hookLegacyDarkPipeMigration(editor: EditorHost): () => void {
  let disposed = false;
  let running = false;
  let requested = false;
  let lastDiagnostic = "";
  const schedule = (): void => {
    if (disposed) return;
    requested = true;
    if (running) return;
    running = true;
    const task = (async () => {
      await editor.internalDocuments.ready();
      while (requested && !disposed) {
        requested = false;
        const raw = await readFromIndexedDb<unknown>(LEGACY_REGIONAL_SETTINGS_LOCATION);
        const asset = readLegacyRegionalDarkPipeAsset(raw);
        if (asset === null || disposed) continue;
        const bases = editor.workspace.registry.baseDefinitions;
        const documents = await editor.internalDocuments.readMany(bases.map(base => base.id));
        if (disposed) return;
        const plan = planLegacyRegionalDarkPipeMigration({ asset, documents, bases });
        const diagnostic = plan.diagnostics.join("\n");
        if (diagnostic !== "" && diagnostic !== lastDiagnostic) {
          logger.warn("Legacy dark-pipe links retained for retry.", { diagnostics: plan.diagnostics });
        }
        lastDiagnostic = diagnostic;
        if (!plan.changed) continue;
        const { storeName, key } = LEGACY_REGIONAL_SETTINGS_LOCATION;
        const saved = await editor.internalDocuments.commit(plan.changes,
          signal => persistEditorDocumentChanges(plan.changes, signal, {
            batches: [{ storeName, operations: [{ type: "put", key, value: plan.nextAsset }] }],
            expectedValues: [{ storeName, key, value: raw }],
          }), () => !disposed);
        if (!saved) {
          logger.warn("Legacy dark-pipe migration cancelled; original asset retained.");
          continue;
        }
        emitEditorDocumentChanges(plan.changes);
        emitStorageChange({ assetType: "regional-settings", assetId: key, origin: "local", timestamp: Date.now() });
      }
    })().finally(() => { running = false; });
    editor.internalDocuments.trackMaintenance(task);
  };
  const stopStorage = subscribeToStorageChanges(event => {
    if (event.assetType === "regional-settings" || event.assetType === "world-document") schedule();
  });
  const stopDocuments = editor.internalDocuments.subscribe(schedule);
  schedule();
  return () => { disposed = true; stopStorage(); stopDocuments(); };
}
