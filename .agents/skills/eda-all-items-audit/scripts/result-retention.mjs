import assert from "node:assert/strict";
import { link, mkdir, readFile, readdir, rename, rm } from "node:fs/promises";
import { resolve } from "node:path";
import { OUTPUT, hash, readJson, saveJson } from "./common.mjs";

const optionalJson = path => readJson(path).catch(error => {
  if (error.code === "ENOENT") return null;
  throw error;
});

function itemRoot(manifest, itemId, directory) {
  assert.match(itemId, /^item_[A-Za-z0-9_]+$/);
  assert.match(manifest.runId, /^[A-Za-z0-9_-]+$/);
  assert(manifest.itemIds.includes(itemId), "结果物品不属于本轮清单。");
  return resolve(directory, "results", itemId);
}

/** 只读取本轮已校验回收的证据，旧轮保留结果不能充当本轮成绩。 */
export async function readCollectedResult(manifest, itemId, directory = OUTPUT) {
  const root = itemRoot(manifest, itemId, directory);
  const reference = manifest.reusedItems?.find(entry => entry.itemId === itemId);
  const runId = reference?.runId ?? manifest.runId;
  assert.match(runId, /^[A-Za-z0-9_-]+$/);
  const paths = reference ? [resolve(root, runId)] : [resolve(root, runId), resolve(directory, "latest/runtime/collected", itemId)];
  for (const path of paths) {
    const receipt = await optionalJson(resolve(path, "receipt.json"));
    if (!receipt) continue;
    assert.equal(receipt.runId, runId, "回收证据轮次不一致。");
    assert.equal(receipt.itemId, itemId, "回收证据物品不一致。");
    const summary = await readJson(resolve(path, "summary.json"));
    assert.equal(hash(JSON.stringify(summary)), receipt.summarySha256, "回收摘要已损坏。");
    if (receipt.taskSha256 !== null) {
      assert.equal(hash(await readFile(resolve(path, "task.eda-task.json"))), receipt.taskSha256, "回收任务已损坏。");
    }
    if (reference) {
      assert.equal(receipt.taskSha256, reference.taskSha256, "复用任务与登记的来源不一致。");
      assert.equal(reference.executionIdentity, manifest.executionIdentity, "复用生产源码身份不一致。");
    }
    return { directory: path, summary: reference ? { ...summary, searchMode: manifest.searchMode ?? 2, reusedFrom: reference } : summary, receipt };
  }
  return null;
}

/** 新证据完整落盘后原子切换当前结果，再删除该物品的旧版本；中断后可重复调用。 */
export async function acceptCollectedResult(manifest, input, summary, source, transferSha256, directory = OUTPUT) {
  const root = itemRoot(manifest, summary.itemId, directory);
  assert(input, "回收结果缺少原始输入。");
  assert.equal(input.itemId, summary.itemId, "回收结果与原始输入物品不一致。");
  assert.equal(input.searchMode ?? 2, manifest.searchMode ?? 2, "原始输入搜索模式不一致。");
  assert.equal(summary.searchMode ?? 2, manifest.searchMode ?? 2, "回收结果搜索模式不一致。");
  assert.deepEqual(await readJson(resolve(source, "summary.json")), summary, "回收结果与远端摘要不一致。");
  const task = await optionalJson(resolve(source, "task.eda-task.json"));
  const needsTask = summary.completed && !input.preparationError && summary.errorKind !== "request-rejected";
  assert(!needsTask || task, "已结算结果缺少原生任务，保留旧结果。");
  if (task) {
    assert.equal(task.algorithmVersion, manifest.algorithmVersion, "回收任务算法版本不一致。");
    assert.equal(task.checkpoint.randomSeed, input.request.options.randomSeed, "回收任务种子不一致。");
  }
  await saveJson(resolve(source, "manifest.json"), manifest);
  await saveJson(resolve(source, "input.json"), input);
  await saveJson(resolve(source, "receipt.json"), { formatVersion: 1, runId: manifest.runId, itemId: summary.itemId,
    transferSha256, summarySha256: hash(JSON.stringify(summary)),
    taskSha256: task ? hash(await readFile(resolve(source, "task.eda-task.json"))) : null });
  if (!summary.completed || !summary.cleanupPassed) return source;

  await mkdir(root, { recursive: true });
  const destination = resolve(root, manifest.runId);
  if (source !== destination) await rename(source, destination);
  const pointer = resolve(root, "current.json");
  const previousPointer = await optionalJson(pointer);
  if (previousPointer) assert.equal(previousPointer.itemId, summary.itemId, "当前结果指针物品不一致。");
  const pendingRemoval = new Set(previousPointer?.pendingRemoval ?? []);
  for (const runId of pendingRemoval) {
    assert.match(runId, /^[A-Za-z0-9_-]+$/);
    assert.notEqual(runId, manifest.runId, "待删除记录不能包含当前结果。");
  }
  for (const entry of await readdir(root, { withFileTypes: true })) {
    if (!entry.isDirectory() || entry.name === manifest.runId) continue;
    if (pendingRemoval.has(entry.name)) continue;
    const previous = await optionalJson(resolve(root, entry.name, "receipt.json"));
    assert(previous?.itemId === summary.itemId && previous.runId === entry.name, "旧结果归属不明，停止清理。");
    pendingRemoval.add(entry.name);
  }
  const current = { formatVersion: 1, runId: manifest.runId, itemId: summary.itemId };
  await saveJson(pointer, { ...current, pendingRemoval: [...pendingRemoval] });
  // 指针落盘后才清理；若此前在切换后中断，重入也会清掉遗留旧版本。
  // 待删除轮次随指针持久化，即使旧 receipt 已被部分删除，仍能确认归属并完成清理。
  for (const runId of pendingRemoval) await rm(resolve(root, runId), { recursive: true, force: true });
  await saveJson(pointer, current);
  return destination;
}

/** Extend + Compose：迁移旧 latest 的已结算证据，复用原子 JSON 写入和文件系统 rename/link，不复制大型任务。 */
export async function retainLatestResults(directory = OUTPUT) {
  const latest = resolve(directory, "latest");
  const manifest = await optionalJson(resolve(latest, "manifest.json"));
  if (manifest) {
    const rows = await optionalJson(resolve(latest, "rows.json")) ?? [];
    const summaries = new Map(rows.map(row => [row.itemId, row]));
    const collected = resolve(latest, "runtime/collected");
    const entries = await readdir(collected, { withFileTypes: true }).catch(error => {
      if (error.code === "ENOENT") return [];
      throw error;
    });
    // 旧控制器可能在证据回收后、rows 写入前退出；不能仅凭成绩表决定是否保留。
    for (const entry of entries.filter(entry => entry.isDirectory())) {
      const summary = await optionalJson(resolve(collected, entry.name, "summary.json"));
      if (!summary) continue;
      assert.equal(summary.itemId, entry.name, "旧回收目录与摘要物品不一致。");
      if (summaries.has(entry.name)) assert.deepEqual(summaries.get(entry.name), summary, "旧成绩与回收摘要不一致。");
      else summaries.set(entry.name, summary);
    }
    const inputs = await readJson(resolve(latest, "runtime/cases.json"));
    for (const row of [...summaries.values()].filter(row => row.completed && row.cleanupPassed)) {
      const existing = await readCollectedResult(manifest, row.itemId, directory);
      if (row.reusedFrom) {
        assert(existing, "复用结果缺少原始证据，停止轮换。");
        assert.deepEqual(existing.summary, row, "复用成绩与原始证据不一致。");
        continue;
      }
      const source = existing?.directory ?? resolve(latest, "runtime/collected", row.itemId);
      if (!existing) {
        try { await link(resolve(latest, "tasks", `${row.itemId}.eda-task.json`), resolve(source, "task.eda-task.json")); }
        catch (error) { if (!["ENOENT", "EEXIST"].includes(error.code)) throw error; }
      }
      await acceptCollectedResult(manifest, inputs.find(input => input.itemId === row.itemId), row, source,
        existing?.receipt.transferSha256 ?? null, directory);
    }
  }
}

/** 2026-10-30：迁移逻辑移至 retainLatestResults，允许暂停队列时先保全结果；轮换顺序保持不变。 */
export async function replacePreparedRun(staging, directory = OUTPUT) {
  const latest = resolve(directory, "latest");
  await retainLatestResults(directory);
  await rm(latest, { recursive: true, force: true });
  await rename(staging, latest);
}
