// @vitest-environment jsdom

/**
 * Cloudflare Worker sync 协议映射集成测试。
 *
 * 受测范围：CloudflareSyncRemote / Session / WriteBatch
 * Mock 策略：vi.stubGlobal("fetch") + createFakeIndexedDbFactory()
 * 不依赖远端 Worker，纯本地运行。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createCloudflareSyncRemote } from "@/sync/clients/cloudflare/cloudflare-remote";
import { createFakeIndexedDbFactory } from "./fake-indexed-db";
import type {
  RemoteCollectionIndex,
  RemoteWriteBatchResult,
  SyncRemote,
  SyncRemoteCollection,
  SyncRemoteSession,
} from "@/sync/clients/remote-types";

// 受测模块中 createSha256CanonicalHash 需要真实浏览器 crypto API；
// jsdom 环境下 mock 它，测试保持确定性。
const TEST_HASH = "a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2";
vi.mock("@/shared/storage/sync-shadow-storage", () => ({
  createSha256CanonicalHash: async () => `sha256:${TEST_HASH}`,
  createStableJsonHash: (v: unknown) => JSON.stringify(v),
}));

// ============================================================================
// 工具
// ============================================================================

class FetchMock {
  private handlers = new Map<string, (_req: FetchRequest) => FetchResponse>();

  public add(pattern: string, handler: (_req: FetchRequest) => FetchResponse): this {
    this.handlers.set(pattern, handler);
    return this;
  }

  public async dispatch(input: RequestInfo, init?: RequestInit): Promise<globalThis.Response> {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    const method = init?.method ?? "GET";
    const body = typeof init?.body === "string" ? JSON.parse(init.body) : null;

    const req: FetchRequest = { url, method, body };
    const handler = this.handlers.get(this.matchKey(url, method, body));

    if (handler) {
      const result = handler(req);
      return new Response(JSON.stringify(result.json), {
        status: result.status ?? 200,
        headers: result.headers,
      });
    }

    return new Response(JSON.stringify({ error: "no mock handler" }), { status: 500 });
  }

  private matchKey(url: string, method: string, body: unknown): string {
    // 简化匹配：check/plan 不区分 body
    if (url.includes("/check")) return `${method}:/check`;
    if (url.includes("/plan")) return `${method}:/plan`;
    if (url.includes("/mutations") && body && typeof body === "object") {
      const action = (body as Record<string, unknown>).action;
      return `${method}:/mutations/${action}`;
    }
    if (url.includes("/reset")) return `${method}:/reset`;
    return `${method}:${url}`;
  }
}

interface FetchRequest {
  url: string;
  method: string;
  body: unknown;
}

interface FetchResponse {
  json: unknown;
  status?: number;
  headers?: Record<string, string>;
}

function makeCollection(overrides: Partial<SyncRemoteCollection> = {}): SyncRemoteCollection {
  return {
    adapterId: "planner",
    name: "toolbox",
    mode: "full-no-revision",
    assetType: "planner-state",
    assetIdCodec: {
      toRemoteAssetId: (id) => id,
      toAdapterAssetId: (id) => id,
    },
    hashAlgorithm: "sha256-canonical-json-v1",
    stateKey: "planner-state",
    ...overrides,
  };
}

// 64 字符 hex 字符串
const BLOB_HASH = "9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08";

// ============================================================================
// 测试
// ============================================================================

describe("cloudflare-sync-remote", () => {
  let fetchMock: FetchMock;

  beforeEach(() => {
    // 替换 IndexedDB 为内存实现，避免浏览器依赖
    vi.stubGlobal("indexedDB", createFakeIndexedDbFactory());
    // 设置 backend api address 到 mock URL
    localStorage.setItem("v3-backend-api-address-override", "https://cf-mock.local");

    fetchMock = new FetchMock();
    vi.stubGlobal("fetch", (input: RequestInfo, init?: RequestInit) =>
      fetchMock.dispatch(input, init),
    );
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    localStorage.clear();
  });

  // -- beginSession / localState -- //

  it("creates a session with correct localState", async () => {
    fetchMock.add("GET:/check", () => ({ json: { head: 0, epoch: "ep-1", changed: false, planRequired: true, changes: [], moduleHeads: [], serverTime: "" } }));
    fetchMock.add("GET:/plan", () => ({ json: { head: 0, epoch: "ep-1", snapshotHead: 0, modules: [], capabilities: {}, nextPageToken: null, minRetainedHead: 0, serverTime: "" } }));

    const remote: SyncRemote = createCloudflareSyncRemote();
    expect(remote.localState).toBeDefined();

    const session = await remote.beginSession({
      reason: "manual",
      collections: [makeCollection()],
    });

    expect(session.localState).toBe(remote.localState);
    await session.dispose?.();
    remote.dispose?.();
  });

  // -- checkCollections: 无变化 -- //

  it("returns empty on unchanged check", async () => {
    fetchMock.add("GET:/check", () => ({ json: { head: 0, epoch: "ep-1", changed: false, planRequired: true, changes: [], moduleHeads: [], serverTime: "" } }));
    fetchMock.add("GET:/plan", () => ({ json: { head: 0, epoch: "ep-1", snapshotHead: 0, modules: [], capabilities: {}, nextPageToken: null, minRetainedHead: 0, serverTime: "" } }));

    const remote = createCloudflareSyncRemote();
    const session = await remote.beginSession({
      reason: "interval",
      collections: [makeCollection()],
    });

    const result = await session.checkCollections([makeCollection()]);
    expect(result.changedCollections).toEqual([]);

    await session.dispose?.();
    remote.dispose?.();
  });

  // -- checkCollections: 有变化 -- //

  it("detects changed collections from check inline changes", async () => {
    fetchMock.add("GET:/check", () => ({
      json: {
        head: 1,
        epoch: "ep-1",
        changed: true,
        planRequired: false,
        changes: [{ assetType: "planner-state", assetId: "default", revision: 1, contentHash: "abc", blobHash: "abc", byteSize: 4, deletedAt: null }],
        moduleHeads: [{ moduleType: "planner-state", head: 1 }],
        serverTime: "",
      },
    }));
    fetchMock.add("GET:/plan", () => ({ json: { head: 1, epoch: "ep-1", snapshotHead: 1, modules: [{ moduleType: "planner-state", assets: [{ assetType: "planner-state", assetId: "default", revision: 1, contentHash: "abc", deletedAt: null }] }], capabilities: {}, nextPageToken: null, minRetainedHead: 0, serverTime: "" } }));

    const remote = createCloudflareSyncRemote();
    const session = await remote.beginSession({
      reason: "interval",
      collections: [makeCollection()],
    });

    const result = await session.checkCollections([makeCollection()]);
    expect(result.changedCollections).toContain("planner");

    await session.dispose?.();
    remote.dispose?.();
  });

  // -- prefetchIndexes + readIndex -- //

  it("prefetches indexes and reads collection index", async () => {
    fetchMock.add("GET:/check", () => ({ json: { head: 0, epoch: "ep-1", changed: false, planRequired: true, changes: [], moduleHeads: [], serverTime: "" } }));
    fetchMock.add("GET:/plan", () => ({
      json: {
        head: 1,
        epoch: "ep-1",
        snapshotHead: 1,
        modules: [{
          moduleType: "planner-state",
          assets: [
            { assetType: "planner-state", assetId: "default", revision: 1, contentHash: "abc", blobHash: "abc", byteSize: 4, deletedAt: null },
            { assetType: "planner-state", assetId: "extra", revision: 3, contentHash: "def", blobHash: "def", byteSize: 4, deletedAt: "2026-01-01T00:00:00Z" },
          ],
        }],
        capabilities: {},
        nextPageToken: null,
        minRetainedHead: 0,
        serverTime: "",
      },
    }));

    const remote = createCloudflareSyncRemote();
    const collection = makeCollection();
    const session = await remote.beginSession({
      reason: "foreground",
      collections: [collection],
    });

    await session.prefetchIndexes([collection]);
    const index: RemoteCollectionIndex = await session.readIndex(collection);

    expect(index.revision).toBe(3);
    expect(index.entries["default"]).toEqual({
      revision: 1,
      contentHash: "abc",
      deletedAt: null,
      committedAt: null,
    });
    expect(index.entries["extra"]?.deletedAt).toBe("2026-01-01T00:00:00Z");

    await session.dispose?.();
    remote.dispose?.();
  });

  // -- readIndex: 空 plan 返回空索引 -- //

  it("returns empty index when plan is empty", async () => {
    fetchMock.add("GET:/check", () => ({ json: { head: 0, epoch: "ep-1", changed: false, planRequired: true, changes: [], moduleHeads: [], serverTime: "" } }));
    fetchMock.add("GET:/plan", () => ({ json: { head: 0, epoch: "ep-1", snapshotHead: 0, modules: [], capabilities: {}, nextPageToken: null, minRetainedHead: 0, serverTime: "" } }));

    const remote = createCloudflareSyncRemote();
    const collection = makeCollection();
    const session = await remote.beginSession({
      reason: "foreground",
      collections: [collection],
    });

    await session.prefetchIndexes([collection]);
    const index = await session.readIndex(collection);

    expect(index).toEqual({ revision: 0, entries: {}, committedAt: null });

    await session.dispose?.();
    remote.dispose?.();
  });

  // -- readAsset: 已删除资产返回 null -- //

  it("readAsset returns null for deleted asset", async () => {
    fetchMock.add("GET:/check", () => ({ json: { head: 0, epoch: "ep-1", changed: false, planRequired: true, changes: [], moduleHeads: [], serverTime: "" } }));
    fetchMock.add("GET:/plan", () => ({
      json: {
        head: 1,
        epoch: "ep-1",
        snapshotHead: 1,
        modules: [{
          moduleType: "planner-state",
          assets: [
            { assetType: "planner-state", assetId: "tombstone", revision: 5, contentHash: "xyz", blobHash: "abc", byteSize: 10, deletedAt: "2026-01-01T00:00:00Z" },
          ],
        }],
        capabilities: {},
        nextPageToken: null,
        minRetainedHead: 0,
        serverTime: "",
      },
    }));

    const remote = createCloudflareSyncRemote();
    const collection = makeCollection();
    const session = await remote.beginSession({
      reason: "foreground",
      collections: [collection],
    });

    await session.prefetchIndexes([collection]);
    const asset = await session.readAsset({ collection, assetId: "tombstone" });

    expect(asset).toBeNull();

    await session.dispose?.();
    remote.dispose?.();
  });

  // -- readAsset: 下载并通过 SHA-256 校验 -- //

  it("readAsset downloads and verifies content via downloads:sign", async () => {
    const testContent = '{"value":42}';
    let signCalled = false;

    fetchMock.add("GET:/check", () => ({ json: { head: 0, epoch: "ep-1", changed: false, planRequired: true, changes: [], moduleHeads: [], serverTime: "" } }));
    fetchMock.add("GET:/plan", () => ({
      json: {
        head: 1,
        epoch: "ep-1",
        snapshotHead: 1,
        modules: [{
          moduleType: "planner-state",
          assets: [
            { assetType: "planner-state", assetId: "default", revision: 2, contentHash: TEST_HASH, blobHash: TEST_HASH, byteSize: testContent.length, deletedAt: null },
          ],
        }],
        capabilities: {},
        nextPageToken: null,
        minRetainedHead: 0,
        serverTime: "",
      },
    }));

    // 覆盖 fetch: downloads:sign → 返回 URL; blob GET → 返回内容
    vi.stubGlobal("fetch", (input: RequestInfo, init?: RequestInit) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
      if (url.includes("/downloads:sign") && init?.method === "POST") {
        signCalled = true;
        return Promise.resolve(new Response(JSON.stringify({ urls: [{ blobHash: TEST_HASH, url: "https://cf-mock.local/blob/dl" }] }), { status: 200 }));
      }
      if (url.includes("/blob/dl") && init?.method === undefined) {
        return Promise.resolve(new Response(testContent, { status: 200 }));
      }
      return fetchMock.dispatch(input, init);
    });

    const remote = createCloudflareSyncRemote();
    const collection = makeCollection();
    const session = await remote.beginSession({
      reason: "foreground",
      collections: [collection],
    });

    await session.prefetchIndexes([collection]);
    const asset = await session.readAsset({ collection, assetId: "default" });

    expect(signCalled).toBe(true);
    expect(asset).not.toBeNull();
    expect(asset?.content).toBe(testContent);
    expect(asset?.revision).toBe(2);

    // 二次读取应走缓存
    const asset2 = await session.readAsset({ collection, assetId: "default" });
    expect(asset2?.content).toBe(testContent);

    await session.dispose?.();
    remote.dispose?.();
    vi.unstubAllGlobals();
    // 恢复 fetch mock
    vi.stubGlobal("fetch", (input: RequestInfo, init?: RequestInit) =>
      fetchMock.dispatch(input, init),
    );
  });

  // -- write batch: commit 完整流程 -- //

  it("commits a write batch through prepare → R2 PUT → commit", async () => {
    let capturedPrepareBody: unknown = null;
    let capturedCommitBody: unknown = null;
    let r2PutCalled = false;

    fetchMock
      .add("GET:/check", () => ({ json: { head: 0, epoch: "ep-1", changed: false, planRequired: true, changes: [], moduleHeads: [], serverTime: "" } }))
      .add("POST:/mutations/prepare", (req) => {
        capturedPrepareBody = req.body;
        return {
          json: {
            status: "ready",
            commitToken: "mock-commit-token",
            uploads: [{
              assetType: "planner-state",
              assetId: "default",
              required: true,
              url: "https://cf-mock.local/blobs/upload",
              headers: { "Content-Type": "application/octet-stream" },
            }],
          },
        };
      })
      .add("POST:/mutations/commit", (req) => {
        capturedCommitBody = req.body;
        return {
          json: {
            status: "committed",
            head: 1,
            applied: [{ clientMutationId: "m1", assetType: "planner-state", assetId: "default", revision: 1, contentHash: "sha256:xyz" }],
            serverTime: "",
          },
        };
      });

    // mock R2 PUT
    const originalFetch = globalThis.fetch;
    vi.stubGlobal("fetch", (input: RequestInfo, init?: RequestInit) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
      if (url.includes("/blobs/upload") && init?.method === "PUT") {
        r2PutCalled = true;
        return Promise.resolve(new Response(JSON.stringify({ ok: true }), { status: 200 }));
      }
      return fetchMock.dispatch(input, init);
    });

    const remote = createCloudflareSyncRemote();
    const collection = makeCollection();
    const session = await remote.beginSession({
      reason: "manual",
      collections: [collection],
    });

    // 先走一次 prefetchIndexes → plan 以获取 epoch
    fetchMock.add("GET:/plan", () => ({ json: { head: 0, epoch: "ep-1", snapshotHead: 0, modules: [], capabilities: {}, nextPageToken: null, minRetainedHead: 0, serverTime: "" } }));
    await session.prefetchIndexes([collection]);

    const batch = session.beginWriteBatch();
    batch.putAsset({
      collection,
      assetId: "default",
      content: JSON.stringify({ test: true }),
      contentHash: "sha256:abc",
      baseRevision: null,
      baseContentHash: null,
    });

    const result: RemoteWriteBatchResult = await batch.commit();

    // prepare body 验证
    const pb = capturedPrepareBody as Record<string, unknown>;
    expect(pb).toBeDefined();
    expect(pb.action).toBe("prepare");
    expect(pb.spaceEpoch).toBe("ep-1");
    const pmuts = (pb.mutations as Array<Record<string, unknown>>);
    expect(pmuts.length).toBe(1);
    expect(pmuts[0].assetType).toBe("planner-state");
    expect(pmuts[0].assetId).toBe("default");
    expect(pmuts[0].storageMode).toBe("full");
    expect(pmuts[0].encoding).toBe("identity");
    expect(typeof pmuts[0].blobHash).toBe("string");
    expect(typeof pmuts[0].blobByteSize).toBe("number");

    // R2 PUT 已调用
    expect(r2PutCalled).toBe(true);

    // commit body 验证
    const cb = capturedCommitBody as Record<string, unknown>;
    expect(cb.action).toBe("commit");
    expect(cb.commitToken).toBe("mock-commit-token");
    const cmuts = (cb.mutations as Array<Record<string, unknown>>);
    expect(cmuts.length).toBe(1);
    expect(cmuts[0].assetType).toBe("planner-state");

    // 结果
    expect(result.writes.length).toBe(1);
    expect(result.writes[0].revision).toBe(1);
    expect(result.globalCursor).toBe(1);

    await session.dispose?.();
    remote.dispose?.();
    vi.unstubAllGlobals();
    // 恢复 fetch mock
    vi.stubGlobal("fetch", (input: RequestInfo, init?: RequestInit) =>
      fetchMock.dispatch(input, init),
    );
  });

  // -- write batch: 空 mutations 直接返回 -- //

  it("returns empty writes for zero mutations", async () => {
    fetchMock.add("GET:/check", () => ({ json: { head: 0, epoch: "ep-1", changed: false, planRequired: true, changes: [], moduleHeads: [], serverTime: "" } }));

    const remote = createCloudflareSyncRemote();
    const session = await remote.beginSession({
      reason: "manual",
      collections: [makeCollection()],
    });

    const batch = session.beginWriteBatch();
    const result = await batch.commit();

    expect(result.writes).toEqual([]);

    await session.dispose?.();
    remote.dispose?.();
  });

  // -- write batch: prepare 失败返回空 -- //

  it("returns empty writes when prepare returns non-ok", async () => {
    fetchMock.add("GET:/check", () => ({ json: { head: 0, epoch: "ep-1", changed: false, planRequired: true, changes: [], moduleHeads: [], serverTime: "" } }));
    fetchMock.add("POST:/mutations/prepare", () => ({ json: { status: "conflict", conflicts: [] }, status: 409 }));

    const remote = createCloudflareSyncRemote();
    const session = await remote.beginSession({
      reason: "manual",
      collections: [makeCollection()],
    });

    const batch = session.beginWriteBatch();
    const collection = makeCollection();
    batch.putAsset({
      collection,
      assetId: "default",
      content: "{}",
      contentHash: "sha256:abc",
      baseRevision: null,
      baseContentHash: null,
    });

    const result = await batch.commit();
    expect(result.writes).toEqual([]);

    await session.dispose?.();
    remote.dispose?.();
  });

  // -- 空间不存在自动创建 -- //

  it("auto-creates space when 404 on check", async () => {
    let createCalled = false;
    let checkCallCount = 0;

    fetchMock
      .add("GET:/check", () => {
        checkCallCount++;
        if (checkCallCount === 1) {
          return { json: { error: "not_found", message: "空间不存在" }, status: 404 };
        }
        return { json: { head: 0, epoch: "ep-1", changed: false, planRequired: true, changes: [], moduleHeads: [], serverTime: "" } };
      })
      .add("POST:/mutations/prepare", (req) => {
        // 不直接 add — 我们只是要验证 create 逻辑
        createCalled = true;
        return { json: { ok: true, spaceId: "default", activeEpoch: "ep-1", createdAt: "" }, status: 201 };
      })
      .add("GET:/plan", () => ({ json: { head: 0, epoch: "ep-1", snapshotHead: 0, modules: [], capabilities: {}, nextPageToken: null, minRetainedHead: 0, serverTime: "" } }));

    // 覆盖 fetch mock，让 POST /spaces 也被匹配
    const originalFetch = globalThis.fetch;
    vi.stubGlobal("fetch", (input: RequestInfo, init?: RequestInit) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
      if (url.includes("/spaces") && init?.method === "POST" && !url.includes("/mutations")) {
        createCalled = true;
        return Promise.resolve(new Response(JSON.stringify({ ok: true, spaceId: "default", activeEpoch: "ep-1", createdAt: "" }), { status: 201 }));
      }
      return fetchMock.dispatch(input, init);
    });

    const remote = createCloudflareSyncRemote();
    const session = await remote.beginSession({
      reason: "foreground",
      collections: [makeCollection()],
    });

    await session.checkCollections([makeCollection()]);

    expect(createCalled).toBe(true);

    await session.dispose?.();
    remote.dispose?.();
    vi.unstubAllGlobals();
    vi.stubGlobal("fetch", (input: RequestInfo, init?: RequestInit) =>
      fetchMock.dispatch(input, init),
    );
  });

  // -- dispose -- //

  it("dispose clears caches without throwing", async () => {
    fetchMock.add("GET:/check", () => ({ json: { head: 0, epoch: "ep-1", changed: false, planRequired: true, changes: [], moduleHeads: [], serverTime: "" } }));

    const remote = createCloudflareSyncRemote();
    const session = await remote.beginSession({
      reason: "manual",
      collections: [makeCollection()],
    });

    expect(() => session.dispose?.()).not.toThrow();
    remote.dispose?.();
  });
});
