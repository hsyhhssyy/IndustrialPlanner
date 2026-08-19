// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from "vitest";

import { createSha256Hash } from "@/shared/storage/hash-utils";
import { CloudflareV2WorkerRuntime } from "@/sync/clients/cloudflare/cloudflare-v2-worker-runtime";
import {
  CfV2HttpError,
  type CfV2PlanAsset,
} from "@/sync/clients/cloudflare/cloudflare-v2-types";
import type { CfV2WorkerConfig } from "@/sync/clients/cloudflare/cloudflare-v2-worker-protocol";

const config: CfV2WorkerConfig = {
  apiBase: "https://sync.example.test",
  spaceId: "retry-423",
  maxConcurrentRequests: 4,
  requestTimeoutMs: 30_000,
};

async function createAsset(content: string): Promise<{
  readonly asset: CfV2PlanAsset;
  readonly bytes: Uint8Array<ArrayBuffer>;
}> {
  const bytes = new TextEncoder().encode(content);
  const contentHash = await createSha256Hash(bytes);
  const asset: CfV2PlanAsset = {
    assetType: "world-document",
    assetId: "stm_hongs_3",
    contentHash,
    byteSize: bytes.byteLength,
    encoding: "identity",
    metadata: "{}",
    schemaVersion: 1,
    storageMode: "full",
    backend: "r2",
    lastModifiedRevision: "42",
    downloadUrl: "https://cdn.example.test/assets/1",
  };
  return { asset, bytes };
}

function createReadAssetOperation(asset: CfV2PlanAsset) {
  return {
    type: "read-asset",
    asset,
    planRevision: "42",
    planServerTime: "2026-08-16T00:00:00.000Z",
  } as const;
}

describe("CloudflareV2WorkerRuntime read-asset 423 重试", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("rejects an empty space ID before executing an operation", async () => {
    const runtime = new CloudflareV2WorkerRuntime();

    await expect(runtime.execute(
      { ...config, spaceId: "   " },
      { type: "compute-content-hashes", requests: [] },
    )).rejects.toThrow("Cloudflare space ID must not be empty.");
  });

  it("前几次 423 后成功：重试直到下载成功", async () => {
    const { asset, bytes } = await createAsset('{"entities":{}}');
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response("locked", { status: 423 }))
      .mockResolvedValueOnce(new Response("locked", { status: 423 }))
      .mockResolvedValueOnce(new Response(bytes));
    vi.stubGlobal("fetch", fetchMock);

    const runtime = new CloudflareV2WorkerRuntime();
    const result = await runtime.execute(
      config,
      createReadAssetOperation(asset),
    ) as { revision: number; value: unknown };

    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(result.revision).toBe(42);
    expect(result.value).toEqual({ entities: {} });
  });

  it("持续 423：最多尝试 10 次后抛错", async () => {
    const { asset } = await createAsset('{"entities":{}}');
    const fetchMock = vi.fn().mockResolvedValue(
      new Response("locked", { status: 423 }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const runtime = new CloudflareV2WorkerRuntime();
    const promise = runtime.execute(config, createReadAssetOperation(asset));

    await expect(promise).rejects.toSatisfy((error: unknown) =>
      error instanceof CfV2HttpError && error.status === 423
    );
    expect(fetchMock).toHaveBeenCalledTimes(10);
  });

  it("非 423 下载失败不重试：只请求一次", async () => {
    const { asset } = await createAsset('{"entities":{}}');
    const fetchMock = vi.fn().mockResolvedValue(
      new Response("gone", { status: 404 }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const runtime = new CloudflareV2WorkerRuntime();
    const promise = runtime.execute(config, createReadAssetOperation(asset));

    await expect(promise).rejects.toSatisfy((error: unknown) =>
      error instanceof CfV2HttpError && error.status === 404
    );
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
