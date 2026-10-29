import type { BlueprintPlannerFlow, BlueprintPlannerProductionPlan } from "@/domain/blueprint-planner";
import type { RegistryContract } from "@/domain/registry/registry-contract";
import { buildDeviceRunningConsumptionRecipesByMachine, resolveCompanionDeviceRunningConsumptionRecipe } from "./device-running-consumption";
import { lookupText } from "./i18n";

export interface PlannerCycleIssue {
  readonly itemIds: readonly string[];
  readonly path: readonly string[];
  readonly shortfalls: readonly BlueprintPlannerFlow[];
}

interface PlannerCycleInput {
  readonly recipes: readonly { readonly inputs: readonly BlueprintPlannerFlow[]; readonly outputs: readonly BlueprintPlannerFlow[] }[];
  readonly targets: readonly BlueprintPlannerFlow[];
  readonly externalSupplies: readonly BlueprintPlannerFlow[];
  readonly infiniteItemIds: ReadonlySet<string>;
}

/** 环只负责定位；逐物品净流量决定是否错误，不能把合法增殖回流一并拒绝。 */
export function findPlannerCycleIssues(input: PlannerCycleInput): PlannerCycleIssue[] {
  const epsilon = 1e-4;
  const edges = new Map<string, Set<string>>();
  const balance = new Map<string, number>();
  const add = (flow: BlueprintPlannerFlow, direction: number) => {
    balance.set(flow.itemId, (balance.get(flow.itemId) ?? 0) + direction * flow.perMinute);
  };
  for (const recipe of input.recipes) {
    const inputs = recipe.inputs.filter(flow => flow.perMinute > epsilon);
    for (const flow of recipe.inputs) add(flow, -1);
    for (const output of recipe.outputs) {
      add(output, 1);
      if (output.perMinute <= epsilon) continue;
      const dependencies = edges.get(output.itemId) ?? new Set<string>();
      for (const dependency of inputs) dependencies.add(dependency.itemId);
      edges.set(output.itemId, dependencies);
    }
  }
  for (const flow of input.externalSupplies) add(flow, 1);
  for (const flow of input.targets) add(flow, -1);

  const indexes = new Map<string, number>();
  const low = new Map<string, number>();
  const stack: string[] = [];
  const active = new Set<string>();
  const issues: PlannerCycleIssue[] = [];
  const visit = (itemId: string) => {
    const index = indexes.size;
    indexes.set(itemId, index);
    low.set(itemId, index);
    stack.push(itemId);
    active.add(itemId);
    for (const dependency of edges.get(itemId) ?? []) {
      if (!indexes.has(dependency)) {
        visit(dependency);
        low.set(itemId, Math.min(low.get(itemId)!, low.get(dependency)!));
      } else if (active.has(dependency)) {
        low.set(itemId, Math.min(low.get(itemId)!, indexes.get(dependency)!));
      }
    }
    if (low.get(itemId) !== index) return;
    const component: string[] = [];
    let member: string;
    do {
      member = stack.pop()!;
      active.delete(member);
      component.push(member);
    } while (member !== itemId);
    if (component.length === 1 && !edges.get(itemId)?.has(itemId)) return;
    const shortfalls = component.flatMap(id => {
      const rate = balance.get(id) ?? 0;
      return rate < -epsilon && !input.infiniteItemIds.has(id) ? [{ itemId: id, perMinute: -rate }] : [];
    });
    if (!shortfalls.length) return;

    // 从缺料物品寻找一条真实闭合路径；强连通分量的弹栈顺序并不保证边相邻。
    const origin = shortfalls[0]!.itemId;
    const members = new Set(component);
    const visited = new Set<string>();
    const findPath = (current: string, path: readonly string[]): readonly string[] | null => {
      visited.add(current);
      for (const next of edges.get(current) ?? []) {
        if (!members.has(next)) continue;
        if (next === origin) return [...path, origin];
        if (!visited.has(next)) {
          const found = findPath(next, [...path, next]);
          if (found) return found;
        }
      }
      return null;
    };
    issues.push({ itemIds: component, path: findPath(origin, [origin])!, shortfalls });
  };
  for (const itemId of edges.keys()) if (!indexes.has(itemId)) visit(itemId);
  return issues;
}

export function formatPlannerCycleIssue(issue: PlannerCycleIssue, itemName: (itemId: string) => string,
  labels = { cycle: "错误循环", missing: "缺少" }): string {
  const path = issue.path.map(itemName).join(" → ");
  const missing = issue.shortfalls.map(flow => `${itemName(flow.itemId)} ${flow.perMinute.toFixed(2)}/min`).join("、");
  return `${labels.cycle}：${path}；${labels.missing} ${missing}`;
}

/** EDA 不信任导入任务声明的流量或错误标志，按 Registry 重建实际加工与整台运行消耗。 */
export function assertPlannerTaskCycles(registry: RegistryContract, plan: BlueprintPlannerProductionPlan): void {
  const consumption = buildDeviceRunningConsumptionRecipesByMachine(registry.recipeDefinitions);
  const recipes = plan.recipes.flatMap(entry => {
    const recipe = registry.queries.findRecipeDefinition(entry.recipeId);
    if (!recipe) return [];
    const running = resolveCompanionDeviceRunningConsumptionRecipe(recipe, consumption);
    const count = Math.ceil(entry.deviceCount - 1e-6);
    const cycles = recipe.environmentOutput ? count * 60 / recipe.durationSeconds : entry.cyclesPerMinute;
    return [{
      inputs: recipe.tags.includes("自然资源采集") ? [] : [
        ...recipe.inputs.map(flow => ({ itemId: flow.itemId, perMinute: flow.amount * cycles })),
        ...(running?.inputs ?? []).map(flow => ({ itemId: flow.itemId, perMinute: flow.amount * 60 / running!.durationSeconds * count })),
      ],
      outputs: recipe.outputs.map(flow => ({ itemId: flow.itemId, perMinute: flow.amount * cycles })),
    }];
  });
  const issue = findPlannerCycleIssues({ recipes, targets: plan.targets, externalSupplies: plan.externalSupplies,
    infiniteItemIds: new Set(plan.infiniteItemIds) })[0];
  if (issue) throw new Error(formatPlannerCycleIssue(issue, itemId => {
    const item = registry.queries.findItemDefinition(itemId);
    return item ? lookupText("zh-CN", item.nameKey) ?? itemId : itemId;
  }));
}
