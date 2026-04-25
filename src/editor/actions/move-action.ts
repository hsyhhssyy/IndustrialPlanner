import type { EditorAction } from "@/domain/action/editor-action";
import type { WorldEntity } from "@/domain/entity/world-document";
import { EntityCollectionType } from "@/domain/state/types";

import {
  type DraftEntity,
  isDraftEntity,
} from "../draft-entity";
import { resolveEntityById } from "../entity-resolvers";
import type { EditorActionsContext } from "./types";

type EditorMoveActions = Pick<
  EditorAction,
  "applyMoveOerationDraft" | "cancelMoveOperationDraft" | "createMoveOperationDraft"
>;

export function createEditorMoveActions({
  document,
  state,
}: EditorActionsContext): EditorMoveActions {
  const resolveCollection = (collectionType: EntityCollectionType) =>
    state.collections[collectionType];

  return {
    createMoveOperationDraft: () => {
      const currentDocument = document.getSnapshot();
      const selection = resolveCollection(EntityCollectionType.selection);
      const preview = resolveCollection(EntityCollectionType.preview);
      const ghost = resolveCollection(EntityCollectionType.ghost);
      const nextGhostEntityIds: string[] = [];
      const nextPreviewDrafts: DraftEntity[] = [];
      const seenOriginalEntityIds = new Set<string>();
      const reservedIds = new Set<string>([
        ...Object.keys(currentDocument.entities),
        ...state.drafts.map((entity) => entity.id),
      ]);

      for (const entityId of selection) {
        const entity = resolveEntityById({
          entityId,
          document: currentDocument,
          drafts: state.drafts,
        });

        if (entity === null) {
          continue;
        }

        const originalEntityId = resolveOriginalEntityId(entity);

        if (seenOriginalEntityIds.has(originalEntityId)) {
          continue;
        }

        seenOriginalEntityIds.add(originalEntityId);
        nextGhostEntityIds.push(originalEntityId);
        nextPreviewDrafts.push(
          createMoveOperationDraftEntity({
            entity,
            originalEntityId,
            reservedIds,
          }),
        );
      }

      state.drafts = replacePreviewDrafts({
        drafts: state.drafts,
        previewDraftIds: preview,
        nextPreviewDrafts,
      });
      selection.replace([]);
      ghost.replace(nextGhostEntityIds);
      preview.replace(nextPreviewDrafts.map((entity) => entity.id));
    },
    applyMoveOerationDraft: () => {
      const currentDocument = document.getSnapshot();
      const ghostEntityIds = new Set(resolveCollection(EntityCollectionType.ghost));
      const previewDrafts = resolvePreviewDrafts({
        previewDraftIds: resolveCollection(EntityCollectionType.preview),
        drafts: state.drafts,
      });
      const nextEntities = { ...currentDocument.entities };
      let didUpdateDocument = false;

      for (const draft of previewDrafts) {
        if (!ghostEntityIds.has(draft.originalEntityId)) {
          continue;
        }

        const currentEntity = currentDocument.entities[draft.originalEntityId];

        if (currentEntity === undefined) {
          continue;
        }

        nextEntities[draft.originalEntityId] = {
          ...currentEntity,
          position: {
            ...draft.position,
          },
          rotation: draft.rotation,
        };
        didUpdateDocument = true;
      }

      if (didUpdateDocument) {
        document.setSnapshot({
          ...currentDocument,
          entities: nextEntities,
        });
      }

      clearMoveOperationState(state);
      return true;
    },
    cancelMoveOperationDraft: () => {
      clearMoveOperationState(state);
    },
  };
}

function clearMoveOperationState(state: EditorActionsContext["state"]): void {
  const preview = state.collections[EntityCollectionType.preview];
  const ghost = state.collections[EntityCollectionType.ghost];
  const previewDraftIds = [...preview];

  state.drafts = state.drafts.filter((entity) => !previewDraftIds.includes(entity.id));
  preview.replace([]);
  ghost.replace([]);
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

function resolveOriginalEntityId(entity: WorldEntity | DraftEntity): string {
  return isDraftEntity(entity) ? entity.originalEntityId : entity.id;
}

function createMoveOperationDraftEntity(options: {
  entity: WorldEntity | DraftEntity;
  originalEntityId: string;
  reservedIds: Set<string>;
}): DraftEntity {
  return {
    ...cloneEntity(options.entity),
    id: createMoveOperationDraftId(options.originalEntityId, options.reservedIds),
    originalEntityId: options.originalEntityId,
  };
}

function createMoveOperationDraftId(originalEntityId: string, reservedIds: Set<string>): string {
  const baseId = `move-draft:${originalEntityId}`;
  let nextId = baseId;
  let suffix = 1;

  while (reservedIds.has(nextId)) {
    nextId = `${baseId}:${suffix}`;
    suffix += 1;
  }

  reservedIds.add(nextId);
  return nextId;
}

function cloneEntity(entity: WorldEntity | DraftEntity): WorldEntity {
  return {
    ...entity,
    position: {
      ...entity.position,
    },
    config: {
      ...entity.config,
    },
    tags: [...entity.tags],
  };
}