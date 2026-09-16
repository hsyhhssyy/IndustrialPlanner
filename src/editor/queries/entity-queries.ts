import { createSnapshotSelector, shallowSnapshotEqual } from "@/shared/snapshot/snapshot-selector";
import { selectDocumentEntities } from "@/shared/snapshot/world-document-selection";
import type { WorldDocument, WorldEntity } from "@/domain/document/world-document";
import type { EditorQuery } from "@/domain/editor/editor-query";
import {
  type EntityCollection,
  type EntityCollectionType,
} from "@/domain/editor/types/editor-types";
import type { GridRect } from "@/domain/shared/grid";
import type { EntityDefinition } from "@/domain/registry/types/entity-definition";
import { resolveEntityGridGeometry } from "@/shared/geometry/entity-grid-geometry";
import {
  getRotatedGridFootprint,
} from "@/shared/geometry/grid";

// AI-REMOVED 2026-09-11:
// Reason: 集合包围盒已统一由共享实体几何函数计算，不再直接组装 GridArea 并调用 getGridBoundingBox。
// Trigger: 修复蓝图属性面板尺寸并消除编辑器、渲染器和面板之间的重复算法。
// Evidence: resolveEntityGridGeometry 保留缺失实体或 definition 时跳过的既有语义。
// Replacement: src/shared/geometry/entity-grid-geometry.ts resolveEntityGridGeometry
// Risk: Low
// Human Review: Required
//
// Original code:
// import {
//   getGridBoundingBox,
//   getRotatedGridFootprint,
//   type GridArea,
// } from "@/shared/geometry/grid";
import {
  areGridRectsIntersecting,
  resolvePowerRangeGridRect,
} from "@/shared/geometry/power-range";
import { isLogisticsDefinitionSuppressed } from "@/shared/logistics-suppression";

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
  | "listPowerRangeProvidersCoveringGridRect"
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

  const content = createSnapshotSelector(document, selectDocumentEntities, shallowSnapshotEqual);
  let previousContent: ReturnType<typeof content.getSnapshot> | null = null;
  let previousDrafts: readonly WorldEntity[] | null = null;
  let previousDefinitions = workspace.registry.baseDefinitions;
  let formalEntities: readonly WorldEntity[] = [];
  let formalIds = new Set<string>();
  let listedEntities: readonly WorldEntity[] = [];
  const listEntities = (): readonly WorldEntity[] => {
    const nextContent = content.getSnapshot();
    if (previousContent !== nextContent || previousDefinitions !== workspace.registry.baseDefinitions) {
      previousContent = nextContent;
      previousDefinitions = workspace.registry.baseDefinitions;
      formalEntities = resolveListedEntities({
        document: document.getSnapshot(), drafts: [], baseDefinitions: previousDefinitions,
      });
      formalIds = new Set(formalEntities.map((entity) => entity.id));
      previousDrafts = null;
    }
    if (previousDrafts !== state.drafts) {
      previousDrafts = state.drafts;
      const seen = new Set(formalIds);
      listedEntities = [...formalEntities, ...previousDrafts.filter((entity) => {
        if (seen.has(entity.id)) return false;
        seen.add(entity.id);
        return true;
      })];
    }
    return listedEntities;
  };

  return {
    getEntityById: (entityId) => {
      const snapshot = document.getSnapshot();
      const entity = snapshot.entities[entityId];
      // 正式实体不依赖 drafts，避免 observer 因其他虚影移动而重新渲染。
      if (entity !== undefined) return entity;
      return resolveEntityById({
        entityId,
        document: snapshot,
        drafts: state.drafts,
        baseDefinitions: workspace.registry.baseDefinitions,
      });
    },
    listEntities,
    listPowerRangeProvidersCoveringGridRect: (gridRect) => {
      const entities = resolveListedEntities({
        document: document.getSnapshot(),
        drafts: state.drafts,
        baseDefinitions: workspace.registry.baseDefinitions,
      });

      return entities.filter((entity) => {
        const definition = entityDefinitionMap.get(entity.definitionId);
        if (definition === undefined) {
          return false;
        }

        const powerRangeGridRect = resolvePowerRangeGridRect({
          entity,
          definition,
        });

        return powerRangeGridRect !== null
          && areGridRectsIntersecting(powerRangeGridRect, gridRect);
      });
    },
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
          if (isLogisticsDefinitionSuppressed({
            definitionId: entity.definitionId,
            suppressBelts: state.suppressBelts,
            suppressPipes: state.suppressPipes,
            queries: workspace.registry.queries,
          })) {
            continue;
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
  const entities: WorldEntity[] = [];

  for (const entityId of options.collection) {
    const entity = resolveEntityById({
      entityId,
      document: options.document,
      drafts: options.drafts,
    });

    if (entity === null) {
      continue;
    }

    entities.push(entity);
  }

  const geometry = resolveEntityGridGeometry({
    entities,
    entityDefinitionMap: options.entityDefinitionMap,
  });
  if (geometry === null) {
    return null;
  }

  return {
    x: geometry.boundingBox.left,
    y: geometry.boundingBox.top,
    width: geometry.boundingBox.width,
    height: geometry.boundingBox.height,
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
