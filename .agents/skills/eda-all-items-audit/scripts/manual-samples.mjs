import assert from "node:assert/strict";
import { readdir, readFile, mkdir, link } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { register } from "tsx/esm/api";
import { ROOT, OUTPUT, hash, readJson, saveJson } from "./common.mjs";
import { selectManualDevices, assertSecondSolutionSource } from "./manual-followup.mjs";

/** 固定抽样后保留来源文件；后续算法迭代不得换样本、换删减种子或覆盖来源。 */
export async function prepareManualSamples(count = 4, seed = 20261113) {
  assert(Number.isSafeInteger(count) && count >= 3 && count <= 5, "开发抽样数量应为 3～5。");
  assert(Number.isSafeInteger(seed) && seed >= 0 && seed <= 0xffffffff, "抽样种子无效。");
  const directory = resolve(OUTPUT, "manual-samples", `${seed}-${count}`);
  let saved;
  try {
    saved = await readJson(resolve(directory, "samples.json"));
  } catch (error) { if (error.code !== "ENOENT") throw error; }
  if (saved) {
    assert.equal(saved.seed, seed); assert.equal(saved.count, count);
    for (const record of saved.samples) {
      assert.equal(hash(await readFile(resolve(directory, record.itemId, "source.eda-task.json"))), record.sourceSha256);
      assert.equal(hash(await readFile(resolve(directory, record.itemId, "devices.blueprint.json"))), record.devicesSha256);
    }
    return { directory, ...saved };
  }
  register({ tsconfig: resolve(ROOT, "tsconfig.app.json") });
  const { createRegistryContract } = await import(pathToFileURL(resolve(ROOT, "src/registry/index.ts")).href);
  const registry = createRegistryContract();
  const logistics = registry.entityDefinitions.filter(definition => registry.queries.isGeneralLogisticsDevice(definition.id)).map(definition => definition.id);
  const entries = (await readdir(resolve(OUTPUT, "results"), { withFileTypes: true })).filter(entry => entry.isDirectory())
    .map(entry => ({ id: entry.name, rank: hash(`manual-samples:${seed}:${entry.name}`) }))
    .sort((a, b) => a.rank.localeCompare(b.rank) || a.id.localeCompare(b.id));
  const samples = [], unavailable = [];
  for (const { id } of entries) {
    const root = resolve(OUTPUT, "results", id);
    const pointer = await readJson(resolve(root, "current.json"));
    assert.equal(pointer.itemId, id);
    assert.match(pointer.runId, /^[A-Za-z0-9-]+$/);
    const source = resolve(root, pointer.runId), summary = await readJson(resolve(source, "summary.json"));
    const manifest = await readJson(resolve(source, "manifest.json"));
    if (manifest.manualAudit?.mode === "only") {
      unavailable.push({ itemId: id, reason: "该结果是人工开发任务，不是自动来源" }); continue;
    }
    if (!summary.completed || !summary.cleanupPassed || summary.secondAttempts == null) {
      unavailable.push({ itemId: id, reason: "历史任务没有已结算次解" }); continue;
    }
    const bytes = await readFile(resolve(source, "task.eda-task.json"));
    const receipt = await readJson(resolve(source, "receipt.json"));
    assert.equal(receipt.taskSha256, hash(bytes), "历史来源任务不符合原回收哈希。");
    assert.equal(receipt.summarySha256, hash(JSON.stringify(summary)), "历史来源摘要不符合原回收哈希。");
    const task = JSON.parse(bytes);
    let milestones;
    try { milestones = assertSecondSolutionSource(task); }
    catch (error) { unavailable.push({ itemId: id, reason: error.message }); continue; }
    const deletionSeed = Number.parseInt(hash(`manual-deletion:${seed}:${id}`).slice(0, 8), 16);
    const subset = selectManualDevices(task.checkpoint.result.blueprint, logistics, deletionSeed);
    const target = resolve(directory, id);
    await mkdir(target, { recursive: true });
    try { await link(resolve(source, "task.eda-task.json"), resolve(target, "source.eda-task.json")); }
    catch (error) {
      if (error.code !== "EEXIST") throw error;
      assert.equal(hash(await readFile(resolve(target, "source.eda-task.json"))), hash(bytes), "已有抽样来源不一致。");
    }
    await saveJson(resolve(target, "devices.blueprint.json"), subset.blueprint);
    const { blueprint: _blueprint, ...selection } = subset;
    void _blueprint;
    const record = { itemId: id, name: summary.name, sourceRunId: pointer.runId, sourceSha256: hash(bytes),
      devicesSha256: hash(await readFile(resolve(target, "devices.blueprint.json"))), ...milestones, ...selection };
    await saveJson(resolve(target, "selection.json"), record);
    samples.push(record);
    if (samples.length === count) break;
  }
  assert.equal(samples.length, count, "可核验的历史第二解不足，不能用其他结果冒充。");
  const manifest = { formatVersion: 1, seed, count, createdAt: new Date().toISOString(), samples, unavailable,
    firstLimit: 20_000_000, secondLimit: 50_000_000, state: "sources-prepared" };
  await saveJson(resolve(directory, "samples.json"), manifest);
  return { directory, ...manifest };
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const args = process.argv.slice(2);
  let count = 4, seed = 20261113;
  while (args.length) {
    const option = args.shift(), value = args.shift();
    assert(value && /^\d+$/.test(value), "参数必须为非负整数。");
    if (option === "--count") count = Number(value);
    else if (option === "--seed") seed = Number(value);
    else throw new Error(`未知参数：${option}`);
  }
  const manifest = await prepareManualSamples(count, seed);
  console.log(JSON.stringify({ directory: manifest.directory, seed, count, state: manifest.state,
    samples: manifest.samples.map(({ itemId, name, deviceCount, removedIds, retainedIds }) =>
      ({ itemId, name, deviceCount, removedCount: removedIds.length, retainedCount: retainedIds.length })) }, null, 2));
}
