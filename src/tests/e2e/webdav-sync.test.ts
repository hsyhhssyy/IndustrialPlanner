import { expect, test } from "./canvas-lock-audit";

import {
  type BrowserTestWindow,
  clearWebDavRemote,
  closeWebDavSetup,
  countFurnaces,
  enableWebDavSync,
  placeFurnace,
  readCurrentWorldDocumentProjection,
  readRemoteAsset,
  resolveVisibleConflict,
  switchBase,
  waitForAppReady,
  waitForStableSync,
  writeRemoteAsset,
} from "./webdav-e2e-support";

test.setTimeout(240_000);

test.beforeEach(async ({ request }) => {
  await clearWebDavRemote(request);
});

test.afterEach(async ({ request }) => {
  await clearWebDavRemote(request);
});

test("WebDAV 初始同步：连接测试成功并上传当前基地", async ({
  browser,
  page,
}) => {
  await page.goto("/");
  await waitForAppReady(page);
  await enableWebDavSync(page);

  const local = await readCurrentWorldDocumentProjection(page);
  const remote = await readRemoteAsset({
    browser,
    kind: "world-document",
    assetId: local.assetId,
  });
  expect(remote).not.toBeNull();
  expect(remote?.value).toEqual(local.value);
  expect(remote?.revision).toBeGreaterThan(0);
  expect(remote?.collectionRevision).toBeGreaterThan(0);
  expect(remote?.collectionEtag).not.toBeNull();
});

test("WebDAV 远端更新自动下载：无本地改动时直接使用远端内容", async ({
  browser,
  page,
}) => {
  test.setTimeout(300_000);
  await page.goto("/");
  await waitForAppReady(page);
  await enableWebDavSync(page, { testConnection: false });
  await switchBase(page, "stm_hongs_3", "盈天台建设站");
  await waitForStableSync(page);

  const lastUploadAt = await page.evaluate(() =>
    (window as unknown as BrowserTestWindow).__industrialPlannerAppHost
      ?.workspace?.sync?.state.status.lastUploadAt ?? null
  );
  await placeFurnace(page, 50);
  await expect.poll(async () => await page.evaluate(() =>
    (window as unknown as BrowserTestWindow).__industrialPlannerAppHost
      ?.workspace?.sync?.state.status.lastUploadAt ?? null
  ), {
    message: "WebDAV 应先上传包含精炼炉的本地基线",
    timeout: 45_000,
    intervals: [500],
  }).not.toBe(lastUploadAt);
  await waitForStableSync(page);

  const local = await readCurrentWorldDocumentProjection(page);
  expect(countFurnacesInValue(local.value)).toBeGreaterThan(0);
  const remoteValue = createWorldDocumentWithoutFurnaces(local.value);
  const lastDownloadAt = await page.evaluate(() =>
    (window as unknown as BrowserTestWindow).__industrialPlannerAppHost
      ?.workspace?.sync?.state.status.lastDownloadAt ?? null
  );
  const lastUpdateCheckAt = await page.evaluate(() =>
    (window as unknown as BrowserTestWindow).__industrialPlannerAppHost
      ?.workspace?.sync?.state.status.lastUpdateCheckAt ?? null
  );
  const remoteWrite = await writeRemoteAsset({
    browser,
    kind: "world-document",
    assetId: local.assetId,
    value: remoteValue,
  });

  await expect.poll(async () => await page.evaluate(() =>
    (window as unknown as BrowserTestWindow).__industrialPlannerAppHost
      ?.workspace?.sync?.state.status.lastUpdateCheckAt ?? null
  ), {
    message: "WebDAV 更新检查应发现远端 revision 变化",
    timeout: 75_000,
    intervals: [1_000],
  }).not.toBe(lastUpdateCheckAt);
  await waitForStableSync(page);
  await expect.poll(async () => await page.evaluate(() => {
    return (window as unknown as BrowserTestWindow)
      .__industrialPlannerAppHost?.workspace?.sync?.state.status.lastDownloadAt ?? null;
  }), {
    message: "WebDAV 远端版本应自动下载",
    timeout: 30_000,
  }).not.toBe(lastDownloadAt);
  await expect.poll(async () => await countFurnaces(page), {
    message: "WebDAV 远端版本应覆盖当前画布的精炼炉",
    timeout: 30_000,
  }).toBe(0);
  expect(
    await page.getByRole("heading", { name: "同步冲突" }).isVisible().catch(() => false),
  ).toBe(false);
  expect(
    await page.locator('[data-sync-initial-sync-stage="canvas"]')
      .isVisible().catch(() => false),
  ).toBe(false);

  const storedRemote = await readRemoteAsset({
    browser,
    kind: "world-document",
    assetId: local.assetId,
  });
  expect(storedRemote?.revision).toBe(remoteWrite.revision);
  expect(storedRemote?.value).toEqual(remoteValue);
});

for (const resolution of ["use-remote", "use-local"] as const) {
  test(`WebDAV 冲突：${resolution === "use-remote" ? "使用远端" : "使用我的"}`, async ({
    browser,
    page,
  }) => {
    await page.goto("/");
    await waitForAppReady(page);
    await switchBase(page, "stm_hongs_3", "盈天台建设站");
    const baseline = await readCurrentWorldDocumentProjection(page);
    const seeded = await writeRemoteAsset({
      browser,
      kind: "world-document",
      assetId: baseline.assetId,
      value: baseline.value,
    });
    await placeFurnace(page, 50);
    expect(await countFurnaces(page)).toBeGreaterThan(0);

    await enableWebDavSync(page, {
      testConnection: false,
      waitForStable: false,
    });
    await expect(page.getByRole("heading", { name: "同步冲突" }))
      .toBeVisible({ timeout: 90_000 });
    expect(await page.evaluate(() =>
      (window as unknown as BrowserTestWindow).__industrialPlannerAppHost
        ?.workspace?.sync?.state.pendingConflict ?? null
    )).toMatchObject({
      phase: "awaiting-resolution",
      items: expect.arrayContaining([
        expect.objectContaining({
          adapterId: "world-documents",
          assetId: baseline.assetId,
          kind: "conflict",
        }),
      ]),
    });
    await resolveVisibleConflict(page, resolution);

    if (resolution === "use-remote") {
      expect(await countFurnaces(page)).toBe(0);
      const remote = await readRemoteAsset({
        browser,
        kind: "world-document",
        assetId: baseline.assetId,
      });
      expect(remote?.revision).toBe(seeded.revision);
      expect(remote?.value).toEqual(baseline.value);
    } else {
      expect(await countFurnaces(page)).toBeGreaterThan(0);
      const remote = await readRemoteAsset({
        browser,
        kind: "world-document",
        assetId: baseline.assetId,
      });
      expect(remote?.revision).toBeGreaterThan(seeded.revision);
      expect(countFurnacesInValue(remote?.value)).toBeGreaterThan(0);
    }

    await closeWebDavSetup(page);
    const lastUploadAt = await page.evaluate(() =>
      (window as unknown as BrowserTestWindow).__industrialPlannerAppHost
        ?.workspace?.sync?.state.status.lastUploadAt ?? null
    );
    const remoteBeforeIncremental = await readRemoteAsset({
      browser,
      kind: "world-document",
      assetId: baseline.assetId,
    });
    await placeFurnace(page, 130);
    await expect.poll(async () => await page.evaluate(() =>
      (window as unknown as BrowserTestWindow).__industrialPlannerAppHost
        ?.workspace?.sync?.state.status.lastUploadAt ?? null
    ), {
      message: "冲突解决后的本地编辑应继续触发 WebDAV 增量上传",
      timeout: 45_000,
      intervals: [500],
    }).not.toBe(lastUploadAt);
    await waitForStableSync(page);
    const remoteAfterIncremental = await readRemoteAsset({
      browser,
      kind: "world-document",
      assetId: baseline.assetId,
    });
    expect(remoteAfterIncremental?.revision)
      .toBeGreaterThan(remoteBeforeIncremental?.revision ?? 0);
    expect(countFurnacesInValue(remoteAfterIncremental?.value))
      .toBe(await countFurnaces(page));
  });
}

function createWorldDocumentWithoutFurnaces(value: unknown): unknown {
  if (
    !isRecord(value)
    || !isRecord(value.entities)
    || !Array.isArray(value.entityOrder)
  ) {
    throw new Error("World document entities are unavailable.");
  }
  const removedEntityIds = new Set(
    Object.entries(value.entities).flatMap(([entityId, entity]) =>
      isRecord(entity) && entity.definitionId === "furnance_1"
        ? [entityId]
        : []
    ),
  );
  return {
    ...value,
    entities: Object.fromEntries(
      Object.entries(value.entities).filter(([entityId]) =>
        !removedEntityIds.has(entityId)
      ),
    ),
    entityOrder: value.entityOrder.filter((entityId) =>
      typeof entityId === "string" && !removedEntityIds.has(entityId)
    ),
  };
}

function countFurnacesInValue(value: unknown): number {
  if (!isRecord(value) || !isRecord(value.entities)) {
    return 0;
  }
  return Object.values(value.entities).filter((entity) =>
    isRecord(entity) && entity.definitionId === "furnance_1"
  ).length;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
