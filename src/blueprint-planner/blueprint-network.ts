import { findPowerRange } from "@/shared/geometry/entity-range";
import type { BlueprintPlannerBlueprintInput, BlueprintPlannerOptions, BlueprintPlannerRequest } from "@/domain/blueprint-planner";
import type { RegistryContract } from "@/domain/registry/registry-contract";
import type { SimulationBlueprintRunReport, SimulationBlueprintRunRequest } from "@/domain/simulation";
import { resolveEntityGridRect } from "@/shared/geometry/power-range";
import { CONSUMPTION_RECIPE_TAG } from "@/shared/consumption-channel";
import { getPlannerPorts } from "./geometry";
import { assertBlueprintRecognition, assertBlueprintSteadyState, inspectBlueprintBoundaries } from "./blueprint-analysis";
import type { PlannerCandidate } from "./candidate";
import type { PlannerNetwork, PlannerNode, PlannerWire } from "./model";
import { capturePlannerSeed, restorePlannerSeed } from "./search-seed";
import { blueprintLogicalWires } from "./blueprint-optimizations";
import { excludeDisconnectedBlueprintPipes } from "./blueprint-disconnections";
import { plannerOutputPerMinute, meetsProductionTargets, meetsOperatingLimits, assertPlannerCandidateBounds, assertPlannerWarehousePorts } from "./verification";
import { assertConverterAutomaticStartup } from "./support";
import { PlannerItemRules } from "@/shared/planner-item-policy";
import { resolveVerifiedPlannerOutputRequest } from "./output-policy";

/** 设备数量与端口身份来自原图，流量来自实测；不借产线求解器重建主体设备。 */
export function identifyBlueprintNetwork(registry: RegistryContract, input: BlueprintPlannerBlueprintInput,
  options: BlueprintPlannerOptions, execution: SimulationBlueprintRunRequest, report: SimulationBlueprintRunReport) {
  // 2026-10-08：网表只包含有效支路；公开请求仍携带完整原图，以便导出和重新识别。
  const originalInput = input;
  input = excludeDisconnectedBlueprintPipes(registry, input).input;
  const graph = assertBlueprintRecognition(registry, input, report);
  assertBlueprintSteadyState(registry, report, execution.probes);
  const targets = report.probes.filter(probe => execution.probes.find(entry => entry.id === probe.id)?.direction === "input")
    .map(probe => ({ itemId: probe.id, perMinute: plannerOutputPerMinute({ blueprintSource: originalInput }, report, probe.id) }))
    .filter(target => target.perMinute > 1e-6);
  if (!targets.length) throw new Error("出口没有持续净产出，无法建立产率基线。");
  const request: BlueprintPlannerRequest = { blueprintSource: structuredClone(originalInput), options: { ...options, solidOutput: "warehouse", itemPolicies: [] },
    plan: { name: input.blueprint.name, sourceBaseId: input.blueprint.baseId, targets, recipes: [], externalSupplies: [],
      infiniteItemIds: [...new Set(input.boundaries.filter(entry => entry.direction === "input").map(entry => entry.itemId!))],
      byproductItemIds: [], containsModules: false, unresolvedPerMinute: 0, activeActivityIds: input.activeActivityIds } };
  // AI-REMOVED 2026-11-04:
  // Reason: 从蓝图提取网表供识别与已验收成果重建共用，避免恢复旧算法缓存。
  // Trigger: 跨版本恢复保留731格成果但清空种子，无法执行邻域缩边。
  // Evidence: task-checkpoint.ts changed 分支去掉 seed；固定缩边候选714格通过远端产率观测。
  // Replacement: 本文件 extractBlueprintNetworkSeed。
  // Risk: 流量来源为真实观测；生产验收与原图稳态验收各自保留。
  // Human Review: Required
  // Original code:
  //   const boundaries = new Map(input.boundaries.map(boundary => [boundary.entityId, boundary]));
  //   const track = (id: string) => {
  //     const entity = input.blueprint.entities[id];
  //     return entity && !boundaries.has(id) && Object.keys(entity.config).length === 0 && entity.tags.length === 0
  //       && (registry.queries.isBelt(entity.definitionId) || registry.queries.isPipe(entity.definitionId));
  //   };
  //   const nodes: PlannerNode[] = input.blueprint.entityOrder.filter(id => !track(id)).map(id => {
  //     const entity = structuredClone(input.blueprint.entities[id]!);
  //     const definition = registry.queries.findEntityDefinition(entity.definitionId)!;
  //     const channels = analysis.channels.filter(channel => channel.entityId === id);
  //     const recipes = channels.flatMap(channel => channel.observedRecipeIds.length ? channel.observedRecipeIds : channel.manual && channel.configuredRecipeId
  //       ? [channel.configuredRecipeId] : channel.consumption ? [...graph.possibleRecipes.get(`${id}/${channel.channelId}`) ?? []] : [])
  //       .map(id => registry.queries.findRecipeDefinition(id)!)
  //       .filter(recipe => recipe && !["transport", "warehouse"].includes(recipe.recipeType));
  //     const recipe = recipes.find(recipe => recipe.environmentOutput) ?? recipes.find(recipe => !recipe.tags.includes(CONSUMPTION_RECIPE_TAG)) ?? null;
  //     const boundary = boundaries.get(id);
  //     const purpose: PlannerNode["purpose"] = boundary ? boundary.direction === "input" ? "supply" : "product"
  //       : recipe?.environmentOutput ? "environment" : registry.queries.isGeneralLogisticsDevice(definition.id) ? "logistics"
  //         : findPowerRange(definition) ? "power" : "production";
  //     const port = boundary?.kind === "port" ? getPlannerPorts(registry, entity, definition, boundary.direction)
  //       .find(port => definition.portGroups[port.groupIndex]!.id === boundary.portGroupId
  //         && definition.portGroups[port.groupIndex]!.ports[port.portIndex]!.id === boundary.portId) : undefined;
  //     return { entity, definition, recipe, purpose, inputs: [], outputs: [],
  //       ...(port ? { boundaryPort: { direction: port.direction, groupIndex: port.groupIndex, portIndex: port.portIndex } } : {}) };
  //   });
  //   const byId = new Map(nodes.map(node => [node.entity.id, node]));
  //   const physicalPort = (id: string) => {
  //     const port = graph.ports.get(id)!;
  //     const entity = input.blueprint.entities[port.entityId]!, definition = registry.queries.findEntityDefinition(entity.definitionId)!;
  //     const result = getPlannerPorts(registry, entity, definition, port.direction)
  //       .find(candidate => definition.portGroups[candidate.groupIndex]!.id === port.groupId
  //         && definition.portGroups[candidate.groupIndex]!.ports[candidate.portIndex]!.id === port.portId);
  //     if (!result) throw new Error(`无法识别物理端口：${id}`);
  //     return result;
  //   };
  //   const wires: PlannerWire[] = [];
  //   const routes: NonNullable<PlannerCandidate["seed"]>["routes"] = [];
  //   for (const connection of analysis.connections) {
  //     const source = graph.ports.get(connection.sourcePortId), firstTarget = graph.ports.get(connection.targetPortId);
  //     if (!source || !firstTarget || !byId.has(source.entityId) || !input.blueprint.entities[firstTarget.entityId]) continue;
  //     let target = firstTarget;
  //     const cells: { x: number; y: number }[] = [], visited = new Set<string>();
  //     while (track(target.entityId)) {
  //       if (visited.has(target.entityId)) throw new Error(`无法确定物流回路终点：${target.entityId}`);
  //       visited.add(target.entityId); cells.push(input.blueprint.entities[target.entityId]!.position);
  //       const outputs = analysis.ports.filter(port => port.entityId === target.entityId && port.direction === "output");
  //       const next = analysis.connections.filter(edge => outputs.some(port => port.id === edge.sourcePortId));
  //       if (next.length !== 1) throw new Error(`无法确定物流路径：${target.entityId}`);
  //       target = graph.ports.get(next[0]!.targetPortId)!;
  //     }
  //     if (!byId.has(target.entityId)) continue;
  //     const itemIds = [...graph.items.get(source.id) ?? []];
  //     if (itemIds.length !== 1) throw new Error(`无法识别线路物品：${source.entityId} → ${target.entityId}`);
  //     const observed = analysis.transfers.filter(row => row.sourcePortId === source.id && row.itemId === itemIds[0]);
  //     const perMinute = observed.reduce((sum, row) => sum + row.windowAmounts.reduce((a, b) => a + b, 0), 0) * 60 / report.observationSeconds;
  //     if (!Number.isFinite(perMinute) || perMinute < 0) throw new Error(`线路运行观测无效：${source.entityId} → ${target.entityId}`);
  //     const from = physicalPort(source.id), to = physicalPort(target.id);
  //     wires.push({ source: from, target: to, itemIds, perMinute });
  //     const sourceGroup = registry.queries.findEntityDefinition(byId.get(source.entityId)!.entity.definitionId)!.portStorageBindings
  //       .filter(binding => binding.portGroupId === source.groupId).map(binding => binding.storageSlotGroupId);
  //     const targetGroup = registry.queries.findEntityDefinition(byId.get(target.entityId)!.entity.definitionId)!.portStorageBindings
  //       .filter(binding => binding.portGroupId === target.groupId).map(binding => binding.storageSlotGroupId);
  //     byId.get(source.entityId)!.outputs.push({ itemId: itemIds[0]!, perMinute, storageGroupIds: sourceGroup });
  //     byId.get(target.entityId)!.inputs.push({ itemId: itemIds[0]!, perMinute, storageGroupIds: targetGroup });
  //     routes.push({ source: source.entityId, target: target.entityId,
  //       sourcePort: `${source.entityId}/${from.groupIndex}/${from.portIndex}`, targetPort: `${target.entityId}/${to.groupIndex}/${to.portIndex}`,
  //       sourceEdge: from.edge, targetEdge: to.edge, cells, turns: 0 });
  //   }
  //   const rectangles = input.blueprint.entityOrder.map(id => resolveEntityGridRect({ entity: input.blueprint.entities[id]!,
  //     definition: registry.queries.findEntityDefinition(input.blueprint.entities[id]!.definitionId)! }));
  //   const left = Math.min(...rectangles.map(rect => rect.x)), top = Math.min(...rectangles.map(rect => rect.y));
  //   const width = Math.max(...rectangles.map(rect => rect.x + rect.width)) - left;
  //   const height = Math.max(...rectangles.map(rect => rect.y + rect.height)) - top;
  //   const network: PlannerNetwork = { request, nodes, slotLinks: structuredClone(input.blueprint.slotLinks),
  //     initialSlots: [], preferredGasCount: nodes.filter(node => node.purpose === "environment").length };
  //   assertConverterAutomaticStartup(registry, network, wires);
  //   const seed = capturePlannerSeed(request, network, wires, routes, width, height, { x: left, y: top });
  const seed = extractBlueprintNetworkSeed(registry, input, request, report, graph);
  const { width, height } = seed;
  const nodes = seed.network.nodes;
  const rectangles = input.blueprint.entityOrder.map(id => resolveEntityGridRect({ entity: input.blueprint.entities[id]!,
    definition: registry.queries.findEntityDefinition(input.blueprint.entities[id]!.definitionId)! }));
  const left = Math.min(...rectangles.map(rect => rect.x)), top = Math.min(...rectangles.map(rect => rect.y));
  const candidate: PlannerCandidate = { seed, execution, outlineOrigin: { x: left, y: top },
    supplyAudit: { operatingLimits: [], splitterCount: 0, bufferedAdmissions: 0 }, connections: [],
    metrics: { width, height, area: width * height, entityCount: input.blueprint.entityOrder.length,
      productionDeviceCount: nodes.filter(node => node.purpose === "production").length,
      gasDiffuserCount: seed.network.preferredGasCount, additionalGasDiffuserCount: 0, score: width * height },
    search: { strategy: "compact", seed: 0, evaluationLimit: options.evaluationsPerRound, outline: { width, height },
      evaluations: 0, acceptedMoves: 0, routingAttempts: 0, initialWireLength: 0, finalWireLength: 0 } };
  return { request, candidate };
}

/** 跨版本恢复后，从已重新验收的成品重建网表；生产边界继续使用原始请求。 */
export function reconstructVerifiedPlannerSeed(registry: RegistryContract, request: BlueprintPlannerRequest,
  candidate: PlannerCandidate, report: SimulationBlueprintRunReport) {
  if (request.blueprintSource || !report.analysis || !meetsProductionTargets(request, report)
    || !meetsOperatingLimits(candidate.supplyAudit, report)) throw new Error("成果缺少当前生产约束的有效验收，不能重建搜索网表。");
  assertPlannerCandidateBounds(registry, candidate);
  assertPlannerWarehousePorts(registry, request, candidate);
  const input: BlueprintPlannerBlueprintInput = { blueprint: candidate.execution.blueprint,
    activeActivityIds: candidate.execution.activeActivityIds ?? [],
    boundaries: inspectBlueprintBoundaries(registry, candidate.execution.blueprint, report.analysis, candidate.execution.activeActivityIds) };
  const graph = assertBlueprintRecognition(registry, input, report);
  // 生产任务已有明确目标及正式验收；重建只提取连接，不用观测改写目标，也不套用原图识别的稳态基线规则。
  // 2026-11-07：具体种子必须采用与成品出口一致的已解析选项，不能把任务的 auto 写进种子。
  const rules = new PlannerItemRules(registry, request.options);
  const outputs = new Map<string, "warehouse" | "stash">();
  for (const boundary of input.boundaries) {
    if (boundary.direction !== "output" || !boundary.itemId || !rules.isSolid(boundary.itemId)) continue;
    const definitionId = input.blueprint.entities[boundary.entityId]!.definitionId;
    const mode = definitionId === "storager_1" ? "stash" : definitionId === "loader_1" ? "warehouse" : null;
    if (mode === null || outputs.has(boundary.itemId) && outputs.get(boundary.itemId) !== mode) {
      throw new Error(`成果出口无法对应唯一的固体输出方式：${boundary.itemId}`);
    }
    outputs.set(boundary.itemId, mode);
  }
  const resolved = resolveVerifiedPlannerOutputRequest(registry, request, outputs);
  const seed = extractBlueprintNetworkSeed(registry, input, resolved, report, graph);
  const { network, wires } = restorePlannerSeed(registry, resolved, seed);
  network.initialSlots.splice(0, network.initialSlots.length, ...structuredClone(candidate.execution.scene.initialSlots ?? []));
  const linked = new Set([...network.slotLinks.flatMap(link => [link.source.entityId, link.target.entityId]),
    ...network.initialSlots.map(slot => slot.entityId), ...(candidate.execution.scene.scheduledSlots ?? []).map(slot => slot.patch.entityId)]);
  const nodes = new Map(network.nodes.map(node => [node.entity.id, node]));
  const channelKey = (port: PlannerWire["source"]) => {
    const definition = nodes.get(port.entityId)!.definition;
    return `${port.entityId}/${definition.portStorageBindings.filter(binding => binding.portGroupId === definition.portGroups[port.groupIndex]!.id)
      .map(binding => binding.storageSlotGroupId).sort().join(",")}`;
  };
  // 双向通道观测含来回搬运；按同物品、同库存通道抵消反向流，只保留实际净输送。
  const net = wires.map(wire => ({ ...wire }));
  for (let index = 0; index < net.length; index++) {
    const wire = net[index]!;
    for (let other = index + 1; other < net.length; other++) {
      const reverse = net[other]!;
      if (wire.itemIds.length !== 1 || reverse.itemIds.length !== 1 || wire.itemIds[0] !== reverse.itemIds[0]
        || channelKey(wire.source) !== channelKey(reverse.target) || channelKey(wire.target) !== channelKey(reverse.source)) continue;
      const amount = Math.min(wire.perMinute, reverse.perMinute);
      wire.perMinute -= amount; reverse.perMinute -= amount;
    }
  }
  const active = net.filter(wire => wire.perMinute > 1e-6);
  // 交叉器属于路径本身；仅合并没有配置、库存链接及分汇流语义的透明通道。
  const transparent = new Set(network.nodes.filter(node => registry.queries.resolveLogisticsRole(node.definition.id) === "connector"
    && !node.boundaryPort && !linked.has(node.entity.id) && !node.entity.tags.length && !Object.keys(node.entity.config).length
    && node.definition.storageSlotGroups.every(group => {
      const connected = (wire: PlannerWire, direction: "source" | "target") => wire[direction].entityId === node.entity.id
        && node.definition.portStorageBindings.some(binding => binding.storageSlotGroupId === group.id
          && binding.portGroupId === node.definition.portGroups[wire[direction].groupIndex]!.id);
      const incoming = active.filter(wire => connected(wire, "target")), outgoing = active.filter(wire => connected(wire, "source"));
      return incoming.length <= 1 && outgoing.length <= 1 && incoming.length === outgoing.length;
    })).map(node => node.entity.id));
  const logical = blueprintLogicalWires(network, active, transparent);
  network.nodes.splice(0, network.nodes.length, ...network.nodes.filter(node => !transparent.has(node.entity.id)));
  return capturePlannerSeed(resolved, network, logical, [], seed.width, seed.height);
}

/** 只提取当前蓝图及本次运行事实；不读取任何旧搜索状态。 */
function extractBlueprintNetworkSeed(registry: RegistryContract, input: BlueprintPlannerBlueprintInput,
  request: BlueprintPlannerRequest, report: SimulationBlueprintRunReport,
  graph: ReturnType<typeof assertBlueprintRecognition>) {
  const analysis = report.analysis!;
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
    const recipe = recipes.find(recipe => recipe.environmentOutput) ?? recipes.find(recipe => !recipe.tags.includes(CONSUMPTION_RECIPE_TAG)) ?? null;
    const boundary = boundaries.get(id);
    const purpose: PlannerNode["purpose"] = boundary ? boundary.direction === "input" ? "supply" : "product"
      : recipe?.environmentOutput ? "environment" : registry.queries.isGeneralLogisticsDevice(definition.id) ? "logistics"
        : findPowerRange(definition) ? "power" : "production";
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
    // 生产成果可能有未启用端口的偶然相邻；无物品事实且没有实际输送的边不构成生产网表。
    // 原图识别仍保持原有严格规则；这里不把零流量边推定为某种物品。
    if (!request.blueprintSource && itemIds.length === 0 && !analysis.transfers.some(row => row.sourcePortId === source.id
      && row.windowAmounts.some(amount => amount > 0))) continue;
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
  assertConverterAutomaticStartup(registry, network, wires);
  return capturePlannerSeed(request, network, wires, routes, width, height, { x: left, y: top });
}
