import type { Stage1EntityDefinition } from "@/domain/registry/stage1-registry";
import { getLocalizedStage1EntityName } from "@/i18n/stage1-registry";
import type {
  RenderExplicitLink,
  RenderEntitySprite,
  RenderSceneInput,
  RenderSceneModel,
} from "@/renderer/scene/types";
import {
  getStage1EntityRenderKind,
  getStage1EntitySpritePath,
  getStage1EntityTextureMetrics,
  shouldShowStage1EntityLabel,
} from "@/renderer/scene/stage1-device-rendering";

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
): {
  width: number;
  height: number;
} {
  return {
    width: definition.footprint.width,
    height: definition.footprint.height,
  };
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

  const footprint = getEntityFootprintSize(definition);
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
    status: input.runtimeSnapshot.entityViews[entityId]?.status ?? "idle",
    selected: input.activeCanvas.selectedEntityIds.includes(entityId),
    pendingLinkSource:
      input.activeCanvas.pendingLinkSourceEntityId === entityId,
    patched: input.runtimeSnapshot.patchedEntityIds.includes(entityId),
  };
}

function buildExplicitLinkSprites(
  input: RenderSceneInput,
): RenderExplicitLink[] {
  return input.topology.explicitLinkViews
    .map((link) => {
      const sourceView = input.topology.entityViews[link.sourceEntityId];
      const targetView = input.topology.entityViews[link.targetEntityId];

      if (!sourceView || !targetView) {
        return null;
      }

      return {
        id: link.id,
        kind: link.kind,
        x1:
          (sourceView.position.x + sourceView.definition.footprint.width / 2) *
          input.document.documentSettings.gridSize,
        y1:
          (sourceView.position.y + sourceView.definition.footprint.height / 2) *
          input.document.documentSettings.gridSize,
        x2:
          (targetView.position.x + targetView.definition.footprint.width / 2) *
          input.document.documentSettings.gridSize,
        y2:
          (targetView.position.y + targetView.definition.footprint.height / 2) *
          input.document.documentSettings.gridSize,
        selected:
          input.activeCanvas.selectedEntityIds.includes(link.sourceEntityId) ||
          input.activeCanvas.selectedEntityIds.includes(link.targetEntityId),
      };
    })
    .filter((link): link is RenderExplicitLink => link !== null);
}

export function buildRenderScene(input: RenderSceneInput): RenderSceneModel {
  const entities = input.document.entityOrder
    .map((entityId) => buildEntitySprite(input, entityId))
    .filter((entity): entity is RenderEntitySprite => entity !== null);
  const explicitLinks = buildExplicitLinkSprites(input);

  const maxWorldWidth = Math.max(
    1200,
    ...entities.map((entity) => entity.x + entity.width + input.document.documentSettings.gridSize * 3),
  );
  const maxWorldHeight = Math.max(
    720,
    ...entities.map((entity) => entity.y + entity.height + input.document.documentSettings.gridSize * 3),
  );

  return {
    zoom: input.canvas.viewport.zoom,
    gridSize: input.document.documentSettings.gridSize,
    worldWidth: maxWorldWidth,
    worldHeight: maxWorldHeight,
    entities,
    explicitLinks,
    diagnostics: input.topology.diagnostics,
  };
}
