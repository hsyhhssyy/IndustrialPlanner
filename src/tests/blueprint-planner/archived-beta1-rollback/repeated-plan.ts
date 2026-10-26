
// AI-REMOVED 2026-10-26:
// Reason: 测试仅覆盖 beta1/2 之后加入且本次撤下的局部修复、容量评分、子网或连接采样分支。
// Trigger: 用户明确要求恢复 beta1/2 搜索内核，保留业务修复与任务接口。
// Evidence: src/tests/blueprint-planner/repeated-plan.test.ts；原文件 SHA256 e0437c3619ec2addba80cbdeb0822f8bbb2e07e57c1524ed9920ff911d782bc4。
// Replacement: beta1/2 内核的现有几何、Worker、任务与正式验产测试；search-policy.test.ts 验证新面积公式。
// Risk: 撤下的搜索分支不再参与运行，其专用覆盖同时退休；未修改现有业务正确性门槛。
// Human Review: Required
// Original code:
// // @vitest-environment node
// import { describe, expect, it } from "vitest";
// import type { BlueprintPlannerRequest } from "@/domain/blueprint-planner";
// import { createRegistryContract } from "@/registry";
// import type { PlannerCandidate } from "@/blueprint-planner/candidate";
// import { repeatedPlannerRequest, combineRepeatedPlannerCandidate, extractRepeatedPlannerSeed } from "@/blueprint-planner/repeated-plan";
// import { restorePlannerSeed, plannerRequestKey } from "@/blueprint-planner/search-seed";
// import { meetsOperatingLimits, meetsProductionTargets } from "@/blueprint-planner/verification";
// import { BlueprintExecutionClient } from "@/simulation/blueprint";
// import { createDenseBlueprintEngine } from "@/simulation/dense/blueprint-engine";
// import { saveSuccessfulPlanning } from "@/scripts/eda/artifacts";
// import fixture from "./fixtures/repeated-unit.json";
// import { partitionPlannerDimensions, assertPlannerDimensionSchedule } from "@/blueprint-planner/dimension-schedule";
// import { plannerAttemptBudget } from "@/blueprint-planner/search-policy";
//
// const request = fixture.request as BlueprintPlannerRequest;
//
// describe("整数比例子网搜索与整图组合", () => {
//   it("尺寸权重按子网形状计算，完整搜索预算不变，检查点重放保留唯一尺寸归属", () => {
//     const dimensions = partitionPlannerDimensions(1530, { width: 6, height: 6 }, undefined, true, 0, 3);
//     const all = dimensions.flat();
//     expect(all.find(shape => shape.width === 30 && shape.height === 51)!.weight).toBe(1);
//     expect(all.find(shape => shape.width === 39 && shape.height === 39)!.weight).toBeLessThan(1);
//     expect(new Set(all.map(shape => `${shape.width}/${shape.height}`)).size).toBe(all.length);
//     expect(all.every(shape => shape.area <= 1530)).toBe(true);
//     expect(plannerAttemptBudget(765)).toBe(100_000);
//     expect(plannerAttemptBudget(765, 3)).toBe(300_000);
//     expect(() => assertPlannerDimensionSchedule({ generation: 0, targetArea: 1530, minimum: { width: 6, height: 6 },
//       deviceArea: 765, repeatedUnits: 3, inclusive: true, attemptsPerTask: 300_000 },
//     dimensions.map(list => ({ dimensions: list, dimensionCursor: 0 })))).not.toThrow();
//   });
//
//   it("按所有配方设备数的公约数缩放，份数互质或含模块时保留完整任务", () => {
//     const plan = repeatedPlannerRequest(request, { width: 30, height: 51 })!;
//     expect(plan.count).toBe(3);
//     expect([plan.columns, plan.rows, plan.width, plan.height]).toEqual([1, 3, 30, 17]);
//     expect(plan.request.plan.targets).toEqual([{ itemId: "item_xiranite_powder", perMinute: 120 }]);
//     expect(plan.request.plan.recipes.map(recipe => recipe.deviceCount)).toEqual([2, 2, 2, 3, 4]);
//     expect(plan.request.plan.supplyPolicies).toEqual(request.plan.supplyPolicies);
//     expect(request.plan.targets[0]!.perMinute).toBe(360);
//     expect(repeatedPlannerRequest({ ...request, plan: { ...request.plan, containsModules: true } }, { width: 30, height: 51 })).toBeNull();
//     expect(repeatedPlannerRequest({ ...request, plan: { ...request.plan, recipes: request.plan.recipes.map((recipe, index) =>
//       index ? recipe : { ...recipe, deviceCount: 5 }) } }, { width: 30, height: 51 })).toBeNull();
//   });
//
//   it("三份实体、真实库存、流量限制与续搜种子完整映射，Dense 2 TPS 整图持续达到 360/min", async () => {
//     const registry = createRegistryContract(), unit = fixture.unit as unknown as PlannerCandidate;
//     const snapshot = JSON.stringify(unit), plan = repeatedPlannerRequest(request, { width: 30, height: 51 })!;
//     const candidate = combineRepeatedPlannerCandidate(registry, request, unit, plan);
//     expect(JSON.stringify(unit)).toBe(snapshot);
//     expect(candidate.metrics.area).toBe(1530);
//     expect(candidate.metrics.score).toBeGreaterThan(1530);
//     expect(candidate.metrics.score).toBeLessThan(1531);
//     expect(candidate.search.evaluations).toBe(unit.search.evaluations);
//     expect(candidate.search.repeatedUnits).toBe(3);
//     expect(candidate.seed!.requestKey).toBe(plannerRequestKey(request));
//     const restored = restorePlannerSeed(registry, request, candidate.seed!);
//     expect(restored.network.request.plan.externalSupplies).toContainEqual({ itemId: "item_liquid_water", perMinute: 540 });
//     const ids = new Set(restored.network.nodes.map(node => node.entity.id));
//     expect(ids.size).toBe(restored.network.nodes.length);
//     expect(restored.wires).toHaveLength(unit.seed!.wires.length * 3);
//     expect(restored.wires.every(wire => ids.has(wire.source.entityId) && ids.has(wire.target.entityId))).toBe(true);
//     expect(candidate.supplyAudit.operatingLimits).toHaveLength(3);
//     expect(candidate.execution.probes.find(probe => probe.id === "item_xiranite_powder")!.entityIds).toHaveLength(12);
//     const executor = new BlueprintExecutionClient(registry, "dense-v2", "runtime", options => createDenseBlueprintEngine(registry, options), 2);
//     try {
//       const report = await executor.run(candidate.execution);
//       expect(meetsProductionTargets(request, report)).toBe(true);
//       expect(meetsOperatingLimits(candidate.supplyAudit, report)).toBe(true);
//       expect(report.probes.find(probe => probe.id === "item_xiranite_powder")!.perMinute).toBe(360);
//       await saveSuccessfulPlanning(registry, "整数子网组合回归", candidate.execution.blueprint, request,
//         { metrics: candidate.metrics, search: candidate.search, supplyAudit: candidate.supplyAudit, report });
//     } finally { executor.dispose(); }
//   });
//
//   // 2026-10-18：续搜从已验收组合图提取原生指导单元，跨单元连接不能被静默截断。
//   it("提取完整子网保留实体、布线及库存映射，跨单元引用和不同请求拒绝拆分", () => {
//     const registry = createRegistryContract(), unit = fixture.unit as unknown as PlannerCandidate;
//     const plan = repeatedPlannerRequest(request, { width: 30, height: 51 })!;
//     const full = combineRepeatedPlannerCandidate(registry, request, unit, plan).seed!;
//     const snapshot = JSON.stringify(full), extracted = extractRepeatedPlannerSeed(registry, request, full)!;
//     expect(extracted).toBeDefined();
//     expect(restorePlannerSeed(registry, plan.request, extracted)).toEqual(restorePlannerSeed(registry, plan.request, unit.seed!));
//     expect(extracted.routes).toEqual(unit.seed!.routes);
//     expect([extracted.width, extracted.height]).toEqual([30, 17]);
//     expect(JSON.stringify(full)).toBe(snapshot);
//     expect(extractRepeatedPlannerSeed(registry, { ...request, plan: { ...request.plan, name: "different" } }, full)).toBeUndefined();
//     const crossed = { ...full, wires: full.wires.map((wire, index) => index ? wire : { ...wire,
//       target: { ...wire.target, entityId: wire.target.entityId.replace("eda-unit-0:", "eda-unit-1:") } }) };
//     expect(extractRepeatedPlannerSeed(registry, request, crossed)).toBeUndefined();
//   });
// });
//
