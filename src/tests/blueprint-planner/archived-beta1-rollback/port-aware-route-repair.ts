
// AI-REMOVED 2026-10-26:
// Reason: 测试仅覆盖 beta1/2 之后加入且本次撤下的局部修复、容量评分、子网或连接采样分支。
// Trigger: 用户明确要求恢复 beta1/2 搜索内核，保留业务修复与任务接口。
// Evidence: src/tests/blueprint-planner/port-aware-route-repair.test.ts；原文件 SHA256 8db29b5a1aca3f1639ff74af27bfb44a03c485e93184ec162d20f9268f74053d。
// Replacement: beta1/2 内核的现有几何、Worker、任务与正式验产测试；search-policy.test.ts 验证新面积公式。
// Risk: 撤下的搜索分支不再参与运行，其专用覆盖同时退休；未修改现有业务正确性门槛。
// Human Review: Required
// Original code:
// // @vitest-environment node
// // 2026-10-21：端口占位推动和共同容量评分须共同解除仅主体推动无法跨过的状态。
// // 依据：.docs/common/eda/算法探索/算法探索20261021-通用布线进展与搜索预算.md，Windows probe219–228。
// import { expect, it } from "vitest";
// import { createRegistryContract } from "@/registry";
// import { repairPlannerRoutes } from "@/blueprint-planner/route-repair";
// import { restorePlannerSeed, type PlannerSearchSeed } from "@/blueprint-planner/search-seed";
// import { resolveSearchProfile } from "@/blueprint-planner/search-profile";
// import { PlannerRouter } from "@/blueprint-planner/router";
// import { CompactLayoutSearch } from "@/blueprint-planner/compact-layout";
// import type { PlannerSearchStatistics } from "@/blueprint-planner/search-types";
// import fixture from "./fixtures/forced-turn-port-push.json";
//
// it("有限预算内解除共同瓶颈，返回全部真实合法路径且不修改输入", async () => {
//   const registry = createRegistryContract(), seed = fixture.seed as unknown as PlannerSearchSeed;
//   const original = JSON.stringify(seed), request = JSON.parse(seed.requestKey);
//   const { network, wires } = restorePlannerSeed(registry, request, seed);
//   const profile = resolveSearchProfile(fixture.profile);
//   const statistics: PlannerSearchStatistics = { seed: fixture.randomSeed, evaluationLimit: fixture.hardLimit,
//     evaluations: 0, acceptedMoves: 0, routingAttempts: 0, initialWireLength: 0, finalWireLength: 0,
//     outline: { width: seed.width, height: seed.height }, strategy: "compact" };
//   const makeRouter = () => new PlannerRouter(registry, network.nodes.map(node => node.entity),
//     wires.flatMap(wire => [wire.source, wire.target]),
//     { minimumX: 0, minimumY: 0, maximumX: seed.width - 1, maximumY: seed.height - 1, escapeLength: 0 });
//   expect(makeRouter().staticConstraints(wires)).toEqual({ disconnectedWires: 0, capacityDeficit: 1 });
//   const routes = await repairPlannerRoutes(registry, network, wires, seed.routes, statistics, profile, fixture.window, () => {});
//   expect(routes).toHaveLength(wires.length);
//   expect(statistics.evaluations).toBeLessThanOrEqual(fixture.hardLimit);
//   expect(statistics.routeRepairImprovements).toBeGreaterThan(0);
//   const router = makeRouter();
//   for (const route of routes!) {
//     const wire = wires.find(wire => route.sourcePort === `${wire.source.entityId}/${wire.source.groupIndex}/${wire.source.portIndex}`
//       && route.targetPort === `${wire.target.entityId}/${wire.target.groupIndex}/${wire.target.portIndex}`)!;
//     expect(wire).toBeDefined();
//     if (route.cells.length) expect(router.reuse(wire.source, wire.target, route.cells, wire.minimumCells)).toBe(true);
//     else await router.connect(wire.source, wire.target, () => {}, wire.minimumCells);
//   }
//   expect(router.routes).toHaveLength(wires.length);
//   expect(router.staticConstraints(wires)).toEqual({ disconnectedWires: 0, capacityDeficit: 0 });
//   expect(await new CompactLayoutSearch(registry, network, wires, { ...statistics, evaluations: 0 }, profile)
//     .advance(0, () => {})).toBe(true);
//   expect(JSON.stringify(seed)).toBe(original);
// });
//
