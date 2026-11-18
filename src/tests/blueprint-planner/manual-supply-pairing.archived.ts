

// AI-REMOVED 2026-11-17:
// Reason: 收敛到已完成全物品实测的 v13 搜索内核，撤回后续算法尝试。
// Trigger: 用户要求选择自动未劣化、人工基本有首解的稳定版本并移除其他尝试。
// Evidence: history/20261114T163844782Z-2672695.meta.json；自动 215/215，人工预算内首解 198/215。
// Replacement: 本文件上方当前分支 HEAD 基线实现及明确保留的准备校验修正。
// Risk: 后续实验的局部改善不再提供，困难人工样本仍可能无解；历史成绩不是新测试成绩。
// Human Review: Required
// Original code:
// 原文件 src/tests/blueprint-planner/manual-supply-pairing.test.ts 第 1 行：
// // @vitest-environment node
// import { expect, it } from "vitest";
// import { createRegistryContract } from "@/registry";
// import { PlannerPlacement } from "@/blueprint-planner/placement";
// import { wireProductionNetwork } from "@/blueprint-planner/wiring";
// import { PlannerRouter } from "@/blueprint-planner/router";
// import type { PlannerNetwork } from "@/blueprint-planner/model";
// import type { BlueprintPlannerRequest } from "@/domain/blueprint-planner";
// import request from "./fixtures/environment-supply.json";
// import fixture from "./fixtures/manual-supply-pairing.json";
//
// function scene() {
//   const registry = createRegistryContract(), data = structuredClone(fixture);
//   const network = { request: { ...structuredClone(request), manualLayout: data.manualLayout } as BlueprintPlannerRequest,
//     nodes: data.nodes.map(node => ({ ...node, recipe: null,
//       definition: registry.queries.findEntityDefinition(node.entity.definitionId)! })),
//     slotLinks: [], initialSlots: [], preferredGasCount: 0 } as PlannerNetwork;
//   const placement = new PlannerPlacement(registry, 70, 0, 0, 0, 1);
//   placement.reserve(network.nodes);
//   return { registry, network, placement };
// }
//
// it("配方任务按固定端口几何重配普通供料，不冻结自动生成的交叉分组", async () => {
//   const { registry, network, placement } = scene();
//   const wires = await wireProductionNetwork(registry, network, placement, () => {}, true);
//   expect(wires).toHaveLength(3);
//   expect(wires.find(wire => wire.target.entityId === "near-consumer")?.source.entityId).toBe("near-source");
//   // 2026-11-16：几何冲突解除后仍优先沿用合理的原分组，仅将被挤出的来源重新分配。
//   expect(wires.find(wire => wire.target.entityId === "middle-consumer")?.source.entityId).toBe("near-source");
//   expect(wires.find(wire => wire.target.entityId === "far-consumer")?.source.entityId).toBe("far-source");
//   for (const id of ["near-consumer", "middle-consumer", "far-consumer"]) {
//     expect(wires.filter(wire => wire.target.entityId === id).reduce((sum, wire) => sum + wire.perMinute, 0)).toBe(30);
//   }
//   const router = new PlannerRouter(registry, network.nodes.map(node => node.entity), wires.flatMap(wire => [wire.source, wire.target]),
//     { minimumX: 0, minimumY: 0, maximumX: 69, maximumY: 69, escapeLength: 0 });
//   for (const wire of wires) await router.connect(wire.source, wire.target, () => {}, wire.minimumCells);
//   expect(router.routes).toHaveLength(3);
// });
//
// it("普通供料重配仍保留输入通道明确指定的来源", async () => {
//   const { registry, network, placement } = scene();
//   network.nodes.find(node => node.entity.id === "near-consumer")!.inputs[0] = {
//     itemId: "item_liquid_water", perMinute: 30, sourceEntityIds: ["far-source"],
//   };
//   const wires = await wireProductionNetwork(registry, network, placement, () => {}, true);
//   expect(wires.find(wire => wire.target.entityId === "near-consumer")?.source.entityId).toBe("far-source");
// });
//
// it("有限启动来源继续遵守自己的供料目标", async () => {
//   const { registry, network, placement } = scene();
//   const index = network.nodes.findIndex(node => node.entity.id === "near-source");
//   network.nodes[index] = { ...network.nodes[index]!, purpose: "startup" };
//   const wires = await wireProductionNetwork(registry, network, placement, () => {}, true);
//   expect(wires.filter(wire => wire.source.entityId === "near-source").map(wire => wire.target.entityId).sort())
//     .toEqual(["far-consumer", "middle-consumer"]);
// });
