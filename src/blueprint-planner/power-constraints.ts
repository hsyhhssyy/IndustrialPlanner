
// AI-REMOVED 2026-10-26:
// Reason: 用户要求恢复 beta1/2 搜索内核，撤回其后搜索实现；保留业务正确性修复与公开任务接口。
// Trigger: 多版本对照后用户明确要求回退算法并使用 2S 渐增至 3S 初始面积。
// Evidence: .temp/eda/all-items/comparisons/default-area-20261026T015057315Z.json；回退前 SHA256 f707ac31ad008eb9cfcd1be083b6fb5cbde4f14fc2270cf1856d7673c80fee33。
// Replacement: None；功能随 beta1/2 搜索内核回退撤下
// Risk: 搜索策略、检查点及后续局部修复能力变化；原始未提交内容完整保留。
// Human Review: Required
// Original code (src/blueprint-planner/power-constraints.ts):
// import type { PlannerNetwork } from "./model";
// import { resolvePowerRangeGridRect } from "@/shared/geometry/power-range";
//
// /** 构造与完整布局裁判共用供电目标；待补电生成布局仍由最终覆盖过程补齐。 */
// export function plannerRequiredPowerTargets(network: PlannerNetwork): ReadonlySet<string> {
//   const complete = !network.deferPowerPlacement && (Boolean(network.request.blueprintSource)
//     || network.nodes.some(node => resolvePowerRangeGridRect(node) !== null));
//   return new Set(network.nodes.filter(node => complete && node.definition.requiresPower).map(node => node.entity.id));
// }
//
