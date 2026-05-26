import type { EditorAction } from "@/domain/editor/editor-action";
import type { WorldEntity } from "@/domain/document/world-document";

import { syncPlacementValidationState } from "../placement-validation";
import { syncPoweredEntityCollection } from "./powered-collection";
import type { EditorActionsContext } from "./types";

type EditorDefinitionActions = Pick<EditorAction, "replaceEntityDefinition">;

export function createEditorDefinitionActions({
  document,
  documentWriter,
  state,
  workspace,
}: EditorActionsContext): EditorDefinitionActions {
  return {
    replaceEntityDefinition: (entityId, nextDefinitionId) => {
      if (!hasEntityDefinition(workspace.registry.entityDefinitions, nextDefinitionId)) {
        return false;
      }

      const currentDocument = document.getSnapshot();
      const documentEntity = currentDocument.entities[entityId];
      if (documentEntity !== undefined) {
        const committedDocument = documentWriter.commit({
          action: {
            type: "entity.definition.replace",
            label: "切换设备模式",
            detail: `${documentEntity.definitionId} -> ${nextDefinitionId}`,
            entityIds: [entityId],
            definitionIds: [documentEntity.definitionId, nextDefinitionId],
            count: 1,
          },
          update: (documentSnapshot) => ({
            ...documentSnapshot,
            entities: {
              ...documentSnapshot.entities,
              [entityId]: replaceDefinition(documentEntity, nextDefinitionId),
            },
            slotLinks: documentSnapshot.slotLinks.filter((slotLink) =>
              slotLink.source.entityId !== entityId
              && slotLink.target.entityId !== entityId,
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

        syncPlacementValidationState({
          document: committedDocument ?? document.getSnapshot(),
          state,
          workspace,
        });
        return committedDocument !== null;
      }

      let didUpdateDraft = false;
      state.drafts = state.drafts.map((draft) => {
        if (draft.id !== entityId) {
          return draft;
        }

        didUpdateDraft = true;
        return {
          ...draft,
          definitionId: nextDefinitionId,
          config: {},
        };
      });

      if (!didUpdateDraft) {
        return false;
      }

      if (state.internalTransientState.placementDraftSlotLinks !== null) {
        state.internalTransientState.placementDraftSlotLinks =
          state.internalTransientState.placementDraftSlotLinks.filter((slotLink) =>
            slotLink.source.entityId !== entityId
            && slotLink.target.entityId !== entityId,
          );
      }

      syncPlacementValidationState({
        document: currentDocument,
        state,
        workspace,
      });
      return true;
    },
  };
}

function hasEntityDefinition(
  definitions: readonly { readonly id: string }[],
  definitionId: string,
): boolean {
  return definitions.some((definition) => definition.id === definitionId);
}

function replaceDefinition(
  entity: WorldEntity,
  nextDefinitionId: string,
): WorldEntity {
  return {
    ...entity,
    definitionId: nextDefinitionId,
    config: {},
  };
}
