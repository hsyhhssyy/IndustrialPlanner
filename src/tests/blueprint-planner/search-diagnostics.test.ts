// @vitest-environment node

import { expect, it } from "vitest";
import type { BlueprintPlannerRequest } from "@/domain/blueprint-planner";
import { PlannerCandidateError } from "@/blueprint-planner/model";
import type { PlannerSearchStatistics } from "@/blueprint-planner/search-types";
import { NodePlannerClient } from "@/scripts/eda/node-planner-client";
import { runPlannerBatch } from "@/scripts/eda/planner-runner";
import nugget from "./fixtures/pyrrolite-nugget.json";

it("真实 Worker 的诊断开关不改变提案轨迹；违例分项精确还原当前评分", async () => {
  const client = new NodePlannerClient();
  const records: PlannerSearchStatistics[] = [];
  const outcomes: string[] = [];
  try {
    for (const diagnostics of [false, true]) {
      try {
        const candidate = await client.build(structuredClone(nugget.request) as BlueprintPlannerRequest, 0, 30_000,
          { maxEvaluations: 750, outline: { width: 25, height: 30 }, diagnostics });
        records.push(candidate.search);
        outcomes.push("success");
      } catch (error) {
        expect(error).toBeInstanceOf(PlannerCandidateError);
        records.push((error as PlannerCandidateError).search!);
        outcomes.push("candidate-error");
      }
    }
    expect(outcomes[1]).toBe(outcomes[0]);
    const plain = records[0]!, observed = records[1]!;
    expect(plain.diagnostics).toBeUndefined();
    expect(plain.summary).toBeDefined();
    expect({ ...observed, diagnostics: undefined }).toEqual({ ...plain, diagnostics: undefined });
    const layout = observed.diagnostics!.lastLayout!;
    const boundaryKinds = ["body-boundary", "port-boundary"];
    const sum = (accept: (kind: string) => boolean) => layout.issues.filter(issue => accept(issue.kind)).reduce((total, issue) => total + issue.amount, 0);
    expect(sum(kind => !boundaryKinds.includes(kind) && kind !== "disconnected")).toBe(layout.conflicts.geometry);
    expect(sum(kind => boundaryKinds.includes(kind))).toBe(layout.conflicts.boundary);
    expect(sum(kind => kind === "disconnected")).toBe(layout.conflicts.connections);
    expect(layout.issues.length === 0).toBe(
      layout.conflicts.geometry + layout.conflicts.boundary + layout.conflicts.connections === 0
    );
    expect(layout.issues.every(issue => issue.entityIds.length > 0 && issue.amount > 0)).toBe(true);
    expect(observed.evaluations).toBeLessThanOrEqual(750);
    expect(layout.evaluation).toBeLessThanOrEqual(observed.evaluations);
    expect(observed.diagnostics!.layoutChecks).toBeGreaterThan(0);
    expect(plain.summary!.layoutChecks).toBe(observed.diagnostics!.layoutChecks);
    for (const issue of layout.issues) expect(plain.summary!.layoutIssues).toHaveProperty(issue.kind);

  } finally { await client.dispose(); }
}, 60_000);

it("成功候选的阶段与拒绝次数可对账，并保存真实 Dense 2 TPS 验证蓝图", async () => {
  const report = await runPlannerBatch(structuredClone(nugget.request) as BlueprintPlannerRequest,
    { attempts: 1, localEvaluations: 50_000, width: 30, height: 40, startVariant: 0,
      candidateSeconds: 120, verificationSeconds: 180, engineKind: "dense-v2", diagnostics: true });
  const record = report.records[0]!;
  expect(record.outcome).toBe("success");
  expect(record.artifactPath).toBeTruthy();
  expect(record.measuredOutputs![0]!.perMinute).toBeGreaterThanOrEqual(30);
  const search = record.search!, diagnostic = search.diagnostics!;
  // 2026-10-23：辅助重布独立归类，仍计入总次数；外层拒绝记录只与其余候选尝试对账。
  // AI-CORRECTION 2026-10-26：恢复 beta1 的总布线计数，不再读取已撤下的辅助分项；保持精确对账。
  expect(search.routingAttempts).toBe(diagnostic.rejectionCounts.routing + diagnostic.fullyRoutedAttempts);
  expect(diagnostic.fullyRoutedAttempts).toBe(diagnostic.rejectionCounts.power + diagnostic.rejectionCounts.supply + diagnostic.rejectionCounts.circulation + 1);
  expect(diagnostic.lastLayout!.issues).toEqual([]);
  expect(diagnostic.lastLayout!.feasible).toBe(true);
  expect(diagnostic.feasibleLayouts).toBeGreaterThan(0);
  expect(Object.values(diagnostic.timingsMs).every(value => Number.isFinite(value) && value >= 0)).toBe(true);
  expect(Object.values(diagnostic.timingsMs).reduce((sum, value) => sum + value, 0)).toBeLessThanOrEqual(record.generationMs);
}, 330_000);

// AI-REMOVED 2026-10-26:
// Reason: 诊断计数字段恢复 beta1/2；诊断不干扰提案、拒绝计数和 Dense 成功验收断言保持。
// Trigger: 用户确认恢复 beta1/2 搜索内核并保留业务修复、任务接口。
// Evidence: src/tests/blueprint-planner/search-diagnostics.test.ts；原文件 SHA256 27143fc70272cd6fbe394a55ca2ba19bf10c6df6db23c854b17981d1e4b7815b。
// Replacement: 当前文件活动代码，或 beta1/2 对应执行路径。
// Risk: 仅撤下已移除的算法分支参数/覆盖；公开预算、产率和任务一致性断言保持。
// Human Review: Required
// Original code:
// // @vitest-environment node
//
// import { expect, it } from "vitest";
// import type { BlueprintPlannerRequest } from "@/domain/blueprint-planner";
// import { PlannerCandidateError } from "@/blueprint-planner/model";
// import type { PlannerSearchStatistics } from "@/blueprint-planner/search-types";
// import { NodePlannerClient } from "@/scripts/eda/node-planner-client";
// import { runPlannerBatch } from "@/scripts/eda/planner-runner";
// import nugget from "./fixtures/pyrrolite-nugget.json";
//
// it("真实 Worker 的诊断开关不改变提案轨迹；违例分项精确还原当前评分", async () => {
//   const client = new NodePlannerClient();
//   const records: PlannerSearchStatistics[] = [];
//   const outcomes: string[] = [];
//   try {
//     for (const diagnostics of [false, true]) {
//       try {
//         const candidate = await client.build(structuredClone(nugget.request) as BlueprintPlannerRequest, 0, 30_000,
//           { maxEvaluations: 750, outline: { width: 25, height: 30 }, diagnostics });
//         records.push(candidate.search);
//         outcomes.push("success");
//       } catch (error) {
//         expect(error).toBeInstanceOf(PlannerCandidateError);
//         records.push((error as PlannerCandidateError).search!);
//         outcomes.push("candidate-error");
//       }
//     }
//     expect(outcomes[1]).toBe(outcomes[0]);
//     const plain = records[0]!, observed = records[1]!;
//     expect(plain.diagnostics).toBeUndefined();
//     expect(plain.summary).toBeDefined();
//     expect({ ...observed, diagnostics: undefined }).toEqual({ ...plain, diagnostics: undefined });
//     const layout = observed.diagnostics!.lastLayout!;
//     const boundaryKinds = ["body-boundary", "port-boundary"];
//     const sum = (accept: (kind: string) => boolean) => layout.issues.filter(issue => accept(issue.kind)).reduce((total, issue) => total + issue.amount, 0);
//     expect(sum(kind => !boundaryKinds.includes(kind) && kind !== "disconnected")).toBe(layout.conflicts.geometry);
//     expect(sum(kind => boundaryKinds.includes(kind))).toBe(layout.conflicts.boundary);
//     expect(sum(kind => kind === "disconnected")).toBe(layout.conflicts.connections);
//     expect(layout.issues.length === 0).toBe(
//       layout.conflicts.geometry + layout.conflicts.boundary + layout.conflicts.connections === 0
//     );
//     expect(layout.issues.every(issue => issue.entityIds.length > 0 && issue.amount > 0)).toBe(true);
//     expect(observed.evaluations).toBeLessThanOrEqual(750);
//     expect(layout.evaluation).toBeLessThanOrEqual(observed.evaluations);
//     expect(observed.diagnostics!.layoutChecks).toBeGreaterThan(0);
//     expect(plain.summary!.layoutChecks).toBe(observed.diagnostics!.layoutChecks);
//     for (const issue of layout.issues) expect(plain.summary!.layoutIssues).toHaveProperty(issue.kind);
//
//   } finally { await client.dispose(); }
// }, 60_000);
//
// it("成功候选的阶段与拒绝次数可对账，并保存真实 Dense 2 TPS 验证蓝图", async () => {
//   const report = await runPlannerBatch(structuredClone(nugget.request) as BlueprintPlannerRequest,
//     { attempts: 1, localEvaluations: 50_000, width: 30, height: 40, startVariant: 0,
//       candidateSeconds: 120, verificationSeconds: 180, engineKind: "dense-v2", diagnostics: true });
//   const record = report.records[0]!;
//   expect(record.outcome).toBe("success");
//   expect(record.artifactPath).toBeTruthy();
//   expect(record.measuredOutputs![0]!.perMinute).toBeGreaterThanOrEqual(30);
//   const search = record.search!, diagnostic = search.diagnostics!;
//   // 2026-10-23：辅助重布独立归类，仍计入总次数；外层拒绝记录只与其余候选尝试对账。
//   expect(search.routingAttempts).toBe((search.auxiliaryRoutingAttempts ?? 0)
//     + diagnostic.rejectionCounts.routing + diagnostic.fullyRoutedAttempts);
//   expect(diagnostic.fullyRoutedAttempts).toBe(diagnostic.rejectionCounts.power + diagnostic.rejectionCounts.supply + diagnostic.rejectionCounts.circulation + 1);
//   expect(diagnostic.lastLayout!.issues).toEqual([]);
//   expect(diagnostic.lastLayout!.feasible).toBe(true);
//   expect(diagnostic.feasibleLayouts).toBeGreaterThan(0);
//   expect(Object.values(diagnostic.timingsMs).every(value => Number.isFinite(value) && value >= 0)).toBe(true);
//   expect(Object.values(diagnostic.timingsMs).reduce((sum, value) => sum + value, 0)).toBeLessThanOrEqual(record.generationMs);
// }, 330_000);
//
