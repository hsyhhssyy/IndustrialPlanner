// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from "vitest";

import {
  createFullNoRevisionAdapter,
  createFullWithRevisionAdapter,
  createPatchCollectionWithRevisionAdapter,
  createPatchWithRevisionAdapter,
  createWebDavSyncRemote,
} from "@/sync";
import { createStableJsonHash } from "@/shared/storage/sync-shadow-storage";
import type {
  SyncAdapter,
  SyncAdapterConflict,
  SyncAdapterResult,
  SyncAdapterScope,
  SyncRemoteSession,
  WebDavResourceStat,
  WebDavStorageClient,
  WebDavTextFile,
  WebDavWriteOptions,
} from "@/sync";

class MemoryWebDavClient implements WebDavStorageClient {
  public readonly rootPath = "/industrial-planner";
  public readonly files = new Map<string, string>();
  public readonly madeDirectories: string[] = [];
  public readonly readPaths: string[] = [];

  public async exists(relativePath: string): Promise<boolean> {
    return this.files.has(relativePath);
  }

  public async makeDirectory(relativePath: string): Promise<void> {
    this.madeDirectories.push(relativePath);
  }

  public async listDirectory(_relativePath: string): Promise<WebDavResourceStat[]> {
    return [];
  }

  public async stat(_relativePath: string): Promise<WebDavResourceStat | null> {
    return null;
  }

  public async readTextFile(relativePath: string): Promise<WebDavTextFile | null> {
    this.readPaths.push(relativePath);
    const content = this.files.get(relativePath);

    return content === undefined
      ? null
      : {
        content,
        etag: null,
        lastModified: "2026-07-29T12:00:00.000Z",
      };
  }

  public async writeTextFile(
    relativePath: string,
    content: string,
    _options?: WebDavWriteOptions,
  ): Promise<boolean> {
    this.files.set(relativePath, content);

    return true;
  }

  public async deleteResource(relativePath: string): Promise<void> {
    this.files.delete(relativePath);
  }
}

async function createSession(
  client: MemoryWebDavClient,
  adapters: readonly SyncAdapter[],
): Promise<SyncRemoteSession> {
  return await createWebDavSyncRemote({ client }).beginSession({
    reason: "manual",
    collections: adapters.map((adapter) => adapter.collection),
  });
}

async function syncAdapter(
  adapter: SyncAdapter,
  client: MemoryWebDavClient,
  scope?: SyncAdapterScope,
): Promise<SyncAdapterResult> {
  const session = await createSession(client, [adapter]);

  return await adapter.sync(session, scope);
}

async function inspectAdapterConflicts(
  adapter: SyncAdapter,
  client: MemoryWebDavClient,
): Promise<readonly SyncAdapterConflict<unknown>[] | undefined> {
  const session = await createSession(client, [adapter]);

  return await adapter.inspectConflicts?.(session);
}

describe("webdav-sync-adapters", () => {
  afterEach(() => {
    localStorage.clear();
  });

  it("uploads and downloads a full-no-revision value", async () => {
    const client = new MemoryWebDavClient();
    let localValue: { count: number } | null = { count: 1 };
    const adapter = createFullNoRevisionAdapter({
      id: "planner",
      remotePath: "assets/planner-state.json",
      readLocal: async () => localValue,
      writeLocal: async (value) => {
        localValue = value;
      },
    });

    await expect(syncAdapter(adapter, client)).resolves.toMatchObject({ status: "uploaded" });
    expect(JSON.parse(client.files.get("assets/planner-state.json") ?? "null")).toEqual({ count: 1 });
    expect(client.madeDirectories).toContain("assets");

    localValue = { count: 1 };
    client.files.set("assets/planner-state.json", JSON.stringify({ count: 2 }));
    await expect(syncAdapter(adapter, client)).resolves.toMatchObject({ status: "downloaded" });
    expect(localValue).toEqual({ count: 2 });
  });

  it("uses the local value to overwrite the remote value after a conflict", async () => {
    const client = new MemoryWebDavClient();
    let localValue: { count: number } | null = { count: 1 };
    const adapter = createFullNoRevisionAdapter({
      id: "conflict-use-local",
      remotePath: "assets/conflict-use-local.json",
      readLocal: async () => localValue,
      writeLocal: async (value) => {
        localValue = value;
      },
      resolveConflict: () => "use-local",
    });

    await expect(syncAdapter(adapter, client)).resolves.toMatchObject({ status: "uploaded" });
    localValue = { count: 2 };
    client.files.set("assets/conflict-use-local.json", JSON.stringify({ count: 3 }));

    await expect(syncAdapter(adapter, client)).resolves.toMatchObject({ status: "uploaded" });
    expect(localValue).toEqual({ count: 2 });
    expect(JSON.parse(client.files.get("assets/conflict-use-local.json") ?? "null"))
      .toEqual({ count: 2 });
  });

  it("uses the remote value to discard the local value after a conflict", async () => {
    const client = new MemoryWebDavClient();
    let localValue: { count: number } | null = { count: 1 };
    const adapter = createFullNoRevisionAdapter({
      id: "conflict-use-remote",
      remotePath: "assets/conflict-use-remote.json",
      readLocal: async () => localValue,
      writeLocal: async (value) => {
        localValue = value;
      },
      resolveConflict: () => "use-remote",
    });

    await expect(syncAdapter(adapter, client)).resolves.toMatchObject({ status: "uploaded" });
    localValue = { count: 2 };
    client.files.set("assets/conflict-use-remote.json", JSON.stringify({ count: 3 }));

    await expect(syncAdapter(adapter, client)).resolves.toMatchObject({ status: "downloaded" });
    expect(localValue).toEqual({ count: 3 });
    expect(JSON.parse(client.files.get("assets/conflict-use-remote.json") ?? "null"))
      .toEqual({ count: 3 });
  });

  it("syncs a full-with-revision collection through index.json", async () => {
    const client = new MemoryWebDavClient();
    let entries = [{ id: "blueprint-a", value: { name: "A" }, deletedAt: null as string | null }];
    const adapter = createFullWithRevisionAdapter({
      id: "blueprints",
      indexPath: "assets/blueprints/index.json",
      entryPath: (id) => `assets/blueprints/${id}.json`,
      listLocal: async () => entries,
      writeLocal: async (entry) => {
        entries = [...entries.filter((candidate) => candidate.id !== entry.id), entry];
      },
    });

    await expect(syncAdapter(adapter, client)).resolves.toMatchObject({ status: "uploaded" });
    expect(client.madeDirectories).toContain("assets/blueprints");
    const index = JSON.parse(client.files.get("assets/blueprints/index.json") ?? "null") as {
      readonly revision: number;
      readonly entries: Record<string, {
        readonly deletedAt: string | null;
        readonly committedAt: string | null;
      }>;
    };
    expect(index.revision).toBe(1);
    expect(index.entries["blueprint-a"]?.deletedAt).toBeNull();
    expect(index.entries["blueprint-a"]?.committedAt).not.toBeNull();
    expect(client.files.has(
      "assets/blueprints/index-revisions/rev-000000000001.json",
    )).toBe(true);

    client.files.set("assets/blueprints/blueprint-b.json", JSON.stringify({ name: "B" }));
    client.files.set("assets/blueprints/index.json", JSON.stringify({
      revision: 2,
      entries: {
        ...index.entries,
        "blueprint-b": { contentHash: "remote-hash", deletedAt: null },
      },
    }));

    await expect(syncAdapter(adapter, client)).resolves.toMatchObject({ status: "downloaded" });
    expect(entries.find((entry) => entry.id === "blueprint-b")?.value).toEqual({ name: "B" });
  });

  it("discovers every collection conflict without mutating either side", async () => {
    const client = new MemoryWebDavClient();
    let entries = [{
      id: "blueprint-a",
      value: { name: "initial" },
      deletedAt: null as string | null,
    }];
    const writeLocal = vi.fn(async (
      entry: (typeof entries)[number],
    ) => {
      entries = [entry];
    });
    const adapter = createFullWithRevisionAdapter({
      id: "blueprints",
      indexPath: "assets/blueprints/index.json",
      entryPath: (id) => `assets/blueprints/${id}.json`,
      listLocal: async () => entries,
      writeLocal,
    });
    await syncAdapter(adapter, client);
    writeLocal.mockClear();

    entries = [{
      id: "blueprint-a",
      value: { name: "local edit" },
      deletedAt: null,
    }];
    const remoteValue = { name: "remote edit" };
    const remoteHash = createStableJsonHash(remoteValue);
    const remoteUpdatedAt = "2026-07-29T12:34:56.000Z";
    client.files.set(
      "assets/blueprints/blueprint-a.json",
      JSON.stringify(remoteValue),
    );
    client.files.set("assets/blueprints/index.json", JSON.stringify({
      revision: 2,
      entries: {
        "blueprint-a": {
          contentHash: remoteHash,
          deletedAt: null,
          committedAt: remoteUpdatedAt,
        },
      },
    }));
    const filesBeforeInspection = new Map(client.files);

    const conflicts = await inspectAdapterConflicts(adapter, client);

    expect(conflicts).toHaveLength(1);
    expect(conflicts?.[0]).toMatchObject({
      adapterId: "blueprints",
      assetId: "blueprint-a",
      remoteHash,
      remoteUpdatedAt,
    });
    expect(writeLocal).not.toHaveBeenCalled();
    expect(entries[0]?.value).toEqual({ name: "local edit" });
    expect(client.files).toEqual(filesBeforeInspection);

    const conflict = conflicts?.[0];
    expect(conflict).toBeDefined();
    await expect(syncAdapter(adapter, client, {
      includeAssetIds: ["blueprint-a"],
      conflictDecisions: [{
        adapterId: "blueprints",
        assetId: "blueprint-a",
        localHash: conflict!.localHash,
        remoteHash: conflict!.remoteHash,
        remoteDeletedAt: conflict!.remoteDeletedAt,
        resolution: "use-remote",
      }],
    })).resolves.toMatchObject({ status: "downloaded" });
    expect(entries[0]?.value).toEqual(remoteValue);
  });

  it("stores patch-with-revision snapshots as full plus deltas", async () => {
    const client = new MemoryWebDavClient();
    let localValue: { entities: Record<string, { x: number }> } | null = { entities: { a: { x: 1 } } };
    const adapter = createPatchWithRevisionAdapter({
      id: "document:main",
      directoryPath: "documents/main",
      readLocal: async () => localValue,
      writeLocal: async (value) => {
        localValue = value;
      },
      deltaThreshold: 5,
    });

    await expect(syncAdapter(adapter, client)).resolves.toMatchObject({ status: "uploaded" });
    expect(client.files.has("documents/main/meta.json")).toBe(true);
    expect(client.files.has(
      "documents/main/meta-revisions/rev-000000000001.json",
    )).toBe(true);

    localValue = { entities: { a: { x: 2 } } };
    await expect(syncAdapter(adapter, client)).resolves.toMatchObject({ status: "uploaded" });

    const meta = JSON.parse(client.files.get("documents/main/meta.json") ?? "null") as {
      readonly revision: number;
      readonly deltaChain: readonly string[];
    };
    expect(meta.revision).toBe(2);
    expect(meta.deltaChain).toHaveLength(1);
    expect(client.files.has(
      "documents/main/meta-revisions/rev-000000000002.json",
    )).toBe(true);
  });

  it("syncs a patch-with-revision collection through index.json", async () => {
    const client = new MemoryWebDavClient();
    let entries = [{ id: "canvas-a", value: { stages: [{ id: "stage-a", count: 1 }] }, deletedAt: null as string | null }];
    const adapter = createPatchCollectionWithRevisionAdapter({
      id: "module-canvases",
      indexPath: "assets/module-canvases/index.json",
      directoryPath: (id) => `assets/module-canvases/${id}`,
      listLocal: async () => entries,
      writeLocal: async (entry) => {
        entries = [...entries.filter((candidate) => candidate.id !== entry.id), entry];
      },
      deltaThreshold: 5,
    });

    await expect(syncAdapter(adapter, client)).resolves.toMatchObject({ status: "uploaded" });
    expect(client.files.has("assets/module-canvases/canvas-a/meta.json")).toBe(true);
    const index = JSON.parse(client.files.get("assets/module-canvases/index.json") ?? "null") as {
      readonly revision: number;
      readonly entries: Record<string, { readonly deletedAt: string | null }>;
    };
    expect(index.revision).toBe(1);
    expect(index.entries["canvas-a"]?.deletedAt).toBeNull();
    expect(client.files.has(
      "assets/module-canvases/index-revisions/rev-000000000001.json",
    )).toBe(true);

    client.readPaths.length = 0;
    await expect(syncAdapter(adapter, client)).resolves.toMatchObject({ status: "idle" });
    expect(client.readPaths).toContain("assets/module-canvases/index.json");
    // AI-REMOVED 2026-07-29:
    // Reason: 未变化同步不再探测不存在的 next revision，测试应验证没有这次额外 GET。
    // Trigger: 真实 OwnCloud 相同画布检查被 404 revision 请求增加尾延迟。
    // Evidence: canonical index 自带 revision，成功同步后已经是完整权威快照。
    // Replacement: 下方 not.toContain 断言。
    // Risk: Low。
    // Human Review: Required
    //
    // Original code:
    // expect(client.readPaths).toContain(
    //   "assets/module-canvases/index-revisions/rev-000000000002.json",
    // );
    expect(client.readPaths).not.toContain(
      "assets/module-canvases/index-revisions/rev-000000000002.json",
    );
    expect(client.readPaths).not.toContain(
      "assets/module-canvases/index-revisions/rev-000000000001.json",
    );
    expect(client.readPaths.some((path) =>
      path.startsWith("assets/module-canvases/canvas-a/")
    )).toBe(false);

    entries = [{ id: "canvas-a", value: { stages: [{ id: "stage-a", count: 2 }] }, deletedAt: null }];
    await expect(syncAdapter(adapter, client)).resolves.toMatchObject({ status: "uploaded" });
    const meta = JSON.parse(client.files.get("assets/module-canvases/canvas-a/meta.json") ?? "null") as {
      readonly revision: number;
      readonly deltaChain: readonly string[];
    };
    expect(meta.revision).toBe(2);
    expect(meta.deltaChain).toHaveLength(1);
    expect(client.files.has(
      "assets/module-canvases/canvas-a/meta-revisions/rev-000000000002.json",
    )).toBe(true);
  });

  it("uses a stable canonical ETag to skip rebuilding an unchanged patch collection", async () => {
    const client = new MemoryWebDavClient();
    const originalReadTextFile = client.readTextFile.bind(client);
    client.readTextFile = vi.fn(async (relativePath: string) => {
      const file = await originalReadTextFile(relativePath);

      return file === null
        ? null
        : {
          ...file,
          etag: relativePath === "documents/index.json"
            ? "\"stable-index\""
            : file.etag,
        };
    });
    client.stat = vi.fn(async (relativePath: string) =>
      relativePath === "documents/index.json"
        ? {
          path: relativePath,
          basename: "index.json",
          type: "file" as const,
          etag: "\"stable-index\"",
          lastModified: "",
          size: client.files.get(relativePath)?.length ?? 0,
        }
        : null
    );
    const entries = [{
      id: "canvas-a",
      value: { entities: { a: { x: 1 } } },
      deletedAt: null,
    }];
    const adapter = createPatchCollectionWithRevisionAdapter({
      id: "world-documents",
      indexPath: "documents/index.json",
      directoryPath: (id) => `documents/${id}`,
      listLocal: async () => entries,
      writeLocal: vi.fn(async () => undefined),
    });

    await expect(syncAdapter(adapter, client)).resolves.toMatchObject({
      status: "uploaded",
    });
    await expect(syncAdapter(adapter, client)).resolves.toMatchObject({
      status: "idle",
    });
    const readCountAfterCacheWarmup = client.readPaths.length;

    await expect(syncAdapter(adapter, client)).resolves.toMatchObject({
      status: "idle",
    });

    expect(client.stat).toHaveBeenCalledWith("documents/index.json");
    expect(client.readPaths).toHaveLength(readCountAfterCacheWarmup);
  });

  it("repairs a legacy patch index after normalizing device-local fields", async () => {
    type Value = {
      readonly content: number;
      readonly viewportCenter: number;
    };
    const client = new MemoryWebDavClient();
    let seedEntries = [{
      id: "canvas-a",
      value: { content: 1, viewportCenter: 12 },
      deletedAt: null as string | null,
    }];
    const seedAdapter = createPatchCollectionWithRevisionAdapter<Value>({
      id: "documents",
      indexPath: "documents/index.json",
      directoryPath: (id) => `documents/${id}`,
      listLocal: async () => seedEntries,
      writeLocal: async (entry) => {
        seedEntries = [entry];
      },
    });
    await expect(syncAdapter(seedAdapter, client)).resolves.toMatchObject({
      status: "uploaded",
    });
    localStorage.clear();

    let localEntries = [{
      id: "canvas-a",
      value: { content: 1, viewportCenter: 0 },
      deletedAt: null as string | null,
    }];
    const normalizedAdapter = createPatchCollectionWithRevisionAdapter<Value>({
      id: "documents",
      indexPath: "documents/index.json",
      directoryPath: (id) => `documents/${id}`,
      listLocal: async () => localEntries,
      writeLocal: async (entry) => {
        localEntries = [entry];
      },
      normalizeRemote: (value) => {
        if (
          typeof value !== "object"
          || value === null
          || typeof (value as { content?: unknown }).content !== "number"
        ) {
          return null;
        }

        return {
          content: (value as { content: number }).content,
          viewportCenter: 0,
        };
      },
    });

    await expect(syncAdapter(normalizedAdapter, client)).resolves.toMatchObject({
      status: "uploaded",
    });
    client.readPaths.length = 0;
    await expect(syncAdapter(normalizedAdapter, client)).resolves.toMatchObject({
      status: "idle",
    });
    expect(client.readPaths).toContain("documents/index.json");
    expect(client.readPaths.some((path) =>
      path.startsWith("documents/canvas-a/")
    )).toBe(false);
  });

  it("reports real patch collection protocol progress monotonically", async () => {
    const client = new MemoryWebDavClient();
    const progress: number[] = [];
    const adapter = createPatchCollectionWithRevisionAdapter({
      id: "documents",
      indexPath: "documents/by-base/index.json",
      directoryPath: (baseId) => `documents/by-base/${baseId}`,
      listLocal: async () => [{
        id: "wuling_protocol_core",
        value: { count: 1 },
        deletedAt: null,
      }],
      writeLocal: async () => undefined,
    });

    await syncAdapter(adapter, client, {
      includeAssetIds: ["wuling_protocol_core"],
      onProgress: (value) => {
        progress.push(value);
      },
    });

    expect(progress[0]).toBe(0);
    expect(progress.at(-1)).toBe(100);
    expect(progress).toEqual([...progress].sort((left, right) => left - right));
    expect(progress).toContain(35);
    expect(progress).toContain(55);
    expect(progress).toContain(94);
  });

  it("lets a local full-collection edit restore a remotely deleted entry", async () => {
    const client = new MemoryWebDavClient();
    let entries = [{
      id: "blueprint-a",
      value: { name: "initial" },
      deletedAt: null as string | null,
    }];
    const resolveConflict = vi.fn(() => "use-local" as const);
    const adapter = createFullWithRevisionAdapter({
      id: "blueprints",
      indexPath: "assets/blueprints/index.json",
      entryPath: (id) => `assets/blueprints/${id}.json`,
      listLocal: async () => entries,
      writeLocal: async (entry) => {
        entries = [entry];
      },
      resolveConflict,
    });
    await syncAdapter(adapter, client);
    const initialIndex = JSON.parse(
      client.files.get("assets/blueprints/index.json") ?? "null",
    ) as {
      readonly entries: Record<string, {
        readonly contentHash: string;
        readonly deletedAt: string | null;
      }>;
    };
    entries = [{
      id: "blueprint-a",
      value: { name: "local edit" },
      deletedAt: null,
    }];
    client.files.set("assets/blueprints/index.json", JSON.stringify({
      revision: 2,
      entries: {
        "blueprint-a": {
          contentHash: initialIndex.entries["blueprint-a"]!.contentHash,
          deletedAt: "2026-07-29T11:00:00.000Z",
        },
      },
    }));

    await expect(syncAdapter(adapter, client)).resolves.toMatchObject({
      status: "uploaded",
    });
    expect(resolveConflict).toHaveBeenCalledWith(expect.objectContaining({
      adapterId: "blueprints",
      assetId: "blueprint-a",
      remoteValue: null,
      remoteDeletedAt: "2026-07-29T11:00:00.000Z",
    }));
    expect(JSON.parse(
      client.files.get("assets/blueprints/blueprint-a.json") ?? "null",
    )).toEqual({ name: "local edit" });
    const restoredIndex = JSON.parse(
      client.files.get("assets/blueprints/index.json") ?? "null",
    ) as {
      readonly entries: Record<string, {
        readonly deletedAt: string | null;
      }>;
    };
    expect(restoredIndex.entries["blueprint-a"]?.deletedAt).toBeNull();
  });

  it("lets a remote full-collection edit restore a locally deleted entry", async () => {
    const client = new MemoryWebDavClient();
    let entries = [{
      id: "blueprint-a",
      value: { name: "initial" },
      deletedAt: null as string | null,
    }];
    const resolveConflict = vi.fn(() => "use-remote" as const);
    const adapter = createFullWithRevisionAdapter({
      id: "blueprints",
      indexPath: "assets/blueprints/index.json",
      entryPath: (id) => `assets/blueprints/${id}.json`,
      listLocal: async () => entries,
      writeLocal: async (entry) => {
        entries = [entry];
      },
      resolveConflict,
    });
    await syncAdapter(adapter, client);
    entries = [{
      id: "blueprint-a",
      value: { name: "initial" },
      deletedAt: "2026-07-29T11:01:00.000Z",
    }];
    const remoteValue = { name: "remote edit" };
    client.files.set(
      "assets/blueprints/blueprint-a.json",
      JSON.stringify(remoteValue),
    );
    client.files.set("assets/blueprints/index.json", JSON.stringify({
      revision: 2,
      entries: {
        "blueprint-a": {
          contentHash: createStableJsonHash(remoteValue),
          deletedAt: null,
        },
      },
    }));

    await expect(syncAdapter(adapter, client)).resolves.toMatchObject({
      status: "downloaded",
    });
    expect(resolveConflict).toHaveBeenCalledTimes(1);
    expect(entries).toEqual([{
      id: "blueprint-a",
      value: remoteValue,
      deletedAt: null,
    }]);
  });

  it("lets a remote tombstone discard a conflicting local patch edit", async () => {
    const client = new MemoryWebDavClient();
    let entries = [{
      id: "canvas-a",
      value: { count: 1 },
      deletedAt: null as string | null,
    }];
    const resolveConflict = vi.fn(() => "use-remote" as const);
    const adapter = createPatchCollectionWithRevisionAdapter({
      id: "module-canvases",
      indexPath: "assets/module-canvases/index.json",
      directoryPath: (id) => `assets/module-canvases/${id}`,
      listLocal: async () => entries,
      writeLocal: async (entry) => {
        entries = [entry];
      },
      resolveConflict,
    });
    await syncAdapter(adapter, client);
    const initialHash = createStableJsonHash(entries[0]!.value);
    entries = [{
      id: "canvas-a",
      value: { count: 2 },
      deletedAt: null,
    }];
    client.files.set("assets/module-canvases/index.json", JSON.stringify({
      revision: 2,
      entries: {
        "canvas-a": {
          contentHash: initialHash,
          deletedAt: "2026-07-29T11:02:00.000Z",
        },
      },
    }));

    await expect(syncAdapter(adapter, client)).resolves.toMatchObject({
      status: "downloaded",
    });
    expect(resolveConflict).toHaveBeenCalledWith(expect.objectContaining({
      remoteValue: null,
      remoteDeletedAt: "2026-07-29T11:02:00.000Z",
    }));
    expect(entries[0]).toMatchObject({
      value: { count: 2 },
      deletedAt: "2026-07-29T11:02:00.000Z",
    });
  });

  it("lets a local patch tombstone discard a conflicting remote edit", async () => {
    const client = new MemoryWebDavClient();
    let entries = [{
      id: "canvas-a",
      value: { count: 1 },
      deletedAt: null as string | null,
    }];
    const resolveConflict = vi.fn(() => "use-local" as const);
    const adapter = createPatchCollectionWithRevisionAdapter({
      id: "module-canvases",
      indexPath: "assets/module-canvases/index.json",
      directoryPath: (id) => `assets/module-canvases/${id}`,
      listLocal: async () => entries,
      writeLocal: async (entry) => {
        entries = [entry];
      },
      resolveConflict,
    });
    await syncAdapter(adapter, client);
    entries = [{
      id: "canvas-a",
      value: { count: 1 },
      deletedAt: "2026-07-29T11:03:00.000Z",
    }];
    const remoteValue = { count: 2 };
    const remoteHash = createStableJsonHash(remoteValue);
    client.files.set(
      `assets/module-canvases/canvas-a/full-${encodeURIComponent(remoteHash)}.json`,
      JSON.stringify(remoteValue),
    );
    client.files.set(
      "assets/module-canvases/canvas-a/meta.json",
      JSON.stringify({
        revision: 2,
        currentFullHash: remoteHash,
        deltaChain: [],
        deltaThreshold: 50,
      }),
    );
    client.files.set("assets/module-canvases/index.json", JSON.stringify({
      revision: 2,
      entries: {
        "canvas-a": {
          contentHash: remoteHash,
          deletedAt: null,
        },
      },
    }));

    await expect(syncAdapter(adapter, client)).resolves.toMatchObject({
      status: "uploaded",
    });
    expect(resolveConflict).toHaveBeenCalledTimes(1);
    const index = JSON.parse(
      client.files.get("assets/module-canvases/index.json") ?? "null",
    ) as {
      readonly entries: Record<string, {
        readonly deletedAt: string | null;
      }>;
    };
    expect(index.entries["canvas-a"]?.deletedAt)
      .toBe("2026-07-29T11:03:00.000Z");
  });
});
