// AI-REMOVED 2026-10-13:
// Reason: observer 隔离不变任务输入的重复渲染，翻译读取也需要参与观察。
// Trigger: EDA 进度刷新引起整张流程图重复分配。
// Evidence: round-06-fixed4-mainprofile 的 FlowNode / FlowEdge 分配热点。
// Replacement: 下方 observer；Risk: 语言切换必须继续更新；Human Review: Required
// Original code: import { useMemo } from "react";
import { observer } from "mobx-react-lite";
import type { BlueprintPlannerOptions, BlueprintPlannerProductionPlan } from "@/domain/blueprint-planner";
import type { RegistryContract } from "@/domain/registry/registry-contract";
import { createEntityIconAssetUrl, createItemIconAssetUrl } from "@/shared/browser/public-asset-url";
import { ProductionFlowGraph, type ProductionFlowGraphInput } from "./flow";
import { PlannerItemRules, findPlannerDisposalRecipe, plannerDisposalItem } from "@/shared/planner-item-policy";
import styles from "./production-planning-panel.module.scss";

/** 任务输入使用已归一化的配方流量；连接表示物料依赖，不冒充已求解的物理端口。 */
export const PlannerTaskFlow = observer(function PlannerTaskFlow({ plan, registry, options, t }: { plan: BlueprintPlannerProductionPlan;
  options?: BlueprintPlannerOptions;
  registry: RegistryContract; t: (key: string) => string }) {
  // AI-REMOVED 2026-10-13:
  // Reason: 固定翻译函数引用不能表达 locale 的可观察变化。
  // Trigger: 隔离进度刷新后仍须保留语言切换；Evidence: translate 读取设置中的 locale。
  // Replacement: observer 内直接构建；Risk: Low；Human Review: Required
  // Original code: const input = useMemo(() => buildPlannerTaskFlow(plan, registry, t), [plan, registry, t]);
  const input = buildPlannerTaskFlow(plan, registry, t, options);
  const byproducts = options ? input.nodes.filter(node => node.tone === "byproduct") : [];
  return <div className={styles["production-planning-task-flow"]}>
    <ProductionFlowGraph input={input} displayMode="device" fitToView interactionMode="browse" t={t} />
    {byproducts.length ? <ul className={styles["production-planning-task-byproducts"]} aria-label={t("productionPlanning.byproduct")}>
      {byproducts.map(node => <li key={node.id}><strong>{node.title}</strong><span>{node.subtitle}</span></li>)}
    </ul> : null}
  </div>;
});

export function buildPlannerTaskFlow(plan: BlueprintPlannerProductionPlan, registry: RegistryContract,
  t: (key: string) => string, options?: BlueprintPlannerOptions): ProductionFlowGraphInput {
  const graph: ProductionFlowGraphInput = { nodes: [], links: [] };
  const rules = options ? new PlannerItemRules(registry, options) : null;
  const sources = new Map<string, { id: string; remaining: number }[]>();
  const demands: { id: string; itemId: string; amount: number }[] = [];
  const itemName = (id: string) => { const item = registry.queries.findItemDefinition(id); return item ? t(item.nameKey) : id; };
  const addSource = (id: string, itemId: string, amount: number) => {
    const entries = sources.get(itemId) ?? [];
    entries.push({ id, remaining: amount }); sources.set(itemId, entries);
  };
  const addItem = (id: string, itemId: string, amount: number, tone: "source" | "normal" | "byproduct" | "unresolved") => {
    const item = registry.queries.findItemDefinition(itemId);
    const prefersDisposal = tone === "byproduct" && !plan.targets.some(target => target.itemId === itemId)
      && rules?.byproducts(itemId) === "destroy";
    const output = rules?.output(itemId);
    const policyLabel = prefersDisposal ? t(findPlannerDisposalRecipe(registry, itemId, plan.activeActivityIds)
      ? "eda.byproductHandled" : "eda.byproductNotDisposable")
      : rules && tone === "byproduct" ? t(output === "external" ? "eda.externalOutput" : output === "conduit" ? "eda.conduitOutput"
        : output === "warehouse" ? "eda.warehouseOutput" : output === "stash" ? "eda.stashOutput" : "eda.autoOutput") : "";
    graph.nodes.push({ id, kind: "item", tone, title: itemName(itemId), subtitle: `${Number(amount.toFixed(2))}/min${policyLabel ? ` · ${policyLabel}` : ""}`,
      itemId, iconSrcs: item ? [createItemIconAssetUrl(item.iconId)] : [] });
  };
  plan.externalSupplies.forEach((flow, index) => {
    const id = `supply:${index}`;
    addItem(id, flow.itemId, flow.perMinute, "source"); addSource(id, flow.itemId, flow.perMinute);
  });
  plan.recipes.forEach((recipe, index) => {
    const definition = registry.queries.findRecipeDefinition(recipe.recipeId);
    // 2026-10-29：上方保留原始副产物边界，处置状态由下方设置说明，不把计算器旧处置节点当作当前输出去向。
    const disposalItem = definition && plannerDisposalItem(definition);
    if (rules && disposalItem && plan.byproductItemIds.includes(disposalItem)) return;
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
      // 2026-10-29：缺口是未满足需求，不能画成用户已经声明的外部原料。
      // 2026-10-29：明确声明的无限供给是真实来源，其余未覆盖需求才标为缺口。
      addItem(id, demand.itemId, remaining, plan.infiniteItemIds.includes(demand.itemId) ? "source" : "unresolved");
      link(id, demand.id, demand.itemId, remaining);
    }
  }
  for (const [itemId, entries] of sources) for (const source of entries) if (source.remaining > 1e-6) {
    const id = `byproduct:${graph.nodes.length}`;
    addItem(id, itemId, source.remaining, "byproduct"); link(source.id, id, itemId, source.remaining);
  }
  return graph;
}
