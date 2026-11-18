

// AI-REMOVED 2026-11-17:
// Reason: 收敛到已完成全物品实测的 v13 搜索内核，撤回后续算法尝试。
// Trigger: 用户要求选择自动未劣化、人工基本有首解的稳定版本并移除其他尝试。
// Evidence: history/20261114T163844782Z-2672695.meta.json；自动 215/215，人工预算内首解 198/215。
// Replacement: 本文件上方当前分支 HEAD 基线实现及明确保留的准备校验修正。
// Risk: 后续实验的局部改善不再提供，困难人工样本仍可能无解；历史成绩不是新测试成绩。
// Human Review: Required
// Original code:
// 原文件 src/tests/blueprint-planner/routing-reserved-turn.test.ts 第 1 行：
// // @vitest-environment node
// import { expect, it } from "vitest";
// import { createRegistryContract } from "@/registry";
// import type { WorldEntity } from "@/domain/document/world-document";
// import { getPlannerPorts, type PlannerPort } from "@/blueprint-planner/geometry";
// import { PlannerRouter } from "@/blueprint-planner/router";
// import { CompactLayoutSearch } from "@/blueprint-planner/compact-layout";
// import { createPlainNode } from "@/blueprint-planner/placement";
// import type { PlannerNetwork, PlannerWire } from "@/blueprint-planner/model";
// import type { BlueprintPlannerRequest } from "@/domain/blueprint-planner";
// import request from "./fixtures/environment-supply.json";
// import fixture from "./fixtures/routing-reserved-turn.json";
// import opposed from "./fixtures/routing-opposed-ports.json";
// import disconnected from "./fixtures/layout-reserved-turn-disconnected.json";
// import directJunction from "./fixtures/layout-direct-junction.json";
//
// it("端口重配保留被汇流器本体覆盖的直连出口", async () => {
//   const registry = createRegistryContract();
//   const nodes = directJunction.nodes.map(entry => {
//     const entity = structuredClone(entry.entity) as WorldEntity;
//     const node = createPlainNode(registry, entity.definitionId, entity.id,
//       entry.purpose as "production" | "logistics");
//     Object.assign(node.entity, entity);
//     return node;
//   });
//   const wires = structuredClone(directJunction.wires) as PlannerWire[];
//   const network: PlannerNetwork = { request: structuredClone(request) as BlueprintPlannerRequest,
//     nodes, slotLinks: [], initialSlots: [], preferredGasCount: 0 };
//   const statistics = { seed: 1, evaluationLimit: 1, evaluations: 0, acceptedMoves: 0, routingAttempts: 0,
//     initialWireLength: 0, finalWireLength: 0, outline: directJunction.outline, strategy: "compact" as const };
//   const search = new CompactLayoutSearch(registry, network, wires, statistics);
//   expect(search.inspectProposal().evaluation.feasible).toBe(true);
//   search.applyBest();
//   const router = new PlannerRouter(registry, nodes.map(node => node.entity),
//     wires.flatMap(wire => [wire.source, wire.target]), { minimumX: 0, minimumY: 0,
//       maximumX: directJunction.outline.width - 1, maximumY: directJunction.outline.height - 1, escapeLength: 0 });
//   for (const wire of wires) await router.connect(wire.source, wire.target, () => {}, wire.minimumCells);
//   expect(router.routes).toHaveLength(2);
//   expect(router.routes[0]!.cells).toHaveLength(0);
// });
//
// it("布局连通检查不能穿过其他线路必须转弯的预留端口", async () => {
//   const registry = createRegistryContract();
//   const entities = structuredClone(disconnected.entities) as WorldEntity[];
//   const wires = structuredClone(disconnected.wires) as PlannerWire[];
//   const nodes = entities.map(entity => {
//     const node = createPlainNode(registry, entity.definitionId, entity.id, "production");
//     Object.assign(node.entity, entity);
//     return node;
//   });
//   const network: PlannerNetwork = { request: structuredClone(request) as BlueprintPlannerRequest,
//     nodes, slotLinks: [], initialSlots: [], preferredGasCount: 0 };
//   const statistics = { seed: 1, evaluationLimit: 1, evaluations: 0, acceptedMoves: 0, routingAttempts: 0,
//     initialWireLength: 0, finalWireLength: 0, outline: disconnected.outline, strategy: "compact" as const };
//   const layout = new CompactLayoutSearch(registry, network, wires, statistics, undefined, undefined,
//     new Set(entities.map(entity => entity.id))).inspectProposal();
//   const wire = wires[disconnected.selected]!;
//   const router = new PlannerRouter(registry, entities, wires.flatMap(entry => [entry.source, entry.target]),
//     { minimumX: 0, minimumY: 0, maximumX: disconnected.outline.width - 1,
//       maximumY: disconnected.outline.height - 1, escapeLength: 0 });
//   await expect(router.connect(wire.source, wire.target, () => {}, wire.minimumCells)).rejects.toThrow();
//   expect(layout.evaluation.conflicts.geometry).toBe(0);
//   expect(layout.evaluation.feasible).toBe(false);
//   expect(layout.issues).toContainEqual({ kind: "disconnected", amount: 1,
//     entityIds: [wire.source.entityId, wire.target.entityId], position: wire.source.outside });
// });
//
// it.each([[0, 1], [1, 0]])("相向端口的一格直连仍允许正交交叉：顺序 %s → %s", async (first, second) => {
//   const registry = createRegistryContract(), entities = structuredClone(opposed) as WorldEntity[];
//   const ports = entities.map((entity, index) => getPlannerPorts(registry, entity,
//     registry.queries.findEntityDefinition(entity.definitionId)!, index % 2 === 0 ? "output" : "input", "item_liquid_water")[0]!);
//   expect(ports.map(port => port.outside)).toEqual(Array.from({ length: 4 }, () => ({ x: 1, y: 1 })));
//   const nodes = entities.map(entity => {
//     const node = createPlainNode(registry, entity.definitionId, entity.id, "logistics");
//     Object.assign(node.entity, entity);
//     return node;
//   });
//   const network: PlannerNetwork = { request: structuredClone(request) as BlueprintPlannerRequest,
//     nodes, slotLinks: [], initialSlots: [], preferredGasCount: 0 };
//   const wires = [0, 1].map(index => ({ source: ports[index * 2]!, target: ports[index * 2 + 1]!,
//     itemIds: ["item_liquid_water"], perMinute: 30 }));
//   const statistics = { seed: 1, evaluationLimit: 1, evaluations: 0, acceptedMoves: 0, routingAttempts: 0,
//     initialWireLength: 0, finalWireLength: 0, outline: { width: 3, height: 3 }, strategy: "compact" as const };
//   const layout = new CompactLayoutSearch(registry, network, wires, statistics, undefined, undefined,
//     new Set(entities.map(entity => entity.id))).inspectProposal();
//   expect(layout.issues).toEqual([]);
//   expect(layout.evaluation.feasible).toBe(true);
//   const router = new PlannerRouter(registry, entities, ports,
//     { minimumX: 0, minimumY: 0, maximumX: 2, maximumY: 2, escapeLength: 0 });
//   for (const index of [first, second]) expect(await router.connect(ports[index * 2]!, ports[index * 2 + 1]!, () => {})).toBe(1);
//   expect(router.routes).toHaveLength(2);
// });
//
// it.each([[0, 1], [1, 0]])("必须转弯的预留端口保护后续线路：顺序 %s → %s", async (first, second) => {
//   const registry = createRegistryContract();
//   const entities = structuredClone(fixture.entities) as WorldEntity[];
//   const ports = structuredClone(fixture.ports) as PlannerPort[];
//   const bounds = { minimumX: 0, minimumY: 0, maximumX: fixture.outline.width - 1,
//     maximumY: fixture.outline.height - 1, escapeLength: 0 };
//   const router = new PlannerRouter(registry, entities, ports, bounds);
//   const replay = new PlannerRouter(registry, entities, ports, bounds);
//   for (const index of [first, second]) {
//     const wire = fixture.wires[index]!;
//     const source = wire.source as PlannerPort, target = wire.target as PlannerPort;
//     expect(await router.connect(source, target, () => {}, wire.minimumCells)).toBeGreaterThan(0);
//     expect(replay.reuse(source, target, router.routes.at(-1)!.cells, wire.minimumCells)).toBe(true);
//   }
//   expect(router.routes).toHaveLength(2);
//   expect(replay.routes).toHaveLength(2);
// });
