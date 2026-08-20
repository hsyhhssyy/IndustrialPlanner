import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

import { createRegistryContract } from "@/registry";

describe("entity icon paths", () => {
  it("declares an existing public-relative UI icon for every entity definition", () => {
    const definitions = createRegistryContract().entityDefinitions;

    expect(definitions.length).toBeGreaterThan(0);
    for (const definition of definitions) {
      expect(definition.iconPath).not.toMatch(/^(?:\/|[a-z][a-z\d+\-.]*:)/i);
      expect(definition.iconPath.split("/")).not.toContain("..");
      expect(existsSync(resolve("public", definition.iconPath))).toBe(true);
    }
  });

  it("allows the UI icon path to differ from both the definition and sprite resource ids", () => {
    const definition = createRegistryContract().entityDefinitions.find(
      (candidate) => candidate.id === "liquid_filling_pd_mc_1",
    );

    expect(definition).toBeDefined();
    expect(definition).toMatchObject({
      id: "liquid_filling_pd_mc_1",
      spriteId: "item_port_liquid_filling_pd_mc_1",
      iconPath: "device-icons/item_port_filling_pd_mc_1.webp",
    });
    expect(definition!.iconPath).not.toContain(definition!.id);
    expect(definition!.iconPath).not.toContain(definition!.spriteId);
  });
});
