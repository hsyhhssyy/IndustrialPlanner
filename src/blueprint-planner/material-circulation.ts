

// AI-REMOVED 2026-11-17:
// Reason: 收敛到已完成全物品实测的 v13 搜索内核，撤回后续算法尝试。
// Trigger: 用户要求选择自动未劣化、人工基本有首解的稳定版本并移除其他尝试。
// Evidence: history/20261114T163844782Z-2672695.meta.json；自动 215/215，人工预算内首解 198/215。
// Replacement: 本文件上方当前分支 HEAD 基线实现及明确保留的准备校验修正。
// Risk: 后续实验的局部改善不再提供，困难人工样本仍可能无解；历史成绩不是新测试成绩。
// Human Review: Required
// Original code:
// 原文件 src/blueprint-planner/material-circulation.ts 第 1 行：
// import { buildLayoutGraph } from "./layout-graph";
// import type { PlannerNetwork, PlannerWire } from "./model";
//
// /** 仅对能够证明物料当量守恒、没有持续外供的闭环建立库存下界。 */
// // AI-CORRECTION 2026-11-16：同时保留既有等流植物回流的长度约束；增产外排不满足全物料守恒，不能用新证明替代旧约束。
// export function materialCirculationLimits(network: PlannerNetwork, wires: readonly PlannerWire[]) {
//   const graph = buildLayoutGraph(network.nodes.map(node => node.entity.id),
//     wires.map(wire => ({ from: wire.source.entityId, to: wire.target.entityId })));
//   return graph.groups.filter(group => group.cyclic).flatMap(group => {
//     const ids = new Set(group.nodeIds), nodes = network.nodes.filter(node => ids.has(node.entity.id));
//     const edges = wires.flatMap((wire, index) => ids.has(wire.source.entityId) && ids.has(wire.target.entityId) ? [index] : []);
//     if (!edges.length || edges.some(index => wires[index]!.itemIds.length !== 1)) return [];
//     const items = new Set(edges.map(index => wires[index]!.itemIds[0]!));
//     // 延续原 candidate.ts 的等流植物回流判据；库存读取和实际路线计费仍与普通循环共用。
//     const equalFlowPlant = nodes.some(node => node.definition.id === "seedcol_1")
//       && nodes.every(node => !node.recipe || ["seedcol_1", "planter_1", "planter_1_liquid"].includes(node.definition.id))
//       && edges.every(index => Math.abs(wires[index]!.perMinute - wires[edges[0]!]!.perMinute) < 1e-6);
//     const relations = [];
//     for (const node of nodes.filter(node => node.recipe && !equalFlowPlant)) {
//       const inputs = node.inputs.filter(flow => items.has(flow.itemId)), outputs = node.outputs.filter(flow => items.has(flow.itemId));
//       // 多物料联合变换尚不能由单一比率证明守恒，不据此剪枝。
//       if (new Set(inputs.map(flow => flow.itemId)).size !== 1 || new Set(outputs.map(flow => flow.itemId)).size !== 1) return [];
//       const incoming = inputs.reduce((sum, flow) => sum + flow.perMinute, 0), outgoing = outputs.reduce((sum, flow) => sum + flow.perMinute, 0);
//       if (incoming <= 0 || outgoing <= 0) return [];
//       relations.push({ input: inputs[0]!.itemId, output: outputs[0]!.itemId, incoming, outgoing });
//     }
//     const weights = new Map<string, number>(equalFlowPlant ? [...items].map(item => [item, 1] as const) : [[[...items][0]!, 1]]);
//     for (let pass = 0; pass < items.size; pass++) for (const relation of relations) {
//       const input = weights.get(relation.input), output = weights.get(relation.output);
//       if (input !== undefined && output === undefined) weights.set(relation.output, input * relation.incoming / relation.outgoing);
//       if (output !== undefined && input === undefined) weights.set(relation.input, output * relation.outgoing / relation.incoming);
//     }
//     if (weights.size !== items.size || [...weights.values()].some(weight => !Number.isFinite(weight) || weight <= 0)) return [];
//     if (relations.some(relation => Math.abs(weights.get(relation.input)! * relation.incoming
//       - weights.get(relation.output)! * relation.outgoing) > 1e-6)) return [];
//     // 分流、汇流也必须维持目标当量流率；向闭环外持续输出循环物料不适用此证明。
//     for (const node of nodes) {
//       const total = (source: boolean) => edges.reduce((sum, index) => {
//         const wire = wires[index]!;
//         return sum + ((source ? wire.source : wire.target).entityId === node.entity.id ? wire.perMinute * weights.get(wire.itemIds[0]!)! : 0);
//       }, 0);
//       if (Math.abs(total(true) - total(false)) > 1e-6) return [];
//     }
//     // AI-CORRECTION 2026-11-16：植物原判据允许额外增产外排，其他物料循环仍须验证没有外泄。
//     if (!equalFlowPlant && wires.some(wire => ids.has(wire.source.entityId) && !ids.has(wire.target.entityId) && wire.itemIds.some(item => items.has(item)))) return [];
//     let inventory = 0;
//     const admitted = new Set<string>();
//     const inventoryNodes = new Set(nodes);
//     for (const wire of wires.filter(wire => !ids.has(wire.source.entityId) && ids.has(wire.target.entityId)
//       && wire.itemIds.some(item => items.has(item)))) {
//       const source = network.nodes.find(node => node.entity.id === wire.source.entityId)!;
//       const incoming = wires.filter(edge => edge.target.entityId === source.entity.id);
//       if (wire.itemIds.length !== 1 || !incoming.length) return [];
//       // 必须检查每条实际入边对应的准入规则；无关端口上的有限配置不能证明整个来源有限。
//       for (const edge of incoming) {
//         const key = `portGroups[${edge.target.groupIndex}].ports[${edge.target.portIndex}].admissionRule`;
//         const rule = source.entity.config[key];
//         if (!rule || typeof rule !== "object" || !("itemId" in rule) || rule.itemId !== wire.itemIds[0]
//           || !("limit" in rule) || typeof rule.limit !== "number" || !Number.isFinite(rule.limit) || rule.limit < 0) return [];
//         const token = `${source.entity.id}/${key}`;
//         if (!admitted.has(token)) { inventory += rule.limit * weights.get(wire.itemIds[0]!)!; admitted.add(token); }
//       }
//       if (source.recipe) return [];
//       inventoryNodes.add(source);
//     }
//     // 场景补丁覆盖同一槽位配置；同时纳入定义默认库存，避免漏算或重复计数。
//     for (const node of inventoryNodes) for (const [groupIndex, storage] of node.definition.storageSlotGroups.entries()) {
//       for (const [slotIndex, slot] of storage.slots.entries()) {
//         const prefix = `storageSlotGroups[${groupIndex}].slots[${slotIndex}]`, config = node.entity.config;
//         let item = config[`${prefix}.initialItemType`] === undefined ? slot.initialItemType : config[`${prefix}.initialItemType`];
//         let count = config[`${prefix}.initialCount`] === undefined ? slot.initialCount : config[`${prefix}.initialCount`];
//         let infinite = config[`${prefix}.ignoreStock`] === undefined ? slot.ignoreStock : config[`${prefix}.ignoreStock`];
//         for (const patch of network.initialSlots) if (patch.entityId === node.entity.id
//           && patch.storageGroupId === storage.id && patch.slotId === slot.id) {
//           item = patch.itemType; count = patch.count; infinite = patch.ignoreStock;
//         }
//         if (typeof item !== "string" || !weights.has(item)) continue;
//         if (infinite === true || typeof count !== "number" || !Number.isFinite(count)) return [];
//         inventory += Math.max(0, count) * weights.get(item)!;
//       }
//     }
//     const processing = nodes.reduce((sum, node) => sum + (node.recipe?.durationSeconds ?? 0)
//       * node.inputs.reduce((rate, flow) => rate + flow.perMinute * (weights.get(flow.itemId) ?? 0), 0) / 60, 0);
//     return [{ edges, weights: edges.map(index => weights.get(wires[index]!.itemIds[0]!)!), inventory, processing }];
//   });
// }
