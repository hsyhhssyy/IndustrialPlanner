import { createWorldDocument } from "@/domain/document/world-document";
import type { WorldDocument } from "@/domain/document/world-document";
import type { EditorAction } from "@/domain/editor/editor-action";
import { EntityCollectionType } from "@/domain/editor/types/editor-types";
import type { RegistryQuery } from "@/domain/registry/registry-query";

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
      const nextDocument = ensureProtocolCoreEntity({
        document: latestDocument ?? createWorldDocument({ baseId }),
        queries: workspace.registry.queries,
      });

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

function ensureProtocolCoreEntity(options: {
  document: WorldDocument;
  queries: RegistryQuery;
}): WorldDocument {
  const hasProtocolCore = Object.values(options.document.entities)
    .some((entity) => options.queries.isProtocolCore(entity.definitionId));

  if (hasProtocolCore) {
    return options.document;
  }

  const entityId = `protocol-core:${options.document.baseId}`;

  return {
    ...options.document,
    entities: {
      ...options.document.entities,
      [entityId]: {
        id: entityId,
        definitionId: "item_port_sp_hub_1",
        position: { x: 0, y: 0 },
        rotation: 0,
        config: {},
        tags: [],
      },
    },
    entityOrder: [entityId, ...options.document.entityOrder],
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
  state.internalTransientState.placementHistoryAction = null;
  state.internalTransientState.placementValidationByEntityId = {};

  for (const collectionType of Object.values(EntityCollectionType)) {
    state.collections[collectionType].replace([]);
  }
}
