import type { WorldDocument } from "@/domain/document/world-document";
import { findFormation } from "./formation-recipes";
import type { FormationDefinition } from "@/domain/registry/types/periodic-range-conversion";
import type { RecipeDefinition } from "@/domain/registry/types/recipe-definition";
import type { RegistryContract } from "@/domain/registry/registry-contract";
import type { GridPoint, GridRect } from "@/domain/shared/grid";
import { findEntityRange, resolveLocalRangeGridRect } from "./geometry/entity-range";
import { isAutomaticRecipeChannelMode } from "./recipe-channel-behavior";
import { isRecipeAvailableByActivity } from "./registry/activity-availability";
import {
  isManualRecipeChannel,
  isRecipeAvailableInChannel,
} from "./registry/recipe-channel-eligibility";
import { CONSUMPTION_RECIPE_TAG } from "./consumption-channel";

/** 引擎与面板统一使用每秒 3000 整数单位；公共读模型直接换算为秒。 */
export const PERIODIC_RANGE_TIME_UNITS_PER_SECOND = 3000;

export type PeriodicRangeSide = "ming" | "hui";
export type PeriodicRangeEffect = PeriodicRangeSide | "heng";

export interface PeriodicRangeLayerState {
  readonly effect: PeriodicRangeEffect | null;
  readonly layers: number;
}

export function createPeriodicRangeRegionId(
  documentKey: string,
  formationId: string,
  rect: GridRect,
): string {
  return JSON.stringify([documentKey, formationId, rect.x, rect.y, rect.width, rect.height]);
}

export function resolvePeriodicRangeLayerState(ming: number, hui: number): PeriodicRangeLayerState {
  const paired = Math.min(ming, hui);
  if (paired > 0) return { effect: "heng", layers: paired };
  if (ming > 0) return { effect: "ming", layers: ming };
  if (hui > 0) return { effect: "hui", layers: hui };
  return { effect: null, layers: 0 };
}

export interface PeriodicRangeRegionSource {
  readonly entityId: string;
  readonly channelId: string;
  readonly recipeId: string;
  /** null 表示当前配置没有可确定的相位，例如自动通道存在多侧候选。 */
  readonly side: PeriodicRangeSide | null;
  readonly invalid: boolean;
}

export interface PeriodicRangeRegion {
  readonly regionId: string;
  readonly documentKey: string;
  readonly formation: FormationDefinition;
  readonly gridRect: GridRect;
  readonly sources: readonly PeriodicRangeRegionSource[];
}

interface MutablePeriodicRangeRegion {
  readonly regionId: string;
  readonly documentKey: string;
  readonly formation: FormationDefinition;
  readonly gridRect: GridRect;
  readonly sources: PeriodicRangeRegionSource[];
  readonly sourceKeys: Set<string>;
}


export interface CollectPeriodicRangeRegionsOptions {
  readonly document: WorldDocument;
  readonly registry: Pick<RegistryContract, "formationDefinitions" | "queries">;
  readonly activeActivityIds: readonly string[];
  /** App 注入 Editor 的实体布局校验；只应把范围冲突视为来源失效。 */
  readonly isSourceInvalid?: (entityId: string) => boolean;
}

/**
 * 布局态区域描述。规则与仿真编译保持一致：
 * 通道资格、活动可用性、手动通道预选、同一通道候选必须同区同程序。
 * 完全重合的来源合并为同一区域；不同 documentKey 的同坐标区域相互独立。
 */
export function collectPeriodicRangeRegions(
  options: CollectPeriodicRangeRegionsOptions,
): readonly PeriodicRangeRegion[] {
  const regions = new Map<string, MutablePeriodicRangeRegion>();

  for (const entityId of options.document.entityOrder) {
    const entity = options.document.entities[entityId];
    if (entity === undefined) continue;
    const definition = options.registry.queries.findEntityDefinition(entity.definitionId);
    if (definition === null) continue;
    const machineRecipes = options.registry.queries.findRecipeDefinitionsByMachineScope(definition.id).filter((recipe) =>
      recipe.periodicRangeConversion !== undefined &&
      (recipe.ownerDeviceId === undefined ? recipe.machineId === definition.id : recipe.ownerDeviceId === definition.id)
      && isRecipeAvailableByActivity(recipe, options.activeActivityIds));
    if (machineRecipes.length === 0) continue;

    const invalid = options.isSourceInvalid?.(entityId) === true;
    const selectedRecipes = entity.config.channelRecipes as Record<string, string> | undefined;
    const modeSwitchable = definition.recipeChannelBehavior?.automaticModeConfigKey !== undefined;
    const automaticMode = isAutomaticRecipeChannelMode(definition.recipeChannelBehavior, entity.config);

    for (const channel of definition.recipeChannels ?? []) {
      const manual = isManualRecipeChannel(channel, modeSwitchable ? automaticMode : undefined);
      const selectedRecipeId = selectedRecipes?.[channel.id] ?? null;
      const selectedRecipe = selectedRecipeId === null
        ? undefined
        : machineRecipes.find((recipe) => recipe.id === selectedRecipeId);
      const eligible = machineRecipes.filter((recipe) =>
        isRecipeAvailableInChannel(recipe, channel.id, definition.recipeChannels ?? [], definition.id)
        && recipe.tags.includes(CONSUMPTION_RECIPE_TAG) === (channel.type === "consumption-channel"));
      const resolved = resolveChannelPhaseSource({
        manual,
        selectedRecipe,
        eligible,
      });
      if (resolved === null) continue;

      const source = resolved.recipe.periodicRangeConversion!;
      const formation = findFormation(options.registry, source.programId);
      for (const rangeId of channel.projectionRangeIds ?? source.rangeIds) {
        const range = findEntityRange(definition, rangeId);
        const rect = resolveLocalRangeGridRect(
          entity.position,
          definition.footprint,
          entity.rotation,
          range.localRect,
        );
        const regionId = createPeriodicRangeRegionId(options.document.documentKey, formation.id, rect);
        let region = regions.get(regionId);
        if (region === undefined) {
          region = {
            regionId,
            documentKey: options.document.documentKey,
            formation,
            gridRect: rect,
            sources: [],
            sourceKeys: new Set(),
          };
          regions.set(regionId, region);
        }
        const sourceKey = `${entityId}\u0000${channel.id}`;
        if (!region.sourceKeys.has(sourceKey)) {
          region.sourceKeys.add(sourceKey);
          region.sources.push({
            entityId,
            channelId: channel.id,
            recipeId: resolved.recipe.id,
            side: resolved.side,
            invalid,
          });
        }
      }
    }
  }

  return [...regions.values()].map(({ sourceKeys: _sourceKeys, ...region }) => ({
    ...region,
    gridRect: { ...region.gridRect },
    sources: region.sources.map((source) => ({ ...source })),
  }));
}

function resolveChannelPhaseSource(options: {
  manual: boolean;
  selectedRecipe: RecipeDefinition | undefined;
  eligible: readonly RecipeDefinition[];
}): { recipe: RecipeDefinition; side: PeriodicRangeSide | null } | null {
  const toSide = (recipe: RecipeDefinition): PeriodicRangeSide => (
    recipe.periodicRangeConversion!.side === 0 ? "ming" : "hui"
  );
  const selectedEligible = options.selectedRecipe !== undefined
    && options.eligible.includes(options.selectedRecipe)
    ? options.selectedRecipe : undefined;
  if (options.manual) {
    if (selectedEligible !== undefined) {
      return { recipe: selectedEligible, side: toSide(selectedEligible) };
    }
    // 手动通道未选相位或选择已失效时仍保留范围用于点选，但不提供效果。
    const pending = options.eligible[0];
    return pending === undefined ? null : { recipe: pending, side: null };
  }
  if (selectedEligible !== undefined) {
    return { recipe: selectedEligible, side: toSide(selectedEligible) };
  }
  const first = options.eligible[0];
  if (first === undefined) return null;
  const firstSide = toSide(first);
  return options.eligible.every((recipe) => toSide(recipe) === firstSide)
    ? { recipe: first, side: firstSide }
    : { recipe: first, side: null };
}

/** 仿真未启动时的布局预览：假定所有有效关联炉子均已启动。 */
export function resolvePeriodicRangeLayoutAggregate(
  region: PeriodicRangeRegion,
): PeriodicRangeLayerState {
  let ming = 0;
  let hui = 0;
  for (const source of region.sources) {
    if (source.invalid || source.side === null) continue;
    if (source.side === "ming") ming += 1;
    else hui += 1;
  }
  return resolvePeriodicRangeLayerState(ming, hui);
}

/** 任一来源仍有效即保持合法；全部来源冲突时面板只显示布局非法。 */
export function isPeriodicRangeRegionLayoutLegal(region: PeriodicRangeRegion): boolean {
  return region.sources.some((source) => !source.invalid);
}

export function findPeriodicRangeRegionsAtGridCell(
  regions: readonly PeriodicRangeRegion[],
  cell: GridPoint,
): readonly PeriodicRangeRegion[] {
  return regions.filter((region) =>
    cell.x >= region.gridRect.x && cell.y >= region.gridRect.y
    && cell.x < region.gridRect.x + region.gridRect.width
    && cell.y < region.gridRect.y + region.gridRect.height);
}

/** 供布局合法性判定复用；仅范围冲突会导致周期区域来源失效。 */
export function isPeriodicRangeConflictReason(code: string): boolean {
  return code === "range-partial-overlap" || code === "range-forbidden-entity";
}

// AI-REMOVED 2026-11-26:
// Reason: ST3-RQ-002 物料关系、分层概率和投影范围分别由配方行为及本地口声明。
// Trigger: 阵列四层必成、双口独立和跨读者单一配方来源的已确认需求。
// Evidence: 此文件的原有声明或消费者引用已迁入下述实现，回归清单见 ST3-RQ-002 执行日志。
// Replacement: registry/recipe-definition.ts、registry/entity-definition.ts 与 shared/formation-recipes.ts
// Risk: 恢复历史逻辑会同时启用两条业务路径。
// Human Review: Required
//
// Original code:
// import type { PeriodicRangeConversionProgram } from "@/domain/registry/types/periodic-range-conversion";
//
// /** 程序签名同时约束分布与持续时间；身份不随当前明/晦或有效来源数量变化。 */
// export function createPeriodicRangeProgramSignature(program: PeriodicRangeConversionProgram): string {
//   const effects = program.effects.map((effect) => ({
//     probabilities: [...effect.probabilityByLayer],
//     outputs: Object.entries(effect.outputItemByInputId)
//       .sort(([left], [right]) => left < right ? -1 : left > right ? 1 : 0),
//   }));
//   return JSON.stringify([
//     program.id,
//     program.periodSeconds * PERIODIC_RANGE_TIME_UNITS_PER_SECOND,
//     ...effects,
//   ]);
// }
//
//
//   programSignature: string,
//
//   return JSON.stringify([documentKey, programSignature, rect.x, rect.y, rect.width, rect.height]);
//
// }
//
// /** 网络程序以最后一层概率覆盖更高层数；超出列表时返回 undefined。 */
// export function resolvePeriodicRangeLayerProbability(
//   probabilities: readonly number[],
//   layers: number,
//   saturateLayerProbability: boolean | undefined,
// ): number | undefined {
//   if (layers <= 0) return undefined;
//   const index = saturateLayerProbability
//     ? Math.min(layers, probabilities.length) - 1
//     : layers - 1;
//   return probabilities[index];
// }
//
// export function resolvePeriodicRangeProbabilityByEffect(
//   program: PeriodicRangeConversionProgram,
//   effect: PeriodicRangeEffect,
//   layers: number,
//   saturateLayerProbability: boolean,
// ): number | undefined {
//   const effectIndex = effect === "ming" ? 0 : effect === "hui" ? 1 : 2;
//   return resolvePeriodicRangeLayerProbability(
//     program.effects[effectIndex].probabilityByLayer,
//     layers,
//     saturateLayerProbability,
//   );
// }
//
//   readonly programSignature: string;
//   readonly program: PeriodicRangeConversionProgram;
//
//   /** 任一来源使用网络自定义配方时按最后一层概率饱和。 */
//   readonly saturateLayerProbability: boolean;
//
//   readonly programSignature: string;
//   readonly program: PeriodicRangeConversionProgram;
//
//   saturateLayerProbability: boolean;
//
// export interface PeriodicRangeLayoutAggregate {
//   readonly effect: PeriodicRangeEffect | null;
//   readonly layers: number;
//   readonly probability: number | null;
// }
//
//   readonly registry: Pick<RegistryContract, "entityDefinitions" | "recipeDefinitions" | "customContent" | "queries">;
//
//   const definitionMap = new Map(
//     options.registry.entityDefinitions.map((definition) => [definition.id, definition]),
//   );
//   const periodicRecipes = options.registry.recipeDefinitions.filter(
//     (recipe) => recipe.periodicRangeConversion !== undefined,
//   );
//
//     const definition = definitionMap.get(entity.definitionId);
//     if (definition === undefined) continue;
//     const machineRecipes = periodicRecipes.filter((recipe) =>
//
//       for (const rangeId of resolved.recipe.periodicRangeConversion!.rangeIds) {
//
//         const program = resolved.recipe.periodicRangeConversion!.program;
//         const programSignature = createPeriodicRangeProgramSignature(program);
//         const regionId = createPeriodicRangeRegionId(options.document.documentKey, programSignature, rect);
//
//             programSignature,
//             program,
//
//             saturateLayerProbability: false,
//
//         region.saturateLayerProbability ||= Object.hasOwn(
//           options.registry.customContent.recipeUuids,
//           resolved.recipe.id,
//         );
//
// ): PeriodicRangeLayoutAggregate {
//
//   const state = resolvePeriodicRangeLayerState(ming, hui);
//   if (state.effect === null) return { effect: null, layers: 0, probability: null };
//   return {
//     ...state,
//     probability: resolvePeriodicRangeProbabilityByEffect(
//       region.program,
//       state.effect,
//       state.layers,
//       region.saturateLayerProbability,
//     ) ?? null,
//   };
