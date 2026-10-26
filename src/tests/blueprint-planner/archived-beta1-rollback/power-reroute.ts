
// AI-REMOVED 2026-10-26:
// Reason: 本用例专测 beta1/2 后加入的供电桩位与线路联合修复；该搜索分支随本次回退撤下。
// Trigger: 用户确认恢复 beta1/2 搜索内核并保留业务修复、任务接口。
// Evidence: src/tests/blueprint-planner/power-reroute.test.ts；原文件 SHA256 2f9e05bdd062c408e47fa6ca72f3ef3f60610d68bac5989d8c52a88c8781f261。
// Replacement: 当前文件活动代码，或 beta1/2 对应执行路径。
// Risk: 仅撤下已移除的算法分支参数/覆盖；公开预算、产率和任务一致性断言保持。
// Human Review: Required
// Original code:
// // @vitest-environment node
// import { expect, it } from "vitest";
// import type { BlueprintPlannerRequest } from "@/domain/blueprint-planner";
// import { createRegistryContract } from "@/registry";
// import { createPlannerCandidate } from "@/blueprint-planner/candidate";
// import type { PlannerSearchSeed } from "@/blueprint-planner/search-seed";
// import { meetsOperatingLimits, meetsProductionTargets } from "@/blueprint-planner/verification";
// import { BlueprintExecutionClient } from "@/simulation/blueprint";
// import { createDenseBlueprintEngine } from "@/simulation/dense/blueprint-engine";
// import { saveSuccessfulPlanning } from "@/scripts/eda/artifacts";
// import fixture from "./fixtures/power-reroute-seed.json";
//
// // 2026-10-20：供电与线路协调不能限定首解阶段；固定其他搜索条件验证两个阶段使用同一恢复能力。
// // 2026-10-23：端口提案隔离到已有matchingSeed，原摆位种子、25×20、60k及全部供电/Dense断言保持。
// it.each([true, false])("布通但供电失败后保留桩位重布，固定 25×20 内通过 Dense 2 TPS 验产（首解=%s）", async firstSolution => {
//   const registry = createRegistryContract(), seed = fixture.seed as unknown as PlannerSearchSeed;
//   const request = JSON.parse(seed.requestKey) as BlueprintPlannerRequest;
//   const candidate = await createPlannerCandidate(registry, request, 0, () => {}, () => {}, {
//     seed, targetOutline: { width: 25, height: 20 }, maximumArea: 500, maxEvaluations: 60_000, coolingEvaluations: 300_000,
//     firstSolution, attemptStrategy: { ...fixture.strategy, conduitTopology: "trunk", restart: false, reduce: false },
//     experiments: ["constraint-repair", "power-dedup", "constrained-routing"],
//     profile: fixture.profile, diagnostics: true,
//   });
//   expect(candidate.search.evaluations).toBeLessThanOrEqual(60_000);
//   expect(candidate.search.powerReroutes).toBeGreaterThan(0);
//   expect(candidate.search.summary?.rejections.power).toBeGreaterThan(0);
//   expect(candidate.metrics.area).toBe(500);
//   const executor = new BlueprintExecutionClient(registry, "dense-v2", "runtime", options => createDenseBlueprintEngine(registry, options), 2);
//   try {
//     const report = await executor.run(candidate.execution);
//     expect(meetsProductionTargets(request, report)).toBe(true);
//     expect(meetsOperatingLimits(candidate.supplyAudit, report)).toBe(true);
//     await saveSuccessfulPlanning(registry, "供电桩位重布回归", candidate.execution.blueprint, request,
//       { metrics: candidate.metrics, search: candidate.search, report, warmStart: true });
//   } finally { executor.dispose(); }
// }, 60_000);
//
