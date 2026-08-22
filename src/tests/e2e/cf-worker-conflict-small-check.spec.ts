/**
 * CF Worker 同步 e2e：冲突解决 → 小检查短路 → 增量同步
 * AI-CORRECTION 2026-08-12: Cloudflare 同步当前由主线程直接请求 cf-sync-v2 后端；
 * 本测试名称保留历史称呼，但场景验证的是当前 HTTP 同步实现。
 * AI-CORRECTION 2026-08-12: 上述主线程实现已被 Dedicated Worker v2 链路取代；
 * 本场景继续验证相同后端协议下的冲突、小检查与增量同步。
 *
 * 全部使用文本/role/data 选择器（CSS Module 在 dev 模式被哈希）。
 */
import { createHash, randomUUID } from "node:crypto";

import {
  expect,
  test,
  type APIRequestContext,
  type Page,
} from "playwright/test";

import {
  CF_SYNC_V2_PROTOCOL,
  type CfV2CommitResult,
  type CfV2PlanResponse,
  type CfV2PrepareResponse,
} from "../../sync/clients/cloudflare/cloudflare-v2-types";

const BACKEND_API_BASE_URL = "https://endfield-api.richetriotour.net";
// AI-REMOVED 2026-08-12:
// Reason: 模块级共享空间会让 use-remote 与 use-local 共享远端状态。
// Trigger: 用户要求两个 E2E 各自独立。
// Evidence: 每个 test 现在在自己的作用域内创建唯一 spaceId。
// Replacement: Cloudflare conflict: use remote / use local 内的 spaceId。
// Risk: Low。
// Human Review: Required
//
// Original code:
// const TEST_SPACE_ID = `e2e-cf-conflict-${randomUUID()}`;
const TEST_WORLD_DOCUMENT_ASSET_TYPE = "world-document";

type ConflictResolution = "use-local" | "use-remote";

interface BrowserWorldDocument {
  readonly baseId: string;
  readonly entities: Readonly<Record<string, {
    readonly definitionId: string;
  }>>;
}

interface BrowserSyncState {
  readonly settings: {
    readonly enabled: boolean;
  };
  readonly status: {
    readonly phase: string;
    readonly saveState: string;
    readonly currentRunReason: string | null;
    readonly initialSyncStage: string;
    readonly pendingLocalChangeCount: number;
    readonly lastError: string | null;
    readonly lastSmallCheckAt: string | null;
  };
  readonly pendingConflict: unknown;
}

interface BrowserAppHost {
  readonly workspace?: {
    readonly editor?: {
      readonly document?: {
        getSnapshot(): BrowserWorldDocument;
      };
    };
    readonly sync?: {
      readonly state: BrowserSyncState;
    };
  };
}

interface BrowserTestWindow {
  readonly __industrialPlannerAppHost?: BrowserAppHost;
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

async function tryReadRemoteRevision(
  request: APIRequestContext,
  spaceId: string,
): Promise<string | null> {
  const response = await request.get(
    `${BACKEND_API_BASE_URL}/v1/sync/spaces/${encodeURIComponent(spaceId)}/plan`,
  );
  if (response.status() === 409 || response.status() === 423) {
    return null;
  }
  expect(response.ok(), await response.text()).toBe(true);
  const plan = await response.json() as CfV2PlanResponse;
  return plan.revision;
}

async function seedRemoteWorldDocument(
  request: APIRequestContext,
  spaceId: string,
  assetId: string,
  content: string,
): Promise<string> {
  // AI-CORRECTION 2026-08-22: 该辅助函数同时承担后续远端版本写入；空间已存在时必须
  // 使用当前 revision 作为 baseRevision，不能再次创建空间或固定从 revision 0 提交。
  const planResponse = await request.get(
    `${BACKEND_API_BASE_URL}/v1/sync/spaces/${encodeURIComponent(spaceId)}/plan`,
  );
  let baseRevision = "0";
  if (planResponse.status() === 404) {
    const createResponse = await request.post(
      `${BACKEND_API_BASE_URL}/v1/sync/spaces`,
      { data: { spaceId } },
    );
    expect(createResponse.status(), await createResponse.text()).toBe(201);
  } else {
    expect(planResponse.ok(), await planResponse.text()).toBe(true);
    baseRevision = (await planResponse.json() as CfV2PlanResponse).revision;
  }

  const contentBytes = Buffer.from(content);
  const prepareResponse = await request.post(
    `${BACKEND_API_BASE_URL}/v1/sync/spaces/${encodeURIComponent(spaceId)}/mutations`,
    {
      data: {
        protocol: CF_SYNC_V2_PROTOCOL,
        action: "prepare",
        baseRevision,
        clientBatchId: randomUUID(),
        objects: [{
          clientMutationId: randomUUID(),
          assetType: TEST_WORLD_DOCUMENT_ASSET_TYPE,
          assetId,
          metadata: "{}",
          blobHash: createHash("sha256").update(contentBytes).digest("hex"),
          blobByteSize: contentBytes.byteLength,
          storageMode: "full",
          schemaVersion: 1,
          encoding: "identity",
          writerAppVersion: "e2e",
          writerBuildId: "playwright",
        }],
        deletions: [],
      },
    },
  );
  expect(prepareResponse.ok(), await prepareResponse.text()).toBe(true);
  const prepare = await prepareResponse.json() as CfV2PrepareResponse;

  for (const upload of prepare.uploads) {
    if (!upload.required) continue;
    expect(upload.url).toBeTruthy();
    const uploadResponse = await request.put(upload.url!, {
      data: contentBytes,
      headers: {
        "content-type": "application/octet-stream",
        ...upload.headers,
      },
    });
    expect(uploadResponse.ok(), await uploadResponse.text()).toBe(true);
  }

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
  return commit.revision;
}

async function clearRemoteTestAssets(
  request: APIRequestContext,
  spaceId: string,
): Promise<void> {
  const planResponse = await request.get(
    `${BACKEND_API_BASE_URL}/v1/sync/spaces/${encodeURIComponent(spaceId)}/plan`,
  );
  if (planResponse.status() === 404) return;
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

function createWorldDocumentVariant(
  content: string,
  name: string,
): string {
  const document = JSON.parse(content) as Record<string, unknown>;
  const meta = document.meta;
  if (typeof meta !== "object" || meta === null || Array.isArray(meta)) {
    throw new Error("World document metadata is unavailable.");
  }

  return JSON.stringify({
    ...document,
    meta: {
      ...meta,
      name,
      updatedAt: new Date().toISOString(),
    },
  });
}

async function readCurrentWorldDocumentProjection(page: Page): Promise<{
  readonly assetId: string;
  readonly content: string;
}> {
  return await page.evaluate(async () => {
    const host = (window as unknown as BrowserTestWindow).__industrialPlannerAppHost;
    const documentSnapshot = host?.workspace?.editor?.document?.getSnapshot();
    if (!documentSnapshot) {
      throw new Error("Current world document is unavailable.");
    }
    const syncHostModuleUrl = "/src/sync/sync-host.ts";
    const { createWorldDocumentRemoteValue } = await import(
      /* @vite-ignore */ syncHostModuleUrl
    );
    return {
      assetId: documentSnapshot.baseId as string,
      content: JSON.stringify(createWorldDocumentRemoteValue(documentSnapshot)),
    };
  });
}

async function mutateStoredWorldDocument(
  page: Page,
  baseId: string,
  name: string,
): Promise<void> {
  const mutationResult = await page.evaluate(async ({ targetBaseId, nextName }) => {
    const storageModuleUrl = "/src/shared/storage/world-document-storage.ts";
    const storage = await import(/* @vite-ignore */ storageModuleUrl);
    const documents = await storage.listLatestWorldDocumentsByBase({});
    const document = documents.get(targetBaseId);
    if (document === undefined) {
      throw new Error(`Stored world document is unavailable: ${targetBaseId}`);
    }

    const nextDocument = {
      ...document,
      meta: {
        ...document.meta,
        name: nextName,
        updatedAt: new Date().toISOString(),
      },
    };
    // 直接写入持久化层用于构造“非当前基地已在另一标签页发生本地改动”的真实同步输入；
    // 不调用编辑器 action，避免测试过程切换到目标基地并提前触发同步。
    await storage.writeWorldDocument(nextDocument);
    return {
      baseId: nextDocument.baseId as string,
      name: nextDocument.meta.name as string,
    };
  }, {
    targetBaseId: baseId,
    nextName: name,
  });

  expect(mutationResult).toEqual({ baseId, name });
}

async function switchBase(
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
  ), {
    message: `应切换到基地 ${baseId}`,
    timeout: 15_000,
  }).toBe(baseId);
}

async function configureCloudflareTestSpace(
  page: Page,
  spaceId: string,
): Promise<void> {
  await page.addInitScript(() => {
    // AI-CORRECTION 2026-08-22: init script 会在 page.reload() 时再次执行；只允许首次导航
    // 清空 provider，否则 startup 回归阶段会被错误切回 none，根本不会启动同步。
    const initializedKey = "e2e-cf-inactive-base-provider-initialized";
    if (sessionStorage.getItem(initializedKey) !== "true") {
      localStorage.setItem("v3-sync-provider", "none");
      sessionStorage.setItem(initializedKey, "true");
    }
  });
  await page.goto("/");
  await page.waitForFunction(() =>
    Boolean(
      (window as unknown as BrowserTestWindow).__industrialPlannerAppHost
        ?.workspace?.sync,
    )
  );

  const configurationResult = await page.evaluate(async ({ apiBaseUrl, targetSpaceId }) => {
    const backendAddressModuleUrl = "/src/shared/storage/backend-api-address.ts";
    const cloudflareSettingsModuleUrl = "/src/shared/storage/cloudflare-sync-settings.ts";
    const [backendAddress, cloudflareSettings] = await Promise.all([
      import(/* @vite-ignore */ backendAddressModuleUrl),
      import(/* @vite-ignore */ cloudflareSettingsModuleUrl),
    ]);
    backendAddress.writeBackendApiAddressOverride(apiBaseUrl);
    const settings = await cloudflareSettings.writeCloudflareSyncSettings({
      spaceName: targetSpaceId,
    });
    return {
      apiBaseUrl: backendAddress.resolveBackendApiBaseUrl(),
      spaceId: cloudflareSettings.resolveCloudflareSpaceId(settings),
    };
  }, {
    apiBaseUrl: BACKEND_API_BASE_URL,
    targetSpaceId: spaceId,
  });

  expect(configurationResult).toEqual({
    apiBaseUrl: BACKEND_API_BASE_URL,
    spaceId,
  });
  await page.getByTitle("设置").waitFor({ state: "visible", timeout: 30_000 });
}

async function waitForStableSync(page: Page): Promise<void> {
  await expect.poll(async () => await page.evaluate(() => {
    const sync = (window as unknown as BrowserTestWindow)
      .__industrialPlannerAppHost?.workspace?.sync;
    return sync === null || sync === undefined
      ? null
      : {
          phase: sync.state.status.phase,
          saveState: sync.state.status.saveState,
          currentRunReason: sync.state.status.currentRunReason,
          initialSyncStage: sync.state.status.initialSyncStage,
          pendingConflict: sync.state.pendingConflict,
          pendingLocalChangeCount: sync.state.status.pendingLocalChangeCount,
          lastError: sync.state.status.lastError,
        };
  }), {
    message: "同步应完成并回到无冲突、无待上传内容的 idle 状态",
    timeout: 90_000,
    intervals: [500],
  }).toEqual({
    phase: "idle",
    saveState: "idle",
    currentRunReason: null,
    initialSyncStage: "ready",
    pendingConflict: null,
    pendingLocalChangeCount: 0,
    lastError: null,
  });
}

async function enableCloudflareSync(page: Page): Promise<void> {
  await page.getByTitle("设置").click();
  await expect(page.getByRole("heading", { name: "设置" }).first())
    .toBeVisible({ timeout: 10_000 });

  const hasSidebar = await page.getByRole("tree").isVisible().catch(() => false);
  if (hasSidebar) {
    await page.getByRole("treeitem", { name: "其他" }).click();
  }

  const experimentalToggle = page.locator(
    'input[name="other-experimental-features"]',
  );
  await expect(experimentalToggle).toBeVisible({ timeout: 5_000 });
  if (!(await experimentalToggle.isChecked())) {
    await page.locator('label[for="setting-other-experimental-features"]').click();
    await page.getByRole("button", { name: "开启实验性功能" }).click();
  }

  if (hasSidebar) {
    await page.getByRole("treeitem", { name: "实验性" }).click();
  }
  await page.locator('select[name="sync-provider"]').selectOption("cloudflare");
  await waitForStableSync(page);

  const settingsCloseButton = page.getByRole("button", {
    name: "关闭",
    exact: true,
  });
  await expect(settingsCloseButton).toBeVisible();
  await settingsCloseButton.click();
}

async function resolveVisibleConflictUsingRemote(page: Page): Promise<void> {
  const conflictTitle = page.getByRole("heading", { name: "同步冲突" });
  await expect(conflictTitle).toBeVisible({ timeout: 90_000 });

  const useRemoteButton = page.getByRole("button", { name: "全部使用远端" });
  if (await useRemoteButton.isVisible().catch(() => false)) {
    await useRemoteButton.click();
  } else {
    const radios = page.locator('input[value="use-remote"]');
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

test.setTimeout(240_000);

// AI-REMOVED 2026-08-12:
// Reason: 模块级共享 spaceId 使两种冲突决策无法获得资源级隔离。
// Trigger: 用户要求 use-remote 与 use-local 两个测试各自独立。
// Evidence: 原 afterEach 只能清理单个 TEST_SPACE_ID。
// Replacement: 下方每个 test 的独立 spaceId 与 finally 清理。
// Risk: Low。
// Human Review: Required
//
// Original code:
// test.afterEach(async ({ request }) => {
//   await clearRemoteTestAssets(request);
// });
test("Cloudflare conflict: use remote", async ({ page, request }) => {
  const spaceId = `e2e-cf-conflict-use-remote-${randomUUID()}`;
  try {
    await runConflictScenario({
      page,
      request,
      spaceId,
      resolution: "use-remote",
    });
  } finally {
    await clearRemoteTestAssets(request, spaceId);
  }
});

test("Cloudflare conflict: use local", async ({ page, request }) => {
  const spaceId = `e2e-cf-conflict-use-local-${randomUUID()}`;
  try {
    await runConflictScenario({
      page,
      request,
      spaceId,
      resolution: "use-local",
    });
  } finally {
    await clearRemoteTestAssets(request, spaceId);
  }
});

test("Cloudflare inactive base conflict: interval and startup", async ({
  page,
  request,
}) => {
  test.setTimeout(360_000);
  // AI-REMOVED 2026-08-22:
  // Reason: 前缀与 UUID 拼接后超过 Cloudflare 空间名 64 字符上限，写入时会被合法截断。
  // Trigger: 新增 E2E 的空间 ID 前置断言首次运行失败。
  // Evidence: resolveCloudflareSpaceId 返回值缺少 UUID 末尾两字符；设置规范明确限制为 64 字符。
  // Replacement: 下方更短且仍可识别场景的 e2e-cf-inactive- 前缀。
  // Risk: Low。
  // Human Review: Required
  //
  // Original code:
  // const spaceId = `e2e-cf-inactive-base-conflict-${randomUUID()}`;
  const spaceId = `e2e-cf-inactive-${randomUUID()}`;
  try {
    await runInactiveBaseConflictScenario({ page, request, spaceId });
  } finally {
    await clearRemoteTestAssets(request, spaceId);
  }
});

async function runInactiveBaseConflictScenario(options: {
  readonly page: Page;
  readonly request: APIRequestContext;
  readonly spaceId: string;
}): Promise<void> {
  const { page, request, spaceId } = options;
  const currentBaseId = "wuling_protocol_core";
  const currentBaseName = "协议核心区";
  const inactiveBaseId = "stm_hongs_3";
  const inactiveBaseName = "盈天台建设站";

  // ─── Phase 1: 建立两个基地的共同同步基线，并停留在协议核心区 ───
  await configureCloudflareTestSpace(page, spaceId);
  await switchBase(page, inactiveBaseId, inactiveBaseName);
  const inactiveBaseBaseline = await readCurrentWorldDocumentProjection(page);
  expect(inactiveBaseBaseline.assetId).toBe(inactiveBaseId);
  await switchBase(page, currentBaseId, currentBaseName);
  await seedRemoteWorldDocument(
    request,
    spaceId,
    inactiveBaseId,
    inactiveBaseBaseline.content,
  );
  await enableCloudflareSync(page);

  const revisionAfterInitialSync = (await readRemotePlan(request, spaceId)).revision;
  await expect.poll(async () => await page.evaluate(() =>
    (window as unknown as BrowserTestWindow).__industrialPlannerAppHost
      ?.workspace?.editor?.document?.getSnapshot()?.baseId ?? null
  )).toBe(currentBaseId);

  // ─── Phase 2: 默认小检查必须在未切换基地时发现非当前基地冲突 ───
  const previousSmallCheckAt = await page.evaluate(() =>
    (window as unknown as BrowserTestWindow).__industrialPlannerAppHost
      ?.workspace?.sync?.state.status.lastSmallCheckAt ?? null
  );
  await mutateStoredWorldDocument(
    page,
    inactiveBaseId,
    "inactive-local-interval",
  );
  const intervalRemoteContent = createWorldDocumentVariant(
    inactiveBaseBaseline.content,
    "inactive-remote-interval",
  );
  const intervalRemoteRevision = await seedRemoteWorldDocument(
    request,
    spaceId,
    inactiveBaseId,
    intervalRemoteContent,
  );
  expect(intervalRemoteRevision).not.toBe(revisionAfterInitialSync);

  await expect.poll(async () => await page.evaluate(() =>
    (window as unknown as BrowserTestWindow).__industrialPlannerAppHost
      ?.workspace?.sync?.state.status.lastSmallCheckAt ?? null
  ), {
    message: "默认小检查应发现非当前基地的远端 revision 变化",
    timeout: 75_000,
    intervals: [1000],
  }).not.toBe(previousSmallCheckAt);

  const conflictTitle = page.getByRole("heading", { name: "同步冲突" });
  await expect(conflictTitle).toBeVisible({ timeout: 60_000 });
  expect(await page.evaluate(() =>
    (window as unknown as BrowserTestWindow).__industrialPlannerAppHost
      ?.workspace?.sync?.state.pendingConflict ?? null
  )).toMatchObject({
    phase: "awaiting-resolution",
    items: [{
      adapterId: "world-documents",
      assetId: inactiveBaseId,
      kind: "conflict",
    }],
  });
  expect(await page.evaluate(() =>
    (window as unknown as BrowserTestWindow).__industrialPlannerAppHost
      ?.workspace?.editor?.document?.getSnapshot()?.baseId ?? null
  )).toBe(currentBaseId);
  await expect(page.locator('[data-ui-button-id="base-current-select"]'))
    .toContainText(currentBaseName);
  await resolveVisibleConflictUsingRemote(page);
  expect((await readRemotePlan(request, spaceId)).revision)
    .toBe(intervalRemoteRevision);

  // ─── Phase 3: 刷新后的 startup/background 同步也必须发现同一类冲突 ───
  await mutateStoredWorldDocument(
    page,
    inactiveBaseId,
    "inactive-local-startup",
  );
  const startupRemoteContent = createWorldDocumentVariant(
    intervalRemoteContent,
    "inactive-remote-startup",
  );
  const startupRemoteRevision = await seedRemoteWorldDocument(
    request,
    spaceId,
    inactiveBaseId,
    startupRemoteContent,
  );
  expect(startupRemoteRevision).not.toBe(intervalRemoteRevision);

  await page.reload();
  await page.waitForFunction(() =>
    Boolean(
      (window as unknown as BrowserTestWindow).__industrialPlannerAppHost
        ?.workspace?.sync,
    )
  );
  await expect.poll(async () => await page.evaluate(() =>
    (window as unknown as BrowserTestWindow).__industrialPlannerAppHost
      ?.workspace?.editor?.document?.getSnapshot()?.baseId ?? null
  ), {
    message: "刷新后仍应停留在原当前基地",
    timeout: 30_000,
  }).toBe(currentBaseId);
  await expect(conflictTitle).toBeVisible({ timeout: 90_000 });
  expect(await page.evaluate(() =>
    (window as unknown as BrowserTestWindow).__industrialPlannerAppHost
      ?.workspace?.sync?.state.pendingConflict ?? null
  )).toMatchObject({
    phase: "awaiting-resolution",
    items: [{
      adapterId: "world-documents",
      assetId: inactiveBaseId,
      kind: "conflict",
    }],
  });
  expect(await page.evaluate(() =>
    (window as unknown as BrowserTestWindow).__industrialPlannerAppHost
      ?.workspace?.editor?.document?.getSnapshot()?.baseId ?? null
  )).toBe(currentBaseId);
  await resolveVisibleConflictUsingRemote(page);
  expect((await readRemotePlan(request, spaceId)).revision)
    .toBe(startupRemoteRevision);

  // ─── Phase 4: 纯导航到已存在、已同步的基地不得制造上传 ───
  const revisionBeforeNavigation = (
    await readRemotePlan(request, spaceId)
  ).revision;
  await switchBase(page, inactiveBaseId, inactiveBaseName);
  // 本地变化的空闲上传去抖为 5 秒；跨过该窗口后 revision 仍不变，才可证明纯导航未入队。
  await page.waitForTimeout(12_000);
  await waitForStableSync(page);
  expect((await readRemotePlan(request, spaceId)).revision)
    .toBe(revisionBeforeNavigation);
}

// AI-REMOVED 2026-08-12:
// Reason: 单一测试只固定选择 use-remote，无法独立验证 use-local。
// Trigger: 用户要求两种冲突决策各有独立 E2E。
// Evidence: 原测试内硬编码查找“全部使用远端”。
// Replacement: 上方两个独立 test 调用下方参数化场景。
// Risk: Low。
// Human Review: Required
//
// Original code:
// test("CF Worker sync e2e", async ({ page, request }) => {
async function runConflictScenario(options: {
  readonly page: Page;
  readonly request: APIRequestContext;
  readonly resolution: ConflictResolution;
  readonly spaceId: string;
}): Promise<void> {
  const {
    page,
    request,
    resolution,
    spaceId,
  } = options;
  // ─── 日志收集 ───
  const syncLogs: string[] = [];
  const backendRequestFailures: string[] = [];
  const backendHttpErrors: string[] = [];
  const backendCheckResponses: number[] = [];
  page.on("console", (msg) => {
    if (msg.text().includes("sync-service")) {
      syncLogs.push(`[${msg.type()}] ${msg.text()}`);
      console.log(`[SYNC] ${msg.text()}`);
    }
  });
  page.on("requestfailed", (failedRequest) => {
    const errorText = failedRequest.failure()?.errorText ?? "unknown";
    if (
      failedRequest.url().startsWith(BACKEND_API_BASE_URL)
      && errorText !== "net::ERR_ABORTED"
    ) {
      backendRequestFailures.push(
        `${failedRequest.method()} ${failedRequest.url()}: ${errorText}`,
      );
    }
  });
  page.on("response", (response) => {
    const responseUrl = new URL(response.url());
    if (
      responseUrl.origin === BACKEND_API_BASE_URL
      && responseUrl.pathname
        === `/v1/sync/spaces/${encodeURIComponent(spaceId)}/check`
    ) {
      backendCheckResponses.push(response.status());
    }
    if (
      response.url().startsWith(BACKEND_API_BASE_URL)
      && response.status() >= 400
    ) {
      backendHttpErrors.push(
        `${response.request().method()} ${response.url()}: HTTP ${response.status()}`,
      );
    }
  });

  // ─── Phase 1: 预设环境（addInitScript 在 goto 前注入，无需 reload）───
  await page.addInitScript(() => {
    localStorage.setItem("v3-sync-provider", "none");
  });

  await page.goto("/");
  await page.waitForFunction(() =>
    Boolean(
      (window as unknown as BrowserTestWindow).__industrialPlannerAppHost
        ?.workspace?.sync,
    )
  );
  // 设置 debug 日志级别、后端地址与独立 Cloudflare 空间，并检查同步状态
  // AI-CORRECTION 2026-08-14: 不再直接调用 logger.setLogLevel——应用的 debugMode 开关
  // effect 会在 debugMode=false 时把 logger 回写为 warn，与测试注入的 debug 级别形成竞态；
  // 改为在 Phase 4 通过应用设置开关（other-debug-mode）开启，由应用统一管理 logger 级别。
  const configurationResult = await page.evaluate(async ({ apiBaseUrl, spaceId }) => {
    try {
      const backendAddressModuleUrl = "/src/shared/storage/backend-api-address.ts";
      const cloudflareSettingsModuleUrl = "/src/shared/storage/cloudflare-sync-settings.ts";
      const [backendAddress, cloudflareSettings] = await Promise.all([
        import(/* @vite-ignore */ backendAddressModuleUrl),
        import(/* @vite-ignore */ cloudflareSettingsModuleUrl),
      ]);
      backendAddress.writeBackendApiAddressOverride(apiBaseUrl);
      const settings = await cloudflareSettings.writeCloudflareSyncSettings({
        spaceName: spaceId,
      });
      return {
        ok: true,
        apiBaseUrl: backendAddress.resolveBackendApiBaseUrl(),
        spaceId: cloudflareSettings.resolveCloudflareSpaceId(settings),
      };
    } catch (e: unknown) {
      return {
        ok: false,
        error: e instanceof Error ? e.message : String(e),
      };
    }
  }, {
    apiBaseUrl: BACKEND_API_BASE_URL,
    spaceId,
  });
  console.log(`[TEST] configuration result: ${JSON.stringify(configurationResult)}`);
  expect(configurationResult).toEqual({
    ok: true,
    apiBaseUrl: BACKEND_API_BASE_URL,
    spaceId,
  });

  // 同时通过 appHost 直接验证同步状态
  const syncStatus = await page.evaluate(() => {
    const host = (window as unknown as BrowserTestWindow).__industrialPlannerAppHost;
    const sync = host?.workspace?.sync;
    if (!sync) return "sync=null";
    const s = sync.state;
    return `enabled=${s.settings.enabled} phase=${s.status.phase} provider=${localStorage.getItem("v3-sync-provider")}`;
  });
  console.log(`[TEST] Initial sync status: ${syncStatus}`);
  await page.getByTitle("设置").waitFor({ state: "visible", timeout: 30_000 });
  await page.waitForTimeout(2000);

  // ─── Phase 2: 切换基地 → 盈天台建设站 ───
  await page.getByTitle("基地").click();
  await page.waitForTimeout(800);

  const baseBtn = page.locator('[data-ui-button-id="base-current-select"]');
  await expect(baseBtn).toBeVisible({ timeout: 10_000 });
  await baseBtn.click();
  await page.waitForTimeout(1500);

  await page.getByText("盈天台建设站", { exact: true }).click();
  await page.getByRole("button", { name: "确定" }).last().click();
  await page.waitForTimeout(1500);
  await expect(baseBtn).toContainText("盈天台建设站");

  const remoteSeed = await page.evaluate(async () => {
    const host = (window as unknown as BrowserTestWindow).__industrialPlannerAppHost;
    const documentSnapshot = host?.workspace?.editor?.document?.getSnapshot();
    if (!documentSnapshot) {
      throw new Error("Current world document is unavailable.");
    }
    const syncHostModuleUrl = "/src/sync/sync-host.ts";
    const { createWorldDocumentRemoteValue } = await import(
      /* @vite-ignore */ syncHostModuleUrl
    );
    return {
      assetId: documentSnapshot.baseId as string,
      content: JSON.stringify(createWorldDocumentRemoteValue(documentSnapshot)),
    };
  });
  expect(remoteSeed.assetId).toBe("stm_hongs_3");

  // ─── Phase 3: 放置精炼炉 ───
  await page.getByTitle("放置模式").click();
  await page.waitForTimeout(800);

  const furnace = page.locator('[data-ui-button-id="placement-furnance_1"]');
  await furnace.scrollIntoViewIfNeeded();
  await expect(furnace).toBeVisible({ timeout: 15_000 });
  await furnace.click();
  await page.waitForTimeout(300);

  const box = (await page.locator("canvas").first().boundingBox())!;
  await page.locator("canvas").first().click({
    position: { x: box.width / 2 + 50, y: box.height / 2 + 50 },
    force: true,
  });
  await page.waitForTimeout(1500);
  await expect(page.locator('[data-sync-save-state]')).toHaveCount(0, { timeout: 3000 });

  const seededRevision = await seedRemoteWorldDocument(
    request,
    spaceId,
    remoteSeed.assetId,
    remoteSeed.content,
  );
  expect(seededRevision).not.toBe("0");

  // ─── Phase 4: 开启实验性功能 + CF Worker 同步 ───
  await page.getByTitle("设置").click();
  await expect(page.getByRole("heading", { name: "设置" }).first()).toBeVisible({ timeout: 10_000 });

  const hasSidebar = await page.getByRole("tree").isVisible().catch(() => false);
  if (hasSidebar) await page.getByRole("treeitem", { name: "其他" }).click();

  const expToggle = page.locator('input[name="other-experimental-features"]');
  await expect(expToggle).toBeVisible({ timeout: 5000 });
  if (!(await expToggle.isChecked())) {
    await page.locator('label[for="setting-other-experimental-features"]').click();
    await page.getByRole("button", { name: "开启实验性功能" }).click();
    await page.waitForTimeout(800);
  }

  // AI-CORRECTION 2026-08-14: 通过应用设置开启调试模式，由应用 effect 统一把 logger 设为 debug；
  // 直接调用 logger.setLogLevel 会被应用在 debugMode=false 时回写为 warn（Phase 1 断言不稳定）。
  const debugModeToggle = page.locator('input[name="other-debug-mode"]');
  await expect(debugModeToggle).toBeVisible({ timeout: 5000 });
  if (!(await debugModeToggle.isChecked())) {
    await debugModeToggle.check({ force: true });
  }
  await expect.poll(async () => await page.evaluate(async () => {
    const loggerModuleUrl = "/src/shared/logging/logger.ts";
    const logger = await import(/* @vite-ignore */ loggerModuleUrl);
    return (logger as { getLogLevel(): string }).getLogLevel();
  }), {
    message: "应用设置开启调试模式后 logger 级别应变为 debug",
    timeout: 10_000,
    intervals: [250],
  }).toBe("debug");

  if (hasSidebar) await page.getByRole("treeitem", { name: "实验性" }).click();
  await page.locator('select[name="sync-provider"]').selectOption("cloudflare");
  await page.waitForTimeout(1000);
  // AI-CORRECTION 2026-08-12: 开启同步后初始同步门禁/冲突弹窗会覆盖设置窗口；
  // 必须先解决冲突并等待同步结束，再点击设置关闭按钮。
  const settingsCloseButton = page.getByRole("button", { name: "关闭", exact: true });
  await expect(settingsCloseButton).toBeVisible();
  await page.waitForTimeout(5000);

  // ─── Phase 5: 查看同步启动日志 ───
  console.log(`[TEST] Sync logs after enabling (${syncLogs.length}):`);
  syncLogs.forEach((l) => console.log(`  ${l}`));

  // 直接检查同步状态
  const syncStateAfterEnable = await page.evaluate(() => {
    const host = (window as unknown as BrowserTestWindow).__industrialPlannerAppHost;
    const sync = host?.workspace?.sync;
    if (!sync) return "sync=null";
    const s = sync.state;
    return `enabled=${s.settings.enabled} phase=${s.status.phase} saveState=${s.status.saveState} stage=${s.status.initialSyncStage} lastError=${s.status.lastError ?? "none"}`;
  });
  console.log(`[TEST] Sync state after enable: ${syncStateAfterEnable}`);

  // 处理冲突对话框
  const conflictTitle = page.getByRole("heading", { name: "同步冲突" });
  let conflictResolved = false;
  try {
    await expect(conflictTitle).toBeVisible({ timeout: 20_000 });
    console.log("[TEST] Conflict appeared");

    // AI-REMOVED 2026-08-12:
    // Reason: 冲突决策不再固定为 use-remote。
    // Trigger: 用户要求 use-remote 与 use-local 独立测试。
    // Evidence: runConflictScenario 现在接收 resolution 参数。
    // Replacement: 下方按 resolution 选择批量按钮或 radio。
    // Risk: Low。
    // Human Review: Required
    //
    // Original code:
    // const batchBtn = page.getByRole("button", { name: "全部使用远端" });
    const batchBtn = page.getByRole("button", {
      name: resolution === "use-remote" ? "全部使用远端" : "全部使用我的",
    });
    if (await batchBtn.isVisible().catch(() => false)) {
      await batchBtn.click();
    } else {
      await Promise.all(
        // AI-REMOVED 2026-08-12:
        // Reason: radio 回退路径不再硬编码 use-remote。
        // Trigger: use-local 独立 E2E 需要选中本地决策。
        // Evidence: resolution 来自当前独立 test。
        // Replacement: 下方动态 input[value="${resolution}"] 选择器。
        // Risk: Low。
        // Human Review: Required
        //
        // Original code:
        // Array.from({ length: await page.locator('input[value="use-remote"]').count() }, (_, i) =>
        //   page.locator('input[value="use-remote"]').nth(i).check({ force: true }),
        Array.from({
          length: await page.locator(`input[value="${resolution}"]`).count(),
        }, (_, i) =>
          page.locator(`input[value="${resolution}"]`).nth(i).check({ force: true }),
        ),
      );
    }

    await page.getByRole("button", { name: "应用" }).click();
    await expect(conflictTitle).not.toBeVisible({ timeout: 30_000 });
    conflictResolved = true;
    console.log("[TEST] Conflict resolved");
  } catch (error) {
    console.log("[TEST] No conflict appeared");
    await page.screenshot({ path: ".temp/playwright-test/post-sync-state.png" });
    throw error;
  }
  await expect.poll(async () => await page.evaluate(() => {
    const sync = (window as unknown as BrowserTestWindow)
      .__industrialPlannerAppHost?.workspace?.sync;
    return sync === null || sync === undefined
      ? null
      : {
          phase: sync.state.status.phase,
          saveState: sync.state.status.saveState,
          pendingConflict: sync.state.pendingConflict,
          pendingLocalChangeCount: sync.state.status.pendingLocalChangeCount,
          lastError: sync.state.status.lastError,
        };
  }), {
    message: "冲突解决后同步应回到无错误的 idle 状态",
    timeout: 60_000,
  }).toEqual({
    phase: "idle",
    saveState: "idle",
    pendingConflict: null,
    pendingLocalChangeCount: 0,
    lastError: null,
  });

  const localFurnaceCountAfterResolution = await page.evaluate(() =>
    Object.values(
      (window as unknown as BrowserTestWindow).__industrialPlannerAppHost
        ?.workspace?.editor?.document?.getSnapshot()?.entities ?? {},
    ).filter((entity) => entity.definitionId === "furnance_1").length
  );
  if (resolution === "use-remote") {
    expect(localFurnaceCountAfterResolution).toBe(0);
    expect((await readRemotePlan(request, spaceId)).revision).toBe(seededRevision);
  } else {
    expect(localFurnaceCountAfterResolution).toBeGreaterThan(0);
    await expect.poll(async () => {
      const revision = await tryReadRemoteRevision(request, spaceId);
      return revision !== null && revision !== seededRevision;
    }, {
      message: "使用本地应将本地冲突内容上传并推进远端 revision",
      timeout: 45_000,
      intervals: [1000],
    }).toBe(true);

    const planAfterUseLocal = await readRemotePlan(request, spaceId);
    const remoteWorldDocumentAfterUseLocal = planAfterUseLocal.assets.find((asset) =>
      asset.assetType === TEST_WORLD_DOCUMENT_ASSET_TYPE
      && asset.assetId === remoteSeed.assetId
    );
    expect(remoteWorldDocumentAfterUseLocal).toBeDefined();
    const downloadAfterUseLocal = await request.get(
      remoteWorldDocumentAfterUseLocal!.downloadUrl,
    );
    expect(
      downloadAfterUseLocal.ok(),
      await downloadAfterUseLocal.text(),
    ).toBe(true);
    const uploadedLocalDocument = await downloadAfterUseLocal.json() as BrowserWorldDocument;
    expect(
      Object.values(uploadedLocalDocument.entities)
        .some((entity) => entity.definitionId === "furnance_1"),
    ).toBe(true);
  }
  const revisionAfterConflictResolution = (
    await readRemotePlan(request, spaceId)
  ).revision;
  await settingsCloseButton.click();

  // ─── Phase 6: 小检查 (~35s) ───
  // AI-CORRECTION 2026-08-12: 当前默认检查周期为 60 秒；等待状态时间戳变化，避免依赖固定 sleep。
  // AI-CORRECTION 2026-08-20: 时间戳只代表小检查完成，若检查触发完整同步，还必须等待同步状态回到稳定。
  const preCheck = syncLogs.length;
  const preCheckResponseCount = backendCheckResponses.length;
  const previousSmallCheckAt = await page.evaluate(() =>
    (window as unknown as BrowserTestWindow).__industrialPlannerAppHost
      ?.workspace?.sync?.state.status.lastSmallCheckAt ?? null
  );
  console.log("[TEST] Waiting for the next small check...");
  await expect.poll(async () => await page.evaluate(() =>
    (window as unknown as BrowserTestWindow).__industrialPlannerAppHost
      ?.workspace?.sync?.state.status.lastSmallCheckAt ?? null
  ), {
    message: "应在一个默认检查周期内完成小检查",
    timeout: 70_000,
    intervals: [1000],
  }).not.toBe(previousSmallCheckAt);

  await expect.poll(async () => await page.evaluate(() => {
    const sync = (window as unknown as BrowserTestWindow)
      .__industrialPlannerAppHost?.workspace?.sync;
    return sync === null || sync === undefined
      ? null
      : {
          phase: sync.state.status.phase,
          saveState: sync.state.status.saveState,
          currentRunReason: sync.state.status.currentRunReason,
          pendingConflict: sync.state.pendingConflict,
          pendingLocalChangeCount: sync.state.status.pendingLocalChangeCount,
          lastError: sync.state.status.lastError,
        };
  }), {
    message: "小检查触发的后续同步应完成并回到稳定状态",
    timeout: 60_000,
  }).toEqual({
    phase: "idle",
    saveState: "idle",
    currentRunReason: null,
    pendingConflict: null,
    pendingLocalChangeCount: 0,
    lastError: null,
  });

  const checkLogs = syncLogs.slice(preCheck);
  const smallCheckResponses = backendCheckResponses.slice(preCheckResponseCount);
  expect((await readRemotePlan(request, spaceId)).revision)
    .toBe(revisionAfterConflictResolution);
  // AI-CORRECTION 2026-08-12: page response 事件与 lastSmallCheckAt 状态通知存在观测竞态；
  // 独立向当前 test 的空间发送同一 knownRevision 检查，以 HTTP 结果作为权威断言。
  const verificationCheck = await request.get(
    `${BACKEND_API_BASE_URL}/v1/sync/spaces/${encodeURIComponent(spaceId)}`
      + `/check?knownRevision=${revisionAfterConflictResolution}`,
  );
  const shortCircuited = verificationCheck.status() === 204;
  const remoteChanged = verificationCheck.status() === 200;
  console.log(`[TEST] Small check: short-circuited=${shortCircuited}, changed=${remoteChanged}`);
  console.log(
    `[TEST] Page check HTTP statuses: ${smallCheckResponses.join(", ")}; `
      + `verification=${verificationCheck.status()}`,
  );
  checkLogs.forEach((l) => console.log(`  [CHECK] ${l}`));
  expect(shortCircuited).toBe(true);
  expect(remoteChanged).toBe(false);

  // ─── Phase 7: 增量同步 ───
  console.log("[TEST] Second furnace...");
  // 不重复点击"放置模式"：left dock 在 Phase 3 之后一直保持打开，重复点击会关闭它

  const revisionBeforeIncrementalSync = (
    await readRemotePlan(request, spaceId)
  ).revision;
  const entityCountBeforeIncrementalSync = await page.evaluate(() =>
    Object.keys(
      (window as unknown as BrowserTestWindow).__industrialPlannerAppHost
        ?.workspace?.editor?.document?.getSnapshot()?.entities ?? {},
    ).length
  );
  const furnaceCountBeforeIncrementalSync = await page.evaluate(() =>
    Object.values(
      (window as unknown as BrowserTestWindow).__industrialPlannerAppHost
        ?.workspace?.editor?.document?.getSnapshot()?.entities ?? {},
    ).filter((entity) => entity.definitionId === "furnance_1").length
  );

  const furnace2 = page.locator('[data-ui-button-id="placement-furnance_1"]');
  await furnace2.scrollIntoViewIfNeeded();
  await expect(furnace2).toBeVisible({ timeout: 10_000 });
  await furnace2.click();
  await page.waitForTimeout(300);

  const box2 = await page.locator("canvas").first().boundingBox();
  if (box2) {
    await page.locator("canvas").first().click({
      position: { x: box2.width / 2 + 150, y: box2.height / 2 + 150 },
      // AI-REMOVED 2026-08-20:
      // Reason: 强制点击会绕过真实用户必须遵守的同步遮罩，制造产品 UI 中不可达的交错操作。
      // Trigger: CF use-remote E2E 在 interval 同步尚未稳定时偶发读取错误的 revision 基线。
      // Evidence: 失败日志先出现 interval 完整同步，随后测试继续放置；单项重跑及同步门禁审计确认真实点击应等待遮罩解除。
      // Replacement: 下方 force: false，由 Playwright actionability 等待真实交互条件。
      // Risk: Low；若遮罩无法解除，测试将以点击超时暴露真实 UI 阻塞。
      // Human Review: Required
      //
      // Original code:
      // force: true,
      force: false,
    });
  }
  await expect.poll(async () => await page.evaluate(() =>
    Object.values(
      (window as unknown as BrowserTestWindow).__industrialPlannerAppHost
        ?.workspace?.editor?.document?.getSnapshot()?.entities ?? {},
    ).filter((entity) => entity.definitionId === "furnance_1").length
  ), {
    message: "第二次放置应在当前文档中创建精炼炉",
    timeout: 10_000,
  }).toBeGreaterThan(furnaceCountBeforeIncrementalSync);
  await expect.poll(async () => {
    const revision = await tryReadRemoteRevision(request, spaceId);
    // AI-REMOVED 2026-08-20:
    // Reason: 任意远端 revision 变化不能证明本轮精炼炉正文已经上传完成。
    // Trigger: interval 同步推进 revision 后，旧断言提前通过并读取到不含第二台精炼炉的远端文档。
    // Evidence: 全量 E2E 失败时 revision 断言通过，但紧随其后的远端正文不包含 furnance_1。
    // Replacement: 下方同时验证 revision 推进与目标世界文档正文包含 furnance_1。
    // Risk: Low；下载票据瞬时过期时轮询下一份 plan，不把合法 stale 当成正文成功。
    // Human Review: Required
    //
    // Original code:
    // return revision !== null && revision !== revisionBeforeIncrementalSync;
    if (revision === null || revision === revisionBeforeIncrementalSync) {
      return false;
    }
    const plan = await readRemotePlan(request, spaceId);
    const remoteWorldDocument = plan.assets.find((asset) =>
      asset.assetType === TEST_WORLD_DOCUMENT_ASSET_TYPE
      && asset.assetId === remoteSeed.assetId
    );
    if (remoteWorldDocument === undefined) {
      return false;
    }
    const response = await request.get(remoteWorldDocument.downloadUrl);
    if (!response.ok()) {
      return false;
    }
    const uploadedDocument = await response.json() as BrowserWorldDocument;
    return Object.values(uploadedDocument.entities)
      .some((entity) => entity.definitionId === "furnance_1");
  }, {
    message: "本地变化应触发增量上传并推进远端 revision",
    timeout: 45_000,
    intervals: [1000],
  }).toBe(true);
  const planAfterIncrementalSync = await readRemotePlan(request, spaceId);
  const remoteWorldDocument = planAfterIncrementalSync.assets.find((asset) =>
    asset.assetType === TEST_WORLD_DOCUMENT_ASSET_TYPE
    && asset.assetId === remoteSeed.assetId
  );
  expect(remoteWorldDocument).toBeDefined();
  const downloadResponse = await request.get(remoteWorldDocument!.downloadUrl);
  expect(downloadResponse.ok(), await downloadResponse.text()).toBe(true);
  const uploadedDocument = await downloadResponse.json() as BrowserWorldDocument;
  // AI-REMOVED 2026-08-12:
  // Reason: 重构过程中误重复了一层 expect(，导致语法结构错误。
  // Trigger: 将单一冲突场景拆为 use-remote/use-local 参数化场景。
  // Evidence: TypeScript 语法审计发现连续两个 expect(。
  // Replacement: 下方单层 expect 断言。
  // Risk: None。
  // Human Review: Required
  //
  // Original code:
  // expect(
  expect(
    Object.values(uploadedDocument.entities)
      .some((entity) => entity.definitionId === "furnance_1"),
  ).toBe(true);
  await expect.poll(async () => await page.evaluate(() => {
    const sync = (window as unknown as BrowserTestWindow)
      .__industrialPlannerAppHost?.workspace?.sync;
    return sync === null || sync === undefined
      ? null
      : {
          phase: sync.state.status.phase,
          saveState: sync.state.status.saveState,
          pendingLocalChangeCount: sync.state.status.pendingLocalChangeCount,
          lastError: sync.state.status.lastError,
        };
  }), {
    message: "增量上传后同步应完成本地状态落盘并回到 idle",
    timeout: 30_000,
  }).toEqual({
    phase: "idle",
    saveState: "idle",
    pendingLocalChangeCount: 0,
    lastError: null,
  });
  const entityCountAfterIncrementalSync = await page.evaluate(() =>
    Object.keys(
      (window as unknown as BrowserTestWindow).__industrialPlannerAppHost
        ?.workspace?.editor?.document?.getSnapshot()?.entities ?? {},
    ).length
  );
  expect(entityCountAfterIncrementalSync).toBeGreaterThan(entityCountBeforeIncrementalSync);

  const hasError = await page.locator('[data-sync-save-state="error"]').isVisible().catch(() => false);
  console.log(`[TEST] Save error: ${hasError}`);

  const incrLogs = syncLogs.slice(preCheck + checkLogs.length);
  console.log("[TEST] Incremental sync logs:");
  incrLogs.slice(-15).forEach((l) => console.log(`  [INCR] ${l}`));

  // ─── 汇总 ───
  console.log(`\n[TEST] SUMMARY: logs=${syncLogs.length} conflict=${conflictResolved} shortCircuited=${shortCircuited} saveError=${hasError}`);
  expect(conflictResolved).toBe(true);
  expect(hasError).toBe(false);
  expect(backendRequestFailures).toEqual([]);
  expect(backendHttpErrors).toEqual([]);
}
// AI-REMOVED 2026-08-12:
// Reason: 场景从单一 test callback 改为可被两个独立 test 调用的 async function。
// Trigger: use-remote 与 use-local 需要独立空间和独立用例。
// Evidence: 两个 test 现在分别传入自己的 spaceId 和 resolution。
// Replacement: runConflictScenario 函数结尾。
// Risk: Low。
// Human Review: Required
//
// Original code:
// });
