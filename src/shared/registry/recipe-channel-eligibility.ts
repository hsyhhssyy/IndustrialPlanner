import type { RecipeDefinition } from "@/domain/registry";

export const CUSTOM_PERIODIC_PHASE_CHANNEL_ID = "custom_periodic_phase";

/** 自定义周期频道独占相位配方，其他设备沿用自身的配方频道配置。 */
export function isRecipeAvailableInChannel(
  recipe: Pick<RecipeDefinition, "periodicRangeConversion">,
  channelId: string,
  deviceChannels: readonly { readonly id: string }[],
): boolean {
  if (channelId === CUSTOM_PERIODIC_PHASE_CHANNEL_ID) {
    return recipe.periodicRangeConversion !== undefined;
  }
  return recipe.periodicRangeConversion === undefined
    || !deviceChannels.some(channel => channel.id === CUSTOM_PERIODIC_PHASE_CHANNEL_ID);
}

export function isManualRecipeChannel(
  channel: { readonly id: string; readonly manualRecipeOnly?: boolean },
  automaticMode: boolean | undefined,
): boolean {
  if (channel.id === CUSTOM_PERIODIC_PHASE_CHANNEL_ID) return true;
  return automaticMode === undefined ? channel.manualRecipeOnly === true : !automaticMode;
}
