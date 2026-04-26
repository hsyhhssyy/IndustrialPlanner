import type { EditorAction } from "@/domain/action/editor-action";
import type { WorldEntity } from "@/domain/entity/world-document";
import { EntityCollectionType, type MarqueeCollectionType } from "@/domain/state/types";
import type { GridPoint, GridRect, GridRectSize } from "@/domain/types/grid";
import type { EntityDefinition } from "@/domain/types/registry/entity-definition";
import {
  getGridBoundingBox,
  getGridBoundsCenterCells,
  getGridFootprintCenterCells,
  getRotatedGridFootprint,
  rotateGridCenterCellsClockwise,
  rotateGridRotationClockwise,
} from "@/shared/geometry/grid";

import { resolveEntityById, resolveListedEntities } from "../entity-resolvers";
import type { EditorActionsContext } from "./types";

type EditorCollectionActions = Pick<
  EditorAction,
  | "addToCollection"
  | "applyMarquee"
  | "cancelMarquee"
  | "clearCollection"
  | "moveCollectionTo"
  | "removeFromCollection"
  | "rotateCollection"
  | "setMarqueeRange"
>;

export function createEditorSelectionActions({
  document,
  state,
  workspace,
}: EditorActionsContext): EditorCollectionActions {
  const resolveCollection = (collectionType: EntityCollectionType) =>
    state.collections[collectionType];
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
    clearCollection: (collectionType) => {
      resolveCollection(collectionType).replace([]);
    },
    addToCollection: ({ collectionType, entityId }) => {
      addEntityIdToCollection(collectionType, entityId);
    },
    removeFromCollection: ({ collectionType, entityId }) => {
      const collection = resolveCollection(collectionType);
      const entityIndex = collection.indexOf(entityId);

      if (entityIndex < 0) {
        return;
      }

      collection.splice(entityIndex, 1);
    },
    setMarqueeRange: (collectionType, gridRect) => {
      const marquee = resolveCollection(collectionType);

      if (!isValidGridRect(gridRect)) {
        marquee.replace([]);
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
    },
    applyMarquee: () => {
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
    },
    cancelMarquee: () => {
      resolveCollection(EntityCollectionType.marquee).replace([]);
      resolveCollection(EntityCollectionType.reverseMarquee).replace([]);
    },
    moveCollectionTo: ({ collectionType, startGridPoint, endGridPoint }) => {
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
        document.setSnapshot({
          ...currentDocument,
          entities: nextEntities,
        });
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
    },
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
      const rotationCenterCells = resolveCollectionRotationCenterCells(
        rotatableEntities,
      );

      if (rotationCenterCells === null) {
        return;
      }

      const rotatedEntityMap = new Map(
        rotatableEntities.map(({ definition, entity }) => [
          entity.id,
          rotateEntityClockwise({
            entity,
            footprint: definition.footprint,
            rotationCenterCells,
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
        document.setSnapshot({
          ...currentDocument,
          entities: nextEntities,
        });
      }

      let didUpdateDrafts = false;
      const nextDrafts = state.drafts.map((entity) => {
        const rotatedEntity = rotatedEntityMap.get(entity.id);

        if (rotatedEntity === undefined || currentDocument.entities[entity.id] !== undefined) {
          return entity;
        }

        didUpdateDrafts = true;
        return rotatedEntity;
      });

      if (didUpdateDrafts) {
        state.drafts = nextDrafts;
      }
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

function resolveCollectionRotationCenterCells(
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

  return getGridBoundsCenterCells(bounds);
}

function rotateEntityClockwise<EntityT extends WorldEntity>(options: {
  entity: EntityT;
  footprint: EntityDefinition["footprint"];
  rotationCenterCells: {
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
  const rotatedCenterCells = rotateGridCenterCellsClockwise({
    centerCells: getGridFootprintCenterCells(
      options.entity.position,
      currentFootprint,
    ),
    rotationCenterCells: options.rotationCenterCells,
  });

  return {
    ...options.entity,
    position: resolveCenteredGridPointWithoutClamp(
      rotatedCenterCells,
      nextFootprint,
    ),
    rotation: nextRotation,
  } as EntityT;
}

function resolveCenteredGridPointWithoutClamp(
  centerCells: {
    x: number;
    y: number;
  },
  footprint: GridRectSize,
): GridPoint {
  return {
    x: Math.round(centerCells.x - footprint.width / 2),
    y: Math.round(centerCells.y - footprint.height / 2),
  };
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
