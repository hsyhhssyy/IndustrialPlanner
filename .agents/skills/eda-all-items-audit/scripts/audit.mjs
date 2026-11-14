import assert from "node:assert/strict";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { register } from "tsx/esm/api";
import { ROOT, LATEST, readJson, measureMilestones, writeHistory } from "./common.mjs";
import { evaluateAreaFormula } from "./area-formula.mjs";
import { readCollectedResult } from "./result-retention.mjs";
import { assertManualDevicePoses, manualLayoutAreaLowerBound, selectManualDevices } from "./manual-followup.mjs";

/** 证明必须从固定输入重新推导，不能接受摘要自报最优，也不能将最优伪装为严格次解。 */
export function assertManualOptimality(prepared, manual, snapshot) {
  if (!manual.optimality) {
    assert.notEqual(manual.optimalPassed, true, "最优通过缺少下界证明。");
    return null;
  }
  assert(snapshot, "最优证明缺少正式首解快照。");
  const lowerBound = manualLayoutAreaLowerBound(prepared.selection.blueprint, prepared.footprints);
  const proof = { ...lowerBound, evaluatedProposals: snapshot.evaluatedProposals };
  assert.deepEqual(manual.optimality, proof, "人工最优证明与保留设备下界不一致。");
  assert.equal(manual.firstAttempts, proof.evaluatedProposals);
  assert.equal(manual.secondAttempts, null, "已达下界的首解不存在严格缩面积次解。");
  assert.equal(manual.secondPassed, false); assert.equal(manual.secondPosePassed, false);
  const metrics = snapshot.result.metrics;
  assert.equal(metrics.area, proof.area); assert.equal(metrics.area, metrics.width * metrics.height);
  assertManualDevicePoses(prepared.selection.blueprint, snapshot.result.blueprint, prepared.mapping, prepared.orientation, prepared.footprints);
  assert.equal(manual.firstPosePassed, true);
  assert.equal(manual.optimalPassed, manual.completed && manual.firstPassed && proof.evaluatedProposals <= 20_000_000);
  return proof;
}

/** 原生曲线、独立交付快照、位姿和实际预算分别复核，不相信执行器保存的 passed 标记。 */
async function assertManualEvidence(input, row, directory, registry, automaticTask, policy) {
  if (!input.manualOnly && row.secondAttempts === null) { assert.equal(row.manual, undefined); return; }
  const manual = row.manual;
  assert(manual, "已生成次解但缺少人工后续任务。");
  const prepared = await readJson(resolve(directory, "manual-input.json"));
  if (input.manualOnly) assert.deepEqual(prepared, input.manualInput, "固定样本请求或设备删减发生变化。");
  else {
    for (const kind of ["first", "second"]) {
      const snapshot = await readJson(resolve(directory, `automatic-${kind}.json`));
      assert.equal(snapshot.evaluatedProposals, row[`${kind}Attempts`], "自动任务发现次数与来源快照不一致。");
      assert.equal(snapshot.result.metrics.area, automaticTask.progress.areaHistory[kind === "first" ? 0 : 1].bestArea);
      assert.equal(snapshot.best.report.engineKind, "dense-v2");
      assert(snapshot.result.measuredOutputs.some(flow => flow.itemId === row.itemId && flow.perMinute >= input.perMinute - 1e-6));
    }
    const source = await readJson(resolve(directory, "automatic-second.json"));
    const selection = prepared.selection;
    const logistics = registry.entityDefinitions.filter(definition => registry.queries.isGeneralLogisticsDevice(definition.id)).map(definition => definition.id);
    assert.deepEqual(selectManualDevices(source.result.blueprint, logistics, input.deletionSeed), selection, "第二解设备删减不符合固定种子。");
    assert.deepEqual(prepared.request.plan, input.request.plan, "人工任务改变了生产目标或配方。");
  }
  const footprints = Object.fromEntries(prepared.selection.blueprint.entityOrder.map(id => {
    const entity = prepared.selection.blueprint.entities[id];
    const definition = registry.queries.findEntityDefinition(entity.definitionId);
    assert(definition && !registry.queries.isGeneralLogisticsDevice(entity.definitionId), "保留样本混入物流或未知设备。");
    const placement = prepared.request.manualLayout.placements.find(value => value.referenceNode.id === prepared.mapping[id]);
    assert(placement, "人工任务未锁定全部保留设备。");
    assert.deepEqual(placement.position, entity.position); assert.equal(placement.rotation, entity.rotation);
    return [definition.id, definition.footprint];
  }));
  assert.deepEqual(prepared.footprints, footprints);
  const task = await readJson(resolve(directory, "manual-task.eda-task.json")).catch(error => {
    if (error.code === "ENOENT" && manual.errorKind === "request-rejected") return null;
    throw error;
  });
  if (manual.errorKind === "request-rejected") {
    assert.equal(manual.evaluatedProposals, 0);
    assert.equal(manual.firstAttempts, null); assert.equal(manual.secondAttempts, null);
    assert.equal(manual.firstPosePassed, false); assert.equal(manual.secondPosePassed, false);
    assert.equal(manual.optimality ?? null, null); assert.notEqual(manual.optimalPassed, true);
    if (task) { assert.equal(task.checkpoint.evaluations, 0); assert.equal(task.progress.activeWorkerCount, 0); }
    return;
  }
  assert.deepEqual(task.request, expectedStageRequest(prepared.request, manual.stages), "人工任务输入或额度发生变化。");
  assert.equal(task.checkpoint.randomSeed, prepared.request.options.randomSeed);
  assert.equal(task.progress.activeWorkerCount, 0);
  assert.equal(task.checkpoint.evaluations, task.progress.evaluatedProposals);
  for (const [key, value] of Object.entries(measureMilestones(task.progress))) assert.equal(manual[key], value, `人工任务 ${key} 不一致。`);
  // AI-REMOVED 2026-11-14:
  // Reason: 人工首解可能已达刚体群面积下界，应先独立验证证明再判断提前结算。
  // Trigger: 用户允许有几何下界证明的最优解单独验收。
  // Evidence: v13 首解 40 等于固定群 5×8，严格次解不存在。
  // Replacement: 下方先核验快照与证明，再调用同一预算审计。
  // Risk: 不得接受摘要自报证明；Human Review: Required。
  // Original code:
  // if (manual.completed) assertCompletedStages(task.progress, manual.stages, 2, "minimum");
  assertNativeResult({ formulaTree: null }, input, { ...row, area: manual.area }, task);
  for (const kind of ["first", "second"]) {
    if (manual[`${kind}Attempts`] === null) { assert.equal(manual[`${kind}PosePassed`], false); continue; }
    const snapshot = await readJson(resolve(directory, `manual-${kind}.json`));
    assert.equal(snapshot.evaluatedProposals, manual[`${kind}Attempts`]);
    assert.equal(snapshot.best.report.engineKind, "dense-v2");
    assert(snapshot.result.measuredOutputs.some(flow => flow.itemId === row.itemId && flow.perMinute >= input.perMinute - 1e-6));
    assert.equal(snapshot.result.metrics.area, task.progress.areaHistory[kind === "first" ? 0 : 1].bestArea);
    assertManualDevicePoses(prepared.selection.blueprint, snapshot.result.blueprint, prepared.mapping, prepared.orientation, prepared.footprints);
    assert.equal(manual[`${kind}PosePassed`], true);
  }
  const firstSnapshot = manual.optimality ? await readJson(resolve(directory, "manual-first.json")) : null;
  const proof = assertManualOptimality(prepared, manual, firstSnapshot);
  if (proof) {
    assert.equal(policy.optimality, "retained-device-bounds", "该轮未声明最优解验收口径。");
    const { assertPlannerCandidateBounds, assertPlannerWarehousePorts, meetsProductionTargets } =
      await import(pathToFileURL(resolve(ROOT, "src/blueprint-planner/verification.ts")).href);
    const candidate = firstSnapshot.best.candidate;
    assert.deepEqual(candidate.execution.blueprint, firstSnapshot.result.blueprint);
    assert.deepEqual(candidate.metrics, firstSnapshot.result.metrics);
    assertPlannerCandidateBounds(registry, candidate);
    assertPlannerWarehousePorts(registry, task.request, candidate);
    assert(meetsProductionTargets(task.request, firstSnapshot.best.report), "最优首解的正式仿真未满足目标。");
  }
  if (manual.completed) assertCompletedStages(task.progress, manual.stages, 2, "minimum", proof);
}

/** continuePlanning 会将请求中的每轮额度更新为本阶段额度，物料需求和其余设置仍严格比对。 */
export function expectedStageRequest(request, stages, searchMode = 2) {
  assert([1, 2, 3, 4].includes(searchMode), "搜索模式必须为 1、2、3 或 4。");
  assert(stages.length >= 1 && ([3, 4].includes(searchMode) || stages.length <= 2), "阶段记录数量无效。");
  assert.deepEqual(stages.map(stage => stage.key), stages.map((_stage, index) => String(index === 0 ? 20_000_000 : index * 50_000_000)), "阶段次序无效。");
  const index = stages.length - 1, previous = index === 0 ? 0 : stages[index - 1].evaluatedProposals;
  assert(Number.isSafeInteger(previous) && previous >= 0, "阶段缺少真实累计计数。");
  const limit = index === 0 ? 20_000_000 : index * 50_000_000;
  // AI-CORRECTION 2026-11-01：最低额度可能经多次续算达成；原生请求保存最后一次新增额度与此前尾额之和。
  const round = stages.at(-1).rounds?.at(-1);
  return { ...request, options: { ...request.options, evaluationsPerRound: round ? round.additional + round.retained : limit - previous } };
}

/** 允许次解后的已结算提前结束；未找到次解仍须完整消耗 50M，原有满额结果继续可审计。 */
// AI-CORRECTION 2026-10-30：模式 1 必须满额，模式 2 可在次解后提前结束，模式 3 必须找到次解且允许超过 50M。
// AI-CORRECTION 2026-10-30：模式 4 必须累计至少 50M 且找到次解，之后可在任意追加阶段提前结算。
// AI-CORRECTION 2026-10-30：完整搜索批次留下的尾额不算已执行；阶段以实际次数加保留尾额守恒，模式 4 的最低次数只看实际执行。
// AI-CORRECTION 2026-11-01：新执行默认采用最低额度，真实次数允许超出；历史无 rounds 记录仍按原始冻结规则审计，不改写旧成绩。
// AI-CORRECTION 2026-11-14：人工模式 2 允许独立核验后的几何最优证明提前结算，真实次解仍为空。
export function assertCompletedStages(progress, stages, searchMode = 2, budgetPolicy = stages[0]?.rounds ? "minimum" : "exact", optimality = null) {
  assert([1, 2, 3, 4].includes(searchMode), "搜索模式必须为 1、2、3 或 4。");
  assert(stages.length >= 1 && ([3, 4].includes(searchMode) || stages.length <= 2), "阶段记录数量无效。");
  assert(["minimum", "exact"].includes(budgetPolicy), "未知额度规则。");
  if (optimality) {
    assert.equal(searchMode, 2); assert.equal(budgetPolicy, "minimum");
    assert.equal(measureMilestones(progress).secondAttempts, null);
    assert.equal(progress.areaHistory[0]?.bestArea, optimality.area);
    assert.equal(progress.areaHistory[0]?.evaluatedProposals, optimality.evaluatedProposals);
    assert(Number.isSafeInteger(optimality.evaluatedProposals) && optimality.evaluatedProposals > 0
      && optimality.evaluatedProposals <= progress.evaluatedProposals, "最优证明的发现计数无效。");
  }
  if (budgetPolicy === "minimum") {
    let previous = 0, retained = 0;
    for (const [index, stage] of stages.entries()) {
      const minimum = index === 0 ? 20_000_000 : index * 50_000_000;
      assert.equal(stage.key, String(minimum), "阶段次序无效。");
      assert(stage.rounds?.length, "最低额度执行缺少实际发放记录。");
      for (const [roundIndex, round] of stage.rounds.entries()) {
        assert.equal(round.before, previous, "续算前实际次数不连续。");
        assert.equal(round.retained, retained, "续算重复发放或丢失尾额。");
        assert(Number.isSafeInteger(round.additional) && round.additional > 0, "新增额度无效。");
        const issued = previous + retained + round.additional;
        assert(Number.isSafeInteger(issued) && Number.isSafeInteger(round.evaluatedProposals) && round.evaluatedProposals >= previous
          && Number.isSafeInteger(round.unspentEvaluations) && round.unspentEvaluations >= 0, "实际次数或尾额无效。");
        const accounted = round.evaluatedProposals + round.unspentEvaluations;
        assert(accounted <= issued, "实际次数和尾额超过实际发放预算。");
        if (index < stages.length - 1 || roundIndex < stage.rounds.length - 1 || round.evaluatedProposals >= minimum) {
          // 次解取消会释放尚未使用的整轮预算；其余结算必须核对真实发放额度，而非名义门槛。
          const improved = measureMilestones(progress, searchMode).secondAttempts;
          const early = index === stages.length - 1 && roundIndex === stage.rounds.length - 1 && (improved !== null || optimality !== null)
            && ([2, 3].includes(searchMode) || searchMode === 4 && round.evaluatedProposals >= 50_000_000);
          if (!early) assert.equal(accounted, issued, "实际发放预算不守恒。");
        }
        previous = round.evaluatedProposals;
        retained = round.unspentEvaluations;
      }
      assert.equal(stage.evaluatedProposals, previous, "阶段与续算实际次数不一致。");
      assert.equal(stage.unspentEvaluations ?? 0, retained, "阶段与续算尾额不一致。");
      if (index < stages.length - 1) assert(previous >= minimum, "非最终阶段未达到最低实际次数。");
    }
    assert.equal(progress.evaluatedProposals, previous, "任务与最终阶段累计计数不一致。");
    assert.notEqual(progress.status, "failed", "执行失败不能记为完整结算。");
    const second = measureMilestones(progress, searchMode).secondAttempts;
    assert(second === null || second <= previous, "次解发现次数超过实际结算次数。");
    if ([1, 4].includes(searchMode) || second === null && optimality === null) assert(previous >= 50_000_000, "实际次数未达到最低 50M。");
    if ([3, 4].includes(searchMode) || previous < 50_000_000) assert(second !== null && second <= previous || optimality !== null,
      "提前结束但没有已结算的严格缩面积次解或已核验最优证明。");
    return;
  }
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
  let registry;
  if (manifest.manualAudit) {
    register({ tsconfig: resolve(ROOT, "tsconfig.app.json") });
    const { createRegistryContract } = await import(pathToFileURL(resolve(ROOT, "src/registry/index.ts")).href);
    registry = createRegistryContract();
  }
  const ids = new Set();
  for (const row of rows) {
    assert(!ids.has(row.itemId), `重复物品：${row.itemId}`); ids.add(row.itemId);
    const input = cases.find(item => item.itemId === row.itemId);
    assert(input, `结果包含清单外物品：${row.itemId}`);
    assert.equal(input.searchMode ?? 2, searchMode, "原始输入的搜索模式与轮次不一致。");
    assert.equal(input.budgetPolicy ?? "exact", manifest.budgetPolicy ?? "exact", "原始输入的额度规则与轮次不一致。");
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
    if (row.completed && !input.manualOnly) {
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
      assertCompletedStages(task.progress, row.stages, searchMode, manifest.budgetPolicy);
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
    if (manifest.manualAudit) await assertManualEvidence(input, row, collected.directory, registry, task, manifest.manualAudit);
  }
  assert.deepEqual(cases.map(item => item.itemId), manifest.itemIds);
  await writeHistory(manifest, rows);
  return { audited: rows.length, total: cases.length, executionComplete: rows.length === cases.length && rows.every(row => row.completed),
    firstPassed: rows.filter(row => row.firstPassed).length, secondPassed: rows.filter(row => row.firstPassed && row.secondPassed).length,
    ...(manifest.manualAudit ? { manualFirstPassed: rows.filter(row => row.manual?.firstPassed && row.manual.firstPosePassed).length,
      manualSecondPassed: rows.filter(row => row.manual?.firstPassed && row.manual.secondPassed && row.manual.firstPosePassed && row.manual.secondPosePassed).length,
      manualOptimalPassed: rows.filter(row => row.manual?.optimalPassed).length,
      manualPassed: rows.filter(row => row.manual?.firstPassed && row.manual.firstPosePassed
        && (row.manual.secondPassed && row.manual.secondPosePassed || row.manual.optimalPassed)).length } : {}) };
}
