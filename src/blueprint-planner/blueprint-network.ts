import type { BlueprintPlannerBlueprintInput, BlueprintPlannerOptions, BlueprintPlannerRequest } from "@/domain/blueprint-planner";
import type { RegistryContract } from "@/domain/registry/registry-contract";
import type { SimulationBlueprintRunReport, SimulationBlueprintRunRequest } from "@/domain/simulation";
import { resolveEntityGridRect } from "@/shared/geometry/power-range";
import { CONSUMPTION_RECIPE_TAG } from "@/shared/consumption-channel";
import { getPlannerPorts } from "./geometry";
import { assertBlueprintRecognition, assertBlueprintSteadyState } from "./blueprint-analysis";
import type { PlannerCandidate } from "./candidate";
import type { PlannerNetwork, PlannerNode, PlannerWire } from "./model";
import { capturePlannerSeed } from "./search-seed";
import { excludeDisconnectedBlueprintPipes } from "./blueprint-disconnections";

/** 设备数量与端口身份来自原图，流量来自实测；不借产线求解器重建主体设备。 */
export function identifyBlueprintNetwork(registry: RegistryContract, input: BlueprintPlannerBlueprintInput,
  options: BlueprintPlannerOptions, execution: SimulationBlueprintRunRequest, report: SimulationBlueprintRunReport) {
  // 2026-10-08：网表只包含有效支路；公开请求仍携带完整原图，以便导出和重新识别。
  const originalInput = input;
  input = excludeDisconnectedBlueprintPipes(registry, input).input;
  const graph = assertBlueprintRecognition(registry, input, report), analysis = report.analysis!;
  assertBlueprintSteadyState(registry, report, execution.probes);
  const targets = report.probes.filter(probe => execution.probes.find(entry => entry.id === probe.id)?.direction === "input")
    .map(probe => ({ itemId: probe.id, perMinute: probe.perMinute - (report.probes.find(entry => entry.id === `input:${probe.id}`)?.perMinute ?? 0) }))
    .filter(target => target.perMinute > 1e-6);
  if (!targets.length) throw new Error("出口没有持续净产出，无法建立产率基线。");
  const request: BlueprintPlannerRequest = { blueprintSource: structuredClone(originalInput), options: { ...options, solidOutput: "warehouse", itemPolicies: [] },
    plan: { name: input.blueprint.name, sourceBaseId: input.blueprint.baseId, targets, recipes: [], externalSupplies: [],
      infiniteItemIds: [...new Set(input.boundaries.filter(entry => entry.direction === "input").map(entry => entry.itemId!))],
      byproductItemIds: [], containsModules: false, unresolvedPerMinute: 0, activeActivityIds: input.activeActivityIds } };
  const boundaries = new Map(input.boundaries.map(boundary => [boundary.entityId, boundary]));
  const track = (id: string) => {
    const entity = input.blueprint.entities[id];
    return entity && !boundaries.has(id) && Object.keys(entity.config).length === 0 && entity.tags.length === 0
      && (registry.queries.isBelt(entity.definitionId) || registry.queries.isPipe(entity.definitionId));
  };
  const nodes: PlannerNode[] = input.blueprint.entityOrder.filter(id => !track(id)).map(id => {
    const entity = structuredClone(input.blueprint.entities[id]!);
    const definition = registry.queries.findEntityDefinition(entity.definitionId)!;
    const channels = analysis.channels.filter(channel => channel.entityId === id);
    const recipes = channels.flatMap(channel => channel.observedRecipeIds.length ? channel.observedRecipeIds : channel.manual && channel.configuredRecipeId
      ? [channel.configuredRecipeId] : channel.consumption ? [...graph.possibleRecipes.get(`${id}/${channel.channelId}`) ?? []] : [])
      .map(id => registry.queries.findRecipeDefinition(id)!)
      .filter(recipe => recipe && !["transport", "warehouse"].includes(recipe.recipeType));
    const recipe = recipes.find(recipe => recipe.gasDiffusionOutput) ?? recipes.find(recipe => !recipe.tags.includes(CONSUMPTION_RECIPE_TAG)) ?? null;
    const boundary = boundaries.get(id);
    const purpose: PlannerNode["purpose"] = boundary ? boundary.direction === "input" ? "supply" : "product"
      : recipe?.gasDiffusionOutput ? "environment" : registry.queries.isGeneralLogisticsDevice(definition.id) ? "logistics"
        : definition.powerRange ? "power" : "production";
    const port = boundary?.kind === "port" ? getPlannerPorts(registry, entity, definition, boundary.direction)
      .find(port => definition.portGroups[port.groupIndex]!.id === boundary.portGroupId
        && definition.portGroups[port.groupIndex]!.ports[port.portIndex]!.id === boundary.portId) : undefined;
    return { entity, definition, recipe, purpose, inputs: [], outputs: [],
      ...(port ? { boundaryPort: { direction: port.direction, groupIndex: port.groupIndex, portIndex: port.portIndex } } : {}) };
  });
  const byId = new Map(nodes.map(node => [node.entity.id, node]));
  const physicalPort = (id: string) => {
    const port = graph.ports.get(id)!;
    const entity = input.blueprint.entities[port.entityId]!, definition = registry.queries.findEntityDefinition(entity.definitionId)!;
    const result = getPlannerPorts(registry, entity, definition, port.direction)
      .find(candidate => definition.portGroups[candidate.groupIndex]!.id === port.groupId
        && definition.portGroups[candidate.groupIndex]!.ports[candidate.portIndex]!.id === port.portId);
    if (!result) throw new Error(`无法识别物理端口：${id}`);
    return result;
  };
  const wires: PlannerWire[] = [];
  const routes: NonNullable<PlannerCandidate["seed"]>["routes"] = [];
  for (const connection of analysis.connections) {
    const source = graph.ports.get(connection.sourcePortId), firstTarget = graph.ports.get(connection.targetPortId);
    if (!source || !firstTarget || !byId.has(source.entityId) || !input.blueprint.entities[firstTarget.entityId]) continue;
    let target = firstTarget;
    const cells: { x: number; y: number }[] = [], visited = new Set<string>();
    while (track(target.entityId)) {
      if (visited.has(target.entityId)) throw new Error(`无法确定物流回路终点：${target.entityId}`);
      visited.add(target.entityId); cells.push(input.blueprint.entities[target.entityId]!.position);
      const outputs = analysis.ports.filter(port => port.entityId === target.entityId && port.direction === "output");
      const next = analysis.connections.filter(edge => outputs.some(port => port.id === edge.sourcePortId));
      if (next.length !== 1) throw new Error(`无法确定物流路径：${target.entityId}`);
      target = graph.ports.get(next[0]!.targetPortId)!;
    }
    if (!byId.has(target.entityId)) continue;
    const itemIds = [...graph.items.get(source.id) ?? []];
    if (itemIds.length !== 1) throw new Error(`无法识别线路物品：${source.entityId} → ${target.entityId}`);
    const observed = analysis.transfers.filter(row => row.sourcePortId === source.id && row.itemId === itemIds[0]);
    const perMinute = observed.reduce((sum, row) => sum + row.windowAmounts.reduce((a, b) => a + b, 0), 0) * 60 / report.observationSeconds;
    if (!Number.isFinite(perMinute) || perMinute < 0) throw new Error(`线路运行观测无效：${source.entityId} → ${target.entityId}`);
    const from = physicalPort(source.id), to = physicalPort(target.id);
    wires.push({ source: from, target: to, itemIds, perMinute });
    const sourceGroup = registry.queries.findEntityDefinition(byId.get(source.entityId)!.entity.definitionId)!.portStorageBindings
      .filter(binding => binding.portGroupId === source.groupId).map(binding => binding.storageSlotGroupId);
    const targetGroup = registry.queries.findEntityDefinition(byId.get(target.entityId)!.entity.definitionId)!.portStorageBindings
      .filter(binding => binding.portGroupId === target.groupId).map(binding => binding.storageSlotGroupId);
    byId.get(source.entityId)!.outputs.push({ itemId: itemIds[0]!, perMinute, storageGroupIds: sourceGroup });
    byId.get(target.entityId)!.inputs.push({ itemId: itemIds[0]!, perMinute, storageGroupIds: targetGroup });
    routes.push({ source: source.entityId, target: target.entityId,
      sourcePort: `${source.entityId}/${from.groupIndex}/${from.portIndex}`, targetPort: `${target.entityId}/${to.groupIndex}/${to.portIndex}`,
      sourceEdge: from.edge, targetEdge: to.edge, cells, turns: 0 });
  }
  const rectangles = input.blueprint.entityOrder.map(id => resolveEntityGridRect({ entity: input.blueprint.entities[id]!,
    definition: registry.queries.findEntityDefinition(input.blueprint.entities[id]!.definitionId)! }));
  const left = Math.min(...rectangles.map(rect => rect.x)), top = Math.min(...rectangles.map(rect => rect.y));
  const width = Math.max(...rectangles.map(rect => rect.x + rect.width)) - left;
  const height = Math.max(...rectangles.map(rect => rect.y + rect.height)) - top;
  const network: PlannerNetwork = { request, nodes, slotLinks: structuredClone(input.blueprint.slotLinks),
    initialSlots: [], preferredGasCount: nodes.filter(node => node.purpose === "environment").length };
  const seed = capturePlannerSeed(request, network, wires, routes, width, height, { x: left, y: top });
  const candidate: PlannerCandidate = { seed, execution,
    supplyAudit: { operatingLimits: [], splitterCount: 0, bufferedAdmissions: 0 }, connections: [],
    metrics: { width, height, area: width * height, entityCount: input.blueprint.entityOrder.length,
      productionDeviceCount: nodes.filter(node => node.purpose === "production").length,
      gasDiffuserCount: network.preferredGasCount, additionalGasDiffuserCount: 0, score: width * height },
    search: { strategy: "compact", seed: 0, evaluationLimit: options.evaluationsPerRound, outline: { width, height },
      evaluations: 0, acceptedMoves: 0, routingAttempts: 0, initialWireLength: 0, finalWireLength: 0 } };
  return { request, candidate };
}
