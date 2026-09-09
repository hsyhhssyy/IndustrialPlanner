import type { EditorQuery } from "@/domain/editor/editor-query";

import { resolveEntityRegionRelation } from "../region-relations";
import type { EditorQueriesContext } from "./types";

type EditorRegionQueries = Pick<EditorQuery, "findRegionEntityIds">;

export function createEditorRegionQueries({
  document,
  workspace,
}: EditorQueriesContext): EditorRegionQueries {
  const entityDefinitionMap = new Map(
    workspace.registry.entityDefinitions.map((definition) => [definition.id, definition]),
  );

  return {
    findRegionEntityIds: (regionId, relation) => {
      const currentDocument = document.getSnapshot();
      const region = currentDocument.regions.find((candidate) => candidate.id === regionId);
      if (region === undefined) {
        return [];
      }

      return Array.from(new Set(currentDocument.entityOrder))
        .filter((entityId) => {
          const entity = currentDocument.entities[entityId];
          return entity !== undefined && resolveEntityRegionRelation({
            entity,
            region,
            entityDefinitionMap,
          }) === relation;
        });
    },
  };
}
