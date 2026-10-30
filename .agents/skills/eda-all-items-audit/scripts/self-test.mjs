import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, readFile, rm } from "node:fs/promises";
import { resolve, posix } from "node:path";
import ts from "typescript";
import { spawnSync } from "node:child_process";
import { ROOT, WORK, measureMilestones, writeHistory, failureStopDecision, selectAuditCases, saveJson, readJson, executionIdentity } from "./common.mjs";
import { parseAreaFormula, evaluateAreaFormula } from "./area-formula.mjs";
import { auditPlugin } from "./test-build.mjs";
import { browserScenario } from "./browser-scenario.mjs";
import { readAlgorithmVersion } from "./algorithm-source.mjs";
import { expectedStageRequest, assertCompletedStages } from "./audit.mjs";
import { acceptCollectedResult, readCollectedResult, replacePreparedRun } from "./result-retention.mjs";
import { reusableResult, reuseCompletedResults } from "./result-reuse.mjs";
import { selectClosedProductionPlan } from "./prepare.mjs";

let checks = 0;
const windowsPolicy = spawnSync("python3", ["-c", `
import ast,json,shutil,tempfile,re,time,os,traceback,functools,types,threading
from pathlib import Path
tree=ast.parse(Path('.agents/skills/eda-all-items-audit/scripts/windows-runner.py').read_text())
policy=[node for node in tree.body if isinstance(node,ast.FunctionDef) and node.name in ('should_cancel_search','operate','read','save','worker','execute')]
scope={'Path':Path,'json':json,'shutil':shutil,'re':re,'time':time,'os':os,'traceback':traceback,'verify_idle':lambda config:None}
exec(compile(ast.Module(body=policy,type_ignores=[]),'<windows-policy>','exec'),scope)
native_execute=scope['execute']
cancel=scope['should_cancel_search']
checks=0
for mode in (1,2,3,4):
    assert not cancel(mode,7500,False)
    assert cancel(mode,7501,False)==(mode not in (3,4))
    assert cancel(mode,86400,False)==(mode not in (3,4))
    assert cancel(mode,0,True)
    assert cancel(mode,86400,True)
    checks+=5
parent=Path('.temp/.trash/eda-all-items')
parent.mkdir(parents=True,exist_ok=True)
with tempfile.TemporaryDirectory(prefix='retention-',dir=parent) as temporary:
    root=Path(temporary)/'.temp/eda/all-items'
    latest=root/'latest'
    case=latest/'cases/item_test'
    scope['save'](case/'task.eda-task.json',{'evidence':True})
    config={'root':str(root)}
    try:
        scope['operate']('reset',config)
        raise AssertionError('reset deleted an uncollected case')
    except RuntimeError:
        assert (case/'task.eda-task.json').exists()
        checks+=1
    shutil.rmtree(case)
    scope['save'](latest/'summaries.json',[{'itemId':'item_test'}])
    try:
        scope['operate']('reset',config)
        raise AssertionError('reset deleted an unacknowledged summary')
    except RuntimeError:
        assert (latest/'summaries.json').exists()
        checks+=1
    scope['save'](latest/'acks/item_test.json',{'localVerified':True})
    assert scope['operate']('reset',config)=={'reset':True}
    assert not list(latest.iterdir())
    checks+=1
    scope['save'](latest/'config.json',{'runId':'target'})
    scope['save'](latest/'cases.json',[{'itemId':'item_test'}])
    reused={'itemId':'item_test','completed':True,'cleanupPassed':True,'reusedFrom':{'runId':'source'}}
    config.update(runId='target',rows=[reused])
    assert scope['operate']('reuse',config)=={'reused':['item_test']}
    assert scope['operate']('reuse',config)=={'reused':['item_test']}
    assert scope['read'](latest/'summaries.json')==[reused]
    assert scope['read'](latest/'acks/item_test.json')['localVerified']
    checks+=1
    scope['save'](latest/'summaries.json',[])
    scope['save'](latest/'cases.json',[{'itemId':item,'preparationError':False} for item in ('item_a','item_b')])
    profiles=[]
    def execute(config,record,number,directory):
        profiles.append(number)
        scope['save'](directory/'acks'/(record['itemId']+'.json'),{'localVerified':True})
        return dict(itemId=record['itemId'],completed=True,cleanupPassed=True,errorKind=None)
    scope['execute']=execute
    scope['worker']({'root':str(root),'browserAttemptOffset':1})
    assert profiles==[1,2]
    assert scope['read'](latest/'status.json')['phase']=='completed'
    checks+=1
    class Server:
        def __init__(self,*args,**kwargs): pass
        def serve_forever(self): pass
        def shutdown(self): pass
        def server_close(self): pass
    navigation={}
    def run_code(config,session,directory,code,name,timeout):
        if name=='navigate':
            navigation['navigate']=code
            raise RuntimeError('test: navigation failed before EDA import')
        if name=='settle-failure': navigation['settle']=code
        return None
    scope.update(http=types.SimpleNamespace(server=types.SimpleNamespace(ThreadingHTTPServer=Server)),functools=functools,
                 QuietHandler=object,threading=threading,assert_idle=lambda:None,port_open=lambda port:False,
                 processes=lambda:[],cli=lambda *args,**kwargs:None,run_code=run_code)
    record={'itemId':'item_navigation','name':'导航初始化','preparationError':None,'searchMode':4}
    result=native_execute({'port':4178},record,0,latest)
    assert not result['completed'] and result['cleanupPassed'] and 'test: navigation failed' in result['error']
    checks+=1
print(json.dumps({'checks':checks,'navigation':navigation}))
`], { cwd: ROOT, encoding: "utf8" });
assert.equal(windowsPolicy.status, 0, windowsPolicy.stderr);
checks += JSON.parse(windowsPolicy.stdout).checks;
const navigation = JSON.parse(windowsPolicy.stdout).navigation;
const navigationCalls = [];
const navigationPage = { goto: async (url, options) => { navigationCalls.push({ url, options }); },
  evaluate: async callback => callback(), waitForFunction: async callback => { assert.equal(callback(), true); } };
await new Function(`return (${navigation.navigate})`)()(navigationPage);
assert.deepEqual(navigationCalls, [{ url: "http://127.0.0.1:4178/", options: { waitUntil: "domcontentloaded", timeout: 120000 } }]); checks++;
const navigationWindow = Object.getOwnPropertyDescriptor(globalThis, "window");
try {
  Object.defineProperty(globalThis, "window", { configurable: true, value: {} });
  await new Function(`return (${navigation.settle})`)()(navigationPage); checks++;
  globalThis.window.__edaAudit = { done: false };
  globalThis.window.__edaAuditCancel = () => { globalThis.window.__edaAudit.done = true; };
  await new Function(`return (${navigation.settle})`)()(navigationPage); checks++;
} finally {
  if (navigationWindow) Object.defineProperty(globalThis, "window", navigationWindow);
  else Reflect.deleteProperty(globalThis, "window");
}
const controllerSource = ts.createSourceFile("controller.mjs", await readFile(resolve(ROOT, ".agents/skills/eda-all-items-audit/scripts/run.mjs"), "utf8"), ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
const controllerFunction = name => controllerSource.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === name).getText(controllerSource);
const remoteFactory = new Function("exec", "windows", "delay", "assert", `return (${controllerFunction("remotePython")})`);
let rpcCalls = 0;
const retryRpc = remoteFactory(async () => {
  rpcCalls++;
  if (rpcCalls < 3) throw new Error("exec request failed on channel 0");
  return { stdout: '{"ok":true}' };
}, { host: "mock-host", python: "python" }, async () => {}, assert);
assert.deepEqual(await retryRpc("read only", 1000, 3), { ok: true }); assert.equal(rpcCalls, 3); checks++;
rpcCalls = 0;
const singleRpc = remoteFactory(async () => { rpcCalls++; throw new Error("transport failed"); }, { host: "mock-host", python: "python" }, async () => {}, assert);
await assert.rejects(singleRpc("mutation"), /transport failed/); assert.equal(rpcCalls, 1); checks++;
let rpcAttempts;
const actionRpc = new Function("remotePython", "windows", "posix", `return (${controllerFunction("action")})`)(async (_code, _timeout, attempts) => { rpcAttempts = attempts; return {}; }, { tools: "D:/tools" }, posix);
await actionRpc("status", { runId: "test" }); assert.equal(rpcAttempts, 3); checks++;
await actionRpc("launch", { runId: "test" }); assert.equal(rpcAttempts, 1); checks++;
for (const value of ["0", "5", "2.5", "invalid"]) {
  const result = spawnSync(process.execPath, [resolve(ROOT, ".agents/skills/eda-all-items-audit/scripts/run.mjs"), "prepare", "--search-mode", value],
    { cwd: ROOT, encoding: "utf8" });
  assert.notEqual(result.status, 0); assert(result.stderr.includes("搜索模式必须为")); checks++;
}
const selectionCases = [{ itemId: "item_a" }, { itemId: "item_b" }];
assert.deepEqual(selectAuditCases(selectionCases, ["item_b", "item_a"]), [selectionCases[1], selectionCases[0]]); checks++;
for (const selected of [[], ["item_a", "item_a"], ["item_missing"]]) { assert.throws(() => selectAuditCases(selectionCases, selected)); checks++; }
const originalRequest = { plan: { marker: "original" }, options: { evaluationsPerRound: 20_000_000, randomSeed: 123 } };
const recipeIndex = { recipesByOutputItem: new Map([["item_component", [{ id: "loop" }, { id: "from-ore" }]]]) };
const recipeModel = { isRecipeExcludedFromProductionPlanningAuto: () => false };
let closedBuilds = 0;
const evaluateChoices = choices => ({
  result: choices.item_component === "from-ore" ? { unresolvedPerMinute: 0, cycleIssues: [] }
    : { unresolvedPerMinute: 30, cycleIssues: [{ itemIds: ["item_component"] }] },
  build: () => { assert.equal(choices.item_component, "from-ore"); closedBuilds++; return { recipes: [{ outputs: [{ itemId: "item_test" }] }] }; },
});
const selectedPlan = selectClosedProductionPlan("item_test", "target-recipe", { recipeChoices: {} }, recipeIndex, recipeModel, evaluateChoices);
assert(selectedPlan.passed); assert.equal(selectedPlan.choices.item_test, "target-recipe");
assert.equal(selectedPlan.choices.item_component, "from-ore"); assert.equal(closedBuilds, 1); checks++;
const lockedPlan = selectClosedProductionPlan("item_test", "target-recipe", { recipeChoices: { item_component: "loop" } }, recipeIndex, recipeModel, evaluateChoices);
assert(!lockedPlan.passed); assert.equal(lockedPlan.plan, null); assert.equal(closedBuilds, 1); checks++;
const unresolvedPlan = selectClosedProductionPlan("item_test", "target-recipe", { recipeChoices: {} }, recipeIndex, recipeModel, () => ({
  result: { unresolvedPerMinute: 1, cycleIssues: [] }, build: () => { throw new Error("未闭合方案不得进入 EDA 适配器"); },
}));
assert(!unresolvedPlan.passed); assert(unresolvedPlan.preparationError.includes("需求未闭合")); checks++;
assert.equal(expectedStageRequest(originalRequest, [{ key: "20000000" }]).options.evaluationsPerRound, 20_000_000); checks++;
assert.equal(expectedStageRequest(originalRequest, [{ key: "20000000", evaluatedProposals: 20_000_000 }, { key: "50000000" }]).options.evaluationsPerRound, 30_000_000); checks++;
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
for (const mode of [0, 5, "2", null, NaN]) { assert.throws(() => measureMilestones(null, mode)); checks++; }
for (const mode of [1, 2, 3, 4]) {
  const measured = measureMilestones({ areaHistory: [{ evaluatedProposals: 25_000_000, bestArea: 60 },
    { evaluatedProposals: 125_000_000, bestArea: 50 }] }, mode);
  assert.equal(measured.firstPassed, false); assert.equal(measured.secondPassed, [3, 4].includes(mode)); checks++;
}

const auditProgress = (evaluatedProposals, secondAttempts = null) => ({ evaluatedProposals, status: "completed",
  areaHistory: [{ evaluatedProposals: 5_000_000, bestArea: 60 },
    ...(secondAttempts === null ? [] : [{ evaluatedProposals: secondAttempts, bestArea: 50 }])] });
const auditStages = counts => counts.map((evaluatedProposals, index) => ({ key: String(index === 0 ? 20_000_000 : index * 50_000_000), evaluatedProposals }));
for (const [counts, second] of [[[10_000_123], 10_000_000], [[20_000_000], 20_000_000],
  [[20_000_000, 35_000_123], 35_000_000], [[20_000_000, 50_000_000], null], [[20_000_000, 50_000_000], 10_000_000]]) {
  assertCompletedStages(auditProgress(counts.at(-1), second), auditStages(counts)); checks++;
}
for (const [counts, second, total = counts.at(-1)] of [[[10_000_123], null], [[20_000_000], null],
  [[20_000_000, 35_000_123], null], [[20_000_000, 50_000_001], 35_000_000],
  [[10_000_123, 35_000_123], 10_000_000], [[20_000_001], 10_000_000],
  [[10_000_123], 10_000_124], [[10_000_123], 10_000_000, 10_000_124]]) {
  assert.throws(() => assertCompletedStages(auditProgress(total, second), auditStages(counts))); checks++;
}
assert.throws(() => assertCompletedStages({ ...auditProgress(10_000_123, 10_000_000), status: "failed" }, auditStages([10_000_123]))); checks++;
assertCompletedStages(auditProgress(50_000_000, 10_000_000), auditStages([20_000_000, 50_000_000]), 1); checks++;
assert.throws(() => assertCompletedStages(auditProgress(10_000_123, 10_000_000), auditStages([10_000_123]), 1)); checks++;
for (const second of [125_000_000, 150_000_000]) {
  const counts = [20_000_000, 50_000_000, 100_000_000, second + (second === 125_000_000 ? 123 : 0)];
  assertCompletedStages(auditProgress(counts.at(-1), second), auditStages(counts), 3);
  assert.equal(expectedStageRequest(originalRequest, auditStages(counts), 3).options.evaluationsPerRound, 50_000_000);
  assert.throws(() => assertCompletedStages(auditProgress(counts.at(-1), second), auditStages(counts), 2)); checks++;
}
assert.throws(() => assertCompletedStages(auditProgress(50_000_000), auditStages([20_000_000, 50_000_000]), 3)); checks++;
assert.throws(() => expectedStageRequest(originalRequest, [{ key: "20000000" }, { key: "50000000" }, { key: "150000000" }], 3)); checks++;
assertCompletedStages(auditProgress(50_000_000, 10_000_000), auditStages([20_000_000, 50_000_000]), 4); checks++;
assertCompletedStages(auditProgress(75_000_123, 75_000_000), auditStages([20_000_000, 50_000_000, 75_000_123]), 4); checks++;
assert.throws(() => assertCompletedStages(auditProgress(10_000_123, 10_000_000), auditStages([10_000_123]), 4)); checks++;
assert.throws(() => assertCompletedStages(auditProgress(50_000_000), auditStages([20_000_000, 50_000_000]), 4)); checks++;
const retainedStages = [{ key: "20000000", evaluatedProposals: 19_997_000, unspentEvaluations: 3000 },
  { key: "50000000", evaluatedProposals: 49_996_000, unspentEvaluations: 4000 },
  { key: "100000000", evaluatedProposals: 50_100_123, unspentEvaluations: 0 }];
assertCompletedStages(auditProgress(50_100_123, 10_000_000), retainedStages, 4); checks++;
assert.equal(expectedStageRequest(originalRequest, retainedStages, 4).options.evaluationsPerRound, 50_004_000); checks++;
assert.throws(() => assertCompletedStages(auditProgress(49_996_000, 10_000_000), retainedStages.slice(0, 2), 4)); checks++;
assertCompletedStages({ evaluatedProposals: 49_996_000, status: "completed", areaHistory: [] }, retainedStages.slice(0, 2), 2); checks++;
assert.throws(() => assertCompletedStages(auditProgress(50_100_123, 10_000_000), [{ ...retainedStages[0], unspentEvaluations: 3001 }, ...retainedStages.slice(1)], 4)); checks++;
const identityManifest = { algorithmVersion: "same-label" };
const identityFiles = { "src/blueprint-planner/example.ts": "algorithm-a", "src/registry/example.ts": "registry-a", ".agents/skills/example": "controller-a" };
const identity = executionIdentity(identityManifest, identityFiles);
assert.equal(identity, executionIdentity(identityManifest, { ...identityFiles, ".agents/skills/example": "controller-b" })); checks++;
assert.notEqual(identity, executionIdentity(identityManifest, { ...identityFiles, "src/blueprint-planner/example.ts": "algorithm-b" })); checks++;
assert.notEqual(identity, executionIdentity(identityManifest, { ...identityFiles, "src/registry/example.ts": "registry-b" })); checks++;

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
  for (const searchMode of [1, 2, 3, 4]) {
    await writeHistory({ ...manifest, searchMode }, [], directory);
    const meta = JSON.parse(await readFile(resolve(directory, "history/sample.meta.json"), "utf8"));
    assert.equal(meta.searchMode, searchMode); assert.equal(meta.totalLimit, [3, 4].includes(searchMode) ? null : 50_000_000); checks++;
  }
  await writeFile(resolve(directory, "history/old.csv"), "old result");
  await mkdir(resolve(directory, "latest/tasks"), { recursive: true });
  await writeFile(resolve(directory, "latest/tasks/old.json"), "old task");
  // 同一轮恢复不轮换目录；新轮次只替换 latest，历史仍在。
  // AI-CORRECTION 2026-10-30：直接 rm 的模拟已删除，改为调用真实轮换流程验证逐物品保留。
  // AI-REMOVED 2026-10-30:
  // Reason: 手动删除目录的自检无法验证实际保留逻辑。
  // Trigger: 用户要求新结果落盘后再逐物品删除旧结果。
  // Evidence: 原自检未调用 prepare 的实际轮换实现。
  // Replacement: 下方 replacePreparedRun 与 acceptCollectedResult 行为测试。
  // Risk: Low
  // Human Review: Required
  // Original code:
  // await rm(resolve(directory, "latest"), { recursive: true });
  const oldManifest = { runId: "old", itemIds: ["item_a", "item_b", "item_c"], algorithmVersion: "test-algorithm", searchMode: 2 };
  const input = itemId => ({ itemId, searchMode: 2, request: { options: { randomSeed: 123 } } });
  const summary = (itemId, extra = {}) => ({ itemId, searchMode: 2, completed: true, cleanupPassed: true, ...extra });
  const task = { algorithmVersion: "test-algorithm", checkpoint: { randomSeed: 123 } };
  await saveJson(resolve(directory, "latest/manifest.json"), oldManifest);
  await saveJson(resolve(directory, "latest/runtime/cases.json"), oldManifest.itemIds.map(input));
  // item_c 模拟回收后、成绩表写入前退出，仍须保留其已结算证据。
  await saveJson(resolve(directory, "latest/rows.json"), oldManifest.itemIds.slice(0, 2).map(id => summary(id)));
  for (const id of oldManifest.itemIds) {
    await saveJson(resolve(directory, "latest/runtime/collected", id, "summary.json"), summary(id));
    await saveJson(resolve(directory, "latest/tasks", `${id}.eda-task.json`), task);
  }
  const newManifest = { ...oldManifest, runId: "new" };
  const staging = resolve(directory, "prepared");
  await saveJson(resolve(staging, "manifest.json"), newManifest);
  await saveJson(resolve(staging, "runtime/cases.json"), newManifest.itemIds.map(input));
  await replacePreparedRun(staging, directory);
  const current = id => readJson(resolve(directory, "results", id, "current.json"));
  for (const id of oldManifest.itemIds) {
    assert.equal((await current(id)).runId, "old");
    const old = await readCollectedResult(oldManifest, id, directory);
    assert.deepEqual(await readJson(resolve(old.directory, "task.eda-task.json")), task);
    assert.deepEqual(await readJson(resolve(old.directory, "input.json")), input(id));
    assert.equal(await readCollectedResult(newManifest, id, directory), null); checks++;
  }
  const incoming = async (itemId, row = summary(itemId), payload = task) => {
    const source = resolve(directory, "latest/runtime/collected", itemId);
    await rm(source, { recursive: true, force: true });
    await saveJson(resolve(source, "summary.json"), row);
    if (payload !== null) await saveJson(resolve(source, "task.eda-task.json"), payload);
    return source;
  };
  const incomplete = summary("item_a", { completed: false, errorKind: "runtime" });
  const incompleteSource = await incoming("item_a", incomplete);
  await acceptCollectedResult(newManifest, input("item_a"), incomplete, incompleteSource, "verified", directory);
  assert.equal((await current("item_a")).runId, "old");
  assert.deepEqual((await readCollectedResult(newManifest, "item_a", directory)).summary, incomplete); checks++;
  const dirty = summary("item_a", { cleanupPassed: false });
  await acceptCollectedResult(newManifest, input("item_a"), dirty, await incoming("item_a", dirty), "verified", directory);
  assert.equal((await current("item_a")).runId, "old"); checks++;
  const a = summary("item_a");
  for (const payload of [null, { ...task, algorithmVersion: "wrong" }, { ...task, checkpoint: { randomSeed: 456 } }]) {
    const source = await incoming("item_a", a, payload);
    await assert.rejects(acceptCollectedResult(newManifest, input("item_a"), a, source, "verified", directory));
    assert.equal((await current("item_a")).runId, "old"); checks++;
  }
  // 模拟新证据已迁入、当前指针写入前中断：旧指针仍有效，重入从候选证据完成发布。
  const blocker = resolve(directory, "results/item_a/current.json.new");
  await mkdir(blocker);
  await assert.rejects(acceptCollectedResult(newManifest, input("item_a"), a, await incoming("item_a"), "verified", directory));
  assert.equal((await current("item_a")).runId, "old");
  let recovered = await readCollectedResult(newManifest, "item_a", directory);
  assert.deepEqual(recovered.summary, a); checks++;
  await rm(blocker, { recursive: true });
  // 模拟指针切换后清理失败：新结果可用，旧结果还在；再次调用完成清理。
  // AI-CORRECTION 2026-10-30：先核验旧证据归属，再切换指针；旧 receipt 已被部分删除时依靠待删除记录恢复。
  const oldReceipt = resolve(directory, "results/item_a/old/receipt.json");
  const receipt = await readJson(oldReceipt);
  await saveJson(oldReceipt, { ...receipt, itemId: "unknown" });
  await assert.rejects(acceptCollectedResult(newManifest, input("item_a"), a, recovered.directory, "verified", directory));
  assert.equal((await current("item_a")).runId, "old");
  assert.equal((await current("item_b")).runId, "old"); checks++;
  await saveJson(oldReceipt, receipt);
  await saveJson(resolve(directory, "results/item_a/current.json"), {
    formatVersion: 1, runId: "new", itemId: "item_a", pendingRemoval: ["old"],
  });
  await rm(oldReceipt);
  assert.deepEqual(await readJson(resolve(directory, "results/item_a/old/task.eda-task.json")), task); checks++;
  await acceptCollectedResult(newManifest, input("item_a"), a, recovered.directory, "verified", directory);
  assert.equal((await current("item_a")).runId, "new");
  await assert.rejects(readJson(oldReceipt), { code: "ENOENT" });
  assert.equal((await current("item_b")).runId, "old"); checks++;
  recovered = await readCollectedResult(newManifest, "item_a", directory);
  await writeFile(resolve(recovered.directory, "task.eda-task.json"), "corrupted");
  await assert.rejects(readCollectedResult(newManifest, "item_a", directory), /回收任务已损坏/); checks++;
  await saveJson(resolve(recovered.directory, "task.eda-task.json"), task);
  const rejected = summary("item_b", { errorKind: "request-rejected" });
  await acceptCollectedResult(newManifest, input("item_b"), rejected, await incoming("item_b", rejected, null), "verified", directory);
  assert.equal((await current("item_b")).runId, "new");
  await assert.rejects(readJson(resolve(directory, "results/item_b/old/summary.json")), { code: "ENOENT" }); checks++;
  // 连续准备新轮次但尚无新成绩时，已保留结果与历史都不变。
  const next = { ...newManifest, runId: "next", itemIds: ["item_a"] };
  await saveJson(resolve(staging, "manifest.json"), next);
  await saveJson(resolve(staging, "runtime/cases.json"), [input("item_a")]);
  await replacePreparedRun(staging, directory);
  assert.equal((await current("item_a")).runId, "new");
  assert.equal((await current("item_b")).runId, "new"); checks++;
  assert.equal((await current("item_c")).runId, "old"); checks++;
  assert.equal(await readFile(resolve(directory, "history/old.csv"), "utf8"), "old result"); checks++;
} finally { await rm(directory, { recursive: true, force: true }); }

const reuseDirectory = await mkdtemp(resolve(WORK, "reuse-self-test-"));
try {
  const input = { itemId: "item_test", perMinute: 30, searchMode: 4, request: originalRequest };
  const source = { runId: "source", algorithmVersion: "reuse-algorithm", itemIds: [input.itemId], searchMode: 4 };
  source.executionIdentity = executionIdentity(source, {});
  const progress = { ...auditProgress(50_000_000, 10_000_000), activeWorkerCount: 0, initialArea: 200 };
  const stages = auditStages([20_000_000, 50_000_000]);
  const task = { algorithmVersion: source.algorithmVersion, request: expectedStageRequest(originalRequest, stages, 4),
    checkpoint: { evaluations: 50_000_000, randomSeed: 123 }, progress };
  const summary = { itemId: input.itemId, name: "复用样例", searchMode: 4, completed: true, cleanupPassed: true, area: { S: 100, area: 200 },
    ...measureMilestones(progress, 4), stages };
  const target = { ...source, runId: "target", searchMode: 2, reuseCandidates: [input.itemId] };
  const targetInput = { ...input, searchMode: 2 };
  assert(reusableResult(target, targetInput, source, input, summary, task, { taskSha256: "test" })); checks++;
  for (const incompatible of [{ ...target, executionIdentity: "different-source" }, { ...target, algorithmVersion: "different-version" },
    { ...target, formulaTree: { kind: "different-formula" } }]) {
    assert.equal(reusableResult(incompatible, targetInput, source, input, summary, task, {}), null); checks++;
  }
  assert.equal(reusableResult(target, { ...targetInput, perMinute: 60 }, source, input, summary, task, {}), null); checks++;
  const lateProgress = { ...auditProgress(75_000_123, 75_000_000), activeWorkerCount: 0, initialArea: 200 };
  const lateStages = auditStages([20_000_000, 50_000_000, 75_000_123]);
  const lateTask = { ...task, request: expectedStageRequest(originalRequest, lateStages, 4), checkpoint: { ...task.checkpoint, evaluations: 75_000_123 }, progress: lateProgress };
  const lateSummary = { ...summary, ...measureMilestones(lateProgress, 4), stages: lateStages };
  assert.equal(reusableResult(target, targetInput, source, input, lateSummary, lateTask, {}), null); checks++;
  assert(reusableResult({ ...target, searchMode: 3 }, targetInput, source, input, lateSummary, lateTask, {})); checks++;
  const beyondProgress = { ...lateProgress, areaHistory: progress.areaHistory };
  const beyondTask = { ...lateTask, progress: beyondProgress };
  const beyondSummary = { ...lateSummary, ...measureMilestones(beyondProgress, 4) };
  const beyondReuse = reusableResult(target, targetInput, source, input, beyondSummary, beyondTask, {});
  assert.equal(beyondReuse.reusedFrom.searchMode, 4);
  assert.equal(beyondReuse.stages.at(-1).evaluatedProposals, 75_000_123); checks++;
  const incoming = resolve(reuseDirectory, "incoming");
  await saveJson(resolve(incoming, "summary.json"), summary);
  await saveJson(resolve(incoming, "task.eda-task.json"), task);
  await acceptCollectedResult(source, input, summary, incoming, "verified", reuseDirectory);
  await saveJson(resolve(reuseDirectory, "latest/manifest.json"), target);
  await saveJson(resolve(reuseDirectory, "latest/runtime/cases.json"), [targetInput]);
  await saveJson(resolve(reuseDirectory, "latest/runtime/source-fingerprint.json"), {});
  // 远端同步失败后，本地引用和真实次数仍保留；重入同步已有复用记录，不再发起冷启动。
  await assert.rejects(reuseCompletedResults(target, { summaries: [] }, async () => { throw new Error("同步中断"); }, reuseDirectory), /同步中断/); checks++;
  const collected = await readCollectedResult(target, input.itemId, reuseDirectory);
  assert.equal(collected.summary.reusedFrom.runId, "source");
  assert.equal(collected.summary.searchMode, 2);
  assert.deepEqual(await readJson(resolve(collected.directory, "summary.json")), summary); checks++;
  let synchronized = 0;
  assert.deepEqual(await reuseCompletedResults(target, { summaries: [] }, async (command, manifest, extra) => {
    assert.equal(command, "reuse"); assert.equal(manifest.runId, "target"); assert.deepEqual(extra.rows, [collected.summary]); synchronized++;
  }, reuseDirectory), [input.itemId]);
  assert.equal(synchronized, 1);
  assert.equal((await readJson(resolve(reuseDirectory, "latest/rows.json"))).length, 1); checks++;
  assert.deepEqual(await reuseCompletedResults(target, { summaries: [collected.summary] }, async () => { throw new Error("不应重复同步"); }, reuseDirectory), []); checks++;
  const prepared = resolve(reuseDirectory, "prepared");
  await saveJson(resolve(prepared, "manifest.json"), { ...target, runId: "next", reusedItems: [] });
  await replacePreparedRun(prepared, reuseDirectory);
  assert.equal((await readJson(resolve(reuseDirectory, "results/item_test/current.json"))).runId, "source");
  assert.deepEqual(await readJson(resolve(collected.directory, "task.eda-task.json")), task); checks++;
} finally { await rm(reuseDirectory, { recursive: true, force: true }); }

/** 测试阶段编排的观察行为：模拟 Host 原子结算，不执行算法，也不启动浏览器。 */
const descriptors = { window: Object.getOwnPropertyDescriptor(globalThis, "window"), navigator: Object.getOwnPropertyDescriptor(globalThis, "navigator"),
  performance: Object.getOwnPropertyDescriptor(globalThis, "performance") };
const realPerformance = globalThis.performance;
try {
  for (const searchMode of [1, 2, 3, 4]) {
    for (const scenario of ["early-improvement", "late-improvement", "late-first", "boundary-first", "boundary-total", "same-area",
      "no-solution", "user-cancel", "interrupted-without-improvement", "cleanup-export-failure", "cleanup-unsettled", "wall-clock-limit",
      "extended-improvement", "extended-boundary", "extended-user-cancel", "beyond-wall-clock", "retained-budget"]) {
      const extended = scenario.startsWith("extended-");
      if (scenario === "retained-budget" && searchMode !== 4) continue;
      if (![3, 4].includes(searchMode) && (extended || scenario === "beyond-wall-clock")) continue;
      if ([3, 4].includes(searchMode) && ["no-solution", "same-area", "cleanup-export-failure", "cleanup-unsettled", "wall-clock-limit"].includes(scenario)) continue;
      let count = 0, history = [], imports = 0, exports = 0, cancellations = 0, settling = false, naturalCompletion = null, retained = 0;
      let clockOffset = 0;
      const timers = [];
      const progress = () => ({ evaluatedProposals: count, bestArea: history.at(-1)?.bestArea ?? null, areaHistory: history,
        validatedCandidateCount: history.length, activeWorkerCount: host.state.activeTaskId === "owned" ? 24 : 0,
        status: "completed", initialArea: 200 });
      const result = () => !history.length ? null : { metrics: { area: history.at(-1).bestArea, width: history.at(-1).bestArea, height: 1 }, measuredOutputs: [{ itemId: "item_test", perMinute: 30 }] };
      const budgets = [];
      const host = { state: { activeTaskId: null }, queries: { exportDraft: request => ({ request, checkpoint: { evaluations: 0, randomSeed: 999 } }), getTask: progress, getResult: result,
        exportTask: () => {
          exports++;
          if (scenario === "cleanup-export-failure" && exports === 3) throw new Error("测试收尾导出失败");
          if (scenario === "cleanup-unsettled" && exports === 2) host.state.activeTaskId = "unsettled";
          return { checkpoint: { evaluations: count, randomSeed: 123, unspentEvaluations: retained } };
        } }, actions: {
        importTask: async draft => { assert.equal(draft.checkpoint.randomSeed, 123); imports++; return "owned"; },
        cancel: id => {
          assert.equal(id, "owned"); cancellations++;
          if (host.state.activeTaskId !== "owned" || settling) return;
          settling = true;
          clearTimeout(naturalCompletion);
          // 模拟取消后仍在途的 123 次评估；导出只能发生在这些工作结算后。
          timers.push(setTimeout(() => { count += 123; host.state.activeTaskId = null; }, 10));
        },
        continuePlanning: (_id, budget) => {
          budgets.push(budget);
          const end = count + budget;
          if (scenario === "retained-budget") {
            history = [{ evaluatedProposals: 5_000_000, bestArea: 60 }, { evaluatedProposals: 10_000_000, bestArea: 50 }];
            if (budgets.length === 1) { count = 19_997_000; retained = 3000; return; }
            if (budgets.length === 2) { assert.equal(budget, 30_000_000); count = 49_996_000; retained = 4000; return; }
            assert.equal(budget, 50_000_000); retained = 0; host.state.activeTaskId = "owned";
            timers.push(setTimeout(() => { count = 50_100_000; }, 10));
            naturalCompletion = setTimeout(() => { count = 100_000_000; host.state.activeTaskId = null; }, 1000);
            timers.push(naturalCompletion); return;
          }
          if ((scenario === "early-improvement" && budgets.length === 1) || scenario === "late-improvement" && budgets.length === 2
            || scenario === "late-first" && budgets.length === 2 || scenario === "user-cancel" || scenario === "interrupted-without-improvement"
            || ["wall-clock-limit", "beyond-wall-clock"].includes(scenario) && (searchMode !== 4 || budgets.length === 1)
            || ["extended-improvement", "extended-user-cancel"].includes(scenario) && budgets.length === 4) {
            host.state.activeTaskId = "owned";
            if (["wall-clock-limit", "beyond-wall-clock"].includes(scenario)) clockOffset = 7_500_000;
            timers.push(setTimeout(() => {
              if (scenario === "wall-clock-limit") return;
              if (scenario === "user-cancel") { globalThis.window.__edaAuditCancel(); return; }
              if (scenario === "extended-user-cancel") { count = 125_000_000; globalThis.window.__edaAuditCancel(); return; }
              if (scenario === "interrupted-without-improvement") { count = 3_000_000; host.state.activeTaskId = null; return; }
              count = ["early-improvement", "beyond-wall-clock"].includes(scenario) ? 10_000_000
                : scenario === "late-first" ? 40_000_000 : extended ? 125_000_000 : 35_000_000;
              history = [{ evaluatedProposals: scenario === "late-first" ? 25_000_000 : 5_000_000, bestArea: 60 },
                { evaluatedProposals: count, bestArea: 50 }];
            }, 10));
            naturalCompletion = setTimeout(() => { count = end; host.state.activeTaskId = null; }, 1000);
            timers.push(naturalCompletion);
            return;
          }
          count = end;
          if (["late-improvement", "boundary-first", "boundary-total", "same-area"].includes(scenario) || extended) {
            history = [{ evaluatedProposals: 5_000_000, bestArea: 60 }];
            if (scenario === "same-area" || scenario === "boundary-first" || scenario === "boundary-total" && budgets.length === 2) {
              history.push({ evaluatedProposals: scenario === "same-area" ? 10_000_000 : scenario === "boundary-first" ? 20_000_000 : count,
                bestArea: scenario === "same-area" ? 60 : 50 });
            }
            if (scenario === "extended-boundary" && budgets.length === 4) history.push({ evaluatedProposals: count, bestArea: 50 });
          }
        },
      } };
      Object.defineProperty(globalThis, "window", { configurable: true, value: { __edaAuditHost: { workspace: { blueprintPlanner: host }, blueprintPlannerDialog: { selectTask() {}, open() {} } } } });
      Object.defineProperty(globalThis, "navigator", { configurable: true, value: { gpu: { requestAdapter: async () => ({ info: { isFallbackAdapter: false } }) } } });
      Object.defineProperty(globalThis, "performance", { configurable: true, value: { now: () => realPerformance.now() + clockOffset } });
      const record = { itemId: "item_test", perMinute: 30, searchMode, request: { options: { randomSeed: 123 } } };
      try {
        await browserScenario(record, measureMilestones);
        const deadline = Date.now() + 5000;
        while (!globalThis.window.__edaAudit.done && Date.now() < deadline) {
          const state = globalThis.window.__edaAudit;
          if (state.pending) state.acknowledged = state.pending;
          await new Promise(resolve => setTimeout(resolve, 10));
        }
        const state = globalThis.window.__edaAudit;
        if (["user-cancel", "extended-user-cancel", "interrupted-without-improvement", "wall-clock-limit"].includes(scenario)) {
          assert(state.done && !state.completed);
          assert.equal(state.cancelled, scenario.endsWith("user-cancel"));
          assert.equal(state.errorKind, scenario.endsWith("user-cancel") ? null : "runtime");
          assert.deepEqual(budgets, extended ? [20_000_000, 30_000_000, 50_000_000, 50_000_000] : [20_000_000]);
          assert.equal(imports, 1); checks++;
          continue;
        }
        if (scenario.startsWith("cleanup-")) {
          assert(state.done); assert.equal(state.phase, "done"); assert.equal(state.completed, false); assert.equal(state.errorKind, "runtime");
          assert(state.error.includes(scenario === "cleanup-export-failure" ? "测试收尾导出失败" : "取消未结算，禁止继续队列。"));
          assert.deepEqual(budgets, [20_000_000, 30_000_000]); assert.equal(imports, 1); checks++;
          continue;
        }
        assert.equal(state.error, null); assert(state.done && state.completed);
        assert.deepEqual(budgets, scenario === "retained-budget" ? [20_000_000, 30_000_000, 50_000_000] : extended ? [20_000_000, 30_000_000, 50_000_000, 50_000_000]
          : [2, 3].includes(searchMode) && ["early-improvement", "boundary-first", "beyond-wall-clock"].includes(scenario) ? [20_000_000] : [20_000_000, 30_000_000]); assert.equal(imports, 1);
        assert.equal(state.progress.firstPassed, ["early-improvement", "late-improvement", "boundary-first", "boundary-total", "same-area", "beyond-wall-clock", "retained-budget"].includes(scenario) || extended);
        assert.equal(state.cancelled, false);
        const stopped = scenario === "retained-budget" ? 50_100_123 : searchMode === 1 || searchMode === 4 && !extended ? undefined : { "early-improvement": 10_000_123, "late-improvement": 35_000_123,
          "late-first": 40_000_123, "beyond-wall-clock": 10_000_123, "extended-improvement": 125_000_123 }[scenario];
        assert.equal(state.progress.evaluatedProposals, stopped ?? (extended ? 150_000_000 : scenario === "boundary-first" && [2, 3].includes(searchMode) ? 20_000_000 : 50_000_000));
        assert.equal(cancellations, stopped ? 1 : 0);
        assert.equal(state.progress.secondAttempts, { "early-improvement": 10_000_000, "late-improvement": 35_000_000,
          "late-first": 40_000_000, "boundary-first": 20_000_000, "boundary-total": 50_000_000, "beyond-wall-clock": 10_000_000,
          "extended-improvement": 125_000_000, "extended-boundary": 150_000_000, "retained-budget": 10_000_000 }[scenario] ?? null);
        assertCompletedStages({ ...progress(), areaHistory: history }, state.stages, searchMode);
        assert.equal(state.progress.secondPassed, measureMilestones(progress(), searchMode).secondPassed);
        assert.equal(expectedStageRequest(originalRequest, state.stages, searchMode).options.evaluationsPerRound,
          budgets.at(-1) + (state.stages.at(-2)?.unspentEvaluations ?? 0)); checks++;
      } finally { for (const timer of timers) clearTimeout(timer); }
    }
  }
} finally {
  for (const [key, descriptor] of Object.entries(descriptors)) {
    if (descriptor) Object.defineProperty(globalThis, key, descriptor);
    else Reflect.deleteProperty(globalThis, key);
  }
}
console.log(JSON.stringify({ selfTestPassed: true, checks, browserStarted: false, searchEvaluations: 0 }));
