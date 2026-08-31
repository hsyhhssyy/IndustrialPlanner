import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

import { createRegistryContract } from "@/registry";
import {
  MAIN_CRAFT_GROUP_TAG,
  resolveEntityCraftGroupKey,
  resolveEntityVariantName,
} from "@/shared/entity-variants";
import { lookupText } from "@/shared/i18n";

describe("entity variant definitions", () => {
  it("registers every alter-variant tag used by entity definitions", () => {
    const registry = createRegistryContract();
    const usedVariantNames = new Set(
      registry.entityDefinitions.flatMap((definition) =>
        definition.tags
          .filter((tag) => tag.startsWith("alter-variant:"))
          .map((tag) => tag.slice("alter-variant:".length)),
      ),
    );

    expect([...usedVariantNames].sort()).toEqual([
      "gas",
      "gastrans",
      "liquid",
      "liquidtrans",
      "normal",
      "solidtrans",
    ]);

    for (const variantName of usedVariantNames) {
      expect(registry.entityVariantDefinitions[variantName]?.variantName).toBe(variantName);
    }
  });

  it("fully identifies every member and exactly one main definition by tags", () => {
    const definitions = createRegistryContract().entityDefinitions;
    const definitionsByCraftGroup = new Map<string, typeof definitions>();

    for (const definition of definitions) {
      const craftGroupKey = resolveEntityCraftGroupKey(definition);
      const variantName = resolveEntityVariantName(definition);

      if (craftGroupKey === null) {
        expect(variantName).toBeNull();
        expect(definition.tags.includes(MAIN_CRAFT_GROUP_TAG)).toBe(false);
        continue;
      }

      expect(variantName).not.toBeNull();
      definitionsByCraftGroup.set(craftGroupKey, [
        ...(definitionsByCraftGroup.get(craftGroupKey) ?? []),
        definition,
      ]);
    }

    expect(definitionsByCraftGroup.size).toBe(7);
    for (const craftGroupDefinitions of definitionsByCraftGroup.values()) {
      expect(craftGroupDefinitions.length).toBeGreaterThan(1);
      expect(
        craftGroupDefinitions.filter((definition) =>
          definition.tags.includes(MAIN_CRAFT_GROUP_TAG),
        ),
      ).toHaveLength(1);
      expect(new Set(craftGroupDefinitions.map(resolveEntityVariantName)).size).toBe(
        craftGroupDefinitions.length,
      );
      expect(new Set(craftGroupDefinitions.map((definition) =>
        lookupText("zh-CN", definition.nameKey),
      )).size).toBe(1);
      expect(new Set(craftGroupDefinitions.map((definition) =>
        lookupText("en-US", definition.nameKey),
      )).size).toBe(1);
    }
  });

  it("provides localized names and an existing public icon for every entry", () => {
    const definitions = createRegistryContract().entityVariantDefinitions;

    for (const [variantName, definition] of Object.entries(definitions)) {
      expect(definition.variantName).toBe(variantName);
      expect(lookupText("zh-CN", definition.shortNameKey)).toBeTruthy();
      expect(lookupText("zh-CN", definition.longNameKey)).toMatch(/模式$/);
      expect(lookupText("en-US", definition.shortNameKey)).toBeTruthy();
      expect(lookupText("en-US", definition.longNameKey)).toMatch(/Mode$/);
      expect(existsSync(resolve("public", definition.iconPath))).toBe(true);
    }
  });

  it("uses MachineMode icons for every placement variant", () => {
    expect(createRegistryContract().entityVariantDefinitions).toMatchObject({
      normal: { iconPath: "assets/machine-mode-icons/icon_port_normal.webp" },
      gas: { iconPath: "assets/machine-mode-icons/icon_port_gas.webp" },
      gastrans: { iconPath: "assets/machine-mode-icons/icon_port_gastrans.webp" },
      liquid: { iconPath: "assets/machine-mode-icons/icon_port_liquid.webp" },
      liquidtrans: { iconPath: "assets/machine-mode-icons/icon_port_liquidtrans.webp" },
      solidtrans: { iconPath: "assets/machine-mode-icons/icon_port_solidtrans.webp" },
    });
  });

  it("uses the requested Chinese normal, solid, liquid, and gas labels", () => {
    expect(lookupText("zh-CN", "registry.entityVariant.normal.shortName")).toBe("基础");
    expect(lookupText("zh-CN", "registry.entityVariant.normal.longName")).toBe("基础模式");
    expect(lookupText("zh-CN", "registry.entityVariant.solid.shortName")).toBe("固体");
    expect(lookupText("zh-CN", "registry.entityVariant.solid.longName")).toBe("固体模式");
    expect(lookupText("zh-CN", "registry.entityVariant.liquid.shortName")).toBe("液体");
    expect(lookupText("zh-CN", "registry.entityVariant.liquid.longName")).toBe("液体模式");
    expect(lookupText("zh-CN", "registry.entityVariant.gas.shortName")).toBe("气体");
    expect(lookupText("zh-CN", "registry.entityVariant.gas.longName")).toBe("气体模式");
  });
});
