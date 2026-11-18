

// AI-REMOVED 2026-11-17:
// Reason: 收敛到已完成全物品实测的 v13 搜索内核，撤回后续算法尝试。
// Trigger: 用户要求选择自动未劣化、人工基本有首解的稳定版本并移除其他尝试。
// Evidence: history/20261114T163844782Z-2672695.meta.json；自动 215/215，人工预算内首解 198/215。
// Replacement: 本文件上方当前分支 HEAD 基线实现及明确保留的准备校验修正。
// Risk: 后续实验的局部改善不再提供，困难人工样本仍可能无解；历史成绩不是新测试成绩。
// Human Review: Required
// Original code:
// 原文件 src/tests/blueprint-planner/material-circulation.test.ts 第 1 行：
// // @vitest-environment node
// import { expect, it } from "vitest";
// import { createRegistryContract } from "@/registry";
// import { materialCirculationLimits } from "@/blueprint-planner/material-circulation";
// import type { PlannerNetwork, PlannerWire } from "@/blueprint-planner/model";
// import fixture from "./fixtures/material-circulation-network.json";
//
// function scene() {
//   const registry = createRegistryContract(), data = structuredClone(fixture);
//   const network = { ...data.network, nodes: data.network.nodes.map(node => ({ ...node,
//     definition: registry.queries.findEntityDefinition(node.entity.definitionId)!,
//     recipe: node.recipeId ? registry.queries.findRecipeDefinition(node.recipeId)! : null })) } as PlannerNetwork;
//   return { network, wires: data.wires as PlannerWire[] };
// }
//
// it("数量变化的物料循环按守恒当量折算有限准入库存", () => {
//   const { network, wires } = scene();
//   const limits = materialCirculationLimits(network, wires);
//   expect(limits).toHaveLength(1);
//   const limit = limits[0]!;
//   const solid = limit.weights[limit.edges.findIndex(index => wires[index]!.itemIds[0] === "item_copper_enr")]!;
//   expect(limit.inventory / solid).toBeCloseTo(29);
//   expect(limit.processing / solid).toBeCloseTo(3);
//   for (const [at, index] of limit.edges.entries()) {
//     expect(limit.weights[at]! / solid).toBeCloseTo(wires[index]!.itemIds[0] === "item_copper_enr" ? 1 : 0.5);
//   }
// });
//
// it("场景槽位覆盖配置库存，不把同一份启动料算两次", () => {
//   const { network, wires } = scene();
//   const node = network.nodes.find(node => node.entity.id === "eda-device-3")!;
//   const group = node.definition.storageSlotGroups[0]!, slot = group.slots[0]!;
//   node.entity.config["storageSlotGroups[0].slots[0].initialItemType"] = "item_copper_enr";
//   node.entity.config["storageSlotGroups[0].slots[0].initialCount"] = 50;
//   network.initialSlots.push({ entityId: node.entity.id, storageGroupId: group.id, slotId: slot.id,
//     itemType: "item_copper_enr", count: 7, ignoreStock: false });
//   const limit = materialCirculationLimits(network, wires)[0]!;
//   const solid = limit.weights[limit.edges.findIndex(index => wires[index]!.itemIds[0] === "item_copper_enr")]!;
//   expect(limit.inventory / solid).toBeCloseTo(36);
// });
//
// it("无限初始库存不使用有限库存剪枝", () => {
//   const { network, wires } = scene();
//   const node = network.nodes.find(node => node.entity.id === "eda-device-3")!;
//   node.entity.config["storageSlotGroups[0].slots[0].initialItemType"] = "item_copper_enr";
//   node.entity.config["storageSlotGroups[0].slots[0].ignoreStock"] = true;
//   expect(materialCirculationLimits(network, wires)).toEqual([]);
// });
//
// it("持续外供不能借用无关准入口的有限规则", () => {
//   const { network, wires } = scene();
//   const admission = network.nodes.find(node => node.entity.id === "eda-startup-admission-5")!;
//   const incoming = wires.find(wire => wire.target.entityId === admission.entity.id)!;
//   wires[wires.indexOf(incoming)] = { ...incoming, target: { ...incoming.target, portIndex: incoming.target.portIndex + 1 } };
//   expect(materialCirculationLimits(network, wires)).toEqual([]);
// });
