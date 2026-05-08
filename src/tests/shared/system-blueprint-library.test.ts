import { afterEach, describe, expect, it, vi } from "vitest";

import { createBlueprintDocument } from "@/domain/document/blueprint-document";
import {
  listSystemBlueprintDirectory,
  readSystemBlueprintLibrary,
} from "@/shared/blueprints/system-blueprint-library";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("system-blueprint-library", () => {
  it("reads an empty system blueprint index", async () => {
    vi.stubGlobal("fetch", createFetchStub({
      "/blueprints/index.json": {
        version: "v1.3.0",
        folders: [],
      },
    }));

    const snapshot = await readSystemBlueprintLibrary();

    expect(snapshot.version).toBe("v1.3.0");
    expect(listSystemBlueprintDirectory(snapshot, null)).toEqual({
      parentFolderId: null,
      folders: [],
      blueprints: [],
    });
  });

  it("loads nested system blueprint folders from the public index", async () => {
    vi.stubGlobal("fetch", createFetchStub({
      "/blueprints/index.json": {
        version: "v1.3.0",
        folders: [
          {
            name: "总线蓝图",
            blueprints: ["storage-bus"],
            subfolders: [
              {
                name: "炼油分支",
                blueprints: ["refinery-bus"],
              },
            ],
          },
          {
            name: "空目录",
            blueprints: [],
          },
        ],
      },
      "/blueprints/storage-bus.json": createTestBlueprint({
        blueprintId: "system-storage-bus",
        name: "仓储总线样例",
        description: "四路汇流",
        updatedAt: "2026-05-08T02:00:00.000Z",
      }),
      "/blueprints/refinery-bus.json": createTestBlueprint({
        blueprintId: "system-refinery-bus",
        name: "炼油总线样例",
        description: "双线回流",
        updatedAt: "2026-05-08T03:00:00.000Z",
      }),
    }));

    const snapshot = await readSystemBlueprintLibrary();
    const rootDirectory = listSystemBlueprintDirectory(snapshot, null);
    const rootFolderId = encodeURIComponent("总线蓝图");
    const nestedFolderId = `${rootFolderId}/${encodeURIComponent("炼油分支")}`;
    const rootFolderDirectory = listSystemBlueprintDirectory(snapshot, rootFolderId);
    const nestedDirectory = listSystemBlueprintDirectory(snapshot, nestedFolderId);

    expect(rootDirectory.folders.map((folder) => folder.name)).toEqual(["总线蓝图", "空目录"]);
    expect(rootFolderDirectory.blueprints).toMatchObject([
      {
        blueprintId: "system-storage-bus",
        name: "仓储总线样例",
        parentFolderId: rootFolderId,
        sourcePath: "storage-bus.json",
      },
    ]);
    expect(rootFolderDirectory.folders).toMatchObject([
      {
        folderId: nestedFolderId,
        parentFolderId: rootFolderId,
        name: "炼油分支",
      },
    ]);
    expect(nestedDirectory.blueprints).toMatchObject([
      {
        blueprintId: "system-refinery-bus",
        name: "炼油总线样例",
        parentFolderId: nestedFolderId,
        sourcePath: "refinery-bus.json",
      },
    ]);
  });
});

function createFetchStub(payloads: Record<string, unknown>) {
  return vi.fn(async (input: string | URL | Request) => {
    const path = normalizeFetchPath(input);
    const payload = payloads[path];

    if (payload === undefined) {
      return {
        ok: false,
        status: 404,
        json: async () => null,
      } as Response;
    }

    return {
      ok: true,
      status: 200,
      json: async () => payload,
    } as Response;
  });
}

function normalizeFetchPath(input: string | URL | Request): string {
  if (typeof input === "string") {
    return new URL(input, "https://placeholder.local").pathname;
  }

  if (input instanceof URL) {
    return input.pathname;
  }

  return new URL(input.url, "https://placeholder.local").pathname;
}

function createTestBlueprint(
  overrides: Partial<ReturnType<typeof createBlueprintDocument>> = {},
) {
  return createBlueprintDocument({
    blueprintId: "system-blueprint",
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
    createdAt: "2026-05-08T01:00:00.000Z",
    updatedAt: "2026-05-08T01:00:00.000Z",
    ...overrides,
  });
}