

// AI-REMOVED 2026-11-17:
// Reason: 收敛到已完成全物品实测的 v13 搜索内核，撤回后续算法尝试。
// Trigger: 用户要求选择自动未劣化、人工基本有首解的稳定版本并移除其他尝试。
// Evidence: history/20261114T163844782Z-2672695.meta.json；自动 215/215，人工预算内首解 198/215。
// Replacement: 本文件上方当前分支 HEAD 基线实现及明确保留的准备校验修正。
// Risk: 后续实验的局部改善不再提供，困难人工样本仍可能无解；历史成绩不是新测试成绩。
// Human Review: Required
// Original code:
// 原文件 src/tests/blueprint-planner/manual-port-assignment.test.ts 第 1 行：
// // @vitest-environment node
// import { describe, expect, it } from "vitest";
// import { createRegistryContract } from "@/registry";
// import { createPlainNode } from "@/blueprint-planner/placement";
// import { CompactLayoutSearch } from "@/blueprint-planner/compact-layout";
// import { getPlannerPorts } from "@/blueprint-planner/geometry";
// import type { PlannerNetwork, PlannerWire } from "@/blueprint-planner/model";
// import type { BlueprintPlannerRequest } from "@/domain/blueprint-planner";
// import type { GridRotation } from "@/domain/shared/grid";
// import input from "./fixtures/environment-supply.json";
// import competition from "./fixtures/manual-port-competition.json";
// import sharedStorage from "./fixtures/manual-shared-storage-ports.json";
// import crossing from "./fixtures/manual-port-crossing.json";
// import { PlannerRouter } from "@/blueprint-planner/router";
//
// const registry = createRegistryContract();
// function inspect(network: PlannerNetwork, wires: PlannerWire[]) {
//   const statistics = { seed: 1, evaluationLimit: 1, evaluations: 0, acceptedMoves: 0, routingAttempts: 0,
//     initialWireLength: 0, finalWireLength: 0, outline: { width: 70, height: 70 }, strategy: "compact" as const };
//   const search = new CompactLayoutSearch(registry, network, wires, statistics);
//   return { search, ...search.inspectProposal() };
// }
//
// describe("固定布局的端口分配", () => {
//   it("检查与发布恢复的提案保留端口身份，只有显式优化才修复受阻端口", () => {
//     const nodes = sharedStorage.nodes.map(value => {
//       const node = createPlainNode(registry, value.definitionId, value.id, "production");
//       node.entity.position = { ...value.position }; node.entity.rotation = value.rotation as GridRotation;
//       return node;
//     });
//     const source = nodes[0]!, target = nodes[2]!;
//     const sourcePort = getPlannerPorts(registry, source.entity, source.definition, "output", sharedStorage.itemId)
//       .find(port => port.groupIndex === sharedStorage.sourceGroupIndex)!;
//     const targetPort = getPlannerPorts(registry, target.entity, target.definition, "input", sharedStorage.itemId)[0]!;
//     const network: PlannerNetwork = { request: structuredClone(input) as BlueprintPlannerRequest,
//       nodes, slotLinks: [], initialSlots: [], preferredGasCount: 0 };
//     const wires = [{ source: sourcePort, target: targetPort, itemIds: [sharedStorage.itemId], perMinute: 30 }];
//     const original = { poses: nodes.map(node => ({ ...node.entity.position, rotation: node.entity.rotation })), ports: [[
//       `${sourcePort.groupIndex}/${sourcePort.portIndex}/${sourcePort.direction}`,
//       `${targetPort.groupIndex}/${targetPort.portIndex}/${targetPort.direction}`,
//     ] as const] };
//     const { search } = inspect(network, wires);
//     const optimized = search.captureProposal();
//     search.restoreProposal(original);
//     expect(search.inspectProposal().issues.some(issue => issue.kind === "port-blocked")).toBe(true);
//     expect(search.captureProposal()).toEqual(original);
//     search.publishProposal(original);
//     search.restoreProposal(optimized);
//     search.snapshotBest(false);
//     expect(search.captureProposal()).toEqual(optimized);
//     search.applyBest();
//     expect(search.captureProposal()).toEqual(original);
//     expect(wires[0]!.source.groupIndex).toBe(sourcePort.groupIndex);
//     expect(wires[0]!.source.portIndex).toBe(sourcePort.portIndex);
//     expect(search.inspectProposal(true).issues.filter(issue => issue.kind === "port-blocked")).toEqual([]);
//     expect(search.captureProposal().ports).not.toEqual(original.ports);
//   });
//
//   it.each(["blocked", "clear"] as const)("共用引出格的垂直交叉必须具备直行空间：%s", async state => {
//     const fixture = structuredClone(crossing[state]);
//     const nodes = fixture.nodes.map(value => {
//       const node = createPlainNode(registry, value.entity.definitionId, value.entity.id, "production");
//       Object.assign(node.entity, value.entity);
//       return node;
//     });
//     const network: PlannerNetwork = { request: structuredClone(input) as BlueprintPlannerRequest,
//       nodes, slotLinks: [], initialSlots: [], preferredGasCount: 0 };
//     const wires = fixture.wires as PlannerWire[];
//     const statistics = { seed: 1, evaluationLimit: 1, evaluations: 0, acceptedMoves: 0, routingAttempts: 0,
//       initialWireLength: 0, finalWireLength: 0, outline: fixture.outline, strategy: "compact" as const };
//     const search = new CompactLayoutSearch(registry, network, wires, statistics, undefined, undefined,
//       new Set(nodes.map(node => node.entity.id)));
//     const inspection = search.inspectProposal();
//     expect(inspection.evaluation.feasible).toBe(state === "clear");
//     expect(inspection.issues.some(issue => issue.kind === "port-competition")).toBe(state === "blocked");
//     // 同一交叉被分区拆成内部线路与模块接口时，仍需遵守两轴都能直行的条件。
//     for (const [internal, external] of [[0, 1], [1, 0]]) {
//       const partition = new CompactLayoutSearch(registry, network, [wires[internal!]!], { ...statistics }, undefined, undefined,
//         new Set(nodes.map(node => node.entity.id)), [wires[external!]!.source]);
//       const checked = partition.inspectProposal();
//       expect(checked.evaluation.feasible).toBe(state === "clear");
//       expect(checked.issues.some(issue => issue.kind === "port-competition")).toBe(state === "blocked");
//     }
//     for (const order of [[0, 1], [1, 0]]) {
//       const router = new PlannerRouter(registry, nodes.map(node => node.entity), wires.flatMap(wire => [wire.source, wire.target]),
//         { minimumX: 0, minimumY: 0, maximumX: fixture.outline.width - 1, maximumY: fixture.outline.height - 1, escapeLength: 0 });
//       if (state === "blocked") {
//         const wire = wires[0]!;
//         await expect(router.connect(wire.source, wire.target, () => {}, wire.minimumCells)).rejects.toThrow("物流通道受阻");
//       } else for (const index of order) {
//         const wire = wires[index]!;
//         expect(await router.connect(wire.source, wire.target, () => {}, wire.minimumCells)).toBeGreaterThan(0);
//       }
//     }
//   });
//
//   it("独立线路不争用近邻设备之间唯一的引出格", () => {
//     const nodes = competition.nodes.map(value => {
//       const node = createPlainNode(registry, value.entity.definitionId, value.entity.id, "production");
//       Object.assign(node.entity, structuredClone(value.entity));
//       return node;
//     });
//     const network: PlannerNetwork = { request: structuredClone(input) as BlueprintPlannerRequest,
//       nodes, slotLinks: [], initialSlots: [], preferredGasCount: 0 };
//     const { issues } = inspect(network, structuredClone(competition.wires) as PlannerWire[]);
//     expect(issues.filter(issue => issue.kind === "port-competition")).toEqual([]);
//   });
//
//   it("被固定障碍遮挡的输出可改用同库存的另一端口组", () => {
//     const nodes = sharedStorage.nodes.map(value => {
//       const node = createPlainNode(registry, value.definitionId, value.id, "production");
//       node.entity.position = { ...value.position }; node.entity.rotation = value.rotation as GridRotation;
//       return node;
//     });
//     const source = nodes[0]!, target = nodes[2]!;
//     const sourcePort = getPlannerPorts(registry, source.entity, source.definition, "output", sharedStorage.itemId)
//       .find(port => port.groupIndex === sharedStorage.sourceGroupIndex)!;
//     const targetPort = getPlannerPorts(registry, target.entity, target.definition, "input", sharedStorage.itemId)[0]!;
//     const network: PlannerNetwork = { request: structuredClone(input) as BlueprintPlannerRequest,
//       nodes, slotLinks: [], initialSlots: [], preferredGasCount: 0 };
//     const wires = [{ source: sourcePort, target: targetPort, itemIds: [sharedStorage.itemId], perMinute: 30 }];
//     const { search, issues } = inspect(network, wires);
//     expect(issues.filter(issue => issue.kind === "port-blocked")).toEqual([]);
//     expect(search.captureProposal().ports[0]![0]).not.toBe(`${sharedStorage.sourceGroupIndex}/0/output`);
//   });
// });
