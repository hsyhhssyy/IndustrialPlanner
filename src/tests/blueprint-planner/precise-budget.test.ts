// @vitest-environment node
// 2026-10-21：完整累计预算与检查点续算；真实 Node Worker、正式 Host、Dense 2 tick/s。
// 文档：.docs/common/eda/算法探索/算法探索20261021-通用布线进展与搜索预算.md
import { expect, it, vi } from "vitest";
import type { WorkspaceContract } from "@/domain/document/workspace-contract";
import type { BlueprintPlannerRequest } from "@/domain/blueprint-planner";
import { createWorkspaceState } from "@/domain/document/workspace-state";
import { createRegistryContract } from "@/registry";
import { createSimulationHost } from "@/simulation/simulation-host";
import { createBlueprintPlannerHost, type PlannerHostOptions } from "@/blueprint-planner/blueprint-planner-host";
import { parsePlannerTaskFile } from "@/blueprint-planner/task-checkpoint";
import { NodePlannerClient } from "@/scripts/eda/node-planner-client";
import fixture from "./fixtures/power-no-space.json";

it("任意整数尾额经过真实搜索和多次导出导入后准确累计，不取整或超额", async () => {
  const workspace: WorkspaceContract = { state: createWorkspaceState(), registry: createRegistryContract(),
    app: null, editor: null, render: null, sync: null, audio: null, simulation: null, blueprintPlanner: null };
  const simulation = createSimulationHost(workspace, { engineKind: "dense-v2", workerMode: "runtime", blueprintDenseTickRate: 2 });
  workspace.simulation = simulation;
  const client = new NodePlannerClient();
  const worker: NonNullable<PlannerHostOptions["worker"]> = {
    build: (request, variant, budgetMs, evaluations, signal, update, seed, continuationStep, maximumArea, targetOutline,
      originSeed, sessionKey, attemptStrategy) => client.build(request, variant, budgetMs,
      { maxEvaluations: evaluations, seed, continuationStep, maximumArea, targetOutline, originSeed, sessionKey,
        attemptStrategy }, update, signal),
    dispose: () => { void client.dispose(); },
  };
  const host = createBlueprintPlannerHost(workspace, { storage: null, worker });
  let id = "", cumulative = 0;
  try {
    const request = { ...structuredClone(fixture.request), options: { ...fixture.request.options,
      evaluationsPerRound: 1, concurrency: 1, gpu: false, randomSeed: 1928356741,
      deterministicSearch: true, stopAfterFirstSolution: false } } as BlueprintPlannerRequest;
    id = await host.actions.importTask(host.queries.exportDraft(request));
    for (const evaluations of [1, 19, 8641]) {
      host.actions.continuePlanning(id, evaluations, 1, false);
      await vi.waitFor(() => expect(host.state.activeTaskId).toBeNull(), { timeout: 20_000, interval: 20 });
      const file = parsePlannerTaskFile(host.queries.exportTask(id), workspace.registry);
      cumulative += evaluations;
      expect(file.progress.evaluatedProposals).toBe(cumulative);
      expect(file.progress.roundEvaluatedProposals).toBe(evaluations);
      expect(file.progress.activeWorkerCount).toBe(0);
      expect(file.progress.status).not.toBe("failed");
      await host.actions.deleteTask(id);
      id = await host.actions.importTask(file);
      expect(host.queries.getTask(id)?.evaluatedProposals).toBe(cumulative);
    }
  } finally {
    if (id && host.state.activeTaskId === id) host.actions.cancel(id);
    try { await vi.waitFor(() => expect(host.state.activeTaskId).toBeNull(), { timeout: 20_000 }); }
    finally { host.dispose(); await client.dispose(); simulation.dispose(); }
  }
}, 60_000);

// AI-REMOVED 2026-10-26:
// Reason: 真实 Worker 适配参数恢复为 beta1/2；1、19、8641 次尾额累计与导入导出断言保持。
// Trigger: 用户确认恢复 beta1/2 搜索内核并保留业务修复、任务接口。
// Evidence: src/tests/blueprint-planner/precise-budget.test.ts；原文件 SHA256 0a076c18e1b0e3de993d88d1bfd92e3dab08d05a3bbf1cc6192abb1c983598d3。
// Replacement: 当前文件活动代码，或 beta1/2 对应执行路径。
// Risk: 仅撤下已移除的算法分支参数/覆盖；公开预算、产率和任务一致性断言保持。
// Human Review: Required
// Original code:
// // @vitest-environment node
// // 2026-10-21：完整累计预算与检查点续算；真实 Node Worker、正式 Host、Dense 2 tick/s。
// // 文档：.docs/common/eda/算法探索/算法探索20261021-通用布线进展与搜索预算.md
// import { expect, it, vi } from "vitest";
// import type { WorkspaceContract } from "@/domain/document/workspace-contract";
// import type { BlueprintPlannerRequest } from "@/domain/blueprint-planner";
// import { createWorkspaceState } from "@/domain/document/workspace-state";
// import { createRegistryContract } from "@/registry";
// import { createSimulationHost } from "@/simulation/simulation-host";
// import { createBlueprintPlannerHost, type PlannerHostOptions } from "@/blueprint-planner/blueprint-planner-host";
// import { parsePlannerTaskFile } from "@/blueprint-planner/task-checkpoint";
// import { NodePlannerClient } from "@/scripts/eda/node-planner-client";
// import fixture from "./fixtures/power-no-space.json";
//
// it("任意整数尾额经过真实搜索和多次导出导入后准确累计，不取整或超额", async () => {
//   const workspace: WorkspaceContract = { state: createWorkspaceState(), registry: createRegistryContract(),
//     app: null, editor: null, render: null, sync: null, audio: null, simulation: null, blueprintPlanner: null };
//   const simulation = createSimulationHost(workspace, { engineKind: "dense-v2", workerMode: "runtime", blueprintDenseTickRate: 2 });
//   workspace.simulation = simulation;
//   const client = new NodePlannerClient();
//   const worker: NonNullable<PlannerHostOptions["worker"]> = {
//     build: (request, variant, budgetMs, evaluations, signal, update, seed, continuationStep, maximumArea, targetOutline,
//       originSeed, sessionKey, attemptStrategy, firstSolution, repeatedSeed, repeatedContinuation) => client.build(request, variant, budgetMs,
//       { maxEvaluations: evaluations, seed, continuationStep, maximumArea, targetOutline, originSeed, sessionKey,
//         attemptStrategy, firstSolution, repeatedSeed, repeatedContinuation }, update, signal),
//     dispose: () => { void client.dispose(); },
//   };
//   const host = createBlueprintPlannerHost(workspace, { storage: null, worker });
//   let id = "", cumulative = 0;
//   try {
//     const request = { ...structuredClone(fixture.request), options: { ...fixture.request.options,
//       evaluationsPerRound: 1, concurrency: 1, gpu: false, randomSeed: 1928356741,
//       deterministicSearch: true, stopAfterFirstSolution: false } } as BlueprintPlannerRequest;
//     id = await host.actions.importTask(host.queries.exportDraft(request));
//     for (const evaluations of [1, 19, 8641]) {
//       host.actions.continuePlanning(id, evaluations, 1, false);
//       await vi.waitFor(() => expect(host.state.activeTaskId).toBeNull(), { timeout: 20_000, interval: 20 });
//       const file = parsePlannerTaskFile(host.queries.exportTask(id), workspace.registry);
//       cumulative += evaluations;
//       expect(file.progress.evaluatedProposals).toBe(cumulative);
//       expect(file.progress.roundEvaluatedProposals).toBe(evaluations);
//       expect(file.progress.activeWorkerCount).toBe(0);
//       expect(file.progress.status).not.toBe("failed");
//       await host.actions.deleteTask(id);
//       id = await host.actions.importTask(file);
//       expect(host.queries.getTask(id)?.evaluatedProposals).toBe(cumulative);
//     }
//   } finally {
//     if (id && host.state.activeTaskId === id) host.actions.cancel(id);
//     try { await vi.waitFor(() => expect(host.state.activeTaskId).toBeNull(), { timeout: 20_000 }); }
//     finally { host.dispose(); await client.dispose(); simulation.dispose(); }
//   }
// }, 60_000);
//
