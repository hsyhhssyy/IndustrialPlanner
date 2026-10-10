// @vitest-environment node
import { expect, it } from "vitest";
import type { BlueprintPlannerRequest } from "@/domain/blueprint-planner";
import { createRegistryContract } from "@/registry";
import { createPlannerCandidate } from "@/blueprint-planner/candidate";
import { PlannerCandidateError } from "@/blueprint-planner/model";
import { PlannerCpuLayout } from "@/blueprint-planner/cpu-layout";
import type { PlannerSearchStatistics } from "@/blueprint-planner/search-types";
import { NodePlannerClient } from "@/scripts/eda/node-planner-client";
import nugget from "./fixtures/pyrrolite-nugget.json";

it("普通产线真实 Worker 跨切片等价于连续搜索，改框失效且诊断开关不遗留旧报告", async () => {
  const client = new NodePlannerClient();
  const request = structuredClone(nugget.request) as BlueprintPlannerRequest;
  const records: PlannerSearchStatistics[] = [];
  try {
    for (const options of [
      { maxEvaluations: 1500, diagnostics: true },
      { maxEvaluations: 750, diagnostics: true, sessionKey: "production-continuation" },
      { maxEvaluations: 750, diagnostics: false, sessionKey: "production-continuation" },
      { maxEvaluations: 750, diagnostics: true, sessionKey: "production-continuation", outline: { width: 24, height: 30 } },
    ]) {
      await expect(client.build(request, 0, 30_000, {
        outline: { width: 25, height: 30 }, coolingEvaluations: 1500, ...options,
      })).rejects.toSatisfy((error: unknown) => {
        expect(error).toBeInstanceOf(PlannerCandidateError);
        records.push((error as PlannerCandidateError).search!);
        return true;
      });
    }
    const [whole, first, second, changed] = records;
    expect(client.threadId).toBeGreaterThan(0);
    expect(first!.searchResumed).not.toBe(true);
    expect(second!.searchResumed).toBe(true);
    expect(second!.diagnostics).toBeUndefined();
    expect(first!.evaluations + second!.evaluations).toBe(whole!.evaluations);
    expect(first!.acceptedMoves + second!.acceptedMoves).toBe(whole!.acceptedMoves);
    expect(second!.layoutSnapshot).toEqual(whole!.layoutSnapshot);
    expect(second!.layoutBestCost).toBe(whole!.layoutBestCost);
    expect(second!.layoutInitialCost).toBe(first!.layoutBestCost);
    expect(changed!.searchResumed).not.toBe(true);
    expect(changed!.outline).toEqual({ width: 24, height: 30 });
  } finally { await client.dispose(); }
}, 60_000);

it("普通产线使用默认执行器或注入数值后端时，可行性检查和布线反馈节奏相同", async () => {
  const registry = createRegistryContract();
  const records: PlannerSearchStatistics[] = [];
  for (const backend of [undefined, new PlannerCpuLayout()]) {
    try {
      const result = await createPlannerCandidate(registry, structuredClone(nugget.request) as BlueprintPlannerRequest,
        0, () => {}, () => {}, { maxEvaluations: 2500, outline: { width: 25, height: 30 }, diagnostics: true },
        undefined, undefined, backend);
      records.push(result.search);
    } catch (error) {
      if (!(error instanceof PlannerCandidateError) || !error.search) throw error;
      records.push(error.search);
    }
  }
  const trace = (search: PlannerSearchStatistics) => ({ evaluations: search.evaluations, accepted: search.acceptedMoves,
    routing: search.routingAttempts, checks: search.diagnostics!.layoutChecks, feasible: search.diagnostics!.feasibleLayouts,
    rejections: search.diagnostics!.rejectionCounts, layout: search.layoutSnapshot, cost: search.layoutBestCost });
  expect(trace(records[0]!)).toEqual(trace(records[1]!));
}, 60_000);
