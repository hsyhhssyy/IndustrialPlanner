import type { PlannerNetwork } from "./model";
import { resolvePowerRangeGridRect } from "@/shared/geometry/power-range";

/** 构造与完整布局裁判共用供电目标；待补电生成布局仍由最终覆盖过程补齐。 */
export function plannerRequiredPowerTargets(network: PlannerNetwork): ReadonlySet<string> {
  const complete = !network.deferPowerPlacement && (Boolean(network.request.blueprintSource)
    || network.nodes.some(node => resolvePowerRangeGridRect(node) !== null));
  return new Set(network.nodes.filter(node => complete && node.definition.requiresPower).map(node => node.entity.id));
}
