import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile, rename, readdir } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const ROOT = fileURLToPath(new URL("../../../../", import.meta.url));
export const SKILL = resolve(ROOT, ".agents/skills/eda-all-items-audit");
export const OUTPUT = resolve(ROOT, ".temp/eda/all-items");
export const LATEST = resolve(OUTPUT, "latest");
export const WORK = resolve(ROOT, ".temp/.trash/eda-all-items");
export const readJson = async path => JSON.parse(await readFile(path, "utf8"));
export const hash = value => createHash("sha256").update(value).digest("hex");

/** 只有用户显式指定的版本对照才筛选物品；未知或重复 ID 立即失败。 */
export function selectAuditCases(cases, itemIds = null) {
  if (itemIds === null) return cases;
  if (!itemIds.length || new Set(itemIds).size !== itemIds.length) throw new Error("物品选择不能为空或包含重复 ID。");
  const index = new Map(cases.map(record => [record.itemId, record]));
  return itemIds.map(id => {
    const record = index.get(id);
    if (!record) throw new Error(`物品不在当前专项清单中：${id}`);
    return record;
  });
}

/** 仅统计完整结算且清理通过的项目；两阶段均达标才算成功。 */
export function failureStopDecision(rows, threshold) {
  if (!Number.isSafeInteger(threshold) || threshold < 0) throw new Error("失败停止门槛必须是非负安全整数。");
  const settled = rows.filter(row => row.completed && row.cleanupPassed);
  const succeeded = settled.filter(row => row.firstPassed && row.secondPassed).length;
  const failed = settled.length - succeeded;
  return { threshold, succeeded, failed, shouldStop: failed > threshold && failed > succeeded };
}

export async function saveJson(path, value) {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(`${path}.new`, JSON.stringify(value, null, 2) + "\n");
  await rename(`${path}.new`, path);
}

/** 冻结有效源码、资源及执行器；不读取 Git 的其他分支或 worktree。 */
export async function fingerprint() {
  const files = [];
  async function visit(directory) {
    for (const entry of (await readdir(resolve(ROOT, directory), { withFileTypes: true })).sort((a, b) => a.name.localeCompare(b.name))) {
      const path = `${directory}/${entry.name}`;
      if (entry.isDirectory()) {
        if (!["src/tests", "src/scripts"].includes(path)) await visit(path);
      } else if (entry.isFile()) files.push(path);
    }
  }
  for (const directory of ["src", "public", ".agents/skills/eda-all-items-audit"]) await visit(directory);
  files.push("package.json", "package-lock.json", "vite.config.ts", "tsconfig.app.json", "index.html");
  const result = {};
  for (const path of files.sort()) result[path] = hash(await readFile(resolve(ROOT, path)));
  return result;
}

/** 历史 CSV 永远只有四列；任务和完整报告只进入 latest。 */
export async function writeHistory(manifest, rows, directory = OUTPUT) {
  const quote = value => value === null || value === undefined ? "" : `"${String(value).replaceAll('"', '""')}"`;
  const text = "itemId,itemName,firstAttempts,secondAttempts\n" + rows.map(row =>
    [row.itemId, row.name, row.firstAttempts, row.secondAttempts].map(quote).join(",")).join("\n") + (rows.length ? "\n" : "");
  const history = resolve(directory, "history");
  await mkdir(history, { recursive: true });
  const path = resolve(history, `${manifest.runId}.csv`);
  await writeFile(`${path}.new`, text);
  await rename(`${path}.new`, path);
  await saveJson(resolve(history, `${manifest.runId}.meta.json`), {
    formatVersion: 1, runId: manifest.runId, createdAt: manifest.createdAt, formula: manifest.formula,
    seedNamespace: manifest.seedNamespace, algorithmVersion: manifest.algorithmVersion, sourceHash: manifest.sourceHash,
    firstLimit: 20_000_000, totalLimit: 50_000_000, totalItems: manifest.itemIds.length, recordedItems: rows.length,
    complete: rows.length === manifest.itemIds.length && rows.every(row => row.completed && row.cleanupPassed),
    firstPassed: rows.filter(row => row.firstPassed).length, secondPassed: rows.filter(row => row.firstPassed && row.secondPassed).length,
    excludedItems: manifest.excludedItems, hardware: manifest.hardware ?? null,
    failureStopThreshold: manifest.failureStopThreshold ?? null, stopReason: manifest.stopReason ?? null,
    algorithmSource: manifest.algorithmSource ? { reference: manifest.algorithmSource.reference, commit: manifest.algorithmSource.commit,
      moduleHash: manifest.algorithmSource.moduleHash } : null,
    selectedItemIds: manifest.selectedItemIds ?? null,
  });
}

/** 只有 Host 正式验收后发布的曲线点才构成首解/次解；阶段最佳不冒充最早首解。 */
export function measureMilestones(progress) {
  const history = progress?.areaHistory ?? [];
  let previous = -1;
  for (const point of history) {
    if (!Number.isSafeInteger(point.evaluatedProposals) || point.evaluatedProposals <= 0
      || point.evaluatedProposals < previous || !Number.isSafeInteger(point.bestArea) || point.bestArea <= 0) throw new Error("Host 面积曲线无效或不是冷启动。");
    previous = point.evaluatedProposals;
  }
  const first = history[0], second = first && history.find(point => point.bestArea < first.bestArea);
  return {
    firstAttempts: first?.evaluatedProposals ?? null, secondAttempts: second?.evaluatedProposals ?? null,
    firstPassed: !!first && first.evaluatedProposals <= 20_000_000,
    secondPassed: !!second && second.evaluatedProposals <= 50_000_000,
  };
}
