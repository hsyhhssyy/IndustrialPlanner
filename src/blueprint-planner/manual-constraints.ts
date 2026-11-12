import { manualBindingKey, matchManualPlacements } from "@/shared/planner-manual-binding";
import { isPlannerManualDeviceSupported } from "@/shared/planner-manual-devices";
export { matchManualPlacements } from "@/shared/planner-manual-binding";
import type {
  BlueprintPlannerManualLayout, BlueprintPlannerManualNode,
  BlueprintPlannerRequest,
} from "@/domain/blueprint-planner";
import type { RegistryContract } from "@/domain/registry/registry-contract";
import type { WorldEntity } from "@/domain/document/world-document";
import { areGridRectsIntersecting, resolveEntityGridRect } from "@/shared/geometry/power-range";
import { PlannerCandidateError, type PlannerNetwork, type PlannerNode } from "./model";

export function isManualNode(registry: RegistryContract, node: PlannerNode): boolean {
  return node.purpose !== "logistics" && !node.external
    && !registry.queries.isGeneralLogisticsDevice(node.definition.id);
}

export function manualNodeView(node: PlannerNode): BlueprintPlannerManualNode {
  if (node.purpose === "logistics") throw new Error("物流设备不能加入人工摆放清单。");
  const flows = (values: PlannerNode["inputs"]) => values.map(({ itemId, perMinute }) => ({ itemId, perMinute }));
  return { id: node.entity.id, definitionId: node.definition.id, recipeId: node.recipe?.id ?? null,
    purpose: node.purpose, inputs: flows(node.inputs), outputs: flows(node.outputs) };
}

// AI-REMOVED 2026-11-11:
// Reason: 兼容身份分配同时供规划器与 App 清单使用，避免两套匹配规则。
// Trigger: 同类型或同配方重分配后待摆列表必须扣除已占用职责。
// Evidence: 人工参考身份可能不在新准备清单中。
// Replacement: src/shared/planner-manual-binding.ts
// Risk: Low。Human Review: Required。
// Original code:
// export function manualBindingKey(node: BlueprintPlannerManualNode, mode: BlueprintPlannerManualBindingMode): string {
//   return mode === "topology" ? node.id : JSON.stringify([node.definitionId, ...(mode === "recipe" ? [node.recipeId] : [])]);
// }

/** 指纹只依赖用户输入，排除上次派生快照和计算预算。 */
export function manualPreparationKey(request: BlueprintPlannerRequest): string {
  const { evaluationsPerRound: _budget, concurrency: _concurrency, gpu: _gpu, randomSeed: _seed,
    initialArea: _area, stopAfterFirstSolution: _stop, deterministicSearch: _deterministic, ...options } = request.options;
  void [_budget, _concurrency, _gpu, _seed, _area, _stop, _deterministic];
  const manual = request.manualLayout;
  return JSON.stringify([request.plan, options, manual?.mode ?? "recipe", manual?.facilities ?? [],
    manual?.placements.map(({ referenceNode }) => [referenceNode.id, referenceNode.definitionId, referenceNode.recipeId]) ?? []]);
}

// AI-REMOVED 2026-11-11:
// Reason: 兼容身份分配同时供规划器与 App 清单使用，避免两套匹配规则。
// Trigger: 同类型或同配方重分配后待摆列表必须扣除已占用职责。
// Evidence: 人工参考身份可能不在新准备清单中。
// Replacement: src/shared/planner-manual-binding.ts
// Risk: Low。Human Review: Required。
// Original code:
// export function matchManualPlacements(nodes: readonly BlueprintPlannerManualNode[], placements: readonly BlueprintPlannerManualPlacement[],
//   mode: BlueprintPlannerManualBindingMode, offset = 0): {
//     assignments: Map<string, BlueprintPlannerManualNode>; issues: BlueprintPlannerManualPlacementIssue[];
//   } {
//   const assignments = new Map<string, BlueprintPlannerManualNode>(), issues: BlueprintPlannerManualPlacementIssue[] = [];
//   const groups = new Map<string, BlueprintPlannerManualPlacement[]>();
//   for (const placement of placements) {
//     const key = manualBindingKey(placement.referenceNode, mode);
//     groups.set(key, [...groups.get(key) ?? [], placement]);
//   }
//   for (const [key, group] of groups) {
//     const pool = nodes.filter(node => manualBindingKey(node, mode) === key);
//     if (pool.length < group.length) {
//       issues.push(mode === "topology" ? { kind: "role-removed", nodeIds: group.map(p => p.referenceNode.id) }
//         : { kind: "excess", nodeIds: group.map(p => p.referenceNode.id), excessCount: group.length - pool.length });
//     }
//     const remaining = [...pool];
//     for (const placement of group) {
//       if (!remaining.length) break;
//       const previous = remaining.findIndex(node => node.id === placement.referenceNode.id);
//       const index = offset === 0 && previous >= 0 ? previous : Math.abs(offset) % remaining.length;
//       const node = remaining.splice(index, 1)[0]!;
//       if (node.definitionId !== placement.referenceNode.definitionId || mode !== "device" && node.recipeId !== placement.referenceNode.recipeId) {
//         issues.push({ kind: "incompatible", nodeIds: [placement.referenceNode.id] });
//       } else assignments.set(placement.referenceNode.id, node);
//     }
//   }
//   return { assignments, issues };
// }

/** 草稿允许带匹配冲突保存，但结构、设备资格和数值必须真实有效。 */
export function validateManualLayout(registry: RegistryContract, request: BlueprintPlannerRequest): void {
  const manual = request.manualLayout;
  if (!manual) return;
  if (request.blueprintSource) throw new Error("原图任务暂不支持人工摆放。");
  if (typeof manual.enabled !== "boolean" || !["device", "recipe", "topology"].includes(manual.mode)
    || !Array.isArray(manual.facilities) || !Array.isArray(manual.placements) || !manual.preparation
    || !Array.isArray(manual.preparation.nodes) || !Array.isArray(manual.preparation.connections)
    || !Array.isArray(manual.preparation.facilityTemplates) || !Array.isArray(manual.preparation.placementIssues)
    || typeof manual.preparation.sourceKey !== "string") throw new Error("人工布局数据不完整。");
  const seen = new Set<string>();
  const validNode = (node: BlueprintPlannerManualNode) => {
    const definition = node && registry.queries.findEntityDefinition(node.definitionId);
    return !!definition && typeof node.id === "string" && !!node.id
      && !registry.queries.isGeneralLogisticsDevice(node.definitionId)
      && ["production", "environment", "auxiliary", "supply", "product", "byproduct", "startup", "power"].includes(node.purpose)
      && (node.recipeId === null || registry.queries.findRecipeDefinition(node.recipeId)?.machineId === node.definitionId)
      && [node.inputs, node.outputs].every(flows => Array.isArray(flows) && flows.every(flow => flow
        && registry.queries.findItemDefinition(flow.itemId) && Number.isFinite(flow.perMinute) && flow.perMinute >= 0));
  };
  const nodeIds = new Set<string>();
  for (const node of manual.preparation.nodes) {
    if (!validNode(node) || nodeIds.has(node.id)) throw new Error("人工设备准备清单无效。");
    nodeIds.add(node.id);
  }
  const edgeIds = new Set<string>();
  for (const edge of manual.preparation.connections) {
    const key = edge && manualConnectionKey(edge.sourceNodeId, edge.targetNodeId, edge.itemId);
    if (!edge || !nodeIds.has(edge.sourceNodeId) || !nodeIds.has(edge.targetNodeId)
      || !registry.queries.findItemDefinition(edge.itemId) || !Number.isFinite(edge.perMinute) || edge.perMinute <= 0
      || edgeIds.has(key)) throw new Error("人工准备的拓扑关系无效。");
    edgeIds.add(key);
  }
  for (const issue of manual.preparation.placementIssues) if (!issue || !["excess", "role-removed", "incompatible"].includes(issue.kind)
    || !Array.isArray(issue.nodeIds) || issue.nodeIds.some((id: unknown) => typeof id !== "string")
    || issue.kind === "excess" && (!Number.isSafeInteger(issue.excessCount) || issue.excessCount <= 0)) throw new Error("人工摆放冲突数据无效。");
  for (const facility of manual.facilities) {
    if (!facility || typeof facility.id !== "string" || !facility.id.startsWith("manual-facility-") || seen.has(facility.id)) throw new Error("人工设施身份重复或无效。");
    seen.add(facility.id);
  }
  for (const facility of [...manual.facilities, ...manual.preparation.facilityTemplates]) {
    if (!facility) throw new Error("人工设施模板无效。");
    const definition = registry.queries.findEntityDefinition(facility.definitionId);
    const recipe = facility.recipeId === null ? null : registry.queries.findRecipeDefinition(facility.recipeId);
    if (!definition || registry.queries.isGeneralLogisticsDevice(definition.id)
      || facility.purpose === "environment" && (!recipe?.environmentOutput || recipe.machineId !== definition.id)
      || facility.purpose === "power" && !(facility.recipeId === null
        ? definition.ranges?.some(range => range.interactionKind === "power")
        : recipe?.machineId === definition.id && (recipe.powerOutput ?? 0) > 0)
      || !["environment", "power"].includes(facility.purpose)) throw new Error("只能额外添加合法的环境或电力设备。");
  }
  const positions = new Set<string>();
  for (const placement of manual.placements) {
    const node = placement?.referenceNode;
    if (!validNode(node) || positions.has(node.id)) throw new Error("人工设备引用无效或重复摆放。");
    positions.add(node.id);
    const definition = registry.queries.findEntityDefinition(node.definitionId);
    if (!definition || registry.queries.isGeneralLogisticsDevice(node.definitionId)
      || !Array.isArray(node.inputs) || !Array.isArray(node.outputs)
      || node.recipeId !== null && registry.queries.findRecipeDefinition(node.recipeId)?.machineId !== definition.id
      || !Number.isSafeInteger(placement.position?.x) || !Number.isSafeInteger(placement.position?.y)
      || placement.position.x < 0 || placement.position.y < 0 || ![0, 90, 180, 270].includes(placement.rotation)) {
      throw new Error("人工摆放包含无效设备、配方、坐标或朝向。");
    }
  }
}

export function assertManualLayoutReady(registry: RegistryContract, request: BlueprintPlannerRequest, checkSource = true): void {
  validateManualLayout(registry, request);
  const manual = request.manualLayout;
  if (!manual?.enabled) return;
  if (manual.placements.some(placement => !isPlannerManualDeviceSupported(placement.referenceNode.definitionId))
    || manual.facilities.some(facility => !isPlannerManualDeviceSupported(facility.definitionId))) {
    throw new Error("人工布局不支持热能池、洒水机和田块，请移除这些设备。");
  }
  if (checkSource && manual.preparation.sourceKey !== manualPreparationKey(request)) throw new Error("人工布局需要重新准备，请返回人工摆放步骤。");
  if (manual.preparation.placementIssues.length || matchManualPlacements(manual.preparation.nodes, manual.placements, manual.mode).issues.length) {
    throw new Error("请先处理人工摆放中标红的设备。");
  }
  const rects = manual.placements.map(placement => resolveEntityGridRect({
    entity: { ...placement, id: placement.referenceNode.id, definitionId: placement.referenceNode.definitionId, config: {}, tags: [] },
    definition: registry.queries.findEntityDefinition(placement.referenceNode.definitionId)!,
  }));
  if (rects.some((rect, index) => rects.slice(0, index).some(other => areGridRectsIntersecting(rect, other)))) {
    throw new Error("人工摆放的设备发生重叠。");
  }
  if (rects.some(rect => rect.x + rect.width > 70 || rect.y + rect.height > 70)) throw new Error("人工设备超出 70×70 的规划范围。");
}

export function frozenManualTopology(network: PlannerNetwork): boolean {
  return !network.preparingManual && network.request.manualLayout?.enabled === true && network.request.manualLayout.mode === "topology";
}

/** 每个独立候选可分配不同的兼容职责；固定位置本身不参加随机移动。 */
export function bindManualPositions(registry: RegistryContract, network: PlannerNetwork, variant = 0, complete = true): void {
  const manual = network.request.manualLayout;
  if (!manual?.enabled || network.preparingManual) return;
  const nodes = network.nodes.filter(node => isManualNode(registry, node));
  const views = nodes.map(manualNodeView);
  const placements = complete ? manual.placements : manual.placements.filter(placement => views.some(node =>
    manualBindingKey(node, manual.mode) === manualBindingKey(placement.referenceNode, manual.mode)));
  const { assignments, issues } = matchManualPlacements(views, placements, manual.mode, variant);
  if (issues.length) throw new PlannerCandidateError("当前候选无法满足人工设备绑定。");
  for (const node of nodes) node.manualPlacement = undefined;
  for (const placement of placements) {
    const node = nodes.find(entry => entry.entity.id === assignments.get(placement.referenceNode.id)?.id)!;
    node.manualPlacement = placement;
    node.entity.position = { ...placement.position }; node.entity.rotation = placement.rotation;
  }
}

/** 交付前从实体重新匹配固定位置，独立于搜索器是否正确跳过固定节点。 */
export function assertManualEntities(request: BlueprintPlannerRequest, entities: readonly WorldEntity[]): void {
  const manual = request.manualLayout;
  if (!manual?.enabled) return;
  const used = new Set<string>();
  for (const placement of manual.placements) {
    const reference = placement.referenceNode;
    const entity = entities.find(entity => !used.has(entity.id) && entity.definitionId === reference.definitionId
      && entity.position.x === placement.position.x && entity.position.y === placement.position.y && entity.rotation === placement.rotation
      && (manual.mode !== "topology" || entity.id === reference.id)
      && (manual.mode === "device" || reference.recipeId === null
        || Object.values((entity.config.channelRecipes ?? {}) as Record<string, unknown>).includes(reference.recipeId)));
    if (!entity) throw new PlannerCandidateError(`人工固定设备、配方或朝向被改变：${reference.id}`);
    used.add(entity.id);
  }
  for (const facility of manual.facilities) if (!entities.some(entity => entity.id === facility.id)) {
    throw new PlannerCandidateError(`人工新增设施丢失：${facility.id}`);
  }
}

export function manualFixedIds(network: PlannerNetwork): ReadonlySet<string> {
  return new Set(network.nodes.filter(node => node.manualPlacement).map(node => node.entity.id));
}

export function manualConnectionKey(source: string, target: string, item: string): string {
  return JSON.stringify([source, target, item]);
}

export function manualConnectionQuotas(manual: BlueprintPlannerManualLayout | undefined): Map<string, number> | null {
  return manual?.enabled && manual.mode === "topology"
    ? new Map(manual.preparation.connections.map(edge => [manualConnectionKey(edge.sourceNodeId, edge.targetNodeId, edge.itemId), edge.perMinute])) : null;
}
