import {
  getStage1EntityDefinition,
  type Stage1EntityDefinition,
} from "@/domain/registry/stage1-registry";
import type { DraftEntityState } from "@/editor/contracts/entity-collection";
import { getLocalizedStage1EntityName } from "@/i18n/stage1-registry";
import type {
  RenderExplicitLink,
  RenderEntitySprite,
  RenderMovePreview,
  RenderPlacementPreview,
  RenderSceneInput,
  RenderSceneModel,
} from "@/renderer/scene/types";
import {
  getStage1EntityRenderKind,
  getStage1EntitySpritePath,
  getStage1EntityTextureMetrics,
  shouldShowStage1EntityLabel,
} from "@/renderer/scene/stage1-device-rendering";
import { deriveRenderWorldBoundsPx } from "@/renderer/scene/render-world-bounds";
import type { GridRotation } from "@/shared/geometry/grid";
import { getRotatedGridFootprint } from "@/shared/geometry/grid";

function getSelectedWorldEntityIds(input: RenderSceneInput): string[] {
  return (
    input.interaction.selectionPresentation?.activeSelection.worldEntityIds ??
    input.interaction.selectedEntityIds
  );
}

function getManagedDraftEntities(input: RenderSceneInput): DraftEntityState[] {
  const drafts = input.interaction.drafts?.entities;
  const ids = input.interaction.draftEntities?.ids ?? [];

  if (!drafts || ids.length === 0) {
    return [];
  }

  return ids
    .map((id) => drafts[id])
    .filter((draft): draft is DraftEntityState => Boolean(draft));
}

function getManagedPlacementDraft(input: RenderSceneInput): DraftEntityState | null {
  return (
    getManagedDraftEntities(input).find(
      (draftEntity) => draftEntity.sourceEntityId === null,
    ) ?? null
  );
}

function getManagedMoveDrafts(input: RenderSceneInput): DraftEntityState[] {
  return getManagedDraftEntities(input).filter(
    (draftEntity) => draftEntity.sourceEntityId !== null,
  );
}

function getGhostedWorldEntityIds(input: RenderSceneInput): string[] {
  const managedGhostedWorldEntityIds = getManagedMoveDrafts(input)
    .map((draftEntity) => draftEntity.sourceEntityId)
    .filter((entityId): entityId is string => Boolean(entityId));

  return (
    input.interaction.selectionPresentation?.ghostedWorldEntityIds ??
    (managedGhostedWorldEntityIds.length > 0
      ? managedGhostedWorldEntityIds
      : null) ??
    input.interaction.moveDraft?.entities.map((draftEntity) => draftEntity.entityId) ??
    []
  );
}

function getEntityFill(definition: Stage1EntityDefinition): string {
  switch (definition.category) {
    case "storage":
      return "#395166";
    case "bus":
      return "#4a5b76";
    case "logistics":
      return "#4b6b53";
    case "processor":
      return "#6b503d";
    case "track":
      return "#544a72";
    case "dark-pipe":
      return "#3f6071";
    default:
      return "#263341";
  }
}

function getEntityFootprintSize(
  definition: Stage1EntityDefinition,
  rotation: GridRotation,
): {
  width: number;
  height: number;
} {
  return getRotatedGridFootprint(definition.footprint, rotation);
}

function buildEntitySprite(input: RenderSceneInput, entityId: string): RenderEntitySprite | null {
  const entity = input.document.entities[entityId];

  if (!entity) {
    return null;
  }

  const topologyView = input.topology.entityViews[entityId];
  const definition = topologyView?.definition;

  if (!definition) {
    return null;
  }

  const footprint = getEntityFootprintSize(definition, entity.rotation);
  const renderKind = getStage1EntityRenderKind(entity.definitionId);
  const textureMetrics = getStage1EntityTextureMetrics({
    definition,
    gridSize: input.document.documentSettings.gridSize,
    rotation: entity.rotation,
  });

  return {
    entityId,
    definitionId: entity.definitionId,
    label: getLocalizedStage1EntityName(input.locale, definition),
    x: entity.position.x * input.document.documentSettings.gridSize,
    y: entity.position.y * input.document.documentSettings.gridSize,
    width: footprint.width * input.document.documentSettings.gridSize,
    height: footprint.height * input.document.documentSettings.gridSize,
    rotation: entity.rotation,
    renderKind,
    fill: getEntityFill(definition),
    textureSrc: getStage1EntitySpritePath(entity.definitionId),
    textureWidth: textureMetrics.textureWidthPx,
    textureHeight: textureMetrics.textureHeightPx,
    textureCenterOffsetX: textureMetrics.centerOffsetXPx,
    textureCenterOffsetY: textureMetrics.centerOffsetYPx,
    showLabel: shouldShowStage1EntityLabel(definition, renderKind),
    status: "idle",
    selected: getSelectedWorldEntityIds(input).includes(entityId),
    ghosted: getGhostedWorldEntityIds(input).includes(entityId),
    pendingLinkSource:
      input.interaction.pendingLinkSourceEntityId === entityId,
    patched: false,
  };
}

function buildExplicitLinkSprites(
  input: RenderSceneInput,
): RenderExplicitLink[] {
  return input.topology.explicitLinkViews
    .map((link) => {
      const sourceView = input.topology.entityViews[link.sourceEntityId];
      const targetView = input.topology.entityViews[link.targetEntityId];
      const sourceEntity = input.document.entities[link.sourceEntityId];
      const targetEntity = input.document.entities[link.targetEntityId];

      if (!sourceView || !targetView || !sourceEntity || !targetEntity) {
        return null;
      }

      const sourceFootprint = getEntityFootprintSize(
        sourceView.definition,
        sourceEntity.rotation,
      );
      const targetFootprint = getEntityFootprintSize(
        targetView.definition,
        targetEntity.rotation,
      );

      return {
        id: link.id,
        kind: link.kind,
        x1:
          (sourceView.position.x + sourceFootprint.width / 2) *
          input.document.documentSettings.gridSize,
        y1:
          (sourceView.position.y + sourceFootprint.height / 2) *
          input.document.documentSettings.gridSize,
        x2:
          (targetView.position.x + targetFootprint.width / 2) *
          input.document.documentSettings.gridSize,
        y2:
          (targetView.position.y + targetFootprint.height / 2) *
          input.document.documentSettings.gridSize,
        selected:
          getSelectedWorldEntityIds(input).includes(link.sourceEntityId) ||
          getSelectedWorldEntityIds(input).includes(link.targetEntityId),
      };
    })
    .filter((link): link is RenderExplicitLink => link !== null);
}

function buildPlacementPreview(
  input: RenderSceneInput,
): RenderPlacementPreview | null {
  const managedPreviewDraft = getManagedPlacementDraft(input);
  const preview = managedPreviewDraft
    ? {
        definitionId: managedPreviewDraft.definitionId,
        interactionMode: input.interaction.draftInteractionMode ?? "pointer",
        gridPoint: managedPreviewDraft.position,
        rotation: managedPreviewDraft.rotation,
        valid: managedPreviewDraft.valid,
      }
    : input.interaction.placementPreview;

  if (!preview) {
    return null;
  }

  const definition = getStage1EntityDefinition(
    input.registry,
    preview.definitionId,
  );

  if (!definition) {
    return null;
  }

  const renderKind = getStage1EntityRenderKind(preview.definitionId);
  const footprint = getEntityFootprintSize(definition, preview.rotation);
  const textureMetrics = getStage1EntityTextureMetrics({
    definition,
    gridSize: input.document.documentSettings.gridSize,
    rotation: preview.rotation,
  });

  return {
    definitionId: preview.definitionId,
    interactionMode: preview.interactionMode,
    label: getLocalizedStage1EntityName(input.locale, definition),
    x: preview.gridPoint.x * input.document.documentSettings.gridSize,
    y: preview.gridPoint.y * input.document.documentSettings.gridSize,
    width: footprint.width * input.document.documentSettings.gridSize,
    height: footprint.height * input.document.documentSettings.gridSize,
    rotation: preview.rotation,
    renderKind,
    fill: getEntityFill(definition),
    textureSrc: getStage1EntitySpritePath(preview.definitionId),
    textureWidth: textureMetrics.textureWidthPx,
    textureHeight: textureMetrics.textureHeightPx,
    textureCenterOffsetX: textureMetrics.centerOffsetXPx,
    textureCenterOffsetY: textureMetrics.centerOffsetYPx,
    valid: preview.valid,
  };
}

function buildMovePreviewForEntity(
  input: RenderSceneInput,
  draftEntity: NonNullable<RenderSceneInput["interaction"]["moveDraft"]>["entities"][number],
): RenderMovePreview | null {
  const entity = input.document.entities[draftEntity.entityId];
  const definition =
    input.topology.entityViews[draftEntity.entityId]?.definition ??
    (entity
      ? getStage1EntityDefinition(input.registry, entity.definitionId)
      : undefined);

  if (!entity || !definition) {
    return null;
  }

  const renderKind = getStage1EntityRenderKind(entity.definitionId);
  const footprint = getEntityFootprintSize(definition, draftEntity.rotation);
  const textureMetrics = getStage1EntityTextureMetrics({
    definition,
    gridSize: input.document.documentSettings.gridSize,
    rotation: draftEntity.rotation,
  });

  return {
    entityId: draftEntity.entityId,
    definitionId: entity.definitionId,
    interactionMode: input.interaction.moveDraft?.interactionMode ?? "pointer",
    label: getLocalizedStage1EntityName(input.locale, definition),
    x: draftEntity.gridPoint.x * input.document.documentSettings.gridSize,
    y: draftEntity.gridPoint.y * input.document.documentSettings.gridSize,
    width: footprint.width * input.document.documentSettings.gridSize,
    height: footprint.height * input.document.documentSettings.gridSize,
    rotation: draftEntity.rotation,
    renderKind,
    fill: getEntityFill(definition),
    textureSrc: getStage1EntitySpritePath(entity.definitionId),
    textureWidth: textureMetrics.textureWidthPx,
    textureHeight: textureMetrics.textureHeightPx,
    textureCenterOffsetX: textureMetrics.centerOffsetXPx,
    textureCenterOffsetY: textureMetrics.centerOffsetYPx,
    valid: input.interaction.moveDraft?.valid ?? true,
  };
}

function buildMovePreviewForManagedDraft(
  input: RenderSceneInput,
  draftEntity: DraftEntityState,
): RenderMovePreview | null {
  if (!draftEntity.sourceEntityId) {
    return null;
  }

  const definition = getStage1EntityDefinition(
    input.registry,
    draftEntity.definitionId,
  );

  if (!definition) {
    return null;
  }

  const renderKind = getStage1EntityRenderKind(draftEntity.definitionId);
  const footprint = getEntityFootprintSize(definition, draftEntity.rotation);
  const textureMetrics = getStage1EntityTextureMetrics({
    definition,
    gridSize: input.document.documentSettings.gridSize,
    rotation: draftEntity.rotation,
  });

  return {
    entityId: draftEntity.sourceEntityId,
    definitionId: draftEntity.definitionId,
    interactionMode: input.interaction.draftInteractionMode ?? "pointer",
    label: getLocalizedStage1EntityName(input.locale, definition),
    x: draftEntity.position.x * input.document.documentSettings.gridSize,
    y: draftEntity.position.y * input.document.documentSettings.gridSize,
    width: footprint.width * input.document.documentSettings.gridSize,
    height: footprint.height * input.document.documentSettings.gridSize,
    rotation: draftEntity.rotation,
    renderKind,
    fill: getEntityFill(definition),
    textureSrc: getStage1EntitySpritePath(draftEntity.definitionId),
    textureWidth: textureMetrics.textureWidthPx,
    textureHeight: textureMetrics.textureHeightPx,
    textureCenterOffsetX: textureMetrics.centerOffsetXPx,
    textureCenterOffsetY: textureMetrics.centerOffsetYPx,
    valid: draftEntity.valid,
  };
}

function buildMovePreviews(
  input: RenderSceneInput,
): RenderMovePreview[] {
  const managedDrafts = getManagedMoveDrafts(input);

  if (managedDrafts.length > 0) {
    return managedDrafts
      .map((draftEntity) => buildMovePreviewForManagedDraft(input, draftEntity))
      .filter((preview): preview is RenderMovePreview => preview !== null);
  }

  const draft = input.interaction.moveDraft;

  if (!draft) {
    return [];
  }

  return draft.entities
    .map((draftEntity) => buildMovePreviewForEntity(input, draftEntity))
    .filter((preview): preview is RenderMovePreview => preview !== null);
}

export function buildRenderScene(input: RenderSceneInput): RenderSceneModel {
  const entities = input.document.entityOrder
    .map((entityId) => buildEntitySprite(input, entityId))
    .filter((entity): entity is RenderEntitySprite => entity !== null);
  const placementPreview = buildPlacementPreview(input);
  const movePreviews = buildMovePreviews(input);
  const movePreview = movePreviews[0] ?? null;
  const explicitLinks = buildExplicitLinkSprites(input);
  const worldBoundsPx = deriveRenderWorldBoundsPx({
    document: input.document,
    topology: input.topology,
    registry: input.registry,
    draftEntities: input.interaction.draftEntities,
    placementPreview: input.interaction.placementPreview,
    moveDraft: input.interaction.moveDraft,
  });

  return {
    zoom: input.canvasView.zoom,
    viewportOffset: input.canvasView.offset,
    gridSize: input.document.documentSettings.gridSize,
    worldWidth: worldBoundsPx.width,
    worldHeight: worldBoundsPx.height,
    entities,
    placementPreview,
    movePreview,
    movePreviews,
    explicitLinks,
    diagnostics: input.topology.diagnostics,
  };
}
