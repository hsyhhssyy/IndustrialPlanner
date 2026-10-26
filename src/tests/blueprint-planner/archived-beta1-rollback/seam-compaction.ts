
// AI-REMOVED 2026-10-26:
// Reason: 测试仅覆盖 beta1/2 之后加入且本次撤下的局部修复、容量评分、子网或连接采样分支。
// Trigger: 用户明确要求恢复 beta1/2 搜索内核，保留业务修复与任务接口。
// Evidence: src/tests/blueprint-planner/seam-compaction.test.ts；原文件 SHA256 f0028a9b9d525d61e4d528a91a1f34b602a5813d532b81fbe12c82b49b2a492d。
// Replacement: beta1/2 内核的现有几何、Worker、任务与正式验产测试；search-policy.test.ts 验证新面积公式。
// Risk: 撤下的搜索分支不再参与运行，其专用覆盖同时退休；未修改现有业务正确性门槛。
// Human Review: Required
// Original code:
// // @vitest-environment node
// // 2026-10-21：完整成果沿折线空隙缩边，生成提案和后续修复共用预算，取消不得修改输入。
// // 依据：.docs/common/eda/算法探索/算法探索20261021-通用布线进展与搜索预算.md，Windows probe301 / probe306 / probe307。
// // 2026-10-21：probe331 / probe332 增补真实策略的多入口修复与入口份额硬顶；按用户要求等待 EDA 完成后执行。
// import { expect, it } from "vitest";
// import type { BlueprintPlannerRequest } from "@/domain/blueprint-planner";
// import { createRegistryContract } from "@/registry";
// import { createPlannerCandidate } from "@/blueprint-planner/candidate";
// import { compactAlongPlannerSeam } from "@/blueprint-planner/seam-compaction";
// import { restorePlannerSeed, type PlannerSearchSeed } from "@/blueprint-planner/search-seed";
// import { resolveSearchProfile } from "@/blueprint-planner/search-profile";
// import type { PlannerSearchStatistics } from "@/blueprint-planner/search-types";
// import type { PlannerAttemptStrategy } from "@/blueprint-planner/strategy-schedule";
// import { PlannerRouter } from "@/blueprint-planner/router";
// import { repairPlannerRoutes } from "@/blueprint-planner/route-repair";
// import fixture from "./fixtures/needle-seam-compaction.json";
//
// it("普通缩边入口在原单批额度内获得更小完整成果，所有线路可共同重放", async () => {
//   const registry = createRegistryContract(), seed = fixture.seed as unknown as PlannerSearchSeed;
//   // 2026-10-21：requestKey 是预算归零的语义指纹，不能作为可能重建生产网络的完整请求；参见 Windows probe311。
//   const original = JSON.stringify(seed), request = fixture.scheduled.request as unknown as BlueprintPlannerRequest;
//   const candidate = await createPlannerCandidate(registry, request, 0, () => {}, () => {}, {
//     seed, firstSolution: false, strategy: "compact", targetOutline: fixture.targetOutline,
//     maximumArea: fixture.maximumArea, maxEvaluations: fixture.limit, profile: fixture.profile,
//     attemptStrategy: fixture.strategy as PlannerAttemptStrategy,
//   });
//   expect(candidate.metrics.area).toBeLessThan(seed.width * seed.height);
//   expect(candidate.metrics.area).toBeLessThanOrEqual(fixture.maximumArea);
//   expect(candidate.search.evaluations).toBeLessThanOrEqual(fixture.limit);
//   expect(candidate.seed?.routes.length).toBe(candidate.seed?.wires.length);
//   const result = candidate.seed!, { network, wires } = restorePlannerSeed(registry, request, result);
//   const router = new PlannerRouter(registry, network.nodes.map(node => node.entity), wires.flatMap(wire => [wire.source, wire.target]),
//     { minimumX: 0, minimumY: 0, maximumX: result.width - 1, maximumY: result.height - 1, escapeLength: 0 });
//   for (const route of result.routes) {
//     const wire = wires.find(wire => `${wire.source.entityId}/${wire.source.groupIndex}/${wire.source.portIndex}` === route.sourcePort
//       && `${wire.target.entityId}/${wire.target.groupIndex}/${wire.target.portIndex}` === route.targetPort)!;
//     expect(wire).toBeDefined();
//     if (route.cells.length) expect(router.reuse(wire.source, wire.target, route.cells, wire.minimumCells)).toBe(true);
//     else await router.connect(wire.source, wire.target, () => {}, wire.minimumCells);
//   }
//   expect(router.routes).toHaveLength(wires.length);
//   expect(JSON.stringify(seed)).toBe(original);
// });
//
// it("切线探索服从累计剩余额度并在取消后保持原始种子", async () => {
//   const registry = createRegistryContract(), seed = fixture.seed as unknown as PlannerSearchSeed;
//   const original = JSON.stringify(seed), request = fixture.scheduled.request as unknown as BlueprintPlannerRequest,
//     profile = resolveSearchProfile(fixture.profile);
//   const statistics: PlannerSearchStatistics = { seed: fixture.strategy.layoutSeed, evaluationLimit: 100,
//     evaluations: 98, acceptedMoves: 0, routingAttempts: 0, initialWireLength: 0, finalWireLength: 0,
//     outline: fixture.targetOutline, strategy: "compact" };
//   await compactAlongPlannerSeam(registry, request, seed, fixture.targetOutline, profile, statistics, 1000, () => {});
//   expect(statistics.evaluations).toBe(100);
//   const cancellation = new Error("cancelled-seam"), next = { ...statistics, evaluations: 0 };
//   let checks = 0;
//   await expect(compactAlongPlannerSeam(registry, request, seed, fixture.targetOutline, profile, next, 1000, () => {
//     if (++checks === 3) throw cancellation;
//   })).rejects.toBe(cancellation);
//   expect(next.evaluations).toBeLessThanOrEqual(next.evaluationLimit);
//   expect(JSON.stringify(seed)).toBe(original);
// });
//
// it("真实尺寸调度的首个随机策略可利用多个缩边入口完成更小布局", async () => {
//   const registry = createRegistryContract(), seed = fixture.seed as unknown as PlannerSearchSeed;
//   const original = JSON.stringify(seed), scheduled = fixture.scheduled;
//   const request = scheduled.request as unknown as BlueprintPlannerRequest;
//   const candidate = await createPlannerCandidate(registry, request, 0, () => {}, () => {}, {
//     seed, firstSolution: false, strategy: "compact", targetOutline: fixture.targetOutline,
//     maximumArea: seed.width * seed.height, maxEvaluations: fixture.limit,
//     profile: scheduled.profile, attemptStrategy: scheduled.strategy as PlannerAttemptStrategy,
//   });
//   expect(candidate.metrics.area).toBeLessThan(seed.width * seed.height);
//   expect(candidate.seed?.routes.length).toBe(candidate.seed?.wires.length);
//   expect(candidate.search.evaluations).toBeGreaterThan(0);
//   expect(candidate.search.evaluations).toBeLessThanOrEqual(fixture.limit);
//   expect(JSON.stringify(seed)).toBe(original);
// });
//
// it("入口内真实进展续窗不能越过分配份额，也不能清零已消费计数", async () => {
//   const registry = createRegistryContract(), seed = fixture.repairPartial as unknown as PlannerSearchSeed;
//   const request = fixture.scheduled.request as unknown as BlueprintPlannerRequest;
//   const { network, wires } = restorePlannerSeed(registry, request, seed);
//   const statistics: PlannerSearchStatistics = { seed: fixture.scheduled.strategy.layoutSeed, evaluationLimit: 1000,
//     evaluations: 5, acceptedMoves: 0, routingAttempts: 0, initialWireLength: 0, finalWireLength: 0,
//     outline: fixture.targetOutline, strategy: "compact" };
//   await repairPlannerRoutes(registry, network, wires, seed.routes, statistics,
//     resolveSearchProfile(fixture.scheduled.profile), 100, () => {}, 12);
//   expect(statistics.evaluations).toBe(12);
//   expect(statistics.evaluationLimit).toBe(1000);
//   expect(statistics.routeRepairEvaluations).toBe(7);
// });
//
