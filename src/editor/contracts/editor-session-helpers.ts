import type { WorldDocument } from "@/domain/document/world-document";
import type { EditorSession } from "@/editor/contracts/editor-session";
import {
  isMarqueeInteractionMode,
  isMoveInteractionMode,
  isPlacementInteractionMode,
} from "@/editor/contracts/interaction-mode";
import type { MarqueeDraftState } from "@/editor/contracts/marquee-draft";
import type { MoveDraftState } from "@/editor/contracts/move-draft";
import type { PlacementPreviewState } from "@/editor/contracts/placement-preview";

export const PLACEMENT_PREVIEW_DRAFT_ID = "draft:placement-preview";

export function createMoveDraftId(entityId: string): string {
  return `draft:move:${entityId}`;
}

export function isManagedDraftId(id: string): boolean {
  return id === PLACEMENT_PREVIEW_DRAFT_ID || id.startsWith("draft:move:");
}

export function getSelectedEntityIds(session: EditorSession): string[] {
  return session.selectedEntities?.ids ?? [];
}

export function getManagedPlacementPreview(
  session: EditorSession,
): PlacementPreviewState | null {
  if (!isPlacementInteractionMode(session.currentMode)) {
    return null;
  }

  const previewDraft = Object.values(session.drafts.entities).find(
    (draftEntity) => draftEntity.id === PLACEMENT_PREVIEW_DRAFT_ID,
  );

  if (!previewDraft || previewDraft.sourceEntityId !== null) {
    return null;
  }

  return {
    definitionId: previewDraft.definitionId,
    interactionMode: session.currentMode.inputMode,
    gridPoint: {
      ...previewDraft.position,
    },
    rotation: previewDraft.rotation,
    valid: previewDraft.valid,
  };
}

export function getManagedMoveDraft(
  session: EditorSession,
  document: WorldDocument,
): MoveDraftState | null {
  const moveMode = session.currentMode;

  if (!isMoveInteractionMode(moveMode) || !session.draftEntities) {
    return null;
  }

  const entities = session.draftEntities.ids
    .map((id) => session.drafts.entities[id])
    .filter((draftEntity) => Boolean(draftEntity?.sourceEntityId))
    .map((draftEntity) => {
      const sourceEntity = draftEntity?.sourceEntityId
        ? document.entities[draftEntity.sourceEntityId]
        : null;

      if (!draftEntity || !draftEntity.sourceEntityId || !sourceEntity) {
        return null;
      }

      return {
        entityId: draftEntity.sourceEntityId,
        originGridPoint: {
          ...sourceEntity.position,
        },
        gridPoint: {
          ...draftEntity.position,
        },
        originRotation: sourceEntity.rotation,
        rotation: draftEntity.rotation,
      };
    })
    .filter((entity): entity is NonNullable<typeof entity> => entity !== null);

  const anchorEntity = entities.find(
    (entity) => entity.entityId === moveMode.entityId,
  );

  if (entities.length === 0 || entities.length !== session.draftEntities.ids.length || !anchorEntity) {
    return null;
  }

  return {
    entityId: moveMode.entityId,
    interactionMode: moveMode.inputMode,
    originGridPoint: {
      ...anchorEntity.originGridPoint,
    },
    gridPoint: {
      ...anchorEntity.gridPoint,
    },
    rotation: anchorEntity.rotation,
    valid: entities.every((entity) => {
      const draftId = createMoveDraftId(entity.entityId);
      return session.drafts.entities[draftId]?.valid ?? false;
    }),
    rotationCenterCells: session.draftEntities.geometricCenterCellsDerived
      ? {
          ...session.draftEntities.geometricCenterCellsDerived,
        }
      : undefined,
    anchorWorldOffset: {
      ...moveMode.anchorWorldOffset,
    },
    entities,
  };
}

export function getManagedMarqueeDraft(
  session: EditorSession,
): MarqueeDraftState | null {
  if (!isMarqueeInteractionMode(session.currentMode) || !session.marqueeRange) {
    return null;
  }

  return {
    interactionMode: session.currentMode.inputMode,
    selectionMode: session.currentMode.selectionMode,
    originGridPoint: {
      ...session.marqueeRange.originGridPoint,
    },
    gridPoint: {
      ...session.marqueeRange.gridPoint,
    },
    bounds: {
      ...session.marqueeRange.bounds,
    },
    entityIds: [...(session.draftEntities?.ids ?? [])],
    baseSelection: [...getSelectedEntityIds(session)],
  };
}