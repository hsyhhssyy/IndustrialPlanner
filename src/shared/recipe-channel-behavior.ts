import type { EntityRecipeChannelBehaviorDefinition } from "@/domain/registry/types/entity-definition";

export const RECIPE_CHANNEL_AUTOMATIC_MODE_CONFIG_KEY =
  "recipeChannelAutomaticModeEnabled";

export function isAutomaticRecipeChannelMode(
  behavior: EntityRecipeChannelBehaviorDefinition | undefined,
  config: Readonly<Record<string, unknown>>,
): boolean {
  const configKey = behavior?.automaticModeConfigKey;
  return configKey !== undefined && config[configKey] === true;
}
