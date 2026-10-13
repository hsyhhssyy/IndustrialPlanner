// AI-REMOVED 2026-10-13:
// Reason: observer 隔离不变任务输入的重复渲染，翻译读取也需要参与观察。
// Trigger: EDA 进度刷新引起整张流程图重复分配。
// Evidence: round-06-fixed4-mainprofile 的 FlowNode / FlowEdge 分配热点。
// Replacement: 下方 observer；Risk: 语言切换必须继续更新；Human Review: Required
// Original code: import { useMemo } from "react";
import { observer } from "mobx-react-lite";
import type { BlueprintPlannerProductionPlan } from "@/domain/blueprint-planner";
import type { RegistryContract } from "@/domain/registry/registry-contract";
import { createEntityIconAssetUrl, createItemIconAssetUrl } from "@/shared/browser/public-asset-url";
import { ProductionFlowGraph, type ProductionFlowGraphInput } from "./flow";

/** 任务输入使用已归一化的配方流量；连接表示物料依赖，不冒充已求解的物理端口。 */
export const PlannerTaskFlow = observer(function PlannerTaskFlow({ plan, registry, t }: { plan: BlueprintPlannerProductionPlan;
  registry: RegistryContract; t: (key: string) => string }) {
  // AI-REMOVED 2026-10-13:
  // Reason: 固定翻译函数引用不能表达 locale 的可观察变化。
  // Trigger: 隔离进度刷新后仍须保留语言切换；Evidence: translate 读取设置中的 locale。
  // Replacement: observer 内直接构建；Risk: Low；Human Review: Required
  // Original code: const input = useMemo(() => buildPlannerTaskFlow(plan, registry, t), [plan, registry, t]);
  const input = buildPlannerTaskFlow(plan, registry, t);
  return <ProductionFlowGraph input={input} displayMode="device" fitToView interactionMode="browse" t={t} />;
});

export function buildPlannerTaskFlow(plan: BlueprintPlannerProductionPlan, registry: RegistryContract,
  t: (key: string) => string): ProductionFlowGraphInput {
  const graph: ProductionFlowGraphInput = { nodes: [], links: [] };
  const sources = new Map<string, { id: string; remaining: number }[]>();
  const demands: { id: string; itemId: string; amount: number }[] = [];
  const itemName = (id: string) => { const item = registry.queries.findItemDefinition(id); return item ? t(item.nameKey) : id; };
  const addSource = (id: string, itemId: string, amount: number) => {
    const entries = sources.get(itemId) ?? [];
    entries.push({ id, remaining: amount }); sources.set(itemId, entries);
  };
  const addItem = (id: string, itemId: string, amount: number, tone: "source" | "normal" | "byproduct") => {
    const item = registry.queries.findItemDefinition(itemId);
    graph.nodes.push({ id, kind: "item", tone, title: itemName(itemId), subtitle: `${Number(amount.toFixed(2))}/min`,
      itemId, iconSrcs: item ? [createItemIconAssetUrl(item.iconId)] : [] });
  };
  plan.externalSupplies.forEach((flow, index) => {
    const id = `supply:${index}`;
    addItem(id, flow.itemId, flow.perMinute, "source"); addSource(id, flow.itemId, flow.perMinute);
  });
  plan.recipes.forEach((recipe, index) => {
    const definition = registry.queries.findRecipeDefinition(recipe.recipeId);
    const device = definition ? registry.queries.findEntityDefinition(definition.machineId) : null;
    const id = `recipe:${index}`;
    graph.nodes.push({ id, kind: "recipe", tone: "normal", title: device ? t(device.nameKey) : recipe.recipeId,
      subtitle: `${Math.ceil(recipe.deviceCount - 1e-6)} ${t("eda.devices")}`, recipeId: recipe.recipeId,
      iconSrcs: [createEntityIconAssetUrl(device?.iconPath)] });
    for (const flow of recipe.outputs) addSource(id, flow.itemId, flow.perMinute);
    for (const flow of [...recipe.inputs, ...recipe.runningInputs]) demands.push({ id, itemId: flow.itemId, amount: flow.perMinute });
  });
  plan.targets.forEach((flow, index) => {
    const id = `target:${index}`; addItem(id, flow.itemId, flow.perMinute, "normal");
    demands.push({ id, itemId: flow.itemId, amount: flow.perMinute });
  });
  const link = (source: string, target: string, itemId: string, value: number) => {
    graph.links.push({ id: `link:${graph.links.length}`, source, target, value, itemId, title: itemName(itemId),
      label: `${Number(value.toFixed(2))}/min`, isDeviceMinimumConsumption: false });
  };
  for (const demand of demands) {
    let remaining = demand.amount;
    for (const source of sources.get(demand.itemId) ?? []) {
      const amount = Math.min(source.remaining, remaining);
      if (amount <= 1e-6) continue;
      link(source.id, demand.id, demand.itemId, amount);
      remaining -= amount; source.remaining -= amount;
    }
    if (remaining > 1e-6) {
      const id = `external:${graph.nodes.length}`;
      addItem(id, demand.itemId, remaining, "source"); link(id, demand.id, demand.itemId, remaining);
    }
  }
  for (const [itemId, entries] of sources) for (const source of entries) if (source.remaining > 1e-6) {
    const id = `byproduct:${graph.nodes.length}`;
    addItem(id, itemId, source.remaining, "byproduct"); link(source.id, id, itemId, source.remaining);
  }
  return graph;
}
