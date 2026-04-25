import type { WorldEntity } from "@/domain/entity/world-document";
import type { EditorQuery } from "@/domain/query/editor-query";
import {
  EntityCollectionType,
  type EntityCollection,
} from "@/domain/state/types";
import type { GridRect } from "@/domain/types/grid";
import type { EntityDefinition } from "@/domain/types/registry/entity-definition";
import {
  getGridBoundingBox,
  getRotatedGridFootprint,
  type GridArea,
} from "@/shared/geometry/grid";

import {
  resolveEntityById,
  resolveListedEntities,
  resolveOrderedEntityIds,
} from "../entity-resolvers";
import type { EditorQueriesContext } from "./types";
import { resolveGridCellAtClientPixelPoint } from "./viewport-geometry";

type EditorEntityQueries = Pick<
  EditorQuery,
  | "findEntityAtClientPixelPoint"
  | "findEntityCollectionGridRect"
  | "getEntityById"
  | "listEntities"
>;

export function createEditorEntityQueries({
  document,
  state,
  workspace,
}: EditorQueriesContext): EditorEntityQueries {
  const entityDefinitionMap = new Map(
    workspace.registry.entityDefinitions.map((definition) => [
      definition.id,
      definition,
    ]),
  );

  return {
    getEntityById: (entityId) => resolveEntityById({
      entityId,
      document: document.getSnapshot(),
      drafts: state.drafts,
    }),
    listEntities: () => resolveListedEntities({
      document: document.getSnapshot(),
      drafts: state.drafts,
    }),
    findEntityCollectionGridRect: (collectionType) =>
      resolveEntityCollectionGridRect({
        collection: resolveEntityCollection({
          collectionType,
          state,
        }),
        entityDefinitionMap,
      }),
    findEntityAtClientPixelPoint: (clientPixelPoint) => {
      const gridCell = resolveGridCellAtClientPixelPoint({
        clientPixelPoint,
        viewportState: state.viewport,
      });

      if (gridCell === null) {
        return null;
      }

      const currentDocument = document.getSnapshot();
      const orderedEntityIds = resolveOrderedEntityIds(currentDocument);

      for (let index = orderedEntityIds.length - 1; index >= 0; index -= 1) {
        const entityId = orderedEntityIds[index];

        if (entityId === undefined) {
          continue;
        }

        const entity = currentDocument.entities[entityId];

        if (!entity) {
          continue;
        }

        const definition = entityDefinitionMap.get(entity.definitionId);

        if (!definition) {
          continue;
        }

        if (
          isGridCellInsideEntity({
            cell: gridCell,
            entity,
            footprint: definition.footprint,
          })
        ) {
          return entity;
        }
      }

      return null;
    },
  };
}

function resolveEntityCollection(options: {
  collectionType: EntityCollectionType;
  state: EditorQueriesContext["state"];
}): EntityCollection {
  switch (options.collectionType) {
    case EntityCollectionType.selection:
      return options.state.selectedEntities;
    case EntityCollectionType.preview:
      return options.state.previewEntities;
  }
}

function resolveEntityCollectionGridRect(options: {
  collection: EntityCollection;
  entityDefinitionMap: ReadonlyMap<string, EntityDefinition>;
}): GridRect | null {
  const areas: GridArea[] = [];

  for (const entity of Object.values(options.collection)) {
    const definition = options.entityDefinitionMap.get(entity.definitionId);

    if (!definition) {
      continue;
    }

    areas.push({
      position: entity.position,
      footprint: getRotatedGridFootprint(
        definition.footprint,
        entity.rotation,
      ),
    });
  }

  const bounds = getGridBoundingBox(areas);

  if (bounds === null) {
    return null;
  }

  return {
    x: bounds.left,
    y: bounds.top,
    width: bounds.width,
    height: bounds.height,
  };
}

function isGridCellInsideEntity(options: {
  cell: {
    x: number;
    y: number;
  };
  entity: WorldEntity;
  footprint: EntityDefinition["footprint"];
}): boolean {
  const footprint = getRotatedGridFootprint(
    options.footprint,
    options.entity.rotation,
  );

  return (
    options.cell.x >= options.entity.position.x
    && options.cell.x < options.entity.position.x + footprint.width
    && options.cell.y >= options.entity.position.y
    && options.cell.y < options.entity.position.y + footprint.height
  );
}
