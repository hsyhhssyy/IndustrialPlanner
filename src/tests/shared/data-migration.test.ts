import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createDataMigrationController, installDataMigrationController, migrateIncomingData, readDataMigrationProgress, subscribeDataMigration } from "@/shared/data-migration";
import { prepareLocalMigrationRecovery } from "@/shared/storage/local-migration-recovery";
import { prepareLocalMigrationRecovery as oldRecovery } from "../fixtures/migration/schema-6-recovery";
import { DATA_MIGRATION_LOCATION, isDataMigrationComplete } from "@/shared/storage/data-migration-state";
import { readFromIndexedDb, saveToIndexedDb } from "@/shared/storage/browser-storage";
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
  it("全部持久化及缓存刷新成功后才标记完成；刷新只读少量状态", async () => {
    await saveToIndexedDb(documentLocation, { schemaVersion: 6, title: "原件" });
    await boot();
    const events: string[] = [];
    const prepare = vi.fn(async () => ({ jobs: [{ label: "基地", run: async () => {
      expect(await isDataMigrationComplete(target)).toBe(false);
      await saveToIndexedDb(documentLocation, { schemaVersion: 7, title: "原件" }); events.push("write");
    } }], finish: async () => { events.push("finish"); } }));
    const controller = createDataMigrationController(target, [{ prepare,
      pause: async () => { events.push("pause"); },
      refresh: async () => { expect(await isDataMigrationComplete(target)).toBe(false); events.push("refresh"); },
      resume: () => { events.push("resume"); },
    }]);
    uninstall = installDataMigrationController(controller);
    await controller.run();
    expect(events).toEqual(["pause", "write", "finish", "refresh", "resume"]);
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
    const refresh = vi.fn(async () => {});
    const controller = createDataMigrationController(target, [{ prepare: async () => ({ jobs: [] }), refresh }]);
    uninstall = installDataMigrationController(controller);
    try {
      await controller.run();
      expect(seen.every(visible => !visible)).toBe(true);
      const write = vi.fn(async () => { expect(await isDataMigrationComplete(target)).toBe(false); });
      await migrateIncomingData([{ label: "甲", run: write }, { label: "乙", run: write }]);
      expect(write).toHaveBeenCalledTimes(2);
      expect(refresh).toHaveBeenCalledTimes(2);
      expect(seen).toContain(true);
      expect(await isDataMigrationComplete(target)).toBe(true);
    } finally { stop(); }
  });

  it("提交失败保持冻结及未完成，重启可以重试", async () => {
    await boot();
    let fail = true;
    const resume = vi.fn();
    const controller = createDataMigrationController(target, [{ prepare: async () => ({ jobs: [{ label: "写回", run: async () => {
      if (fail) throw new Error("disk failure");
    } }] }), resume }]);
    uninstall = installDataMigrationController(controller);
    await expect(controller.run()).rejects.toThrow("disk failure");
    expect(await isDataMigrationComplete(target)).toBe(false);
    expect(readDataMigrationProgress()).toMatchObject({ phase: "failed", visible: true });
    expect(resume).not.toHaveBeenCalled();
    fail = false;
    await boot();
    await controller.run();
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
