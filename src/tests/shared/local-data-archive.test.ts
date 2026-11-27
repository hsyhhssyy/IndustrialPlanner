import { Blob as NodeBlob } from "node:buffer";
import { stringify } from "devalue";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { BLUEPRINT_SCHEMA_VERSION } from "@/domain/document/blueprint-document";
import { createLocalDataArchive, importLocalDataArchive, prepareLocalDataArchive, readLocalDataArchive } from "@/shared/local-data-archive";
import { LogCollectorStorage } from "@/shared/logging/log-collector-storage";
import { applyRawIndexedDbTransactionMutations, readRawFromIndexedDb } from "@/shared/storage/browser-storage";
import { LEGACY_EDA_TASK_LOCATION } from "@/shared/storage/eda-task-storage";
import { prepareLocalMigrationRecovery } from "@/shared/storage/local-migration-recovery";
import { RECOVERY_DATABASE, RECOVERY_STORE, RECOVERY_STATE_KEY } from "@/shared/storage/storage-generation";
import { requestSyncProvider } from "@/shared/storage/sync-provider-activation";
import { writeSyncConnectionSettings } from "@/sync/storage/sync-connection-settings";
import { createFakeIdbKeyRangeFactory, createFakeIndexedDbFactory } from "./fake-indexed-db";

let dispose: (() => void) | undefined;
async function boot() {
  dispose?.();
  dispose = undefined;
  dispose = await prepareLocalMigrationRecovery({ schemaVersion: BLUEPRINT_SCHEMA_VERSION, buildId: "test", onInvalidated() {} });
}
beforeEach(async () => {
  vi.stubGlobal("Blob", NodeBlob);
  vi.stubGlobal("indexedDB", createFakeIndexedDbFactory());
  vi.stubGlobal("IDBKeyRange", createFakeIdbKeyRangeFactory());
  vi.stubGlobal("navigator", { locks: { request: (_name: string, _options: unknown, action: () => unknown) => action() } });
  await boot();
});
afterEach(() => {
  dispose?.();
  dispose = undefined;
  localStorage.clear();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

const read = (storeName: string, key: string, databaseName = RECOVERY_DATABASE) =>
  readRawFromIndexedDb({ databaseName, storeName, key });
async function put(storeName: string, key: string, value: unknown, databaseName = RECOVERY_DATABASE) {
  if (!await applyRawIndexedDbTransactionMutations({ databaseName }, [{ storeName, operations: [{ type: "put", key, value }] }])) {
    throw new Error("fixture write failed");
  }
}
async function gzip(value: unknown) {
  return new Response(new Blob([stringify(value)]).stream().pipeThrough(new CompressionStream("gzip"))).blob();
}

describe("设置中的本机数据迁移", () => {
  it("跨设备恢复已落盘的存档、凭据、共享对象、二进制、旧任务与日志，清除目标独有数据", async () => {
    const shared = { name: "同一检查点" };
    await put("eda-tasks", "source", { first: shared, second: shared });
    await put("sync-connection-settings", "settings", '{"password":"fixture-only"}');
    await put("cf-sync-upload-payloads", "one", new Uint8Array([3, 17, 255]));
    await put("tasks", "legacy", "old task", LEGACY_EDA_TASK_LOCATION.databaseName);
    localStorage.setItem("v3-cloudflare-oauth-session", "source fixture session");
    localStorage.setItem("v3-yituliu-sync:fixture", "source cursor");
    localStorage.setItem("v3-yituliu-login:source", "pending source login");
    localStorage.setItem("unrelated-app", "source private setting");
    const logs = new LogCollectorStorage();
    await logs.append({ occurredAt: 1, message: "source log", level: "info", source: "main", instanceId: "test" });
    await logs.close();

    const prepared = await prepareLocalDataArchive();
    expect(prepared.includesWebDavSettings).toBe(true);
    const archive = await createLocalDataArchive(prepared.snapshot);
    expect(Array.from(new Uint8Array(await archive.slice(0, 2).arrayBuffer()))).toEqual([0x1f, 0x8b]);
    const snapshot = await readLocalDataArchive(archive);
    expect(snapshot.local).not.toHaveProperty("unrelated-app");
    expect(snapshot.local).not.toHaveProperty("v3-yituliu-login:source");
    const task = snapshot.stores.find(store => store.name === "eda-tasks")!.entries[0]!.value as { first: object; second: object };
    expect(task.first).toBe(task.second);

    dispose?.(); dispose = undefined;
    vi.stubGlobal("indexedDB", createFakeIndexedDbFactory());
    localStorage.clear();
    await boot();
    localStorage.setItem("v3-user-settings-dialog", "destination only");
    localStorage.setItem("v3-yituliu-login:target", "pending target login");
    localStorage.setItem("unrelated-app", "retain");
    await put("worddocument", "target", "destination only");
    await importLocalDataArchive(snapshot);
    // 模拟关闭后重新启动。确认时仅写入意图，业务启动前才整体替换。
    expect(await read("worddocument", "target")).toBe("destination only");
    await boot();
    expect(await read("worddocument", "target")).toBeNull();
    expect(await read("sync-connection-settings", "settings")).toBe('{"password":"fixture-only"}');
    expect(await read("cf-sync-upload-payloads", "one")).toEqual(new Uint8Array([3, 17, 255]));
    expect(await read("tasks", "legacy", LEGACY_EDA_TASK_LOCATION.databaseName)).toBe("old task");
    expect(localStorage.getItem("v3-cloudflare-oauth-session")).toBe("source fixture session");
    expect(localStorage.getItem("v3-yituliu-sync:fixture")).toBe("source cursor");
    expect(localStorage.getItem("v3-user-settings-dialog")).toBeNull();
    expect(localStorage.getItem("v3-yituliu-login:target")).toBeNull();
    expect(localStorage.getItem("unrelated-app")).toBe("retain");
    const restoredLogs = new LogCollectorStorage();
    expect((await restoredLogs.query({ limit: 2 })).entries.map(entry => entry.message)).toEqual(["source log"]);
    await restoredLogs.close();
    await boot();
    expect(await read("worddocument", "target")).toBeNull();
  });

  it("只依据同一个归档快照中的 WebDAV 落盘配置判断提示", async () => {
    const defaults = { enabled: false, url: "", username: "", password: "", maxConcurrentRequests: 4 };
    expect(requestSyncProvider("webdav")).toBe(true);
    expect((await prepareLocalDataArchive()).includesWebDavSettings).toBe(false);
    await writeSyncConnectionSettings({ ...defaults, maxConcurrentRequests: 8 });
    expect((await prepareLocalDataArchive()).includesWebDavSettings).toBe(false);

    expect(requestSyncProvider("none")).toBe(true);
    const saved = await writeSyncConnectionSettings({ ...defaults, url: "https://backup-fixture.invalid/dav/" });
    const prepared = await prepareLocalDataArchive();
    expect(prepared.includesWebDavSettings).toBe(true);

    await writeSyncConnectionSettings(defaults);
    expect((await prepareLocalDataArchive()).includesWebDavSettings).toBe(false);
    const archive = await readLocalDataArchive(await createLocalDataArchive(prepared.snapshot));
    expect(archive.stores.find(store => store.name === "sync-connection-settings")?.entries).toEqual([
      { key: "settings", value: JSON.stringify(saved) },
    ]);

    await writeSyncConnectionSettings({ ...defaults, username: "fixture-user" });
    expect((await prepareLocalDataArchive()).includesWebDavSettings).toBe(true);
    await writeSyncConnectionSettings({ ...defaults, password: "fixture-only" });
    expect((await prepareLocalDataArchive()).includesWebDavSettings).toBe(true);
  });

  it("拒绝截断、版本不兼容、越界键和伪造的恢复指令，校验期间保留现有记录", async () => {
    await put("worddocument", "keep", "original");
    const { snapshot: captured } = await prepareLocalDataArchive();
    const archive = await createLocalDataArchive(captured);
    await expect(readLocalDataArchive(archive.slice(0, -4))).rejects.toThrow();
    const snapshot = await readLocalDataArchive(archive);
    for (const invalid of [
      { ...snapshot, schemaVersion: BLUEPRINT_SCHEMA_VERSION + 1 },
      { ...snapshot, local: { "another-app": "foreign" } },
      { ...snapshot, auxiliary: [] },
      { ...snapshot, stores: [{ name: RECOVERY_STORE, entries: [{ key: RECOVERY_STATE_KEY, value: null }] }] },
    ]) {
      const file = await gzip({ format: "industrial-planner-local-data", version: 1, snapshot: invalid });
      await expect(readLocalDataArchive(file)).rejects.toThrow();
    }
    expect(await read("worddocument", "keep")).toBe("original");
  });

  it("替换设置时遇到容量错误，恢复此前的设置并保留主库，可再启动", async () => {
    localStorage.setItem("v3-app-settings", "backup value");
    const { snapshot: captured } = await prepareLocalDataArchive();
    const snapshot = await readLocalDataArchive(await createLocalDataArchive(captured));
    localStorage.setItem("v3-app-settings", "original value");
    localStorage.setItem("v3-yituliu-login:target", "prior pending login");
    await put("worddocument", "keep", "original");
    await importLocalDataArchive(snapshot);
    const write = Storage.prototype.setItem;
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(function(this: Storage, key, value) {
      if (key === "v3-app-settings" && value === "backup value") throw new DOMException("full", "QuotaExceededError");
      write.call(this, key, value);
    });
    await expect(boot()).rejects.toThrow("已恢复原有数据");
    await boot();
    expect(localStorage.getItem("v3-app-settings")).toBe("original value");
    expect(localStorage.getItem("v3-yituliu-login:target")).toBe("prior pending login");
    expect(await read("worddocument", "keep")).toBe("original");
  });
});
