// @vitest-environment node
import { describe, expect, it } from "vitest";
import type { BlueprintPlannerOptions, BlueprintPlannerProductionPlan } from "@/domain/blueprint-planner";
import { createRegistryContract } from "@/registry";
import { PlannerItemRules, collectPlannerItemBoundaries, findPlannerDisposalRecipe } from "@/shared/planner-item-policy";
import { PlannerSupplyRules } from "@/shared/planner-supply";
import input from "../blueprint-planner/fixtures/environment-supply.json";

const registry = createRegistryContract();
const options = input.options as BlueprintPlannerOptions;
const plan = input.plan as BlueprintPlannerProductionPlan;

describe("EDA 逐物品物流规则", () => {
  it("液体气体沿用暗管默认，允许独立外接，固体拒绝流体去向", () => {
    const defaults = new PlannerItemRules(registry, options);
    expect(defaults.output("item_liquid_sewage")).toBe("conduit");
    expect(defaults.output("item_gas_acid")).toBe("conduit");
    const rules = new PlannerItemRules(registry, { ...options, itemPolicies: [
      { itemId: "item_liquid_sewage", output: "external" }, { itemId: "item_gas_acid", output: "conduit" },
    ] });
    expect(rules.output("item_liquid_sewage")).toBe("external");
    expect(rules.output("item_gas_acid")).toBe("conduit");
    expect(() => new PlannerItemRules(registry, { ...options, itemPolicies: [
      { itemId: "item_filter_core", output: "external" },
    ] })).toThrow("输出方式无效");
  });

  it("处置能力只接受可施工真实设备，排除虚拟倾倒与外环专属设备", () => {
    expect(findPlannerDisposalRecipe(registry, "item_liquid_sewage", [])?.machineId).toBe("liquid_cleaner_1");
    expect(findPlannerDisposalRecipe(registry, "item_liquid_acid", [])).toBeUndefined();
    expect(findPlannerDisposalRecipe(registry, "item_gas_acid", [])).toBeUndefined();
  });
  it("默认规则沿用旧任务；单个物品覆盖不改变其他物品", () => {
    const rules = new PlannerItemRules(registry, { ...options, itemPolicies: [
      { itemId: "item_gas_acid", supply: "external" }, { itemId: "item_copper_nugget", output: "warehouse", byproducts: "output" },
    ] });
    expect(rules.supply("item_gas_acid")).toBe("external");
    expect(rules.supply("item_gas_xiranite")).toBe("conduit");
    expect(rules.output("item_copper_nugget")).toBe("warehouse");
    expect(rules.output("item_filter_core")).toBe("stash");
    expect(rules.byproducts("item_copper_nugget")).toBe("output");
    expect(rules.byproducts("item_filter_core")).toBe("destroy");
  });
  it("拒绝重复物品、未知物品、物态错误和无效处置值", () => {
    for (const policies of [
      [{ itemId: "item_gas_acid", supply: "warehouse" }], [{ itemId: "item_copper_nugget", supply: "conduit" }],
      [{ itemId: "item_gas_acid", output: "stash" }], [{ itemId: "unknown" }],
      [{ itemId: "item_gas_acid" }, { itemId: "item_gas_acid" }], [{ itemId: "item_gas_acid", byproducts: "invalid" }],
    ]) expect(() => new PlannerItemRules(registry, { ...options, itemPolicies: policies as BlueprintPlannerOptions["itemPolicies"] })).toThrow();
  });
  it("物品列表只取任务的真实边界，并随环境路线切换更新", () => {
    const boundaries = (current: BlueprintPlannerProductionPlan) => collectPlannerItemBoundaries(registry, current, new PlannerSupplyRules(registry, current).view());
    const original = JSON.stringify(plan);
    const production = boundaries(plan);
    expect(production.find(row => row.itemId === "item_gas_acid")).toBeUndefined();
    expect(production.find(row => row.itemId === "item_liquid_acid")).toMatchObject({ supply: true });
    expect(production.find(row => row.itemId === "item_gas_copper_enr2")).toMatchObject({ output: true, supply: false });
    const external = boundaries({ ...plan, supplyPolicies: [{ itemId: "item_gas_acid", source: "external" }] });
    expect(external.find(row => row.itemId === "item_gas_acid")).toMatchObject({ supply: true });
    expect(external.find(row => row.itemId === "item_liquid_acid")).toBeUndefined();
    expect(external.find(row => row.itemId === "item_gas_xiranite")).toMatchObject({ supply: true });
    expect(JSON.stringify(plan)).toBe(original);
  });
});
