import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { prepareBlueprintLibraryMigration } from "@/shared/blueprint-library-migration";
import { BLUEPRINT_STORE_LOCATION } from "@/shared/storage/blueprint-storage";
import { readFromIndexedDb, saveToIndexedDb } from "@/shared/storage/browser-storage";
import { subscribeToStorageChanges } from "@/shared/storage/storage-change-event";
import { createFakeIndexedDbFactory } from "./fake-indexed-db";
import fixture from "../fixtures/blueprints/common/dummy-world.schema6.json";

beforeEach(() => { vi.stubGlobal("indexedDB", createFakeIndexedDbFactory()); });
afterEach(() => { localStorage.clear(); vi.unstubAllGlobals(); });

it("全库升级包含目录中的旧蓝图，保留真实存储主键并按业务 ID 通知同步", async () => {
  const folder = { schemaVersion: 6, kind: "folder", folderId: "folder-id", name: "目录",
    parentFolderId: null, createdAt: "2026-10-08T00:00:00.000Z", updatedAt: "2026-10-08T00:00:00.000Z" };
  const blueprint = { ...fixture, kind: "blueprint", blueprintId: "blueprint-id", parentFolderId: folder.folderId };
  const folderLocation = { ...BLUEPRINT_STORE_LOCATION, key: "folder:folder-id" };
  const blueprintLocation = { ...BLUEPRINT_STORE_LOCATION, key: "blueprint:blueprint-id" };
  await saveToIndexedDb(folderLocation, folder);
  await saveToIndexedDb(blueprintLocation, blueprint);
  const changed = vi.fn();
  const stop = subscribeToStorageChanges(changed);
  try {
    const plan = await prepareBlueprintLibraryMigration();
    expect(plan.jobs).toHaveLength(2);
    expect(await readFromIndexedDb(blueprintLocation)).toEqual(blueprint);
    for (const job of plan.jobs) await job.run();
    expect(await readFromIndexedDb(folderLocation)).toEqual({ ...folder, schemaVersion: 7 });
    expect(await readFromIndexedDb(blueprintLocation)).toMatchObject({ ...blueprint, schemaVersion: 7 });
    expect(changed).toHaveBeenCalledWith(expect.objectContaining({ assetType: "blueprint-folder", assetId: "folder-id", origin: "local" }));
    expect(changed).toHaveBeenCalledWith(expect.objectContaining({ assetType: "blueprint", assetId: "blueprint-id", origin: "local" }));
    expect((await prepareBlueprintLibraryMigration()).jobs).toHaveLength(0);
  } finally { stop(); }
});
