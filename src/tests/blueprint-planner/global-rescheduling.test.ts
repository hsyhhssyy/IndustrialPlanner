// @vitest-environment node
import { afterAll, beforeAll, expect, it, vi } from "vitest";
import type { BlueprintPlannerTaskFile } from "@/domain/blueprint-planner";
import type { SimulationBlueprintRunReport } from "@/domain/simulation";
import type { PlannerCandidate } from "@/blueprint-planner/candidate";
import { createBlueprintPlannerHost, type PlannerHostOptions } from "@/blueprint-planner/blueprint-planner-host";
import { PlannerCandidateError } from "@/blueprint-planner/model";
import { PlannerSearchPortfolio } from "@/blueprint-planner/search-portfolio";
import { fixedOutlineMinimum } from "@/blueprint-planner/search-outline";
import { partitionPlannerDimensions, PLANNER_DIMENSION_ATTEMPTS } from "@/blueprint-planner/dimension-schedule";
import { plannerRequestKey } from "@/blueprint-planner/search-seed";
import { emptyPlannerCheckpoint, mergePlannerTaskFiles, parsePlannerTaskFile, PLANNER_ALGORITHM_VERSION } from "@/blueprint-planner/task-checkpoint";
import { PlannerBatchSession } from "@/scripts/eda/planner-runner";
import { readPlanningInput } from "@/scripts/eda/planning-input";
import { saveSuccessfulPlanning } from "@/scripts/eda/artifacts";
import plant from "./fixtures/plant-preload.json";

const session = new PlannerBatchSession();
const request = readPlanningInput(session.workspace.registry, plant);
let baseline: PlannerCandidate, report: SimulationBlueprintRunReport;

beforeAll(async () => {
  // 使用真实 Worker 生成种子与蓝图；后续只控制布局 IO 的完成次序，验收仍运行 Dense 2 TPS。
  baseline = await session.planner.build(request, 0, 30_000);
  report = await session.simulation.actions.runBlueprint(baseline.execution);
  expect(report.status).toBe("completed");
  expect(report.probes[0]!.perMinute).toBeGreaterThanOrEqual(request.plan.targets[0]!.perMinute);
  await saveSuccessfulPlanning(session.workspace.registry, "global-rescheduling-baseline", baseline.execution.blueprint,
    request, { report, metrics: baseline.metrics, search: baseline.search });
}, 60_000);

afterAll(async () => { await session.dispose(); });

function originalTask(): BlueprintPlannerTaskFile {
  // 保持真实设备与报告，用合法的大包围盒建立待压缩目标。
  const wide = structuredClone(baseline);
  Object.assign(wide.metrics, { width: 70, height: 70, area: 4900 });
  Object.assign(wide.seed!, { width: 70, height: 70 });
  Object.assign(wide.search, { outline: { width: 70, height: 70 } });
  const pool = new PlannerSearchPortfolio(request, { ...baseline.seed!, width: baseline.seed!.width + 1 });
  const shards = Array.from({ length: 32 }, (_, index) => ({ index, nextVariant: 320 + index,
    attempts: 10, evaluations: 1000, validatedCandidates: 0, portfolio: pool.snapshot(), pendingCandidate: null,
    shapeVisits: { "stash/19/15": 10 } }));
  return { formatVersion: 1, algorithmVersion: PLANNER_ALGORITHM_VERSION, taskId: "global-rescheduling",
    request: { ...request, options: { ...request.options, concurrency: 2, gpu: true } },
    checkpoint: { ...emptyPlannerCheckpoint(), attempt: 320, evaluations: 32000, best: { candidate: wide, report },
      parallel: { count: 32, originTaskId: "global-rescheduling", baseAttempt: 0, baseEvaluations: 0,
        baseValidatedCandidates: 0, ownedShards: shards.map(shard => shard.index), shards,
        requestKey: plannerRequestKey(request), nextShard: 0 } },
    progress: { taskId: "global-rescheduling", status: "waiting", phase: "optimization", startedAt: 1, elapsedMs: 100,
      estimatedProgress: null, evaluatedProposals: 32000, roundEvaluatedProposals: 0, candidateCount: 320,
      validatedCandidateCount: 0, bestArea: 4900,
      areaHistory: [{ evaluatedProposals: 32000, bestArea: 4900 }], message: null } };
}

function improvedCandidate(delta: number, evaluations: number): PlannerCandidate {
  const candidate = structuredClone(baseline);
  // 固定几何与产量，只控制同面积施工排名，验证此类改进也触发全局切换。
  // AI-CORRECTION 2026-10-10：相对 70×70 目标检验严格面积改进；同面积迟到候选也必须丢弃。
  candidate.execution.blueprint.blueprintId = `rescheduled-${delta}`;
  candidate.search.quality = { ...candidate.search.quality!, secondary: candidate.search.quality!.secondary - delta };
  candidate.search.evaluations = evaluations;
  return candidate;
}

// AI-REMOVED 2026-10-10:
// Reason: 原用例断言临时尺寸选择、40k 额度及接受旧代候选，与用户新设计冲突。
// Trigger: 用户要求固定尺寸唯一归属 32 分片、跨领取轮转和验收后统一切换。
// Evidence: 旧调度每次临时选尺寸，旧任务回写可能覆盖新游标。
// Replacement: 本文件固定尺寸调度回归
// Risk: 调度顺序与历史任务恢复语义变化；由分片及 Host 回归覆盖。
// Human Review: Required
// Original code:
// it.each(["cancelled", "better", "worse"] as const)(
//   "新最优取消 CPU/GPU 旧批次，计数守恒并处理迟到候选：%s", async late => {
//     let releaseWinner!: () => void;
//     const winnerReady = new Promise<void>(resolve => { releaseWinner = resolve; });
//     let cpuCalls = 0, gpuCalls = 0, cancelled = 0, active = 0;
//     const variants = new Set<number>();
//     const postRestartSeeds: number[] = [];
//     const build = (gpu: boolean): NonNullable<PlannerHostOptions["worker"]>["build"] =>
//       async (_request, variant, _ms, budget, signal, update, seed, _step, maximumArea) => {
//         expect(variants.has(variant)).toBe(false); variants.add(variant);
//         const call = gpu ? gpuCalls++ : cpuCalls++;
//         active++;
//         try {
//           if (!gpu && call === 0) {
//             await winnerReady;
//             update("layout", "候选已完成", 90);
//             return improvedCandidate(1, 90);
//           }
//           if ((gpu && call === 0) || (!gpu && call === 1)) {
//             // 一个批次已计算，另一个尚未计算；两者都必须推进分片序号。
//             const used = gpu ? 103 : 0;
//             update("layout", "旧目标计算中", used);
//             await new Promise<void>(resolve => {
//               if (signal.aborted) resolve();
//               else signal.addEventListener("abort", () => resolve(), { once: true });
//             });
//             cancelled++;
//             if (gpu && late !== "cancelled") return improvedCandidate(late === "better" ? 2 : 0, used);
//             throw new DOMException("旧目标取消", "AbortError");
//           }
//           if (seed) postRestartSeeds.push(seed.width * seed.height);
//           expect(maximumArea).toBeLessThanOrEqual(baseline.metrics.area);
//           await new Promise(resolve => setTimeout(resolve, 1));
//           update("layout", "已完成评估", budget);
//           throw new PlannerCandidateError("本批无更优布局");
//         } finally { active--; }
//       };
//     const host = createBlueprintPlannerHost(session.workspace, { storage: null,
//       worker: { build: build(false), dispose: () => undefined },
//       workerFactory: () => ({ build: build(false), dispose: () => undefined }),
//       gpuWorkerFactory: () => ({ build: build(true), dispose: () => undefined, gpuAvailable: true }) });
//     let id = "";
//     try {
//       const input = originalTask();
//       for (const shard of (input.checkpoint as ReturnType<typeof emptyPlannerCheckpoint>).parallel!.shards) {
//         shard.shapeEvaluations = { "stash/19/15": 1000 };
//       }
//       id = await host.actions.importTask(input);
//       host.actions.continuePlanning(id, 40_000, 2, true);
//       await vi.waitFor(() => expect(active).toBe(3));
//       releaseWinner();
//       await vi.waitFor(() => expect(host.state.activeTaskId).toBeNull(), { timeout: 30_000 });
//       const file = parsePlannerTaskFile(host.queries.exportTask(id), session.workspace.registry);
//       expect(file.progress.status, file.progress.message ?? "").toBe("waiting");
//       expect(cancelled).toBe(2);
//       expect(file.checkpoint.evaluations).toBe(72_000);
//       expect(file.checkpoint.parallel!.shards.reduce((sum, shard) => sum
//         + Object.values(shard.shapeEvaluations ?? {}).reduce((total, used) => total + used, 0), 0)).toBe(72_000);
//       expect(file.checkpoint.best!.candidate.execution.blueprint.blueprintId).toBe(`rescheduled-${late === "better" ? 2 : 1}`);
//       expect(file.progress.validatedCandidateCount).toBe(late === "better" ? 2 : 1);
//       expect(file.checkpoint.parallel!.shards.every(shard => shard.pendingCandidate === null)).toBe(true);
//       expect(new Set(file.checkpoint.parallel!.shards.map(shard => shard.searchTarget)).size).toBe(1);
//       expect(postRestartSeeds.length).toBeGreaterThan(0);
//       expect(postRestartSeeds.every(area => area === baseline.metrics.area)).toBe(true);
//       expect(file.checkpoint.parallel!.shards.every(shard => shard.shapeVisits["stash/19/15"]! >= 10)).toBe(true);
//       await saveSuccessfulPlanning(session.workspace.registry, `global-rescheduling-${late}`, file.checkpoint.best!.candidate.execution.blueprint,
//         file.request, { report: file.checkpoint.best!.report, progress: file.progress, note: "受控布局完成顺序，真实 Dense 验收；不作为搜索性能证据。" });
//     } finally {
//       releaseWinner();
//       if (id) host.actions.cancel(id);
//       await vi.waitFor(() => expect(host.state.activeTaskId).toBeNull(), { timeout: 30_000 });
//       host.dispose();
//     }
//   }, 60_000);
//
// it("旧任务更新种子时保留访问历史，暂停和导入续算不重复计算分片进度", async () => {
//   const seen = new Set<number>();
//   const host = createBlueprintPlannerHost(session.workspace, { storage: null,
//     worker: { build: async (_request, variant, _ms, budget, _signal, update) => {
//       expect(seen.has(variant)).toBe(false); seen.add(variant);
//       update("layout", "已完成评估", budget);
//       throw new PlannerCandidateError("本批无更优布局");
//     }, dispose: () => undefined } });
//   let id = "";
//   try {
//     id = await host.actions.importTask(originalTask());
//     for (let round = 1; round <= 2; round++) {
//       host.actions.continuePlanning(id, 10_000, 1, false);
//       await vi.waitFor(() => expect(host.state.activeTaskId).toBeNull());
//       const file = parsePlannerTaskFile(host.queries.exportTask(id), session.workspace.registry);
//       expect(file.progress.status).toBe("waiting");
//       expect(file.checkpoint.evaluations).toBe(32000 + round * 10000);
//       expect(file.checkpoint.parallel!.shards.reduce((sum, shard) => sum
//         + Object.values(shard.shapeVisits).reduce((total, visits) => total + visits, 0), 0)).toBe(320 + round);
//       expect(file.checkpoint.parallel!.shards.every(shard => shard.searchTarget !== undefined)).toBe(true);
//     }
//     // 导入会分配新的蓝图身份；对应同一最优结果的访问记录应随引用一起保留。
//     const saved = parsePlannerTaskFile(host.queries.exportTask(id), session.workspace.registry);
//     id = await host.actions.importTask(saved);
//     host.actions.continuePlanning(id, 10_000, 1, false);
//     await vi.waitFor(() => expect(host.state.activeTaskId).toBeNull());
//     const imported = parsePlannerTaskFile(host.queries.exportTask(id), session.workspace.registry);
//     expect(imported.checkpoint.best!.candidate.execution.blueprint.blueprintId)
//       .not.toBe(saved.checkpoint.best!.candidate.execution.blueprint.blueprintId);
//     expect(imported.checkpoint.evaluations).toBe(62000);
//     expect(imported.checkpoint.parallel!.shards.reduce((sum, shard) => sum
//       + Object.values(shard.shapeVisits).reduce((total, visits) => total + visits, 0), 0)).toBe(323);
//   } finally { if (id) host.actions.cancel(id); host.dispose(); }
// });
//
// it("更优候选未通过真实产量验收时，不取消其他分片或替换全局最优", async () => {
//   let calls = 0, oldSignal: AbortSignal | undefined;
//   const build: NonNullable<PlannerHostOptions["worker"]>["build"] = async (_request, _variant, _ms, budget, signal, update) => {
//     const call = calls++;
//     if (call === 0) {
//       const candidate = improvedCandidate(1, 90);
//       // 不提供目标探针，真实仿真报告无法证明产量达标，必须拒绝该候选。
//       const execution = { ...candidate.execution, probes: [] };
//       update("layout", "待验收候选", 90);
//       return { ...candidate, execution };
//     }
//     if (call === 1) {
//       oldSignal = signal;
//       await new Promise<void>(resolve => {
//         if (signal.aborted) resolve();
//         else signal.addEventListener("abort", () => resolve(), { once: true });
//       });
//       throw new DOMException("任务暂停", "AbortError");
//     }
//     await new Promise(resolve => setTimeout(resolve, 1));
//     update("layout", "已完成评估", budget);
//     throw new PlannerCandidateError("本批无候选");
//   };
//   const host = createBlueprintPlannerHost(session.workspace, { storage: null,
//     worker: { build, dispose: () => undefined }, workerFactory: () => ({ build, dispose: () => undefined }) });
//   let id = "";
//   try {
//     id = await host.actions.importTask(originalTask());
//     const importedBest = (host.queries.exportTask(id).checkpoint as ReturnType<typeof emptyPlannerCheckpoint>).best;
//     host.actions.continuePlanning(id, 20_000, 2, false);
//     await vi.waitFor(() => expect(calls).toBeGreaterThanOrEqual(3));
//     expect(oldSignal?.aborted).toBe(false);
//     const file = host.queries.exportTask(id);
//     expect(file.progress.validatedCandidateCount).toBe(0);
//     // AI-REMOVED 2026-10-07:
//     // Reason: 导入前的蓝图 ID 不是本次任务身份，不能用来判断验收是否替换最优。
//     // Trigger: 新增反向用例错误地忽略 importTask 的独立身份语义。
//     // Evidence: importTask 明确调用 createUuid 更新蓝图 ID；验收次数仍为零。
//     // Replacement: 下方完整比较导入后、搜索前的最优快照；Risk: Low；Human Review: Required。
//     // Original code:
//     // expect((file.checkpoint as ReturnType<typeof emptyPlannerCheckpoint>).best!.candidate.execution.blueprint.blueprintId)
//     //   .toBe(baseline.execution.blueprint.blueprintId);
//     expect((file.checkpoint as ReturnType<typeof emptyPlannerCheckpoint>).best).toEqual(importedBest);
//   } finally {
//     if (id) host.actions.cancel(id);
//     await vi.waitFor(() => expect(host.state.activeTaskId).toBeNull());
//     host.dispose();
//   }
// });
//
// it("离线协作恢复只重调度本地拥有的分片，不改写其他客户端的检查点", async () => {
//   const input = originalTask();
//   const host = createBlueprintPlannerHost(session.workspace, { storage: null,
//     shardSelection: { count: 32, start: 12, end: 13 },
//     worker: { build: async (_request, _variant, _ms, budget, _signal, update, seed) => {
//       expect(seed?.width).toBe(baseline.seed!.width);
//       update("layout", "已完成评估", budget);
//       throw new PlannerCandidateError("本批无候选");
//     }, dispose: () => undefined } });
//   let id = "";
//   try {
//     id = await host.actions.importTask(input);
//     host.actions.continuePlanning(id, 10_000, 1, false);
//     await vi.waitFor(() => expect(host.state.activeTaskId).toBeNull());
//     const output = parsePlannerTaskFile(host.queries.exportTask(id), session.workspace.registry);
//     expect(output.progress.status).toBe("waiting");
//     expect(output.checkpoint.parallel!.ownedShards).toEqual([12]);
//     for (const shard of output.checkpoint.parallel!.shards) {
//       if (shard.index === 12) {
//         expect(shard.searchTarget).toBeDefined();
//         expect(shard.evaluations).toBe(11000);
//       } else expect(shard).toEqual((input.checkpoint as ReturnType<typeof emptyPlannerCheckpoint>).parallel!.shards[shard.index]);
//     }
//   } finally { if (id) host.actions.cancel(id); host.dispose(); }
// });
//
//
// it("整轮均匀覆盖所有宽度，失败批次不能凭续跑状态抢占下一份 40k 额度", async () => {
//   const input = originalTask();
//   const checkpoint = input.checkpoint as ReturnType<typeof emptyPlannerCheckpoint>;
//   for (const shard of checkpoint.parallel!.shards) shard.shapeVisits = {};
//   const minimum = fixedOutlineMinimum(session.workspace.registry, baseline.seed!.network.nodes);
//   const shapes = breadthOutlines(baseline.metrics.area - 1, minimum);
//   const dispatched: number[] = [];
//   const host = createBlueprintPlannerHost(session.workspace, { storage: null,
//     worker: { build: async (_request, variant, _ms, budget, _signal, update, _seed, _step, _maximumArea, outline) => {
//       expect(outline).toBeDefined();
//       expect(budget).toBe(40_000);
//       dispatched.push(outline!.width);
//       update("layout", "连续搜索已完成", budget);
//       throw new PlannerCandidateError("本批未找到可行布局", { seed: variant, evaluationLimit: budget,
//         evaluations: budget, outline: outline!, acceptedMoves: 100, routingAttempts: 0,
//         initialWireLength: 100, finalWireLength: 90, layoutInitialCost: 100, layoutBestCost: 90 });
//     }, dispose: () => undefined } });
//   let id = "";
//   try {
//     id = await host.actions.importTask(input);
//     host.actions.continuePlanning(id, shapes.length * 2 * 40_000, 1, false);
//     await vi.waitFor(() => expect(host.state.activeTaskId).toBeNull(), { timeout: 30_000 });
//     const file = parsePlannerTaskFile(host.queries.exportTask(id), session.workspace.registry);
//     expect(file.progress.status, file.progress.message ?? "").toBe("waiting");
//     expect(file.checkpoint.evaluations).toBe(32_000 + shapes.length * 2 * 40_000);
//     expect(dispatched).toHaveLength(shapes.length * 2);
//     const expected = new Set(shapes.map(shape => shape.width));
//     expect(new Set(dispatched.slice(0, shapes.length))).toEqual(expected);
//     expect(new Set(dispatched.slice(shapes.length))).toEqual(expected);
//   } finally {
//     if (id) host.actions.cancel(id);
//     await vi.waitFor(() => expect(host.state.activeTaskId).toBeNull());
//     host.dispose();
//   }
// }, 60_000);
//
//
// it("早退变体不锁死某些宽度的预算，真实提案记账可导出、导入并继续结算", async () => {
//   const input = originalTask();
//   const checkpoint = input.checkpoint as ReturnType<typeof emptyPlannerCheckpoint>;
//   for (const shard of checkpoint.parallel!.shards) shard.shapeVisits = {};
//   const shapes = breadthOutlines(baseline.metrics.area - 1,
//     fixedOutlineMinimum(session.workspace.registry, baseline.seed!.network.nodes));
//   const actual = new Map<number, number>();
//   const host = createBlueprintPlannerHost(session.workspace, { storage: null,
//     worker: { build: async (_request, variant, _ms, budget, _signal, update, _seed, _step, _area, outline) => {
//       expect(outline).toBeDefined();
//       expect(budget).toBeGreaterThan(0);
//       expect(budget).toBeLessThanOrEqual(40_000);
//       // 对照 Windows 实际失败：偶数变体只消耗 1 次，奇数变体消耗完整额度。
//       const used = variant % 2 === 0 ? 1 : budget;
//       actual.set(outline!.width, (actual.get(outline!.width) ?? 0) + used);
//       update("layout", "本批完成", used);
//       throw new PlannerCandidateError("本批无候选", { seed: variant, evaluationLimit: budget,
//         evaluations: used, outline: outline!, acceptedMoves: 0, routingAttempts: 0,
//         initialWireLength: 100, finalWireLength: 100, preparationRejected: used === 1 });
//     }, dispose: () => undefined } });
//   let id = "";
//   try {
//     id = await host.actions.importTask(input);
//     const budget = shapes.length * 2 * 40_000;
//     host.actions.continuePlanning(id, budget, 1, false);
//     await vi.waitFor(() => expect(host.state.activeTaskId).toBeNull(), { timeout: 30_000 });
//     const file = parsePlannerTaskFile(host.queries.exportTask(id), session.workspace.registry);
//     expect(file.progress.status, file.progress.message ?? "").toBe("waiting");
//     expect(file.checkpoint.evaluations).toBe(32_000 + budget);
//     expect(new Set(actual.keys())).toEqual(new Set(shapes.map(shape => shape.width)));
//     expect(Math.min(...actual.values())).toBeGreaterThan(0);
//     expect(Math.max(...actual.values()) - Math.min(...actual.values())).toBeLessThanOrEqual(40_000);
//     const charged = file.checkpoint.parallel!.shards.reduce((sum, shard) => sum
//       + Object.values(shard.shapeEvaluations ?? {}).reduce((total, used) => total + used, 0), 0);
//     expect(charged).toBe(budget);
//     const invalid = structuredClone(file);
//     const shard = invalid.checkpoint.parallel!.shards.find(entry => Object.keys(entry.shapeEvaluations ?? {}).length)!;
//     shard.shapeEvaluations![Object.keys(shard.shapeEvaluations!)[0]!] = shard.evaluations + 1;
//     expect(() => parsePlannerTaskFile(invalid, session.workspace.registry)).toThrow("分片检查点无效");
//     id = await host.actions.importTask(file);
//     host.actions.continuePlanning(id, 10_000, 1, false);
//     await vi.waitFor(() => expect(host.state.activeTaskId).toBeNull());
//     const resumed = parsePlannerTaskFile(host.queries.exportTask(id), session.workspace.registry);
//     expect(resumed.checkpoint.evaluations).toBe(42_000 + budget);
//     expect(resumed.checkpoint.parallel!.shards.reduce((sum, entry) => sum
//       + Object.values(entry.shapeEvaluations ?? {}).reduce((total, used) => total + used, 0), 0)).toBe(budget + 10_000);
//   } finally {
//     if (id) host.actions.cancel(id);
//     await vi.waitFor(() => expect(host.state.activeTaskId).toBeNull());
//     host.dispose();
//   }
// }, 60_000);

it.each(["cancelled", "better", "worse"] as const)("Dense 新最优作废 CPU/GPU 旧任务，迟到结果不覆盖新代：%s", async late => {
  let releaseWinner!: () => void;
  const winnerReady = new Promise<void>(resolve => { releaseWinner = resolve; });
  let cpuCalls = 0, gpuCalls = 0, cancelled = 0, active = 0;
  const variants = new Set<number>();
  const postRestartSeeds: number[] = [];
  const build = (gpu: boolean): NonNullable<PlannerHostOptions["worker"]>["build"] =>
    async (_request, variant, _ms, budget, signal, update, seed, _step, maximumArea, outline) => {
      expect(variants.has(variant)).toBe(false); variants.add(variant);
      expect(outline).toBeDefined();
      expect(budget).toBeLessThanOrEqual(PLANNER_DIMENSION_ATTEMPTS);
      const call = gpu ? gpuCalls++ : cpuCalls++;
      active++;
      try {
        if (!gpu && call === 0) {
          await winnerReady;
          update("layout", "候选已完成", 90);
          return improvedCandidate(1, 90);
        }
        if ((gpu && call === 0) || (!gpu && call === 1)) {
          const used = gpu ? 103 : 0;
          update("layout", "旧目标计算中", used);
          await new Promise<void>(resolve => {
            if (signal.aborted) resolve();
            else signal.addEventListener("abort", () => resolve(), { once: true });
          });
          cancelled++;
          if (gpu && late !== "cancelled") return improvedCandidate(late === "better" ? 2 : 0, used);
          throw new DOMException("旧目标取消", "AbortError");
        }
        if (seed) postRestartSeeds.push(seed.width * seed.height);
        expect(maximumArea).toBe(baseline.metrics.area - 1);
        await new Promise(resolve => setTimeout(resolve, 1));
        update("layout", "已完成评估", budget);
        throw new PlannerCandidateError("本批无更优布局");
      } finally { active--; }
    };
  const host = createBlueprintPlannerHost(session.workspace, { storage: null,
    worker: { build: build(false), dispose: () => undefined },
    workerFactory: () => ({ build: build(false), dispose: () => undefined }),
    gpuWorkerFactory: () => ({ build: build(true), dispose: () => undefined, gpuAvailable: true }) });
  let id = "";
  try {
    const input = originalTask();
    for (const shard of (input.checkpoint as ReturnType<typeof emptyPlannerCheckpoint>).parallel!.shards) {
      shard.shapeEvaluations = { "stash/19/15": 1000 };
    }
    id = await host.actions.importTask(input);
    host.actions.continuePlanning(id, 40_000, 2, true);
    await vi.waitFor(() => expect(active).toBe(3));
    releaseWinner();
    await vi.waitFor(() => expect(host.state.activeTaskId).toBeNull(), { timeout: 30_000 });
    const file = parsePlannerTaskFile(host.queries.exportTask(id), session.workspace.registry);
    expect(file.progress.status, file.progress.message ?? "").toBe("waiting");
    expect(cancelled).toBe(2);
    expect(file.checkpoint.evaluations).toBe(72_000);
    expect(file.checkpoint.parallel!.shards.reduce((sum, shard) => sum
      + Object.values(shard.shapeEvaluations ?? {}).reduce((total, used) => total + used, 0), 0)).toBe(72_000);
    expect(file.checkpoint.best!.candidate.execution.blueprint.blueprintId).toBe("rescheduled-1");
    expect(file.progress.validatedCandidateCount).toBe(1);
    expect(file.checkpoint.parallel!.dimensionSchedule?.generation).toBe(1);
    expect(file.checkpoint.parallel!.dimensionSchedule?.targetArea).toBe(baseline.metrics.area);
    expect(file.checkpoint.parallel!.shards.every(shard => shard.pendingCandidate === null)).toBe(true);
    expect(postRestartSeeds.length).toBeGreaterThan(0);
    expect(postRestartSeeds.every(area => area === baseline.metrics.area)).toBe(true);
    await saveSuccessfulPlanning(session.workspace.registry, `dimension-rescheduling-${late}`, file.checkpoint.best!.candidate.execution.blueprint,
      file.request, { report: file.checkpoint.best!.report, progress: file.progress, note: "受控布局完成顺序，真实 Dense 验收；不作为搜索性能证据。" });
  } finally {
    releaseWinner();
    if (id) host.actions.cancel(id);
    await vi.waitFor(() => expect(host.state.activeTaskId).toBeNull(), { timeout: 30_000 });
    host.dispose();
  }
}, 60_000);

it("单个分片每次只派发一个尺寸，提交后轮转，导入续算保留游标", async () => {
  const input = originalTask();
  const expected = partitionPlannerDimensions(4900, fixedOutlineMinimum(session.workspace.registry, baseline.seed!.network.nodes));
  const shardIndex = expected.findIndex(list => list.length >= 2);
  expect(shardIndex).toBeGreaterThanOrEqual(0);
  const dispatched: Array<{ width: number; height: number }> = [];
  const variants = new Set<number>();
  let roundLimit = 5000;
  const host = createBlueprintPlannerHost(session.workspace, { storage: null, roundLimit: () => roundLimit,
    shardSelection: { count: 32, start: shardIndex, end: shardIndex + 1 },
    worker: { build: async (_request, variant, _ms, budget, _signal, update, _seed, _step, maximumArea, outline) => {
      expect(variants.has(variant)).toBe(false); variants.add(variant);
      expect(maximumArea).toBe(4899);
      expect(budget).toBe(5000);
      dispatched.push({ width: outline!.width, height: outline!.height });
      update("layout", "已完成评估", budget);
      throw new PlannerCandidateError("本批无候选");
    }, dispose: () => undefined } });
  let id = "";
  try {
    id = await host.actions.importTask(input);
    host.actions.continuePlanning(id, 10000, 1, false);
    await vi.waitFor(() => expect(host.state.activeTaskId).toBeNull());
    const first = parsePlannerTaskFile(host.queries.exportTask(id), session.workspace.registry);
    expect(first.checkpoint.parallel!.shards[shardIndex]!.dimensionCursor).toBe(1);
    id = await host.actions.importTask(first);
    roundLimit = 15000;
    host.actions.continuePlanning(id, 20000, 1, false);
    await vi.waitFor(() => expect(host.state.activeTaskId).toBeNull());
    const file = parsePlannerTaskFile(host.queries.exportTask(id), session.workspace.registry);
    expect(dispatched).toEqual(Array.from({ length: 4 }, (_, index) => {
      const { width, height } = expected[shardIndex]![index % expected[shardIndex]!.length]!;
      return { width, height };
    }));
    expect(file.checkpoint.evaluations).toBe(52000);
    expect(file.checkpoint.parallel!.shards[shardIndex]!.dimensionCursor).toBe(4 % expected[shardIndex]!.length);
    for (const shard of file.checkpoint.parallel!.shards) if (shard.index !== shardIndex) {
      expect(shard.evaluations).toBe(1000);
      expect(shard.dimensionCursor).toBe(0);
    }
  } finally { if (id) host.actions.cancel(id); host.dispose(); }
});

it("Dense 验收失败保持旧代，其他 Worker 持续搜索，暂停不推进未完成游标", async () => {
  let calls = 0, oldSignal: AbortSignal | undefined;
  let blockedVariant = 0;
  const build: NonNullable<PlannerHostOptions["worker"]>["build"] = async (_request, variant, _ms, budget, signal, update) => {
    const call = calls++;
    if (call === 0) {
      const candidate = improvedCandidate(1, 90);
      update("layout", "待验收候选", 90);
      return { ...candidate, execution: { ...candidate.execution, probes: [] } };
    }
    if (call === 1) {
      oldSignal = signal; blockedVariant = variant;
      await new Promise<void>(resolve => signal.addEventListener("abort", () => resolve(), { once: true }));
      throw new DOMException("任务暂停", "AbortError");
    }
    await new Promise(resolve => setTimeout(resolve, 1));
    update("layout", "已完成评估", budget);
    throw new PlannerCandidateError("本批无候选");
  };
  const host = createBlueprintPlannerHost(session.workspace, { storage: null,
    worker: { build, dispose: () => undefined }, workerFactory: () => ({ build, dispose: () => undefined }) });
  let id = "";
  try {
    id = await host.actions.importTask(originalTask());
    host.actions.continuePlanning(id, 20_000, 2, false);
    await vi.waitFor(() => expect(calls).toBeGreaterThanOrEqual(3));
    await vi.waitFor(() => expect((host.queries.exportTask(id).checkpoint as ReturnType<typeof emptyPlannerCheckpoint>)
      .parallel!.shards.every(shard => shard.pendingCandidate === null)).toBe(true));
    expect(oldSignal?.aborted).toBe(false);
    host.actions.cancel(id);
    await vi.waitFor(() => expect(host.state.activeTaskId).toBeNull());
    const file = parsePlannerTaskFile(host.queries.exportTask(id), session.workspace.registry);
    expect(file.progress.validatedCandidateCount).toBe(0);
    expect(file.checkpoint.best!.candidate.metrics.area).toBe(4900);
    expect(file.checkpoint.parallel!.dimensionSchedule?.generation).toBe(0);
    expect(file.checkpoint.parallel!.shards[blockedVariant % 32]!.dimensionCursor).toBe(0);
  } finally {
    if (id) host.actions.cancel(id);
    await vi.waitFor(() => expect(host.state.activeTaskId).toBeNull());
    host.dispose();
  }
});

it.each(["empty", "remainder"])("空分片结束及末批剩余额度：%s", async mode => {
  const input = originalTask();
  const checkpoint = input.checkpoint as ReturnType<typeof emptyPlannerCheckpoint>;
  checkpoint.best = { candidate: baseline, report };
  const dimensions = partitionPlannerDimensions(baseline.metrics.area, fixedOutlineMinimum(session.workspace.registry, baseline.seed!.network.nodes));
  const empty = dimensions.findIndex(list => list.length === 0);
  expect(empty).toBeGreaterThanOrEqual(0);
  const budgets: number[] = [];
  const host = createBlueprintPlannerHost(session.workspace, { storage: null, roundLimit: () => 6000,
    shardSelection: { count: 32, start: mode === "empty" ? empty : 0, end: mode === "empty" ? empty + 1 : 32 },
    worker: { build: async (_request, _variant, _ms, budget, _signal, update) => {
      budgets.push(budget); update("layout", "完成", budget);
      throw new PlannerCandidateError("本批无候选");
    }, dispose: () => undefined } });
  let id = "";
  try {
    id = await host.actions.importTask(input);
    host.actions.continuePlanning(id, 10000, 1, false);
    await vi.waitFor(() => expect(host.state.activeTaskId).toBeNull());
    const file = parsePlannerTaskFile(host.queries.exportTask(id), session.workspace.registry);
    expect(file.progress.status).toBe("waiting");
    expect(budgets).toEqual(mode === "empty" ? [] : [5000, 1000]);
  } finally { if (id) host.actions.cancel(id); host.dispose(); }
});

it("离线不同目标合并保留累计统计，只恢复胜出目标的尺寸游标", async () => {
  const first = originalTask(), second = originalTask();
  const old = first.checkpoint as ReturnType<typeof emptyPlannerCheckpoint>;
  const improved = second.checkpoint as ReturnType<typeof emptyPlannerCheckpoint>;
  improved.best = { candidate: structuredClone(baseline), report };
  const minimum = fixedOutlineMinimum(session.workspace.registry, baseline.seed!.network.nodes);
  for (const [index, checkpoint] of [old, improved].entries()) {
    const parallel = checkpoint.parallel!;
    const targetArea = checkpoint.best!.candidate.metrics.area;
    parallel.dimensionSchedule = { generation: index, targetArea, minimum, attemptsPerTask: PLANNER_DIMENSION_ATTEMPTS };
    parallel.ownedShards = Array.from({ length: 16 }, (_, offset) => index * 16 + offset);
    const dimensions = partitionPlannerDimensions(targetArea, minimum);
    for (const shard of parallel.shards) {
      shard.dimensions = dimensions[shard.index]!;
      shard.dimensionCursor = shard.dimensions.length > 1 ? 1 : 0;
    }
  }
  old.parallel!.shards[0]!.pendingCandidate = structuredClone(baseline);
  const merged = parsePlannerTaskFile(await mergePlannerTaskFiles([first, second], session.workspace.registry), session.workspace.registry);
  expect(merged.checkpoint.evaluations).toBe(32000);
  expect(merged.checkpoint.attempt).toBe(320);
  expect(merged.checkpoint.parallel!.dimensionSchedule?.targetArea).toBe(baseline.metrics.area);
  expect(merged.checkpoint.parallel!.shards.map(shard => shard.dimensions)).toEqual(partitionPlannerDimensions(baseline.metrics.area, minimum));
  for (const shard of merged.checkpoint.parallel!.shards) {
    expect(shard.dimensionCursor).toBe(shard.index < 16 ? 0 : improved.parallel!.shards[shard.index]!.dimensionCursor);
    expect(shard.pendingCandidate).toBeNull();
  }
});
