
// AI-REMOVED 2026-10-26:
// Reason: 测试仅覆盖 beta1/2 之后加入且本次撤下的局部修复、容量评分、子网或连接采样分支。
// Trigger: 用户明确要求恢复 beta1/2 搜索内核，保留业务修复与任务接口。
// Evidence: src/tests/blueprint-planner/route-repair.test.ts；原文件 SHA256 982e5e3e4d560eebcb013367c7c2385551aec24e091520f9e67ead787df5f7f8。
// Replacement: beta1/2 内核的现有几何、Worker、任务与正式验产测试；search-policy.test.ts 验证新面积公式。
// Risk: 撤下的搜索分支不再参与运行，其专用覆盖同时退休；未修改现有业务正确性门槛。
// Human Review: Required
// Original code:
// // @vitest-environment node
// import { expect, it, vi } from "vitest";
// import { createRegistryContract } from "@/registry";
// import { repairPlannerRoutes } from "@/blueprint-planner/route-repair";
// import { PlannerRouter } from "@/blueprint-planner/router";
// import { capturePlannerSeed, restorePlannerSeed, type PlannerSearchSeed } from "@/blueprint-planner/search-seed";
// import { resolveSearchProfile } from "@/blueprint-planner/search-profile";
// import type { PlannerSearchStatistics } from "@/blueprint-planner/search-types";
// import reference from "./fixtures/compact-layout-memory-reference.json";
//
// function scenario(limit: number) {
//   const registry = createRegistryContract(), seed = structuredClone(reference.seed) as unknown as PlannerSearchSeed;
//   const request = JSON.parse(seed.requestKey);
//   const { network, wires } = restorePlannerSeed(registry, request, seed);
//   const statistics: PlannerSearchStatistics = { seed: 12345, evaluationLimit: limit, evaluations: 0, acceptedMoves: 0,
//     routingAttempts: 0, initialWireLength: 0, finalWireLength: 0, outline: { width: seed.width, height: seed.height }, strategy: "compact" };
//   return { registry, seed, request, network, wires, statistics };
// }
//
// it("部分布线修复允许外部仓库链接，实际补齐线路且不改写输入种子", async () => {
//   const { registry, seed, network, wires, statistics } = scenario(64), before = JSON.stringify(seed);
//   expect(network.slotLinks.length).toBeGreaterThan(0);
//   const routes = await repairPlannerRoutes(registry, network, wires, seed.routes.slice(0, -1), statistics, resolveSearchProfile(), 64, () => {});
//   expect(routes).toHaveLength(wires.length);
//   expect(new Set(routes!.map(route => `${route.sourcePort}>${route.targetPort}`)).size).toBe(wires.length);
//   expect(statistics.evaluations).toBeGreaterThan(0);
//   expect(statistics.evaluations).toBeLessThanOrEqual(64);
//   expect(statistics.routeRepairImprovements).toBeGreaterThan(0);
//   expect(JSON.stringify(seed)).toBe(before);
// });
//
// it("局部修复按总预算截断，取消时恢复完整网表快照", async () => {
//   const first = scenario(1);
//   await repairPlannerRoutes(first.registry, first.network, first.wires, first.seed.routes.slice(0, -1), first.statistics, resolveSearchProfile(), 100, () => {});
//   expect(first.statistics.evaluations).toBe(1);
//   const second = scenario(64);
//   const snapshot = () => capturePlannerSeed(second.request, second.network, second.wires, second.seed.routes, second.seed.width, second.seed.height);
//   const before = snapshot();
//   let checks = 0;
//   await expect(repairPlannerRoutes(second.registry, second.network, second.wires, second.seed.routes.slice(0, -1), second.statistics,
//     resolveSearchProfile(), 64, () => { if (++checks === 3) throw new DOMException("测试取消", "AbortError"); })).rejects.toMatchObject({ name: "AbortError" });
//   expect(snapshot()).toEqual(before);
// });
//
// it.each([new DOMException("测试取消", "AbortError"), new Error("测试执行故障")])("局部修复恢复快照并保留原始异常：%s", async failure => {
//   const { registry, seed, request, network, wires, statistics } = scenario(64);
//   const snapshot = () => capturePlannerSeed(request, network, wires, seed.routes, seed.width, seed.height);
//   const before = snapshot(), original = PlannerRouter.prototype.staticConstraints;
//   let interrupted = false;
//   const constraints = vi.spyOn(PlannerRouter.prototype, "staticConstraints").mockImplementation(function (this: PlannerRouter, wires) {
//     if (interrupted) throw new Error("异常路径不应再次复核返回成果");
//     return original.call(this, wires);
//   });
//   try {
//     await expect(repairPlannerRoutes(registry, network, wires, seed.routes.slice(0, -1), statistics, resolveSearchProfile(), 64, () => {
//       if (statistics.bestRoutedWireCount === undefined) return;
//       interrupted = true;
//       const entity = network.nodes[0]!.entity;
//       entity.position = { ...entity.position, x: entity.position.x + 1 };
//       wires.pop();
//       throw failure;
//     })).rejects.toBe(failure);
//     expect(interrupted).toBe(true);
//     expect(snapshot()).toEqual(before);
//   } finally { constraints.mockRestore(); }
// });
//
// it("局部修复正常返回前仍拒绝完整约束事实不一致", async () => {
//   const { registry, seed, network, wires, statistics } = scenario(0);
//   const original = PlannerRouter.prototype.staticConstraints;
//   let checks = 0;
//   const constraints = vi.spyOn(PlannerRouter.prototype, "staticConstraints").mockImplementation(function (this: PlannerRouter, wires) {
//     const result = original.call(this, wires);
//     return ++checks === 1 ? result : { ...result, capacityDeficit: result.capacityDeficit + 1 };
//   });
//   try {
//     await expect(repairPlannerRoutes(registry, network, wires, seed.routes.slice(0, -1), statistics, resolveSearchProfile(), 0, () => {}))
//       .rejects.toThrow("局部修复返回与已保留的完整约束事实不一致。");
//     expect(checks).toBe(2);
//   } finally { constraints.mockRestore(); }
// });
//
// // 2026-10-21：真实几何始终拒绝的方向应因停滞提前返回，不能耗尽整批预算阻止其他尺寸获得机会。
// // AI-CORRECTION 2026-10-23：入口几何已统一检查；非法旧框立即返回undefined，零提案且恢复原网表，不发布旧框缓存。
// it("无法容纳设备的边界在无连通改善后让出剩余预算", async () => {
//   const { registry, seed, network, wires, statistics } = scenario(20_000);
//   const bounded = { ...statistics, outline: { width: 1, height: 1 } };
//   const initial = seed.routes.slice(0, -1);
//   const before = capturePlannerSeed(JSON.parse(seed.requestKey), network, wires, initial, seed.width, seed.height);
//   const routes = await repairPlannerRoutes(registry, network, wires, initial, bounded, resolveSearchProfile(), 20_000, () => {});
//   expect(routes).toBeUndefined();
//   expect(bounded.evaluations).toBe(0);
//   expect(bounded.evaluations).toBeLessThan(20_000);
//   expect(bounded.routeRepairImprovements ?? 0).toBe(0);
//   expect(capturePlannerSeed(JSON.parse(seed.requestKey), network, wires, initial, seed.width, seed.height)).toEqual(before);
// });
//
