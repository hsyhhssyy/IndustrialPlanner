import {
  expect,
  type APIRequestContext,
  type Page,
} from "./canvas-lock-audit";
import type { Browser } from "playwright/test";

export const WEBDAV_E2E_URL = "http://127.0.0.1:4175";
export const WEBDAV_E2E_USERNAME = "industrial-planner-e2e";
export const WEBDAV_E2E_PASSWORD = "industrial-planner-e2e";

export type WebDavRemoteAssetKind = "blueprint" | "world-document";

export interface BrowserWorldDocument {
  readonly baseId: string;
  readonly meta: {
    readonly name: string;
  };
  readonly entities: Readonly<Record<string, {
    readonly definitionId: string;
  }>>;
}

export interface BrowserSyncState {
  readonly settings: {
    readonly enabled: boolean;
  };
  readonly status: {
    readonly phase: string;
    readonly saveState: string;
    readonly currentRunReason: string | null;
    readonly initialSyncStage: string;
    readonly hasCompletedInitialFeatureSync: boolean;
    readonly pendingLocalChangeCount: number;
    readonly lastError: string | null;
    readonly lastUploadAt: string | null;
    readonly lastDownloadAt: string | null;
    readonly lastUpdateCheckAt: string | null;
  };
  readonly pendingConflict: unknown;
}

export interface BrowserTestWindow {
  readonly __industrialPlannerAppHost?: {
    readonly workspace?: {
      readonly editor?: {
        readonly document?: {
          getSnapshot(): BrowserWorldDocument;
        };
      };
      readonly sync?: {
        readonly actions: {
          syncNow(): Promise<void>;
        };
        readonly state: BrowserSyncState;
      };
    };
  };
}

export interface WebDavRemoteAssetSnapshot {
  readonly value: unknown;
  readonly revision: number;
  readonly contentHash: string;
  readonly collectionRevision: number;
  readonly collectionEtag: string | null;
}

export async function clearWebDavRemote(
  request: APIRequestContext,
): Promise<void> {
  const response = await request.delete(`${WEBDAV_E2E_URL}/industrial-planner`, {
    headers: createAuthorizationHeaders(),
  });
  expect(
    [204, 404],
    `Unexpected WebDAV cleanup response: HTTP ${response.status()} ${await response.text()}`,
  ).toContain(response.status());
}

export async function waitForAppReady(page: Page): Promise<void> {
  await page.waitForFunction(() =>
    Boolean(
      (window as unknown as BrowserTestWindow).__industrialPlannerAppHost
        ?.workspace?.sync,
    )
  );
  await page.getByTitle("设置").waitFor({ state: "visible", timeout: 30_000 });
}

export async function enableWebDavSync(
  page: Page,
  options: {
    readonly testConnection?: boolean;
    readonly waitForStable?: boolean;
  } = {},
): Promise<void> {
  await page.getByTitle("设置").click();
  const settingsDialog = page.getByRole("dialog", { name: "设置" });
  await expect(settingsDialog).toBeVisible({ timeout: 10_000 });

  const hasSidebar = await settingsDialog.getByRole("tree").isVisible().catch(() => false);
  if (hasSidebar) {
    await settingsDialog.getByRole("treeitem", { name: "其他" }).click();
  }
  const experimentalToggle = settingsDialog.locator(
    'input[name="other-experimental-features"]',
  );
  await expect(experimentalToggle).toBeVisible({ timeout: 5_000 });
  if (!(await experimentalToggle.isChecked())) {
    await settingsDialog.locator(
      'label[for="setting-other-experimental-features"]',
    ).click();
    await page.getByRole("button", { name: "开启实验性功能" }).click();
  }

  if (hasSidebar) {
    await settingsDialog.getByRole("treeitem", { name: "实验性" }).click();
  }
  await settingsDialog.locator('select[name="sync-provider"]').selectOption("webdav");

  const webDavDialog = page.getByRole("dialog", { name: "同步状态" });
  await expect(webDavDialog).toBeVisible();
  await webDavDialog.getByLabel("WebDAV 地址").fill(WEBDAV_E2E_URL);
  await webDavDialog.getByLabel("用户名").fill(WEBDAV_E2E_USERNAME);
  await webDavDialog.getByLabel("密码").fill(WEBDAV_E2E_PASSWORD);

  if (options.testConnection !== false) {
    await webDavDialog.getByRole("button", { name: "测试连接" }).click();
    await expect(webDavDialog.getByText("连接成功", { exact: true }))
      .toBeVisible({ timeout: 15_000 });
  }

  const activateButton = webDavDialog.getByRole("button", { name: "应用并启用" });
  await expect(activateButton).toBeEnabled();
  await activateButton.click();
  if (options.waitForStable === false) {
    return;
  }
  await waitForStableSync(page);

  await closeWebDavSetup(page);
}

export async function closeWebDavSetup(page: Page): Promise<void> {
  const settingsDialog = page.getByRole("dialog", { name: "设置" });
  const webDavDialog = page.getByRole("dialog", { name: "同步状态" });
  await webDavDialog.getByRole("button", { name: "关闭", exact: true }).click();
  await expect(webDavDialog).not.toBeVisible();
  await settingsDialog.getByRole("button", { name: "关闭", exact: true }).click();
  await expect(settingsDialog).not.toBeVisible();
}

export async function resolveVisibleConflict(
  page: Page,
  resolution: "use-local" | "use-remote",
): Promise<void> {
  const conflictTitle = page.getByRole("heading", { name: "同步冲突" });
  await expect(conflictTitle).toBeVisible({ timeout: 90_000 });
  const batchButton = page.getByRole("button", {
    name: resolution === "use-remote" ? "全部使用远端" : "全部使用我的",
  });
  if (await batchButton.isVisible().catch(() => false)) {
    await batchButton.click();
  } else {
    const radios = page.locator(`input[value="${resolution}"]`);
    await Promise.all(
      Array.from({ length: await radios.count() }, (_, index) =>
        radios.nth(index).check({ force: true })
      ),
    );
  }
  await page.getByRole("button", { name: "应用" }).click();
  await expect(conflictTitle).not.toBeVisible({ timeout: 30_000 });
  await waitForStableSync(page);
}

export async function waitForStableSync(page: Page): Promise<void> {
  await expect.poll(async () => await page.evaluate(() => {
    const sync = (window as unknown as BrowserTestWindow)
      .__industrialPlannerAppHost?.workspace?.sync;
    return sync === undefined
      ? null
      : {
          settingsEnabled: sync.state.settings.enabled,
          phase: sync.state.status.phase,
          saveState: sync.state.status.saveState,
          currentRunReason: sync.state.status.currentRunReason,
          initialSyncStage: sync.state.status.initialSyncStage,
          hasCompletedInitialFeatureSync:
            sync.state.status.hasCompletedInitialFeatureSync,
          pendingConflict: sync.state.pendingConflict,
          pendingLocalChangeCount: sync.state.status.pendingLocalChangeCount,
          lastError: sync.state.status.lastError,
        };
  }), {
    message: "WebDAV 同步应回到无冲突、无待上传内容的 idle 状态",
    timeout: 120_000,
    intervals: [500],
  }).toEqual({
    settingsEnabled: true,
    phase: "idle",
    saveState: "idle",
    currentRunReason: null,
    initialSyncStage: "ready",
    hasCompletedInitialFeatureSync: true,
    pendingConflict: null,
    pendingLocalChangeCount: 0,
    lastError: null,
  });
}

export async function readCurrentWorldDocumentProjection(
  page: Page,
): Promise<{ readonly assetId: string; readonly value: unknown }> {
  return await page.evaluate(async () => {
    const host = (window as unknown as BrowserTestWindow).__industrialPlannerAppHost;
    const documentSnapshot = host?.workspace?.editor?.document?.getSnapshot();
    if (documentSnapshot === undefined) {
      throw new Error("Current world document is unavailable.");
    }
    const syncHostModuleUrl = "/src/sync/sync-host.ts";
    const syncHost = await import(/* @vite-ignore */ syncHostModuleUrl);
    return {
      assetId: documentSnapshot.baseId,
      value: syncHost.createWorldDocumentRemoteValue(documentSnapshot),
    };
  });
}

export async function switchBase(
  page: Page,
  baseId: string,
  expectedName: string,
): Promise<void> {
  const baseButton = page.locator('[data-ui-button-id="base-current-select"]');
  if (!(await baseButton.isVisible().catch(() => false))) {
    await page.getByTitle("基地").click();
    await expect(baseButton).toBeVisible({ timeout: 10_000 });
  }
  await baseButton.click();
  const target = page.locator(`[data-base-id="${baseId}"]`);
  await expect(target).toBeVisible({ timeout: 10_000 });
  await target.click();
  await page.getByRole("button", { name: "确定" }).last().click();
  await expect(baseButton).toContainText(expectedName);
  await expect.poll(async () => await page.evaluate(() =>
    (window as unknown as BrowserTestWindow).__industrialPlannerAppHost
      ?.workspace?.editor?.document?.getSnapshot()?.baseId ?? null
  )).toBe(baseId);
}

export async function placeFurnace(page: Page, offset: number): Promise<void> {
  const placementButton = page.getByTitle("放置模式");
  const furnace = page.locator('[data-ui-button-id="placement-furnance_1"]');
  if (!(await furnace.isVisible().catch(() => false))) {
    await placementButton.click();
  }
  await furnace.scrollIntoViewIfNeeded();
  await expect(furnace).toBeVisible({ timeout: 15_000 });
  const previousCount = await countFurnaces(page);
  await furnace.click();
  const canvas = page.locator("canvas").first();
  const box = await canvas.boundingBox();
  if (box === null) {
    throw new Error("Canvas bounding box is unavailable.");
  }
  await canvas.click({
    position: {
      x: box.width / 2 + offset,
      y: box.height / 2 + offset,
    },
  });
  await expect.poll(async () => await countFurnaces(page), {
    message: "画布放置应创建一台精炼炉",
    timeout: 10_000,
  }).toBeGreaterThan(previousCount);
}

export async function mutateStoredWorldDocument(options: {
  readonly page: Page;
  readonly baseId: string;
  readonly name: string;
  readonly notifyDirty: boolean;
}): Promise<void> {
  const result = await options.page.evaluate(async ({ baseId, name, notifyDirty }) => {
    const storageModuleUrl = "/src/shared/storage/world-document-storage.ts";
    const storage = await import(/* @vite-ignore */ storageModuleUrl);
    const documents = await storage.listLatestWorldDocumentsByBase({});
    const document = documents.get(baseId);
    if (document === undefined) {
      throw new Error(`Stored world document is unavailable: ${baseId}`);
    }
    const nextDocument = {
      ...document,
      meta: {
        ...document.meta,
        name,
        updatedAt: new Date().toISOString(),
      },
    };
    await storage.writeWorldDocument(nextDocument);
    if (notifyDirty) {
      const changeModuleUrl = "/src/shared/storage/storage-change-event.ts";
      const changeModule = await import(/* @vite-ignore */ changeModuleUrl);
      changeModule.emitStorageChange({
        assetType: "world-document",
        assetId: nextDocument.documentKey,
        origin: "local",
        timestamp: Date.now(),
      });
    }
    return {
      baseId: nextDocument.baseId,
      name: nextDocument.meta.name,
    };
  }, {
    baseId: options.baseId,
    name: options.name,
    notifyDirty: options.notifyDirty,
  });
  expect(result).toEqual({ baseId: options.baseId, name: options.name });
}

export async function countFurnaces(page: Page): Promise<number> {
  return await page.evaluate(() =>
    Object.values(
      (window as unknown as BrowserTestWindow).__industrialPlannerAppHost
        ?.workspace?.editor?.document?.getSnapshot()?.entities ?? {},
    ).filter((entity) => entity.definitionId === "furnance_1").length
  );
}

export async function syncNow(page: Page): Promise<void> {
  await page.evaluate(async () => {
    const sync = (window as unknown as BrowserTestWindow)
      .__industrialPlannerAppHost?.workspace?.sync;
    if (sync === undefined) {
      throw new Error("Sync actions are unavailable.");
    }
    await sync.actions.syncNow();
  });
}

export async function writeRemoteAsset(options: {
  readonly browser: Browser;
  readonly kind: WebDavRemoteAssetKind;
  readonly assetId: string;
  readonly value: unknown;
}): Promise<WebDavRemoteAssetSnapshot> {
  return await withRemoteControlPage(options.browser, async (page) =>
    await page.evaluate(async ({ assetId, kind, value, connection }) => {
      const clientModuleUrl = "/src/sync/clients/webdav/webdav-client.ts";
      const remoteModuleUrl = "/src/sync/clients/webdav/webdav-remote.ts";
      const collectionsModuleUrl = "/src/sync/remote-collections.ts";
      const [clientModule, remoteModule, collectionsModule] = await Promise.all([
        import(/* @vite-ignore */ clientModuleUrl),
        import(/* @vite-ignore */ remoteModuleUrl),
        import(/* @vite-ignore */ collectionsModuleUrl),
      ]);
      const collection = kind === "world-document"
        ? collectionsModule.createSyncRemoteCollection({
            adapterId: "world-documents",
            mode: "patch-with-revision",
            assetType: "world-document",
            stateKey: "documents/by-base/index.json",
            webDav: {
              kind: "patch-collection-with-revision",
              indexPath: "documents/by-base/index.json",
              directoryPath: (id: string) => `documents/by-base/${encodeURIComponent(id)}`,
            },
          })
        : collectionsModule.createSyncRemoteCollection({
            adapterId: "blueprints",
            mode: "full-with-revision",
            assetType: "blueprint",
            stateKey: "assets/blueprints/index.json",
            webDav: {
              kind: "full-with-revision",
              indexPath: "assets/blueprints/index.json",
              entryPath: (id: string) => `assets/blueprints/${id}.json`,
            },
          });
      const client = clientModule.createWebDavStorageClient({
        baseUrl: connection.url,
        username: connection.username,
        password: connection.password,
        maxConcurrentRequests: 4,
      });
      const remote = remoteModule.createWebDavSyncRemote({ client });
      const session = await remote.beginSession({
        reason: "manual",
        collections: [collection],
      });
      try {
        await session.prepareCollections?.([collection]);
        const previous = await session.readAsset({ collection, assetId });
        const [contentHash] = await session.computeContentHashes([{
          algorithm: collection.hashAlgorithm,
          value,
        }]);
        if (contentHash === undefined) {
          throw new Error("Failed to compute the WebDAV test asset hash.");
        }
        const batch = session.beginWriteBatch();
        batch.putAsset({
          collection,
          assetId,
          value,
          contentHash,
          baseRevision: previous?.revision ?? 0,
          baseContentHash: previous?.contentHash ?? null,
        });
        const result = await batch.commit();
        const write = result.writes.find((candidate: { readonly assetId: string }) =>
          candidate.assetId === assetId
        );
        if (write === undefined) {
          throw new Error(`WebDAV write result is unavailable: ${kind}/${assetId}`);
        }
        const index = await remote.beginSession({
          reason: "manual",
          collections: [collection],
        });
        try {
          const collectionIndex = await index.readIndex(collection);
          const stored = await index.readAsset({ collection, assetId });
          if (stored === null) {
            throw new Error(`WebDAV asset is unavailable after write: ${kind}/${assetId}`);
          }
          return {
            value: stored.value,
            revision: stored.revision,
            contentHash: stored.contentHash,
            collectionRevision: collectionIndex.revision,
            collectionEtag: collectionIndex.etag,
          };
        } finally {
          index.dispose?.();
        }
      } finally {
        session.dispose?.();
        remote.dispose?.();
      }
    }, {
      assetId: options.assetId,
      kind: options.kind,
      value: options.value,
      connection: {
        url: WEBDAV_E2E_URL,
        username: WEBDAV_E2E_USERNAME,
        password: WEBDAV_E2E_PASSWORD,
      },
    }) as Promise<WebDavRemoteAssetSnapshot>
  );
}

export async function readRemoteAsset(options: {
  readonly browser: Browser;
  readonly kind: WebDavRemoteAssetKind;
  readonly assetId: string;
}): Promise<WebDavRemoteAssetSnapshot | null> {
  return await withRemoteControlPage(options.browser, async (page) =>
    await page.evaluate(async ({ assetId, kind, connection }) => {
      const clientModuleUrl = "/src/sync/clients/webdav/webdav-client.ts";
      const remoteModuleUrl = "/src/sync/clients/webdav/webdav-remote.ts";
      const collectionsModuleUrl = "/src/sync/remote-collections.ts";
      const [clientModule, remoteModule, collectionsModule] = await Promise.all([
        import(/* @vite-ignore */ clientModuleUrl),
        import(/* @vite-ignore */ remoteModuleUrl),
        import(/* @vite-ignore */ collectionsModuleUrl),
      ]);
      const collection = kind === "world-document"
        ? collectionsModule.createSyncRemoteCollection({
            adapterId: "world-documents",
            mode: "patch-with-revision",
            assetType: "world-document",
            stateKey: "documents/by-base/index.json",
            webDav: {
              kind: "patch-collection-with-revision",
              indexPath: "documents/by-base/index.json",
              directoryPath: (id: string) => `documents/by-base/${encodeURIComponent(id)}`,
            },
          })
        : collectionsModule.createSyncRemoteCollection({
            adapterId: "blueprints",
            mode: "full-with-revision",
            assetType: "blueprint",
            stateKey: "assets/blueprints/index.json",
            webDav: {
              kind: "full-with-revision",
              indexPath: "assets/blueprints/index.json",
              entryPath: (id: string) => `assets/blueprints/${id}.json`,
            },
          });
      const client = clientModule.createWebDavStorageClient({
        baseUrl: connection.url,
        username: connection.username,
        password: connection.password,
        maxConcurrentRequests: 4,
      });
      const remote = remoteModule.createWebDavSyncRemote({ client });
      const session = await remote.beginSession({
        reason: "manual",
        collections: [collection],
      });
      try {
        const [asset, index] = await Promise.all([
          session.readAsset({ collection, assetId }),
          session.readIndex(collection),
        ]);
        return asset === null
          ? null
          : {
              value: asset.value,
              revision: asset.revision,
              contentHash: asset.contentHash,
              collectionRevision: index.revision,
              collectionEtag: index.etag,
            };
      } finally {
        session.dispose?.();
        remote.dispose?.();
      }
    }, {
      assetId: options.assetId,
      kind: options.kind,
      connection: {
        url: WEBDAV_E2E_URL,
        username: WEBDAV_E2E_USERNAME,
        password: WEBDAV_E2E_PASSWORD,
      },
    }) as Promise<WebDavRemoteAssetSnapshot | null>
  );
}

function createAuthorizationHeaders(): Record<string, string> {
  return {
    Authorization: `Basic ${Buffer.from(
      `${WEBDAV_E2E_USERNAME}:${WEBDAV_E2E_PASSWORD}`,
    ).toString("base64")}`,
  };
}

async function withRemoteControlPage<TResult>(
  browser: Browser,
  run: (page: Page) => Promise<TResult>,
): Promise<TResult> {
  const context = await browser.newContext({
    baseURL: "http://127.0.0.1:4174",
  });
  try {
    const page = await context.newPage();
    await page.goto("/");
    return await run(page);
  } finally {
    await context.close();
  }
}
