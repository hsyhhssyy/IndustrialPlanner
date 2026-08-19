/**
 * Cloudflare 迁移同步 E2E：本地与远端曾同步一致时，版本迁移应作为本地编辑上传，
 * 不得产生用户可见冲突。
 */
import { createHash, randomUUID } from "node:crypto";

import {
  expect,
  test,
  type APIRequestContext,
  type Page,
} from "playwright/test";

import { BLUEPRINT_SCHEMA_VERSION } from "../../domain/document/blueprint-document";
import { WORLD_DOCUMENT_SCHEMA_VERSION } from "../../domain/document/world-document";
import {
  CF_SYNC_V2_PROTOCOL,
  type CfV2CommitResult,
  type CfV2PlanResponse,
  type CfV2PrepareResponse,
} from "../../sync/clients/cloudflare/cloudflare-v2-types";

const BACKEND_API_BASE_URL = "https://endfield-api.richetriotour.net";
const LEGACY_SCHEMA_VERSION = 4;
const LEGACY_ENTITY_ID = "e2e-schema-4-dark-pipe-inlet";

interface BrowserSyncState {
  readonly phase: string;
  readonly saveState: string;
  readonly initialSyncStage: string;
  readonly pendingLocalChangeCount: number;
  readonly lastError: string | null;
  readonly pendingConflict: unknown;
}

interface BrowserTestWindow {
  readonly __industrialPlannerAppHost?: {
    readonly workspace?: {
      readonly editor?: {
        readonly document?: {
          getSnapshot(): {
            readonly schemaVersion: number;
            readonly documentKey: string;
            readonly baseId: string;
            readonly meta: Readonly<Record<string, unknown>>;
            readonly entities: Readonly<Record<string, unknown>>;
            readonly entityOrder: readonly string[];
            readonly slotLinks: readonly unknown[];
            readonly documentSettings: Readonly<Record<string, unknown>>;
          };
        };
      };
      readonly sync?: {
        readonly state: {
          readonly status: Omit<BrowserSyncState, "pendingConflict">;
          readonly pendingConflict: unknown;
        };
      };
    };
  };
}

test.setTimeout(240_000);

test("Cloudflare 当前文档迁移：无冲突并将 schema 4 升级结果写回远端", async ({
  page,
  request,
}) => {
  const spaceId = `e2e-cf-migration-world-${randomUUID()}`;

  try {
    await page.goto("/");
    await page.getByTitle("设置").waitFor({ state: "visible", timeout: 30_000 });

    const fixture = await prepareWorldDocumentMigrationFixture(page, spaceId);
    const seededRevision = await seedRemoteAsset({
      request,
      spaceId,
      assetType: "world-document",
      assetId: fixture.assetId,
      value: fixture.remoteValue,
    });
    await seedBrowserSyncBaseline({
      page,
      spaceId,
      revision: seededRevision,
      assetKey: `world-documents:${fixture.assetId}`,
      lastSyncedHash: fixture.lastSyncedHash,
    });

    await page.reload();
    const syncState = await waitForSyncTerminalState(page);

    expect(syncState).toEqual({
      phase: "idle",
      saveState: "idle",
      initialSyncStage: "ready",
      pendingLocalChangeCount: 0,
      lastError: null,
      pendingConflict: null,
    });
    await expect(page.getByRole("heading", { name: "同步冲突" })).not.toBeVisible();

    const localDocument = await page.evaluate(async (documentKey) => {
      const browserStorageModuleUrl = "/src/shared/storage/browser-storage.ts";
      const worldStorageModuleUrl = "/src/shared/storage/world-document-storage.ts";
      const [browserStorage, worldStorage] = await Promise.all([
        import(/* @vite-ignore */ browserStorageModuleUrl),
        import(/* @vite-ignore */ worldStorageModuleUrl),
      ]);
      return await browserStorage.readFromIndexedDb({
        ...worldStorage.WORLD_DOCUMENT_DATABASE_LOCATION,
        key: documentKey,
      });
    }, fixture.localDocumentKey) as {
      readonly schemaVersion: number;
      readonly entities: Readonly<Record<string, {
        readonly config: Readonly<Record<string, unknown>>;
      }>>;
    };
    expectMigratedDarkPipeDocument(localDocument, WORLD_DOCUMENT_SCHEMA_VERSION);

    const remoteDocument = await readRemoteAsset({
      request,
      spaceId,
      assetType: "world-document",
      assetId: fixture.assetId,
    });
    expectMigratedDarkPipeDocument(remoteDocument, WORLD_DOCUMENT_SCHEMA_VERSION);
  } finally {
    await clearRemoteTestAssets(request, spaceId);
  }
});

test("Cloudflare 蓝图库蓝图迁移：无冲突并将 schema 4 升级结果写回远端", async ({
  page,
  request,
}) => {
  const spaceId = `e2e-cf-migration-blueprint-${randomUUID()}`;

  try {
    await page.goto("/");
    await page.getByTitle("设置").waitFor({ state: "visible", timeout: 30_000 });

    const fixture = await prepareBlueprintMigrationFixture(page, spaceId);
    const seededRevision = await seedRemoteAsset({
      request,
      spaceId,
      assetType: "blueprint",
      assetId: fixture.assetId,
      value: fixture.remoteValue,
    });
    await seedBrowserSyncBaseline({
      page,
      spaceId,
      revision: seededRevision,
      assetKey: `blueprints:${fixture.assetId}`,
      lastSyncedHash: fixture.lastSyncedHash,
    });

    await page.reload();
    const syncState = await waitForSyncTerminalState(page);

    expect(syncState).toEqual({
      phase: "idle",
      saveState: "idle",
      initialSyncStage: "ready",
      pendingLocalChangeCount: 0,
      lastError: null,
      pendingConflict: null,
    });
    await expect(page.getByRole("heading", { name: "同步冲突" })).not.toBeVisible();

    const localBlueprint = await page.evaluate(async (blueprintId) => {
      const blueprintStorageModuleUrl = "/src/shared/storage/blueprint-storage.ts";
      const blueprintStorage = await import(/* @vite-ignore */ blueprintStorageModuleUrl);
      return await blueprintStorage.readBlueprintRecord(blueprintId);
    }, fixture.assetId) as {
      readonly schemaVersion: number;
      readonly entities: Readonly<Record<string, {
        readonly config: Readonly<Record<string, unknown>>;
      }>>;
    };
    expectMigratedDarkPipeDocument(localBlueprint, BLUEPRINT_SCHEMA_VERSION);

    const remoteBlueprint = await readRemoteAsset({
      request,
      spaceId,
      assetType: "blueprint",
      assetId: fixture.assetId,
    });
    expectMigratedDarkPipeDocument(remoteBlueprint, BLUEPRINT_SCHEMA_VERSION);
  } finally {
    await clearRemoteTestAssets(request, spaceId);
  }
});

async function prepareWorldDocumentMigrationFixture(
  page: Page,
  spaceId: string,
): Promise<{
  readonly assetId: string;
  readonly localDocumentKey: string;
  readonly lastSyncedHash: string;
  readonly remoteValue: unknown;
}> {
  return await page.evaluate(async ({
    apiBaseUrl,
    entityId,
    legacyEntity,
    schemaVersion,
    spaceId,
  }) => {
    const backendAddressModuleUrl = "/src/shared/storage/backend-api-address.ts";
    const browserStorageModuleUrl = "/src/shared/storage/browser-storage.ts";
    const cloudflareSettingsModuleUrl = "/src/shared/storage/cloudflare-sync-settings.ts";
    const hashModuleUrl = "/src/shared/storage/hash-utils.ts";
    const syncHostModuleUrl = "/src/sync/sync-host.ts";
    const worldStorageModuleUrl = "/src/shared/storage/world-document-storage.ts";
    const [
      backendAddress,
      browserStorage,
      cloudflareSettings,
      hashUtils,
      syncHost,
      worldStorage,
    ] = await Promise.all([
      import(/* @vite-ignore */ backendAddressModuleUrl),
      import(/* @vite-ignore */ browserStorageModuleUrl),
      import(/* @vite-ignore */ cloudflareSettingsModuleUrl),
      import(/* @vite-ignore */ hashModuleUrl),
      import(/* @vite-ignore */ syncHostModuleUrl),
      import(/* @vite-ignore */ worldStorageModuleUrl),
    ]);
    const host = (window as unknown as BrowserTestWindow).__industrialPlannerAppHost;
    const currentDocument = host?.workspace?.editor?.document?.getSnapshot();
    if (currentDocument === undefined) {
      throw new Error("Current world document is unavailable.");
    }

    const legacyDocument = {
      ...currentDocument,
      schemaVersion,
      entities: {
        ...currentDocument.entities,
        // AI-REMOVED 2026-08-19:
        // Reason: page.evaluate 浏览器上下文无法捕获 Node 侧辅助函数。
        // Trigger: 新增 E2E 静态复核发现 createLegacyDarkPipeEntity 不会随回调序列化。
        // Evidence: Playwright 只序列化 evaluate 回调与显式参数。
        // Replacement: 下方由 evaluate 参数传入的 legacyEntity。
        // Risk: Low。
        // Human Review: Required
        //
        // Original code:
        // [entityId]: createLegacyDarkPipeEntity(entityId),
        [entityId]: legacyEntity,
      },
      entityOrder: [...currentDocument.entityOrder, entityId],
    };
    const remoteValue = syncHost.createWorldDocumentRemoteValue(legacyDocument);

    await browserStorage.saveToIndexedDb({
      ...worldStorage.WORLD_DOCUMENT_DATABASE_LOCATION,
      key: legacyDocument.documentKey,
    }, legacyDocument);
    localStorage.setItem("v3-editor-persist-state", JSON.stringify({
      lastDocumentId: legacyDocument.documentKey,
      latestDocumentIdByBaseId: {
        [legacyDocument.baseId]: legacyDocument.documentKey,
      },
    }));
    backendAddress.writeBackendApiAddressOverride(apiBaseUrl);
    await cloudflareSettings.writeCloudflareSyncSettings({ spaceName: spaceId });
    localStorage.setItem("v3-sync-provider", "cloudflare");

    return {
      assetId: legacyDocument.baseId,
      localDocumentKey: legacyDocument.documentKey,
      lastSyncedHash: hashUtils.createStableJsonHash(remoteValue),
      remoteValue,
    };
  }, {
    apiBaseUrl: BACKEND_API_BASE_URL,
    entityId: LEGACY_ENTITY_ID,
    legacyEntity: createLegacyDarkPipeEntity(LEGACY_ENTITY_ID),
    schemaVersion: LEGACY_SCHEMA_VERSION,
    spaceId,
  });
}

async function prepareBlueprintMigrationFixture(
  page: Page,
  spaceId: string,
): Promise<{
  readonly assetId: string;
  readonly lastSyncedHash: string;
  readonly remoteValue: unknown;
}> {
  const blueprintId = `e2e-schema-4-blueprint-${randomUUID()}`;

  return await page.evaluate(async ({
    apiBaseUrl,
    blueprintId,
    entityId,
    legacyEntity,
    schemaVersion,
    spaceId,
  }) => {
    const backendAddressModuleUrl = "/src/shared/storage/backend-api-address.ts";
    const blueprintStorageModuleUrl = "/src/shared/storage/blueprint-storage.ts";
    const browserStorageModuleUrl = "/src/shared/storage/browser-storage.ts";
    const cloudflareSettingsModuleUrl = "/src/shared/storage/cloudflare-sync-settings.ts";
    const hashModuleUrl = "/src/shared/storage/hash-utils.ts";
    const [
      backendAddress,
      blueprintStorage,
      browserStorage,
      cloudflareSettings,
      hashUtils,
    ] = await Promise.all([
      import(/* @vite-ignore */ backendAddressModuleUrl),
      import(/* @vite-ignore */ blueprintStorageModuleUrl),
      import(/* @vite-ignore */ browserStorageModuleUrl),
      import(/* @vite-ignore */ cloudflareSettingsModuleUrl),
      import(/* @vite-ignore */ hashModuleUrl),
    ]);
    const timestamp = "2026-08-19T00:00:00.000Z";
    const legacyBlueprint = {
      schemaVersion,
      kind: "blueprint",
      parentFolderId: null,
      blueprintId,
      version: "1.0.0",
      name: "Cloudflare schema 4 migration E2E",
      description: "",
      baseId: "wuling_protocol_core",
      initialGridPoint: { x: 0, y: 0 },
      entities: {
        // AI-REMOVED 2026-08-19:
        // Reason: page.evaluate 浏览器上下文无法捕获 Node 侧辅助函数。
        // Trigger: 新增 E2E 静态复核发现 createLegacyDarkPipeEntity 不会随回调序列化。
        // Evidence: Playwright 只序列化 evaluate 回调与显式参数。
        // Replacement: 下方由 evaluate 参数传入的 legacyEntity。
        // Risk: Low。
        // Human Review: Required
        //
        // Original code:
        // [entityId]: createLegacyDarkPipeEntity(entityId),
        [entityId]: legacyEntity,
      },
      entityOrder: [entityId],
      slotLinks: [],
      createdAt: timestamp,
      updatedAt: timestamp,
    };

    await browserStorage.saveToIndexedDb({
      ...blueprintStorage.BLUEPRINT_STORE_LOCATION,
      key: `blueprint:${blueprintId}`,
    }, legacyBlueprint);
    backendAddress.writeBackendApiAddressOverride(apiBaseUrl);
    await cloudflareSettings.writeCloudflareSyncSettings({ spaceName: spaceId });
    localStorage.setItem("v3-sync-provider", "cloudflare");

    return {
      assetId: blueprintId,
      lastSyncedHash: hashUtils.createStableJsonHash(legacyBlueprint),
      remoteValue: legacyBlueprint,
    };
  }, {
    apiBaseUrl: BACKEND_API_BASE_URL,
    blueprintId,
    entityId: LEGACY_ENTITY_ID,
    legacyEntity: createLegacyDarkPipeEntity(LEGACY_ENTITY_ID),
    schemaVersion: LEGACY_SCHEMA_VERSION,
    spaceId,
  });
}

function createLegacyDarkPipeEntity(entityId: string): {
  readonly id: string;
  readonly definitionId: string;
  readonly position: { readonly x: number; readonly y: number };
  readonly rotation: 0;
  readonly config: Readonly<Record<string, unknown>>;
  readonly tags: readonly string[];
} {
  return {
    id: entityId,
    definitionId: "udpipe_loader_1",
    position: { x: 8, y: 8 },
    rotation: 0,
    config: {
      retained: true,
      recipeChannels: [{ manualRecipeOnly: true }],
      "recipeChannels[0].manualRecipeOnly": true,
    },
    tags: [],
  };
}

async function seedBrowserSyncBaseline(options: {
  readonly page: Page;
  readonly spaceId: string;
  readonly revision: string;
  readonly assetKey: string;
  readonly lastSyncedHash: string;
}): Promise<void> {
  await options.page.evaluate(async ({
    apiBaseUrl,
    assetKey,
    lastSyncedHash,
    revision,
    spaceId,
  }) => {
    const localStateModuleUrl = "/src/sync/clients/cloudflare/cloudflare-v2-local-state.ts";
    const { CloudflareV2LocalStateStore } = await import(
      /* @vite-ignore */ localStateModuleUrl
    );
    const state = new CloudflareV2LocalStateStore(apiBaseUrl, spaceId);
    await state.writeAppliedRevision(revision);
    await state.setLastSyncedHash(assetKey, lastSyncedHash);
  }, {
    apiBaseUrl: BACKEND_API_BASE_URL,
    assetKey: options.assetKey,
    lastSyncedHash: options.lastSyncedHash,
    revision: options.revision,
    spaceId: options.spaceId,
  });
}

async function waitForSyncTerminalState(page: Page): Promise<BrowserSyncState> {
  await page.waitForFunction(() => {
    const sync = (window as unknown as BrowserTestWindow)
      .__industrialPlannerAppHost?.workspace?.sync;
    if (sync === undefined) {
      return false;
    }
    const status = sync.state.status;
    return sync.state.pendingConflict !== null
      || status.lastError !== null
      || (
        status.phase === "idle"
        && status.saveState === "idle"
        && status.initialSyncStage === "ready"
        && status.pendingLocalChangeCount === 0
      );
  }, undefined, { timeout: 150_000 });

  return await page.evaluate(() => {
    const sync = (window as unknown as BrowserTestWindow)
      .__industrialPlannerAppHost?.workspace?.sync;
    if (sync === undefined) {
      throw new Error("Sync state is unavailable.");
    }
    return {
      phase: sync.state.status.phase,
      saveState: sync.state.status.saveState,
      initialSyncStage: sync.state.status.initialSyncStage,
      pendingLocalChangeCount: sync.state.status.pendingLocalChangeCount,
      lastError: sync.state.status.lastError,
      pendingConflict: sync.state.pendingConflict,
    };
  });
}

function expectMigratedDarkPipeDocument(
  value: unknown,
  expectedSchemaVersion: number,
): void {
  expect(value).toMatchObject({
    schemaVersion: expectedSchemaVersion,
    entities: {
      [LEGACY_ENTITY_ID]: {
        config: { retained: true },
      },
    },
  });
  const document = value as {
    readonly entities: Readonly<Record<string, {
      readonly config: Readonly<Record<string, unknown>>;
    }>>;
  };
  expect(document.entities[LEGACY_ENTITY_ID]?.config).not.toHaveProperty("recipeChannels");
  expect(document.entities[LEGACY_ENTITY_ID]?.config)
    .not.toHaveProperty("recipeChannels[0].manualRecipeOnly");
}

async function seedRemoteAsset(options: {
  readonly request: APIRequestContext;
  readonly spaceId: string;
  readonly assetType: string;
  readonly assetId: string;
  readonly value: unknown;
}): Promise<string> {
  const createResponse = await options.request.post(
    `${BACKEND_API_BASE_URL}/v1/sync/spaces`,
    { data: { spaceId: options.spaceId } },
  );
  expect(createResponse.status(), await createResponse.text()).toBe(201);

  const contentBytes = Buffer.from(JSON.stringify(options.value));
  const prepareResponse = await options.request.post(
    `${BACKEND_API_BASE_URL}/v1/sync/spaces/${encodeURIComponent(options.spaceId)}/mutations`,
    {
      data: {
        protocol: CF_SYNC_V2_PROTOCOL,
        action: "prepare",
        baseRevision: "0",
        clientBatchId: randomUUID(),
        objects: [{
          clientMutationId: randomUUID(),
          assetType: options.assetType,
          assetId: options.assetId,
          metadata: "{}",
          blobHash: createHash("sha256").update(contentBytes).digest("hex"),
          blobByteSize: contentBytes.byteLength,
          storageMode: "full",
          schemaVersion: 1,
          encoding: "identity",
          writerAppVersion: "e2e-schema-4",
          writerBuildId: "playwright",
        }],
        deletions: [],
      },
    },
  );
  expect(prepareResponse.ok(), await prepareResponse.text()).toBe(true);
  const prepare = await prepareResponse.json() as CfV2PrepareResponse;

  for (const upload of prepare.uploads) {
    if (!upload.required) {
      continue;
    }
    expect(upload.url).toBeTruthy();
    const uploadResponse = await options.request.put(upload.url!, {
      data: contentBytes,
      headers: {
        "content-type": "application/octet-stream",
        ...upload.headers,
      },
    });
    expect(uploadResponse.ok(), await uploadResponse.text()).toBe(true);
  }

  const commitResponse = await options.request.post(
    `${BACKEND_API_BASE_URL}/v1/sync/spaces/${encodeURIComponent(options.spaceId)}/mutations`,
    {
      data: {
        protocol: CF_SYNC_V2_PROTOCOL,
        action: "commit",
        uploadId: prepare.uploadId,
        commitToken: prepare.commitToken,
      },
    },
  );
  expect(commitResponse.ok(), await commitResponse.text()).toBe(true);
  const commit = await commitResponse.json() as CfV2CommitResult;
  return commit.revision;
}

async function readRemoteAsset(options: {
  readonly request: APIRequestContext;
  readonly spaceId: string;
  readonly assetType: string;
  readonly assetId: string;
}): Promise<unknown> {
  const plan = await readRemotePlan(options.request, options.spaceId);
  const asset = plan.assets.find((candidate) =>
    candidate.assetType === options.assetType
    && candidate.assetId === options.assetId
  );
  expect(asset, `Remote ${options.assetType}/${options.assetId} should exist.`).toBeDefined();

  const response = await options.request.get(asset!.downloadUrl);
  expect(response.ok(), await response.text()).toBe(true);
  return await response.json() as unknown;
}

async function readRemotePlan(
  request: APIRequestContext,
  spaceId: string,
): Promise<CfV2PlanResponse> {
  const response = await request.get(
    `${BACKEND_API_BASE_URL}/v1/sync/spaces/${encodeURIComponent(spaceId)}/plan`,
  );
  expect(response.ok(), await response.text()).toBe(true);
  return await response.json() as CfV2PlanResponse;
}

async function clearRemoteTestAssets(
  request: APIRequestContext,
  spaceId: string,
): Promise<void> {
  const planResponse = await request.get(
    `${BACKEND_API_BASE_URL}/v1/sync/spaces/${encodeURIComponent(spaceId)}/plan`,
  );
  if (planResponse.status() === 404) {
    return;
  }
  expect(planResponse.ok(), await planResponse.text()).toBe(true);

  const plan = await planResponse.json() as CfV2PlanResponse;
  let baseRevision = plan.revision;
  for (let offset = 0; offset < plan.assets.length; offset += 32) {
    const assets = plan.assets.slice(offset, offset + 32);
    const prepareResponse = await request.post(
      `${BACKEND_API_BASE_URL}/v1/sync/spaces/${encodeURIComponent(spaceId)}/mutations`,
      {
        data: {
          protocol: CF_SYNC_V2_PROTOCOL,
          action: "prepare",
          baseRevision,
          clientBatchId: randomUUID(),
          objects: [],
          deletions: assets.map((asset) => ({
            clientMutationId: randomUUID(),
            assetType: asset.assetType,
            assetId: asset.assetId,
          })),
        },
      },
    );
    expect(prepareResponse.ok(), await prepareResponse.text()).toBe(true);
    const prepare = await prepareResponse.json() as CfV2PrepareResponse;

    const commitResponse = await request.post(
      `${BACKEND_API_BASE_URL}/v1/sync/spaces/${encodeURIComponent(spaceId)}/mutations`,
      {
        data: {
          protocol: CF_SYNC_V2_PROTOCOL,
          action: "commit",
          uploadId: prepare.uploadId,
          commitToken: prepare.commitToken,
        },
      },
    );
    expect(commitResponse.ok(), await commitResponse.text()).toBe(true);
    const commit = await commitResponse.json() as CfV2CommitResult;
    baseRevision = commit.revision;
  }
}
