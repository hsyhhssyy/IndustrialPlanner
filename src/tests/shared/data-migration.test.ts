import { prepareStoredJsonMigration, prepareLocalJsonMigration, MIGRATION_QUARANTINE_STORE } from "@/shared/storage/migration-records";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createDataMigrationController, installDataMigrationController, adoptIncomingDataAndReload, readDataMigrationProgress, subscribeDataMigration } from "@/shared/data-migration";
import { prepareLocalMigrationRecovery } from "@/shared/storage/local-migration-recovery";
import { prepareLocalMigrationRecovery as oldRecovery } from "../fixtures/migration/schema-6-recovery";
import { DATA_MIGRATION_LOCATION, isDataMigrationComplete, isDataMigrationSettled, writeDataMigrationCompletion } from "@/shared/storage/data-migration-state";
import { readFromIndexedDb, readRawFromIndexedDb, saveToIndexedDb } from "@/shared/storage/browser-storage";
import { LEGACY_EDA_TASK_LOCATION, EDA_TASK_LOCATION } from "@/shared/storage/eda-task-storage";
import { createFakeIndexedDbFactory } from "./fake-indexed-db";

const target = "req-041-test";
const documentLocation = { databaseName: "v3-industrial-planner", storeName: "worddocument", key: "base" };
let dispose: (() => void) | undefined;
let uninstall: (() => void) | undefined;
beforeEach(async () => {
  vi.stubGlobal("indexedDB", createFakeIndexedDbFactory());
  // 本组验证事务和恢复，浏览器 Web Locks 排队另由实际浏览器验证。
  vi.stubGlobal("navigator", { locks: { request: async (_name: string, options: unknown, action?: () => Promise<unknown>) =>
    action ? action() : (options as () => Promise<unknown>)() } });
});
afterEach(() => { uninstall?.(); dispose?.(); uninstall = undefined; dispose = undefined; localStorage.clear(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });
async function boot() {
  dispose?.();
  dispose = await prepareLocalMigrationRecovery({ schemaVersion: 7, migrationVersion: target, buildId: "new", now: 200, onInvalidated: () => {} });
}

describe("全局迁移完成协议", () => {
  it("有效完成记录不排队等待其他页面的网络同步锁", async () => {
    await boot();
    await writeDataMigrationCompletion(target, true);
    const locks = vi.spyOn(navigator.locks, "request").mockImplementation(async () => {
      throw new Error("普通启动不应等待此处的同步锁");
    });
    const prepare = vi.fn(async () => ({ jobs: [] }));
    const controller = createDataMigrationController(target, [{ prepare }]);
    uninstall = installDataMigrationController(controller);
    await controller.run();
    expect(locks).not.toHaveBeenCalled();
    expect(prepare).not.toHaveBeenCalled();
  });

  it("全部 JSON 持久化成功后才标记完成；普通刷新不重扫", async () => {
    await saveToIndexedDb(documentLocation, { schemaVersion: 6, title: "原件" });
    await boot();
    const events: string[] = [];
    const prepare = vi.fn(async () => ({ jobs: [{ label: "基地", run: async () => {
      expect(await isDataMigrationComplete(target)).toBe(false);
      await saveToIndexedDb(documentLocation, { schemaVersion: 7, title: "原件" }); events.push("write");
    } }], finish: async () => { events.push("finish"); } }));
// AI-REMOVED 2026-10-09:
// Reason: 迁移只在页面启动执行，运行期通过刷新重建工作台。
// Trigger: 用户要求迁移仅做 JSON 转换，移除仿真验收与运行态恢复。
// Evidence: REQ-041 启动、输入采纳与任务恢复调用链。
// Replacement: 启动阶段无 pause/refresh/resume
// Risk: 运行中接收旧数据将刷新页面，仿真保持停止。
// Human Review: Required
// Original code:
//     const controller = createDataMigrationController(target, [{ prepare,
//       pause: async () => { events.push("pause"); },
//       refresh: async () => { expect(await isDataMigrationComplete(target)).toBe(false); events.push("refresh"); },
//       resume: () => { events.push("resume"); },
//     }]);
    const controller = createDataMigrationController(target, [{ prepare }]);
    uninstall = installDataMigrationController(controller);
    await controller.run();
    expect(events).toEqual(["write", "finish"]);
    expect(await isDataMigrationComplete(target)).toBe(true);
    expect(readDataMigrationProgress().phase).toBe("idle");
    const scan = vi.spyOn(Storage.prototype, "key").mockImplementation(() => { throw new Error("fast path scanned storage"); });
    await boot();
    await controller.run();
    expect(scan).not.toHaveBeenCalled();
    expect(prepare).toHaveBeenCalledTimes(1);
  });

  it("无迁移内容不展示冻结遮罩；批量采纳先失效再执行且只刷新一次", async () => {
    await boot();
    const seen: boolean[] = [];
    const stop = subscribeDataMigration(() => seen.push(readDataMigrationProgress().visible));
    const refresh = vi.fn();
    const controller = createDataMigrationController(target, [{ prepare: async () => ({ jobs: [] }) }], refresh);
    uninstall = installDataMigrationController(controller);
    try {
      await controller.run();
      expect(seen.every(visible => !visible)).toBe(true);
      const write = vi.fn(async () => { expect(await isDataMigrationComplete(target)).toBe(false); });
      await adoptIncomingDataAndReload([{ label: "甲", run: write }, { label: "乙", run: write }]);
      expect(write).toHaveBeenCalledTimes(2);
      expect(refresh).toHaveBeenCalledTimes(1);
      expect(seen).toContain(true);
      expect(await isDataMigrationComplete(target)).toBe(false);
    } finally { stop(); }
  });

  it("提交失败保持冻结及未完成，重启可以重试", async () => {
    await boot();
    let fail = true;
// AI-REMOVED 2026-10-09:
// Reason: 迁移只在页面启动执行，运行期通过刷新重建工作台。
// Trigger: 用户要求迁移仅做 JSON 转换，移除仿真验收与运行态恢复。
// Evidence: REQ-041 启动、输入采纳与任务恢复调用链。
// Replacement: None
// Risk: 运行中接收旧数据将刷新页面，仿真保持停止。
// Human Review: Required
// Original code:
//     const resume = vi.fn();
    const controller = createDataMigrationController(target, [{ prepare: async () => ({ jobs: [{ label: "写回", run: async () => {
      if (fail) throw new Error("disk failure");
    } }] }) }]);
    uninstall = installDataMigrationController(controller);
    await expect(controller.run()).rejects.toThrow("disk failure");
    expect(await isDataMigrationComplete(target)).toBe(false);
    expect(readDataMigrationProgress()).toMatchObject({ phase: "failed", visible: true });
// AI-REMOVED 2026-10-09:
// Reason: 迁移只在页面启动执行，运行期通过刷新重建工作台。
// Trigger: 用户要求迁移仅做 JSON 转换，移除仿真验收与运行态恢复。
// Evidence: REQ-041 启动、输入采纳与任务恢复调用链。
// Replacement: 无运行态恢复回调
// Risk: 运行中接收旧数据将刷新页面，仿真保持停止。
// Human Review: Required
// Original code:
//     expect(resume).not.toHaveBeenCalled();
    fail = false;
    await boot();
    const retried = createDataMigrationController(target, [{ prepare: async () => ({ jobs: [] }) }]);
    await retried.run();
    expect(await isDataMigrationComplete(target)).toBe(true);
  });

  it("固定旧 fallback 恢复 6 原件、清除新完成及 EDA 活动库，保留旧 EDA 供旧端续算", async () => {
    const old = { schemaVersion: 6, title: "原基地" };
    const task = { taskId: "old-task", title: "旧 EDA 原文" };
    await saveToIndexedDb(documentLocation, old);
    await saveToIndexedDb({ ...LEGACY_EDA_TASK_LOCATION, key: task.taskId }, task);
    dispose = await oldRecovery({ schemaVersion: 6, buildId: "old", now: 100, onInvalidated: () => {} });
    await boot();
    const controller = createDataMigrationController(target, [{ prepare: async () => ({ jobs: [{ label: "升级", run: async () => {
      await saveToIndexedDb(documentLocation, { ...old, schemaVersion: 7 });
      await saveToIndexedDb({ ...EDA_TASK_LOCATION, key: task.taskId }, { ...task, title: "新任务" });
    } }] }) }]);
    uninstall = installDataMigrationController(controller);
    await controller.run();
    dispose?.();
    dispose = await oldRecovery({ schemaVersion: 6, buildId: "old", now: 300, onInvalidated: () => {} });
    expect(await readFromIndexedDb(documentLocation)).toEqual(old);
    expect(await readFromIndexedDb(DATA_MIGRATION_LOCATION)).toBeNull();
    expect(await readFromIndexedDb({ ...EDA_TASK_LOCATION, key: task.taskId })).toBeNull();
    expect(await readFromIndexedDb({ ...LEGACY_EDA_TASK_LOCATION, key: task.taskId })).toEqual(task);
    expect(await isDataMigrationComplete(target)).toBe(false);
  });
});

it("坏记录保留原文并退出本轮；刷新使用正常数据，修复版本再迁移且不覆盖新内容", async () => {
  const bad = { schemaVersion: 6, title: "原件", oldField: true };
  const location = { ...documentLocation, key: "broken" };
  await saveToIndexedDb(location, bad);
  await saveToIndexedDb({ ...documentLocation, key: "good" }, { schemaVersion: 6, title: "正常数据" });
  await boot();
  const prepare = vi.fn((version: string) => prepareStoredJsonMigration(documentLocation, raw => {
    const value = raw as { schemaVersion: number; title: string; oldField?: boolean };
    if (value.oldField) throw new Error("旧字段暂不支持");
    return { ...value, schemaVersion: 7 };
  }, "基地", version));
  const migration = createDataMigrationController(target, [{ prepare }]);
  uninstall = installDataMigrationController(migration);
  await expect(migration.run()).rejects.toThrow("原件已保留");
  expect(await isDataMigrationComplete(target)).toBe(false);
  expect(await isDataMigrationSettled(target)).toBe(true);
  expect(await readFromIndexedDb(location)).toBeNull();
  expect(await readFromIndexedDb({ ...documentLocation, key: "good" })).toMatchObject({ schemaVersion: 7 });
  const originalLocation = { ...location, storeName: MIGRATION_QUARANTINE_STORE,
    key: JSON.stringify([location.storeName, location.key]) };
  expect(await readRawFromIndexedDb(originalLocation)).toMatchObject({ value: JSON.stringify(bad), version: target });
  uninstall(); await boot();
  const reopened = createDataMigrationController(target, [{ prepare }]);
  uninstall = installDataMigrationController(reopened);
  await reopened.run();
  expect(prepare).toHaveBeenCalledTimes(1);
  expect(readDataMigrationProgress().visible).toBe(false);
  await writeDataMigrationCompletion(target, false);
  const rescan = createDataMigrationController(target, [{ prepare }]);
  await expect(rescan.run()).rejects.toThrow("原件已保留");
  expect(await isDataMigrationComplete(target)).toBe(false);
  expect(await isDataMigrationSettled(target)).toBe(true);
  expect(await readRawFromIndexedDb(originalLocation)).toMatchObject({ value: JSON.stringify(bad), version: target });
  const fixed = await prepareStoredJsonMigration(documentLocation, raw => ({ ...(raw as object), schemaVersion: 7 }), "基地", "fixed");
  for (const job of fixed.jobs) await job.run();
  expect(await readFromIndexedDb(location)).toEqual({ ...bad, schemaVersion: 7 });
  expect(await readRawFromIndexedDb(originalLocation)).toBeNull();
});

it("同键已被用户重新创建时保留隔离原件，不覆盖用户的新内容", async () => {
  await boot();
  await saveToIndexedDb(documentLocation, { title: "原件" });
  const failed = await prepareStoredJsonMigration(documentLocation, () => null, "基地", "broken");
  for (const job of failed.jobs) await job.run();
  await saveToIndexedDb(documentLocation, { title: "新内容" });
  const fixed = await prepareStoredJsonMigration(documentLocation, value => value, "基地", "fixed");
  for (const job of fixed.jobs) await job.run();
  expect(fixed.issues).toHaveLength(1);
  expect(await readFromIndexedDb(documentLocation)).toEqual({ title: "新内容" });
  expect(await readRawFromIndexedDb({ ...documentLocation, storeName: MIGRATION_QUARANTINE_STORE,
    key: JSON.stringify([documentLocation.storeName, documentLocation.key]) })).toMatchObject({ value: JSON.stringify({ title: "原件" }) });
});

it("设置原件在同版本重扫仍未完成；新设置升级不得删除隔离原件", async () => {
  const key = "migration-settings";
  const raw = '{"oldField":true}';
  localStorage.setItem(key, raw);
  const failed = await prepareLocalJsonMigration(key, () => { throw new Error("旧字段不支持"); }, "设置", target);
  for (const job of failed.jobs) await job.run();
  expect(localStorage.getItem(key)).toBeNull();
  const rescan = await prepareLocalJsonMigration(key, value => value, "设置", target);
  expect(rescan.jobs).toHaveLength(0);
  expect(rescan.issues).toHaveLength(1);
  localStorage.setItem(key, JSON.stringify({ title: "新设置" }));
  const next = await prepareLocalJsonMigration(key, value => ({ ...(value as object), schemaVersion: 7 }), "设置", "fixed");
  for (const job of next.jobs) await job.run();
  expect(next.issues).toHaveLength(1);
  expect(JSON.parse(localStorage.getItem(key)!)).toEqual({ title: "新设置", schemaVersion: 7 });
  expect(await readRawFromIndexedDb({ databaseName: "v3-industrial-planner", storeName: MIGRATION_QUARANTINE_STORE,
    key: JSON.stringify(["localStorage", key]) })).toMatchObject({ value: raw, version: target });
});
