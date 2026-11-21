// @vitest-environment node
import { expect, it, vi } from "vitest";
import type { BlueprintPlannerRequest } from "@/domain/blueprint-planner";
import type { PlannerCandidate } from "@/blueprint-planner/candidate";
import { createBlueprintPlannerHost, type PlannerHostOptions } from "@/blueprint-planner/blueprint-planner-host";
import { PlannerCandidateError } from "@/blueprint-planner/model";
import { PlannerBatchSession } from "@/scripts/eda/planner-runner";
import { saveSuccessfulPlanning } from "@/scripts/eda/artifacts";
import { coveredPowerCandidate } from "./covered-power-candidate";
import fixture from "./fixtures/power-validation.json";

it.each([{ pause: false, concurrency: "auto" }, { pause: true, concurrency: "auto" },
  { pause: false, concurrency: 1 }, { pause: true, concurrency: 1 }] as const)(
  "GPU 独立领批、共享预算且可与 CPU 重叠；暂停=$pause，CPU=$concurrency", async ({ pause, concurrency }) => {
  const session = new PlannerBatchSession();
  const validCandidate = coveredPowerCandidate(session.workspace.registry);
  let gpuStarted = false, gpuEnded = false, disposed = false, cpuWhileGpu = 0;
  const variants = new Set<number>();
  const makeWorker: NonNullable<PlannerHostOptions["workerFactory"]> = () => ({
    build: async (_request, variant, _ms, budget, signal, update, _seed, _step, _area, _outline, _origin, _session, strategy) => {
      expect(strategy?.layoutSeed).toBeGreaterThan(0);
      expect(variants.has(variant)).toBe(false); variants.add(variant);
      if (gpuStarted && !gpuEnded) cpuWhileGpu++;
      await new Promise(resolve => setTimeout(resolve, 5));
      if (signal.aborted) throw new DOMException("暂停", "AbortError");
      update("layout", "计算中", budget);
      return { ...structuredClone(validCandidate), search: { ...validCandidate.search,
        seed: variant, evaluationLimit: budget, evaluations: budget } } as PlannerCandidate;
    }, dispose: () => undefined,
  });
  const host = createBlueprintPlannerHost(session.workspace, { storage: null, worker: makeWorker(), workerFactory: makeWorker,
    resourceHints: { hardwareConcurrency: 8, deviceMemory: 8 }, gpuWorkerFactory: () => ({ gpuAvailable: true,
      build: async (_request, variant, _ms, budget, signal, update, _seed, _step, _area, _outline, _origin, _session, strategy) => {
        expect(strategy?.layoutSeed).toBeGreaterThan(0);
        expect(variants.has(variant)).toBe(false); variants.add(variant); gpuStarted = true;
        await new Promise<void>(resolve => {
          const timer = setTimeout(finish, pause ? 20_000 : 100);
          function finish() { clearTimeout(timer); signal.removeEventListener("abort", finish); resolve(); }
          signal.addEventListener("abort", finish, { once: true });
        });
        const used = pause ? 100 : budget;
        update("layout", "GPU 批次完成", used); gpuEnded = true;
        if (signal.aborted) throw new DOMException("暂停", "AbortError");
        throw new PlannerCandidateError("本批未找到候选", { seed: variant, evaluationLimit: budget, evaluations: used,
          gpuEvaluations: used, outline: fixture.metrics, acceptedMoves: 0, routingAttempts: 0, initialWireLength: 0, finalWireLength: 0 });
      }, dispose: () => { disposed = true; },
    }) });
  let id = "";
  try {
    const request = structuredClone(fixture.request) as BlueprintPlannerRequest;
    id = host.actions.start({ ...request, options: { ...request.options, concurrency, gpu: true, evaluationsPerRound: 100_000 } });
    await vi.waitFor(() => expect(gpuStarted).toBe(true), { timeout: 20_000 });
    await vi.waitFor(() => expect(cpuWhileGpu).toBeGreaterThan(0), { timeout: 20_000 });
    if (pause) host.actions.cancel(id);
    await vi.waitFor(() => expect(host.state.activeTaskId).toBeNull(), { timeout: 20_000 });
    const file = host.queries.exportTask(id);
    expect(file.progress.status).toBe("waiting");
    expect(file.progress.evaluatedProposals).toBeLessThanOrEqual(100_000);
    // AI-CORRECTION 2026-10-10：首个 CPU 候选最多 5,000 次，加上已报告的 100 次 GPU 提案。
    expect(file.progress.evaluatedProposals).toBeGreaterThanOrEqual(5_100);
    if (!pause) expect(file.progress.evaluatedProposals).toBe(100_000);
    expect(gpuEnded).toBe(true); expect(disposed).toBe(true);
    expect(host.queries.getResult(id)).not.toBeNull();
    await saveSuccessfulPlanning(session.workspace.registry, `gpu-scheduling-${concurrency}-${pause ? "pause" : "complete"}`,
      host.queries.getResult(id)!.blueprint, file.request, { progress: file.progress,
        note: "分片调度测试使用受控布局 IO 与真实 Dense；此产物不作为 GPU 性能证据。" });
  } finally {
    if (id) host.actions.cancel(id);
    await vi.waitFor(() => expect(host.state.activeTaskId).toBeNull(), { timeout: 20_000 });
    host.dispose(); await session.dispose();
  }
}, 60_000);

// AI-REMOVED 2026-11-21:
// Reason: 共享调度真实成品构造，移除重复蓝图装载。
// Trigger: 固定布局南向及真实几何造样。Evidence: normal首轮交付边界拒绝旧outline。
// Replacement: covered-power-candidate.ts
// Risk: Low。Human Review: Required
// Original code:
// import { loadBlueprintFromFile } from "../simulation/blueprint-test-helpers";

// AI-REMOVED 2026-11-21:
// Reason: 复用已经真实几何校验的同一成品，保留原坐标与Dense验证。
// Trigger: 固定布局南向及真实几何造样。Evidence: normal首轮交付边界拒绝旧outline。
// Replacement: validCandidate
// Risk: Low。Human Review: Required
// Original code:
//   const blueprint = loadBlueprintFromFile("src/tests/fixtures/blueprints/blueprint-planner/power-validation/covered.schema7.json");

// AI-REMOVED 2026-11-21:
// Reason: 调度成品必须声明真实南向外框，不能在真实验收前被元数据防线拒绝。
// Trigger: 固定布局南向及真实几何造样。Evidence: normal首轮交付边界拒绝旧outline。
// Replacement: coveredPowerCandidate及上方执行统计覆盖
// Risk: Low。Human Review: Required
// Original code:
//       return { execution: { ...structuredClone(fixture.execution), blueprint: structuredClone(blueprint) },
//         metrics: fixture.metrics, connections: [], supplyAudit: { operatingLimits: [], splitterCount: 0, bufferedAdmissions: 0 },
//         search: { seed: variant, evaluationLimit: budget, evaluations: budget, outline: fixture.metrics,
//           acceptedMoves: 0, routingAttempts: 0, initialWireLength: 0, finalWireLength: 0 } } as PlannerCandidate;
