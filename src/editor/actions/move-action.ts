import type { EditorAction } from "@/domain/editor/editor-action";
import { action } from "mobx";
import type { WorldEntity } from "@/domain/document/world-document";
import { EntityCollectionType } from "@/domain/editor/types/editor-types";

import {
  type DraftEntity,
  isDraftEntity,
} from "../draft-entity";
import { cloneEntityConfig } from "../entity-config-clone";
import { resolveEntityById } from "../entity-resolvers";
import {
  resolveOutsideBasePlacementEntityIds,
  syncPlacementValidationState,
} from "../placement-validation";
import type { EditorActionsContext } from "./types";

type EditorMoveActions = Pick<
  EditorAction,
  "applyMoveOerationDraft" | "cancelMoveOperationDraft" | "createMoveOperationDraft"
>;

export function createEditorMoveActions({
  document,
  documentWriter,
  state,
  workspace,
}: EditorActionsContext): EditorMoveActions {
  const resolveCollection = (collectionType: EntityCollectionType) =>
    state.collections[collectionType];

  return {
    createMoveOperationDraft: action(() => {
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
      ghost.replace(nextGhostEntityIds);
      preview.replace(nextPreviewDrafts.map((entity) => entity.id));
      syncPlacementValidationState({
        document: currentDocument,
        state,
        workspace,
      });
    }),
    applyMoveOerationDraft: action(() => {
      const currentDocument = document.getSnapshot();
      const selection = resolveCollection(EntityCollectionType.selection);
      const ghostEntityIds = new Set(resolveCollection(EntityCollectionType.ghost));
      const previewDrafts = resolvePreviewDrafts({
        previewDraftIds: resolveCollection(EntityCollectionType.preview),
        drafts: state.drafts,
      });

      const outsideBaseDraftIds = resolveOutsideBasePlacementEntityIds({
        document: currentDocument,
        entityIds: previewDrafts.map((draft) => draft.id),
        state,
        workspace,
      });
      const movablePreviewDrafts = previewDrafts.filter(
        (draft) => !outsideBaseDraftIds.has(draft.id),
      );
      if (movablePreviewDrafts.length === 0) {
        return false;
      }

      /*
        AI-REMOVED 2026-08-23:
        Reason: 原逻辑让任一受限设备阻断整个框选移动，无法在规则冲突时保留非法设备原位并移动合法设备。
        Trigger: 用户要求框选移动与蓝图放置采用一致的合法子集提交语义。
        Evidence: move preview 已逐实体校验，ghost 原实体会在未提交时自然保留原位。
        Replacement: 上方 outsideBaseDraftIds + movablePreviewDrafts。
        Risk: Medium；多选移动可能只移动部分设备，历史记录必须只包含实际移动成员。
        Human Review: Required

        Original code:
        if (hasOutsideBasePlacementReason({
          document: currentDocument,
          entityIds: previewDrafts.map((draft) => draft.id),
          state,
          workspace,
        })) {
          return false;
        }
      */

      const nextEntities = { ...currentDocument.entities };
      const definitionChangedEntityIds = new Set<string>();
      let didUpdateDocument = false;

      for (const draft of movablePreviewDrafts) {
        if (!ghostEntityIds.has(draft.originalEntityId)) {
          continue;
        }

        const currentEntity = currentDocument.entities[draft.originalEntityId];

        if (currentEntity === undefined) {
          continue;
        }

        nextEntities[draft.originalEntityId] = {
          ...currentEntity,
          definitionId: draft.definitionId,
          position: {
            ...draft.position,
          },
          rotation: draft.rotation,
          config: cloneEntityConfig(draft.config),
        };
        if (currentEntity.definitionId !== draft.definitionId) {
          definitionChangedEntityIds.add(draft.originalEntityId);
        }
        didUpdateDocument = true;
      }

      if (didUpdateDocument) {
        documentWriter.commit({
          action: {
            type: "entity.move",
            label: "移动设备",
            entityIds: movablePreviewDrafts.map((draft) => draft.originalEntityId),
            definitionIds: resolveUniqueStrings(
              movablePreviewDrafts.map((draft) => draft.definitionId),
            ),
            count: movablePreviewDrafts.length,
          },
          update: (documentSnapshot) => ({
            ...documentSnapshot,
            entities: nextEntities,
            slotLinks: definitionChangedEntityIds.size === 0
              ? documentSnapshot.slotLinks
              : documentSnapshot.slotLinks.filter((slotLink) =>
                !definitionChangedEntityIds.has(slotLink.source.entityId)
                && !definitionChangedEntityIds.has(slotLink.target.entityId),
              ),
          }),
        });

      }

      clearMoveOperationState(state);
      syncPlacementValidationState({
        document: document.getSnapshot(),
        state,
        workspace,
      });

      if (ghostEntityIds.size === 1) {
        selection.replace([]);
      }

      return true;
    }),
    cancelMoveOperationDraft: action(() => {
      clearMoveOperationState(state);
      syncPlacementValidationState({
        document: document.getSnapshot(),
        state,
        workspace,
      });
    }),
  };
}

function resolveUniqueStrings(values: readonly string[]): string[] {
  return Array.from(new Set(values));
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
    config: cloneEntityConfig(entity.config),
    tags: [...entity.tags],
  };
}
