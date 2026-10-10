// @vitest-environment node
import { expect, it, vi } from "vitest";
import type { BlueprintPlannerRequest, BlueprintPlannerTaskFile } from "@/domain/blueprint-planner";
import type { PlannerCandidate } from "@/blueprint-planner/candidate";
import { createBlueprintPlannerHost, type PlannerHostOptions } from "@/blueprint-planner/blueprint-planner-host";
import type { PlannerCheckpoint } from "@/blueprint-planner/task-checkpoint";
import { PlannerBatchSession } from "@/scripts/eda/planner-runner";
import { saveSuccessfulPlanning } from "@/scripts/eda/artifacts";
import { loadBlueprintFromFile } from "../simulation/blueprint-test-helpers";
import fixture from "./fixtures/power-validation.json";

/** 只控制 IO 完成顺序；产物、供电、产量判断都执行真实 Dense 2 TPS。 */
function schedulingCase(concurrency: number | "auto", budget: number, progressMessages = 1, storage: PlannerHostOptions["storage"] = null) {
  const session = new PlannerBatchSession();
  const blueprint = loadBlueprintFromFile("src/tests/fixtures/blueprints/blueprint-planner/power-validation/covered.schema7.json");
  const request = structuredClone(fixture.request) as BlueprintPlannerRequest;
  let release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  const stats = { searches: 0, verifiers: 0, peakTotal: 0, peakVerifiers: 0, built: 0, verified: 0, fail: false };
  const observe = () => {
    stats.peakTotal = Math.max(stats.peakTotal, stats.searches + stats.verifiers);
    stats.peakVerifiers = Math.max(stats.peakVerifiers, stats.verifiers);
  };
  const runBlueprint = session.simulation.actions.runBlueprint.bind(session.simulation.actions);
  session.simulation.actions.runBlueprint = async (input, signal) => {
    stats.verifiers++; stats.verified++; observe();
    const abort = () => release();
    signal?.addEventListener("abort", abort, { once: true });
    if (signal?.aborted) abort();
    try {
      await gate;
      if (stats.fail) throw new Error("验证服务故障");
      return await runBlueprint(input, signal);
    } finally { signal?.removeEventListener("abort", abort); stats.verifiers--; }
  };
  const makeWorker: NonNullable<PlannerHostOptions["workerFactory"]> = () => ({
    build: async (_request, variant, _budgetMs, evaluations, signal, update) => {
      stats.searches++; observe();
      try {
        await new Promise(resolve => setTimeout(resolve, 1));
        if (signal.aborted) throw new DOMException("已取消", "AbortError");
        for (let message = 1; message <= progressMessages; message++) {
          update("layout", "已完成布局评估", Math.floor(evaluations * message / progressMessages));
        }
        stats.built++;
        return {
          execution: { ...structuredClone(fixture.execution), blueprint: structuredClone(blueprint) },
          metrics: fixture.metrics, connections: [],
          supplyAudit: { operatingLimits: [], splitterCount: 0, bufferedAdmissions: 0 },
          search: { seed: variant, evaluationLimit: evaluations, evaluations, outline: fixture.metrics,
            acceptedMoves: 0, routingAttempts: 0, initialWireLength: 0, finalWireLength: 0 },
        } as PlannerCandidate;
      } finally { stats.searches--; }
    },
    dispose: () => undefined,
  });
  const host = createBlueprintPlannerHost(session.workspace, { storage, worker: makeWorker(), workerFactory: makeWorker,
    resourceHints: { hardwareConcurrency: 8, deviceMemory: 8 } });
  // 存储加载异步完成；调用方先等待 ready，避免把尚未装载误作搜索失败。
  const ready = vi.waitFor(() => expect(() => host.queries.exportDraft(request)).not.toThrow());
  let id = "";
  const start = ready.then(() => { id = host.actions.start({ ...request, options: { ...request.options, concurrency, evaluationsPerRound: budget } }); });
  const idle = () => vi.waitFor(() => expect(host.state.activeTaskId).toBeNull(), { timeout: 20_000 });
  const close = async () => {
    host.actions.cancel(id); release();
    try { await idle(); } finally { host.dispose(); await session.dispose(); }
  };
  return { host, get id() { return id; }, stats, release, idle, close, session, start };
}

it("搜索和真实验证共用并发上限，乱序结束后计数与最优产物仍完整", async () => {
  const test = schedulingCase(4, 80_000);
  try {
    await vi.waitFor(() => expect(test.stats.verifiers).toBe(4));
    expect(test.stats.peakTotal).toBeLessThanOrEqual(4);
    test.release();
    await test.idle();
    const file = test.host.queries.exportTask(test.id);
    const point = file.checkpoint as PlannerCheckpoint;
    expect(file.progress.status).toBe("waiting");
    expect(file.progress.evaluatedProposals).toBe(80_000);
    // AI-CORRECTION 2026-10-10：首个 Dense 新最优使同代其他验证失效，只有胜出的验证提交计数。
    expect(file.progress.validatedCandidateCount).toBe(1);
    expect(test.stats.verified).toBe(4);
    expect(test.stats.peakVerifiers).toBe(4);
    expect(point.parallel!.shards.every(shard => shard.pendingCandidate === null)).toBe(true);
    expect(point.best?.report.engineKind).toBe("dense-v2");
    expect(point.result).not.toBeNull();
    await saveSuccessfulPlanning(test.session.workspace.registry, "cpu-shared-scheduling", point.result!.blueprint,
      file.request, { report: point.best!.report, progress: file.progress, concurrency: test.stats });
  } finally { await test.close(); }
}, 30_000);

it("单路模式下搜索与验证不重叠", async () => {
  const test = schedulingCase(1, 40_000);
  try {
    await vi.waitFor(() => expect(test.stats.verifiers).toBe(1));
    expect(test.stats.built).toBe(1);
    test.release(); await test.idle();
    expect(test.stats.peakTotal).toBe(1);
    expect(test.host.queries.exportTask(test.id).progress.evaluatedProposals).toBe(40_000);
  } finally { await test.close(); }
}, 30_000);

it("高频进度合并界面通知，但最终次数和真实验证结果立即可见", async () => {
  const test = schedulingCase(4, 80_000, 600);
  try {
    const initialRevision = test.host.state.revision;
    await vi.waitFor(() => expect(test.stats.verifiers).toBe(4));
    // AI-CORRECTION 2026-10-10：四个候选各用一个固定 5,000 次额度，队列阻塞时仅提交 20,000 次。
    expect(test.host.queries.getTask(test.id)?.evaluatedProposals).toBe(20_000);
    expect(test.host.state.revision - initialRevision).toBeLessThan(50);
    test.release(); await test.idle();
    expect(test.host.queries.getTask(test.id)?.validatedCandidateCount).toBe(1);
    expect(test.host.queries.getResult(test.id)).not.toBeNull();
    const revision = test.host.state.revision;
    await new Promise(resolve => setTimeout(resolve, 300));
    expect(test.host.state.revision).toBe(revision);
  } finally { await test.close(); }
}, 30_000);

it("快速存储合并运行中检查点，结束后补写最终完整计数", async () => {
  const saved: Array<{ at: number; file: BlueprintPlannerTaskFile }> = [];
  const test = schedulingCase(4, 200_000, 1, {
    load: async () => [], save: async file => { saved.push({ at: performance.now(), file }); }, delete: async () => undefined,
  });
  try {
    await test.start;
    await vi.waitFor(() => expect(test.stats.verifiers).toBe(4));
    test.release(); await test.idle();
    expect(saved.length).toBeGreaterThanOrEqual(2);
    expect(saved.length).toBeLessThan(test.stats.built);
    for (let i = 1; i < saved.length - 1; i++) expect(saved[i]!.at - saved[i - 1]!.at).toBeGreaterThanOrEqual(1900);
    expect(saved.at(-1)!.file.progress).toMatchObject({ status: "waiting", evaluatedProposals: 200_000, activeWorkerCount: 0 });
    expect(test.host.queries.getResult(test.id)).not.toBeNull();
  } finally { await test.close(); }
}, 30_000);

it.each(["pause", "failure"])("%s 保留排队候选，停止新验证，继续后不重复扣除搜索预算", async mode => {
  const test = schedulingCase("auto", 100_000);
  try {
    await vi.waitFor(() => expect(test.stats.built).toBe(5));
    expect(test.stats.verified).toBe(1);
    if (mode === "pause") test.host.actions.cancel(test.id);
    else test.stats.fail = true;
    test.release(); await test.idle();
    const before = test.host.queries.exportTask(test.id);
    expect(before.progress.status).toBe(mode === "pause" ? "waiting" : "failed");
    expect(before.progress.evaluatedProposals).toBe(25_000);
    expect((before.checkpoint as PlannerCheckpoint).parallel!.shards.filter(shard => shard.pendingCandidate !== null)).toHaveLength(5);
    expect(test.stats.verified).toBe(1);
    expect(test.stats.searches + test.stats.verifiers).toBe(0);
    test.stats.fail = false;
    test.host.actions.continuePlanning(test.id, 10_000, 2);
    await test.idle();
    const resumed = test.host.queries.exportTask(test.id);
    expect(resumed.progress.status).toBe("waiting");
    expect(resumed.progress.evaluatedProposals).toBe(35_000);
    // AI-REMOVED 2026-10-07:
    // Reason: 首个通过验收后，其余同排名排队候选已不可能改善，不再重复启动仿真。
    // Trigger: 用户要求全局改进立即重调度并淘汰旧候选。
    // Evidence: 本用例的五个候选使用同一真实蓝图及排名。
    // Replacement: 下方检查至少一个完成验收且队列清空；Risk: Low；Human Review: Required。
    // Original code: expect(resumed.progress.validatedCandidateCount).toBeGreaterThanOrEqual(5);
    expect(resumed.progress.validatedCandidateCount).toBeGreaterThanOrEqual(1);
    expect((resumed.checkpoint as PlannerCheckpoint).parallel!.shards.every(shard => shard.pendingCandidate === null)).toBe(true);
  } finally { await test.close(); }
}, 30_000);
