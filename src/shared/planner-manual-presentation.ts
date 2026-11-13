import type { BlueprintPlannerManualLayout } from "@/domain/blueprint-planner";
import type { RegistryContract } from "@/domain/registry/registry-contract";
import { matchManualPlacements } from "./planner-manual-binding";

/** 人工编辑与只读方向示意共用当前职责投影，设备绑定模式不额外锁定物料。 */
export function manualDeviceItemIds(layout: BlueprintPlannerManualLayout, registry: RegistryContract): Readonly<Record<string, readonly string[]>> {
  const matched = matchManualPlacements(layout.preparation.nodes, [...layout.placements, ...layout.boundary.assignments], layout.mode).assignments;
  return Object.fromEntries(layout.placements.map(({ referenceNode }) => {
    const node = matched.get(referenceNode.id) ?? referenceNode;
    const items = node.recipeId ? registry.queries.findRecipeDefinition(node.recipeId)?.primaryOutputs ?? []
      : (node.outputs.length ? node.outputs : node.inputs).map(flow => flow.itemId);
    return [referenceNode.id, [...new Set(items)]];
  }));
}
