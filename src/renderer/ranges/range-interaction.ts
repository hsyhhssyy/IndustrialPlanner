import type { ActiveTool, UiState } from "@/domain/app/types/app-types";
import type { WorldEntity } from "@/domain/document/world-document";
import type { EntityDefinition } from "@/domain/registry/types/entity-definition";
import type { EntityRangeDefinition } from "@/domain/registry/types/entity-range";
import type { RecipeDefinition } from "@/domain/registry/types/recipe-definition";
import { resolveEntityRangeGridRect } from "@/shared/geometry/entity-range";
import { areGridRectsContaining, areGridRectsIntersecting, resolveEntityGridRect } from "@/shared/geometry/power-range";
import { GridRectIndex } from "@/shared/geometry/grid-rect-index";
import type { RangeInstance, RangeInteractionVisualState } from "./types";

type InteractionKind = NonNullable<EntityRangeDefinition["interactionKind"]>;

/** 静态资格与反向预览策略分开；供电的两个字段具有不同语义。 */
export function createRangeInteractionRules(recipes: readonly RecipeDefinition[]) {
  const gasReceivers = new Set(recipes.filter((recipe) => recipe.requiredEnvironmentAnyOf).map((recipe) => recipe.machineId));
  const gas = (definition: EntityDefinition) => gasReceivers.has(definition.id);
  const irrigation = (definition: EntityDefinition) => definition.tags.includes("AcceptsIrrigation");
  return {
    power: {
      matchesTarget: (definition: EntityDefinition) => definition.powerDemand > 0,
      canPreviewAsReceiver: (definition: EntityDefinition) => definition.requiresPower,
    },
    gas: { matchesTarget: gas, canPreviewAsReceiver: gas },
    irrigation: { matchesTarget: irrigation, canPreviewAsReceiver: irrigation },
  } satisfies Record<InteractionKind, {
    matchesTarget: (definition: EntityDefinition) => boolean;
    canPreviewAsReceiver: (definition: EntityDefinition) => boolean;
  }>;
}

export function collectRangeInstances(
  entities: readonly WorldEntity[], definitions: ReadonlyMap<string, EntityDefinition>,
): RangeInstance[] {
  return entities.flatMap((entity) => {
    const definition = definitions.get(entity.definitionId);
    return definition?.ranges?.map((range) => ({
      key: JSON.stringify([entity.id, range.id]), entityId: entity.id, range,
      rotation: entity.rotation, gridRect: resolveEntityRangeGridRect({ entity, definition, range }),
    })) ?? [];
  });
}

export interface RangeInteractionOptions {
  readonly activeTool: ActiveTool;
  readonly moveKind: UiState["moveKind"];
  readonly alwaysShowPowerRange: boolean;
  readonly entities: readonly WorldEntity[];
  readonly ranges: readonly RangeInstance[];
  readonly previewEntityIds: readonly string[];
  readonly ghostEntityIds: readonly string[];
  readonly entityDefinitionMap: ReadonlyMap<string, EntityDefinition>;
  readonly rules: ReturnType<typeof createRangeInteractionRules>;
}

export function resolveRangeInteractionVisualState(options: RangeInteractionOptions): RangeInteractionVisualState {
  const highlightedEntityIds = new Set<string>();
  const visibleRangeKeys = new Set<string>();
  const batchHidden = options.moveKind === "batch"
    ? new Set([...options.previewEntityIds, ...options.ghostEntityIds]) : new Set<string>();
  const ranges = options.ranges.filter((range) => !batchHidden.has(range.entityId));
  for (const instance of ranges) {
    const kind = instance.range.interactionKind;
    if (kind === "gas" || kind === undefined || (kind === "power" && options.alwaysShowPowerRange)) {
      visibleRangeKeys.add(instance.key);
    }
  }
  const result = { highlightedEntityIds, visibleRangeKeys };
  if (options.previewEntityIds.length !== 1 || !(options.activeTool === "single-placement"
    || (options.activeTool === "move" && options.moveKind === "ordinary"))) return result;
  const preview = options.entities.find((entity) => entity.id === options.previewEntityIds[0]);
  const previewDefinition = preview && options.entityDefinitionMap.get(preview.definitionId);
  if (!preview || !previewDefinition) return result;
  const excluded = new Set([...options.previewEntityIds, ...options.ghostEntityIds]);
  const previewRect = resolveEntityGridRect({ entity: preview, definition: previewDefinition });
  const targets = options.entities.flatMap((entity) => {
    const definition = options.entityDefinitionMap.get(entity.definitionId);
    return !excluded.has(entity.id) && definition ? [{ entity, definition,
      rect: resolveEntityGridRect({ entity, definition }) }] : [];
  });
  const targetIndex = new GridRectIndex(targets, (target) => target.rect);
  const rangeIndex = new GridRectIndex(ranges, (range) => range.gridRect);
  for (const kind of ["power", "gas", "irrigation"] as const) {
    if (kind === "power" && options.alwaysShowPowerRange) continue;
    const rule = options.rules[kind];
    const ownRanges = ranges.filter((range) => range.entityId === preview.id && range.range.interactionKind === kind);
    for (const instance of ownRanges) {
      visibleRangeKeys.add(instance.key);
      const covers = instance.range.coverage === "contains" ? areGridRectsContaining : areGridRectsIntersecting;
      for (const target of targetIndex.intersecting(instance.gridRect)) {
        if (rule.matchesTarget(target.definition) && covers(instance.gridRect, target.rect)) highlightedEntityIds.add(target.entity.id);
      }
    }
    // 保留现有同种范围的提供者预览优先级；其他类型仍可作为接收者（例如洒水机受电）。
    if (ownRanges.length > 0 || !rule.canPreviewAsReceiver(previewDefinition)) continue;
    for (const instance of rangeIndex.intersecting(previewRect)) {
      if (instance.range.interactionKind !== kind || excluded.has(instance.entityId)) continue;
      const covers = instance.range.coverage === "contains" ? areGridRectsContaining : areGridRectsIntersecting;
      if (!covers(instance.gridRect, previewRect)) continue;
      visibleRangeKeys.add(instance.key);
      highlightedEntityIds.add(instance.entityId);
    }
  }
  return result;
}
