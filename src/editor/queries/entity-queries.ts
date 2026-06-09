import type { WorldDocument, WorldEntity } from "@/domain/document/world-document";
import type { EditorQuery } from "@/domain/editor/editor-query";
import {
  type EntityCollection,
  type EntityCollectionType,
} from "@/domain/editor/types/editor-types";
import type { GridRect } from "@/domain/shared/grid";
import type { EntityDefinition } from "@/domain/registry/types/entity-definition";
import {
  getGridBoundingBox,
  getRotatedGridFootprint,
  type GridArea,
} from "@/shared/geometry/grid";

import {
  resolveEntityById,
  resolveListedEntities,
} from "../entity-resolvers";
import { resolveEntityCollectionGeometry } from "../entity-collection-geometry";
import { resolveCachedPlacementValidation } from "../placement-validation";
import type { EditorQueriesContext } from "./types";
import { resolveGridCellAtClientPixelPoint } from "./viewport-geometry";

type EditorEntityQueries = Pick<
  EditorQuery,
  | "findEntityAtClientPixelPoint"
  | "findEntityCollectionGeometry"
  | "findEntityCollectionGridRect"
  | "getEntityById"
  | "getEntityPlacementValidation"
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
      baseDefinitions: workspace.registry.baseDefinitions,
    }),
    listEntities: () => resolveListedEntities({
      document: document.getSnapshot(),
      drafts: state.drafts,
      baseDefinitions: workspace.registry.baseDefinitions,
    }),
    findEntityCollectionGridRect: (collectionType) => {
      const currentDocument = document.getSnapshot();

      return resolveEntityCollectionGridRect({
        collection: resolveEntityCollection({
          collectionType,
          state,
        }),
        document: currentDocument,
        drafts: state.drafts,
        entityDefinitionMap,
      });
    },
    findEntityCollectionGeometry: (collectionType) => {
      const currentDocument = document.getSnapshot();
      const geometry = resolveEntityCollectionGeometry({
        collection: resolveEntityCollection({
          collectionType,
          state,
        }),
        document: currentDocument,
        drafts: state.drafts,
        entityDefinitionMap,
      });

      if (geometry === null) {
        return null;
      }

      return {
        boundingBox: geometry.boundingBox,
        centerPoint: geometry.centerPoint,
        pivotCell: geometry.pivotCell,
      };
    },
    getEntityPlacementValidation: (entityId) => resolveCachedPlacementValidation({
      entityId,
      state,
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
      const listedEntities = resolveListedEntities({
        document: currentDocument,
        drafts: state.drafts,
        baseDefinitions: workspace.registry.baseDefinitions,
      });

      for (let index = listedEntities.length - 1; index >= 0; index -= 1) {
        const entity = listedEntities[index];

        if (entity === undefined) {
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
          // 被抑制的物流设备不参与命中检测
          if (workspace.registry.queries.isDedicatedLogisticsDevice(entity.definitionId)) {
            const kind = workspace.registry.queries.resolveDedicatedLogisticsKind(entity.definitionId);
            if (
              (kind === "belt" && state.suppressBelts)
              || (kind === "pipe" && state.suppressPipes)
            ) {
              continue;
            }
          }

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
  return options.state.collections[options.collectionType];
}

function resolveEntityCollectionGridRect(options: {
  collection: EntityCollection;
  document: WorldDocument;
  drafts: readonly WorldEntity[];
  entityDefinitionMap: ReadonlyMap<string, EntityDefinition>;
}): GridRect | null {
  const areas: GridArea[] = [];

  for (const entityId of options.collection) {
    const entity = resolveEntityById({
      entityId,
      document: options.document,
      drafts: options.drafts,
    });

    if (entity === null) {
      continue;
    }

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
