
// AI-REMOVED 2026-10-26:
// Reason: 测试仅覆盖 beta1/2 之后加入且本次撤下的局部修复、容量评分、子网或连接采样分支。
// Trigger: 用户明确要求恢复 beta1/2 搜索内核，保留业务修复与任务接口。
// Evidence: src/tests/blueprint-planner/repeated-continuation.test.ts；原文件 SHA256 af6777c47a5879edde736d7c7aab64d076b43ff7f1e3beec90122883fe385ce7。
// Replacement: beta1/2 内核的现有几何、Worker、任务与正式验产测试；search-policy.test.ts 验证新面积公式。
// Risk: 撤下的搜索分支不再参与运行，其专用覆盖同时退休；未修改现有业务正确性门槛。
// Human Review: Required
// Original code:
// // @vitest-environment node
// /**
//  * 2026-10-18：整数子网正式续搜的预算、检查点及真实 Worker 回归。
//  * 文档：.docs/common/eda/算法探索/算法探索20261018-整数子网续搜接入.md
//  * 布局 IO 的受控失败仅用于调度计数；基线和生产验收使用真实 Registry / Dense 2 TPS。
//  */
// import { afterAll, beforeAll, expect, it, vi } from "vitest";
// import type { BlueprintPlannerRequest, BlueprintPlannerTaskFile } from "@/domain/blueprint-planner";
// import type { SimulationBlueprintRunReport } from "@/domain/simulation";
// import type { PlannerCandidate } from "@/blueprint-planner/candidate";
// import { createBlueprintPlannerHost, type PlannerHostOptions } from "@/blueprint-planner/blueprint-planner-host";
// import { PlannerCandidateError } from "@/blueprint-planner/model";
// import { combineRepeatedPlannerCandidate, repeatedPlannerRequest } from "@/blueprint-planner/repeated-plan";
// import { emptyPlannerCheckpoint, mergePlannerTaskFiles, parsePlannerTaskFile, PLANNER_ALGORITHM_VERSION } from "@/blueprint-planner/task-checkpoint";
// import { meetsOperatingLimits, meetsProductionTargets } from "@/blueprint-planner/verification";
// import { PlannerBatchSession } from "@/scripts/eda/planner-runner";
// import { saveSuccessfulPlanning } from "@/scripts/eda/artifacts";
// import fixture from "./fixtures/repeated-unit.json";
//
// const session = new PlannerBatchSession();
// const request = fixture.request as BlueprintPlannerRequest;
// let baseline: PlannerCandidate, report: SimulationBlueprintRunReport;
//
// beforeAll(async () => {
//   baseline = combineRepeatedPlannerCandidate(session.workspace.registry, request, fixture.unit as unknown as PlannerCandidate,
//     repeatedPlannerRequest(request, { width: 30, height: 51 })!);
//   report = await session.simulation.actions.runBlueprint(baseline.execution);
//   expect(meetsProductionTargets(request, report)).toBe(true);
//   expect(meetsOperatingLimits(baseline.supplyAudit, report)).toBe(true);
//   await saveSuccessfulPlanning(session.workspace.registry, "repeated-continuation-baseline", baseline.execution.blueprint,
//     request, { report, metrics: baseline.metrics, search: baseline.search, engine: "dense-v2", ticksPerSecond: 2 });
// }, 60_000);
//
// afterAll(async () => { await session.dispose(); });
//
// function originalTask(): BlueprintPlannerTaskFile {
//   return { formatVersion: 1, algorithmVersion: PLANNER_ALGORITHM_VERSION, taskId: "repeated-continuation",
//     request: { ...request, options: { ...request.options, concurrency: 4, gpu: false, randomSeed: 1928356742,
//       deterministicSearch: true } },
//     checkpoint: { ...emptyPlannerCheckpoint(), randomSeed: 1928356742, best: { candidate: baseline, report } },
//     progress: { taskId: "repeated-continuation", status: "waiting", phase: "optimization", startedAt: 1, elapsedMs: 0,
//       estimatedProgress: null, evaluatedProposals: 0, roundEvaluatedProposals: 0, candidateCount: 0,
//       validatedCandidateCount: 0, bestArea: baseline.metrics.area, areaHistory: [], message: null } };
// }
//
// it("实际提案分账覆盖不同子网分片，导入续搜和离线合并保留独立进度", async () => {
//   const dispatched: { index: number; repeated: boolean; used: number }[] = [];
//   const build: NonNullable<PlannerHostOptions["worker"]>["build"] = async (_request, variant, _ms, budget, _signal,
//     update, seed, _step, maximumArea, outline, _origin, _session, strategy, firstSolution, repeatedSeed, repeatedContinuation) => {
//     const repeated = repeatedContinuation === true;
//     expect(firstSolution).toBe(false);
//     expect(maximumArea).toBe(baseline.metrics.area - Number(repeated));
//     expect(outline!.width * outline!.height).toBeLessThanOrEqual(maximumArea!);
//     if (repeated) {
//       expect(seed).toBeUndefined();
//       if (!strategy!.restart) expect(repeatedSeed?.network.request.plan.targets[0]!.perMinute).toBe(120);
//     }
//     // 每批提前结束，验证剩余额度实际归还，不能将预约配额计为搜索消耗。
//     const used = Math.min(budget, 80_000);
//     dispatched.push({ index: variant % 32, repeated, used });
//     update("layout", "受控布局 IO 结算", used);
//     throw new PlannerCandidateError("本批未找到候选");
//   };
//   const worker = () => ({ build, dispose: () => undefined });
//   const host = createBlueprintPlannerHost(session.workspace, { storage: null, worker: worker(), workerFactory: worker });
//   let id = "";
//   try {
//     id = await host.actions.importTask(originalTask());
//     let first: ReturnType<typeof parsePlannerTaskFile> | undefined;
//     for (let round = 1; round <= 2; round++) {
//       host.actions.continuePlanning(id, 12_000_000, 4, false);
//       await vi.waitFor(() => expect(host.state.activeTaskId).toBeNull(), { timeout: 60_000, interval: 20 });
//       const file = parsePlannerTaskFile(host.queries.exportTask(id), session.workspace.registry);
//       expect(file.progress.status, file.progress.message ?? "").toBe("waiting");
//       expect(file.checkpoint.evaluations).toBe(round * 12_000_000);
//       const parallel = file.checkpoint.parallel!;
//       expect(parallel.repeatedSchedule).toMatchObject({ targetArea: 1530, inclusive: false, repeatedUnits: 3 });
//       expect(parallel.dimensionSchedule).toMatchObject({ targetArea: 1530, inclusive: true, continuationRepeatedUnits: 3 });
//       for (const shard of parallel.shards) {
//         const jobs = dispatched.filter(job => job.index === shard.index);
//         expect(shard.continuationEvaluations ?? 0).toBe(jobs.reduce((sum, job) => sum + job.used, 0));
//         expect(shard.repeated!.evaluations).toBe(jobs.filter(job => job.repeated).reduce((sum, job) => sum + job.used, 0));
//         expect(shard.repeated!.attempts).toBe(jobs.filter(job => job.repeated).length);
//       }
//       const repeated = parallel.shards.reduce((sum, shard) => sum + shard.repeated!.evaluations, 0);
//       expect(repeated).toBeLessThanOrEqual(file.checkpoint.evaluations / 8);
//       expect(file.checkpoint.evaluations / 8 - repeated).toBeLessThanOrEqual(4 * 100_000 / 8);
//       expect(new Set(dispatched.filter(job => job.repeated).map(job => job.index)).size).toBeGreaterThan(8);
//       if (round === 1) { first = file; id = await host.actions.importTask(file); }
//       else {
//         expect(parallel.shards.reduce((sum, shard) => sum + shard.repeated!.attempts, 0))
//           .toBeGreaterThan(first!.checkpoint.parallel!.shards.reduce((sum, shard) => sum + shard.repeated!.attempts, 0));
//         const parts = [structuredClone(file), structuredClone(file)];
//         for (const [index, part] of parts.entries()) part.checkpoint.parallel!.ownedShards =
//           Array.from({ length: 16 }, (_, offset) => index * 16 + offset);
//         const merged = parsePlannerTaskFile(await mergePlannerTaskFiles(parts, session.workspace.registry), session.workspace.registry);
//         expect(merged.checkpoint.parallel!.shards.map(shard => shard.repeated)).toEqual(parallel.shards.map(shard => shard.repeated));
//         expect(merged.checkpoint.evaluations).toBe(file.checkpoint.evaluations);
//         const invalidCount = structuredClone(file);
//         invalidCount.checkpoint.parallel!.shards[0]!.repeated!.evaluations = file.checkpoint.evaluations + 1;
//         expect(() => parsePlannerTaskFile(invalidCount, session.workspace.registry)).toThrow("子网续搜计数无效");
//         const invalidGeneration = structuredClone(file);
//         invalidGeneration.checkpoint.parallel!.repeatedSchedule = { ...parallel.repeatedSchedule!,
//           generation: parallel.repeatedSchedule!.generation + 1 };
//         expect(() => parsePlannerTaskFile(invalidGeneration, session.workspace.registry)).toThrow("子网尺寸调度与当前任务不匹配");
//       }
//     }
//   } finally {
//     if (id) host.actions.cancel(id);
//     host.dispose(); await host.whenSettled();
//   }
// }, 150_000);
//
// it("真实 Worker 在已有成果模式执行原生子网，组合结果仍受整图面积上限约束", async () => {
//   const evaluations: number[] = [];
//   const outcome = await session.planner.build(request, 1928356742, 30_000, { maxEvaluations: 1000,
//     targetOutline: { width: 30, height: 51 }, maximumArea: 1, repeatedContinuation: true,
//     repeatedSeed: (fixture.unit as unknown as PlannerCandidate).seed }, (_phase, _message, count) => evaluations.push(count))
//     .then(candidate => ({ candidate }), (error: unknown) => ({ error }));
//   expect("candidate" in outcome).toBe(false);
//   if (!("error" in outcome)) throw new Error("整图面积上限未生效");
//   expect(outcome.error).toBeInstanceOf(PlannerCandidateError);
//   const error = outcome.error as PlannerCandidateError;
//   expect(error.search?.repeatedUnits).toBe(3);
//   expect(error.search!.evaluations).toBeLessThanOrEqual(1000);
//   expect(Math.max(0, ...evaluations)).toBeLessThanOrEqual(1000);
// }, 45_000);
//
// it("子网与整网同时在途时暂停，只结算实际消耗，恢复后不跳过被取消尺寸", async () => {
//   let id = "", cancelPhase = true;
//   const jobs: { repeated: boolean; index: number }[] = [];
//   const build: NonNullable<PlannerHostOptions["worker"]>["build"] = async (_request, variant, _ms, budget, signal,
//     update, _seed, _step, _area, _outline, _origin, _session, _strategy, _first, _unit, repeatedContinuation) => {
//     if (cancelPhase) {
//       jobs.push({ repeated: !!repeatedContinuation, index: variant % 32 });
//       update("layout", "取消前已消耗提案", 47);
//       if (repeatedContinuation) queueMicrotask(() => host.actions.cancel(id));
//       await new Promise<void>(done => {
//         if (signal.aborted) done();
//         else signal.addEventListener("abort", () => done(), { once: true });
//       });
//       throw new DOMException("任务暂停", "AbortError");
//     }
//     update("layout", "恢复后结算", budget);
//     throw new PlannerCandidateError("本批未找到候选");
//   };
//   const worker = () => ({ build, dispose: () => undefined });
//   const host = createBlueprintPlannerHost(session.workspace, { storage: null, worker: worker(), workerFactory: worker });
//   try {
//     id = await host.actions.importTask(originalTask());
//     host.actions.continuePlanning(id, 1_000_000, 4, false);
//     await vi.waitFor(() => expect(host.state.activeTaskId).toBeNull(), { timeout: 30_000 });
//     const paused = parsePlannerTaskFile(host.queries.exportTask(id), session.workspace.registry);
//     expect(paused.progress.status, paused.progress.message ?? "").toBe("waiting");
//     expect(jobs.some(job => job.repeated)).toBe(true);
//     expect(jobs.some(job => !job.repeated)).toBe(true);
//     expect(paused.checkpoint.evaluations).toBe(jobs.length * 47);
//     for (const job of jobs) {
//       const shard = paused.checkpoint.parallel!.shards[job.index]!;
//       expect(shard.dimensionCursor).toBe(0);
//       expect(shard.repeated!.dimensionCursor).toBe(0);
//       expect(shard.continuationEvaluations).toBe(47);
//       expect(shard.repeated!.evaluations).toBe(job.repeated ? 47 : 0);
//     }
//     cancelPhase = false;
//     id = await host.actions.importTask(paused);
//     host.actions.continuePlanning(id, 10_000, 4, false);
//     await vi.waitFor(() => expect(host.state.activeTaskId).toBeNull(), { timeout: 30_000 });
//     const resumed = parsePlannerTaskFile(host.queries.exportTask(id), session.workspace.registry);
//     expect(resumed.progress.status, resumed.progress.message ?? "").toBe("waiting");
//     expect(resumed.checkpoint.evaluations).toBe(paused.checkpoint.evaluations + 10_000);
//   } finally {
//     if (id) host.actions.cancel(id);
//     host.dispose(); await host.whenSettled();
//   }
// }, 90_000);
//
