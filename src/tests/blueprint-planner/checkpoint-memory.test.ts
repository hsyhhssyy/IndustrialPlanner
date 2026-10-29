// @vitest-environment node
import { expect, it, vi } from "vitest";
import type { BlueprintPlannerRequest, BlueprintPlannerTaskFile } from "@/domain/blueprint-planner";
import { createBlueprintPlannerHost } from "@/blueprint-planner/blueprint-planner-host";
import { parsePlannerTaskFile } from "@/blueprint-planner/task-checkpoint";
import { PlannerBatchSession } from "@/scripts/eda/planner-runner";
import yazhen from "./fixtures/yazhen-syringe.json";
// AI-CORRECTION 2026-10-29：32 次短切片改为 32 个完整 X 单元；消费和保留尾额共同守恒，不能假定每片仅一次返回。

it.each([false, true])("慢速存储不积压分片快照，最终检查点不丢失（首次写入失败：%s）", async failFirst => {
  const session = new PlannerBatchSession();
  const saved: BlueprintPlannerTaskFile[] = [];
  let release!: () => void;
  const blocked = new Promise<void>(resolve => { release = resolve; });
  let taskId = "", snapshots = 0, activeWrites = 0, maximumWrites = 0, calls = 0;
  const nativeClone = globalThis.structuredClone;
  // 只观察实际克隆；Worker、任务状态机及检查点校验均执行生产实现。
  const clone = vi.spyOn(globalThis, "structuredClone").mockImplementation(value => {
    const candidate = value as Partial<BlueprintPlannerTaskFile> | null | undefined;
    if (taskId && candidate?.taskId === taskId && candidate?.checkpoint) snapshots++;
    return nativeClone(value);
  });
  const host = createBlueprintPlannerHost(session.workspace, {
    roundLimit: () => 160_000,
    storage: {
      load: async () => [],
      save: async file => {
        activeWrites++;
        maximumWrites = Math.max(maximumWrites, activeWrites);
        const first = ++calls === 1;
        try {
          if (first) await blocked;
          if (first && failFirst) throw new Error("测试注入：首次写入失败");
          saved.push(file);
        } finally { activeWrites--; }
      },
      delete: async () => undefined,
    },
    worker: {
      build: (request, variant, budgetMs, evaluations, signal, update, seed, continuationStep, maximumArea, targetOutline, originSeed, sessionKey, attemptStrategy) =>
        session.planner.build(request, variant, budgetMs,
          { maxEvaluations: evaluations, seed, continuationStep, maximumArea, targetOutline, originSeed, sessionKey, attemptStrategy }, update, signal),
      dispose: () => { void session.planner.dispose(); },
    },
  });
  try {
    await new Promise(resolve => setTimeout(resolve, 0));
    const request = structuredClone(yazhen.request) as BlueprintPlannerRequest;
    taskId = host.actions.start({ ...request, options: { ...request.options, evaluationsPerRound: 160_000, concurrency: 1 } });
    await vi.waitFor(() => {
      expect(host.queries.getTask(taskId)?.status).toBe("waiting");
      expect(host.queries.getTask(taskId)?.evaluatedProposals).toBeGreaterThan(0);
    }, { timeout: 60_000, interval: 20 });
    expect(calls).toBe(1);
    // 首份快照可能在 start 返回前创建；阻塞期间不得再克隆每个批次的完整任务。
    expect(snapshots).toBeLessThanOrEqual(1);
    const point = host.queries.exportTask(taskId).checkpoint as ReturnType<typeof parsePlannerTaskFile>["checkpoint"];
    expect(point.evaluations + (point.unspentEvaluations ?? 0)).toBe(160_000);
    expect(host.state.activeTaskId).toBe(taskId);
    release();
    await vi.waitFor(() => expect(host.state.activeTaskId).toBeNull());
    expect(calls).toBe(2);
    expect(maximumWrites).toBe(1);
    const final = parsePlannerTaskFile(saved.at(-1), session.workspace.registry);
    expect(final.checkpoint.evaluations + (final.checkpoint.unspentEvaluations ?? 0)).toBe(160_000);
    expect(final.checkpoint.parallel!.shards.reduce((sum, shard) => sum + shard.evaluations, 0)).toBe(final.checkpoint.evaluations);
    expect(final.progress).toMatchObject({ status: "waiting", evaluatedProposals: final.checkpoint.evaluations, roundEvaluatedProposals: final.checkpoint.evaluations });
    if (!failFirst) expect(saved[0]?.progress.evaluatedProposals).toBe(0);
    await host.actions.deleteTask(taskId);
  } finally {
    release();
    clone.mockRestore();
    host.dispose();
    await session.dispose();
  }
}, 90_000);
