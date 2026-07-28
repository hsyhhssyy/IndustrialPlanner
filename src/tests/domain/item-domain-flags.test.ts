import { describe, expect, it } from "vitest";

import {
  AnyDomain,
  FluidDomain,
  ItemDomainFlag,
  RecipeItemDomainId,
  domainFlagsToLabel,
  hasDomain,
  resolveRecipeItemDomainFlags,
} from "@/domain/shared/item-domain-flags";

describe("item-domain flags", () => {
  it("keeps the published phaseType-compatible bit values", () => {
    expect(ItemDomainFlag).toEqual({
      None: 0,
      Solid: 1,
      Liquid: 2,
      Gas: 4,
    });
    expect(FluidDomain).toBe(6);
    expect(AnyDomain).toBe(7);
  });

  it("supports arbitrary unions without conflating overlap and containment", () => {
    const solidOrGas = ItemDomainFlag.Solid | ItemDomainFlag.Gas;

    expect(hasDomain(solidOrGas, ItemDomainFlag.Solid)).toBe(true);
    expect(hasDomain(solidOrGas, ItemDomainFlag.Gas)).toBe(true);
    expect(hasDomain(solidOrGas, FluidDomain)).toBe(false);
    expect(hasDomain(solidOrGas, ItemDomainFlag.None)).toBe(false);
    expect(domainFlagsToLabel(solidOrGas)).toBe("solid|gas");
  });

  it("maps internal recipe placeholders to domain flags", () => {
    expect(resolveRecipeItemDomainFlags(RecipeItemDomainId.Solid)).toBe(ItemDomainFlag.Solid);
    expect(resolveRecipeItemDomainFlags(RecipeItemDomainId.Fluid)).toBe(FluidDomain);
    expect(resolveRecipeItemDomainFlags("item_liquid_water")).toBeNull();
  });
});
