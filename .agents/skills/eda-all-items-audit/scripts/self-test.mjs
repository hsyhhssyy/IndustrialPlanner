import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, readFile, rm } from "node:fs/promises";
import { resolve } from "node:path";
import ts from "typescript";
import { ROOT, WORK, measureMilestones, writeHistory, failureStopDecision, selectAuditCases } from "./common.mjs";
import { parseAreaFormula, evaluateAreaFormula } from "./area-formula.mjs";
import { auditPlugin } from "./test-build.mjs";
import { browserScenario } from "./browser-scenario.mjs";
import { readAlgorithmVersion } from "./algorithm-source.mjs";
import { expectedStageRequest } from "./audit.mjs";

let checks = 0;
const selectionCases = [{ itemId: "item_a" }, { itemId: "item_b" }];
assert.deepEqual(selectAuditCases(selectionCases, ["item_b", "item_a"]), [selectionCases[1], selectionCases[0]]); checks++;
for (const selected of [[], ["item_a", "item_a"], ["item_missing"]]) { assert.throws(() => selectAuditCases(selectionCases, selected)); checks++; }
const originalRequest = { plan: { marker: "original" }, options: { evaluationsPerRound: 20_000_000, randomSeed: 123 } };
assert.equal(expectedStageRequest(originalRequest, [{ key: "20000000" }]).options.evaluationsPerRound, 20_000_000); checks++;
assert.equal(expectedStageRequest(originalRequest, [{ key: "20000000" }, { key: "50000000" }]).options.evaluationsPerRound, 30_000_000); checks++;
assert.equal(originalRequest.options.evaluationsPerRound, 20_000_000); checks++;
assert.throws(() => expectedStageRequest(originalRequest, [{ key: "50000000" }])); checks++;
assert.equal(readAlgorithmVersion('// export const PLANNER_ALGORITHM_VERSION = "archived";\nexport const PLANNER_ALGORITHM_VERSION = "linear-search-7";'), "linear-search-7"); checks++;
assert.throws(() => readAlgorithmVersion('export const OTHER_VERSION = "missing";')); checks++;
assert.throws(() => readAlgorithmVersion('export const PLANNER_ALGORITHM_VERSION = unknown();')); checks++;
for (const [failed, succeeded, expected] of [[10, 0, false], [11, 11, false], [11, 10, true], [12, 13, false]]) {
  const rows = [
    ...Array.from({ length: failed }, () => ({ completed: true, cleanupPassed: true, firstPassed: true, secondPassed: false })),
    ...Array.from({ length: succeeded }, () => ({ completed: true, cleanupPassed: true, firstPassed: true, secondPassed: true })),
    { completed: false, cleanupPassed: true }, { completed: true, cleanupPassed: false },
  ];
  assert.deepEqual(failureStopDecision(rows, 10), { threshold: 10, succeeded, failed, shouldStop: expected }); checks++;
}
for (const value of [-1, 1.5, NaN, Infinity, "10"]) { assert.throws(() => failureStopDecision([], value)); checks++; }
for (const [expression, S, expected] of [["2S", 400, 800], ["ceil(S*2.5)", 401, 1003], ["Math.min(4900,3*S)", 2000, 4900],
  ["S <= 400 ? 2*S : S**2/400+S", 600, 1500], ["2*S + ceil(S*min(400,max(0,S-400))/400)", 680, 1836]]) {
  assert.equal(evaluateAreaFormula(parseAreaFormula(expression), S), expected); checks++;
}
for (const source of ["process.exit()", "S;globalThis.hacked=1", "(()=>S)()", "S.constructor", "Math.random()", "S=1", ""]) {
  assert.throws(() => parseAreaFormula(source)); checks++;
}
for (const source of ["S/0", "-S", "sqrt(-S)"]) { assert.throws(() => evaluateAreaFormula(parseAreaFormula(source), 400)); checks++; }
for (const first of [19_999_999, 20_000_000, 20_000_001]) {
  const result = measureMilestones({ areaHistory: [{ evaluatedProposals: first, bestArea: 100 }, { evaluatedProposals: 40_000_000, bestArea: 100 }, { evaluatedProposals: 50_000_000, bestArea: 99 }] });
  assert.equal(result.firstAttempts, first); assert.equal(result.firstPassed, first <= 20_000_000); assert.equal(result.secondAttempts, 50_000_000); checks++;
}
assert.throws(() => measureMilestones({ areaHistory: [{ evaluatedProposals: 0, bestArea: 100 }] })); checks++;
assert.equal(measureMilestones({ areaHistory: [] }).firstAttempts, null); checks++;

for (const formulaTree of [null, parseAreaFormula("2S")]) {
  const plugin = auditPlugin({ formulaTree });
  for (const path of ["src/main.tsx", "src/blueprint-planner/search-policy.ts"]) {
    const source = await readFile(resolve(ROOT, path), "utf8");
    const output = plugin.transform(source, resolve(ROOT, path));
    const result = ts.transpileModule(output.code, { reportDiagnostics: true,
      compilerOptions: { target: ts.ScriptTarget.ES2023, module: ts.ModuleKind.ESNext, jsx: ts.JsxEmit.ReactJSX } });
    assert.equal(result.diagnostics.filter(item => item.category === ts.DiagnosticCategory.Error).length, 0); checks++;
  }
  plugin.buildEnd();
}

await mkdir(WORK, { recursive: true });
const directory = await mkdtemp(resolve(WORK, "self-test-"));
try {
  const manifest = { runId: "sample", itemIds: ["item_test"], formula: "2S" };
  await writeHistory(manifest, [{ itemId: "item_test", name: '物品,"一"', firstAttempts: 123, secondAttempts: null, task: { largePayload: true } }], directory);
  const csv = await readFile(resolve(directory, "history/sample.csv"), "utf8");
  assert(csv.includes('"物品,""一"""')); assert(!csv.includes("largePayload"));
  assert.equal(csv.split("\n")[0], "itemId,itemName,firstAttempts,secondAttempts"); checks++;
  await writeFile(resolve(directory, "history/old.csv"), "old result");
  await mkdir(resolve(directory, "latest/tasks"), { recursive: true });
  await writeFile(resolve(directory, "latest/tasks/old.json"), "old task");
  // 同一轮恢复不轮换目录；新轮次只替换 latest，历史仍在。
  await rm(resolve(directory, "latest"), { recursive: true });
  assert.equal(await readFile(resolve(directory, "history/old.csv"), "utf8"), "old result"); checks++;
} finally { await rm(directory, { recursive: true, force: true }); }

/** 测试阶段编排的观察行为：模拟 Host 原子结算，不执行算法，也不启动浏览器。 */
const descriptors = { window: Object.getOwnPropertyDescriptor(globalThis, "window"), navigator: Object.getOwnPropertyDescriptor(globalThis, "navigator") };
try {
  for (const scenario of ["early-improvement", "late-first", "no-solution", "cleanup-export-failure", "cleanup-unsettled"]) {
    let count = 0, history = [], imports = 0, exports = 0;
    const progress = () => ({ evaluatedProposals: count, bestArea: history.at(-1)?.bestArea ?? null, areaHistory: history,
      validatedCandidateCount: history.length, activeWorkerCount: 0, status: "completed", initialArea: 200 });
    const result = () => !history.length ? null : { metrics: { area: history.at(-1).bestArea, width: history.at(-1).bestArea, height: 1 }, measuredOutputs: [{ itemId: "item_test", perMinute: 30 }] };
    const budgets = [];
    const host = { state: { activeTaskId: null }, queries: { exportDraft: request => ({ request, checkpoint: { evaluations: 0, randomSeed: 999 } }), getTask: progress, getResult: result,
      exportTask: () => {
        exports++;
        if (scenario === "cleanup-export-failure" && exports === 3) throw new Error("测试收尾导出失败");
        if (scenario === "cleanup-unsettled" && exports === 2) host.state.activeTaskId = "unsettled";
        return { checkpoint: { evaluations: count, randomSeed: 123 } };
      } }, actions: {
      importTask: async draft => { assert.equal(draft.checkpoint.randomSeed, 123); imports++; return "owned"; }, cancel: () => {},
      continuePlanning: (_id, budget) => {
        budgets.push(budget); count += budget;
        history = scenario === "early-improvement" ? [{ evaluatedProposals: 5_000_000, bestArea: 60 }, { evaluatedProposals: 10_000_000, bestArea: 50 }]
          : scenario === "late-first" && count === 50_000_000 ? [{ evaluatedProposals: 25_000_000, bestArea: 60 }, { evaluatedProposals: 40_000_000, bestArea: 50 }] : [];
      },
    } };
    Object.defineProperty(globalThis, "window", { configurable: true, value: { __edaAuditHost: { workspace: { blueprintPlanner: host }, blueprintPlannerDialog: { selectTask() {}, open() {} } } } });
    Object.defineProperty(globalThis, "navigator", { configurable: true, value: { gpu: { requestAdapter: async () => ({ info: { isFallbackAdapter: false } }) } } });
    const record = { itemId: "item_test", perMinute: 30, request: { options: { randomSeed: 123 } } };
    await browserScenario(record, measureMilestones);
    const deadline = Date.now() + 5000;
    while (!globalThis.window.__edaAudit.done && Date.now() < deadline) {
      const state = globalThis.window.__edaAudit;
      if (state.pending) state.acknowledged = state.pending;
      await new Promise(resolve => setTimeout(resolve, 10));
    }
    const state = globalThis.window.__edaAudit;
    if (scenario.startsWith("cleanup-")) {
      assert(state.done); assert.equal(state.phase, "done"); assert.equal(state.completed, false); assert.equal(state.errorKind, "runtime");
      assert(state.error.includes(scenario === "cleanup-export-failure" ? "测试收尾导出失败" : "取消未结算，禁止继续队列。"));
      assert.deepEqual(budgets, [20_000_000, 30_000_000]); assert.equal(imports, 1); checks++;
      continue;
    }
    assert.equal(state.error, null); assert(state.done && state.completed);
    assert.deepEqual(budgets, [20_000_000, 30_000_000]); assert.equal(imports, 1);
    assert.equal(state.progress.firstPassed, scenario === "early-improvement"); checks++;
  }
} finally {
  for (const [key, descriptor] of Object.entries(descriptors)) {
    if (descriptor) Object.defineProperty(globalThis, key, descriptor);
    else Reflect.deleteProperty(globalThis, key);
  }
}
console.log(JSON.stringify({ selfTestPassed: true, checks, browserStarted: false, searchEvaluations: 0 }));
