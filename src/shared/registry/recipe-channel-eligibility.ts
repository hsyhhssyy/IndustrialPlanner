import type { RecipeDefinition } from "@/domain/registry";

export const CUSTOM_PERIODIC_PHASE_CHANNEL_ID = "custom_periodic_phase";

interface RecipeChannelScope {
  readonly id: string;
  readonly projectionRangeIds?: readonly string[];
}

/** 只有来源声明与本通道范围相交时，才能在此选择相位。 */
export function isRecipeAvailableInChannel(
  recipe: Pick<RecipeDefinition, "periodicRangeConversion" | "behavior">,
  channelId: string,
  deviceChannels: readonly RecipeChannelScope[],
): boolean {
  if (recipe.behavior !== undefined) return false;
  const ranges = deviceChannels.find(channel => channel.id === channelId)?.projectionRangeIds;
  const source = recipe.periodicRangeConversion;
  if (ranges) return source !== undefined && ranges.every(id => source.rangeIds.includes(id));
  return source === undefined || !deviceChannels.some(channel => channel.projectionRangeIds !== undefined);
}

export function isManualRecipeChannel(
  channel: RecipeChannelScope & { readonly manualRecipeOnly?: boolean },
  automaticMode: boolean | undefined,
): boolean {
  if (channel.projectionRangeIds !== undefined) return true;
  return automaticMode === undefined ? channel.manualRecipeOnly === true : !automaticMode;
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
// /** 自定义周期频道独占相位配方，其他设备沿用自身的配方频道配置。 */
//
//   recipe: Pick<RecipeDefinition, "periodicRangeConversion">,
//
//   deviceChannels: readonly { readonly id: string }[],
//
//   if (channelId === CUSTOM_PERIODIC_PHASE_CHANNEL_ID) {
//     return recipe.periodicRangeConversion !== undefined;
//   }
//   return recipe.periodicRangeConversion === undefined
//     || !deviceChannels.some(channel => channel.id === CUSTOM_PERIODIC_PHASE_CHANNEL_ID);
//
//   channel: { readonly id: string; readonly manualRecipeOnly?: boolean },
//
//   if (channel.id === CUSTOM_PERIODIC_PHASE_CHANNEL_ID) return true;
