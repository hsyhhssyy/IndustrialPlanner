import type { WorldDocument, WorldEntity } from "@/domain/document/world-document";
import type { EntityDefinition } from "@/domain/registry/types/entity-definition";
import type { GridBounds } from "@/shared/geometry/grid";
import { getRotatedGridFootprint } from "@/shared/geometry/grid";

const INSPECTOR_NEIGHBORHOOD_PADDING_CELLS = 4;

interface InspectorNeighborhoodPreviewEntity {
  readonly entity: WorldEntity;
  readonly definition: EntityDefinition;
}

export interface InspectorNeighborhoodPreviewModel {
  readonly bounds: GridBounds;
  readonly entities: readonly InspectorNeighborhoodPreviewEntity[];
  readonly highlightedEntityId: string;
}

export function resolveInspectorNeighborhoodPreviewModel(options: {
  document: WorldDocument | null;
  selectedEntityId: string | null;
  entityDefinitionMap: ReadonlyMap<string, EntityDefinition>;
}): InspectorNeighborhoodPreviewModel | null {
  if (options.document === null || options.selectedEntityId === null) {
    return null;
  }

  const highlightedEntity = options.document.entities[options.selectedEntityId];

  if (highlightedEntity === undefined) {
    return null;
  }

  const highlightedDefinition = options.entityDefinitionMap.get(highlightedEntity.definitionId);

  if (highlightedDefinition === undefined) {
    return null;
  }

  const highlightedFootprint = getRotatedGridFootprint(
    highlightedDefinition.footprint,
    highlightedEntity.rotation,
  );
  const bounds = {
    left: highlightedEntity.position.x - INSPECTOR_NEIGHBORHOOD_PADDING_CELLS,
    top: highlightedEntity.position.y - INSPECTOR_NEIGHBORHOOD_PADDING_CELLS,
    width: highlightedFootprint.width + INSPECTOR_NEIGHBORHOOD_PADDING_CELLS * 2,
    height: highlightedFootprint.height + INSPECTOR_NEIGHBORHOOD_PADDING_CELLS * 2,
  };
  const entities = options.document.entityOrder
    .map((entityId) => options.document?.entities[entityId])
    .filter((entity): entity is WorldEntity => entity !== undefined)
    .map((entity) => {
      const definition = options.entityDefinitionMap.get(entity.definitionId);

      if (definition === undefined) {
        return null;
      }

      return { entity, definition } satisfies InspectorNeighborhoodPreviewEntity;
    })
    .filter((entry): entry is InspectorNeighborhoodPreviewEntity => entry !== null)
    .filter((entry) => doesEntityOverlapBounds(entry.entity, entry.definition, bounds));

  if (!entities.some((entry) => entry.entity.id === highlightedEntity.id)) {
    entities.push({
      entity: highlightedEntity,
      definition: highlightedDefinition,
    });
  }

  return {
    bounds,
    entities,
    highlightedEntityId: highlightedEntity.id,
  };
}

function doesEntityOverlapBounds(
  entity: WorldEntity,
  definition: EntityDefinition,
  bounds: GridBounds,
): boolean {
  const footprint = getRotatedGridFootprint(definition.footprint, entity.rotation);
  const entityRight = entity.position.x + footprint.width;
  const entityBottom = entity.position.y + footprint.height;
  const boundsRight = bounds.left + bounds.width;
  const boundsBottom = bounds.top + bounds.height;

  return entity.position.x < boundsRight
    && entityRight > bounds.left
    && entity.position.y < boundsBottom
    && entityBottom > bounds.top;
}