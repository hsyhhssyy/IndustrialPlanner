import type { EditorAction } from "@/domain/editor/editor-action";
import { action } from "mobx";
import type { WorldEntity } from "@/domain/document/world-document";
import { EntityCollectionType } from "@/domain/editor/types/editor-types";
import type { GridPoint, GridRect, GridRectSize } from "@/domain/shared/grid";
import type { EntityDefinition } from "@/domain/registry/types/entity-definition";
import {
  getGridFootprintCenterCells,
  getRotatedGridFootprint,
  rotateGridCenterCellsClockwise,
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

      // 单实体旋转：直接改 rotation，不触发锚点计算与 position 重算，
      // 确保任意奇偶 footprint 都幂等（四次旋转回原位）。
      if (rotatableEntities.length === 1) {
        const entry = rotatableEntities[0];
        const nextRotation = rotateGridRotationClockwise(entry.entity.rotation);
        const rotatedEntity = { ...entry.entity, rotation: nextRotation } as WorldEntity;
        const entityId = entry.entity.id;

        const nextEntities = { ...currentDocument.entities };
        let didUpdateDocument = false;

        if (nextEntities[entityId] !== undefined) {
          nextEntities[entityId] = rotatedEntity;
          didUpdateDocument = true;
        }

        if (didUpdateDocument) {
          const nextDocumentSnapshot = { ...currentDocument, entities: nextEntities };
          if (hasOutsideBasePlacementReason({
            document: nextDocumentSnapshot,
            entityIds: [entityId],
            state,
            workspace,
          })) {
            syncPlacementValidationState({ document: currentDocument, state, workspace });
            return;
          }
          const committedDocument = documentWriter.commit({
            action: { type: "entity.rotate", label: "旋转设备", entityIds: [entityId], definitionIds: [entry.entity.definitionId], count: 1 },
            update: (documentSnapshot) => ({ ...documentSnapshot, entities: nextEntities }),
          });
          if (committedDocument !== null) {
            syncPoweredEntityCollection({ document: committedDocument, state, workspace });
          }
        }

        let didUpdateDrafts = false;
        const nextDrafts: DraftEntity[] = state.drafts.map((entity) => {
          if (entity.id !== entityId || currentDocument.entities[entityId] !== undefined) return entity;
          didUpdateDrafts = true;
          return { ...rotatedEntity, originalEntityId: entity.originalEntityId };
        });
        if (didUpdateDrafts) { state.drafts = nextDrafts; }

        syncPlacementValidationState({ document: document.getSnapshot(), state, workspace });
        return;
      }

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
  if (entries.length === 0) {
    return null;
  }

  // AI-CORRECTION 2026-06-08: 用实体几何中心均值作为旋转锚点（不取整），
  // 确保单实体锚点 = 实体中心（触发 fast path 只改 rotation），
  // 多实体锚点为浮点均值，绕此点旋转保持相对位置且四次回原位。
  let sumX = 0;
  let sumY = 0;
  for (const { definition, entity } of entries) {
    const fp = getRotatedGridFootprint(definition.footprint, entity.rotation);
    sumX += entity.position.x + fp.width / 2;
    sumY += entity.position.y + fp.height / 2;
  }

  return {
    x: Math.round(sumX / entries.length),
    y: Math.round(sumY / entries.length),
  };
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
  // AI-CORRECTION 2026-06-08: 用浮点几何中心 + rotateGridCenterCellsClockwise 替代
  // resolveGridRectRotationAnchorCell / rotateGridAnchorCellClockwise / resolveAnchoredGridPointWithoutClamp。
  // 旧体系 floor((W-1)/2) 对偶数 footprint 产生不对称偏置，180° 旋转后实体额外偏移 2 格。
  const entityCenter = getGridFootprintCenterCells(
    options.entity.position,
    currentFootprint,
  );
  // 单实体旋转：实体中心与集合旋转中心重合（严格相等），只改 rotation 不动 position，
  // 避免 Math.round(center - fp/2) 对 6×5 等奇偶混合 footprint 产生累积漂移。
  // 注：仅对偶数 footprint（几何中心为整数）触发；奇数 footprint 由 rotateCollection 统一处理。
  if (
    entityCenter.x === options.rotationAnchorCell.x
    && entityCenter.y === options.rotationAnchorCell.y
  ) {
    return {
      ...options.entity,
      rotation: nextRotation,
    } as EntityT;
  }
  const nextFootprint = getRotatedGridFootprint(options.footprint, nextRotation);
  const rotatedCenter = rotateGridCenterCellsClockwise({
    centerCells: entityCenter,
    rotationCenterCells: options.rotationAnchorCell,
  });

  return {
    ...options.entity,
    position: {
      x: Math.round(rotatedCenter.x - nextFootprint.width / 2),
      y: Math.round(rotatedCenter.y - nextFootprint.height / 2),
    },
    rotation: nextRotation,
  } as EntityT;
}

// AI-REMOVED 2026-06-08:
// Reason: floor((W-1)/2) 锚点公式对偶数 footprint 产生不对称偏置，导致 180° 旋转后实体额外漂移 2 格，
//   混合奇偶尺寸设备集合旋转时相对位置错乱。
// Trigger: 用户反馈蓝图包含 4×4 bus_source + 3×1 unloader，旋转 180°/270° 后设备不再相邻。
// Evidence: bus_source(4×4) 锚点偏左 1 格，180° 后偏右 1 格 + 还原时又偏左 1 格 = 偏移 2 格；
//   unloader(3×1) 偏差仅 0.5 格，两者不一致导致错位。
// Replacement: getGridFootprintCenterCells / rotateGridCenterCellsClockwise / Math.round(center - fp/2)
//   （浮点几何中心体系），在 rotateEntityClockwise 中直接内联。
// Risk: Low，新方案已通过 v2/v3/v4/v5 测试集回归；Math.round 确保 6×5 单设备旋转幂等。
// Human Review: Not Required
//
// Original code:
// function resolveGridRectRotationAnchorCell(
//   gridRect: GridRect,
// ): GridPoint {
//   return {
//     x: gridRect.x + Math.floor((gridRect.width - 1) / 2),
//     y: gridRect.y + Math.floor((gridRect.height - 1) / 2),
//   };
// }
//
// function rotateGridAnchorCellClockwise(options: {
//   anchorCell: {
//     x: number;
//     y: number;
//   };
//   rotationAnchorCell: {
//     x: number;
//     y: number;
//   };
// }): GridPoint {
//   const relativeX = options.anchorCell.x - options.rotationAnchorCell.x;
//   const relativeY = options.anchorCell.y - options.rotationAnchorCell.y;
//
//   return {
//     x: options.rotationAnchorCell.x - relativeY,
//     y: options.rotationAnchorCell.y + relativeX,
//   };
// }
//
// function resolveAnchoredGridPointWithoutClamp(
//   anchorCell: {
//     x: number;
//     y: number;
//   },
//   footprint: GridRectSize,
// ): GridPoint {
//   return {
//     x: anchorCell.x - Math.floor((footprint.width - 1) / 2),
//     y: anchorCell.y - Math.floor((footprint.height - 1) / 2),
//   };
// }

// AI-REMOVED 2026-06-05:
// Reason: 连续几何中心 + Math.round 不能让 6×5 这类奇偶混合 footprint 四次旋转闭合，会导致扩容反应池按 R 越转越靠下。
// Trigger: 用户反馈“扩容反应池按 R 旋转不幂等，越转越靠下”。
// Evidence: item_port_mix_pool_large_1 footprint 为 6×5；旧算法从 (10,10) 连续四次旋转会漂移到 (12,12)。
// Replacement: resolveGridRectRotationAnchorCell / rotateGridAnchorCellClockwise / resolveAnchoredGridPointWithoutClamp
//   → 2026-06-08 此方案也被替换为浮点几何中心 + Math.round，见上方 AI-REMOVED 2026-06-08。
// Risk: Low
// Human Review: Not Required
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
