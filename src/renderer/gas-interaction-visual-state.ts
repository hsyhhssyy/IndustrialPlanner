import type { ActiveTool, UiState } from "@/domain/app/types/app-types";
import type { WorldEntity } from "@/domain/document/world-document";
import type { EntityDefinition } from "@/domain/registry/types/entity-definition";
import type { RecipeDefinition } from "@/domain/registry/types/recipe-definition";
import {
  areGridRectsContaining,
  resolveEntityGridRect,
  resolveGasDiffusionRangeGridRect,
} from "@/shared/geometry/power-range";

export interface GasInteractionDefinitionIndex {
  readonly gasDependentDefinitionIds: ReadonlySet<string>;
  readonly gasDiffusionRangeByDefinitionId: ReadonlyMap<string, number>;
}

export interface GasInteractionVisualState {
  /** 气体范围始终由 GasDiffusionRangeDecoration 显示，本状态只派生设备高亮。 */
  readonly highlightedEntityIds: ReadonlySet<string>;
}

export function createGasInteractionDefinitionIndex(
  recipeDefinitions: readonly RecipeDefinition[],
): GasInteractionDefinitionIndex {
  const gasDependentDefinitionIds = new Set<string>();
  const gasDiffusionRangeByDefinitionId = new Map<string, number>();

  for (const recipe of recipeDefinitions) {
    if (typeof recipe.requiredGasDiffusion === "string"
      && recipe.requiredGasDiffusion.length > 0) {
      gasDependentDefinitionIds.add(recipe.machineId);
    }

    const range = recipe.gasDiffusionOutput?.range;
    if (range === undefined || !Number.isFinite(range) || range <= 0) {
      continue;
    }

    gasDiffusionRangeByDefinitionId.set(
      recipe.machineId,
      Math.max(gasDiffusionRangeByDefinitionId.get(recipe.machineId) ?? 0, range),
    );
  }

  return {
    gasDependentDefinitionIds,
    gasDiffusionRangeByDefinitionId,
  };
}

export function resolveGasInteractionVisualState(options: {
  activeTool: ActiveTool;
  moveKind: UiState["moveKind"];
  entities: readonly WorldEntity[];
  previewEntityIds: readonly string[];
  ghostEntityIds: readonly string[];
  entityDefinitionMap: ReadonlyMap<string, EntityDefinition>;
  definitionIndex: GasInteractionDefinitionIndex;
}): GasInteractionVisualState {
  if (!isSingleEntityGasInteractionMode(options.activeTool, options.moveKind)
    || options.previewEntityIds.length !== 1) {
    return createEmptyGasInteractionVisualState();
  }

  const previewEntity = options.entities.find(
    (entity) => entity.id === options.previewEntityIds[0],
  );
  if (previewEntity === undefined) {
    return createEmptyGasInteractionVisualState();
  }

  const previewDefinition = options.entityDefinitionMap.get(previewEntity.definitionId);
  if (previewDefinition === undefined) {
    return createEmptyGasInteractionVisualState();
  }

  const excludedEntityIds = new Set([
    ...options.previewEntityIds,
    ...options.ghostEntityIds,
  ]);
  const previewGasDiffusionRange = options.definitionIndex
    .gasDiffusionRangeByDefinitionId
    .get(previewDefinition.id);
  if (previewGasDiffusionRange !== undefined) {
    return resolveGasProviderPreviewVisualState({
      previewEntity,
      previewDefinition,
      previewGasDiffusionRange,
      entities: options.entities,
      excludedEntityIds,
      entityDefinitionMap: options.entityDefinitionMap,
      gasDependentDefinitionIds: options.definitionIndex.gasDependentDefinitionIds,
    });
  }

  if (!options.definitionIndex.gasDependentDefinitionIds.has(previewDefinition.id)) {
    return createEmptyGasInteractionVisualState();
  }

  const previewGridRect = resolveEntityGridRect({
    entity: previewEntity,
    definition: previewDefinition,
  });
  const highlightedEntityIds = options.entities.flatMap((entity) => {
    if (excludedEntityIds.has(entity.id)) {
      return [];
    }

    const definition = options.entityDefinitionMap.get(entity.definitionId);
    if (definition === undefined) {
      return [];
    }

    const gasDiffusionRange = options.definitionIndex
      .gasDiffusionRangeByDefinitionId
      .get(definition.id);
    if (gasDiffusionRange === undefined) {
      return [];
    }

    const gasDiffusionGridRect = resolveGasDiffusionRangeGridRect({
      entity,
      definition,
      gasDiffusionRange,
    });
    return gasDiffusionGridRect !== null
      && areGridRectsContaining(gasDiffusionGridRect, previewGridRect)
      ? [entity.id]
      : [];
  });

  return {
    highlightedEntityIds: new Set(highlightedEntityIds),
  };
}

function resolveGasProviderPreviewVisualState(options: {
  previewEntity: WorldEntity;
  previewDefinition: EntityDefinition;
  previewGasDiffusionRange: number;
  entities: readonly WorldEntity[];
  excludedEntityIds: ReadonlySet<string>;
  entityDefinitionMap: ReadonlyMap<string, EntityDefinition>;
  gasDependentDefinitionIds: ReadonlySet<string>;
}): GasInteractionVisualState {
  const previewGasDiffusionGridRect = resolveGasDiffusionRangeGridRect({
    entity: options.previewEntity,
    definition: options.previewDefinition,
    gasDiffusionRange: options.previewGasDiffusionRange,
  });
  if (previewGasDiffusionGridRect === null) {
    return createEmptyGasInteractionVisualState();
  }

  const highlightedEntityIds = options.entities.flatMap((entity) => {
    if (options.excludedEntityIds.has(entity.id)) {
      return [];
    }

    const definition = options.entityDefinitionMap.get(entity.definitionId);
    if (definition === undefined
      || !options.gasDependentDefinitionIds.has(definition.id)) {
      return [];
    }

    const entityGridRect = resolveEntityGridRect({
      entity,
      definition,
    });
    return areGridRectsContaining(previewGasDiffusionGridRect, entityGridRect)
      ? [entity.id]
      : [];
  });

  return {
    highlightedEntityIds: new Set(highlightedEntityIds),
  };
}

function isSingleEntityGasInteractionMode(
  activeTool: ActiveTool,
  moveKind: UiState["moveKind"],
): boolean {
  return activeTool === "single-placement"
    || (activeTool === "move" && moveKind === "ordinary");
}

function createEmptyGasInteractionVisualState(): GasInteractionVisualState {
  return {
    highlightedEntityIds: new Set(),
  };
}
