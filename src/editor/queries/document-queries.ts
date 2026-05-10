import type { EditorBaseDocumentSummary } from "@/domain/editor/editor-document";
import type { EditorQuery } from "@/domain/editor/editor-query";

import { listLatestWorldDocumentsByBase } from "../document-storage";
import type { EditorQueriesContext } from "./types";

type EditorDocumentQueries = Pick<EditorQuery, "listBaseDocumentSummaries">;

export function createEditorDocumentQueries({
  document,
  state,
  workspace,
}: EditorQueriesContext): EditorDocumentQueries {
  return {
    listBaseDocumentSummaries: async (): Promise<readonly EditorBaseDocumentSummary[]> => {
      const latestByBaseId = await listLatestWorldDocumentsByBase(
        state.internalPersistState.latestDocumentIdByBaseId,
      );
      const currentDocument = document.getSnapshot();

      latestByBaseId.set(currentDocument.baseId, currentDocument);

      return workspace.registry.baseDefinitions.map((baseDefinition) => {
        const latestDocument = latestByBaseId.get(baseDefinition.id);

        return {
          baseId: baseDefinition.id,
          documentKey: latestDocument?.documentKey ?? null,
          entityCount: latestDocument?.entityOrder.length ?? 0,
          updatedAt: latestDocument?.meta.updatedAt ?? null,
        };
      });
    },
  };
}
