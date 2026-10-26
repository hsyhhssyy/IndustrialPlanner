// @vitest-environment node
/**
 * 2026-10-17：固定输入的冷启动与首解调度契约；使用真实 Node Worker 和 Dense 2 TPS 验收。
 * 文档：.docs/common/测试/EDA浏览器回归测试.md
 * 只改变真实 Worker 结果的送达顺序，不替换搜索、候选或仿真结果；不运行 20M 专项用例。
 */
import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { expect, it, vi } from "vitest";
import type { BlueprintPlannerRequest } from "@/domain/blueprint-planner";
import { createBlueprintPlannerHost, type PlannerHostOptions } from "@/blueprint-planner/blueprint-planner-host";
import { parsePlannerTaskFile, validatePlannerTaskOptions } from "@/blueprint-planner/task-checkpoint";
import { plannerRequestKey } from "@/blueprint-planner/search-seed";
import { PlannerBatchSession } from "@/scripts/eda/planner-runner";
import { NodePlannerClient } from "@/scripts/eda/node-planner-client";
import fixture from "./fixtures/power-no-space.json";

async function runColdStart(reverse: boolean, cancel = false) {
  const session = new PlannerBatchSession(), clients: NodePlannerClient[] = [];
  const request: BlueprintPlannerRequest = { ...structuredClone(fixture.request) as BlueprintPlannerRequest,
    options: { ...fixture.request.options as BlueprintPlannerRequest["options"], evaluationsPerRound: 10_000,
      concurrency: 2, gpu: false, randomSeed: 1928356741, initialArea: 200,
      deterministicSearch: true, stopAfterFirstSolution: true } };
  const dispatched: unknown[] = [], delivered: number[] = [], firstPair = new Map<number, () => void>();
  let taskId = "";
  const makeWorker: NonNullable<PlannerHostOptions["workerFactory"]> = () => {
    const client = new NodePlannerClient(); clients.push(client);
    return { build: async (input, variant, budgetMs, evaluations, signal, update, seed, continuationStep,
      maximumArea, targetOutline, originSeed, sessionKey, attemptStrategy) => {
      const sequence = dispatched.length;
      dispatched.push({ variant, evaluations, maximumArea, targetOutline, attemptStrategy,
        seed: seed && { width: seed.width, height: seed.height, routes: seed.routes } });
      if (cancel && sequence === 0) queueMicrotask(() => host.actions.cancel(taskId));
      const outcome = await client.build(input, variant, budgetMs, { maxEvaluations: evaluations, seed, continuationStep,
        maximumArea, targetOutline, originSeed, sessionKey, attemptStrategy }, update, signal)
        .then(value => ({ value }), (error: unknown) => ({ error }));
      if (sequence < 2 && !signal.aborted) {
        await new Promise<void>(done => {
          const release = () => { signal.removeEventListener("abort", release); done(); };
          signal.addEventListener("abort", release, { once: true });
          firstPair.set(sequence, release);
          if (firstPair.size === 2) {
            firstPair.get(reverse ? 1 : 0)!();
            setTimeout(() => firstPair.get(reverse ? 0 : 1)!(), 0);
          }
        });
      }
      delivered.push(sequence);
      if ("error" in outcome) throw outcome.error;
      return outcome.value;
    }, dispose: () => { void client.dispose(); } };
  };
  const host = createBlueprintPlannerHost(session.workspace, { storage: null, worker: makeWorker(), workerFactory: makeWorker });
  try {
    const input = host.queries.exportDraft(request);
    expect((input.checkpoint as { parallel?: unknown }).parallel).toBeUndefined();
    taskId = await host.actions.importTask(input);
    expect(host.queries.getRandomSeed(taskId)).toBe(request.options.randomSeed);
    host.actions.continuePlanning(taskId, request.options.evaluationsPerRound);
    await vi.waitFor(() => expect(host.state.activeTaskId).toBeNull(), { timeout: 60_000, interval: 20 });
    const file = parsePlannerTaskFile(host.queries.exportTask(taskId), session.workspace.registry);
    expect(file.progress.status, file.progress.message ?? undefined).toBe("waiting");
    expect(file.progress.activeWorkerCount).toBe(0);
    expect(file.progress.evaluatedProposals).toBeLessThanOrEqual(request.options.evaluationsPerRound);
    const point = file.checkpoint;
    // AI-CORRECTION 2026-10-17：首解停止保存可导入续算的优化调度，未出解仍保留初始调度；没有派发额外搜索。
    expect(point.parallel?.dimensionSchedule).toMatchObject({ targetArea: point.best?.candidate.metrics.area ?? 200,
      generation: point.best ? 1 : 0 });
    expect(file.progress.initialArea).toBe(200);
    if (point.result) {
      const directory = resolve(".temp/eda/success", `${Date.now()}-${file.taskId}-host-reproducibility`);
      await mkdir(directory, { recursive: true });
      for (const [name, value] of Object.entries({ "blueprint.json": point.result.blueprint, "input.eda-task.json": input,
        "task.eda-task.json": file, "report.json": { progress: file.progress, measuredOutputs: point.result.measuredOutputs,
          verification: point.best?.report, delivered, dispatched, engine: "dense-v2", ticksPerSecond: 2 } })) {
        await writeFile(resolve(directory, name), JSON.stringify(value, null, 2));
      }
    }
    return { file, dispatched, delivered };
  } finally {
    host.dispose();
    await Promise.all(clients.map(client => client.dispose()));
    await host.whenSettled();
    await session.dispose();
  }
}

it("反转真实 Worker 的完成顺序，固定面积、派发序列、首解和结算总数保持一致", async () => {
  const forward = await runColdStart(false), reverse = await runColdStart(true);
  expect(forward.delivered.slice(0, 2)).toEqual([0, 1]);
  expect(reverse.delivered.slice(0, 2)).toEqual([1, 0]);
  expect(reverse.dispatched).toEqual(forward.dispatched);
  for (const { file } of [forward, reverse]) {
    expect(file.progress.validatedCandidateCount).toBe(1);
    expect(file.progress.areaHistory).toEqual([{ evaluatedProposals: file.progress.evaluatedProposals,
      bestArea: file.checkpoint.result!.metrics.area }]);
    expect(file.checkpoint.result!.metrics.area).toBeLessThanOrEqual(200);
    expect(file.checkpoint.result!.measuredOutputs).toEqual(fixture.request.plan.targets);
  }
  expect(reverse.file.progress.evaluatedProposals).toBe(forward.file.progress.evaluatedProposals);
  expect(reverse.file.checkpoint.result!.metrics).toEqual(forward.file.checkpoint.result!.metrics);
  expect(reverse.file.checkpoint.result!.blueprint.entities).toEqual(forward.file.checkpoint.result!.blueprint.entities);
}, 150_000);

it("确定性批次主动取消后释放结果顺序等待和全部在途 Worker", async () => {
  const { file } = await runColdStart(true, true);
  expect(file.checkpoint.result).toBeNull();
  expect(file.progress.validatedCandidateCount).toBe(0);
}, 90_000);

it("执行控制不改变生产约束指纹，非法种子、面积或自动并发被正式边界拒绝", () => {
  const request = fixture.request as BlueprintPlannerRequest;
  const controlled = { ...request, options: { ...request.options, randomSeed: 123, initialArea: 200,
    deterministicSearch: true, stopAfterFirstSolution: true, concurrency: 2 } };
  expect(plannerRequestKey(controlled)).toBe(plannerRequestKey(request));
  expect(() => validatePlannerTaskOptions(controlled.options)).not.toThrow();
  for (const value of [0, -1, 1.5, 0x100000000, NaN]) {
    expect(() => validatePlannerTaskOptions({ ...controlled.options, randomSeed: value })).toThrow();
  }
  for (const value of [0, -1, 1.5, 4901, NaN]) {
    expect(() => validatePlannerTaskOptions({ ...controlled.options, initialArea: value })).toThrow();
  }
  expect(() => validatePlannerTaskOptions({ ...controlled.options, concurrency: "auto" })).toThrow("确定性搜索");
});

// AI-REMOVED 2026-10-26:
// Reason: 同步旧内核 Worker 参数；仍反转真实结果送达顺序并核验确定性、首解、取消和完整预算。
// Trigger: 用户确认恢复 beta1/2 搜索内核并保留业务修复、任务接口。
// Evidence: src/tests/blueprint-planner/reproducible-search.test.ts；原文件 SHA256 7ca011bb3141df77e1c5ac474f2a2c5d2abb8df37a961771a278bd7c13adb153。
// Replacement: 当前文件活动代码，或 beta1/2 对应执行路径。
// Risk: 仅撤下已移除的算法分支参数/覆盖；公开预算、产率和任务一致性断言保持。
// Human Review: Required
// Original code:
// // @vitest-environment node
// /**
//  * 2026-10-17：固定输入的冷启动与首解调度契约；使用真实 Node Worker 和 Dense 2 TPS 验收。
//  * 文档：.docs/common/测试/EDA浏览器回归测试.md
//  * 只改变真实 Worker 结果的送达顺序，不替换搜索、候选或仿真结果；不运行 20M 专项用例。
//  */
// import { mkdir, writeFile } from "node:fs/promises";
// import { resolve } from "node:path";
// import { expect, it, vi } from "vitest";
// import type { BlueprintPlannerRequest } from "@/domain/blueprint-planner";
// import { createBlueprintPlannerHost, type PlannerHostOptions } from "@/blueprint-planner/blueprint-planner-host";
// import { parsePlannerTaskFile, validatePlannerTaskOptions } from "@/blueprint-planner/task-checkpoint";
// import { plannerRequestKey } from "@/blueprint-planner/search-seed";
// import { PlannerBatchSession } from "@/scripts/eda/planner-runner";
// import { NodePlannerClient } from "@/scripts/eda/node-planner-client";
// import fixture from "./fixtures/power-no-space.json";
//
// async function runColdStart(reverse: boolean, cancel = false) {
//   const session = new PlannerBatchSession(), clients: NodePlannerClient[] = [];
//   const request: BlueprintPlannerRequest = { ...structuredClone(fixture.request) as BlueprintPlannerRequest,
//     options: { ...fixture.request.options as BlueprintPlannerRequest["options"], evaluationsPerRound: 10_000,
//       concurrency: 2, gpu: false, randomSeed: 1928356741, initialArea: 200,
//       deterministicSearch: true, stopAfterFirstSolution: true } };
//   const dispatched: unknown[] = [], delivered: number[] = [], firstPair = new Map<number, () => void>();
//   let taskId = "";
//   const makeWorker: NonNullable<PlannerHostOptions["workerFactory"]> = () => {
//     const client = new NodePlannerClient(); clients.push(client);
//     return { build: async (input, variant, budgetMs, evaluations, signal, update, seed, continuationStep,
//       maximumArea, targetOutline, originSeed, sessionKey, attemptStrategy, firstSolution, repeatedSeed, repeatedContinuation) => {
//       const sequence = dispatched.length;
//       dispatched.push({ variant, evaluations, maximumArea, targetOutline, attemptStrategy, firstSolution,
//         seed: seed && { width: seed.width, height: seed.height, routes: seed.routes },
//         repeatedSeed: repeatedSeed && { width: repeatedSeed.width, height: repeatedSeed.height, routes: repeatedSeed.routes } });
//       if (cancel && sequence === 0) queueMicrotask(() => host.actions.cancel(taskId));
//       const outcome = await client.build(input, variant, budgetMs, { maxEvaluations: evaluations, seed, continuationStep,
//         maximumArea, targetOutline, originSeed, sessionKey, attemptStrategy, firstSolution, repeatedSeed, repeatedContinuation }, update, signal)
//         .then(value => ({ value }), (error: unknown) => ({ error }));
//       if (sequence < 2 && !signal.aborted) {
//         await new Promise<void>(done => {
//           const release = () => { signal.removeEventListener("abort", release); done(); };
//           signal.addEventListener("abort", release, { once: true });
//           firstPair.set(sequence, release);
//           if (firstPair.size === 2) {
//             firstPair.get(reverse ? 1 : 0)!();
//             setTimeout(() => firstPair.get(reverse ? 0 : 1)!(), 0);
//           }
//         });
//       }
//       delivered.push(sequence);
//       if ("error" in outcome) throw outcome.error;
//       return outcome.value;
//     }, dispose: () => { void client.dispose(); } };
//   };
//   const host = createBlueprintPlannerHost(session.workspace, { storage: null, worker: makeWorker(), workerFactory: makeWorker });
//   try {
//     const input = host.queries.exportDraft(request);
//     expect((input.checkpoint as { parallel?: unknown }).parallel).toBeUndefined();
//     taskId = await host.actions.importTask(input);
//     expect(host.queries.getRandomSeed(taskId)).toBe(request.options.randomSeed);
//     host.actions.continuePlanning(taskId, request.options.evaluationsPerRound);
//     await vi.waitFor(() => expect(host.state.activeTaskId).toBeNull(), { timeout: 60_000, interval: 20 });
//     const file = parsePlannerTaskFile(host.queries.exportTask(taskId), session.workspace.registry);
//     expect(file.progress.status, file.progress.message ?? undefined).toBe("waiting");
//     expect(file.progress.activeWorkerCount).toBe(0);
//     expect(file.progress.evaluatedProposals).toBeLessThanOrEqual(request.options.evaluationsPerRound);
//     const point = file.checkpoint;
//     // AI-CORRECTION 2026-10-17：首解停止保存可导入续算的优化调度，未出解仍保留初始调度；没有派发额外搜索。
//     expect(point.parallel?.dimensionSchedule).toMatchObject({ targetArea: point.best?.candidate.metrics.area ?? 200,
//       generation: point.best ? 1 : 0 });
//     expect(file.progress.initialArea).toBe(200);
//     if (point.result) {
//       const directory = resolve(".temp/eda/success", `${Date.now()}-${file.taskId}-host-reproducibility`);
//       await mkdir(directory, { recursive: true });
//       for (const [name, value] of Object.entries({ "blueprint.json": point.result.blueprint, "input.eda-task.json": input,
//         "task.eda-task.json": file, "report.json": { progress: file.progress, measuredOutputs: point.result.measuredOutputs,
//           verification: point.best?.report, delivered, dispatched, engine: "dense-v2", ticksPerSecond: 2 } })) {
//         await writeFile(resolve(directory, name), JSON.stringify(value, null, 2));
//       }
//     }
//     return { file, dispatched, delivered };
//   } finally {
//     host.dispose();
//     await Promise.all(clients.map(client => client.dispose()));
//     await host.whenSettled();
//     await session.dispose();
//   }
// }
//
// it("反转真实 Worker 的完成顺序，固定面积、派发序列、首解和结算总数保持一致", async () => {
//   const forward = await runColdStart(false), reverse = await runColdStart(true);
//   expect(forward.delivered.slice(0, 2)).toEqual([0, 1]);
//   expect(reverse.delivered.slice(0, 2)).toEqual([1, 0]);
//   expect(reverse.dispatched).toEqual(forward.dispatched);
//   for (const { file } of [forward, reverse]) {
//     expect(file.progress.validatedCandidateCount).toBe(1);
//     expect(file.progress.areaHistory).toEqual([{ evaluatedProposals: file.progress.evaluatedProposals,
//       bestArea: file.checkpoint.result!.metrics.area }]);
//     expect(file.checkpoint.result!.metrics.area).toBeLessThanOrEqual(200);
//     expect(file.checkpoint.result!.measuredOutputs).toEqual(fixture.request.plan.targets);
//   }
//   expect(reverse.file.progress.evaluatedProposals).toBe(forward.file.progress.evaluatedProposals);
//   expect(reverse.file.checkpoint.result!.metrics).toEqual(forward.file.checkpoint.result!.metrics);
//   expect(reverse.file.checkpoint.result!.blueprint.entities).toEqual(forward.file.checkpoint.result!.blueprint.entities);
// }, 150_000);
//
// it("确定性批次主动取消后释放结果顺序等待和全部在途 Worker", async () => {
//   const { file } = await runColdStart(true, true);
//   expect(file.checkpoint.result).toBeNull();
//   expect(file.progress.validatedCandidateCount).toBe(0);
// }, 90_000);
//
// it("执行控制不改变生产约束指纹，非法种子、面积或自动并发被正式边界拒绝", () => {
//   const request = fixture.request as BlueprintPlannerRequest;
//   const controlled = { ...request, options: { ...request.options, randomSeed: 123, initialArea: 200,
//     deterministicSearch: true, stopAfterFirstSolution: true, concurrency: 2 } };
//   expect(plannerRequestKey(controlled)).toBe(plannerRequestKey(request));
//   expect(() => validatePlannerTaskOptions(controlled.options)).not.toThrow();
//   for (const value of [0, -1, 1.5, 0x100000000, NaN]) {
//     expect(() => validatePlannerTaskOptions({ ...controlled.options, randomSeed: value })).toThrow();
//   }
//   for (const value of [0, -1, 1.5, 4901, NaN]) {
//     expect(() => validatePlannerTaskOptions({ ...controlled.options, initialArea: value })).toThrow();
//   }
//   expect(() => validatePlannerTaskOptions({ ...controlled.options, concurrency: "auto" })).toThrow("确定性搜索");
// });
//
