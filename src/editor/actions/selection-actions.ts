import type { EditorAction } from "@/domain/action/editor-action";

import { resolveEntityById } from "../entity-resolvers";
import type { EditorActionsContext } from "./types";

type EditorSelectionActions = Pick<EditorAction, "selectEntity">;

export function createEditorSelectionActions({
  document,
  state,
}: EditorActionsContext): EditorSelectionActions {
  return {
    selectEntity: (entityId) => {
      const entity = resolveEntityById({
        entityId,
        document: document.getSnapshot(),
        drafts: state.drafts,
      });

      if (entity === null) {
        return;
      }

      state.selectedEntities[entity.id] = entity;
    },
  };
}
