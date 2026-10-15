import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

import { createRegistryContract } from "@/registry";

describe("entity icon paths", () => {
  it("declares public-relative UI icons and permits the authorized missing crop icons", () => {
    const definitions = createRegistryContract().entityDefinitions;

    expect(definitions.length).toBeGreaterThan(0);
    for (const definition of definitions) {
      expect(definition.iconPath).not.toMatch(/^(?:\/|[a-z][a-z\d+\-.]*:)/i);
      expect(definition.iconPath.split("/")).not.toContain("..");
      // AI-CORRECTION 2026-10-15: 用户允许缘缘庄新田块暂缺列表图标，保留独立路径并使用既有UI占位符。
      if (definition.id.startsWith("soil_corp_")) {
        expect(definition.iconPath).toBe(`device-icons/item_port_${definition.id}.webp`);
      } else {
        expect(existsSync(resolve("public", definition.iconPath))).toBe(true);
      }
    }
  });

  it("allows the UI icon path to differ from both the definition and sprite resource ids", () => {
    const definition = createRegistryContract().entityDefinitions.find(
      (candidate) => candidate.id === "filling_pd_mc_1_liquid",
    );

    expect(definition).toBeDefined();
    expect(definition).toMatchObject({
      id: "filling_pd_mc_1_liquid",
      spriteId: "item_port_liquid_filling_pd_mc_1",
      iconPath: "device-icons/item_port_filling_pd_mc_1.webp",
    });
  });
});
