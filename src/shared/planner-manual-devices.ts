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
