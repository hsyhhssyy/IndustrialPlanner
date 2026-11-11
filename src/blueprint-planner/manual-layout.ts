import type {
  BlueprintPlannerManualConnection, BlueprintPlannerManualFacilityTemplate, BlueprintPlannerManualNode,
  BlueprintPlannerManualPreparation, BlueprintPlannerRequest,
} from "@/domain/blueprint-planner";
import type { RegistryContract } from "@/domain/registry/registry-contract";
import { isRecipeAvailableByActivity } from "@/shared/registry/activity-availability";
import { createProductionNetwork, createRecipeNode, normalizePlannerSources } from "./production-network";
import { createPlainNode, PlannerPlacement } from "./placement";
import { prepareProductionDevices } from "./production-preparation";
import { resolveSearchProfile } from "./search-profile";
import { wireProductionNetwork } from "./wiring";
import type { PlannerNetwork, PlannerNode } from "./model";
import { assertManualLayoutReady, bindManualPositions, isManualNode, manualNodeView, manualPreparationKey, matchManualPlacements, validateManualLayout } from "./manual-constraints";

export function manualFacilityTemplates(registry: RegistryContract, request: BlueprintPlannerRequest): BlueprintPlannerManualFacilityTemplate[] {
  return [
    ...registry.recipeDefinitions.filter(recipe => recipe.environmentOutput && isRecipeAvailableByActivity(recipe, request.plan.activeActivityIds))
      .flatMap(recipe => {
        const definition = registry.queries.findEntityDefinition(recipe.machineId);
        return definition && !registry.queries.isGeneralLogisticsDevice(definition.id)
          && !definition.placementBehaviors.some(behavior => behavior.type === "snap-to-outer-ring-edge")
          ? [{ definitionId: definition.id, recipeId: recipe.id, purpose: "environment" as const }] : [];
      }),
    ...registry.entityDefinitions.filter(definition => definition.ranges?.some(range => range.interactionKind === "power")
      && !registry.queries.isGeneralLogisticsDevice(definition.id) && definition.uiGroup !== "hidden" && definition.uiGroup !== "cheat"
      && !definition.placementBehaviors.some(behavior => behavior.type === "snap-to-outer-ring-edge"))
      .map(definition => ({ definitionId: definition.id, recipeId: null, purpose: "power" as const })),
    ...registry.recipeDefinitions.filter(recipe => (recipe.powerOutput ?? 0) > 0 && isRecipeAvailableByActivity(recipe, request.plan.activeActivityIds))
      .flatMap(recipe => {
        const definition = registry.queries.findEntityDefinition(recipe.machineId);
        return definition && !registry.queries.isGeneralLogisticsDevice(definition.id)
          && !definition.placementBehaviors.some(behavior => behavior.type === "snap-to-outer-ring-edge")
          ? [{ definitionId: definition.id, recipeId: recipe.id, purpose: "power" as const }] : [];
      }),
  ];
}

function nodeSignature(node: BlueprintPlannerManualNode): string {
  return JSON.stringify([node.definitionId, node.recipeId, node.purpose,
    node.recipeId === null ? node.inputs.map(flow => flow.itemId).sort() : [],
    node.recipeId === null ? node.outputs.map(flow => flow.itemId).sort() : []]);
}

/** 一次性重命名网络引用，不能只改实体 id 而留下旧供料或槽位链接。 */
function renameManualNodes(network: PlannerNetwork, replacements: ReadonlyMap<string, string>): void {
  const id = (value: string) => replacements.get(value) ?? value;
  const target = <T extends { readonly entityId: string }>(value: T): T => ({ ...value, entityId: id(value.entityId) });
  for (const node of network.nodes) {
    node.entity.id = id(node.entity.id);
    node.inputs.splice(0, node.inputs.length, ...node.inputs.map(flow => ({ ...flow,
      sourceEntityIds: flow.sourceEntityIds?.map(id) })));
    Object.assign(node, { supplyTarget: node.supplyTarget && target(node.supplyTarget),
      supplyTargets: node.supplyTargets?.map(target), outputSource: node.outputSource && target(node.outputSource),
      outputSources: node.outputSources?.map(target) });
  }
  network.slotLinks.splice(0, network.slotLinks.length, ...network.slotLinks.map(link => ({ ...link,
    source: target(link.source), target: target(link.target) })));
  network.initialSlots.splice(0, network.initialSlots.length, ...network.initialSlots.map(target));
}

/** 按语义组恢复身份；收缩时先保留仍有下游职责的节点，前两档再优先保留人工位置。 */
export function stabilizeManualNodes(registry: RegistryContract, network: PlannerNetwork, previous?: BlueprintPlannerManualPreparation): void {
  if (!network.request.manualLayout?.enabled && !network.preparingManual) return;
  const manual = network.request.manualLayout;
  const fixed = new Set(manual?.placements.map(p => p.referenceNode.id));
  const additions = new Set(manual?.facilities.map(f => f.id));
  const current = network.nodes.filter(node => isManualNode(registry, node));
  const removedAdditions = new Set(previous?.nodes.filter(node => node.id.startsWith("manual-facility-") && !additions.has(node.id)).map(node => node.id));
  const groups = new Map<string, PlannerNode[]>();
  for (const node of current) {
    if (node.manualFacility) continue;
    const key = nodeSignature(manualNodeView(node));
    groups.set(key, [...groups.get(key) ?? [], node]);
  }
  const mapping = new Map<string, string>(), used = new Set(additions);
  for (const [signature, group] of groups) {
    const candidates = previous?.nodes.filter(node => !additions.has(node.id) && !removedAdditions.has(node.id) && nodeSignature(node) === signature) ?? [];
    const usefulness = (node: BlueprintPlannerManualNode) => (previous?.connections.filter(edge => edge.sourceNodeId === node.id
      && !removedAdditions.has(edge.targetNodeId)).reduce((total, edge) => total + edge.perMinute, 0) ?? 0);
    candidates.sort((a, b) => (manual?.mode === "topology" ? usefulness(b) - usefulness(a)
      : Number(fixed.has(b.id)) - Number(fixed.has(a.id))) || a.id.localeCompare(b.id));
    const prefix = `manual-node-${encodeURIComponent(signature)}-`;
    for (const [index, node] of group.entries()) {
      let chosen = candidates.find(entry => entry.id === node.entity.id && !used.has(entry.id))?.id
        ?? candidates.find(entry => !used.has(entry.id))?.id;
      let ordinal = index;
      while (!chosen || used.has(chosen)) {
        chosen = `${prefix}${ordinal++}`;
        if (previous?.nodes.some(entry => entry.id === chosen) && !candidates.some(entry => entry.id === chosen)) chosen = undefined;
      }
      used.add(chosen); mapping.set(node.entity.id, chosen);
    }
  }
  renameManualNodes(network, mapping);
}

export async function prepareManualLayout(registry: RegistryContract, request: BlueprintPlannerRequest,
  signal?: AbortSignal): Promise<BlueprintPlannerManualPreparation> {
  validateManualLayout(registry, request);
  const check = () => signal?.throwIfAborted();
  check();
  const base = createProductionNetwork(registry, { ...request, manualLayout: undefined });
  const network: PlannerNetwork = { ...base, request: { ...base.request, manualLayout: request.manualLayout }, preparingManual: true };
  const templates = manualFacilityTemplates(registry, request);
  for (const facility of request.manualLayout?.facilities ?? []) {
    if (!templates.some(template => template.definitionId === facility.definitionId && template.recipeId === facility.recipeId && template.purpose === facility.purpose)) {
      throw new Error("人工设施不在当前可用的环境或电力清单中。");
    }
    const node = facility.recipeId === null ? createPlainNode(registry, facility.definitionId, facility.id, "power")
      : createRecipeNode(registry, registry.queries.findRecipeDefinition(facility.recipeId)!, facility.id,
        60 / registry.queries.findRecipeDefinition(facility.recipeId)!.durationSeconds, facility.purpose);
    network.nodes.push({ ...node, manualFacility: true });
  }
  // 准备只建立可供分配的设备和供料关系；真正的人工位置由候选阶段执行。
  const placement = new PlannerPlacement(registry, 70, 1, 1, 1, 1);
  await prepareProductionDevices(registry, network, placement, 0, resolveSearchProfile(), { strategy: "compact" }, check);
  stabilizeManualNodes(registry, network, request.manualLayout?.preparation);
  const connections: BlueprintPlannerManualConnection[] = [];
  await wireProductionNetwork(registry, network, placement, check, true, true, false, undefined, undefined, wires => {
    const allowed = new Set(network.nodes.filter(node => isManualNode(registry, node)).map(node => node.entity.id));
    const totals = new Map<string, BlueprintPlannerManualConnection>();
    for (const wire of wires) if (allowed.has(wire.source.entityId) && allowed.has(wire.target.entityId)) for (const itemId of wire.itemIds) {
      const edge = { sourceNodeId: wire.source.entityId, targetNodeId: wire.target.entityId, itemId, perMinute: wire.perMinute };
      const key = JSON.stringify([edge.sourceNodeId, edge.targetNodeId, itemId]), previous = totals.get(key);
      totals.set(key, { ...edge, perMinute: edge.perMinute + (previous?.perMinute ?? 0) });
    }
    connections.push(...totals.values());
  });
  check();
  const nodes = network.nodes.filter(node => isManualNode(registry, node)).map(manualNodeView);
  return { sourceKey: manualPreparationKey(request), nodes, connections, facilityTemplates: templates,
    placementIssues: matchManualPlacements(nodes, request.manualLayout?.placements ?? [], request.manualLayout?.mode ?? "recipe").issues };
}

/** 导入快照不是生产事实；开算时从原目标重新准备并核对完整节点及关系。 */
export async function verifyManualPreparation(registry: RegistryContract, request: BlueprintPlannerRequest, signal?: AbortSignal): Promise<void> {
  if (!request.manualLayout?.enabled) return;
  assertManualLayoutReady(registry, request);
  const prepared = await prepareManualLayout(registry, request, signal);
  const canonical = (value: BlueprintPlannerManualPreparation) => JSON.stringify([
    [...value.nodes].sort((a, b) => a.id.localeCompare(b.id)),
    [...value.connections].sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b))),
  ]);
  if (prepared.placementIssues.length || canonical(prepared) !== canonical(request.manualLayout.preparation)) {
    throw new Error("人工布局准备已过期，请复制任务并重新确认设备与拓扑。");
  }
}

/** 正式候选从确认后的配方负荷开始，避免重新准备改变用户已经摆放的设备清单。 */
export function createManualProductionNetwork(registry: RegistryContract, request: BlueprintPlannerRequest): PlannerNetwork {
  if (!request.manualLayout?.enabled) return createProductionNetwork(registry, request);
  // Host 在开始前检查原请求指纹；候选可以解析自动输出策略，仍需遵守同一份人工约束。
  assertManualLayoutReady(registry, request, false);
  const manual = request.manualLayout;
  const network: PlannerNetwork = { request: normalizePlannerSources(registry, request), nodes: [], slotLinks: [], initialSlots: [], preferredGasCount: 0 };
  const additions = new Set(manual.facilities.map(facility => facility.id));
  for (const entry of manual.preparation.nodes) {
    let node: PlannerNode;
    if (entry.recipeId === null) {
      if (entry.purpose !== "power") continue;
      node = createPlainNode(registry, entry.definitionId, entry.id, "power");
    } else {
      if (!["production", "environment", "auxiliary", "byproduct", "power"].includes(entry.purpose)) continue;
      const recipe = registry.queries.findRecipeDefinition(entry.recipeId);
      if (!recipe || recipe.machineId !== entry.definitionId) throw new Error("人工准备引用的配方或设备已失效。");
      const output = recipe.outputs.find(flow => entry.outputs.some(value => value.itemId === flow.itemId));
      const input = recipe.inputs.find(flow => entry.inputs.some(value => value.itemId === flow.itemId));
      const cycles = recipe.environmentOutput ? 60 / recipe.durationSeconds : output
        ? entry.outputs.find(flow => flow.itemId === output.itemId)!.perMinute / output.amount
        : input ? entry.inputs.find(flow => flow.itemId === input.itemId)!.perMinute / input.amount : 0;
      if (!Number.isFinite(cycles) || cycles <= 0 || cycles > 60 / recipe.durationSeconds + 1e-6) throw new Error("人工准备中的生产负荷无效。");
      node = createRecipeNode(registry, recipe, entry.id, cycles, entry.purpose as "production" | "environment" | "auxiliary" | "byproduct" | "power");
    }
    network.nodes.push(additions.has(entry.id) ? { ...node, manualFacility: true } : node);
  }
  bindManualPositions(registry, network, 0, false);
  return network;
}
