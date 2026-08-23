import type { ActiveTool, UiState } from "@/domain/app/types/app-types";
import type { WorldEntity } from "@/domain/document/world-document";
import type { GridRect } from "@/domain/shared/grid";
import type { EntityDefinition } from "@/domain/registry/types/entity-definition";
import {
  areGridRectsIntersecting,
  resolveEntityGridRect,
  resolvePowerRangeGridRect,
} from "@/shared/geometry/power-range";

export interface PowerInteractionVisualState {
  /** null 表示不按交互过滤，沿用全部供电桩候选。 */
  readonly visiblePowerRangeEntityIds: ReadonlySet<string> | null;
  readonly highlightedEntityIds: ReadonlySet<string>;
}

export function resolvePowerInteractionVisualState(options: {
  alwaysShowPowerRange: boolean;
  activeTool: ActiveTool;
  moveKind: UiState["moveKind"];
  entities: readonly WorldEntity[];
  previewEntityIds: readonly string[];
  ghostEntityIds: readonly string[];
  entityDefinitionMap: ReadonlyMap<string, EntityDefinition>;
  listPowerRangeProvidersCoveringGridRect: (gridRect: GridRect) => readonly WorldEntity[];
}): PowerInteractionVisualState {
  if (options.alwaysShowPowerRange) {
    return {
      visiblePowerRangeEntityIds: null,
      highlightedEntityIds: new Set(),
    };
  }

  if (!isSingleEntityPowerInteractionMode(options.activeTool, options.moveKind)
    || options.previewEntityIds.length !== 1) {
    return createEmptyPowerInteractionVisualState();
  }

  const previewEntityId = options.previewEntityIds[0];
  const previewEntity = options.entities.find((entity) => entity.id === previewEntityId);
  if (previewEntity === undefined) {
    return createEmptyPowerInteractionVisualState();
  }

  const previewDefinition = options.entityDefinitionMap.get(previewEntity.definitionId);
  if (previewDefinition === undefined) {
    return createEmptyPowerInteractionVisualState();
  }

  const previewPowerRangeGridRect = resolvePowerRangeGridRect({
    entity: previewEntity,
    definition: previewDefinition,
  });
  if (previewPowerRangeGridRect !== null) {
    return resolvePowerProviderPreviewVisualState({
      previewEntity,
      previewPowerRangeGridRect,
      entities: options.entities,
      excludedEntityIds: new Set([
        ...options.previewEntityIds,
        ...options.ghostEntityIds,
      ]),
      entityDefinitionMap: options.entityDefinitionMap,
    });
  }

  if (!previewDefinition.requiresPower) {
    return createEmptyPowerInteractionVisualState();
  }

  const previewGridRect = resolveEntityGridRect({
    entity: previewEntity,
    definition: previewDefinition,
  });
  const excludedEntityIds = new Set([
    ...options.previewEntityIds,
    ...options.ghostEntityIds,
  ]);
  const providerEntityIds = options.listPowerRangeProvidersCoveringGridRect(previewGridRect)
    .flatMap((entity) => excludedEntityIds.has(entity.id) ? [] : [entity.id]);
  const providerEntityIdSet = new Set(providerEntityIds);

  return {
    visiblePowerRangeEntityIds: providerEntityIdSet,
    highlightedEntityIds: providerEntityIdSet,
  };
}

function resolvePowerProviderPreviewVisualState(options: {
  previewEntity: WorldEntity;
  previewPowerRangeGridRect: GridRect;
  entities: readonly WorldEntity[];
  excludedEntityIds: ReadonlySet<string>;
  entityDefinitionMap: ReadonlyMap<string, EntityDefinition>;
}): PowerInteractionVisualState {
  const highlightedEntityIds = options.entities.flatMap((entity) => {
    if (options.excludedEntityIds.has(entity.id)) {
      return [];
    }

    const definition = options.entityDefinitionMap.get(entity.definitionId);
    if (definition === undefined || definition.powerDemand <= 0) {
      return [];
    }

    const entityGridRect = resolveEntityGridRect({
      entity,
      definition,
    });

    return areGridRectsIntersecting(entityGridRect, options.previewPowerRangeGridRect)
      ? [entity.id]
      : [];
  });

  return {
    visiblePowerRangeEntityIds: new Set([options.previewEntity.id]),
    highlightedEntityIds: new Set(highlightedEntityIds),
  };
}

function isSingleEntityPowerInteractionMode(
  activeTool: ActiveTool,
  moveKind: UiState["moveKind"],
): boolean {
  return activeTool === "single-placement"
    || (activeTool === "move" && moveKind === "ordinary");
}

function createEmptyPowerInteractionVisualState(): PowerInteractionVisualState {
  return {
    visiblePowerRangeEntityIds: new Set(),
    highlightedEntityIds: new Set(),
  };
}
