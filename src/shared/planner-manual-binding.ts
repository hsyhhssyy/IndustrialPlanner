import type { BlueprintPlannerManualBindingMode, BlueprintPlannerManualNode, BlueprintPlannerManualPlacementIssue } from "@/domain/blueprint-planner";

/** 规划分配与待摆列表共享同一套兼容身份，避免界面重复提供已被固定位置占用的职责。 */
export function manualBindingKey(node: BlueprintPlannerManualNode, mode: BlueprintPlannerManualBindingMode): string {
  if (mode === "topology") return node.id;
  if (mode === "device") return JSON.stringify([node.definitionId]);
  // 源汇设备没有生产配方，物料方向与种类才是其职责；负荷和流量顺序不影响兼容性。
  return JSON.stringify(node.recipeId !== null ? [node.definitionId, node.recipeId]
    : [node.definitionId, null, node.purpose,
      [...new Set(node.inputs.map(flow => flow.itemId))].sort(),
      [...new Set(node.outputs.map(flow => flow.itemId))].sort()]);
}

export function matchManualPlacements(nodes: readonly BlueprintPlannerManualNode[], placements: readonly { readonly referenceNode: BlueprintPlannerManualNode }[],
  mode: BlueprintPlannerManualBindingMode, offset = 0): {
    assignments: Map<string, BlueprintPlannerManualNode>; issues: BlueprintPlannerManualPlacementIssue[];
  } {
  const assignments = new Map<string, BlueprintPlannerManualNode>(), issues: BlueprintPlannerManualPlacementIssue[] = [];
  const groups = new Map<string, { readonly referenceNode: BlueprintPlannerManualNode }[]>();
  for (const placement of placements) {
    const key = manualBindingKey(placement.referenceNode, mode);
    groups.set(key, [...groups.get(key) ?? [], placement]);
  }
  for (const [key, group] of groups) {
    const pool = nodes.filter(node => manualBindingKey(node, mode) === key);
    if (pool.length < group.length) {
      issues.push(mode === "topology" ? { kind: "role-removed", nodeIds: group.map(p => p.referenceNode.id) }
        : { kind: "excess", nodeIds: group.map(p => p.referenceNode.id), excessCount: group.length - pool.length });
    }
    const remaining = [...pool];
    for (const placement of group) {
      if (!remaining.length) break;
      const previous = remaining.findIndex(node => node.id === placement.referenceNode.id);
      const index = offset === 0 && previous >= 0 ? previous : Math.abs(offset) % remaining.length;
      const node = remaining.splice(index, 1)[0]!;
      if (node.definitionId !== placement.referenceNode.definitionId || mode !== "device" && node.recipeId !== placement.referenceNode.recipeId) {
        issues.push({ kind: "incompatible", nodeIds: [placement.referenceNode.id] });
      } else assignments.set(placement.referenceNode.id, node);
    }
  }
  return { assignments, issues };
}

