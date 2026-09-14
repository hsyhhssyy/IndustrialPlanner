// @vitest-environment node

import { describe, expect, it } from "vitest";

// @ts-expect-error Node 导入脚本由真实 TypeScript AST 输入验证。
import { normalizeFluidProfiles, updateRegistryFluidColorsSource } from "../../scripts/sync-registry-fluid-colors.mjs";

const color = (hex: string) => {
  const rgb = [1, 3, 5].map((start) => Number.parseInt(hex.slice(start, start + 2), 16));
  return { hex, rgba8: [...rgb, 128], displayRgba8: [...rgb, 128] };
};

const profiles = {
  schemaVersion: 1,
  profile: "endfield-pipe-fluid-colors-v1",
  profileCount: 2,
  phaseCounts: { liquid: 1, gas: 1 },
  itemIds: ["liquid-a", "gas-a"],
  fluidProfiles: {
    "liquid-a": { id: "liquid-a", phase: "liquid", colors: {
      body: color("#112233"), skin: color("#223344"), skin2: color("#334455"), splash: color("#445566"),
    } },
    "gas-a": { id: "gas-a", phase: "gas", colors: {
      body: color("#aabbcc"), skin: color("#bbccdd"),
    } },
  },
};

const registry = `
const OTHER_TAG = "other";
export const ITEM_FLUID_COLOR_SOURCE_PATH = "resources/building-assets-site/old/buildings/logistics/fluid-profiles.json";
export const ITEM_DEFINITIONS = [
  { id: "solid-a", tags: [OTHER_TAG], displayOrder: 1 },
  {
    id: "liquid-a",
    tags: ["liquid"],
    fluidColors: { body: "#000000", skin: "#000000", skin2: "#000000", splash: "#000000" },
    displayOrder: 2,
  },
  {
    id: "gas-a",
    tags: ["gas", OTHER_TAG],
    fluidColors: { body: "#000000", skin: "#000000" },
    displayOrder: 3,
  },
];
`;

describe("网站流体配色写入 Registry", () => {
  it("只替换既有 fluidColors，并保持液体四层、气体两层和幂等性", () => {
    const sourcePath = "resources/building-assets-site/new/buildings/logistics/fluid-profiles.json";
    const result = updateRegistryFluidColorsSource(registry, profiles, sourcePath);
    expect(result).toMatchObject({ profileCount: 2, phaseCounts: { liquid: 1, gas: 1 } });
    expect(result.source).toContain(`ITEM_FLUID_COLOR_SOURCE_PATH = "${sourcePath}"`);
    expect(result.source).toContain('fluidColors: { body: "#112233", skin: "#223344", skin2: "#334455", splash: "#445566" }');
    expect(result.source).toContain('fluidColors: { body: "#aabbcc", skin: "#bbccdd" }');
    expect(result.source).toContain('{ id: "solid-a", tags: [OTHER_TAG], displayOrder: 1 }');
    expect(updateRegistryFluidColorsSource(result.source, profiles, sourcePath).source).toBe(result.source);
  });

  it("拒绝来源层缺失、来源集合变化和 Registry 相态冲突", () => {
    const missingRole = structuredClone(profiles);
    delete (missingRole.fluidProfiles["liquid-a"].colors as Partial<typeof profiles.fluidProfiles["liquid-a"]["colors"]>).splash;
    expect(() => normalizeFluidProfiles(missingRole)).toThrow("Invalid fluid color roles");

    const sourcePath = "resources/building-assets-site/new/buildings/logistics/fluid-profiles.json";
    expect(() => updateRegistryFluidColorsSource(registry.replace('id: "gas-a"', 'id: "gas-b"'), profiles, sourcePath))
      .toThrow("Registry fluid item set differs");
    expect(() => updateRegistryFluidColorsSource(registry.replace('tags: ["gas", OTHER_TAG]', 'tags: ["liquid", OTHER_TAG]'), profiles, sourcePath))
      .toThrow();
  });
});
