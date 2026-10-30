import assert from "node:assert/strict";
import { resolve } from "node:path";
import { OUTPUT, executionIdentity, hash, readJson, saveJson, writeHistory, measureMilestones } from "./common.mjs";
import { assertCompletedStages, expectedStageRequest, assertNativeResult } from "./audit.mjs";
import { readCollectedResult } from "./result-retention.mjs";

const optionalJson = path => readJson(path).catch(error => {
  if (error.code === "ENOENT") return null;
  throw error;
});

function comparableInput(input) {
  const request = structuredClone(input.request);
  if (request?.options) delete request.options.evaluationsPerRound;
  return { itemId: input.itemId, perMinute: input.perMinute, recipeId: input.recipeId,
    recipeChoices: input.recipeChoices, request };
}

/** 必须同一冻结生产源码和输入，且实际计算已覆盖目标模式；不能仅凭版本名跳过。 */
export function reusableResult(target, input, source, sourceInput, summary, task, receipt) {
  if (!target.executionIdentity || target.executionIdentity !== source.executionIdentity
    || target.algorithmVersion !== source.algorithmVersion || !summary.completed || !summary.cleanupPassed || !task
    || JSON.stringify(target.formulaTree ?? null) !== JSON.stringify(source.formulaTree ?? null)
    || hash(JSON.stringify(comparableInput(input))) !== hash(JSON.stringify(comparableInput(sourceInput)))) return null;
  assert.equal(task.algorithmVersion, source.algorithmVersion);
  assert.deepEqual(task.request, expectedStageRequest(sourceInput.request, summary.stages, source.searchMode ?? 2));
  assert.equal(task.checkpoint.randomSeed, input.request.options.randomSeed);
  assert.equal(task.checkpoint.evaluations, task.progress.evaluatedProposals);
  assert.equal(task.checkpoint.unspentEvaluations ?? 0, summary.stages.at(-1).unspentEvaluations ?? 0);
  assert.equal(task.progress.activeWorkerCount, 0);
  assertCompletedStages(task.progress, summary.stages, source.searchMode ?? 2);
  for (const [key, value] of Object.entries(measureMilestones(task.progress, source.searchMode ?? 2))) assert.equal(summary[key], value);
  assertNativeResult(source, sourceInput, summary, task);
  const used = task.progress.evaluatedProposals, accounted = used + (task.checkpoint.unspentEvaluations ?? 0), mode = target.searchMode ?? 2;
  const measured = measureMilestones(task.progress, mode);
  if (mode === 1 && used !== 50_000_000
    || mode === 2 && (used > 50_000_000 && !measured.secondPassed || used <= 50_000_000 && accounted < 50_000_000 && measured.secondAttempts === null)
    || mode === 3 && measured.secondAttempts === null
    || mode === 4 && (used < 50_000_000 || measured.secondAttempts === null)) return null;
  // 跨模式复用的是已证明的目标成绩；原始阶段按来源模式审计，真实超额计算通过 reusedFrom 显式保留。
  const reference = { itemId: input.itemId, runId: source.runId, searchMode: source.searchMode ?? 2,
    executionIdentity: source.executionIdentity, taskSha256: receipt.taskSha256 };
  return { ...summary, searchMode: mode, ...measured, reusedFrom: reference };
}

/** 仅处理用户登记的待复用物品；先持久化本地来源及成绩，再同步远端完成记录，不启动浏览器。 */
export async function reuseCompletedResults(manifest, remote, action, directory = OUTPUT) {
  const latest = resolve(directory, "latest");
  const frozen = await readJson(resolve(latest, "runtime/source-fingerprint.json"));
  manifest.executionIdentity ??= executionIdentity(manifest, frozen);
  const inputs = await readJson(resolve(latest, "runtime/cases.json"));
  const rows = await optionalJson(resolve(latest, "rows.json")) ?? [];
  const completed = new Set(remote.summaries.map(row => row.itemId));
  const pending = rows.filter(row => row.reusedFrom && !completed.has(row.itemId));
  const reused = [];
  for (const itemId of manifest.reuseCandidates ?? []) {
    if (completed.has(itemId) || rows.some(row => row.itemId === itemId)) continue;
    const input = inputs.find(input => input.itemId === itemId);
    if (!input || input.preparationError) continue;
    const pointer = await optionalJson(resolve(directory, "results", itemId, "current.json"));
    if (!pointer || pointer.runId === manifest.runId) continue;
    assert.match(pointer.runId, /^[A-Za-z0-9_-]+$/);
    const sourceDirectory = resolve(directory, "results", itemId, pointer.runId);
    const source = await readJson(resolve(sourceDirectory, "manifest.json"));
    const collected = await readCollectedResult(source, itemId, directory);
    assert(collected && collected.receipt.runId === pointer.runId, "复用来源缺少已校验回收证据。");
    if (collected.receipt.taskSha256 === null) continue;
    const row = reusableResult(manifest, input, source, await readJson(resolve(sourceDirectory, "input.json")),
      collected.summary, await readJson(resolve(sourceDirectory, "task.eda-task.json")), collected.receipt);
    if (row) reused.push(row);
  }
  if (!reused.length && !pending.length) return [];
  manifest.reusedItems = [...(manifest.reusedItems ?? []), ...reused.map(row => row.reusedFrom)];
  rows.push(...reused);
  await saveJson(resolve(latest, "manifest.json"), manifest);
  await saveJson(resolve(latest, "rows.json"), rows);
  await writeHistory(manifest, rows, directory);
  const synchronized = [...pending, ...reused];
  await action("reuse", manifest, { rows: synchronized });
  return synchronized.map(row => row.itemId);
}
