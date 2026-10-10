import type { BlueprintPlannerBlueprintInput, BlueprintPlannerOptions, BlueprintPlannerRequest } from "@/domain/blueprint-planner";
import type { RegistryContract } from "@/domain/registry/registry-contract";
import type { SimulationBlueprintAnalysis, SimulationBlueprintRunRequest } from "@/domain/simulation";
import { PlannerSupplyRules } from "@/shared/planner-supply";
import { blueprintMaterialGraph } from "./blueprint-analysis";
import { createRecipeNode } from "./production-network";
import { createPlainNode } from "./placement";
import { getPlannerPorts, transportCapacity } from "./geometry";
import type { PlannerNetwork, PlannerWire } from "./model";
import { scheduleConverterStartups, converterStartupTimes } from "./support";

/** 冷态原图在识别阶段同样按耗材依赖选择手动启动根，不向每台转化机补料。 */
export function withBlueprintConverterStartup(registry: RegistryContract, input: BlueprintPlannerBlueprintInput,
  options: BlueprintPlannerOptions, analysis: SimulationBlueprintAnalysis, execution: SimulationBlueprintRunRequest): SimulationBlueprintRunRequest {
  if (options.converterStartup !== "manual" && options.converterStartup !== "tank") return execution;
  // 储罐模式的原图允许先用一次补料测量基线；该参考图不得直接作为携罐交付结果。
  const request: BlueprintPlannerRequest = { options: { ...options, converterStartup: "manual" }, plan: { name: input.blueprint.name, sourceBaseId: input.blueprint.baseId,
    targets: [], externalSupplies: [], recipes: [], infiniteItemIds: [], byproductItemIds: [], containsModules: false,
    unresolvedPerMinute: 0, activeActivityIds: input.activeActivityIds } };
  const graph = blueprintMaterialGraph(registry, execution.blueprint, analysis, input.boundaries, input.activeActivityIds);
  const rules = new PlannerSupplyRules(registry, request.plan, "manual");
  const nodes = execution.blueprint.entityOrder.map(id => {
    const entity = execution.blueprint.entities[id]!;
    const channels = analysis.channels.filter(channel => channel.entityId === id);
    const recipes = [...new Set([...channels.flatMap(channel => channel.configuredRecipeId ? [channel.configuredRecipeId] : channel.observedRecipeIds),
      ...graph.possibleRecipes.get(id) ?? []])].map(id => registry.queries.findRecipeDefinition(id)).filter(recipe => recipe && rules.selfConsumption(recipe));
    if (recipes.length === 1) return { ...createRecipeNode(registry, recipes[0]!, id, 60 / recipes[0]!.durationSeconds, "production"), entity };
    const purpose = input.boundaries.some(boundary => boundary.entityId === id && boundary.direction === "input") ? "supply" : "logistics";
    return { ...createPlainNode(registry, entity.definitionId, id, purpose), entity };
  });
  const byId = new Map(nodes.map(node => [node.entity.id, node]));
  const items = new Set(nodes.flatMap(node => node.recipe ? [rules.selfConsumption(node.recipe)!.itemId] : []));
  if (!items.size) return execution;
  const resolve = (id: string) => {
    const observed = graph.ports.get(id), node = observed && byId.get(observed.entityId);
    return node && observed && getPlannerPorts(registry, node.entity, node.definition, observed.direction)
      .find(port => node.definition.portGroups[port.groupIndex]!.id === observed.groupId
        && node.definition.portGroups[port.groupIndex]!.ports[port.portIndex]!.id === observed.portId);
  };
  const wires: PlannerWire[] = analysis.connections.flatMap(edge => {
    const source = resolve(edge.sourcePortId), target = resolve(edge.targetPortId);
    const itemIds = [...graph.items.get(edge.sourcePortId) ?? []];
    return source && target && itemIds.length ? [{ source, target, itemIds, perMinute: 0 }] : [];
  });
  const network: PlannerNetwork = { request, nodes, slotLinks: [], initialSlots: [], preferredGasCount: 0 };
  // 按全图运输格数给上游留足到达时间；只影响独立识别场景，不写回主体库存配置。
  // 订正 2026-10-09：按实际依赖的最长到达路径估时，保留蓝图识别固定 360 秒预热。
  // AI-REMOVED 2026-10-09: 全网串联过度估计时序；Trigger: 五机被推迟至 534 秒；Evidence: 冷态验证。
  // Replacement: converterStartupTimes；Risk: 过长依赖仍可能超出预热；Human Review: Required。
  // Original code:
  // const delay = 10 + nodes.reduce((sum, node) => sum + (registry.queries.isBelt(node.definition.id) ? 2
  //   : registry.queries.isPipeFamily(node.definition.id) ? 0.5 : node.recipe?.durationSeconds ?? 0), 0);
  const arrival = converterStartupTimes(network, wires, wires.map(wire => 60 / transportCapacity(wire.source.kind)), 0);
  const scheduledSlots = scheduleConverterStartups(registry, network, id => arrival.get(id)! + 10, wires);
  return { ...execution, scene: { ...execution.scene, scheduledSlots } };
}
