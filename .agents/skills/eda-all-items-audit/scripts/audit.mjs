import assert from "node:assert/strict";
import { resolve } from "node:path";
import { LATEST, readJson, measureMilestones, writeHistory } from "./common.mjs";
import { evaluateAreaFormula } from "./area-formula.mjs";

/** continuePlanning 会将请求中的每轮额度更新为本阶段额度，物料需求和其余设置仍严格比对。 */
export function expectedStageRequest(request, stages) {
  assert(stages.length >= 1 && stages.length <= 2, "阶段记录数量无效。");
  assert.deepEqual(stages.map(stage => stage.key), ["20000000", "50000000"].slice(0, stages.length), "阶段次序无效。");
  return { ...request, options: { ...request.options, evaluationsPerRound: stages.length === 2 ? 30_000_000 : 20_000_000 } };
}

/** 从最新原生任务独立复核历史计数；搜索不达标与执行未完成分别报告。 */
export async function audit() {
  const manifest = await readJson(resolve(LATEST, "manifest.json"));
  const cases = await readJson(resolve(LATEST, "runtime/cases.json"));
  const rows = await readJson(resolve(LATEST, "rows.json"));
  const ids = new Set();
  for (const row of rows) {
    assert(!ids.has(row.itemId), `重复物品：${row.itemId}`); ids.add(row.itemId);
    const input = cases.find(item => item.itemId === row.itemId);
    assert(input, `结果包含清单外物品：${row.itemId}`);
    assert(row.cleanupPassed, `${row.itemId} 清理未通过。`);
    if (input.preparationError || row.errorKind === "request-rejected") {
      assert.equal(row.firstAttempts, null); assert.equal(row.secondAttempts, null);
      continue;
    }
    const task = await readJson(resolve(LATEST, "tasks", `${row.itemId}.eda-task.json`));
    assert.equal(task.algorithmVersion, manifest.algorithmVersion);
    assert.deepEqual(task.request, expectedStageRequest(input.request, row.stages), "物料请求或阶段预算发生变化。");
    assert.equal(task.checkpoint.randomSeed, input.request.options.randomSeed);
    assert.equal(task.progress.activeWorkerCount, 0);
    assert.equal(task.checkpoint.evaluations, task.progress.evaluatedProposals);
    for (const [key, value] of Object.entries(measureMilestones(task.progress))) assert.equal(row[key], value, `${row.itemId}.${key}`);
    if (row.completed) {
      assert.equal(task.progress.evaluatedProposals, 50_000_000);
      assert.deepEqual(row.stages.map(stage => stage.evaluatedProposals), [20_000_000, 50_000_000]);
    }
    if (manifest.formulaTree) assert.equal(task.progress.initialArea, evaluateAreaFormula(manifest.formulaTree, row.area.S));
    else assert.equal(task.progress.initialArea, row.area.area);
    const best = task.checkpoint.best;
    if (best) {
      assert.equal(best.report.engineKind, "dense-v2");
      const result = task.checkpoint.result;
      assert(result.measuredOutputs.some(flow => flow.itemId === row.itemId && flow.perMinute >= input.perMinute - 1e-6));
      assert.equal(result.metrics.area, task.progress.bestArea);
      assert.equal(result.metrics.area, result.metrics.width * result.metrics.height);
      assert(result.metrics.width <= 70 && result.metrics.height <= 70);
    }
  }
  assert.deepEqual(cases.map(item => item.itemId), manifest.itemIds);
  await writeHistory(manifest, rows);
  return { audited: rows.length, total: cases.length, executionComplete: rows.length === cases.length && rows.every(row => row.completed),
    firstPassed: rows.filter(row => row.firstPassed).length, secondPassed: rows.filter(row => row.firstPassed && row.secondPassed).length };
}
