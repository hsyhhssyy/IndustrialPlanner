// @vitest-environment jsdom

/**
 * Cloudflare cf-sync-v2 协议映射集成测试。
 *
 * 受测范围：CloudflareSyncRemote / Session / WriteBatch
 * Mock 策略：vi.stubGlobal("fetch") + createFakeIndexedDbFactory()
 * AI-CORRECTION 2026-08-09: 后端已完全重构为 cf-sync-v2 协议，
 * 本测试验证 prepare/upload/commit 两阶段流程。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// AI-CORRECTION 2026-08-12: 公共入口现在覆盖生产使用的 cf-sync-v2 Worker remote；
// jsdom 无 Worker 时使用同一个 runtime 的进程内测试适配器。
import {
  CloudflareV2WorkerClient,
  createCloudflareSyncRemote,
} from "@/sync/clients/cloudflare";
import { createSyncRemoteCollection } from "@/sync";
import { CloudflareV2WorkerRuntime } from "@/sync/clients/cloudflare/cloudflare-v2-worker-runtime";
import { createFakeIndexedDbFactory } from "./fake-indexed-db";
import type {
  RemoteCollectionIndex,
  RemoteWriteBatchResult,
  SyncRemote,
  SyncRemoteCollection,
} from "@/sync/clients/remote-types";

type JsonObject = Record<string, unknown>;
type JsonArray = Array<Record<string, unknown>>;

// ============================================================================
// Mock setup
// ============================================================================

const TEST_HASH = "a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2";
const BLOB_HASH = "9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08";

vi.mock("@/shared/storage/hash-utils", () => ({
  createSha256CanonicalHash: async () => `sha256:${TEST_HASH}`,
  createSha256Hash: async () => `sha256:${BLOB_HASH}`,
  createStableJsonHash: (v: unknown) => JSON.stringify(v),
  stringifyCanonicalJson: (value: unknown) =>
    JSON.stringify(value, Object.keys(value as Record<string, unknown>).sort()),
}));

// ============================================================================
// FetchMock — 模拟 cf-sync-v2 后端
// ============================================================================

type MockHandler = (req: { url: string; method: string; body: unknown }) => {
  json: unknown;
  status?: number;
};

class FetchMockV2 {
  private handlers = new Map<string, MockHandler>();

  public add(pattern: string, handler: MockHandler): this {
    this.handlers.set(pattern, handler);
    return this;
  }

  public async dispatch(input: RequestInfo, init?: RequestInit): Promise<globalThis.Response> {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    const method = init?.method ?? "GET";
    let body: unknown = null;
    if (typeof init?.body === "string") {
      try { body = JSON.parse(init.body); } catch { /* raw string */ }
    }

    const key = this.matchKey(url, method, body);
    const handler = this.handlers.get(key);

    if (handler) {
      const result = handler({ url, method, body });
      if (result.status === 204) {
        return new Response(null, { status: 204 });
      }
      return new Response(JSON.stringify(result.json), {
        status: result.status ?? 200,
      });
    }

    return new Response(JSON.stringify({ error: "no mock handler" }), { status: 500 });
  }

  private matchKey(url: string, method: string, body: unknown): string {
    if (url.includes("/check")) return `${method}:/check`;
    if (url.includes("/plan")) return `${method}:/plan`;
    if (url.includes("/mutations") && body && typeof body === "object") {
      const action = (body as Record<string, unknown>).action;
      return `${method}:/mutations/${action}`;
    }
    if (url.includes("/spaces") && method === "POST" && !url.includes("/mutations") && !url.includes("/uploads")) {
      return "POST:/spaces";
    }
    return `${method}:${url}`;
  }
}

// ============================================================================
// 工具函数
// ============================================================================

function makeCollection(overrides: Partial<SyncRemoteCollection> = {}): SyncRemoteCollection {
  return {
    adapterId: "planner",
    name: "toolbox",
    mode: "full-no-revision",
    assetType: "planner-state",
    assetIdCodec: {
      toRemoteAssetId: (id: string) => id,
      toAdapterAssetId: (id: string) => id,
    },
    hashAlgorithm: "sha256-canonical-json-v1",
    stateKey: "planner-state",
    ...overrides,
  };
}

function createTestRemote(): SyncRemote {
  return createCloudflareSyncRemote({
    apiBase: "https://cf-mock.local",
    spaceId: "default",
    workerClientFactory: () => new CloudflareV2WorkerClient({
      runtimeFactory: () => new CloudflareV2WorkerRuntime(),
    }),
  });
}

function v2Plan(assets: Array<{
  assetType: string;
  assetId: string;
  contentHash: string;
  byteSize?: number;
}>): unknown {
  return {
    spaceId: "default",
    revision: assets.length > 0 ? 1 : 0,
    epoch: assets.length > 0 ? 1 : 0,
    assets: assets.map((a) => ({
      ...a,
      byteSize: a.byteSize ?? 10,
      encoding: "identity",
      metadata: "{}",
      schemaVersion: 1,
      storageMode: "full",
      backend: "d1",
      lastModifiedRevision: 1,
      downloadUrl: `https://cf-mock.local/v1/sync/spaces/default/assets/${a.assetType}/${a.assetId}/content?ticket=mock-ticket`,
    })),
    serverTime: "2026-08-09T00:00:00.000Z",
  };
}

// ============================================================================
// 测试
// ============================================================================

describe("cloudflare-sync-remote-v2", () => {
  let fetchMock: FetchMockV2;

  beforeEach(() => {
    vi.stubGlobal("indexedDB", createFakeIndexedDbFactory());
    localStorage.setItem("v3-backend-api-address-override", "https://cf-mock.local");

    fetchMock = new FetchMockV2();
    vi.stubGlobal("fetch", (input: RequestInfo, init?: RequestInit) =>
      fetchMock.dispatch(input, init),
    );
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    localStorage.clear();
  });

  it("rejects an empty space ID instead of connecting to default", () => {
    expect(() => createCloudflareSyncRemote({
      apiBase: "https://cf-mock.local",
      spaceId: "   ",
      workerClientFactory: () => new CloudflareV2WorkerClient({
        runtimeFactory: () => new CloudflareV2WorkerRuntime(),
      }),
    })).toThrow("Cloudflare space ID must not be empty.");
  });

  // -- 会话创建 -- //

  it("creates a session with correct localState", async () => {
    fetchMock
      .add("GET:/check", () => ({ json: v2Plan([]), status: 204 }))
      .add("GET:/plan", () => ({ json: v2Plan([]) }));

    const remote = createTestRemote();
    expect(remote.localState).toBeDefined();

    const session = await remote.beginSession({
      reason: "manual",
      collections: [makeCollection()],
    });

    expect(session.localState).toBe(remote.localState);
    await session.dispose?.();
    remote.dispose?.();
  });

  // -- checkCollections: 无变化（204 返回） -- //

  it("returns empty on unchanged check (204)", async () => {
    fetchMock
      .add("GET:/check", () => ({ json: {}, status: 204 }))
      .add("GET:/plan", () => ({ json: v2Plan([]) }));

    const remote = createTestRemote();
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

  it("detects changed collections", async () => {
    fetchMock
      .add("GET:/check", () => ({
        json: { revision: 1, epoch: 1, changed: true, planRequired: true, serverTime: "" },
      }))
      .add("GET:/plan", () => ({
        json: v2Plan([{ assetType: "planner-state", assetId: "default", contentHash: TEST_HASH }]),
      }));

    const remote = createTestRemote();
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
    fetchMock
      .add("GET:/check", () => ({ json: {}, status: 204 }))
      .add("GET:/plan", () => ({
        json: v2Plan([
          { assetType: "planner-state", assetId: "default", contentHash: "abc" },
          { assetType: "planner-state", assetId: "extra", contentHash: "def" },
        ]),
      }));

    const remote = createTestRemote();
    const collection = makeCollection();
    const session = await remote.beginSession({
      reason: "foreground",
      collections: [collection],
    });

    await session.prefetchIndexes([collection]);
    const index: RemoteCollectionIndex = await session.readIndex(collection);

    // v2 协议中 plan 的 contentHash 会被加上 "sha256:" 前缀
    expect(index.entries["default"]).toMatchObject({
      contentHash: "sha256:abc",
      protocolContentHash: "sha256:abc",
      deletedAt: null,
    });
    expect(index.entries["extra"]).toBeDefined();

    await session.dispose?.();
    remote.dispose?.();
  });

  it("isolates production planning and regional settings in the shared planner-state namespace", async () => {
    fetchMock
      .add("GET:/check", () => ({ json: {}, status: 204 }))
      .add("GET:/plan", () => ({
        json: v2Plan([
          { assetType: "planner-state", assetId: "default", contentHash: "abc" },
          { assetType: "planner-state", assetId: "regional-settings", contentHash: "def" },
        ]),
      }));

    const productionPlanning = createSyncRemoteCollection({
      adapterId: "production-planning",
      mode: "full-no-revision",
      stateKey: "production-planning",
    });
    const regionalSettings = createSyncRemoteCollection({
      adapterId: "regional-settings",
      mode: "full-with-revision",
      stateKey: "regional-settings",
    });
    expect(productionPlanning.assetIdCodec.toRemoteAssetId("single"))
      .toBe("default");
    expect(regionalSettings.assetIdCodec.toRemoteAssetId("default"))
      .toBe("regional-settings");

    const remote = createTestRemote();
    const session = await remote.beginSession({
      reason: "foreground",
      collections: [productionPlanning, regionalSettings],
    });
    await session.prefetchIndexes([productionPlanning, regionalSettings]);

    const productionPlanningIndex = await session.readIndex(productionPlanning);
    const regionalSettingsIndex = await session.readIndex(regionalSettings);
    expect(Object.keys(productionPlanningIndex.entries)).toEqual(["single"]);
    expect(Object.keys(regionalSettingsIndex.entries)).toEqual(["default"]);

    await session.dispose?.();
    remote.dispose?.();
  });

  // -- readIndex: 空 plan 返回空索引 -- //

  it("returns empty index when plan is empty", async () => {
    fetchMock
      .add("GET:/check", () => ({ json: {}, status: 204 }))
      .add("GET:/plan", () => ({ json: v2Plan([]) }));

    const remote = createTestRemote();
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

  // -- readAsset -- //

  it("readAsset downloads and returns content", async () => {
    const testContent = '{"value":42}';

    fetchMock
      .add("GET:/check", () => ({ json: {}, status: 204 }))
      .add("GET:/plan", () => ({
        json: v2Plan([{ assetType: "planner-state", assetId: "default", contentHash: BLOB_HASH, byteSize: testContent.length }]),
      }));

    // 覆盖 fetch 以处理 downloadUrl 请求
    vi.stubGlobal("fetch", (input: RequestInfo, init?: RequestInit) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
      if (url.includes("/content?ticket=")) {
        return Promise.resolve(new Response(testContent, { status: 200 }));
      }
      return fetchMock.dispatch(input, init);
    });

    const remote = createTestRemote();
    const collection = makeCollection();
    const session = await remote.beginSession({
      reason: "foreground",
      collections: [collection],
    });

    await session.prefetchIndexes([collection]);
    const asset = await session.readAsset({ collection, assetId: "default" });

    expect(asset).not.toBeNull();
    expect(asset?.value).toEqual(JSON.parse(testContent));
    expect(asset?.revision).toBe(1);

    await session.dispose?.();
    remote.dispose?.();
  });

  it("fails closed when an asset download fails", async () => {
    fetchMock.add("GET:/plan", () => ({
      json: v2Plan([{
        assetType: "planner-state",
        assetId: "default",
        contentHash: BLOB_HASH,
      }]),
    }));
    vi.stubGlobal("fetch", (input: RequestInfo, init?: RequestInit) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
      if (url.includes("/content?ticket=")) {
        return Promise.resolve(new Response("temporary outage", { status: 503 }));
      }
      return fetchMock.dispatch(input, init);
    });

    const remote = createTestRemote();
    const collection = makeCollection();
    const session = await remote.beginSession({
      reason: "foreground",
      collections: [collection],
    });
    await session.prefetchIndexes([collection]);

    await expect(session.readAsset({ collection, assetId: "default" }))
      .rejects.toThrow("HTTP 503");

    await session.dispose?.();
    remote.dispose?.();
  });

  it("does not advance the applied revision until the session completes", async () => {
    let checkUrl = "";
    fetchMock
      .add("GET:/plan", () => ({
        json: v2Plan([{
          assetType: "planner-state",
          assetId: "default",
          contentHash: BLOB_HASH,
        }]),
      }))
      .add("GET:/check", (req) => {
        checkUrl = req.url;
        return {
          json: {
            revision: 1,
            epoch: 1,
            changed: true,
            planRequired: true,
            serverTime: "",
          },
        };
      });

    const remote = createTestRemote();
    const collection = makeCollection();
    const session = await remote.beginSession({
      reason: "foreground",
      collections: [collection],
    });
    await session.prefetchIndexes([collection]);
    await session.checkCollections([collection]);
    expect(checkUrl).toContain("knownRevision=0");

    await session.markApplied({
      collection,
      assetIds: ["default"],
      scopeComplete: true,
      collectionRevision: 1,
      collectionEtag: "1",
    });
    await session.complete?.();
    await session.checkCollections([collection]);
    expect(checkUrl).toContain("knownRevision=1");

    await session.dispose?.();
    remote.dispose?.();
  });

  it("does not advance the applied revision for an incomplete collection scope", async () => {
    let checkUrl = "";
    fetchMock
      .add("GET:/plan", () => ({
        json: v2Plan([{
          assetType: "planner-state",
          assetId: "default",
          contentHash: BLOB_HASH,
        }]),
      }))
      .add("GET:/check", (request) => {
        checkUrl = request.url;
        return {
          json: {
            revision: 1,
            epoch: 1,
            changed: true,
            planRequired: true,
            serverTime: "",
          },
        };
      });

    const remote = createTestRemote();
    const collection = makeCollection();
    const session = await remote.beginSession({
      reason: "local-change",
      collections: [collection],
    });
    await session.prefetchIndexes([collection]);
    await session.markApplied({
      collection,
      assetIds: ["default"],
      scopeComplete: false,
      collectionRevision: 1,
      collectionEtag: "1",
    });

    await session.complete?.();
    await session.checkCollections([collection]);
    expect(checkUrl).toContain("knownRevision=0");

    await session.dispose?.();
    remote.dispose?.();
  });

  it("preserves opaque protocol revisions and only projects them at the SyncRemote boundary", async () => {
    const opaqueRevision = "abcdef0123456789-1786492800123";
    let checkUrl = "";
    const plan = v2Plan([{
      assetType: "planner-state",
      assetId: "default",
      contentHash: BLOB_HASH,
    }]) as Record<string, unknown>;
    plan.revision = opaqueRevision;
    plan.assets = (plan.assets as Array<Record<string, unknown>>).map((asset) => ({
      ...asset,
      lastModifiedRevision: opaqueRevision,
    }));
    fetchMock
      .add("GET:/plan", () => ({ json: plan }))
      .add("GET:/check", (request) => {
        checkUrl = request.url;
        return { json: {}, status: 204 };
      });

    const remote = createTestRemote();
    const collection = makeCollection();
    const session = await remote.beginSession({
      reason: "foreground",
      collections: [collection],
    });
    await session.prefetchIndexes([collection]);
    const index = await session.readIndex(collection);
    expect(index.revision).toBe(1786492800123);

    await session.markApplied({
      collection,
      assetIds: ["default"],
      scopeComplete: true,
      collectionRevision: index.revision,
      collectionEtag: String(index.revision),
    });
    await session.complete?.();
    await session.checkCollections([collection]);
    expect(checkUrl).toContain(`knownRevision=${encodeURIComponent(opaqueRevision)}`);

    session.dispose?.();
    remote.dispose?.();
  });

  // -- write batch: 完整流程 -- //

  it("commits a write batch through prepare → upload → commit", async () => {
    let capturedPrepareBody: JsonObject | null = null;
    let capturedCommitBody: JsonObject | null = null;
    let uploadCalled = false;
    let uploadedBody: string | null = null;

    fetchMock
      .add("GET:/check", () => ({ json: {}, status: 204 }))
      .add("POST:/mutations/prepare", (req) => {
        capturedPrepareBody = req.body as Record<string, unknown>;
        return {
          json: {
            status: "ready",
            uploadId: "upload-1",
            commitToken: "commit-token-1",
            baseRevision: 0,
            targetRevision: 1,
            targetEpoch: 1,
            expiresAt: "2099-01-01T00:00:00.000Z",
            uploads: [{
              assetType: "planner-state",
              assetId: "default",
              required: true,
              backend: "d1",
              url: "https://cf-mock.local/v1/sync/spaces/default/uploads/upload-1/assets/planner-state/default?ticket=upload-ticket",
              headers: { "Content-Type": "application/octet-stream" },
            }],
          },
        };
      })
      .add("POST:/mutations/commit", (req) => {
        capturedCommitBody = req.body as Record<string, unknown>;
        return {
          json: {
            status: "committed",
            uploadId: "upload-1",
            revision: 1,
            epoch: 1,
            assets: [{
              assetType: "planner-state",
              assetId: "default",
              contentHash: BLOB_HASH,
              lastModifiedRevision: 1,
            }],
            deletedAssets: [],
            serverTime: "2026-08-09T00:00:00.000Z",
          },
        };
      });

    // 处理 upload URL
    vi.stubGlobal("fetch", (input: RequestInfo, init?: RequestInit) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
      if (url.includes("/uploads/") && init?.method === "PUT") {
        uploadCalled = true;
        if (typeof init?.body === "string") {
          uploadedBody = init.body;
        } else if (ArrayBuffer.isView(init?.body)) {
          uploadedBody = new TextDecoder().decode(init.body as ArrayBufferView<ArrayBuffer>);
        }
        return Promise.resolve(new Response(JSON.stringify({ ok: true }), { status: 200 }));
      }
      return fetchMock.dispatch(input, init);
    });

    const remote = createTestRemote();
    const collection = makeCollection();
    const session = await remote.beginSession({
      reason: "manual",
      collections: [collection],
    });

    fetchMock.add("GET:/plan", () => ({ json: v2Plan([]) }));
    await session.prefetchIndexes([collection]);

    const batch = session.beginWriteBatch();
    const testContent = '{"z":1,"a":2}';
    batch.putAsset({
      collection,
      assetId: "default",
      value: JSON.parse(testContent),
      contentHash: "sha256:abc",
      baseRevision: 0,
      baseContentHash: null,
    });

    const result: RemoteWriteBatchResult = await batch.commit();

    // 验证 prepare body
    expect(capturedPrepareBody).toBeDefined();
    const prepareBody = capturedPrepareBody!;
    expect(prepareBody.protocol).toBe("cf-sync-v2");
    expect(prepareBody.action).toBe("prepare");
    const objects = (prepareBody.objects ?? []) as JsonArray;
    expect(objects.length).toBe(1);
    expect(objects[0]?.assetType).toBe("planner-state");
    expect(objects[0]?.assetId).toBe("default");
    expect(objects[0]?.storageMode).toBe("full");
    expect(objects[0]?.blobHash).toBe(BLOB_HASH);

    // 验证 upload 已调用
    expect(uploadCalled).toBe(true);
    expect(uploadedBody).toBe(testContent);

    // 验证 commit body
    expect(capturedCommitBody).toBeDefined();
    const commitBody = capturedCommitBody!;
    expect(commitBody.action).toBe("commit");
    expect(commitBody.uploadId).toBe("upload-1");
    expect(commitBody.commitToken).toBe("commit-token-1");

    // 验证结果
    expect(result.writes.length).toBe(1);
    expect(result.writes[0]?.revision).toBe(1);
    expect(result.writes[0]?.collection).toBe(collection);
    expect(result.globalCursor).toBe(1);

    let checkUrl = "";
    fetchMock.add("GET:/check", (req) => {
      checkUrl = req.url;
      return { json: {}, status: 204 };
    });
    await session.markApplied({
      collection,
      assetIds: ["default"],
      scopeComplete: true,
      collectionRevision: result.writes[0]?.revision ?? null,
      collectionEtag: null,
    });
    await session.complete?.();
    await session.checkCollections([collection]);
    expect(checkUrl).toContain("knownRevision=1");

    await session.dispose?.();
    remote.dispose?.();
  });

  it("uses the observed plan revision when resolving a conflict with local data", async () => {
    let capturedBaseRevision: unknown = null;
    fetchMock
      .add("GET:/plan", () => ({
        json: v2Plan([{
          assetType: "planner-state",
          assetId: "default",
          contentHash: TEST_HASH,
        }]),
      }))
      .add("POST:/mutations/prepare", (req) => {
        capturedBaseRevision = (req.body as JsonObject).baseRevision;
        return {
          json: {
            status: "ready",
            uploadId: "upload-conflict-local",
            commitToken: "commit-token-conflict-local",
            baseRevision: 1,
            targetRevision: 2,
            targetEpoch: 2,
            expiresAt: "2099-01-01T00:00:00.000Z",
            uploads: [{
              assetType: "planner-state",
              assetId: "default",
              required: false,
              backend: "d1",
              url: null,
              headers: {},
            }],
          },
        };
      })
      .add("POST:/mutations/commit", () => ({
        json: {
          status: "committed",
          uploadId: "upload-conflict-local",
          revision: 2,
          epoch: 2,
          assets: [{
            assetType: "planner-state",
            assetId: "default",
            contentHash: BLOB_HASH,
            lastModifiedRevision: 2,
          }],
          deletedAssets: [],
          serverTime: "2026-08-12T00:00:00.000Z",
        },
      }));

    const remote = createTestRemote();
    const collection = makeCollection();
    const session = await remote.beginSession({
      reason: "foreground",
      collections: [collection],
    });
    await session.prefetchIndexes([collection]);

    const batch = session.beginWriteBatch();
    batch.putAsset({
      collection,
      assetId: "default",
      value: { local: true },
      contentHash: "sha256:local-adapter-hash",
      baseRevision: 1,
      baseContentHash: `sha256:${TEST_HASH}`,
    });
    await batch.commit();

    expect(capturedBaseRevision).toBe("1");
    await session.dispose?.();
    remote.dispose?.();
  });

  it("uploads required blobs in the Worker without exceeding configured concurrency", async () => {
    let activeUploads = 0;
    let startedUploads = 0;
    let maxActiveUploads = 0;
    const releaseUploads: Array<() => void> = [];
    fetchMock
      .add("POST:/mutations/prepare", () => ({
        json: {
          status: "ready",
          uploadId: "parallel-upload",
          commitToken: "parallel-token",
          baseRevision: "0",
          targetRevision: "opaque-1",
          targetEpoch: 1,
          expiresAt: "2099-01-01T00:00:00.000Z",
          uploads: ["one", "two", "three"].map((assetId) => ({
            assetType: "planner-state",
            assetId,
            required: true,
            backend: "d1",
            url: `https://cf-mock.local/uploads/parallel/${assetId}`,
          })),
        },
      }))
      .add("POST:/mutations/commit", () => ({
        json: {
          status: "committed",
          uploadId: "parallel-upload",
          revision: "opaque-1",
          epoch: 1,
          assets: ["one", "two", "three"].map((assetId) => ({
            assetType: "planner-state",
            assetId,
            contentHash: BLOB_HASH,
            lastModifiedRevision: "opaque-1",
          })),
          deletedAssets: [],
          serverTime: "2026-08-12T00:00:00.000Z",
        },
      }));
    vi.stubGlobal("fetch", (input: RequestInfo, init?: RequestInit) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
      if (url.includes("/uploads/parallel/") && init?.method === "PUT") {
        activeUploads += 1;
        startedUploads += 1;
        maxActiveUploads = Math.max(maxActiveUploads, activeUploads);
        return new Promise<Response>((resolve) => {
          releaseUploads.push(() => {
            activeUploads -= 1;
            resolve(new Response(JSON.stringify({ ok: true }), { status: 200 }));
          });
        });
      }
      return fetchMock.dispatch(input, init);
    });

    const remote = createCloudflareSyncRemote({
      apiBase: "https://cf-mock.local",
      spaceId: "default",
      maxConcurrentRequests: 2,
      workerClientFactory: () => new CloudflareV2WorkerClient({
        runtimeFactory: () => new CloudflareV2WorkerRuntime(),
      }),
    });
    const collection = makeCollection();
    const session = await remote.beginSession({ reason: "manual", collections: [collection] });
    const batch = session.beginWriteBatch();
    for (const assetId of ["one", "two", "three"]) {
      batch.putAsset({
        collection,
        assetId,
        value: { assetId },
        contentHash: `sha256:${assetId}`,
        baseRevision: 0,
        baseContentHash: null,
      });
    }
    const commit = batch.commit();

    await vi.waitFor(() => expect(startedUploads).toBe(2));
    expect(maxActiveUploads).toBe(2);
    releaseUploads.shift()?.();
    await vi.waitFor(() => expect(startedUploads).toBe(3));
    for (const release of releaseUploads.splice(0)) {
      release();
    }
    await expect(commit).resolves.toMatchObject({ writes: expect.any(Array) });
    expect(maxActiveUploads).toBe(2);

    await session.complete?.();
    session.dispose?.();
    remote.dispose?.();
  });

  // -- write batch: 空 mutations 直接返回 -- //

  it("returns empty writes for zero mutations", async () => {
    fetchMock
      .add("GET:/check", () => ({ json: {}, status: 204 }));

    const remote = createTestRemote();
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

  it("keeps a prepared transaction journal and recovers it after an upload failure", async () => {
    let cancelCalled = false;
    let uploadAttempts = 0;
    let commitCalled = false;
    fetchMock
      .add("POST:/mutations/prepare", () => ({
        json: {
          status: "ready",
          uploadId: "upload-failed",
          commitToken: "commit-token-failed",
          baseRevision: 0,
          targetRevision: 1,
          targetEpoch: 1,
          expiresAt: "2099-01-01T00:00:00.000Z",
          uploads: [{
            assetType: "planner-state",
            assetId: "default",
            required: true,
            backend: "d1",
            url: "https://cf-mock.local/uploads/upload-failed",
          }],
        },
      }))
      .add("POST:/mutations/cancel", () => {
        cancelCalled = true;
        return { json: { status: "cancelled", uploadId: "upload-failed" } };
      })
      .add("POST:/mutations/commit", () => {
        commitCalled = true;
        return {
          json: {
            status: "committed",
            uploadId: "upload-failed",
            revision: 1,
            epoch: 1,
            assets: [{
              assetType: "planner-state",
              assetId: "default",
              contentHash: BLOB_HASH,
              lastModifiedRevision: 1,
            }],
            deletedAssets: [],
            serverTime: "2026-08-12T00:00:00.000Z",
          },
        };
      });
    vi.stubGlobal("fetch", (input: RequestInfo, init?: RequestInit) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
      if (url.includes("/uploads/upload-failed")) {
        uploadAttempts += 1;
        return Promise.resolve(uploadAttempts === 1
          ? new Response("upload outage", { status: 503 })
          : new Response(JSON.stringify({ ok: true }), { status: 200 }));
      }
      return fetchMock.dispatch(input, init);
    });

    const remote = createTestRemote();
    const collection = makeCollection();
    const session = await remote.beginSession({ reason: "manual", collections: [collection] });
    const batch = session.beginWriteBatch();
    batch.putAsset({
      collection,
      assetId: "default",
      value: {},
      contentHash: "sha256:adapter-hash",
      baseRevision: 0,
      baseContentHash: null,
    });

    await expect(batch.commit()).rejects.toThrow("upload outage");
    expect(cancelCalled).toBe(false);

    remote.dispose?.();

    const recoveredRemote = createTestRemote();
    const recoveredSession = await recoveredRemote.beginSession({
      reason: "foreground",
      collections: [collection],
    });
    expect(uploadAttempts).toBe(2);
    expect(commitCalled).toBe(true);
    await recoveredSession.complete?.();
    recoveredSession.dispose?.();
    recoveredRemote.dispose?.();

    await session.dispose?.();
  });

  // -- write batch: prepare 409 冲突 -- //

  it("rejects when prepare returns conflict (409)", async () => {
    fetchMock
      .add("GET:/check", () => ({ json: {}, status: 204 }))
      .add("POST:/mutations/prepare", () => ({
        json: { error: "revision_mismatch", message: "space revision has changed" },
        status: 409,
      }));

    const remote = createTestRemote();
    const session = await remote.beginSession({
      reason: "manual",
      collections: [makeCollection()],
    });

    const collection = makeCollection();
    const batch = session.beginWriteBatch();
    batch.putAsset({
      collection,
      assetId: "default",
      value: {},
      contentHash: "sha256:abc",
      baseRevision: 0,
      baseContentHash: null,
    });

    await expect(batch.commit()).rejects.toBeInstanceOf(Error);

    await session.dispose?.();
    remote.dispose?.();
  });

  // -- 空间自动创建 -- //

  it("auto-creates space when plan returns 404", async () => {
    let createCalled = false;

    fetchMock
      .add("GET:/plan", () => ({ json: { error: "not_found" }, status: 404 }))
      .add("POST:/spaces", () => {
        createCalled = true;
        return { json: { ok: true, spaceId: "default", revision: 0, epoch: 0, createdAt: "" }, status: 201 };
      });

    // 第二次 plan 成功返回
    let planAttempts = 0;
    vi.stubGlobal("fetch", (input: RequestInfo, init?: RequestInit) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
      if (url.includes("/plan") && planAttempts === 0) {
        planAttempts++;
        return fetchMock.dispatch(input, init);
      }
      if (url.includes("/plan") && planAttempts === 1) {
        planAttempts++;
        return Promise.resolve(new Response(JSON.stringify(v2Plan([])), { status: 200 }));
      }
      return fetchMock.dispatch(input, init);
    });

    const remote = createTestRemote();
    const session = await remote.beginSession({
      reason: "foreground",
      collections: [makeCollection()],
    });

    await session.prefetchIndexes([makeCollection()]);

    expect(createCalled).toBe(true);

    await session.dispose?.();
    remote.dispose?.();
  });

  // -- 提交 tombstone -- //

  it("commits a tombstone through prepare → commit", async () => {
    let capturedObjects: JsonArray | null = null;
    let capturedDeletions: JsonArray | null = null;

    fetchMock
      .add("GET:/check", () => ({ json: {}, status: 204 }))
      .add("POST:/mutations/prepare", (req) => {
        const body = req.body as JsonObject;
        capturedObjects = (body.objects ?? []) as JsonArray;
        capturedDeletions = (body.deletions ?? []) as JsonArray;
        return {
          json: {
            status: "ready",
            uploadId: "upload-2",
            commitToken: "commit-token-2",
            baseRevision: 0,
            targetRevision: 1,
            targetEpoch: 1,
            expiresAt: "2099-01-01T00:00:00.000Z",
            uploads: [],
          },
        };
      })
      .add("POST:/mutations/commit", () => ({
        json: {
          status: "committed",
          uploadId: "upload-2",
          revision: 1,
          epoch: 1,
          assets: [],
          deletedAssets: [{ assetType: "planner-state", assetId: "todelete" }],
          serverTime: "2026-08-09T00:00:00.000Z",
        },
      }));

    const remote = createTestRemote();
    const collection = makeCollection();
    const session = await remote.beginSession({
      reason: "manual",
      collections: [collection],
    });

    fetchMock.add("GET:/plan", () => ({ json: v2Plan([]) }));
    await session.prefetchIndexes([collection]);

    const batch = session.beginWriteBatch();
    batch.putTombstone({
      collection,
      assetId: "todelete",
      deletedAt: "2026-08-09T00:00:00.000Z",
      targetContentHash: null,
      baseRevision: 0,
      baseContentHash: null,
    });

    const result = await batch.commit();

    expect(capturedObjects).not.toBeNull();
    expect(capturedObjects!).toEqual([]);
    expect(capturedDeletions).not.toBeNull();
    expect(capturedDeletions!.length).toBe(1);
    expect(capturedDeletions![0]?.assetType).toBe("planner-state");
    expect(capturedDeletions![0]?.assetId).toBe("todelete");
    expect(result.writes.length).toBe(1);

    await session.dispose?.();
    remote.dispose?.();
  });

  it("deletes every remote asset before clearing local sync state", async () => {
    let capturedDeletions: JsonArray = [];
    fetchMock
      .add("GET:/plan", () => ({
        json: v2Plan([
          { assetType: "planner-state", assetId: "default", contentHash: BLOB_HASH },
          { assetType: "blueprint", assetId: "bp-1", contentHash: BLOB_HASH },
        ]),
      }))
      .add("POST:/mutations/prepare", (req) => {
        capturedDeletions = ((req.body as JsonObject).deletions ?? []) as JsonArray;
        return {
          json: {
            status: "ready",
            uploadId: "delete-all",
            commitToken: "delete-all-token",
            baseRevision: 1,
            targetRevision: 2,
            targetEpoch: 2,
            expiresAt: "2099-01-01T00:00:00.000Z",
            uploads: [],
          },
        };
      })
      .add("POST:/mutations/commit", () => ({
        json: {
          status: "committed",
          uploadId: "delete-all",
          revision: 2,
          epoch: 2,
          assets: [],
          deletedAssets: [
            { assetType: "planner-state", assetId: "default" },
            { assetType: "blueprint", assetId: "bp-1" },
          ],
          serverTime: "2026-08-11T00:00:00.000Z",
        },
      }));

    const remote = createTestRemote();
    await remote.localState.setLastSyncedHash("planner:default", "local-hash");
    await remote.resetRemote?.();

    expect(capturedDeletions).toHaveLength(2);
    expect(capturedDeletions).toEqual(expect.arrayContaining([
      expect.objectContaining({ assetType: "planner-state", assetId: "default" }),
      expect.objectContaining({ assetType: "blueprint", assetId: "bp-1" }),
    ]));
    await expect(remote.localState.getLastSyncedHash("planner:default")).resolves.toBeNull();

    remote.dispose?.();
  });

  // -- 远端无可访问时失败 -- //

  it("fails when the plan endpoint is unavailable", async () => {
    fetchMock
      .add("GET:/plan", () => ({ json: { error: "internal_error" }, status: 503 }));

    const remote = createTestRemote();
    const collection = makeCollection();
    const session = await remote.beginSession({
      reason: "foreground",
      collections: [collection],
    });

    await expect(session.prefetchIndexes([collection])).rejects.toThrow("HTTP 503");

    session.dispose?.();
    remote.dispose?.();
  });
});
