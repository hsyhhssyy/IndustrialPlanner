/** 人工布局的设备范围；界面和规划校验共用，旧任务也不能绕过产品限制。 */
export function isPlannerManualDeviceSupported(definitionId: string): boolean {
  return definitionId !== "power_sta_1" && definitionId !== "squirter_1" && !definitionId.startsWith("soil_");
}
import type { EntityDefinition } from "@/domain/registry/types/entity-definition";
import type { BlueprintPlannerManualBoundarySide, BlueprintPlannerOptions } from "@/domain/blueprint-planner";


/** 存取口依附候选边界，只关联所属边，不在无界草稿中固定格位。 */
// AI-CORRECTION 2026-11-13：UI 继续使用所属边关联；完整设备蓝图可通过既有 placements 锁定相对格位，求解时统一贴边平移。
export function isPlannerManualBoundaryDevice(definition: EntityDefinition): boolean {
  return definition.placementBehaviors.some(behavior => behavior.type === "must-connect-to-hub-via-opposite-port-edge");
}

export function manualBoundarySides(shape: BlueprintPlannerOptions["warehouseBus"]): readonly BlueprintPlannerManualBoundarySide[] {
  return shape === "straight" ? ["base"] : shape === "corner" ? ["base", "left"] : ["base", "left", "right"];
}

/** 存取线角色与世界物理边映射；设备群旋转和外框定位不参与该映射。 */
export function manualBusEdge(shape: BlueprintPlannerOptions["warehouseBus"],
  busEdges: Readonly<Partial<Record<BlueprintPlannerManualBoundarySide, "top" | "right" | "bottom" | "left">>> | undefined,
  role: BlueprintPlannerManualBoundarySide): "top" | "right" | "bottom" | "left" {
  if (role === "base") {
    const edge = busEdges?.base;
    return edge === "top" || edge === "bottom" || shape === "straight" && (edge === "left" || edge === "right") ? edge : "bottom";
  }
  return shape === "corner" && role === "left" && busEdges?.left === "right" ? "right" : role;
}

/** 切换形态时丢弃不可用角色及方向，旧草稿采用下边、左支段。 */
export function normalizeManualBusEdges(shape: BlueprintPlannerOptions["warehouseBus"],
  busEdges: Parameters<typeof manualBusEdge>[1]): NonNullable<Parameters<typeof manualBusEdge>[1]> {
  return Object.fromEntries(manualBoundarySides(shape).map(role => [role, manualBusEdge(shape, busEdges, role)]));
}

export function assertManualBusEdges(shape: BlueprintPlannerOptions["warehouseBus"], busEdges: unknown): void {
  if (busEdges === undefined) return;
  if (!busEdges || typeof busEdges !== "object" || Array.isArray(busEdges)
    || Object.entries(busEdges).some(([role, edge]) => !manualBoundarySides(shape).includes(role as BlueprintPlannerManualBoundarySide)
      || manualBusEdge(shape, busEdges as Parameters<typeof manualBusEdge>[1], role as BlueprintPlannerManualBoundarySide) !== edge)) {
    throw new Error("人工存取线边映射与当前形态不一致。");
  }
}
