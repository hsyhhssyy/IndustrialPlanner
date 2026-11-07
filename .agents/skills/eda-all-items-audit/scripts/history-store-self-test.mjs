import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, readdir, rm, unlink, utimes, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { HISTORY_OUTPUT, HISTORY_INDEX, importHistories, parseHistoryCsv, publishHistory, rebuildHistoryIndex } from "./history-store.mjs";

export async function historyStoreSelfTest(work) {
  await mkdir(work, { recursive: true });
  const directory = await mkdtemp(resolve(work, "history-self-test-"));
  let checks = 0;
  const header = "itemId,itemName,firstAttempts,secondAttempts\n";
  const meta = (runId, day, count) => ({ runId, createdAt: `2026-11-${day}T10:00:00.000Z`, recordedItems: count });
  const target = resolve(directory, "target"), old = resolve(directory, "old-worktree"), recent = resolve(directory, "recent-worktree");
  try {
    assert.equal(HISTORY_OUTPUT, "/home/coder/IndustrialPlanner/.temp/eda/all-items"); checks++;
    const oldCsv = header + '"item_a","物品,""甲""\n换行",10,20\nitem_b,物品乙,,\n';
    await publishHistory(oldCsv, meta("old", "01", 2), old);
    await publishHistory(header + "item_a,新名称,30,40\n", meta("new", "05", 1), recent);
    // 旧文件更晚复制/修改，不得让它覆盖新轮次；失败行保留空值且仍进入索引。
    await utimes(resolve(old, "history/old.csv"), new Date("2030-01-01"), new Date("2030-01-01"));
    const imported = await importHistories([recent, old], target);
    assert.equal(imported.imported, 2); assert.equal(imported.items, 2); checks++;
    const index = () => readFile(resolve(target, HISTORY_INDEX), "utf8");
    assert.deepEqual(parseHistoryCsv(await index()), [
      ["物品中文名称", "物品id", "上次执行时间", "上次执行文件"],
      ["新名称", "item_a", "2026-11-05T10:00:00.000Z", "history/new.csv"],
      ["物品乙", "item_b", "2026-11-01T10:00:00.000Z", "history/old.csv"],
    ]); checks++;
    assert.equal(await readFile(resolve(target, "history/old.csv"), "utf8"), oldCsv);
    assert.equal(await readFile(resolve(old, "history/old.csv"), "utf8"), oldCsv); checks++;
    assert.deepEqual(parseHistoryCsv(oldCsv)[1], ["item_a", '物品,"甲"\n换行', "10", "20"]); checks++;
    assert.equal((await importHistories([old, recent], target)).imported, 0); checks++;
    const beforeEmpty = await index();
    await publishHistory(header, meta("empty", "07", 0), target);
    assert.equal(await index(), beforeEmpty); checks++;
    await publishHistory(header + "item_b,物品乙的新失败记录,,\n", meta("partial", "06", 1), target);
    assert.deepEqual(parseHistoryCsv(await index())[2], ["物品乙的新失败记录", "item_b", "2026-11-06T10:00:00.000Z", "history/partial.csv"]); checks++;
    const preserved = await index();
    await unlink(resolve(target, HISTORY_INDEX));
    await rebuildHistoryIndex(target);
    assert.equal(await index(), preserved); checks++;
    const filesBefore = await readdir(resolve(target, "history"));
    await assert.rejects(publishHistory(header + "item_a,甲,1,2\nitem_a,重复,3,4\n", meta("duplicate", "07", 2), target), /ID 重复/);
    await assert.rejects(publishHistory(header, { runId: "invalid-time", recordedItems: 0 }, target), /有效执行时间/);
    await assert.rejects(publishHistory(header + "item_a,甲,-1,\n", meta("invalid-count", "07", 1), target), /次数无效/);
    assert.deepEqual(await readdir(resolve(target, "history")), filesBefore); checks++;
    const conflict = resolve(directory, "conflict");
    await publishHistory(header + "item_a,冲突,123,456\n", meta("old", "01", 1), conflict);
    const fresh = resolve(directory, "fresh");
    await publishHistory(header, meta("not-imported", "07", 0), fresh);
    await assert.rejects(importHistories([fresh, conflict], target), /CSV 冲突/);
    assert.deepEqual(await readdir(resolve(target, "history")), filesBefore);
    assert.equal(await index(), preserved); checks++;
    const corrupt = resolve(directory, "corrupt");
    await mkdir(resolve(corrupt, "history"), { recursive: true });
    await writeFile(resolve(corrupt, "history/orphan.csv"), header);
    await assert.rejects(importHistories([corrupt], target), { code: "ENOENT" });
    assert.equal(await index(), preserved); checks++;
    await writeFile(resolve(target, ".history-write.lock"), "another owner");
    await assert.rejects(rebuildHistoryIndex(target), /遗留锁待核验/);
    assert.equal(await readFile(resolve(target, ".history-write.lock"), "utf8"), "another owner");
    await unlink(resolve(target, ".history-write.lock")); checks++;
    assert(!(await readdir(target)).some(name => name.endsWith(".new") || name.endsWith(".lock"))); checks++;
  } finally { await rm(directory, { recursive: true, force: true }); }
  return checks;
}
