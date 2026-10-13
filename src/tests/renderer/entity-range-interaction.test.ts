import { describe, expect, it } from "vitest";
import { createRegistryContract } from "@/registry";
import { collectRangeInstances, createRangeInteractionRules, resolveRangeInteractionVisualState } from "@/renderer/ranges";
import { loadBlueprintFromFile, getBlueprintEntityArray } from "@/tests/simulation/blueprint-test-helpers";

const registry = createRegistryContract();
const entityDefinitionMap = new Map(registry.entityDefinitions.map((definition) => [definition.id, definition]));
const entities = getBlueprintEntityArray(loadBlueprintFromFile("src/tests/fixtures/blueprints/collections/renderer/entity-range/scene.schema7.json"));
const ranges = collectRangeInstances(entities, entityDefinitionMap);
const defaults = { entities, ranges, entityDefinitionMap, rules: createRangeInteractionRules(registry.recipeDefinitions),
  activeTool: "single-placement" as const, moveKind: null, alwaysShowPowerRange: false, ghostEntityIds: [] };

describe("洒水范围编辑交互", () => {
  it("摆洒水机时同时高亮部分相交田块和关联供电桩", () => {
    const state = resolveRangeInteractionVisualState({ ...defaults, previewEntityIds: ["sprinkler"] });
    expect(state.highlightedEntityIds).toEqual(new Set(["intersecting", "pole"]));
    expect(state.visibleRangeKeys).toEqual(new Set([JSON.stringify(["sprinkler", "irrigation"]), JSON.stringify(["pole", "power"])]));
  });
  it("摆田块时反向显示并高亮覆盖它的洒水机", () => {
    const state = resolveRangeInteractionVisualState({ ...defaults, previewEntityIds: ["intersecting"] });
    expect(state.highlightedEntityIds).toEqual(new Set(["sprinkler"]));
    expect(state.visibleRangeKeys).toEqual(new Set([JSON.stringify(["sprinkler", "irrigation"])]));
  });
  it.each(["touching", "behind"])("%s 田块不接受当前范围", (id) => {
    expect(resolveRangeInteractionVisualState({ ...defaults, previewEntityIds: [id] }).highlightedEntityIds).toEqual(new Set());
  });
  it("电力常显开关仅关闭电力关联高亮，洒水交互仍生效", () => {
    const state = resolveRangeInteractionVisualState({ ...defaults, alwaysShowPowerRange: true, previewEntityIds: ["sprinkler"] });
    expect(state.highlightedEntityIds).toEqual(new Set(["intersecting"]));
    expect(state.visibleRangeKeys.size).toBe(2);
  });
  it("普通移动保留交互并排除原件；批量移动不触发关联", () => {
    expect(resolveRangeInteractionVisualState({ ...defaults, activeTool: "move", moveKind: "ordinary",
      ghostEntityIds: ["intersecting"], previewEntityIds: ["sprinkler"] }).highlightedEntityIds).toEqual(new Set(["pole"]));
    expect(resolveRangeInteractionVisualState({ ...defaults, activeTool: "move", moveKind: "batch",
      previewEntityIds: ["sprinkler"] }).highlightedEntityIds).toEqual(new Set());
  });
  it("浏览和多设备草稿不会默认常显洒水或供电范围", () => {
    expect(resolveRangeInteractionVisualState({ ...defaults, previewEntityIds: [] }).visibleRangeKeys.size).toBe(0);
    expect(resolveRangeInteractionVisualState({ ...defaults, previewEntityIds: ["sprinkler", "pole"] }).highlightedEntityIds.size).toBe(0);
  });
});
