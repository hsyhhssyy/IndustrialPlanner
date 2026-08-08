import { afterEach, describe, expect, it, vi } from "vitest";

import {
  BLUEPRINT_SCHEMA_VERSION,
  createBlueprintDocument,
} from "@/domain/document/blueprint-document";
import {
  readFromIndexedDb,
  saveToIndexedDb,
} from "@/shared/storage/browser-storage";
import {
  BLUEPRINT_STORE_LOCATION,
  canDeleteBlueprintFolder,
  createBlueprintFolder,
  deleteBlueprintFolder,
  deleteBlueprintDocument,
  listBlueprintDirectory,
  listBlueprintSyncEntries,
  readBlueprintFolder,
  readBlueprintRecord,
  renameBlueprintFolder,
  saveBlueprintDocument,
} from "@/shared/storage/blueprint-storage";
import { writeActiveSyncTombstone } from "@/shared/storage/sync-tombstone-storage";
import { createFakeIndexedDbFactory } from "./fake-indexed-db";

afterEach(() => {
  localStorage.clear();
  vi.unstubAllGlobals();
});

describe("blueprint-storage", () => {
  it("persists and reads blueprint documents", async () => {
    vi.stubGlobal("indexedDB", createFakeIndexedDbFactory());

    const blueprint = createTestBlueprint({
      name: "仓储总线",
      description: "四路汇流测试",
    });

    const saved = await saveBlueprintDocument(blueprint);

    expect(saved).toMatchObject({
      kind: "blueprint",
      blueprintId: blueprint.blueprintId,
      name: "仓储总线",
      description: "四路汇流测试",
      parentFolderId: null,
    });

    await expect(readBlueprintRecord(blueprint.blueprintId)).resolves.toEqual(saved);
    const persisted = await readFromIndexedDb<Record<string, unknown>>({
      ...BLUEPRINT_STORE_LOCATION,
      key: `blueprint:${blueprint.blueprintId}`,
    });
    expect(persisted).not.toHaveProperty("deletedAt");
  });

  it("migrates historical device ids when reading blueprint records", async () => {
    vi.stubGlobal("indexedDB", createFakeIndexedDbFactory());

    const blueprint = createTestBlueprint({
      blueprintId: "historical-device-blueprint",
      entities: {
        pool: {
          id: "pool",
          definitionId: "item_port_mix_pool_large_1",
          position: { x: 10, y: 12 },
          rotation: 0,
          config: {},
          tags: [],
        },
      },
      entityOrder: ["pool"],
    });

    await saveToIndexedDb(
      {
        ...BLUEPRINT_STORE_LOCATION,
        key: `blueprint:${blueprint.blueprintId}`,
      },
      {
        ...blueprint,
        schemaVersion: 1,
        kind: "blueprint" as const,
        parentFolderId: null,
        deletedAt: null,
      },
    );

    const record = await readBlueprintRecord(blueprint.blueprintId);

    expect(record?.schemaVersion).toBe(BLUEPRINT_SCHEMA_VERSION);
    expect(record?.entities.pool?.definitionId).toBe("mix_pool_2");
  });

  it("reads folders directly and rejects non-folder entries", async () => {
    vi.stubGlobal("indexedDB", createFakeIndexedDbFactory());

    const folder = await createBlueprintFolder({
      name: "直接读取目录",
    });

    expect(folder).not.toBeNull();
    await expect(readBlueprintFolder(folder?.folderId ?? "")).resolves.toEqual(folder);

    const conflictedId = "conflicted-entry";
    await saveToIndexedDb(
      {
        ...BLUEPRINT_STORE_LOCATION,
        key: `folder:${conflictedId}`,
      },
      {
        ...createTestBlueprint({
          blueprintId: conflictedId,
          name: "伪目录蓝图",
        }),
        kind: "blueprint" as const,
        parentFolderId: null,
        deletedAt: null,
      },
    );

    await expect(readBlueprintFolder(conflictedId)).resolves.toBeNull();
  });

  it("lists folders and blueprints by parent folder", async () => {
    vi.stubGlobal("indexedDB", createFakeIndexedDbFactory());

    const rootFolder = await createBlueprintFolder({
      name: "总线蓝图",
    });

    expect(rootFolder).not.toBeNull();

    const nestedFolder = await createBlueprintFolder({
      name: "炼油分支",
      parentFolderId: rootFolder?.folderId,
    });

    expect(nestedFolder).not.toBeNull();

    await saveBlueprintDocument(
      createTestBlueprint({
        name: "仓储总线样例",
      }),
      { parentFolderId: rootFolder?.folderId },
    );

    await saveBlueprintDocument(
      createTestBlueprint({
        name: "炼油总线样例",
      }),
      { parentFolderId: nestedFolder?.folderId },
    );

    await expect(listBlueprintDirectory(null)).resolves.toMatchObject({
      parentFolderId: null,
      folders: [
        {
          name: "总线蓝图",
        },
      ],
      blueprints: [],
    });

    await expect(listBlueprintDirectory(rootFolder?.folderId ?? null)).resolves.toMatchObject({
      parentFolderId: rootFolder?.folderId ?? null,
      folders: [
        {
          name: "炼油分支",
        },
      ],
      blueprints: [
        {
          name: "仓储总线样例",
        },
      ],
    });
  });

  it("keeps logically deleted blueprints out of default listings", async () => {
    vi.stubGlobal("indexedDB", createFakeIndexedDbFactory());
    localStorage.setItem("v3-sync-provider", "webdav");

    const blueprint = createTestBlueprint({
      name: "待删除蓝图",
    });

    await saveBlueprintDocument(blueprint);
    const deleted = await deleteBlueprintDocument(blueprint.blueprintId);

    expect(deleted).not.toHaveProperty("deletedAt");
    await expect(readBlueprintRecord(blueprint.blueprintId)).resolves.toBeNull();
    await expect(readBlueprintRecord(blueprint.blueprintId)).resolves.toBeNull();
    const syncEntries = await listBlueprintSyncEntries("blueprint");
    expect(syncEntries).toMatchObject([
      {
        id: blueprint.blueprintId,
        value: { blueprintId: blueprint.blueprintId },
        deletedAt: expect.any(String),
      },
    ]);
    expect(syncEntries[0]?.value).not.toHaveProperty("deletedAt");
    await expect(listBlueprintDirectory()).resolves.toMatchObject({
      folders: [],
      blueprints: [],
    });
  });

  it("renames folders and updates their directory listings", async () => {
    vi.stubGlobal("indexedDB", createFakeIndexedDbFactory());

    const folder = await createBlueprintFolder({
      name: "旧目录名",
    });

    expect(folder).not.toBeNull();

    const renamedFolder = await renameBlueprintFolder({
      folderId: folder?.folderId ?? "",
      name: "新目录名",
    });

    expect(renamedFolder).toMatchObject({
      folderId: folder?.folderId,
      name: "新目录名",
    });
    await expect(readBlueprintFolder(folder?.folderId ?? "")).resolves.toMatchObject({
      folderId: folder?.folderId,
      name: "新目录名",
    });
    await expect(listBlueprintDirectory(null)).resolves.toMatchObject({
      folders: [
        {
          folderId: folder?.folderId,
          name: "新目录名",
        },
      ],
      blueprints: [],
    });
  });

  it("rejects deleting folders that still contain nested folders or blueprints", async () => {
    vi.stubGlobal("indexedDB", createFakeIndexedDbFactory());

    const rootFolder = await createBlueprintFolder({
      name: "待删除总线",
    });
    const nestedFolder = await createBlueprintFolder({
      name: "待删除子目录",
      parentFolderId: rootFolder?.folderId,
    });
    const rootBlueprint = createTestBlueprint({
      blueprintId: "root-folder-blueprint",
      name: "根目录蓝图",
    });
    const nestedBlueprint = createTestBlueprint({
      blueprintId: "nested-folder-blueprint",
      name: "子目录蓝图",
    });

    await saveBlueprintDocument(rootBlueprint, {
      parentFolderId: rootFolder?.folderId,
    });
    await saveBlueprintDocument(nestedBlueprint, {
      parentFolderId: nestedFolder?.folderId,
    });

    await expect(canDeleteBlueprintFolder(rootFolder?.folderId ?? "")).resolves.toBe(false);

    const deletedFolder = await deleteBlueprintFolder(rootFolder?.folderId ?? "");

    expect(deletedFolder).toBeNull();
    await expect(readBlueprintFolder(rootFolder?.folderId ?? "")).resolves.toMatchObject({
      folderId: rootFolder?.folderId,
    });
    await expect(readBlueprintFolder(nestedFolder?.folderId ?? "")).resolves.toMatchObject({
      folderId: nestedFolder?.folderId,
    });
    await expect(readBlueprintRecord(rootBlueprint.blueprintId)).resolves.toMatchObject({
      blueprintId: rootBlueprint.blueprintId,
    });
    await expect(readBlueprintRecord(nestedBlueprint.blueprintId)).resolves.toMatchObject({
      blueprintId: nestedBlueprint.blueprintId,
    });
    await expect(listBlueprintDirectory(null)).resolves.toMatchObject({
      folders: [
        {
          folderId: rootFolder?.folderId,
          name: "待删除总线",
        },
      ],
      blueprints: [],
    });
  });

  it("deletes empty folders", async () => {
    vi.stubGlobal("indexedDB", createFakeIndexedDbFactory());
    localStorage.setItem("v3-sync-provider", "webdav");

    const folder = await createBlueprintFolder({
      name: "空目录",
    });

    await expect(canDeleteBlueprintFolder(folder?.folderId ?? "")).resolves.toBe(true);

    const deletedFolder = await deleteBlueprintFolder(folder?.folderId ?? "");

    expect(deletedFolder).not.toHaveProperty("deletedAt");
    await expect(readBlueprintFolder(folder?.folderId ?? "")).resolves.toBeNull();
    await expect(readBlueprintFolder(folder?.folderId ?? "")).resolves.toBeNull();
    await expect(listBlueprintSyncEntries("folder")).resolves.toMatchObject([
      {
        id: folder?.folderId,
        value: { folderId: folder?.folderId },
        deletedAt: expect.any(String),
      },
    ]);
    await expect(listBlueprintDirectory(null)).resolves.toMatchObject({
      folders: [],
      blueprints: [],
    });
  });

  it("purges blueprints that have been deleted for at least 30 days", async () => {
    vi.stubGlobal("indexedDB", createFakeIndexedDbFactory());
    localStorage.setItem("v3-sync-provider", "webdav");

    const expiredDeletedBlueprint = createTestBlueprint({
      blueprintId: "expired-deleted-blueprint",
      name: "过期已删除蓝图",
    });
    const retainedDeletedBlueprint = createTestBlueprint({
      blueprintId: "retained-deleted-blueprint",
      name: "未过期已删除蓝图",
    });

    await writeActiveSyncTombstone({
      adapterId: "blueprint-folders",
      assetId: "expired-deleted-folder",
      deletedAt: "2026-04-08T11:59:59.000Z",
      value: {
        schemaVersion: 1,
        kind: "folder" as const,
        folderId: "expired-deleted-folder",
        name: "过期已删除目录",
        parentFolderId: null,
        createdAt: "2026-04-01T10:00:00.000Z",
        updatedAt: "2026-04-08T11:59:59.000Z",
        deletedAt: "2026-04-08T11:59:59.000Z",
      },
    });
    await writeActiveSyncTombstone({
      adapterId: "blueprint-folders",
      assetId: "retained-deleted-folder",
      deletedAt: "2026-04-10T12:00:01.000Z",
      value: {
        schemaVersion: 1,
        kind: "folder" as const,
        folderId: "retained-deleted-folder",
        name: "未过期已删除目录",
        parentFolderId: null,
        createdAt: "2026-04-01T10:00:00.000Z",
        updatedAt: "2026-04-10T12:00:01.000Z",
        deletedAt: "2026-04-10T12:00:01.000Z",
      },
    });
    await writeActiveSyncTombstone({
      adapterId: "blueprints",
      assetId: expiredDeletedBlueprint.blueprintId,
      deletedAt: "2026-04-08T11:59:59.000Z",
      value: {
        ...expiredDeletedBlueprint,
        kind: "blueprint" as const,
        parentFolderId: null,
        deletedAt: "2026-04-08T11:59:59.000Z",
      },
    });
    await writeActiveSyncTombstone({
      adapterId: "blueprints",
      assetId: retainedDeletedBlueprint.blueprintId,
      deletedAt: "2026-04-10T12:00:01.000Z",
      value: {
        ...retainedDeletedBlueprint,
        kind: "blueprint" as const,
        parentFolderId: null,
        deletedAt: "2026-04-10T12:00:01.000Z",
      },
    });

    vi.setSystemTime(new Date("2026-05-10T12:00:00.000Z"));

    await expect(listBlueprintSyncEntries("blueprint")).resolves.toMatchObject([
      {
        id: retainedDeletedBlueprint.blueprintId,
        deletedAt: "2026-04-10T12:00:01.000Z",
      },
    ]);
    await expect(listBlueprintSyncEntries("folder")).resolves.toMatchObject([
      {
        id: "retained-deleted-folder",
        deletedAt: "2026-04-10T12:00:01.000Z",
      },
    ]);
    await expect(listBlueprintDirectory()).resolves.toMatchObject({
      folders: [],
      blueprints: [],
    });
  });

  it("preserves the existing folder when updating a blueprint without a new parent", async () => {
    vi.stubGlobal("indexedDB", createFakeIndexedDbFactory());

    const folder = await createBlueprintFolder({
      name: "总线样例",
    });

    expect(folder).not.toBeNull();

    const blueprint = createTestBlueprint({
      name: "初版蓝图",
    });

    await saveBlueprintDocument(blueprint, {
      parentFolderId: folder?.folderId,
    });

    await saveBlueprintDocument({
      ...blueprint,
      name: "二版蓝图",
      updatedAt: new Date("2026-05-08T04:00:00.000Z").toISOString(),
    });

    await expect(listBlueprintDirectory(folder?.folderId ?? null)).resolves.toMatchObject({
      parentFolderId: folder?.folderId ?? null,
      folders: [],
      blueprints: [
        {
          name: "二版蓝图",
          parentFolderId: folder?.folderId,
        },
      ],
    });
  });

  it("rejects writes into a missing parent folder", async () => {
    vi.stubGlobal("indexedDB", createFakeIndexedDbFactory());

    await expect(
      saveBlueprintDocument(createTestBlueprint(), {
        parentFolderId: "missing-folder",
      }),
    ).resolves.toBeNull();
  });

  it("returns null when IndexedDB write is unavailable", async () => {
    vi.stubGlobal("indexedDB", undefined);

    await expect(createBlueprintFolder({ name: "不可写目录" })).resolves.toBeNull();
    await expect(saveBlueprintDocument(createTestBlueprint())).resolves.toBeNull();
  });
});

function createTestBlueprint(overrides: Partial<ReturnType<typeof createBlueprintDocument>> = {}) {
  return createBlueprintDocument({
    name: "蓝图样例",
    description: "",
    baseId: "wuling_protocol_core",
    initialGridPoint: { x: 10, y: 12 },
    entities: {
      assembler_1: {
        id: "assembler_1",
        definitionId: "assembler",
        position: { x: 10, y: 12 },
        rotation: 0,
        config: {},
        tags: [],
      },
    },
    entityOrder: ["assembler_1"],
    slotLinks: [],
    ...overrides,
  });
}
