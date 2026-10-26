// @vitest-environment node
// 2026-10-21：端点共格按运输轴判定；覆盖完整裁判、数值评分、Router 和 Dense 物品隔离。
// 依据：.docs/common/eda/算法探索/算法探索20261021-通用布线进展与搜索预算.md，Windows probe317–319。
import { expect, it } from "vitest";
import { createRegistryContract } from "@/registry";
import { CompactLayoutSearch } from "@/blueprint-planner/compact-layout";
import { PlannerLayoutKernel } from "@/blueprint-planner/cpu-layout";
import { PlannerRouter } from "@/blueprint-planner/router";
import type { PlannerNetwork, PlannerWire } from "@/blueprint-planner/model";
import type { PlannerLayoutBatch } from "@/blueprint-planner/layout-backend";
import type { PlannerSearchStatistics } from "@/blueprint-planner/search-types";
import type { BlueprintPlannerRequest } from "@/domain/blueprint-planner";
import type { WorldEntity } from "@/domain/document/world-document";
import type { SimulationBlueprintRunRequest } from "@/domain/simulation/types/simulation-blueprint-types";
import { executeBlueprint } from "@/simulation/blueprint";
import { createDenseBlueprintEngine } from "@/simulation/dense/blueprint-engine";
import fixture from "./fixtures/shared-terminal-crossings.json";

const registry = createRegistryContract();
type Row = typeof fixture.valid[number] | typeof fixture.invalid[number];

function scene(row: Row) {
  const entities = structuredClone(row.entities) as WorldEntity[];
  const wires = structuredClone(row.wires) as PlannerWire[];
  const network: PlannerNetwork = {
    request: structuredClone(fixture.request) as BlueprintPlannerRequest,
    nodes: entities.map(entity => ({ entity, definition: registry.queries.findEntityDefinition(entity.definitionId)!,
      recipe: null, purpose: "logistics", inputs: [], outputs: [] })),
    slotLinks: [], initialSlots: [], preferredGasCount: 0,
  };
  const statistics: PlannerSearchStatistics = { seed: 1, evaluationLimit: 1, evaluations: 0, acceptedMoves: 0,
    routingAttempts: 0, initialWireLength: 0, finalWireLength: 0, outline: { width: 7, height: 7 }, strategy: "compact" };
  const input: PlannerLayoutBatch = { ...row.batch, parameters: new Int32Array(row.batch.parameters),
    geometry: new Int32Array(row.batch.geometry), edges: new Int32Array(row.batch.edges),
    overlaps: new Int32Array(row.batch.overlaps), poses: new Int32Array(row.batch.poses) };
  return { entities, wires, network, statistics, input };
}

it.each(fixture.valid)("正交端点共格可连通并保持物品隔离：$kind / reverse=$reverse / turn=$turn", async row => {
  const { entities, wires, network, statistics, input } = scene(row);
  expect(await new CompactLayoutSearch(registry, network, wires, statistics).advance(0, () => {})).toBe(true);
  expect(statistics.remainingConflicts).toEqual({ geometry: 0, power: 0, boundary: 0, connections: 0 });
  expect(statistics.evaluations).toBe(0);
  // 两条端点曼哈顿距离各 3，权重各 1，数值内核每格 10 分；除此以外没有冲突。
  expect(new PlannerLayoutKernel(input).score()).toBe(60);
  input.parameters[8] = 0;
  expect(new PlannerLayoutKernel(input).score()).toBe(60);
  for (const order of row.orders) {
    const router = new PlannerRouter(registry, entities, wires.flatMap(wire => [wire.source, wire.target]),
      { minimumX: 0, minimumY: 0, maximumX: 6, maximumY: 6, escapeLength: 0 });
    for (const index of order.order) await router.connect(wires[index]!.source, wires[index]!.target, () => {});
    expect(router.routes).toHaveLength(2);
    // AI-CORRECTION 2026-10-26：新容量代理接口已撤下；本用例继续严格验证实际 Router 路线和 Dense 的物品隔离。
    const execution = structuredClone(order.execution) as SimulationBlueprintRunRequest;
    // 仿真使用保存的版本化完整场景；生成的物流设备必须与该场景一致，避免只验证旧蓝图。
    expect(Object.fromEntries(router.entities.map(entity => [entity.id, entity]))).toEqual(Object.fromEntries(
      Object.entries(execution.blueprint.entities).filter(([id]) => !entities.some(entity => entity.id === id))));
    const dense = await executeBlueprint(registry, "dense-v2", execution, options => createDenseBlueprintEngine(registry, options), undefined, 2);
    expect(dense.status).toBe("completed");
    expect(dense.probes.map(probe => ({ id: probe.id, amount: probe.amount }))).toEqual([
      { id: "0/0", amount: 1 }, { id: "0/1", amount: 0 }, { id: "1/0", amount: 0 }, { id: "1/1", amount: 1 },
    ]);
  }
});

it.each(fixture.invalid)("同轴端点争格仍拒绝：$kind / turn=$turn", async row => {
  const { entities, wires, network, statistics, input } = scene(row);
  expect(await new CompactLayoutSearch(registry, network, wires, statistics).advance(0, () => {})).toBe(false);
  expect(statistics.remainingConflicts?.geometry).toBe(1);
  input.parameters[8] = 0;
  const wireCost = wires.reduce((sum, wire, index) => sum + (Math.abs(wire.source.outside.x - wire.target.outside.x)
    + Math.abs(wire.source.outside.y - wire.target.outside.y)) * input.edges[index * 40 + 4]! * 10, 0);
  expect(new PlannerLayoutKernel(input).score() - wireCost).toBe(10000);
  for (const order of [[0, 1], [1, 0]]) {
    const router = new PlannerRouter(registry, entities, wires.flatMap(wire => [wire.source, wire.target]),
      { minimumX: 0, minimumY: 0, maximumX: 6, maximumY: 6, escapeLength: 0 });
    const connectAll = async () => {
      for (const index of order) await router.connect(wires[index]!.source, wires[index]!.target, () => {});
    };
    await expect(connectAll()).rejects.toThrow();
    expect(router.routes.length).toBeLessThan(2);
  }
});

// AI-REMOVED 2026-10-26:
// Reason: 纠正首轮回退把物理正确性覆盖一并撤下的范围错误。
// Trigger: 用户确认保留业务修复；正交通行和同轴隔离均属于当前物理规则。
// Evidence: 首轮正常回归暴露物理规则回归，当前恢复两类真实 Router/Dense 验证。
// Replacement: 本文件上方活动用例。
// Risk: Low；物理验收断言保留。
// Human Review: Required
// Original code:
// // @vitest-environment node
// // 2026-10-21：端点共格按运输轴判定；覆盖完整裁判、数值评分、Router 和 Dense 物品隔离。
// // 依据：.docs/common/eda/算法探索/算法探索20261021-通用布线进展与搜索预算.md，Windows probe317–319。
// import { expect, it } from "vitest";
// import { createRegistryContract } from "@/registry";
// import { CompactLayoutSearch } from "@/blueprint-planner/compact-layout";
// import { PlannerLayoutKernel } from "@/blueprint-planner/cpu-layout";
// import { PlannerRouter } from "@/blueprint-planner/router";
// import type { PlannerNetwork, PlannerWire } from "@/blueprint-planner/model";
// import type { PlannerLayoutBatch } from "@/blueprint-planner/layout-backend";
// import type { PlannerSearchStatistics } from "@/blueprint-planner/search-types";
// import type { BlueprintPlannerRequest } from "@/domain/blueprint-planner";
// import type { WorldEntity } from "@/domain/document/world-document";
// import fixture from "./fixtures/shared-terminal-crossings.json";
//
// const registry = createRegistryContract();
// type Row = typeof fixture.valid[number] | typeof fixture.invalid[number];
//
// function scene(row: Row) {
//   const entities = structuredClone(row.entities) as WorldEntity[];
//   const wires = structuredClone(row.wires) as PlannerWire[];
//   const network: PlannerNetwork = {
//     request: structuredClone(fixture.request) as BlueprintPlannerRequest,
//     nodes: entities.map(entity => ({ entity, definition: registry.queries.findEntityDefinition(entity.definitionId)!,
//       recipe: null, purpose: "logistics", inputs: [], outputs: [] })),
//     slotLinks: [], initialSlots: [], preferredGasCount: 0,
//   };
//   const statistics: PlannerSearchStatistics = { seed: 1, evaluationLimit: 1, evaluations: 0, acceptedMoves: 0,
//     routingAttempts: 0, initialWireLength: 0, finalWireLength: 0, outline: { width: 7, height: 7 }, strategy: "compact" };
//   const input: PlannerLayoutBatch = { ...row.batch, parameters: new Int32Array(row.batch.parameters),
//     geometry: new Int32Array(row.batch.geometry), edges: new Int32Array(row.batch.edges),
//     overlaps: new Int32Array(row.batch.overlaps), poses: new Int32Array(row.batch.poses) };
//   return { entities, wires, network, statistics, input };
// }
//
// it.each(fixture.invalid)("同轴端点争格仍拒绝：$kind / turn=$turn", async row => {
//   const { entities, wires, network, statistics, input } = scene(row);
//   expect(await new CompactLayoutSearch(registry, network, wires, statistics).advance(0, () => {})).toBe(false);
//   expect(statistics.remainingConflicts?.geometry).toBe(1);
//   input.parameters[8] = 0;
//   const wireCost = wires.reduce((sum, wire, index) => sum + (Math.abs(wire.source.outside.x - wire.target.outside.x)
//     + Math.abs(wire.source.outside.y - wire.target.outside.y)) * input.edges[index * 40 + 4]! * 10, 0);
//   expect(new PlannerLayoutKernel(input).score() - wireCost).toBe(10000);
//   for (const order of [[0, 1], [1, 0]]) {
//     const router = new PlannerRouter(registry, entities, wires.flatMap(wire => [wire.source, wire.target]),
//       { minimumX: 0, minimumY: 0, maximumX: 6, maximumY: 6, escapeLength: 0 });
//     const connectAll = async () => {
//       for (const index of order) await router.connect(wires[index]!.source, wires[index]!.target, () => {});
//     };
//     await expect(connectAll()).rejects.toThrow();
//     expect(router.routes.length).toBeLessThan(2);
//   }
// });
//
// // AI-REMOVED 2026-10-26:
// // Reason: 旧内核不支持后续正交端点共格能力；保留同轴争格必须拒绝的物理约束回归。
// // Trigger: 用户确认恢复 beta1/2 搜索内核并保留业务修复、任务接口。
// // Evidence: src/tests/blueprint-planner/shared-terminal-crossings.test.ts；原文件 SHA256 d38c507129e99e761a4d0508c3a059eeb140623ff4e0791ed9832d3293ca10c2。
// // Replacement: 当前文件活动代码，或 beta1/2 对应执行路径。
// // Risk: 仅撤下已移除的算法分支参数/覆盖；公开预算、产率和任务一致性断言保持。
// // Human Review: Required
// // Original code:
// // // @vitest-environment node
// // // 2026-10-21：端点共格按运输轴判定；覆盖完整裁判、数值评分、Router 和 Dense 物品隔离。
// // // 依据：.docs/common/eda/算法探索/算法探索20261021-通用布线进展与搜索预算.md，Windows probe317–319。
// // import { expect, it } from "vitest";
// // import { createRegistryContract } from "@/registry";
// // import { CompactLayoutSearch } from "@/blueprint-planner/compact-layout";
// // import { PlannerLayoutKernel } from "@/blueprint-planner/cpu-layout";
// // import { PlannerRouter } from "@/blueprint-planner/router";
// // import type { PlannerNetwork, PlannerWire } from "@/blueprint-planner/model";
// // import type { PlannerLayoutBatch } from "@/blueprint-planner/layout-backend";
// // import type { PlannerSearchStatistics } from "@/blueprint-planner/search-types";
// // import type { BlueprintPlannerRequest } from "@/domain/blueprint-planner";
// // import type { WorldEntity } from "@/domain/document/world-document";
// // import type { SimulationBlueprintRunRequest } from "@/domain/simulation/types/simulation-blueprint-types";
// // import { executeBlueprint } from "@/simulation/blueprint";
// // import { createDenseBlueprintEngine } from "@/simulation/dense/blueprint-engine";
// // import fixture from "./fixtures/shared-terminal-crossings.json";
// //
// // const registry = createRegistryContract();
// // type Row = typeof fixture.valid[number] | typeof fixture.invalid[number];
// //
// // function scene(row: Row) {
// //   const entities = structuredClone(row.entities) as WorldEntity[];
// //   const wires = structuredClone(row.wires) as PlannerWire[];
// //   const network: PlannerNetwork = {
// //     request: structuredClone(fixture.request) as BlueprintPlannerRequest,
// //     nodes: entities.map(entity => ({ entity, definition: registry.queries.findEntityDefinition(entity.definitionId)!,
// //       recipe: null, purpose: "logistics", inputs: [], outputs: [] })),
// //     slotLinks: [], initialSlots: [], preferredGasCount: 0,
// //   };
// //   const statistics: PlannerSearchStatistics = { seed: 1, evaluationLimit: 1, evaluations: 0, acceptedMoves: 0,
// //     routingAttempts: 0, initialWireLength: 0, finalWireLength: 0, outline: { width: 7, height: 7 }, strategy: "compact" };
// //   const input: PlannerLayoutBatch = { ...row.batch, parameters: new Int32Array(row.batch.parameters),
// //     geometry: new Int32Array(row.batch.geometry), edges: new Int32Array(row.batch.edges),
// //     overlaps: new Int32Array(row.batch.overlaps), poses: new Int32Array(row.batch.poses) };
// //   return { entities, wires, network, statistics, input };
// // }
// //
// // it.each(fixture.valid)("正交端点共格可连通并保持物品隔离：$kind / reverse=$reverse / turn=$turn", async row => {
// //   const { entities, wires, network, statistics, input } = scene(row);
// //   expect(await new CompactLayoutSearch(registry, network, wires, statistics).advance(0, () => {})).toBe(true);
// //   expect(statistics.remainingConflicts).toEqual({ geometry: 0, power: 0, boundary: 0, connections: 0 });
// //   expect(statistics.evaluations).toBe(0);
// //   // 两条端点曼哈顿距离各 3，权重各 1，数值内核每格 10 分；除此以外没有冲突。
// //   expect(new PlannerLayoutKernel(input).score()).toBe(60);
// //   input.parameters[8] = 0;
// //   expect(new PlannerLayoutKernel(input).score()).toBe(60);
// //   for (const order of row.orders) {
// //     const router = new PlannerRouter(registry, entities, wires.flatMap(wire => [wire.source, wire.target]),
// //       { minimumX: 0, minimumY: 0, maximumX: 6, maximumY: 6, escapeLength: 0 });
// //     for (const index of order.order) await router.connect(wires[index]!.source, wires[index]!.target, () => {});
// //     expect(router.routes).toHaveLength(2);
// //     expect(router.staticConstraints(wires)).toEqual({ disconnectedWires: 0, capacityDeficit: 0 });
// //     const execution = structuredClone(order.execution) as SimulationBlueprintRunRequest;
// //     // 仿真使用保存的版本化完整场景；生成的物流设备必须与该场景一致，避免只验证旧蓝图。
// //     expect(Object.fromEntries(router.entities.map(entity => [entity.id, entity]))).toEqual(Object.fromEntries(
// //       Object.entries(execution.blueprint.entities).filter(([id]) => !entities.some(entity => entity.id === id))));
// //     const dense = await executeBlueprint(registry, "dense-v2", execution, options => createDenseBlueprintEngine(registry, options), undefined, 2);
// //     expect(dense.status).toBe("completed");
// //     expect(dense.probes.map(probe => ({ id: probe.id, amount: probe.amount }))).toEqual([
// //       { id: "0/0", amount: 1 }, { id: "0/1", amount: 0 }, { id: "1/0", amount: 0 }, { id: "1/1", amount: 1 },
// //     ]);
// //   }
// // });
// //
// // it.each(fixture.invalid)("同轴端点争格仍拒绝：$kind / turn=$turn", async row => {
// //   const { entities, wires, network, statistics, input } = scene(row);
// //   expect(await new CompactLayoutSearch(registry, network, wires, statistics).advance(0, () => {})).toBe(false);
// //   expect(statistics.remainingConflicts?.geometry).toBe(1);
// //   input.parameters[8] = 0;
// //   const wireCost = wires.reduce((sum, wire, index) => sum + (Math.abs(wire.source.outside.x - wire.target.outside.x)
// //     + Math.abs(wire.source.outside.y - wire.target.outside.y)) * input.edges[index * 40 + 4]! * 10, 0);
// //   expect(new PlannerLayoutKernel(input).score() - wireCost).toBe(10000);
// //   for (const order of [[0, 1], [1, 0]]) {
// //     const router = new PlannerRouter(registry, entities, wires.flatMap(wire => [wire.source, wire.target]),
// //       { minimumX: 0, minimumY: 0, maximumX: 6, maximumY: 6, escapeLength: 0 });
// //     const connectAll = async () => {
// //       for (const index of order) await router.connect(wires[index]!.source, wires[index]!.target, () => {});
// //     };
// //     await expect(connectAll()).rejects.toThrow();
// //     expect(router.routes.length).toBeLessThan(2);
// //   }
// // });
// //
//
