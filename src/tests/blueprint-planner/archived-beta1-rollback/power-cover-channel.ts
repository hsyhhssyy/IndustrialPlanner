// AI-REMOVED 2026-10-26:
// Reason: 用户要求回退 beta1/2；本用例专测其后加入的供电回溯与联合路由修复分支。
// Trigger: 已撤下新搜索分支，原 firstSolution、powerReroutes 和 powerSearchEvaluations 语义不再存在。
// Evidence: 原文件 SHA256 3f03563262e9b6dd85f1ba89d8c6a820136cac4a73415668daaa32338a3316b6；blueprint-planner/candidate.ts 活动代码来自 beta1/2。
// Replacement: power-verification.test.ts 及本轮四物品 Dense 2 TPS 正式验产。
// Risk: 此特定搜索能力随回退撤下；不降低正式产率、供电及运行验收门槛。
// Human Review: Required
// Original code:
// // @vitest-environment node
// // 2026-10-21：完整线路的供电覆盖须保留物流通道；联合修复成果须完整进入 Dense。
// // 依据：.docs/common/eda/算法探索/算法探索20261021-通用布线进展与搜索预算.md，Windows probe242、250、255。
// import { expect, it } from "vitest";
// import type { BlueprintPlannerRequest } from "@/domain/blueprint-planner";
// import { createRegistryContract } from "@/registry";
// import { createPlannerCandidate } from "@/blueprint-planner/candidate";
// import { plannerAttemptStrategy } from "@/blueprint-planner/strategy-schedule";
// import type { PlannerSearchSeed } from "@/blueprint-planner/search-seed";
// import { meetsOperatingLimits, meetsProductionTargets } from "@/blueprint-planner/verification";
// import { BlueprintExecutionClient } from "@/simulation/blueprint";
// import { createDenseBlueprintEngine } from "@/simulation/dense/blueprint-engine";
// import { saveSuccessfulPlanning } from "@/scripts/eda/artifacts";
// import fixture from "./fixtures/power-cover-channel-seed.json";
//
// it("从完整但未供电快照在原面积内补全覆盖，并通过 Dense 2 TPS 产率与运行约束", async () => {
//   const registry = createRegistryContract(), seed = fixture.seed as unknown as PlannerSearchSeed;
//   const request = JSON.parse(seed.requestKey) as BlueprintPlannerRequest, original = JSON.stringify(seed);
//   const area = seed.width * seed.height;
//   const candidate = await createPlannerCandidate(registry, request, 0, () => {}, () => {}, {
//     seed, firstSolution: true, strategy: "compact", targetOutline: { width: seed.width, height: seed.height },
//     maximumArea: area, maxEvaluations: 4000, profile: fixture.profile,
//     attemptStrategy: { ...plannerAttemptStrategy(0), restart: false },
//   });
//   expect(JSON.stringify(seed)).toBe(original);
//   expect(candidate.search.evaluations).toBeLessThanOrEqual(4000);
//   expect(candidate.search.powerReroutes).toBeGreaterThan(0);
//   expect(candidate.search.powerSearchEvaluations).toBeGreaterThan(0);
//   expect(candidate.metrics.area).toBe(area);
//   const executor = new BlueprintExecutionClient(registry, "dense-v2", "runtime", options => createDenseBlueprintEngine(registry, options), 2);
//   try {
//     const report = await executor.run({ ...candidate.execution, warmupSeconds: 1800, observationSeconds: 1800,
//       inventorySampleCount: 12, maxWallTimeMs: 120_000 });
//     expect(meetsProductionTargets(request, report)).toBe(true);
//     expect(meetsOperatingLimits(candidate.supplyAudit, report)).toBe(true);
//     await saveSuccessfulPlanning(registry, "供电覆盖通道与联合重放回归", candidate.execution.blueprint, request,
//       { metrics: candidate.metrics, search: candidate.search, report, warmStart: true });
//   } finally { executor.dispose(); }
// }, 60_000);
//
