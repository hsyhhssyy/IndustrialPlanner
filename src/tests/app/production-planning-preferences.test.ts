import { describe, expect, it } from "vitest";
import { createRegistryContract } from "@/registry";
import { buildProductionPlanningIndex, type ProductionPlanningRequest } from "@/app/shell/production-planning/production-planning-model";
import { reconcileProductionPlanningRecipeChoices } from "@/app/shell/production-planning/production-planning-preferences";
import { createProductionPlanningRecipeCandidateId } from "@/app/shell/production-planning/production-planning-candidate";

const registry = createRegistryContract();
const index = buildProductionPlanningIndex(registry);
const target = (itemId: string, id = itemId) => ({ id, itemId, perMinute: 30 });
const choices = new Map([
  ["item_gas_xiranite", createProductionPlanningRecipeCandidateId("liquid_transmuter_2_gas_gas_xiranite_1")],
  ["item_xiranite_powder", createProductionPlanningRecipeCandidateId("xiranite_oven_xiranite_powder_1")],
  ["item_copper_enr2", createProductionPlanningRecipeCandidateId("liquid_transmuter_2_solid_copper_enr2_1")],
]);
const request = (ids: string[]): ProductionPlanningRequest => ({
  targets: ids.map(id => target(id)), supplies: [], infiniteItemIds: new Set(), recipeChoices: choices,
  sourceConfig: { waterPolicy: "use-byproduct", acidPolicy: "use-byproduct", sewagePolicy: "external-supply",
    waterPurifierPolicy: "disabled", includeDeviceMinimumConsumption: "none" },
});

describe("配方偏好随目标关联清理", () => {
  it("删除一个目标后保留其他目标的共享上游与运行耗材，只删除失去关联的目标配方", () => {
    const previous = [target("item_copper_enr2"), target("item_gas_copper")];
    const retained = reconcileProductionPlanningRecipeChoices(previous, request(["item_gas_copper"]), index);
    expect(Object.fromEntries(retained)).toEqual(Object.fromEntries([...choices].filter(([id]) => id !== "item_copper_enr2")));
  });
  it("更换为完全无关目标时清空旧路线偏好，原目标仍保留时添加无关目标不清理共同路线", () => {
    const previous = [target("item_copper_enr2")];
    expect(reconcileProductionPlanningRecipeChoices(previous, request(["item_iron_nugget"]), index).size).toBe(0);
    expect(reconcileProductionPlanningRecipeChoices(previous, request(["item_copper_enr2", "item_iron_nugget"]), index)).toEqual(choices);
  });
  it("外供暂时隐藏共同上游时仍保留对应偏好，显示设置不决定运行耗材的归属", () => {
    const next = request(["item_gas_copper"]);
    next.supplies = [{ ...target("item_xiranite_powder"), isInfinite: true }];
    next.infiniteItemIds = new Set(["item_gas_xiranite"]);
    expect(reconcileProductionPlanningRecipeChoices([target("item_copper_enr2"), target("item_gas_copper")], next, index))
      .toEqual(new Map([...choices].filter(([id]) => id !== "item_copper_enr2")));
  });
  it("同一目标改产量、行号或删除重复行时保留偏好，不进行来源重选", () => {
    const next = request(["item_copper_enr2"]);
    next.targets = [{ ...next.targets[0]!, id: "replacement-row", perMinute: 300 }];
    const result = reconcileProductionPlanningRecipeChoices([target("item_copper_enr2", "a"), target("item_copper_enr2", "b")], next, index);
    expect(result).toBe(choices);
  });
  it("删除全部目标时清空，仍未填写产量的目标按结构保留相关偏好", () => {
    expect(reconcileProductionPlanningRecipeChoices([target("item_copper_enr2")], request([]), index).size).toBe(0);
    const next = request(["item_gas_copper"]);
    next.targets = next.targets.map(port => ({ ...port, perMinute: 0 }));
    expect(reconcileProductionPlanningRecipeChoices([target("item_copper_enr2")], next, index).has("item_gas_xiranite")).toBe(true);
  });
  it("选中模块的输入及联产物进入保留范围，不能仅按系统配方查依赖", () => {
    const moduleIndex = buildProductionPlanningIndex(registry, { modules: [{
      schemaVersion: 2, id: "preference-module", sourceType: "custom", name: "module", color: "#4f8cff",
      iconItemIds: [], notes: "", inputs: [{ itemId: "item_gas_xiranite", perMinute: 30 }],
      outputs: [{ itemId: "item_copper_enr2", perMinute: 30 }, { itemId: "item_iron_nugget", perMinute: 30 }],
    }] });
    const next = request(["item_copper_enr2"]);
    next.useModules = true;
    next.recipeChoices = new Map([...choices, ["item_copper_enr2", "module:custom:preference-module"]]);
    expect(reconcileProductionPlanningRecipeChoices([target("item_iron_nugget")], next, moduleIndex)).toEqual(next.recipeChoices);
  });
});
