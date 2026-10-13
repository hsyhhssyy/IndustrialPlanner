import { describe, expect, it } from "vitest";
import { createRegistryContract } from "@/registry";
import { validateEntityRanges } from "@/registry/entity-range-validation";

const registry = createRegistryContract();
const sprinkler = registry.queries.findEntityDefinition("squirter_1")!;

describe("范围注册与洒水机", () => {
  it("农业白名单、端口、范围和全部田块接收资格完整，未引入浇水配方", () => {
    expect(sprinkler.uiGroup).toBe("agriculture");
    expect(sprinkler.placementWhitelist).toEqual([{ baseId: "wuling_agricultural_land" }]);
    expect(sprinkler.footprint).toEqual({ width: 3, height: 3 });
    expect(sprinkler.portGroups[0]!.ports[0]).toMatchObject({ localCellX: 0, localCellY: 1, edge: "WEST" });
    expect(sprinkler.ranges![0]).toMatchObject({ coverage: "intersects", localRect: { x: 3, y: -1, width: 4, height: 5 } });
    const plots = registry.entityDefinitions.filter((definition) => definition.id.startsWith("soil_"));
    expect(plots).toHaveLength(10);
    expect(plots.every((plot) => plot.tags.includes("AcceptsIrrigation"))).toBe(true);
    expect(sprinkler.recipeChannels).toEqual([]);
    expect(registry.queries.findRecipeDefinitionsByMachine("squirter_1")).toEqual([]);
  });
  it("拒绝重复 ID、非法矩形和悬空气体范围引用", () => {
    expect(() => validateEntityRanges([{ ...sprinkler, ranges: [sprinkler.ranges![0]!, sprinkler.ranges![0]!] }], [])).toThrow(/Duplicate/);
    expect(() => validateEntityRanges([{ ...sprinkler, ranges: [{ ...sprinkler.ranges![0]!, localRect: { x: 0, y: 0, width: 0, height: 2 } }] }], [])).toThrow(/Invalid range rectangle/);
    const recipe = registry.recipeDefinitions.find((entry) => entry.gasDiffusionOutput)!;
    expect(() => validateEntityRanges(registry.entityDefinitions, [{ ...recipe, gasDiffusionOutput: { gasItemId: "item_gas_inert", rangeId: "missing" } }])).toThrow(/Invalid gas range/);
  });
});
