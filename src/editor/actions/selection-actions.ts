import type { EditorAction } from "@/domain/action/editor-action";
import type { WorldEntity } from "@/domain/entity/world-document";
import { EntityCollectionType } from "@/domain/state/types";
import type { GridPoint } from "@/domain/types/grid";

import { resolveEntityById } from "../entity-resolvers";
import type { EditorActionsContext } from "./types";

type EditorCollectionActions = Pick<
  EditorAction,
  | "addToCollection"
  | "clearCollection"
  | "moveCollectionTo"
  | "removeFromCollection"
>;

export function createEditorSelectionActions({
  document,
  state,
}: EditorActionsContext): EditorCollectionActions {
  const resolveCollection = (collectionType: EntityCollectionType) =>
    state.collections[collectionType];

  return {
    clearCollection: (collectionType) => {
      resolveCollection(collectionType).replace([]);
    },
    addToCollection: ({ collectionType, entityId }) => {
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
    },
    removeFromCollection: ({ collectionType, entityId }) => {
      const collection = resolveCollection(collectionType);
      const entityIndex = collection.indexOf(entityId);

      if (entityIndex < 0) {
        return;
      }

      collection.splice(entityIndex, 1);
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
  };
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
