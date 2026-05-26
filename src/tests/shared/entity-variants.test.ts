import { describe, expect, it } from "vitest";

import {
  resolveEntityVariantDefinitions,
  resolveNextEntityVariantDefinitionId,
} from "@/shared/entity-variants";
import { createRegistryContract } from "@/registry";

describe("entity variant helpers", () => {
  it("cycles base and alter-tagged variants by display order", () => {
    const definitions = createRegistryContract().entityDefinitions;

    expect(
      resolveEntityVariantDefinitions({
        definitionId: "item_port_filling_pd_mc_1",
        definitions,
      }).map((definition) => definition.id),
    ).toEqual([
      "item_port_filling_pd_mc_1",
      "item_port_liquid_filling_pd_mc_1",
    ]);

    expect(resolveNextEntityVariantDefinitionId({
      definitionId: "item_port_filling_pd_mc_1",
      definitions,
    })).toBe("item_port_liquid_filling_pd_mc_1");
    expect(resolveNextEntityVariantDefinitionId({
      definitionId: "item_port_liquid_filling_pd_mc_1",
      definitions,
    })).toBe("item_port_filling_pd_mc_1");
  });

  it("returns null for definitions without alternates", () => {
    expect(resolveNextEntityVariantDefinitionId({
      definitionId: "belt_straight_1x1",
      definitions: createRegistryContract().entityDefinitions,
    })).toBeNull();
  });
});
