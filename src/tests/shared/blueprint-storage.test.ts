import { afterEach, describe, expect, it, vi } from "vitest";

import { createBlueprintDocument } from "@/domain/document/blueprint-document";
import { saveToIndexedDb } from "@/shared/storage/browser-storage";
import {
  BLUEPRINT_STORE_LOCATION,
  createBlueprintFolder,
  deleteBlueprintFolder,
  deleteBlueprintDocument,
  listBlueprintDirectory,
  readBlueprintFolder,
  readBlueprintRecord,
  renameBlueprintFolder,
  saveBlueprintDocument,
} from "@/shared/storage/blueprint-storage";
import { createFakeIndexedDbFactory } from "./fake-indexed-db";

afterEach(() => {
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
      deletedAt: null,
    });

    await expect(readBlueprintRecord(blueprint.blueprintId)).resolves.toEqual(saved);
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

    const blueprint = createTestBlueprint({
      name: "待删除蓝图",
    });

    await saveBlueprintDocument(blueprint);
    const deleted = await deleteBlueprintDocument(blueprint.blueprintId);

    expect(deleted?.deletedAt).not.toBeNull();
    await expect(readBlueprintRecord(blueprint.blueprintId)).resolves.toBeNull();
    await expect(
      readBlueprintRecord(blueprint.blueprintId, { includeDeleted: true }),
    ).resolves.toEqual(deleted);
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

  it("recursively deletes folders together with nested folders and blueprints", async () => {
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

    const deletedFolder = await deleteBlueprintFolder(rootFolder?.folderId ?? "");

    expect(deletedFolder?.deletedAt).not.toBeNull();
    await expect(readBlueprintFolder(rootFolder?.folderId ?? "")).resolves.toBeNull();
    await expect(readBlueprintFolder(nestedFolder?.folderId ?? "")).resolves.toBeNull();
    await expect(readBlueprintRecord(rootBlueprint.blueprintId)).resolves.toBeNull();
    await expect(readBlueprintRecord(nestedBlueprint.blueprintId)).resolves.toBeNull();
    await expect(
      readBlueprintFolder(rootFolder?.folderId ?? "", { includeDeleted: true }),
    ).resolves.toMatchObject({
      folderId: rootFolder?.folderId,
      deletedAt: deletedFolder?.deletedAt,
    });
    await expect(listBlueprintDirectory(null)).resolves.toMatchObject({
      folders: [],
      blueprints: [],
    });
  });

  it("purges blueprints that have been deleted for at least 30 days", async () => {
    vi.stubGlobal("indexedDB", createFakeIndexedDbFactory());

    const expiredDeletedBlueprint = createTestBlueprint({
      blueprintId: "expired-deleted-blueprint",
      name: "过期已删除蓝图",
    });
    const retainedDeletedBlueprint = createTestBlueprint({
      blueprintId: "retained-deleted-blueprint",
      name: "未过期已删除蓝图",
    });

    await saveToIndexedDb(
      {
        ...BLUEPRINT_STORE_LOCATION,
        key: "folder:expired-deleted-folder",
      },
      {
        schemaVersion: 1,
        kind: "folder" as const,
        folderId: "expired-deleted-folder",
        name: "过期已删除目录",
        parentFolderId: null,
        createdAt: "2026-04-01T10:00:00.000Z",
        updatedAt: "2026-04-08T11:59:59.000Z",
        deletedAt: "2026-04-08T11:59:59.000Z",
      },
    );
    await saveToIndexedDb(
      {
        ...BLUEPRINT_STORE_LOCATION,
        key: "folder:retained-deleted-folder",
      },
      {
        schemaVersion: 1,
        kind: "folder" as const,
        folderId: "retained-deleted-folder",
        name: "未过期已删除目录",
        parentFolderId: null,
        createdAt: "2026-04-01T10:00:00.000Z",
        updatedAt: "2026-04-10T12:00:01.000Z",
        deletedAt: "2026-04-10T12:00:01.000Z",
      },
    );
    await saveToIndexedDb(
      {
        ...BLUEPRINT_STORE_LOCATION,
        key: `blueprint:${expiredDeletedBlueprint.blueprintId}`,
      },
      {
        ...expiredDeletedBlueprint,
        kind: "blueprint" as const,
        parentFolderId: null,
        deletedAt: "2026-04-08T11:59:59.000Z",
      },
    );
    await saveToIndexedDb(
      {
        ...BLUEPRINT_STORE_LOCATION,
        key: `blueprint:${retainedDeletedBlueprint.blueprintId}`,
      },
      {
        ...retainedDeletedBlueprint,
        kind: "blueprint" as const,
        parentFolderId: null,
        deletedAt: "2026-04-10T12:00:01.000Z",
      },
    );

    vi.setSystemTime(new Date("2026-05-10T12:00:00.000Z"));

    await expect(
      readBlueprintRecord(expiredDeletedBlueprint.blueprintId, { includeDeleted: true }),
    ).resolves.toBeNull();
    await expect(
      readBlueprintFolder("expired-deleted-folder", { includeDeleted: true }),
    ).resolves.toBeNull();
    await expect(
      readBlueprintRecord(retainedDeletedBlueprint.blueprintId, { includeDeleted: true }),
    ).resolves.toMatchObject({
      blueprintId: retainedDeletedBlueprint.blueprintId,
      deletedAt: "2026-04-10T12:00:01.000Z",
    });
    await expect(
      readBlueprintFolder("retained-deleted-folder", { includeDeleted: true }),
    ).resolves.toMatchObject({
      folderId: "retained-deleted-folder",
      deletedAt: "2026-04-10T12:00:01.000Z",
    });
    await expect(listBlueprintDirectory(null, { includeDeleted: true })).resolves.toMatchObject({
      folders: [
        {
          folderId: "retained-deleted-folder",
        },
      ],
      blueprints: [
        {
          blueprintId: retainedDeletedBlueprint.blueprintId,
        },
      ],
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