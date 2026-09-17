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
  try {
    for (const diagnostics of [false, true]) {
      try {
        await client.build(structuredClone(nugget.request) as BlueprintPlannerRequest, 0, 30_000,
          { maxEvaluations: 750, outline: { width: 25, height: 30 }, diagnostics });
        throw new Error("紧凑短预算样例应返回失败诊断");
      } catch (error) {
        expect(error).toBeInstanceOf(PlannerCandidateError);
        records.push((error as PlannerCandidateError).search!);
      }
    }
    const plain = records[0]!, observed = records[1]!;
    expect(plain.diagnostics).toBeUndefined();
    expect({ ...observed, diagnostics: undefined }).toEqual({ ...plain, diagnostics: undefined });
    const layout = observed.diagnostics!.lastLayout!;
    const boundaryKinds = ["body-boundary", "port-boundary"];
    const sum = (accept: (kind: string) => boolean) => layout.issues.filter(issue => accept(issue.kind)).reduce((total, issue) => total + issue.amount, 0);
    expect(sum(kind => !boundaryKinds.includes(kind) && kind !== "disconnected")).toBe(layout.conflicts.geometry);
    expect(sum(kind => boundaryKinds.includes(kind))).toBe(layout.conflicts.boundary);
    expect(sum(kind => kind === "disconnected")).toBe(layout.conflicts.connections);
    expect(layout.issues.length).toBeGreaterThan(0);
    expect(layout.issues.every(issue => issue.entityIds.length > 0 && issue.amount > 0)).toBe(true);
    expect(layout.evaluation).toBe(750);
    expect(observed.diagnostics!.layoutChecks).toBe(1);
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
  expect(search.routingAttempts).toBe(diagnostic.rejectionCounts.routing + diagnostic.fullyRoutedAttempts);
  expect(diagnostic.fullyRoutedAttempts).toBe(diagnostic.rejectionCounts.power + diagnostic.rejectionCounts.supply + diagnostic.rejectionCounts.circulation + 1);
  expect(diagnostic.lastLayout!.issues).toEqual([]);
  expect(diagnostic.lastLayout!.feasible).toBe(true);
  expect(diagnostic.feasibleLayouts).toBeGreaterThan(0);
  expect(Object.values(diagnostic.timingsMs).every(value => Number.isFinite(value) && value >= 0)).toBe(true);
  expect(Object.values(diagnostic.timingsMs).reduce((sum, value) => sum + value, 0)).toBeLessThanOrEqual(record.generationMs);
}, 330_000);
