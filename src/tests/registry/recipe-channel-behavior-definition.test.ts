import { describe, expect, it } from "vitest";

import type { EntityDefinition } from "@/domain/registry/types/entity-definition";
import { ENTITY_DEFINITIONS } from "@/registry/entity-definition";
import { RECIPE_CHANNEL_AUTOMATIC_MODE_CONFIG_KEY } from "@/shared/recipe-channel-behavior";
import { WATER_PURIFIER_NODE_ENTITY_ID } from "@/shared/water-purifier-node";

function requireEntity(id: string): EntityDefinition {
  const definition = ENTITY_DEFINITIONS.find((candidate) => candidate.id === id);
  if (definition === undefined) {
    throw new Error(`Missing entity definition: ${id}`);
  }
  return definition;
}

describe("recipe channel behavior definitions", () => {
  it.each(["mix_pool_1", "mix_pool_2"])(
    "%s supports mode switching and newly placed entities default to automatic mode",
    (definitionId) => {
      const definition = requireEntity(definitionId);

      expect(definition.recipeChannelBehavior).toEqual({
        automaticModeConfigKey: RECIPE_CHANNEL_AUTOMATIC_MODE_CONFIG_KEY,
        allowDuplicateRecipesAcrossChannels: false,
      });
      expect(definition.placementDefaults?.config).toMatchObject({
        [RECIPE_CHANNEL_AUTOMATIC_MODE_CONFIG_KEY]: true,
      });
    },
  );

  it("allows duplicate recipes on the water purifier through an explicit definition", () => {
    expect(requireEntity(WATER_PURIFIER_NODE_ENTITY_ID).recipeChannelBehavior).toEqual({
      allowDuplicateRecipesAcrossChannels: true,
    });
    expect(requireEntity("grinder_1").recipeChannelBehavior).toBeUndefined();
  });

  it.each([
    "log_connector",
    "pipe_connector",
    // AI-REMOVED 2026-08-19:
    // Reason: 多口暗管入口销毁 channel 已退出，不再需要允许跨 channel 重复运行同一配方。
    // Trigger: 用户要求暗管入口在所有模式下提交仓库并抛弃销毁机制。
    // Evidence: udpipe_loader_2.recipeChannels 为空。
    // Replacement: 下方无 channel 行为断言。
    // Risk: Low
    // Human Review: Required
    //
    // Original code:
    // "udpipe_loader_2",
  ])(
    "%s explicitly preserves independent internal channels",
    (definitionId) => {
      expect(requireEntity(definitionId).recipeChannelBehavior).toEqual({
        allowDuplicateRecipesAcrossChannels: true,
      });
    },
  );

  it("does not retain recipe-channel behavior on the channel-free multi-port dark pipe inlet", () => {
    expect(requireEntity("udpipe_loader_2").recipeChannelBehavior).toBeUndefined();
  });
});
