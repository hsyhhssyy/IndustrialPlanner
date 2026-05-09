import type { BlueprintDocument } from "@/domain/document/blueprint-document";
import type { SlotLinkDefinition, WorldEntity } from "@/domain/document/world-document";
import type { EditorAction } from "@/domain/editor/editor-action";
import type { DraftEntity } from "../draft-entity";
import { EntityCollectionType } from "@/domain/editor/types/editor-types";
import type { GridPoint, GridRectSize } from "@/domain/shared/grid";
import { createUuid } from "@/domain/shared/uuid";

import type { EditorActionsContext } from "./types";

type EditorPlacementActions = Pick<
  EditorAction,
  | "createSinglePlacementDraft"
  | "createBlueprintPlacementDraft"
  | "applyPlacementDraft"
  | "cancelPlacementDraft"
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
    createSinglePlacementDraft: (
      deviceDefinitionId: string,
      centerGridPoint: GridPoint,
    ) => {
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
        position: resolvePlacementDraftPosition({
          centerGridPoint,
          footprint: definition.footprint,
        }),
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
      state.internalTransientState.placementDraftSlotLinks = null;
    },

    createBlueprintPlacementDraft: (
      blueprint: BlueprintDocument,
      centerGridPoint: GridPoint,
    ) => {
      const currentDocument = document.getSnapshot();
      const preview = resolveCollection(EntityCollectionType.preview);
      const reservedIds = new Set<string>([
        ...Object.keys(currentDocument.entities),
        ...state.drafts.map((entity) => entity.id),
      ]);
      const placementVector = {
        x: centerGridPoint.x - blueprint.initialGridPoint.x,
        y: centerGridPoint.y - blueprint.initialGridPoint.y,
      };
      const nextPreviewDrafts: DraftEntity[] = [];
      const entityIdMap = new Map<string, string>();

      for (const entityId of blueprint.entityOrder) {
        const entity = blueprint.entities[entityId];

        if (entity === undefined) {
          continue;
        }

        const draftId = generatePlacementDraftId(
          entity.definitionId,
          ++placementDraftCounter,
          reservedIds,
        );

        entityIdMap.set(entity.id, draftId);
        nextPreviewDrafts.push({
          ...cloneWorldEntity(entity),
          id: draftId,
          originalEntityId: draftId,
          position: {
            x: entity.position.x + placementVector.x,
            y: entity.position.y + placementVector.y,
          },
        });
      }

      state.drafts = replacePreviewDrafts({
        drafts: state.drafts,
        previewDraftIds: preview,
        nextPreviewDrafts,
      });
      preview.replace(nextPreviewDrafts.map((draft) => draft.id));
      state.internalTransientState.placementDraftSlotLinks = blueprint.slotLinks.flatMap((slotLink) => {
        const sourceEntityId = entityIdMap.get(slotLink.source.entityId);
        const targetEntityId = entityIdMap.get(slotLink.target.entityId);

        if (sourceEntityId === undefined || targetEntityId === undefined) {
          return [];
        }

        return [{
          ...cloneSlotLinkDefinition(slotLink),
          id: createUuid(),
          source: {
            ...slotLink.source,
            entityId: sourceEntityId,
          },
          target: {
            ...slotLink.target,
            entityId: targetEntityId,
          },
        } satisfies SlotLinkDefinition];
      });
    },

    applyPlacementDraft: () => {
      const currentDocument = document.getSnapshot();
      const previewDrafts = resolvePreviewDrafts({
        previewDraftIds: resolveCollection(EntityCollectionType.preview),
        drafts: state.drafts,
      });
      const nextEntities = { ...currentDocument.entities };
      const nextEntityOrder = [...currentDocument.entityOrder];
      const nextSlotLinks = [...currentDocument.slotLinks];

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

      if (state.internalTransientState.placementDraftSlotLinks !== null) {
        nextSlotLinks.push(
          ...state.internalTransientState.placementDraftSlotLinks.map(cloneSlotLinkDefinition),
        );
      }

      document.setSnapshot({
        ...currentDocument,
        entities: nextEntities,
        entityOrder: nextEntityOrder,
        slotLinks: nextSlotLinks,
      });

      clearPlacementState(state);
      return true;
    },

    cancelPlacementDraft: () => {
      clearPlacementState(state);
    },
  };
}

function resolvePlacementDraftPosition(options: {
  centerGridPoint: GridPoint;
  footprint: GridRectSize;
}): GridPoint {
  const centerOffset = {
    x: resolvePlacementCenterOffset(options.footprint.width),
    y: resolvePlacementCenterOffset(options.footprint.height),
  };

  return {
    x: options.centerGridPoint.x - centerOffset.x,
    y: options.centerGridPoint.y - centerOffset.y,
  };
}

function resolvePlacementCenterOffset(size: number): number {
  return Math.floor((size - 1) / 2);
}

function clearPlacementState(state: EditorActionsContext["state"]): void {
  const preview = state.collections[EntityCollectionType.preview];
  const previewDraftIds = [...preview];

  state.drafts = state.drafts.filter((entity) => !previewDraftIds.includes(entity.id));
  preview.replace([]);
  state.internalTransientState.placementDraftSlotLinks = null;
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

function cloneWorldEntity(entity: WorldEntity): WorldEntity {
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

function cloneSlotLinkDefinition(slotLink: SlotLinkDefinition): SlotLinkDefinition {
  return {
    ...slotLink,
    source: {
      ...slotLink.source,
    },
    target: {
      ...slotLink.target,
    },
  };
}
