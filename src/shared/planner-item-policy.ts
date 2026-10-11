import type { BlueprintPlannerBlueprintInput, BlueprintPlannerItemPolicy, BlueprintPlannerOptions, BlueprintPlannerProductionPlan } from "@/domain/blueprint-planner";
import type { RegistryContract } from "@/domain/registry/registry-contract";
import { ItemDomainFlag } from "@/domain/shared/item-domain-flags";
import type { PlannerSupplyView } from "./planner-supply";

/** 接入和处置规则不参与自产／外供来源判断；缺省值沿用任务本身的设置。 */
export class PlannerItemRules {
  private readonly policies = new Map<string, BlueprintPlannerItemPolicy>();
  constructor(private readonly registry: RegistryContract, private readonly options: BlueprintPlannerOptions) {
    if (options.itemPolicies !== undefined && !Array.isArray(options.itemPolicies)) throw new Error("物品规则必须为数组。");
    for (const policy of options.itemPolicies ?? []) {
      if (!policy || typeof policy.itemId !== "string" || !registry.queries.findItemDefinition(policy.itemId)
        || this.policies.has(policy.itemId)) throw new Error("物品规则包含无效或重复的物品。");
      const solid = this.isSolid(policy.itemId);
      if (policy.supply !== undefined && !(solid ? ["external", "warehouse"] : ["external", "conduit"]).includes(policy.supply)) {
        throw new Error(`物品接入方式与物态不匹配：${policy.itemId}`);
      }
      if (policy.output !== undefined && (!solid || !["auto", "warehouse", "stash"].includes(policy.output))) {
        throw new Error(`物品输出方式无效：${policy.itemId}`);
      }
      if (policy.byproducts !== undefined && !["destroy", "output"].includes(policy.byproducts)) throw new Error(`物品剩余处理方式无效：${policy.itemId}`);
      this.policies.set(policy.itemId, policy);
    }
  }
  isSolid(itemId: string): boolean { return this.registry.queries.resolveItemDomain(itemId) === ItemDomainFlag.Solid; }
  supply(itemId: string): NonNullable<BlueprintPlannerItemPolicy["supply"]> {
    return this.policies.get(itemId)?.supply ?? (this.isSolid(itemId) ? this.options.solidSupply : this.options.fluidSupply);
  }
  requiresWarehouseSupply(itemId: string): boolean {
    return this.options.warehousePortPlacement === "full-side" && this.isSolid(itemId) && this.supply(itemId) !== "warehouse";
  }
  output(itemId: string): NonNullable<BlueprintPlannerItemPolicy["output"]> {
    return this.policies.get(itemId)?.output ?? this.options.solidOutput;
  }
  byproducts(itemId: string): NonNullable<BlueprintPlannerItemPolicy["byproducts"]> {
    return this.policies.get(itemId)?.byproducts ?? this.options.byproducts;
  }
}

export interface PlannerItemBoundary {
  readonly itemId: string;
  readonly supply: boolean;
  readonly output: boolean;
  readonly byproducts: boolean;
}

/** 从任务的物料边界与环境补料路线建立编辑范围，不让 EDA 重选主产线来源。 */
export function collectPlannerItemBoundaries(
  registry: RegistryContract, plan: BlueprintPlannerProductionPlan, environment: PlannerSupplyView,
): readonly PlannerItemBoundary[] {
  const rows = new Map<string, PlannerItemBoundary>();
  const add = (itemId: string, kind: "supply" | "output" | "byproducts") => {
    rows.set(itemId, { itemId, supply: false, output: false, byproducts: false, ...rows.get(itemId), [kind]: true });
  };
  const balance = new Map<string, number>();
  const accumulate = (itemId: string, rate: number) => balance.set(itemId, (balance.get(itemId) ?? 0) + rate);
  const sources = new Set([...plan.externalSupplies.map(flow => flow.itemId), ...plan.infiniteItemIds]);
  const produced = new Set<string>();
  for (const entry of plan.recipes) {
    const recipe = registry.queries.findRecipeDefinition(entry.recipeId);
    if (recipe?.tags.includes("自然资源采集")) {
      for (const output of entry.outputs) sources.add(output.itemId);
      continue;
    }
    for (const output of entry.outputs) { produced.add(output.itemId); accumulate(output.itemId, output.perMinute); }
    for (const input of [...entry.inputs, ...entry.runningInputs]) accumulate(input.itemId, -input.perMinute);
  }
  for (const target of plan.targets) { add(target.itemId, "output"); accumulate(target.itemId, -target.perMinute); }
  for (const [itemId, rate] of balance) {
    if (rate < -1e-6 && (sources.has(itemId) || (!produced.has(itemId) && registry.queries.findItemDefinition(itemId)?.tags.includes("自然资源")))) add(itemId, "supply");
    if (rate > 1e-6 && !plan.targets.some(target => target.itemId === itemId)) { add(itemId, "byproducts"); add(itemId, "output"); }
  }
  for (const row of environment.rows) {
    if (row.policy?.source === "external") add(row.itemId, "supply");
    if (!row.inherited && row.policy?.source === "production") {
      const recipe = registry.queries.findRecipeDefinition(row.policy.recipeId);
      for (const output of recipe?.outputs ?? []) if (output.itemId !== row.itemId) {
        // 辅助产能尚未量化：同时被其他路线消耗的副产物也可能有剩余，不能提前隐藏处置规则。
        if (!plan.targets.some(target => target.itemId === output.itemId)) add(output.itemId, "byproducts");
        add(output.itemId, "output");
      }
    }
  }
  return [...rows.values()];
}

/** 原图保留设备身份；配置为仓库供货不能把传送带入口伪装成仓库取货口。 */
export function invalidBlueprintWarehouseSupplies(registry: RegistryContract,
  input: BlueprintPlannerBlueprintInput,
  options: BlueprintPlannerOptions): string[] {
  if (options.warehousePortPlacement !== "full-side") return [];
  return input.boundaries.filter(boundary => boundary.direction === "input" && boundary.itemId
    && registry.queries.resolveItemDomain(boundary.itemId) === ItemDomainFlag.Solid
    && input.blueprint.entities[boundary.entityId]?.definitionId !== "unloader_1").map(boundary => boundary.entityId);
}
