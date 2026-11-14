import assert from "node:assert/strict";
import { browserScenario } from "./browser-scenario.mjs";
import { measureMilestones } from "./common.mjs";
import { selectManualDevices, assertManualDevicePoses, manualLayoutAreaLowerBound } from "./manual-followup.mjs";
import { assertCompletedStages, assertManualOptimality, expectedStageRequest } from "./audit.mjs";

/** 仅验证双任务编排和拒绝分类；使用原子 Host 事件样本，不启动浏览器或算法。 */
export async function manualScenarioSelfTest() {
  let checks = 0;
  const descriptors = Object.fromEntries(["window", "navigator"].map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
  try {
    // AI-REMOVED 2026-11-14:
    // Reason: 原矩阵未覆盖预算已发放但任务无进展时的异常证据保存。
    // Trigger: v13 第 30 项首解已验收，异常后阶段和首解快照未导出。
    // Evidence: 原始 manual.stages 为空，独立 audit 报阶段记录数量无效。
    // Replacement: 下方保留成功／拒绝并补自动／人工停滞场景。
    // Risk: Low；只测编排事件，不替代真实算法验证。Human Review: Required。
    // Original code:
    // for (const rejectManual of [false, true]) {
    for (const scenario of ["success", "manual-rejected", "manual-stalled", "automatic-stalled", "manual-optimal"]) {
      const rejectManual = scenario === "manual-rejected", stalledId = ["manual-stalled", "manual-optimal"].includes(scenario) ? "task-2"
        : scenario === "automatic-stalled" ? "task-1" : null;
      const tasks = new Map(), budgets = [];
      let imports = 0;
      const blueprint = { entityOrder: ["device"], entities: { device: { id: "device", definitionId: "device",
        position: { x: 0, y: 0 }, rotation: 0, config: {}, tags: [] } }, slotLinks: [] };
      const host = { state: { activeTaskId: null }, queries: {
        exportDraft: request => ({ request, checkpoint: { evaluations: 0, randomSeed: 123 } }),
        getTask: id => tasks.get(id).progress, getResult: id => tasks.get(id).checkpoint.result,
        exportTask: id => structuredClone(tasks.get(id)),
      }, actions: {
        importTask: async draft => {
          const id = "task-" + (++imports);
          tasks.set(id, { taskId: id, ...draft, progress: { evaluatedProposals: 0, bestArea: null, initialArea: 100,
            areaHistory: [], activeWorkerCount: 0, validatedCandidateCount: 0, status: "waiting" } });
          return id;
        },
        continuePlanning: (id, budget) => {
          budgets.push([id, budget]);
          const task = tasks.get(id), before = task.checkpoint.evaluations, retained = task.checkpoint.unspentEvaluations ?? 0;
          task.request.options.evaluationsPerRound = budget + retained;
          if (rejectManual && id === "task-2") { task.progress.status = "failed"; task.progress.message = "人工准备拒绝"; return; }
          for (const [count, area] of id === stalledId ? before ? [] : [[1000, 60]] : [[1000, 60], [2000, 50]]) {
            task.checkpoint.evaluations = count;
            task.checkpoint.result = { blueprint, metrics: { area, width: area, height: 1 }, measuredOutputs: [{ itemId: "item_test", perMinute: 30 }] };
            task.checkpoint.best = { candidate: { seed: { network: { nodes: [] } } }, report: { engineKind: "dense-v2" } };
            Object.assign(task.progress, { evaluatedProposals: count, bestArea: area, validatedCandidateCount: task.progress.validatedCandidateCount + 1 });
            task.progress.areaHistory.push({ evaluatedProposals: count, bestArea: area });
            globalThis.window.__edaAuditAccepted(task);
          }
          if (id === stalledId) {
            task.checkpoint.unspentEvaluations = retained + budget - (task.checkpoint.evaluations - before);
            task.checkpoint.parallel = { dimensionSchedule: { attemptsPerTask: 5000 } };
          }
        }, cancel: () => { host.state.activeTaskId = null; },
      } };
      const registry = { entityDefinitions: [], queries: { isGeneralLogisticsDevice: () => false } };
      Object.defineProperty(globalThis, "window", { configurable: true, value: {
        innerWidth: 2552, innerHeight: 1315, devicePixelRatio: 1, __edaAuditArea: { S: 50, area: 100 },
        __edaAuditCheckDimensions: async () => ({ passed: true }), __edaAuditHost: {
          workspace: { blueprintPlanner: host, registry }, blueprintPlannerDialog: { selectTask() {}, open() {} },
        },
      } });
      Object.defineProperty(globalThis, "navigator", { configurable: true, value: { gpu: { requestAdapter: async () => ({ info: { isFallbackAdapter: false } }) } } });
      const record = { itemId: "item_test", perMinute: 30, searchMode: 2, manualFollowup: true, manualOrientation: "fixed",
        deletionSeed: 1, request: { plan: {}, options: { randomSeed: 123 } } };
      const manualTools = { selectManualDevices, assertManualDevicePoses, manualLayoutAreaLowerBound,
        prepareManualFollowup: async (_host, _registry, request, _candidate, selection, orientation) => ({
          request: structuredClone(request), selection, orientation, mapping: { device: "device" },
          footprints: { device: { width: scenario === "manual-optimal" ? 60 : 1, height: 1 } },
        }),
      };
      await browserScenario(record, measureMilestones, manualTools);
      const deadline = Date.now() + 3000;
      while (!globalThis.window.__edaAudit.done && Date.now() < deadline) {
        if (globalThis.window.__edaAudit.pending) globalThis.window.__edaAudit.acknowledged = globalThis.window.__edaAudit.pending;
        await new Promise(resolve => setTimeout(resolve, 10));
      }
      const state = globalThis.window.__edaAudit;
      assert.equal(state.done, true);
      if (scenario === "manual-optimal") {
        const evidence = globalThis.window.__edaAuditEvidence;
        assert.equal(imports, 2); assert.equal(state.completed, true); assert.equal(state.errorKind, null);
        assert.equal(state.progress.secondAttempts, 2000); assert.equal(state.manual.firstAttempts, 1000);
        assert.equal(state.manual.secondAttempts, null); assert.equal(state.manual.secondPassed, false);
        assert.equal(state.manual.secondPosePassed, false); assert.equal(state.manual.optimalPassed, true);
        assert.equal(evidence["manual-second.json"], undefined);
        const proof = assertManualOptimality(evidence["manual-input.json"], state.manual, evidence["manual-first.json"]);
        assert.deepEqual(proof, { kind: "retained-device-bounds", width: 60, height: 1, area: 60, deviceCount: 1, evaluatedProposals: 1000 });
        assertCompletedStages(tasks.get("task-2").progress, state.manual.stages, 2, "minimum", proof);
        assert.throws(() => assertCompletedStages(tasks.get("task-2").progress, state.manual.stages, 2, "minimum"), /最低 50M/);
        assert.throws(() => assertManualOptimality(evidence["manual-input.json"], { ...state.manual,
          optimality: { ...proof, area: 59 } }, evidence["manual-first.json"]), /下界不一致/);
        assert.throws(() => assertManualOptimality(evidence["manual-input.json"], { ...state.manual,
          optimality: null }, evidence["manual-first.json"]), /缺少下界证明/);
        assert.deepEqual(budgets, [["task-1", 20_000_000], ["task-2", 20_000_000]]);
        checks += 16;
        continue;
      }
      if (stalledId) {
        const partial = scenario === "manual-stalled" ? state.manual : state.progress;
        const stages = scenario === "manual-stalled" ? state.manual.stages : state.stages;
        assert.equal(imports, scenario === "manual-stalled" ? 2 : 1);
        assert.equal(state.completed, false); assert.equal(state.errorKind, "runtime");
        assert.match(state.error, /最低额度未达到且任务没有正常结算/);
        assert.equal(partial.evaluatedProposals, 1000); assert.equal(partial.firstAttempts, 1000);
        assert.equal(partial.secondAttempts, null); assert.equal(partial.secondPassed, false);
        assert.equal(stages.length, 1);
        assert.deepEqual(stages[0].rounds, [
          { before: 0, retained: 0, additional: 20_000_000, evaluatedProposals: 1000, unspentEvaluations: 19_999_000 },
          { before: 1000, retained: 19_999_000, additional: 1, evaluatedProposals: 1000, unspentEvaluations: 19_999_001 },
        ]);
        assert.deepEqual(tasks.get(stalledId).request, expectedStageRequest(record.request, stages));
        assert.throws(() => assertCompletedStages(tasks.get(stalledId).progress, stages, 2, "minimum"), /最低 50M/);
        const kind = scenario === "manual-stalled" ? "manual" : "automatic";
        assert.equal(globalThis.window.__edaAuditEvidence[`${kind}-first.json`].evaluatedProposals, 1000);
        assert.equal(globalThis.window.__edaAuditEvidence[`${kind}-second.json`], undefined);
        if (kind === "manual") {
          assert.equal(state.manual.firstPosePassed, true); assert.equal(state.manual.secondPosePassed, false);
          assert.equal(globalThis.window.__edaAuditEvidence["manual-task.eda-task.json"].request.options.evaluationsPerRound, 19_999_001);
          assert.equal(state.progress.secondAttempts, 2000);
        }
        assert.equal(host.state.activeTaskId, null); assert.equal(globalThis.window.__edaAuditAccepted, undefined);
        checks += 19;
        continue;
      }
      assert.equal(imports, 2); assert.equal(state.progress.secondAttempts, 2000);
      assert.equal(globalThis.window.__edaAuditPayload.taskId, "task-1");
      assert.deepEqual(budgets, [["task-1", 20_000_000], ["task-2", 20_000_000]]);
      assert.equal(state.errorKind, rejectManual ? "manual-request-rejected" : null);
      if (rejectManual) { assert.equal(state.manual.errorKind, "request-rejected"); assert.equal(state.manual.firstPassed, false); }
      else { assert.equal(state.manual.secondAttempts, 2000); assert.equal(state.manual.firstPosePassed, true); assert.equal(state.manual.secondPosePassed, true); }
      checks += 8;
    }
  } finally {
    for (const [key, descriptor] of Object.entries(descriptors)) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else Reflect.deleteProperty(globalThis, key);
    }
  }
  return checks;
}
