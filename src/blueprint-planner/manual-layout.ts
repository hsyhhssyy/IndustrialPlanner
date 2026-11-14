import type {
  BlueprintPlannerManualConnection, BlueprintPlannerManualFacilityTemplate, BlueprintPlannerManualNode,
  BlueprintPlannerManualPreparation, BlueprintPlannerRequest,
} from "@/domain/blueprint-planner";
import type { RegistryContract } from "@/domain/registry/registry-contract";
import { isRecipeAvailableByActivity } from "@/shared/registry/activity-availability";
import { isPlannerManualDeviceSupported } from "@/shared/planner-manual-devices";
import { createProductionNetwork, createRecipeNode, normalizePlannerSources } from "./production-network";
import { createPlainNode, PlannerPlacement } from "./placement";
import { prepareProductionDevices } from "./production-preparation";
import { resolveSearchProfile } from "./search-profile";
import { wireProductionNetwork } from "./wiring";
import { PlannerCandidateError, type PlannerNetwork, type PlannerNode } from "./model";
import { assertManualLayoutReady, bindManualPositions, isManualNode, manualNodeView, manualPreparationKey, manualPlacementIssues, validateManualLayout, MANUAL_LAYOUT_SIZE } from "./manual-constraints";
import { configureManualFrame, manualFrameBounds } from "./manual-frame";
import { isPlannerBoundaryNode, PlannerBoundary } from "./boundary";

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
  ].filter(template => isPlannerManualDeviceSupported(template.definitionId));
}

function nodeSignature(node: BlueprintPlannerManualNode): string {
  return JSON.stringify([node.definitionId, node.recipeId, node.purpose,
    node.recipeId === null ? node.inputs.map(flow => flow.itemId).sort() : [],
    node.recipeId === null ? node.outputs.map(flow => flow.itemId).sort() : []]);
}

/** 同组节点负荷不同时，重新准备必须先保持原有负荷对应的身份，避免拓扑在两次准备间交换。 */
function nodeFlowSignature(node: BlueprintPlannerManualNode): string {
  return JSON.stringify([node.inputs, node.outputs].map(flows =>
    flows.map(({ itemId, perMinute }) => ({ itemId, perMinute })).sort((a, b) => a.itemId.localeCompare(b.itemId))));
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
// AI-CORRECTION 2026-11-14：先匹配同组原有负荷；负荷变化时才按职责及人工位置退选，避免相同清单重复准备时交换身份。
export function stabilizeManualNodes(registry: RegistryContract, network: PlannerNetwork, previous?: BlueprintPlannerManualPreparation): void {
  if (!network.request.manualLayout?.enabled && !network.preparingManual) return;
  const manual = network.request.manualLayout;
  const fixed = new Set([...(manual?.placements ?? []), ...(manual?.boundary.assignments ?? [])].map(p => p.referenceNode.id));
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
    const references = [...(manual?.placements ?? []), ...(manual?.boundary.assignments ?? [])].map(entry => entry.referenceNode);
    const candidates = [...(previous?.nodes ?? []), ...references.filter(node => !previous?.nodes.some(entry => entry.id === node.id))]
      .filter(node => !additions.has(node.id) && !removedAdditions.has(node.id) && nodeSignature(node) === signature);
    const usefulness = (node: BlueprintPlannerManualNode) => (previous?.connections.filter(edge => edge.sourceNodeId === node.id
      && !removedAdditions.has(edge.targetNodeId)).reduce((total, edge) => total + edge.perMinute, 0) ?? 0);
    candidates.sort((a, b) => (manual?.mode === "topology" ? usefulness(b) - usefulness(a)
      : Number(fixed.has(b.id)) - Number(fixed.has(a.id))) || a.id.localeCompare(b.id));
    const prefix = `manual-node-${encodeURIComponent(signature)}-`;
    for (const [index, node] of group.entries()) {
      const flows = nodeFlowSignature(manualNodeView(node));
      let chosen = candidates.find(entry => entry.id === node.entity.id && !used.has(entry.id))?.id
        ?? candidates.find(entry => !used.has(entry.id) && nodeFlowSignature(entry) === flows)?.id
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
  const placement = new PlannerPlacement(registry, MANUAL_LAYOUT_SIZE, 1, 1, 1, 1);
  await prepareProductionDevices(registry, network, placement, 0, resolveSearchProfile(), { strategy: "compact" }, check);
  stabilizeManualNodes(registry, network, request.manualLayout?.preparation);
  // AI-CORRECTION 2026-11-14：未确认连接的新布局先用已摆位置选择物料关系；既有确认关系仍由 wiring 优先延续。
  const manual = request.manualLayout;
  if (manual?.enabled && manual.preparation.connections.length === 0 && manual.placements.length) {
    const bounds = manualFrameBounds(registry, manual, 0);
    for (const node of network.nodes) {
      const fixed = manual.placements.find(entry => entry.referenceNode.id === node.entity.id);
      if (!fixed) continue;
      node.entity.position = { x: fixed.position.x - bounds.x, y: fixed.position.y - bounds.y };
      node.entity.rotation = fixed.rotation;
    }
    // 2026-11-14：首次拓扑分配前，补回的存取口先与固定口形成连续边界，不能用临时原点抢占供料职责。
    if (network.nodes.some(node => isPlannerBoundaryNode(node)
      && manual.placements.some(entry => entry.referenceNode.id === node.entity.id))) {
      // 此布局只指导首次关系分配；尺寸选项不参与准备身份，最终可行性仍由候选与正式验收判断。
      const guide: PlannerNetwork = { ...network, preparingManual: false,
        request: { ...network.request, options: { ...network.request.options, dimensionLimits: undefined } } };
      const outline = { width: Math.max(1, bounds.width), height: Math.max(1, bounds.height) };
      try {
        configureManualFrame(registry, guide, outline, 0);
        bindManualPositions(registry, guide, 0, false);
        new PlannerBoundary(registry, guide, outline).arrange(0);
      } catch (error) {
        // 草稿可暂时包含互相矛盾的贴边约束；无法构造边界引导时仍允许准备设备清单供用户编辑。
        if (!(error instanceof PlannerCandidateError)) throw error;
      }
    }
  }
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
  // 准备结果按稳定身份发布；首次按空间分配与后续按确认关系复核不应改变数组顺序。
  connections.sort((a, b) => a.sourceNodeId.localeCompare(b.sourceNodeId)
    || a.targetNodeId.localeCompare(b.targetNodeId) || a.itemId.localeCompare(b.itemId));
  return { sourceKey: manualPreparationKey(request), nodes, connections, facilityTemplates: templates,
    placementIssues: manualPlacementIssues(request, nodes) };
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
