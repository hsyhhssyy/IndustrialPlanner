import assert from "node:assert/strict";
import { mkdir, readFile, link } from "node:fs/promises";
import { resolve } from "node:path";
import { OUTPUT, readJson, saveJson, hash } from "./common.mjs";

/** 固定失败输入供算法迭代；只向新任务提供原人工请求，不提供自动成功布局或历史搜索状态。 */
export async function prepareManualReplay(runId) {
  assert.match(runId, /^[A-Za-z0-9-]+$/);
  const directory = resolve(OUTPUT, "manual-replays", runId);
  let saved;
  try { saved = await readJson(resolve(directory, "inputs.json")); }
  catch (error) { if (error.code !== "ENOENT") throw error; }
  if (!saved) {
    const meta = await readJson(resolve(OUTPUT, "history", `${runId}.meta.json`));
    const failed = meta.manualResults.filter(row => !row.firstPassed || !(row.secondPassed || row.optimalPassed));
    assert(failed.length, "来源轮次没有人工失败项。");
    const inputs = [];
    for (const row of failed) {
      const source = resolve(OUTPUT, "results", row.itemId, runId);
      const bytes = await readFile(resolve(source, "manual-input.json"));
      const receipt = await readJson(resolve(source, "receipt.json"));
      assert.equal(receipt.runId, runId); assert.equal(receipt.itemId, row.itemId);
      assert.equal(hash(bytes), receipt.evidenceSha256["manual-input.json"], "原人工输入不符合回收哈希。");
      const input = JSON.parse(bytes);
      const original = await readJson(resolve(source, "input.json"));
      assert.equal(input.request.plan.targets.find(target => target.itemId === row.itemId).perMinute, original.perMinute);
      const destination = resolve(directory, row.itemId);
      await mkdir(destination, { recursive: true });
      // 原文件的硬链接保留输入证据；结果轮换删除目录后仍能重测同一个样本。
      try { await link(resolve(source, "manual-input.json"), resolve(destination, "manual-input.json")); }
      catch (error) { if (error.code !== "EEXIST") throw error; }
      assert.equal(hash(await readFile(resolve(destination, "manual-input.json"))), hash(bytes));
      inputs.push({ itemId: row.itemId, name: original.name, perMinute: original.perMinute,
        sha256: hash(bytes), sourceReceipt: receipt });
    }
    saved = { runId, inputs };
    await saveJson(resolve(directory, "inputs.json"), saved);
  }
  assert.equal(saved.runId, runId);
  return Promise.all(saved.inputs.map(async record => {
    const bytes = await readFile(resolve(directory, record.itemId, "manual-input.json"));
    assert.equal(hash(bytes), record.sha256, "固定失败输入被修改。");
    return { ...record, manualInput: JSON.parse(bytes) };
  }));
}
