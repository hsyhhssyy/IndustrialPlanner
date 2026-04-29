import type { EditorAction } from "@/domain/action/editor-action";
import type { DraftEntity } from "../draft-entity";
import { EntityCollectionType } from "@/domain/state/types";

import type { EditorActionsContext } from "./types";

type EditorPlacementActions = Pick<
  EditorAction,
  "createSinglePlacementDraft" | "applyPlacementDraft" | "cancelPlacementDraft"
>;

export function createEditorPlacementActions({
  document,
  state,
  workspace,
}: EditorActionsContext): EditorPlacementActions {
  const resolveCollection = (collectionType: EntityCollectionType) =>
    state.collections[collectionType];

  let placementDraftCounter = 0;

  return {
    createSinglePlacementDraft: (deviceDefinitionId: string) => {
      const definition = workspace.registry.entityDefinitions.find(
        (def) => def.id === deviceDefinitionId,
      );

      if (definition === undefined) {
        return;
      }

      const currentDocument = document.getSnapshot();
      const preview = resolveCollection(EntityCollectionType.preview);
      const reservedIds = new Set<string>([
        ...Object.keys(currentDocument.entities),
        ...state.drafts.map((entity) => entity.id),
      ]);

      const nextDraftId = generatePlacementDraftId(
        deviceDefinitionId,
        ++placementDraftCounter,
        reservedIds,
      );

      const draft: DraftEntity = {
        id: nextDraftId,
        definitionId: deviceDefinitionId,
        position: { x: 0, y: 0 },
        rotation: 0,
        config: {},
        tags: [],
        originalEntityId: nextDraftId,
      };

      state.drafts = replacePreviewDrafts({
        drafts: state.drafts,
        previewDraftIds: preview,
        nextPreviewDrafts: [draft],
      });
      preview.replace([draft.id]);
    },

    applyPlacementDraft: () => {
      const currentDocument = document.getSnapshot();
      const previewDrafts = resolvePreviewDrafts({
        previewDraftIds: resolveCollection(EntityCollectionType.preview),
        drafts: state.drafts,
      });
      const nextEntities = { ...currentDocument.entities };
      const nextEntityOrder = [...currentDocument.entityOrder];

      for (const draft of previewDrafts) {
        nextEntities[draft.id] = {
          id: draft.id,
          definitionId: draft.definitionId,
          position: { ...draft.position },
          rotation: draft.rotation,
          config: { ...draft.config },
          tags: [...draft.tags],
        };
        nextEntityOrder.push(draft.id);
      }

      document.setSnapshot({
        ...currentDocument,
        entities: nextEntities,
        entityOrder: nextEntityOrder,
      });

      clearPlacementState(state);
      return true;
    },

    cancelPlacementDraft: () => {
      clearPlacementState(state);
    },
  };
}

function clearPlacementState(state: EditorActionsContext["state"]): void {
  const preview = state.collections[EntityCollectionType.preview];
  const previewDraftIds = [...preview];

  state.drafts = state.drafts.filter((entity) => !previewDraftIds.includes(entity.id));
  preview.replace([]);
}

function replacePreviewDrafts(options: {
  drafts: readonly DraftEntity[];
  previewDraftIds: readonly string[];
  nextPreviewDrafts: readonly DraftEntity[];
}): DraftEntity[] {
  const previewDraftIdSet = new Set(options.previewDraftIds);

  return [
    ...options.drafts.filter((entity) => !previewDraftIdSet.has(entity.id)),
    ...options.nextPreviewDrafts,
  ];
}

function resolvePreviewDrafts(options: {
  previewDraftIds: readonly string[];
  drafts: readonly DraftEntity[];
}): DraftEntity[] {
  const draftMap = new Map(options.drafts.map((entity) => [entity.id, entity]));
  const previewDrafts: DraftEntity[] = [];

  for (const draftId of options.previewDraftIds) {
    const draft = draftMap.get(draftId);

    if (draft === undefined) {
      continue;
    }

    previewDrafts.push(draft);
  }

  return previewDrafts;
}

function generatePlacementDraftId(
  definitionId: string,
  counter: number,
  reservedIds: Set<string>,
): string {
  const baseId = `placement-draft:${definitionId}`;
  let nextId = `${baseId}:${counter}`;

  while (reservedIds.has(nextId)) {
    nextId = `${baseId}:${++counter}`;
  }

  reservedIds.add(nextId);
  return nextId;
}
