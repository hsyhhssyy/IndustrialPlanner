// @vitest-environment node

import { readFileSync } from "node:fs";
import { expect, it } from "vitest";
import { PlannerSearchPortfolio, resolvePlannerAttempt } from "@/blueprint-planner/search-portfolio";
import { plannerAttemptStrategy } from "@/blueprint-planner/strategy-schedule";
import type { PlannerSearchSeed } from "@/blueprint-planner/search-seed";
import { PlannerBatchSession, runPlannerBatch } from "@/scripts/eda/planner-runner";
import { readPlanningInput } from "@/scripts/eda/planning-input";
import nativeCopper from "./fixtures/native-copper.json";

it("自动输出按完整有效面积择优，两种拓扑分别续搜并共享提案额度", async () => {
  const session = new PlannerBatchSession();
  const input = readPlanningInput(session.workspace.registry, nativeCopper);
  const request = { ...input, options: { ...input.options, solidOutput: "auto" as const } };
  const before = JSON.stringify(request);
  try {
    const result = await runPlannerBatch(request, { engineKind: "dense-v2", attempts: 4, localEvaluations: 50_000 }, session);
    // AI-CORRECTION 2026-10-11：输出方式独立随机抽样；固定种子的本组搜索覆盖两种方式，不再要求交替顺序。
    expect(result.records).toHaveLength(4);
    expect(new Set(result.records.map(record => record.solidOutput))).toEqual(new Set(["stash", "warehouse"]));
    const successes = result.records.filter(record => record.outcome === "success");
    // AI-REMOVED 2026-09-30:
    // Reason: 全局面积上限可能淘汰另一输出拓扑，自动搜索不再承诺两种模式都生成较大的成功蓝图。
    // Trigger: 用户要求已有最优后所有分支只搜索更小面积。
    // Evidence: 全局上限生效后原生铜四轮仍尝试两种模式，仅 stash 成功。
    // Replacement: 下方逐轮全局上限检查；warehouse 独立冷启动继续验证真实生成与产量。
    // Risk: Low；保留两种模式、真实产量和共享预算验证。Human Review: Required。
    // Original code:
    // expect(new Set(successes.map(record => record.solidOutput))).toEqual(new Set(["stash", "warehouse"]));
    expect(successes.length).toBeGreaterThan(0);
    let bestArea = Infinity;
    for (const record of result.records) {
      if (Number.isFinite(bestArea)) {
        expect(record.search!.maximumArea).toBe(bestArea - 1);
        expect(record.search!.outline.width * record.search!.outline.height).toBeLessThan(bestArea);
      }
      if (record.outcome === "success") bestArea = Math.min(bestArea, record.area!);
    }
    expect(result.proposalCurve.bestArea).toBe(Math.min(...successes.map(record => record.area!)));
    expect(result.localEvaluations).toBeLessThanOrEqual(50_000);
    expect(result.proposalCurve.exact).toBe(true);
    expect(result.localEvaluations).toBe(result.records.reduce((sum, record) => sum + record.search!.evaluations, 0));
    // 独立功能回归不混入上面自动搜索的五万次预算或选优成绩。
    const warehouse = await runPlannerBatch({ ...request, options: { ...request.options, solidOutput: "warehouse" } },
      { engineKind: "dense-v2", attempts: 1, localEvaluations: 12_500 }, session);
    expect(warehouse.successes).toBe(1);
    const verified = [...successes, ...warehouse.records];
    expect(new Set(verified.map(record => record.solidOutput))).toEqual(new Set(["stash", "warehouse"]));
    const portfolio = new PlannerSearchPortfolio(request);
    for (const record of verified) {
      expect(record.constraints).toEqual({ placementErrors: [], excessiveOperatingInputs: [] });
      expect(record.measuredOutputs![0]!.perMinute).toBeGreaterThanOrEqual(request.plan.targets[0]!.perMinute);
      const seed = JSON.parse(readFileSync(`${record.artifactPath}/search-seed.json`, "utf8")) as PlannerSearchSeed;
      portfolio.remember(seed);
      expect(seed.network.request.options.solidOutput).toBe(record.solidOutput);
      const ids = seed.network.nodes.map(node => node.entity.definitionId);
      expect(ids).toContain(record.solidOutput === "stash" ? "storager_1" : "loader_1");
      expect(ids).not.toContain(record.solidOutput === "stash" ? "loader_1" : "storager_1");
      for (const node of seed.network.nodes.filter(node => node.entity.definitionId === "unloader_1")) {
        expect(node.entity.config["storageSlotGroups[0].slots[0].ignoreStock"]).toBe(true);
        expect(node.entity.config["storageSlotGroups[0].slots[0].initialCount"]).toBeGreaterThan(0);
      }
    }
    // AI-REMOVED 2026-10-11:
    // Reason: 冷启动及输出方式不再由编号取模指定。
    // Trigger: 用户授权独立 PRNG 策略；Evidence: PlannerSearchPortfolio 接收已抽样策略。
    // Replacement: 下方显式策略回归，随机覆盖由 strategy-schedule.test.ts 验证。
    // Risk: 不再要求旧编号顺序；Human Review: Required
    // Original code:
    // expect(portfolio.next(4).seed?.network.request.options.solidOutput).toBe("stash");
    // expect(portfolio.next(5).seed?.network.request.options.solidOutput).toBe("warehouse");
    // expect(portfolio.next(6).seed).toBeUndefined();
    // expect(portfolio.next(7).seed).toBeUndefined();
    // expect(portfolio.next(8).seed).toBeDefined();
    // expect(portfolio.next(9).seed).toBeDefined();
    for (const mode of ["stash", "warehouse"] as const) {
      const assigned = { ...request, options: { ...request.options, solidOutput: mode } };
      const strategy = { ...plannerAttemptStrategy(4), restart: false };
      expect(portfolio.next(4, true, undefined, assigned, strategy).seed?.network.request.options.solidOutput).toBe(mode);
      expect(portfolio.next(4, true, undefined, assigned, { ...strategy, restart: true }).seed).toBeUndefined();
    }
    expect(portfolio.next(8, false).seed).toBeUndefined();
    expect(resolvePlannerAttempt(input, 7)).toEqual({ request: input, variant: 7 });
    const foreign = portfolio.next(4).seed!;
    expect(() => new PlannerSearchPortfolio({ ...request, options: { ...request.options, plantStartup: "warehouse" } }, foreign)).toThrow("不一致");
    expect(JSON.stringify(request)).toBe(before);
  } finally { await session.dispose(); }
}, 120_000);
