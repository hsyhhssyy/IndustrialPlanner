import { createWorldDocument } from "@/domain/document/world-document";
import type { EditorAction } from "@/domain/editor/editor-action";
import { EntityCollectionType } from "@/domain/editor/types/editor-types";

import {
  resolveLatestWorldDocumentForBase,
} from "../document-storage";
import type { EditorStateReadWrite } from "../state-impl";
import { syncPoweredEntityCollection } from "./powered-collection";
import type { EditorActionsContext } from "./types";

type EditorDocumentActions = Pick<EditorAction, "loadLatestBaseDocument">;

export function createEditorDocumentActions({
  document,
  state,
  workspace,
}: EditorActionsContext): EditorDocumentActions {
  return {
    loadLatestBaseDocument: async (baseId) => {
      if (!workspace.registry.baseDefinitions.some((definition) => definition.id === baseId)) {
        return false;
      }

      const latestDocument = await resolveLatestWorldDocumentForBase({
        baseId,
        latestDocumentIdByBaseId: state.internalPersistState.latestDocumentIdByBaseId,
      });
      const nextDocument = latestDocument ?? createWorldDocument({ baseId });

      resetDocumentRuntimeState(state);
      const committedDocument = document.setSnapshot(nextDocument);
      syncPoweredEntityCollection({
        document: committedDocument,
        state,
        workspace,
      });

      return true;
    },
  };
}

function resetDocumentRuntimeState(state: EditorStateReadWrite): void {
  state.drafts = [];
  state.marqueeGridRect = null;
  state.internalTransientState.logisticsDraft = null;
  state.internalTransientState.placementDraftSlotLinks = null;
  state.internalTransientState.placementHistoryAction = null;
  state.internalTransientState.placementValidationByEntityId = {};

  for (const collectionType of Object.values(EntityCollectionType)) {
    state.collections[collectionType].replace([]);
  }
}
