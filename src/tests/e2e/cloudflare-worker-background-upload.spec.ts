import { expect, test } from "./canvas-lock-audit";

import type { SyncRemoteCollection } from "../../sync/clients/remote-types";

type CloudflareModuleShape = typeof import("../../sync/clients/cloudflare");

const API_BASE = "https://worker-sync.test";

interface BackgroundUploadState {
  readonly task: Promise<unknown>;
}

test("Cloudflare Dedicated Worker keeps an upload running when the page reports hidden", async ({
  context,
  page,
}) => {
  let releaseUpload = () => {};
  let markUploadStarted = () => {};
  let commitCalled = false;
  const uploadStarted = new Promise<void>((resolve) => {
    markUploadStarted = resolve;
  });
  const uploadGate = new Promise<void>((resolve) => {
    releaseUpload = resolve;
  });

  await context.route(`${API_BASE}/**`, async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    if (request.method() === "PUT" && url.pathname.includes("/uploads/")) {
      markUploadStarted();
      await uploadGate;
      await route.fulfill({ status: 200, json: { ok: true } });
      return;
    }
    const body = request.postDataJSON() as Record<string, unknown> | null;
    if (url.pathname.endsWith("/mutations") && body?.action === "prepare") {
      await route.fulfill({
        status: 200,
        json: {
          status: "ready",
          uploadId: "background-upload",
          commitToken: "background-token",
          baseRevision: "0",
          targetRevision: "opaque-background-1",
          targetEpoch: 1,
          expiresAt: "2099-01-01T00:00:00.000Z",
          serverTime: "2026-08-12T00:00:00.000Z",
          uploads: [{
            assetType: "planner-state",
            assetId: "single",
            required: true,
            backend: "d1",
            url: `${API_BASE}/uploads/background-upload/single`,
          }],
        },
      });
      return;
    }
    if (url.pathname.endsWith("/mutations") && body?.action === "commit") {
      commitCalled = true;
      await route.fulfill({
        status: 200,
        json: {
          status: "committed",
          uploadId: "background-upload",
          revision: "opaque-background-1",
          epoch: 1,
          assets: [{
            assetType: "planner-state",
            assetId: "single",
            contentHash: "9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08",
            lastModifiedRevision: "opaque-background-1",
          }],
          deletedAssets: [],
          serverTime: "2026-08-12T00:00:00.000Z",
        },
      });
      return;
    }
    await route.fulfill({
      status: 500,
      json: { error: "unexpected_request", message: request.url() },
    });
  });

  await page.goto("/");
  await page.evaluate(async () => {
    const modulePath = "/src/sync/clients/cloudflare/index.ts";
    const cloudflare = await import(modulePath) as CloudflareModuleShape;
    const collection: SyncRemoteCollection = {
      adapterId: "planner",
      name: "planner",
      mode: "full-no-revision",
      assetType: "planner-state",
      assetIdCodec: {
        toRemoteAssetId: (assetId) => assetId,
        toAdapterAssetId: (assetId) => assetId,
      },
      hashAlgorithm: "sha256-canonical-json-v1",
      stateKey: "planner",
    };
    const remote = cloudflare.createCloudflareSyncRemote({
      apiBase: "https://worker-sync.test",
      spaceId: "background",
      requestTimeoutMs: 30_000,
    });
    const task = (async () => {
      const session = await remote.beginSession({
        reason: "local-change",
        collections: [collection],
      });
      try {
        const batch = session.beginWriteBatch();
        batch.putAsset({
          collection,
          assetId: "single",
          value: { upload: "continues-in-background" },
          contentHash: "sha256:adapter-hash",
          baseRevision: 0,
          baseContentHash: null,
        });
        return await batch.commit();
      } finally {
        session.dispose?.();
        remote.dispose?.();
      }
    })();
    Reflect.set(globalThis, "__cloudflareBackgroundUpload", { task });
  });

  await uploadStarted;
  // Headless Chromium does not mark non-front pages hidden. Override the browser-owned value and
  // dispatch the real lifecycle event so this remains portable in CI while exercising the real
  // production Worker bundle and in-flight fetch/commit chain.
  await page.evaluate(() => {
    Object.defineProperty(document, "visibilityState", {
      configurable: true,
      value: "hidden",
    });
    document.dispatchEvent(new Event("visibilitychange"));
  });
  expect(await page.evaluate(() => document.visibilityState)).toBe("hidden");

  releaseUpload();
  const result = await page.evaluate(async () => {
    const state = Reflect.get(
      globalThis,
      "__cloudflareBackgroundUpload",
    ) as BackgroundUploadState;
    return await state.task;
  });
  expect(result).toMatchObject({
    writes: [expect.objectContaining({ assetId: "single" })],
  });
  expect(commitCalled).toBe(true);
});
