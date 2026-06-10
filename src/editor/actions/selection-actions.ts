import type { EditorAction } from "@/domain/editor/editor-action";
import { action } from "mobx";
import type { WorldEntity } from "@/domain/document/world-document";
import { EntityCollectionType } from "@/domain/editor/types/editor-types";
import type { GridPoint, GridRect, GridRotation } from "@/domain/shared/grid";
import type { EntityDefinition } from "@/domain/registry/types/entity-definition";
import {
  getRotatedGridFootprint,
  rotateGridRotation,
} from "@/shared/geometry/grid";
import { resolveWorldPointFromViewportPoint } from "@/shared/geometry/viewport-transform";

import { type DraftEntity, isDraftEntity } from "../draft-entity";
import { resolveEntityById, resolveListedEntities } from "../entity-resolvers";
import {
  type EntityCollectionGeometryEntry,
  resolveEntityCollectionGeometry,
} from "../entity-collection-geometry";
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
  | "moveCollectionCenterPointTo"
  | "moveCollectionTo"
  | "removeFromCollection"
  | "rotateCollection"
  | "rotateCollectionAroundCenterPoint"
  | "rotateCollectionAroundPivotCell"
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

  const moveCollectionByGridVector = (
    collectionType: EntityCollectionType,
    gridVector: GridPoint,
  ): void => {
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
  };

  const moveCollectionTo: EditorCollectionActions["moveCollectionTo"] = action(({
    collectionType,
    startGridPoint,
    endGridPoint,
  }) => {
    const gridVector = resolveGridVector({
      startGridPoint,
      endGridPoint,
    });

    if (gridVector === null) {
      return;
    }

    moveCollectionByGridVector(collectionType, gridVector);
  });

  const moveCollectionCenterPointTo: EditorCollectionActions["moveCollectionCenterPointTo"] = action((
    collectionType,
    clientPixelPoint,
  ) => {
    const collection = resolveCollection(collectionType);

    if (collection.length === 0) {
      return;
    }

    const currentDocument = document.getSnapshot();
    const geometry = resolveEntityCollectionGeometry({
      collection,
      document: currentDocument,
      drafts: state.drafts,
      entityDefinitionMap,
    });

    if (geometry === null) {
      return;
    }

    const worldPoint = resolveWorldPointFromViewportPoint({
      viewportPoint: clientPixelPoint,
      viewportBounds: state.viewport.clientRect,
      viewportCenter: state.viewport.center,
      gridCellPixelSize: state.viewport.gridCellPixelSize,
      displayRotation: state.viewport.displayRotation,
    });

    if (worldPoint === null) {
      return;
    }

    const nextTopLeft = {
      x: snapTopLeftToNearestInteger(
        worldPoint.x - geometry.boundingBox.width / 2,
      ),
      y: snapTopLeftToNearestInteger(
        worldPoint.y - geometry.boundingBox.height / 2,
      ),
    };
    const gridVector = resolveGridVector({
      startGridPoint: {
        x: geometry.boundingBox.x,
        y: geometry.boundingBox.y,
      },
      endGridPoint: nextTopLeft,
    });

    if (gridVector === null) {
      return;
    }

    moveCollectionByGridVector(collectionType, gridVector);
  });

  const applyRotatedEntityMap = (options: {
    collectionType: EntityCollectionType;
    currentDocument: ReturnType<EditorActionsContext["document"]["getSnapshot"]>;
    rotatedEntityMap: ReadonlyMap<string, WorldEntity>;
  }): void => {
    const collection = resolveCollection(options.collectionType);
    const nextEntities = { ...options.currentDocument.entities };
    let didUpdateDocument = false;

    for (const entityId of collection) {
      const rotatedEntity = options.rotatedEntityMap.get(entityId);

      if (
        rotatedEntity === undefined
        || options.currentDocument.entities[entityId] === undefined
      ) {
        continue;
      }

      nextEntities[entityId] = rotatedEntity;
      didUpdateDocument = true;
    }

    if (didUpdateDocument) {
      const rotatedEntities = collection
        .map((entityId) => options.currentDocument.entities[entityId])
        .filter((entity): entity is WorldEntity => entity !== undefined);

      const nextDocumentSnapshot = {
        ...options.currentDocument,
        entities: nextEntities,
      };

      if (hasOutsideBasePlacementReason({
        document: nextDocumentSnapshot,
        entityIds: rotatedEntities.map((entity) => entity.id),
        state,
        workspace,
      })) {
        syncPlacementValidationState({
          document: options.currentDocument,
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
      const rotatedEntity = options.rotatedEntityMap.get(entity.id);

      if (
        rotatedEntity === undefined
        || options.currentDocument.entities[entity.id] !== undefined
      ) {
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
  };

  const rotateCollectionByAngle = (
    collectionType: EntityCollectionType,
    angle: number,
    pivotMode: "center" | "pivot-cell",
  ): void => {
    const rotationAngle = normalizeRotationAngle(angle);

    if (rotationAngle === null || rotationAngle === 0) {
      return;
    }
    const collection = resolveCollection(collectionType);

    if (collection.length === 0) {
      return;
    }
    const currentDocument = document.getSnapshot();
    const geometry = resolveEntityCollectionGeometry({
      collection,
      document: currentDocument,
      drafts: state.drafts,
      entityDefinitionMap,
    });

    if (geometry === null) {
      return;
    }
    const rotationCenter = pivotMode === "center"
      ? geometry.centerPoint
      : geometry.pivotCell;
    const rotatedBoundingBox = pivotMode === "center"
      ? alignRotatedBoundingBoxToGrid(
        rotateGridRectAroundPoint({
          gridRect: geometry.boundingBox,
          point: rotationCenter,
          angle: rotationAngle,
        }),
      )
      : normalizeGridRect(
        rotateGridRectAroundPoint({
          gridRect: geometry.boundingBox,
          point: rotationCenter,
          angle: rotationAngle,
        }),
      );
    const rotatedEntityMap = new Map(
      geometry.entries.map((entry) => [
        entry.entity.id,
        rotateEntityAroundCollectionBoundingBox({
          entry,
          sourceBoundingBox: geometry.boundingBox,
          targetBoundingBox: rotatedBoundingBox,
          angle: rotationAngle,
        }),
      ]),
    );

    applyRotatedEntityMap({
      collectionType,
      currentDocument,
      rotatedEntityMap,
    });
  };

  const rotateCollectionAroundCenterPoint: EditorCollectionActions["rotateCollectionAroundCenterPoint"] = action((
    collectionType,
    angle,
  ) => {
    rotateCollectionByAngle(collectionType, angle, "center");
  });

  const rotateCollectionAroundPivotCell: EditorCollectionActions["rotateCollectionAroundPivotCell"] = action((
    collectionType,
    angle,
  ) => {
    rotateCollectionByAngle(collectionType, angle, "pivot-cell");
  });

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
            // AI-CORRECTION 2026-06-10: 删除实体时同步清理关联的 slotLinks，
            // 否则同名新设备会被旧链接自动连上。
            slotLinks: documentSnapshot.slotLinks.filter(
              (slotLink) =>
                !deletedEntityIds.has(slotLink.source.entityId)
                && !deletedEntityIds.has(slotLink.target.entityId),
            ),
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
    moveCollectionTo,
    moveCollectionCenterPointTo,
    rotateCollection: (collectionType) => {
      rotateCollectionAroundPivotCell(collectionType, 90);
    },
    rotateCollectionAroundCenterPoint,
    rotateCollectionAroundPivotCell,
  };
}

const EPSILON = 1e-9;

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

function normalizeRotationAngle(angle: number): GridRotation | null {
  if (!Number.isFinite(angle)) {
    return null;
  }
  const truncated = Math.trunc(angle);

  if (Math.abs(angle - truncated) > EPSILON || truncated % 90 !== 0) {
    return null;
  }

  return (((truncated % 360) + 360) % 360) as GridRotation;
}

function snapTopLeftToNearestInteger(value: number): number {
  const floorValue = Math.floor(value);
  const ceilValue = Math.ceil(value);
  const floorDistance = Math.abs(value - floorValue);
  const ceilDistance = Math.abs(value - ceilValue);

  if (floorDistance <= ceilDistance + EPSILON) {
    return normalizeZero(floorValue);
  }

  return normalizeZero(ceilValue);
}

function rotateEntityAroundCollectionBoundingBox(options: {
  entry: EntityCollectionGeometryEntry;
  sourceBoundingBox: GridRect;
  targetBoundingBox: GridRect;
  angle: GridRotation;
}): WorldEntity {
  const relativeGridRect = {
    x: options.entry.gridRect.x - options.sourceBoundingBox.x,
    y: options.entry.gridRect.y - options.sourceBoundingBox.y,
    width: options.entry.gridRect.width,
    height: options.entry.gridRect.height,
  };
  const rotatedRelativeGridRect = rotateRelativeGridRect({
    gridRect: relativeGridRect,
    boundingBox: options.sourceBoundingBox,
    angle: options.angle,
  });

  return {
    ...options.entry.entity,
    position: {
      x: normalizeNumber(options.targetBoundingBox.x + rotatedRelativeGridRect.x),
      y: normalizeNumber(options.targetBoundingBox.y + rotatedRelativeGridRect.y),
    },
    rotation: rotateGridRotation(options.entry.entity.rotation, options.angle),
  };
}

function rotateRelativeGridRect(options: {
  gridRect: GridRect;
  boundingBox: Pick<GridRect, "width" | "height">;
  angle: GridRotation;
}): GridRect {
  const { gridRect, boundingBox } = options;

  switch (options.angle) {
    case 90:
      return {
        x: normalizeNumber(boundingBox.height - gridRect.y - gridRect.height),
        y: normalizeNumber(gridRect.x),
        width: gridRect.height,
        height: gridRect.width,
      };
    case 180:
      return {
        x: normalizeNumber(boundingBox.width - gridRect.x - gridRect.width),
        y: normalizeNumber(boundingBox.height - gridRect.y - gridRect.height),
        width: gridRect.width,
        height: gridRect.height,
      };
    case 270:
      return {
        x: normalizeNumber(gridRect.y),
        y: normalizeNumber(boundingBox.width - gridRect.x - gridRect.width),
        width: gridRect.height,
        height: gridRect.width,
      };
    case 0:
    default:
      return { ...gridRect };
  }
}

function rotateGridRectAroundPoint(options: {
  gridRect: GridRect;
  point: { readonly x: number; readonly y: number };
  angle: GridRotation;
}): GridRect {
  const corners = [
    { x: options.gridRect.x, y: options.gridRect.y },
    { x: options.gridRect.x + options.gridRect.width, y: options.gridRect.y },
    { x: options.gridRect.x, y: options.gridRect.y + options.gridRect.height },
    {
      x: options.gridRect.x + options.gridRect.width,
      y: options.gridRect.y + options.gridRect.height,
    },
  ].map((corner) => rotateGridPointAroundPoint({
    point: corner,
    rotationPoint: options.point,
    angle: options.angle,
  }));
  const left = Math.min(...corners.map((corner) => corner.x));
  const right = Math.max(...corners.map((corner) => corner.x));
  const top = Math.min(...corners.map((corner) => corner.y));
  const bottom = Math.max(...corners.map((corner) => corner.y));

  return {
    x: normalizeNumber(left),
    y: normalizeNumber(top),
    width: normalizeNumber(right - left),
    height: normalizeNumber(bottom - top),
  };
}

function rotateGridPointAroundPoint(options: {
  point: { readonly x: number; readonly y: number };
  rotationPoint: { readonly x: number; readonly y: number };
  angle: GridRotation;
}): GridPoint {
  const relativeX = options.point.x - options.rotationPoint.x;
  const relativeY = options.point.y - options.rotationPoint.y;

  switch (options.angle) {
    case 90:
      return {
        x: normalizeNumber(options.rotationPoint.x - relativeY),
        y: normalizeNumber(options.rotationPoint.y + relativeX),
      };
    case 180:
      return {
        x: normalizeNumber(options.rotationPoint.x - relativeX),
        y: normalizeNumber(options.rotationPoint.y - relativeY),
      };
    case 270:
      return {
        x: normalizeNumber(options.rotationPoint.x + relativeY),
        y: normalizeNumber(options.rotationPoint.y - relativeX),
      };
    case 0:
    default:
      return {
        x: normalizeNumber(options.point.x),
        y: normalizeNumber(options.point.y),
      };
  }
}

function alignRotatedBoundingBoxToGrid(gridRect: GridRect): GridRect {
  return {
    x: alignRotatedTopLeftAxisToGrid(gridRect.x),
    y: alignRotatedTopLeftAxisToGrid(gridRect.y),
    width: normalizeNumber(gridRect.width),
    height: normalizeNumber(gridRect.height),
  };
}

function alignRotatedTopLeftAxisToGrid(value: number): number {
  if (isIntegerLike(value)) {
    return normalizeZero(Math.round(value));
  }

  return normalizeNumber(value + 0.5);
}

function normalizeGridRect(gridRect: GridRect): GridRect {
  return {
    x: normalizeNumber(gridRect.x),
    y: normalizeNumber(gridRect.y),
    width: normalizeNumber(gridRect.width),
    height: normalizeNumber(gridRect.height),
  };
}

function normalizeNumber(value: number): number {
  if (isIntegerLike(value)) {
    return normalizeZero(Math.round(value));
  }

  return normalizeZero(value);
}

function isIntegerLike(value: number): boolean {
  return Math.abs(value - Math.round(value)) < EPSILON;
}

function normalizeZero(value: number): number {
  return Object.is(value, -0) ? 0 : value;
}

// AI-REMOVED 2026-06-09:
// Reason: 旧旋转实现围绕偏左/偏上的 rotationAnchorCell 逐实体重算，无法表达“bbox 绕 center point / pivot cell 旋转，并保持 entity 在 bbox 相对坐标系中的位置关系”的新需求。
// Trigger: 用户要求完全重构移动和旋转，新增 rotateCollectionAroundCenterPoint / rotateCollectionAroundPivotCell，并区分鼠标中心旋转与触控 pivot 旋转。
// Evidence: 新需求明确要求先记录 collection 内 entity 相对 bbox 的 offset，再旋转 bbox，最后按旋转后的 bbox 重算所有 entity；旧 resolveGridRectRotationAnchorCell / rotateGridAnchorCellClockwise 只处理 anchor cell。
// Replacement: normalizeRotationAngle / rotateGridRectAroundPoint / rotateRelativeGridRect / rotateEntityAroundCollectionBoundingBox
// Risk: Medium，集合旋转语义改变会影响既有绝对坐标断言；已通过新增回归测试覆盖边界。
// Human Review: Required
//
// Original code:
// interface RotatableCollectionEntity<EntityT extends WorldEntity = WorldEntity> {
//   entity: EntityT;
//   definition: EntityDefinition;
// }
//
// function resolveRotatableCollectionEntities(options: {
//   collection: readonly string[];
//   document: EditorActionsContext["document"] extends { getSnapshot(): infer Snapshot }
//     ? Snapshot
//     : never;
//   drafts: readonly WorldEntity[];
//   entityDefinitionMap: ReadonlyMap<string, EntityDefinition>;
// }): RotatableCollectionEntity[] {
//   const entries: RotatableCollectionEntity[] = [];
//
//   for (const entityId of options.collection) {
//     const entity = resolveEntityById({
//       entityId,
//       document: options.document,
//       drafts: options.drafts,
//     });
//
//     if (entity === null) {
//       continue;
//     }
//
//     const definition = options.entityDefinitionMap.get(entity.definitionId);
//
//     if (definition === undefined) {
//       continue;
//     }
//
//     entries.push({
//       entity,
//       definition,
//     });
//   }
//
//   return entries;
// }
//
// function resolveCollectionRotationAnchorCell(
//   entries: readonly RotatableCollectionEntity[],
// ): {
//   x: number;
//   y: number;
// } | null {
//   const bounds = getGridBoundingBox(
//     entries.map(({ definition, entity }) => ({
//       position: entity.position,
//       footprint: getRotatedGridFootprint(definition.footprint, entity.rotation),
//     })),
//   );
//
//   if (bounds === null) {
//     return null;
//   }
//
//   return resolveGridRectRotationAnchorCell({
//     x: bounds.left,
//     y: bounds.top,
//     width: bounds.width,
//     height: bounds.height,
//   });
// }
//
// function rotateEntityClockwise<EntityT extends WorldEntity>(options: {
//   entity: EntityT;
//   footprint: EntityDefinition["footprint"];
//   rotationAnchorCell: {
//     x: number;
//     y: number;
//   };
// }): EntityT {
//   const nextRotation = rotateGridRotationClockwise(options.entity.rotation);
//   const currentFootprint = getRotatedGridFootprint(
//     options.footprint,
//     options.entity.rotation,
//   );
//   const nextFootprint = getRotatedGridFootprint(options.footprint, nextRotation);
//   const rotatedAnchorCell = rotateGridAnchorCellClockwise({
//     anchorCell: resolveGridRectRotationAnchorCell({
//       x: options.entity.position.x,
//       y: options.entity.position.y,
//       width: currentFootprint.width,
//       height: currentFootprint.height,
//     }),
//     rotationAnchorCell: options.rotationAnchorCell,
//   });
//
//   return {
//     ...options.entity,
//     position: resolveAnchoredGridPointWithoutClamp(
//       rotatedAnchorCell,
//       nextFootprint,
//     ),
//     rotation: nextRotation,
//   } as EntityT;
// }
//
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
