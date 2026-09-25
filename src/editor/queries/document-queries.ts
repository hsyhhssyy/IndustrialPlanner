// AI-REMOVED 2026-09-25:
// Reason: 查询改为复用 Editor 最新文档，默认文档与实体补全由 repository 负责。
// Trigger: REQ-038 D04 已获确认。
// Evidence: 原查询总是读取持久化版本，无法看到后台未落盘编辑。
// Replacement: 下方 documents.readMany。
// Risk: Low
// Human Review: Required
// Original code:
// import { createWorldDocument } from "@/domain/document/world-document";
// import { resolveLatestWorldDocumentForBase } from "../document-storage";
// import { ensureProtocolCoreEntity } from "../ensure-protocol-core";
import type { EditorBaseDocumentSummary } from "@/domain/editor/editor-document";
import type { EditorQuery } from "@/domain/editor/editor-query";
import type { WorldDocument } from "@/domain/document/world-document";

import {
  listLatestWorldDocumentsByBase,
} from "../document-storage";
import { listDocumentRegionalDarkPipeLinks } from "@/shared/dark-pipe-link";
import type { EditorQueriesContext } from "./types";

type EditorDocumentQueries = Pick<EditorQuery,
  "listBaseDocumentSummaries" | "readLatestBaseDocuments" | "getRegionalDarkPipeLinks" | "subscribeBaseDocuments"
>;

export function createEditorDocumentQueries({
  document,
  documents,
  state,
  workspace,
}: EditorQueriesContext): EditorDocumentQueries {
  let regionalDocuments: readonly WorldDocument[] = [];
  let regionalLinks: ReturnType<typeof listDocumentRegionalDarkPipeLinks> = [];
  return {
    listBaseDocumentSummaries: async (): Promise<readonly EditorBaseDocumentSummary[]> => {
      await documents.ready();
      await documents.settleMaintenance();
      const latestByBaseId = await listLatestWorldDocumentsByBase(
        state.internalPersistState.latestDocumentIdByBaseId,
      );
      const currentDocument = document.getSnapshot();

      latestByBaseId.set(currentDocument.baseId, currentDocument);
      for (const cached of documents.snapshots()) latestByBaseId.set(cached.baseId, cached);

      return workspace.registry.baseDefinitions.map((baseDefinition) => {
        const latestDocument = documents.isDeleted(baseDefinition.id) ? undefined : latestByBaseId.get(baseDefinition.id);

        return {
          baseId: baseDefinition.id,
          documentKey: latestDocument?.documentKey ?? null,
          // 2026-07-23: 改用 entities keys 计数兜底，避免 entityOrder 残留导致虚高。
          entityCount: latestDocument != null ? Object.keys(latestDocument.entities).length : 0,
          updatedAt: latestDocument?.meta.updatedAt ?? null,
        };
      });
    },
    // AI-REMOVED 2026-09-25:
    // Reason: 删除公共查询中的第二套磁盘加载路径。
    // Trigger: REQ-038 内存最新版本优先。
    // Evidence: 旧实现未查询 Editor 驻留集合。
    // Replacement: documents.readMany。
    // Risk: 初始化必须完成后才能返回；由 repository.ready 保证。
    // Human Review: Required
    // Original code:
    // readLatestBaseDocuments: async (baseIds) => {
    //   const documents = await Promise.all(baseIds.map((baseId) =>
    //     resolveLatestWorldDocumentForBase({
    //       baseId,
    //       latestDocumentIdByBaseId: state.internalPersistState.latestDocumentIdByBaseId,
    //     }),
    //   ));
    //   return baseIds.map((baseId, index) => {
    //     const document = documents[index] ?? createWorldDocument({ baseId });
    //     return ensureProtocolCoreEntity({ document, queries: workspace.registry.queries });
    //   });
    // },
    readLatestBaseDocuments: async (baseIds) => {
      await documents.settleMaintenance();
      return documents.readMany(baseIds);
    },
    subscribeBaseDocuments: (listener) => documents.subscribe(listener),
    getRegionalDarkPipeLinks: () => {
      if (workspace.app?.state.settings.regionalMultiBaseEnabled !== true) return [];
      const currentBaseId = document.getSnapshot().baseId;
      const region = workspace.registry.baseDefinitions.find((base) => base.id === currentBaseId)?.tag;
      if (region === undefined) return [];
      const baseIds = new Set(workspace.registry.baseDefinitions.filter((base) => base.tag === region).map((base) => base.id));
      const snapshots = documents.snapshots().filter((snapshot) => baseIds.has(snapshot.baseId));
      if (snapshots.length !== regionalDocuments.length || snapshots.some((snapshot, index) => snapshot !== regionalDocuments[index])) {
        regionalDocuments = snapshots;
        regionalLinks = listDocumentRegionalDarkPipeLinks(snapshots);
      }
      return regionalLinks;
    },
  };
}
