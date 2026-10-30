import assert from "node:assert/strict";
import { resolve } from "node:path";
import { LATEST, readJson, measureMilestones, writeHistory } from "./common.mjs";
import { evaluateAreaFormula } from "./area-formula.mjs";
import { readCollectedResult } from "./result-retention.mjs";

/** continuePlanning 会将请求中的每轮额度更新为本阶段额度，物料需求和其余设置仍严格比对。 */
export function expectedStageRequest(request, stages, searchMode = 2) {
  assert([1, 2, 3, 4].includes(searchMode), "搜索模式必须为 1、2、3 或 4。");
  assert(stages.length >= 1 && ([3, 4].includes(searchMode) || stages.length <= 2), "阶段记录数量无效。");
  assert.deepEqual(stages.map(stage => stage.key), stages.map((_stage, index) => String(index === 0 ? 20_000_000 : index * 50_000_000)), "阶段次序无效。");
  const index = stages.length - 1, previous = index === 0 ? 0 : stages[index - 1].evaluatedProposals;
  assert(Number.isSafeInteger(previous) && previous >= 0, "阶段缺少真实累计计数。");
  const limit = index === 0 ? 20_000_000 : index * 50_000_000;
  return { ...request, options: { ...request.options, evaluationsPerRound: limit - previous } };
}

/** 允许次解后的已结算提前结束；未找到次解仍须完整消耗 50M，原有满额结果继续可审计。 */
// AI-CORRECTION 2026-10-30：模式 1 必须满额，模式 2 可在次解后提前结束，模式 3 必须找到次解且允许超过 50M。
// AI-CORRECTION 2026-10-30：模式 4 必须累计至少 50M 且找到次解，之后可在任意追加阶段提前结算。
// AI-CORRECTION 2026-10-30：完整搜索批次留下的尾额不算已执行；阶段以实际次数加保留尾额守恒，模式 4 的最低次数只看实际执行。
export function assertCompletedStages(progress, stages, searchMode = 2) {
  assert([1, 2, 3, 4].includes(searchMode), "搜索模式必须为 1、2、3 或 4。");
  assert(stages.length >= 1 && ([3, 4].includes(searchMode) || stages.length <= 2), "阶段记录数量无效。");
  let previous = 0, accounted = 0;
  for (const [index, stage] of stages.entries()) {
    const limit = index === 0 ? 20_000_000 : index * 50_000_000;
    assert.equal(stage.key, String(limit), "阶段次序无效。");
    const unspent = stage.unspentEvaluations ?? 0;
    assert(Number.isSafeInteger(unspent) && unspent >= 0, "阶段保留尾额无效。");
    accounted = stage.evaluatedProposals + unspent;
    assert(Number.isSafeInteger(stage.evaluatedProposals) && stage.evaluatedProposals >= previous
      && accounted <= limit, "阶段累计计数超出预算或未前进。");
    if (index < stages.length - 1) assert.equal(accounted, limit, "非最终阶段预算不守恒。");
    previous = stage.evaluatedProposals;
  }
  assert.equal(progress.evaluatedProposals, previous, "任务与最终阶段累计计数不一致。");
  assert.notEqual(progress.status, "failed", "执行失败不能记为完整结算。");
  if (searchMode === 1) assert.equal(previous, 50_000_000, "模式 1 必须完整结算 50M。");
  if (searchMode === 4) assert(previous >= 50_000_000, "模式 4 必须至少完整结算 50M。");
  if ([3, 4].includes(searchMode) || accounted < 50_000_000) {
    const { secondAttempts } = measureMilestones(progress, searchMode);
    assert(secondAttempts !== null && secondAttempts <= previous, "提前结束但没有已结算的严格缩面积次解。");
  }
}

/** 正常执行和跨轮复用共用正式几何、产率及面积公式复核。 */
export function assertNativeResult(manifest, input, row, task) {
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

/** 从最新原生任务独立复核历史计数；搜索不达标与执行未完成分别报告。 */
export async function audit() {
  const manifest = await readJson(resolve(LATEST, "manifest.json"));
  const searchMode = manifest.searchMode ?? 2;
  assert([1, 2, 3, 4].includes(searchMode), "搜索模式必须为 1、2、3 或 4。");
  const cases = await readJson(resolve(LATEST, "runtime/cases.json"));
  const rows = await readJson(resolve(LATEST, "rows.json"));
  const ids = new Set();
  for (const row of rows) {
    assert(!ids.has(row.itemId), `重复物品：${row.itemId}`); ids.add(row.itemId);
    const input = cases.find(item => item.itemId === row.itemId);
    assert(input, `结果包含清单外物品：${row.itemId}`);
    assert.equal(input.searchMode ?? 2, searchMode, "原始输入的搜索模式与轮次不一致。");
    assert.equal(row.searchMode ?? 2, searchMode, "执行结果的搜索模式与轮次不一致。");
    assert(row.cleanupPassed, `${row.itemId} 清理未通过。`);
    const collected = await readCollectedResult(manifest, row.itemId);
    assert(collected, `${row.itemId} 缺少本轮已校验的回收证据。`);
    assert.deepEqual(collected.summary, row, "回收证据与本轮成绩不一致。");
    if (row.reusedFrom) {
      const source = await readJson(resolve(collected.directory, "manifest.json"));
      const sourceInput = await readJson(resolve(collected.directory, "input.json"));
      const original = await readJson(resolve(collected.directory, "summary.json"));
      const task = await readJson(resolve(collected.directory, "task.eda-task.json"));
      // 在完整初始化后加载复用规则；原始阶段按来源模式验收，目标成绩按其门槛验收，不伪造目标模式的冷启动。
      const { reusableResult } = await import("./result-reuse.mjs");
      assert.deepEqual(reusableResult(manifest, input, source, sourceInput, original, task, collected.receipt), row, "复用证据不满足目标模式。");
      continue;
    }
    if (input.preparationError || row.errorKind === "request-rejected") {
      assert.equal(row.firstAttempts, null); assert.equal(row.secondAttempts, null);
      continue;
    }
    const task = await readJson(resolve(collected.directory, "task.eda-task.json"));
    assert.equal(task.algorithmVersion, manifest.algorithmVersion);
    assert.deepEqual(task.request, expectedStageRequest(input.request, row.stages, searchMode), "物料请求或阶段预算发生变化。");
    assert.equal(task.checkpoint.randomSeed, input.request.options.randomSeed);
    assert.equal(task.progress.activeWorkerCount, 0);
    assert.equal(task.checkpoint.evaluations, task.progress.evaluatedProposals);
    assert.equal(task.checkpoint.unspentEvaluations ?? 0, row.stages.at(-1).unspentEvaluations ?? 0, "保留尾额与原生检查点不一致。");
    for (const [key, value] of Object.entries(measureMilestones(task.progress, searchMode))) assert.equal(row[key], value, `${row.itemId}.${key}`);
    if (row.completed) {
      // AI-REMOVED 2026-10-30:
      // Reason: 次解后提前结算不再要求跑满 50M。
      // Trigger: 用户要求任何阶段找到次解即打断后续计算以节约时间。
      // Evidence: browserScenario 通过正式面积曲线识别次解并取消当前 Host 任务。
      // Replacement: 本文件 assertCompletedStages。
      // Risk: 必须独立验证次解和实际结算计数，防止普通中断被计为完成。
      // Human Review: Required
      // Original code:
      // assert.equal(task.progress.evaluatedProposals, 50_000_000);
      // assert.deepEqual(row.stages.map(stage => stage.evaluatedProposals), [20_000_000, 50_000_000]);
      assertCompletedStages(task.progress, row.stages, searchMode);
    }
    // AI-REMOVED 2026-10-30:
    // Reason: 正常执行与跨轮复用必须共用正式几何和产率验收，避免复用绕过验收。
    // Trigger: 用户要求根据算法版本复用指定物品的测试成果。
    // Evidence: 原验收只在本轮 rows 循环内，跨模式来源也需要独立复核。
    // Replacement: 本文件 assertNativeResult，由正常审计和 reusableResult 共用。
    // Risk: Low；移动原校验逻辑，不降低几何或产率要求。
    // Human Review: Required
    // Original code:
    // if (manifest.formulaTree) assert.equal(task.progress.initialArea, evaluateAreaFormula(manifest.formulaTree, row.area.S));
    // else assert.equal(task.progress.initialArea, row.area.area);
    // const best = task.checkpoint.best;
    // if (best) {
    //   assert.equal(best.report.engineKind, "dense-v2");
    //   const result = task.checkpoint.result;
    //   assert(result.measuredOutputs.some(flow => flow.itemId === row.itemId && flow.perMinute >= input.perMinute - 1e-6));
    //   assert.equal(result.metrics.area, task.progress.bestArea);
    //   assert.equal(result.metrics.area, result.metrics.width * result.metrics.height);
    //   assert(result.metrics.width <= 70 && result.metrics.height <= 70);
    // }
    assertNativeResult(manifest, input, row, task);
  }
  assert.deepEqual(cases.map(item => item.itemId), manifest.itemIds);
  await writeHistory(manifest, rows);
  return { audited: rows.length, total: cases.length, executionComplete: rows.length === cases.length && rows.every(row => row.completed),
    firstPassed: rows.filter(row => row.firstPassed).length, secondPassed: rows.filter(row => row.firstPassed && row.secondPassed).length };
}
