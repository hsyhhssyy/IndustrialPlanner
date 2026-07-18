import { createWorldDocument, type WorldDocument } from "@/domain/document/world-document";
import type { EditorAction } from "@/domain/editor/editor-action";
import { EntityCollectionType } from "@/domain/editor/types/editor-types";

import {
  resolveLatestWorldDocumentForBase,
} from "../document-storage";
import { ensureProtocolCoreEntity } from "../ensure-protocol-core";
import type { EditorStateReadWrite } from "../state-impl";
import { action, runInAction } from "mobx";
import type { EditorActionsContext } from "./types";

type EditorDocumentActions = Pick<EditorAction, "loadLatestBaseDocument" | "writeDocumentSettings">;

export function createEditorDocumentActions({
  document,
  documentWriter,
  state,
  workspace,
}: EditorActionsContext): EditorDocumentActions {
  return {
    loadLatestBaseDocument: action(async (baseId) => {
      if (!workspace.registry.baseDefinitions.some((definition) => definition.id === baseId)) {
        return false;
      }

      const latestDocument = await resolveLatestWorldDocumentForBase({
        baseId,
        latestDocumentIdByBaseId: state.internalPersistState.latestDocumentIdByBaseId,
      });
      const nextDocument = ensureProtocolCoreEntity({
        document: latestDocument ?? createWorldDocument({ baseId }),
        queries: workspace.registry.queries,
      });

      runInAction(() => {
        resetDocumentRuntimeState(state);
        document.setSnapshot(nextDocument);
      });

      return true;
    }),

    writeDocumentSettings: (patch) => {
      const currentDocument = document.getSnapshot();
      const nextDocument: WorldDocument = {
        ...currentDocument,
        documentSettings: {
          ...currentDocument.documentSettings,
          ...patch,
        },
      };

      if (nextDocument.documentSettings === currentDocument.documentSettings) {
        return;
      }

      documentWriter.setSnapshot(nextDocument, { mode: "silent" });
    },
  };
}

function resetDocumentRuntimeState(state: EditorStateReadWrite): void {
  state.drafts = [];
  state.marqueeGridRect = null;
  state.internalTransientState.logisticsDraft = null;
  state.internalTransientState.logisticsDeviceRouteCycleSignature = null;
  state.internalTransientState.logisticsDeviceRouteCycleIndex = 0;
  state.internalTransientState.convergerEntityGridKey = null;
  state.internalTransientState.placementDraftSlotLinks = null;
  state.internalTransientState.placementDraftEntityIdMap = null;
  state.internalTransientState.placementHistoryAction = null;
  state.internalTransientState.placementValidationByEntityId = {};

  for (const collectionType of Object.values(EntityCollectionType)) {
    state.collections[collectionType].replace([]);
  }
}
