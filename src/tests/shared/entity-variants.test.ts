import { describe, expect, it } from "vitest";

import {
  collapseEntityVariantDefinitions,
  resolveEntityCraftGroupKey,
  resolveEntityVariantDefinitions,
  resolveEntityVariantName,
  resolveMainEntityVariantDefinition,
  resolveNextEntityVariantDefinitionId,
} from "@/shared/entity-variants";
import { createRegistryContract } from "@/registry";

describe("entity variant helpers", () => {
  it("resolves the explicit alter-variant tag without inferring from the entity id", () => {
    expect(resolveEntityVariantName({ tags: ["武陵", "alter-variant:liquidtrans"] })).toBe("liquidtrans");
    expect(resolveEntityVariantName({ tags: ["武陵"] })).toBeNull();
    expect(resolveEntityCraftGroupKey({ tags: ["alter:item_port_planter_1"] })).toBe(
      "item_port_planter_1",
    );
  });

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

  it("groups machine modes by building id without requiring a base entity definition", () => {
    const definitions = createRegistryContract().entityDefinitions;

    expect(
      resolveEntityVariantDefinitions({
        definitionId: "transmuter_1_gastrans",
        definitions,
      }).map((definition) => definition.id),
    ).toEqual([
      "transmuter_1_gastrans",
      "transmuter_1_liquidtrans",
    ]);

    expect(resolveNextEntityVariantDefinitionId({
      definitionId: "transmuter_2_solidtrans",
      definitions,
    })).toBe("transmuter_2_gastrans");

    expect(
      resolveEntityVariantDefinitions({
        definitionId: "item_port_liquid_purifier_1",
        definitions,
      }).map((definition) => definition.id),
    ).toEqual([
      "item_port_liquid_purifier_1",
      "liquid_purifier_1_gas",
    ]);
  });

  it("resolves the tagged main definition and collapses a family to the persisted variant", () => {
    const definitions = createRegistryContract().entityDefinitions;
    const planterDefinitions = definitions.filter((definition) =>
      resolveEntityCraftGroupKey(definition) === "item_port_planter_1",
    );

    expect(resolveMainEntityVariantDefinition({
      definitionId: "item_port_hydro_planter_1",
      definitions,
    })?.id).toBe("item_port_planter_1");
    expect(collapseEntityVariantDefinitions({
      definitions: planterDefinitions,
      selectedVariantNameByCraftGroup: {
        item_port_planter_1: "liquid",
      },
    }).map((definition) => definition.id)).toEqual(["item_port_hydro_planter_1"]);
    expect(collapseEntityVariantDefinitions({
      definitions: planterDefinitions,
      selectedVariantNameByCraftGroup: {
        item_port_planter_1: "removed-variant",
      },
    }).map((definition) => definition.id)).toEqual(["item_port_planter_1"]);
  });
});
