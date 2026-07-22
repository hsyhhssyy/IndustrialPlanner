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

  it.each(["log_connector", "pipe_connector", "udpipe_loader_2"])(
    "%s explicitly preserves independent internal channels",
    (definitionId) => {
      expect(requireEntity(definitionId).recipeChannelBehavior).toEqual({
        allowDuplicateRecipesAcrossChannels: true,
      });
    },
  );
});
