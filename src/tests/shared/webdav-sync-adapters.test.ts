// @vitest-environment jsdom

import { afterEach, describe, expect, it } from "vitest";

import {
  createFullNoRevisionAdapter,
  createFullWithRevisionAdapter,
  createPatchCollectionWithRevisionAdapter,
  createPatchWithRevisionAdapter,
} from "@/sync";
import type {
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

    return content === undefined ? null : { content, etag: null };
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

    await expect(adapter.sync(client)).resolves.toMatchObject({ status: "uploaded" });
    expect(JSON.parse(client.files.get("assets/planner-state.json") ?? "null")).toEqual({ count: 1 });
    expect(client.madeDirectories).toContain("assets");

    localValue = { count: 1 };
    client.files.set("assets/planner-state.json", JSON.stringify({ count: 2 }));
    await expect(adapter.sync(client)).resolves.toMatchObject({ status: "downloaded" });
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

    await expect(adapter.sync(client)).resolves.toMatchObject({ status: "uploaded" });
    localValue = { count: 2 };
    client.files.set("assets/conflict-use-local.json", JSON.stringify({ count: 3 }));

    await expect(adapter.sync(client)).resolves.toMatchObject({ status: "uploaded" });
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

    await expect(adapter.sync(client)).resolves.toMatchObject({ status: "uploaded" });
    localValue = { count: 2 };
    client.files.set("assets/conflict-use-remote.json", JSON.stringify({ count: 3 }));

    await expect(adapter.sync(client)).resolves.toMatchObject({ status: "downloaded" });
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

    await expect(adapter.sync(client)).resolves.toMatchObject({ status: "uploaded" });
    expect(client.madeDirectories).toContain("assets/blueprints");
    const index = JSON.parse(client.files.get("assets/blueprints/index.json") ?? "null") as {
      readonly revision: number;
      readonly entries: Record<string, { readonly deletedAt: string | null }>;
    };
    expect(index.revision).toBe(1);
    expect(index.entries["blueprint-a"]?.deletedAt).toBeNull();
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

    await expect(adapter.sync(client)).resolves.toMatchObject({ status: "downloaded" });
    expect(entries.find((entry) => entry.id === "blueprint-b")?.value).toEqual({ name: "B" });
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

    await expect(adapter.sync(client)).resolves.toMatchObject({ status: "uploaded" });
    expect(client.files.has("documents/main/meta.json")).toBe(true);
    expect(client.files.has(
      "documents/main/meta-revisions/rev-000000000001.json",
    )).toBe(true);

    localValue = { entities: { a: { x: 2 } } };
    await expect(adapter.sync(client)).resolves.toMatchObject({ status: "uploaded" });

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

    await expect(adapter.sync(client)).resolves.toMatchObject({ status: "uploaded" });
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
    await expect(adapter.sync(client)).resolves.toMatchObject({ status: "idle" });
    expect(client.readPaths).toContain("assets/module-canvases/index.json");
    expect(client.readPaths).toContain(
      "assets/module-canvases/index-revisions/rev-000000000002.json",
    );
    expect(client.readPaths).not.toContain(
      "assets/module-canvases/index-revisions/rev-000000000001.json",
    );
    expect(client.readPaths.some((path) =>
      path.startsWith("assets/module-canvases/canvas-a/")
    )).toBe(false);

    entries = [{ id: "canvas-a", value: { stages: [{ id: "stage-a", count: 2 }] }, deletedAt: null }];
    await expect(adapter.sync(client)).resolves.toMatchObject({ status: "uploaded" });
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
    await expect(seedAdapter.sync(client)).resolves.toMatchObject({
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

    await expect(normalizedAdapter.sync(client)).resolves.toMatchObject({
      status: "uploaded",
    });
    client.readPaths.length = 0;
    await expect(normalizedAdapter.sync(client)).resolves.toMatchObject({
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

    await adapter.sync(client, {
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
});
