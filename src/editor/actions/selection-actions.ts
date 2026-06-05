import type { EditorAction } from "@/domain/editor/editor-action";
import { action } from "mobx";
import type { WorldEntity } from "@/domain/document/world-document";
import { EntityCollectionType } from "@/domain/editor/types/editor-types";
import type { GridPoint, GridRect, GridRectSize } from "@/domain/shared/grid";
import type { EntityDefinition } from "@/domain/registry/types/entity-definition";
import {
  getGridBoundingBox,
  getRotatedGridFootprint,
  rotateGridRotationClockwise,
} from "@/shared/geometry/grid";

import { type DraftEntity, isDraftEntity } from "../draft-entity";
import { resolveEntityById, resolveListedEntities } from "../entity-resolvers";
import {
  hasOutsideBasePlacementReason,
  syncPlacementValidationState,
} from "../placement-validation";
import { syncPoweredEntityCollection } from "./powered-collection";
import type { EditorActionsContext } from "./types";

type EditorCollectionActions = Pick<
  EditorAction,
  | "addToCollection"
  | "applyMarquee"
  | "cancelMarquee"
  | "clearCollection"
  | "deleteCollection"
  | "moveCollectionTo"
  | "removeFromCollection"
  | "rotateCollection"
  | "setMarqueeRange"
>;

export function createEditorSelectionActions({
  document,
  documentWriter,
  state,
  workspace,
}: EditorActionsContext): EditorCollectionActions {
  const resolveCollection = (collectionType: EntityCollectionType) =>
    state.collections[collectionType];
  const removeEntityIdsFromCollections = (entityIds: ReadonlySet<string>) => {
    for (const collectionType of Object.values(EntityCollectionType)) {
      const collection = resolveCollection(collectionType);

      if (collection.length === 0) {
        continue;
      }

      const nextEntityIds = collection.filter((entityId) => !entityIds.has(entityId));

      if (nextEntityIds.length === collection.length) {
        continue;
      }

      collection.replace(nextEntityIds);
    }
  };
  const addEntityIdToCollection = (
    collectionType: EntityCollectionType,
    entityId: string,
  ) => {
    const entity = resolveEntityById({
      entityId,
      document: document.getSnapshot(),
      drafts: state.drafts,
    });

    if (entity === null) {
      return;
    }

    const collection = resolveCollection(collectionType);

    if (collection.contains(entity.id)) {
      return;
    }

    collection.push(entity.id);
  };
  const entityDefinitionMap = new Map(
    workspace.registry.entityDefinitions.map((definition) => [
      definition.id,
      definition,
    ]),
  );

  return {
    clearCollection: action((collectionType) => {
      resolveCollection(collectionType).replace([]);

      if (collectionType === EntityCollectionType.marquee
        || collectionType === EntityCollectionType.reverseMarquee) {
        state.marqueeGridRect = null;
      }

      if (
        collectionType === EntityCollectionType.preview
        || collectionType === EntityCollectionType.ghost
        || collectionType === EntityCollectionType.invalidPlacement
      ) {
        syncPlacementValidationState({
          document: document.getSnapshot(),
          state,
          workspace,
        });
      }
    }),
    deleteCollection: action((collectionType) => {
      const collection = resolveCollection(collectionType);

      if (collection.length === 0) {
        return;
      }

      const currentDocument = document.getSnapshot();
      const removedCollectionIds = new Set(collection);
      const deletedEntityIds = new Set<string>();

      for (const entityId of collection) {
        const entity = resolveEntityById({
          entityId,
          document: currentDocument,
          drafts: state.drafts,
        });

        if (entity === null) {
          continue;
        }

        // 协议核心不可删除
        if (workspace.registry.queries.isProtocolCore(entity.definitionId)) {
          continue;
        }

        deletedEntityIds.add(isDraftEntity(entity) ? entity.originalEntityId : entity.id);
      }

      const nextEntities = { ...currentDocument.entities };
      let didUpdateDocument = false;

      for (const entityId of deletedEntityIds) {
        if (nextEntities[entityId] === undefined) {
          continue;
        }

        delete nextEntities[entityId];
        didUpdateDocument = true;
      }

      if (didUpdateDocument) {
        const deletedEntities = Array.from(deletedEntityIds)
          .flatMap((entityId) => {
            const entity = currentDocument.entities[entityId];

            return entity === undefined ? [] : [entity];
          });

        const committedDocument = documentWriter.commit({
          action: {
            type: "entity.delete",
            label: "删除设备",
            entityIds: Array.from(deletedEntityIds),
            definitionIds: resolveUniqueStrings(
              deletedEntities.map((entity) => entity.definitionId),
            ),
            count: deletedEntities.length,
          },
          update: (documentSnapshot) => ({
            ...documentSnapshot,
            entities: nextEntities,
          }),
        });

        if (committedDocument !== null) {
          syncPoweredEntityCollection({
            document: committedDocument,
            state,
            workspace,
          });
        }
      }

      const removedDraftIds = new Set<string>();
      const nextDrafts = state.drafts.filter((entity) => {
        const shouldDelete = removedCollectionIds.has(entity.id)
          || deletedEntityIds.has(entity.id)
          || deletedEntityIds.has(entity.originalEntityId);

        if (shouldDelete) {
          removedDraftIds.add(entity.id);
        }

        return !shouldDelete;
      });

      if (nextDrafts.length !== state.drafts.length) {
        state.drafts = nextDrafts;
      }

      removeEntityIdsFromCollections(
        new Set([
          ...removedCollectionIds,
          ...deletedEntityIds,
          ...removedDraftIds,
        ]),
      );

      if (collectionType === EntityCollectionType.marquee
        || collectionType === EntityCollectionType.reverseMarquee) {
        state.marqueeGridRect = null;
      }

      syncPlacementValidationState({
        document: document.getSnapshot(),
        state,
        workspace,
      });
    }),
    addToCollection: action(({ collectionType, entityId }) => {
      addEntityIdToCollection(collectionType, entityId);
    }),
    removeFromCollection: action(({ collectionType, entityId }) => {
      const collection = resolveCollection(collectionType);
      const entityIndex = collection.indexOf(entityId);

      if (entityIndex < 0) {
        return;
      }

      collection.splice(entityIndex, 1);
    }),
    setMarqueeRange: action((collectionType, gridRect) => {
      const marquee = resolveCollection(collectionType);

      if (!isValidGridRect(gridRect)) {
        marquee.replace([]);
        state.marqueeGridRect = null;
        return;
      }

      const currentDocument = document.getSnapshot();
      const nextEntityIds = resolveListedEntities({
        document: currentDocument,
        drafts: state.drafts,
      })
        .filter((entity) => isEntityIntersectingGridRect({
          entity,
          gridRect,
          entityDefinitionMap,
        }))
        .map((entity) => entity.id);

      marquee.replace(nextEntityIds);
      state.marqueeGridRect = { ...gridRect };
    }),
    applyMarquee: action(() => {
      const marquee = resolveCollection(EntityCollectionType.marquee);
      const reverseMarquee = resolveCollection(EntityCollectionType.reverseMarquee);

      for (const entityId of marquee) {
        addEntityIdToCollection(EntityCollectionType.selection, entityId);
      }

      marquee.replace([]);

      for (const entityId of reverseMarquee) {
        const entityIndex = resolveCollection(EntityCollectionType.selection).indexOf(entityId);

        if (entityIndex < 0) {
          continue;
        }

        resolveCollection(EntityCollectionType.selection).splice(entityIndex, 1);
      }

      reverseMarquee.replace([]);
      state.marqueeGridRect = null;
    }),
    cancelMarquee: action(() => {
      resolveCollection(EntityCollectionType.marquee).replace([]);
      resolveCollection(EntityCollectionType.reverseMarquee).replace([]);
      state.marqueeGridRect = null;
    }),
    moveCollectionTo: action(({ collectionType, startGridPoint, endGridPoint }) => {
      const gridVector = resolveGridVector({
        startGridPoint,
        endGridPoint,
      });

      if (gridVector === null) {
        return;
      }

      const collection = resolveCollection(collectionType);

      if (collection.length === 0) {
        return;
      }

      const currentDocument = document.getSnapshot();
      const targetEntityIds = new Set(collection);
      const nextEntities = { ...currentDocument.entities };
      let didUpdateDocument = false;

      for (const entityId of collection) {
        const entity = currentDocument.entities[entityId];

        if (entity === undefined) {
          continue;
        }

        nextEntities[entityId] = moveEntityByGridVector(entity, gridVector);
        didUpdateDocument = true;
      }

      if (didUpdateDocument) {
        const movedEntities = collection
          .map((entityId) => currentDocument.entities[entityId])
          .filter((entity): entity is WorldEntity => entity !== undefined);

        const nextDocumentSnapshot = {
          ...currentDocument,
          entities: nextEntities,
        };

        if (hasOutsideBasePlacementReason({
          document: nextDocumentSnapshot,
          entityIds: movedEntities.map((entity) => entity.id),
          state,
          workspace,
        })) {
          syncPlacementValidationState({
            document: currentDocument,
            state,
            workspace,
          });
          return;
        }

        const committedDocument = documentWriter.commit({
          action: {
            type: "entity.move",
            label: "移动设备",
            entityIds: movedEntities.map((entity) => entity.id),
            definitionIds: resolveUniqueStrings(
              movedEntities.map((entity) => entity.definitionId),
            ),
            count: movedEntities.length,
          },
          update: (documentSnapshot) => ({
            ...documentSnapshot,
            entities: nextEntities,
          }),
        });

        if (committedDocument !== null) {
          syncPoweredEntityCollection({
            document: committedDocument,
            state,
            workspace,
          });
        }
      }

      let didUpdateDrafts = false;
      const nextDrafts = state.drafts.map((entity) => {
        if (!targetEntityIds.has(entity.id) || currentDocument.entities[entity.id] !== undefined) {
          return entity;
        }

        didUpdateDrafts = true;
        return moveEntityByGridVector(entity, gridVector);
      });

      if (didUpdateDrafts) {
        state.drafts = nextDrafts;
      }

      syncPlacementValidationState({
        document: document.getSnapshot(),
        state,
        workspace,
      });
    }),
    rotateCollection: (collectionType) => {
      const collection = resolveCollection(collectionType);

      if (collection.length === 0) {
        return;
      }

      const currentDocument = document.getSnapshot();
      const rotatableEntities = resolveRotatableCollectionEntities({
        collection,
        document: currentDocument,
        drafts: state.drafts,
        entityDefinitionMap,
      });
      const rotationAnchorCell = resolveCollectionRotationAnchorCell(
        rotatableEntities,
      );

      if (rotationAnchorCell === null) {
        return;
      }

      const rotatedEntityMap = new Map(
        rotatableEntities.map(({ definition, entity }) => [
          entity.id,
          rotateEntityClockwise({
            entity,
            footprint: definition.footprint,
            rotationAnchorCell,
          }),
        ]),
      );
      const nextEntities = { ...currentDocument.entities };
      let didUpdateDocument = false;

      for (const entityId of collection) {
        const rotatedEntity = rotatedEntityMap.get(entityId);

        if (rotatedEntity === undefined || currentDocument.entities[entityId] === undefined) {
          continue;
        }

        nextEntities[entityId] = rotatedEntity;
        didUpdateDocument = true;
      }

      if (didUpdateDocument) {
        const rotatedEntities = collection
          .map((entityId) => currentDocument.entities[entityId])
          .filter((entity): entity is WorldEntity => entity !== undefined);

        const nextDocumentSnapshot = {
          ...currentDocument,
          entities: nextEntities,
        };

        if (hasOutsideBasePlacementReason({
          document: nextDocumentSnapshot,
          entityIds: rotatedEntities.map((entity) => entity.id),
          state,
          workspace,
        })) {
          syncPlacementValidationState({
            document: currentDocument,
            state,
            workspace,
          });
          return;
        }

        const committedDocument = documentWriter.commit({
          action: {
            type: "entity.rotate",
            label: "旋转设备",
            entityIds: rotatedEntities.map((entity) => entity.id),
            definitionIds: resolveUniqueStrings(
              rotatedEntities.map((entity) => entity.definitionId),
            ),
            count: rotatedEntities.length,
          },
          update: (documentSnapshot) => ({
            ...documentSnapshot,
            entities: nextEntities,
          }),
        });

        if (committedDocument !== null) {
          syncPoweredEntityCollection({
            document: committedDocument,
            state,
            workspace,
          });
        }
      }

      let didUpdateDrafts = false;
      const nextDrafts: DraftEntity[] = state.drafts.map((entity) => {
        const rotatedEntity = rotatedEntityMap.get(entity.id);

        if (rotatedEntity === undefined || currentDocument.entities[entity.id] !== undefined) {
          return entity;
        }

        didUpdateDrafts = true;
        return {
          ...rotatedEntity,
          originalEntityId: entity.originalEntityId,
        };
      });

      if (didUpdateDrafts) {
        state.drafts = nextDrafts;
      }

      syncPlacementValidationState({
        document: document.getSnapshot(),
        state,
        workspace,
      });
    },
  };
}

interface RotatableCollectionEntity<EntityT extends WorldEntity = WorldEntity> {
  entity: EntityT;
  definition: EntityDefinition;
}

function resolveGridVector(options: {
  startGridPoint: GridPoint;
  endGridPoint: GridPoint;
}): GridPoint | null {
  const x = options.endGridPoint.x - options.startGridPoint.x;
  const y = options.endGridPoint.y - options.startGridPoint.y;

  if (!Number.isFinite(x) || !Number.isFinite(y)) {
    return null;
  }

  if (x === 0 && y === 0) {
    return null;
  }

  return { x, y };
}

function moveEntityByGridVector<EntityT extends WorldEntity>(
  entity: EntityT,
  gridVector: GridPoint,
): EntityT {
  return {
    ...entity,
    position: {
      x: entity.position.x + gridVector.x,
      y: entity.position.y + gridVector.y,
    },
  } as EntityT;
}

function resolveRotatableCollectionEntities(options: {
  collection: readonly string[];
  document: EditorActionsContext["document"] extends { getSnapshot(): infer Snapshot }
    ? Snapshot
    : never;
  drafts: readonly WorldEntity[];
  entityDefinitionMap: ReadonlyMap<string, EntityDefinition>;
}): RotatableCollectionEntity[] {
  const entries: RotatableCollectionEntity[] = [];

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

    if (definition === undefined) {
      continue;
    }

    entries.push({
      entity,
      definition,
    });
  }

  return entries;
}

function resolveCollectionRotationAnchorCell(
  entries: readonly RotatableCollectionEntity[],
): {
  x: number;
  y: number;
} | null {
  const bounds = getGridBoundingBox(
    entries.map(({ definition, entity }) => ({
      position: entity.position,
      footprint: getRotatedGridFootprint(definition.footprint, entity.rotation),
    })),
  );

  if (bounds === null) {
    return null;
  }

  return resolveGridRectRotationAnchorCell({
    x: bounds.left,
    y: bounds.top,
    width: bounds.width,
    height: bounds.height,
  });
}

function rotateEntityClockwise<EntityT extends WorldEntity>(options: {
  entity: EntityT;
  footprint: EntityDefinition["footprint"];
  rotationAnchorCell: {
    x: number;
    y: number;
  };
}): EntityT {
  const nextRotation = rotateGridRotationClockwise(options.entity.rotation);
  const currentFootprint = getRotatedGridFootprint(
    options.footprint,
    options.entity.rotation,
  );
  const nextFootprint = getRotatedGridFootprint(options.footprint, nextRotation);
  const rotatedAnchorCell = rotateGridAnchorCellClockwise({
    anchorCell: resolveGridRectRotationAnchorCell({
      x: options.entity.position.x,
      y: options.entity.position.y,
      width: currentFootprint.width,
      height: currentFootprint.height,
    }),
    rotationAnchorCell: options.rotationAnchorCell,
  });

  return {
    ...options.entity,
    position: resolveAnchoredGridPointWithoutClamp(
      rotatedAnchorCell,
      nextFootprint,
    ),
    rotation: nextRotation,
  } as EntityT;
}

function resolveGridRectRotationAnchorCell(
  gridRect: GridRect,
): GridPoint {
  return {
    x: gridRect.x + Math.floor((gridRect.width - 1) / 2),
    y: gridRect.y + Math.floor((gridRect.height - 1) / 2),
  };
}

function rotateGridAnchorCellClockwise(options: {
  anchorCell: {
    x: number;
    y: number;
  };
  rotationAnchorCell: {
    x: number;
    y: number;
  };
}): GridPoint {
  const relativeX = options.anchorCell.x - options.rotationAnchorCell.x;
  const relativeY = options.anchorCell.y - options.rotationAnchorCell.y;

  return {
    x: options.rotationAnchorCell.x - relativeY,
    y: options.rotationAnchorCell.y + relativeX,
  };
}

function resolveAnchoredGridPointWithoutClamp(
  anchorCell: {
    x: number;
    y: number;
  },
  footprint: GridRectSize,
): GridPoint {
  return {
    x: anchorCell.x - Math.floor((footprint.width - 1) / 2),
    y: anchorCell.y - Math.floor((footprint.height - 1) / 2),
  };
}

// AI-REMOVED 2026-06-05:
// Reason: 连续几何中心 + Math.round 不能让 6×5 这类奇偶混合 footprint 四次旋转闭合，会导致扩容反应池按 R 越转越靠下。
// Trigger: 用户反馈“扩容反应池按 R 旋转不幂等，越转越靠下”。
// Evidence: item_port_mix_pool_large_1 footprint 为 6×5；旧算法从 (10,10) 连续四次旋转会漂移到 (12,12)。
// Replacement: resolveGridRectRotationAnchorCell / rotateGridAnchorCellClockwise / resolveAnchoredGridPointWithoutClamp
// Risk: Low，旋转锚点改用项目已有的偏左 / 偏上中心格规则；仍需回归覆盖集合旋转。
// Human Review: Required
//
// Original code:
// function resolveCenteredGridPointWithoutClamp(
//   centerCells: {
//     x: number;
//     y: number;
//   },
//   footprint: GridRectSize,
// ): GridPoint {
//   return {
//     x: Math.round(centerCells.x - footprint.width / 2),
//     y: Math.round(centerCells.y - footprint.height / 2),
//   };
// }

function resolveUniqueStrings(values: readonly string[]): string[] {
  return Array.from(new Set(values));
}

function isValidGridRect(gridRect: GridRect): boolean {
  return Number.isFinite(gridRect.x)
    && Number.isFinite(gridRect.y)
    && Number.isFinite(gridRect.width)
    && Number.isFinite(gridRect.height)
    && gridRect.width > 0
    && gridRect.height > 0;
}

function isEntityIntersectingGridRect(options: {
  entity: WorldEntity;
  gridRect: GridRect;
  entityDefinitionMap: ReadonlyMap<string, EntityDefinition>;
}): boolean {
  const definition = options.entityDefinitionMap.get(options.entity.definitionId);

  if (definition === undefined) {
    return false;
  }

  const footprint = getRotatedGridFootprint(
    definition.footprint,
    options.entity.rotation,
  );

  return doGridRectsIntersect(
    options.gridRect,
    {
      x: options.entity.position.x,
      y: options.entity.position.y,
      width: footprint.width,
      height: footprint.height,
    },
  );
}

function doGridRectsIntersect(a: GridRect, b: GridRect): boolean {
  return a.x < b.x + b.width
    && a.x + a.width > b.x
    && a.y < b.y + b.height
    && a.y + a.height > b.y;
}
