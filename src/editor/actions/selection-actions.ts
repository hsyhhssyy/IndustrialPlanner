import type { EditorAction } from "@/domain/action/editor-action";
import { EntityCollectionType } from "@/domain/state/types";

import { resolveEntityById } from "../entity-resolvers";
import type { EditorActionsContext } from "./types";

type EditorCollectionActions = Pick<
  EditorAction,
  "addToCollection" | "clearCollection" | "removeFromCollection"
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
  };
}
