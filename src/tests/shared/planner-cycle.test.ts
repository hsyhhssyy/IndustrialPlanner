import { describe, expect, it } from "vitest";
import { findPlannerCycleIssues } from "@/shared/planner-cycle";

const flow = (itemId: string, perMinute: number) => ({ itemId, perMinute });
const recipe = (input: string, inputRate: number, output: string, outputRate: number) => ({
  inputs: [flow(input, inputRate)], outputs: [flow(output, outputRate)],
});

describe("循环物料守恒", () => {
  const recipes = [recipe("a", 60, "b", 120), recipe("b", 120, "a", 60)];
  it.each([0, 20, 59])("有限外供 %s/min 不能补足零净产回路的 60/min 目标", supplied => {
    const issues = findPlannerCycleIssues({ recipes, targets: [flow("a", 60)],
      externalSupplies: [flow("a", supplied)], infiniteItemIds: new Set() });
    expect(issues).toEqual([expect.objectContaining({
      path: ["a", "b", "a"], shortfalls: [flow("a", 60 - supplied)],
    })]);
  });
  it("足量持续外供和明确无限外供可以使零净产回路合法", () => {
    for (const [externalSupplies, infiniteItemIds] of [
      [[flow("a", 60)], new Set<string>()], [[], new Set(["a"])],
    ] as const) expect(findPlannerCycleIssues({ recipes, targets: [flow("a", 60)], externalSupplies, infiniteItemIds })).toEqual([]);
  });
  it("有对外净产出的增殖回流保持合法", () => {
    expect(findPlannerCycleIssues({ recipes: [recipe("a", 30, "b", 60), recipe("b", 60, "a", 60)],
      targets: [flow("a", 30)], externalSupplies: [], infiniteItemIds: new Set() })).toEqual([]);
  });
  it("识别三物料循环和实际闭合路径", () => {
    const issues = findPlannerCycleIssues({ recipes: [recipe("a", 10, "b", 10), recipe("b", 10, "c", 10), recipe("c", 10, "a", 10)],
      targets: [flow("a", 1)], externalSupplies: [], infiniteItemIds: new Set() });
    expect(issues[0]?.path).toEqual(["a", "c", "b", "a"]);
    expect(issues[0]?.shortfalls).toEqual([flow("a", 1)]);
  });
  it("没有循环的普通缺料不误标为错误循环", () => {
    expect(findPlannerCycleIssues({ recipes: [recipe("a", 60, "b", 60)], targets: [flow("b", 60)],
      externalSupplies: [], infiniteItemIds: new Set() })).toEqual([]);
  });
  it("单物料运行回流按净产判断，不能靠启动库存掩盖持续亏损", () => {
    expect(findPlannerCycleIssues({ recipes: [recipe("a", 12, "a", 30)], targets: [flow("a", 18)],
      externalSupplies: [], infiniteItemIds: new Set() })).toEqual([]);
    expect(findPlannerCycleIssues({ recipes: [recipe("a", 30, "a", 30)], targets: [flow("a", 1)],
      externalSupplies: [], infiniteItemIds: new Set() })[0]?.path).toEqual(["a", "a"]);
  });
});
