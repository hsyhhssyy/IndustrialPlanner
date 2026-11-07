import assert from "node:assert/strict";
import { mkdir, open, readFile, readdir, rename, unlink, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

// 用户明确要求（2026-11-07）：精简历史固定归档主工作区，不随被测 worktree 改变。
export const HISTORY_OUTPUT = "/home/coder/IndustrialPlanner/.temp/eda/all-items";
export const HISTORY_INDEX = "eda-all-item-history-index.csv";
const columns = ["itemId", "itemName", "firstAttempts", "secondAttempts"];
const indexColumns = ["物品中文名称", "物品id", "上次执行时间", "上次执行文件"];
const quote = value => `"${String(value).replaceAll('"', '""')}"`;

/** 解析现有四列 CSV，保留引号、逗号、换行和空值，不依赖额外包。 */
export function parseHistoryCsv(text) {
  const rows = [], row = [];
  const field = /("(?:[^"]|"")*"|[^",\r\n]*)(,|\r?\n|$)/gy;
  let offset = text.startsWith("\uFEFF") ? 1 : 0;
  while (offset < text.length) {
    field.lastIndex = offset;
    const match = field.exec(text);
    assert(match && field.lastIndex > offset, `历史 CSV 格式错误，位置 ${offset}`);
    row.push(match[1].startsWith('"') ? match[1].slice(1, -1).replaceAll('""', '"') : match[1]);
    offset = field.lastIndex;
    if (match[2] !== ",") { rows.push(row.splice(0)); }
    else if (offset === text.length) { row.push(""); rows.push(row.splice(0)); }
  }
  return rows;
}

function validateRecord(csv, metaText, runId) {
  const meta = JSON.parse(metaText);
  assert.match(runId, /^[A-Za-z0-9_-]+$/);
  assert.equal(meta.runId, runId, `历史轮次身份不符：${runId}`);
  assert(Number.isFinite(Date.parse(meta.createdAt)), `历史缺少有效执行时间：${runId}`);
  const [header, ...rows] = parseHistoryCsv(csv);
  assert.deepEqual(header, columns, `历史列不符：${runId}`);
  assert.equal(rows.length, meta.recordedItems, `历史条数与 meta 不符：${runId}`);
  const seen = new Set();
  for (const row of rows) {
    assert.equal(row.length, 4, `历史行列数不符：${runId}`);
    assert.match(row[0], /^item_[A-Za-z0-9_]+$/);
    assert(row[1] && !seen.has(row[0]), `历史物品名称为空或 ID 重复：${runId}`);
    for (const count of row.slice(2)) assert(count === "" || /^\d+$/.test(count) && Number.isSafeInteger(Number(count)), `历史次数无效：${runId}`);
    seen.add(row[0]);
  }
  return { runId, csv, metaText, meta, rows };
}

async function readRecords(directory) {
  const history = resolve(directory, "history");
  let names;
  try { names = await readdir(history); }
  catch (error) { if (error.code === "ENOENT") return []; throw error; }
  const ids = new Set(names.filter(name => name.endsWith(".csv") || name.endsWith(".meta.json"))
    .map(name => name.replace(/(?:\.csv|\.meta\.json)$/, "")));
  const records = [];
  for (const id of [...ids].sort()) {
    records.push(validateRecord(await readFile(resolve(history, `${id}.csv`), "utf8"),
      await readFile(resolve(history, `${id}.meta.json`), "utf8"), id));
  }
  return records;
}

/** 与浏览器执行锁分离；并发写入立即失败，异常退出的锁须核验归属后人工恢复。 */
async function withHistoryLock(directory, action) {
  await mkdir(directory, { recursive: true });
  const path = resolve(directory, ".history-write.lock");
  let file;
  try { file = await open(path, "wx"); }
  catch (error) {
    if (error.code !== "EEXIST") throw error;
    throw new Error(`历史正在写入或遗留锁待核验，不得自动删除：${path}`);
  }
  try {
    await file.writeFile(JSON.stringify({ pid: process.pid, createdAt: new Date().toISOString() }));
    return await action();
  } finally { await file.close(); await unlink(path); }
}

async function atomicWrite(path, text) {
  const temporary = `${path}.new`;
  try { await writeFile(temporary, text); await rename(temporary, path); }
  finally { await unlink(temporary).catch(error => { if (error.code !== "ENOENT") throw error; }); }
}

async function writeIndex(records, directory) {
  const latest = new Map();
  // 时间只取原轮次 createdAt；迁移时间、文件 mtime 和补做审计均不能改变顺序。
  for (const record of [...records].sort((a, b) => Date.parse(a.meta.createdAt) - Date.parse(b.meta.createdAt) || a.runId.localeCompare(b.runId))) {
    for (const [id, name] of record.rows) latest.set(id, [name, id, new Date(record.meta.createdAt).toISOString(), `history/${record.runId}.csv`]);
  }
  const rows = [...latest.values()].sort((a, b) => a[1].localeCompare(b[1]));
  await atomicWrite(resolve(directory, HISTORY_INDEX), indexColumns.join(",") + "\n" + rows.map(row => row.map(quote).join(",")).join("\n") + (rows.length ? "\n" : ""));
  return { rounds: records.length, items: rows.length, index: resolve(directory, HISTORY_INDEX) };
}

/** 每次成绩写入后重建索引； directory 仅供自检隔离，CLI 固定使用主工作区。 */
export async function publishHistory(csv, meta, directory = HISTORY_OUTPUT) {
  const metaText = JSON.stringify(meta, null, 2) + "\n";
  const record = validateRecord(csv, metaText, meta.runId);
  return withHistoryLock(directory, async () => {
    const records = await readRecords(directory);
    const history = resolve(directory, "history");
    await mkdir(history, { recursive: true });
    await atomicWrite(resolve(history, `${meta.runId}.csv`), csv);
    await atomicWrite(resolve(history, `${meta.runId}.meta.json`), metaText);
    return writeIndex([...records.filter(old => old.runId !== meta.runId), record], directory);
  });
}

export async function rebuildHistoryIndex(directory = HISTORY_OUTPUT) {
  return withHistoryLock(directory, async () => writeIndex(await readRecords(directory), directory));
}

/** 只访问用户指定且已授权目录的 history/；保留原字节，同名不同内容时先报错，绝不覆盖。 */
export async function importHistories(sources, directory = HISTORY_OUTPUT) {
  return withHistoryLock(directory, async () => {
    const existing = await readRecords(directory);
    const records = new Map(existing.map(record => [record.runId, record]));
    const imported = [], origins = [];
    for (const source of sources) {
      const incoming = await readRecords(source);
      origins.push({ source, rounds: incoming.length });
      for (const record of incoming) {
        const old = records.get(record.runId);
        if (old) {
          assert.equal(old.csv, record.csv, `历史 CSV 冲突：${record.runId}，来源 ${source}`);
          assert.equal(old.metaText, record.metaText, `历史 meta 冲突：${record.runId}，来源 ${source}`);
        } else { records.set(record.runId, record); imported.push(record); }
      }
    }
    const history = resolve(directory, "history");
    await mkdir(history, { recursive: true });
    for (const record of imported) {
      await atomicWrite(resolve(history, `${record.runId}.csv`), record.csv);
      await atomicWrite(resolve(history, `${record.runId}.meta.json`), record.metaText);
    }
    return { ...await writeIndex([...records.values()], directory), imported: imported.length, sources: origins };
  });
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const [command, ...sources] = process.argv.slice(2);
  if (command === "rebuild-index" && !sources.length) console.log(JSON.stringify(await rebuildHistoryIndex(), null, 2));
  else if (command === "import" && sources.length) console.log(JSON.stringify(await importHistories(sources), null, 2));
  else throw new Error("用法：history-store.mjs rebuild-index | import <已授权的 all-items 目录>...");
}
