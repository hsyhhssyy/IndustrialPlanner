
// AI-REMOVED 2026-10-26:
// Reason: 用户要求恢复 beta1/2 搜索内核，撤回其后搜索实现；保留业务正确性修复与公开任务接口。
// Trigger: 多版本对照后用户明确要求回退算法并使用 2S 渐增至 3S 初始面积。
// Evidence: .temp/eda/all-items/comparisons/default-area-20261026T015057315Z.json；回退前 SHA256 ad7b18b20eec0e4644783c41142efd9e2ace9ed163592eb70effef8422a6f34e。
// Replacement: None；功能随 beta1/2 搜索内核回退撤下
// Risk: 搜索策略、检查点及后续局部修复能力变化；原始未提交内容完整保留。
// Human Review: Required
// Original code (src/blueprint-planner/port-assignment.ts):
// import type { RegistryContract } from "@/domain/registry/registry-contract";
// import { getPlannerPorts, type PlannerPort } from "./geometry";
// import type { PlannerNetwork, PlannerWire } from "./model";
//
// export interface PlannerPortAssignmentGroup {
//   readonly node: number;
//   readonly source: boolean;
//   readonly edges: number[];
//   readonly keys: string[];
//   readonly ports: PlannerPort[];
// }
//
// export function plannerPortKey(port: PlannerPort): string {
//   return `${port.groupIndex}/${port.portIndex}/${port.direction}`;
// }
//
// /** 共同库存、物品接受规则和导入保真决定可交换范围；布局与布线修复共用。 */
// export function plannerPortAssignmentGroups(registry: RegistryContract, network: PlannerNetwork, wires: readonly PlannerWire[],
//   ordinary: boolean, fixedNodeIds: ReadonlySet<string> = new Set()): PlannerPortAssignmentGroup[] {
//   return network.nodes.flatMap((node, index) => {
//     // 导入原图保留控制配置和端口身份，不能沿用生成模式的端口过滤及优先级重写。
//     if (network.request.blueprintSource || fixedNodeIds.has(node.entity.id)) return [];
//     const role = registry.queries.resolveLogisticsRole(node.definition.id);
//     if (role === "splitter" || role === "converger") {
//       const source = role === "splitter", direction = source ? "output" : "input";
//       const edges = wires.flatMap((wire, at) => (source ? wire.source : wire.target).entityId === node.entity.id ? [at] : []);
//       const ports = getPlannerPorts(registry, node.entity, node.definition, direction);
//       return edges.length && ports.length >= edges.length ? [{ node: index, source, edges, ports, keys: ports.map(plannerPortKey) }] : [];
//     }
//     if (!ordinary) return [];
//     // AI-REMOVED 2026-10-21:
//     // Reason: 按端口组编号分池遗漏同库存的跨组等价出口。
//     // Trigger: 系统针剂改植物后的普通网表无法将 mix_pool_1 的 fluid_output_a 换到 fluid_output_b。
//     // Evidence: Windows probe174，wire 3 接受物品相同、库存绑定均为 shared_input_buffer，旧分池仍拒绝。
//     // Replacement: 下方按库存绑定、物流类型与物品接受能力分池，布局和布线修复共用。
//     // Risk: 普通生成搜索轨迹改变；导入图和不同库存保持隔离。Human Review: Required。
//     // Original code:
//     // return node.definition.portGroups.flatMap((_, groupIndex) => (["input", "output"] as const).flatMap(direction => {
//     // const source = direction === "output";
//     // const edges = wires.flatMap((wire, at) => {
//     // const port = source ? wire.source : wire.target;
//     // return port.entityId === node.entity.id && port.groupIndex === groupIndex ? [at] : [];
//     // });
//     // const ports = getPlannerPorts(registry, node.entity, node.definition, direction).filter(port => port.groupIndex === groupIndex
//     // && edges.every(at => wires[at]!.itemIds.every(item => getPlannerPorts(registry, node.entity, node.definition, direction, item)
//     // .some(candidate => candidate.groupIndex === port.groupIndex && candidate.portIndex === port.portIndex))));
//     // return edges.length && ports.length >= edges.length && ports.length <= 6
//     // ? [{ node: index, source, edges, ports, keys: ports.map(plannerPortKey) }] : [];
//     // }));
//     // 2026-10-21：端口组名称不是库存边界；同库存、同物流类型且接受相同物料的口可跨组交换。
//     // 无库存绑定的口只在原组内交换，避免把独立通道合并；导入图与固定节点仍在上方退出。
//     return (["input", "output"] as const).flatMap(direction => {
//       const source = direction === "output";
//       const edges = wires.flatMap((wire, at) => (source ? wire.source : wire.target).entityId === node.entity.id ? [at] : []);
//       const items = [...new Set(edges.flatMap(at => wires[at]!.itemIds))].sort();
//       const accepted = new Map(items.map(item => [item, new Set(getPlannerPorts(registry, node.entity, node.definition, direction, item).map(plannerPortKey))]));
//       const pools = new Map<string, PlannerPort[]>();
//       for (const port of getPlannerPorts(registry, node.entity, node.definition, direction)) {
//         const group = node.definition.portGroups[port.groupIndex]!;
//         const bindings = [...new Set(node.definition.portStorageBindings.filter(binding => binding.portGroupId === group.id)
//           .map(binding => binding.storageSlotGroupId))].sort();
//         const key = JSON.stringify([bindings.length ? bindings : ["unbound", group.id], port.kind,
//           items.map(item => accepted.get(item)!.has(plannerPortKey(port)))]);
//         const pool = pools.get(key) ?? [];
//         pool.push(port); pools.set(key, pool);
//       }
//       return [...pools.values()].flatMap(ports => {
//         const keys = ports.map(plannerPortKey), members = edges.filter(at => keys.includes(plannerPortKey(source ? wires[at]!.source : wires[at]!.target)));
//         return members.length && ports.length >= members.length && ports.length <= 6
//           ? [{ node: index, source, edges: members, ports, keys }] : [];
//       });
//     });
//   });
// }
//
// /** 单端口换位或移到空闲口；不重复占用端口，不把局部最短距离当成合法性规则。 */
// export function proposePlannerPortKeys(current: readonly string[], keys: readonly string[], random: () => number): string[] | null {
//   if (!current.length || keys.length < current.length) return null;
//   const edge = Math.floor(random() * current.length), alternatives = keys.filter(key => key !== current[edge]);
//   if (!alternatives.length) return null;
//   const next = current.slice(), selected = alternatives[Math.floor(random() * alternatives.length)]!;
//   const occupied = next.indexOf(selected);
//   if (occupied >= 0) next[occupied] = next[edge]!;
//   next[edge] = selected;
//   return next;
// }
//
