/**
 * CF Worker 同步 e2e：无本地改动时远端更新自动下载覆盖
 *
 * 场景：
 * 1. 打开浏览器 → 开启 CF 同步（远端为空，startup 上传当前文档）
 * 2. 切到盈天台建设站
 * 3. 本地修改（放置精炼炉）→ 直接上传完成（全程无冲突）
 * 4. 等待检查周期 → 远端无变化，短路返回（无事发生）
 * 5. 通过 API 直接推送远端新版本（移除精炼炉）
 * 6. 下一次检查发现远端变化 → 下载期间锁定画布 → 下载完成解锁并覆盖本地
 * 7. 画布内容反映远端版本（精炼炉消失）
 *
 * AI-CORRECTION 2026-08-12: 无本地未提交改动时，不管远端如何变化都直接使用远端内容，
 * 不触发冲突对话框。
 * AI-CORRECTION 2026-08-13: 小检查发现远端变化触发的下载期间应锁定画布
 * （断言 data-sync-initial-sync-stage="canvas" 遮罩可见）。
 * AI-CORRECTION 2026-08-24: 上述“小检查”现统一称为“更新检查”。
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
const TEST_WORLD_DOCUMENT_ASSET_TYPE = "world-document";

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
    readonly initialSyncStage: string;
    readonly pendingLocalChangeCount: number;
    readonly lastError: string | null;
    readonly lastDownloadAt: string | null;
    readonly lastUpdateCheckAt: string | null;
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

// ─── 远端 API 辅助函数 ───

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

// AI-REMOVED 2026-08-13:
// Reason: 测试场景不再预播种远端，避免人为制造冲突。
// Trigger: 需求要求"本地修改 → 直接上传"的干净路径，原流程依赖预播种旧远端 + 冲突 use-local 收敛状态。
// Evidence: 开启同步时远端为空，客户端 startup 会创建远端空间并上传当前文档
//           （cloudflare-remote.ts ensureSpace → POST /v1/sync/spaces）。
// Replacement: 远端初始内容由客户端开启同步后的 startup 上传产生；后续直接推送使用 pushRemoteWorldDocument。
// Risk: Low。
// Human Review: Required
//
// Original code:
// async function seedRemoteWorldDocument(
//   request: APIRequestContext,
//   spaceId: string,
//   assetId: string,
//   content: string,
// ): Promise<string> {
//   const createResponse = await request.post(
//     `${BACKEND_API_BASE_URL}/v1/sync/spaces`,
//     { data: { spaceId } },
//   );
//   expect(createResponse.status(), await createResponse.text()).toBe(201);
//
//   const contentBytes = Buffer.from(content);
//   const prepareResponse = await request.post(
//     `${BACKEND_API_BASE_URL}/v1/sync/spaces/${encodeURIComponent(spaceId)}/mutations`,
//     {
//       data: {
//         protocol: CF_SYNC_V2_PROTOCOL,
//         action: "prepare",
//         baseRevision: "0",
//         clientBatchId: randomUUID(),
//         objects: [{
//           clientMutationId: randomUUID(),
//           assetType: TEST_WORLD_DOCUMENT_ASSET_TYPE,
//           assetId,
//           metadata: "{}",
//           blobHash: createHash("sha256").update(contentBytes).digest("hex"),
//           blobByteSize: contentBytes.byteLength,
//           storageMode: "full",
//           schemaVersion: 1,
//           encoding: "identity",
//           writerAppVersion: "e2e",
//           writerBuildId: "playwright",
//         }],
//         deletions: [],
//       },
//     },
//   );
//   expect(prepareResponse.ok(), await prepareResponse.text()).toBe(true);
//   const prepare = await prepareResponse.json() as CfV2PrepareResponse;
//
//   for (const upload of prepare.uploads) {
//     if (!upload.required) continue;
//     expect(upload.url).toBeTruthy();
//     const uploadResponse = await request.put(upload.url!, {
//       data: contentBytes,
//       headers: {
//         "content-type": "application/octet-stream",
//         ...upload.headers,
//       },
//     });
//     expect(uploadResponse.ok(), await uploadResponse.text()).toBe(true);
//   }
//
//   const commitResponse = await request.post(
//     `${BACKEND_API_BASE_URL}/v1/sync/spaces/${encodeURIComponent(spaceId)}/mutations`,
//     {
//       data: {
//         protocol: CF_SYNC_V2_PROTOCOL,
//         action: "commit",
//         uploadId: prepare.uploadId,
//         commitToken: prepare.commitToken,
//       },
//     },
//   );
//   expect(commitResponse.ok(), await commitResponse.text()).toBe(true);
//   const commit = await commitResponse.json() as CfV2CommitResult;
//   return commit.revision;
// }

async function pushRemoteWorldDocument(
  request: APIRequestContext,
  spaceId: string,
  assetId: string,
  content: string,
  baseRevision: string,
): Promise<string> {
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

test.setTimeout(300_000);

test("远端更新自动下载：无本地改动时直接使用远端内容", async ({ page, request }) => {
  const spaceId = `e2e-cf-auto-download-${randomUUID()}`;
  try {
    await runAutoDownloadScenario({ page, request, spaceId });
  } finally {
    await clearRemoteTestAssets(request, spaceId);
  }
});

async function runAutoDownloadScenario(options: {
  readonly page: Page;
  readonly request: APIRequestContext;
  readonly spaceId: string;
}): Promise<void> {
  const { page, request, spaceId } = options;

  // ─── 日志收集 ───
  const syncLogs: string[] = [];
  const backendRequestFailures: string[] = [];
  const backendHttpErrors: string[] = [];
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
    // AI-CORRECTION 2026-08-13: ensureSpace 会先 GET .../plan 探测空间是否存在，
    // 404 是创建空间前的预期控制流，不视为错误。
    const isEnsureSpaceProbe =
      response.status() === 404
      && response.request().method() === "GET"
      && response.url().endsWith("/plan");
    if (
      response.url().startsWith(BACKEND_API_BASE_URL)
      && response.status() >= 400
      && !isEnsureSpaceProbe
    ) {
      backendHttpErrors.push(
        `${response.request().method()} ${response.url()}: HTTP ${response.status()}`,
      );
    }
  });

  // ─── Phase 1: 预设环境 ───
  // AI-REMOVED 2026-08-13:
  // Reason: 不再预置 provider=none，同步应在页面加载后通过设置正常开启。
  // Trigger: 原流程关闭同步以便本地改动不触发上传，进而与预播种的旧远端形成人为冲突。
  // Evidence: 新场景要求开启 CF 同步后直接本地修改并上传。
  // Replacement: 通过设置对话框选择 cloudflare provider 开启同步。
  // Risk: Low。
  // Human Review: Required
  //
  // Original code:
  // await page.addInitScript(() => {
  //   localStorage.setItem("v3-sync-provider", "none");
  // });

  await page.goto("/");
  await page.waitForFunction(() =>
    Boolean(
      (window as unknown as BrowserTestWindow).__industrialPlannerAppHost
        ?.workspace?.sync,
    )
  );

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
        remoteMode: "anonymous",
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

  await page.getByTitle("设置").waitFor({ state: "visible", timeout: 30_000 });
  await page.waitForTimeout(2000);

  // ─── Phase 2: 开启实验性功能 + CF Worker 同步 ───
  // 此时远端为空：startup 初始同步会上传当前文档并创建远端空间
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

  // AI-CORRECTION 2026-08-24: provider 选择现在只进入待配置态，必须在 Cloudflare 状态窗口
  // 明确确认匿名 Space ID 后才会激活同步。
  const cloudflareDialog = page.getByRole("dialog", { name: "Cloudflare 同步状态" });
  await expect(cloudflareDialog).toBeVisible();
  const activateCloudflareButton = cloudflareDialog.getByRole("button", {
    name: "使用此 Space ID 并启用",
  });
  await expect(activateCloudflareButton).toBeEnabled();
  await activateCloudflareButton.click();

  const settingsDialog = page.getByRole("dialog", { name: "设置" });
  const settingsCloseButton = settingsDialog.getByRole("button", {
    name: "关闭",
    exact: true,
  });
  await expect(settingsCloseButton).toBeVisible();
  const closeSettingsDialog = async (): Promise<void> => {
    await settingsCloseButton.click();
  };

  // 查看同步状态
  const syncStateAfterEnable = await page.evaluate(() => {
    const host = (window as unknown as BrowserTestWindow).__industrialPlannerAppHost;
    const sync = host?.workspace?.sync;
    if (!sync) return "sync=null";
    const s = sync.state;
    return `enabled=${s.settings.enabled} phase=${s.status.phase} saveState=${s.status.saveState} stage=${s.status.initialSyncStage} lastError=${s.status.lastError ?? "none"}`;
  });
  console.log(`[TEST] Sync state after enable: ${syncStateAfterEnable}`);

  // 等待初始同步完成：startup 上传当前文档，initialSyncStage 走完 canvas → ready
  await expect.poll(async () => await page.evaluate(() => {
    const sync = (window as unknown as BrowserTestWindow)
      .__industrialPlannerAppHost?.workspace?.sync;
    return sync === null || sync === undefined
      ? null
      : {
          phase: sync.state.status.phase,
          saveState: sync.state.status.saveState,
          initialSyncStage: sync.state.status.initialSyncStage,
          pendingLocalChangeCount: sync.state.status.pendingLocalChangeCount,
          lastError: sync.state.status.lastError,
        };
  }), {
    message: "初始同步应完成并回到无错误的 idle 状态",
    timeout: 120_000,
  }).toEqual({
    phase: "idle",
    saveState: "idle",
    initialSyncStage: "ready",
    pendingLocalChangeCount: 0,
    lastError: null,
  });

  await cloudflareDialog.getByRole("button", { name: "关闭", exact: true }).click();
  await expect(cloudflareDialog).not.toBeVisible();
  await closeSettingsDialog();
  await expect(settingsDialog).not.toBeVisible();

  // 初始同步完成后，画布锁定遮罩应消失
  expect(
    await page.locator('[data-sync-initial-sync-stage="canvas"]').isVisible().catch(() => false)
  ).toBe(false);

  // ─── Phase 3: 切换基地 → 盈天台建设站 ───
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

  // 获取当前文档 assetId（用于后续通过 API 直接推送远端新版本）
  const remoteAssetId = await page.evaluate(() => {
    const host = (window as unknown as BrowserTestWindow).__industrialPlannerAppHost;
    const documentSnapshot = host?.workspace?.editor?.document?.getSnapshot();
    if (!documentSnapshot) {
      throw new Error("Current world document is unavailable.");
    }
    return documentSnapshot.baseId as string;
  });
  expect(remoteAssetId).toBe("stm_hongs_3");

  // 等待基地切换触发的上传完成
  // AI-CORRECTION 2026-08-22: 本场景首次打开盈天台建设站时创建了新的本地基地文档；
  // 上传来源是该文档的首次创建，不是“切换基地”这一纯导航动作。
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
    message: "首次创建基地文档触发的上传应完成并回到 idle",
    timeout: 60_000,
  }).toEqual({
    phase: "idle",
    saveState: "idle",
    pendingLocalChangeCount: 0,
    lastError: null,
  });

  // ─── Phase 4: 放置精炼炉（本地修改） ───
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

  // 验证精炼炉已放置
  const localFurnaceCountAfterPlace = await page.evaluate(() =>
    Object.values(
      (window as unknown as BrowserTestWindow).__industrialPlannerAppHost
        ?.workspace?.editor?.document?.getSnapshot()?.entities ?? {},
    ).filter((entity) => entity.definitionId === "furnance_1").length
  );
  expect(localFurnaceCountAfterPlace).toBeGreaterThan(0);

  // AI-REMOVED 2026-08-13:
  // Reason: 预播种远端（seedRemoteWorldDocument）不再需要。
  // Trigger: 测试场景改为"开启同步后本地修改直接上传"，不应人为制造冲突。
  // Evidence: 开启同步时远端为空，startup 已上传当前文档；本地修改后 lastSyncedHash===remoteHash，
  //           直接走 uploaded 分支，不会产生冲突。
  // Replacement: 下方等待本地修改上传完成。
  // Risk: Low。
  // Human Review: Required
  //
  // Original code:
  //   // 预播种远端（无精炼炉的原始版本）
  //   const seededRevision = await seedRemoteWorldDocument(
  //     request,
  //     spaceId,
  //     remoteSeed.assetId,
  //     remoteSeed.content,
  //   );
  //   expect(seededRevision).not.toBe("0");
  //   console.log(`[TEST] Remote seeded: revision=${seededRevision}`);
  //
  //   // ─── Phase 4: 开启实验性功能 + CF Worker 同步 ───
  //   await page.getByTitle("设置").click();
  //   await expect(page.getByRole("heading", { name: "设置" }).first()).toBeVisible({ timeout: 10_000 });
  //
  //   const hasSidebar = await page.getByRole("tree").isVisible().catch(() => false);
  //   if (hasSidebar) await page.getByRole("treeitem", { name: "其他" }).click();
  //
  //   const expToggle = page.locator('input[name="other-experimental-features"]');
  //   await expect(expToggle).toBeVisible({ timeout: 5000 });
  //   if (!(await expToggle.isChecked())) {
  //     await page.locator('label[for="setting-other-experimental-features"]').click();
  //     await page.getByRole("button", { name: "开启实验性功能" }).click();
  //     await page.waitForTimeout(800);
  //   }
  //
  //   if (hasSidebar) await page.getByRole("treeitem", { name: "实验性" }).click();
  //   await page.locator('select[name="sync-provider"]').selectOption("cloudflare");
  //   await page.waitForTimeout(1000);
  //
  //   const settingsCloseButton = page.getByRole("button", { name: "关闭", exact: true });
  //   await expect(settingsCloseButton).toBeVisible();
  //   await page.waitForTimeout(5000);
  //
  //   // 查看同步状态
  //   const syncStateAfterEnable = await page.evaluate(() => {
  //     const host = (window as unknown as BrowserTestWindow).__industrialPlannerAppHost;
  //     const sync = host?.workspace?.sync;
  //     if (!sync) return "sync=null";
  //     const s = sync.state;
  //     return `enabled=${s.settings.enabled} phase=${s.status.phase} saveState=${s.status.saveState} stage=${s.status.initialSyncStage} lastError=${s.status.lastError ?? "none"}`;
  //   });
  //   console.log(`[TEST] Sync state after enable: ${syncStateAfterEnable}`);
  //
  //   // 处理冲突对话框（本地有精炼炉，远端没有）
  //   const conflictTitle = page.getByRole("heading", { name: "同步冲突" });
  //   try {
  //     await expect(conflictTitle).toBeVisible({ timeout: 20_000 });
  //     console.log("[TEST] Conflict appeared");
  //
  //     const batchBtn = page.getByRole("button", { name: "全部使用我的" });
  //     if (await batchBtn.isVisible().catch(() => false)) {
  //       await batchBtn.click();
  //     }
  //     await page.getByRole("button", { name: "应用" }).click();
  //     await expect(conflictTitle).not.toBeVisible({ timeout: 30_000 });
  //     console.log("[TEST] Conflict resolved");
  //   } catch {
  //     console.log("[TEST] No conflict appeared (or not visible)");
  //   }
  //
  //   // 等待同步完成
  //   await expect.poll(async () => await page.evaluate(() => {
  //     const sync = (window as unknown as BrowserTestWindow)
  //       .__industrialPlannerAppHost?.workspace?.sync;
  //     return sync === null || sync === undefined
  //       ? null
  //       : {
  //           phase: sync.state.status.phase,
  //           saveState: sync.state.status.saveState,
  //           pendingConflict: sync.state.pendingConflict,
  //           pendingLocalChangeCount: sync.state.status.pendingLocalChangeCount,
  //           lastError: sync.state.status.lastError,
  //         };
  //   }), {
  //     message: "冲突解决后同步应回到无错误的 idle 状态",
  //     timeout: 60_000,
  //   }).toEqual({
  //     phase: "idle",
  //     saveState: "idle",
  //     pendingConflict: null,
  //     pendingLocalChangeCount: 0,
  //     lastError: null,
  //   });
  //
  //   const localFurnaceCountAfterResolution = await page.evaluate(() =>
  //     Object.values(
  //       (window as unknown as BrowserTestWindow).__industrialPlannerAppHost
  //         ?.workspace?.editor?.document?.getSnapshot()?.entities ?? {},
  //     ).filter((entity) => entity.definitionId === "furnance_1").length
  //   );
  //   // 选择 use-local，精炼炉应保留
  //   expect(localFurnaceCountAfterResolution).toBeGreaterThan(0);
  //
  //   await settingsCloseButton.click();

  // 等待本地修改上传完成（无冲突：本地改动直接上传）
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
    message: "本地修改应直接上传完成并回到无错误的 idle 状态",
    timeout: 60_000,
  }).toEqual({
    phase: "idle",
    saveState: "idle",
    pendingConflict: null,
    pendingLocalChangeCount: 0,
    lastError: null,
  });

  // 全程不应出现冲突对话框
  expect(
    await page.getByRole("heading", { name: "同步冲突" }).isVisible().catch(() => false)
  ).toBe(false);

  // ─── Phase 5: 小检查（短路、无事发生） ───
  // AI-CORRECTION 2026-08-22: 局部增量上传不会推进“已完整检查全部 collection”的全局 cursor；
  // 因此下一次小检查可合法发现 revision 变化并触发一次无实际下载的完整同步。
  // AI-CORRECTION 2026-08-24: 本阶段现统一称为“更新检查”。
  const previousUpdateCheckAt = await page.evaluate(() =>
    (window as unknown as BrowserTestWindow).__industrialPlannerAppHost
      ?.workspace?.sync?.state.status.lastUpdateCheckAt ?? null
  );
  const lastDownloadAtBeforeCheck = await page.evaluate(() =>
    (window as unknown as BrowserTestWindow).__industrialPlannerAppHost
      ?.workspace?.sync?.state.status.lastDownloadAt ?? null
  );
  console.log("[TEST] Waiting for the next update check...");
  await expect.poll(async () => await page.evaluate(() =>
    (window as unknown as BrowserTestWindow).__industrialPlannerAppHost
      ?.workspace?.sync?.state.status.lastUpdateCheckAt ?? null
  ), {
    message: "应在一个默认检查周期内完成更新检查",
    timeout: 70_000,
    intervals: [1000],
  }).not.toBe(previousUpdateCheckAt);

  // 远端无变化 → 无事发生：未进入 downloading、未锁画布、未发生下载、本地精炼炉仍在
  // AI-CORRECTION 2026-08-22: lastSmallCheckAt 在后续完整同步结束前更新；这里必须等待同步稳定，
  // 最终仍严格要求无下载、无画布锁定且本地内容保持不变。
  // AI-CORRECTION 2026-08-24: 上述字段现已更名为 lastUpdateCheckAt。
  // AI-REMOVED 2026-08-22:
  // Reason: 小检查时间戳变化后立即读取 phase，会与仍在执行的 interval 完整同步形成观察竞态。
  // Trigger: 该 E2E 实际日志显示全部 adapter 正常完成，但断言在 sync done 前读到 downloading。
  // Evidence: cf-worker-conflict-small-check 已采用“时间戳变化后等待稳定状态”的同一规则。
  // Replacement: 下方 expect.poll 等待 phase=idle，同时保持 lastDownloadAt 不变断言。
  // Risk: Low；没有放宽最终状态或下载结果。
  // Human Review: Required
  // AI-CORRECTION 2026-08-24: 上述“小检查”现统一称为“更新检查”，引用的 E2E 文件现为
  // cf-worker-conflict-update-check.spec.ts。
  //
  // Original code:
  // const syncStateAfterCheck = await page.evaluate(() => {
  //   const sync = (window as unknown as BrowserTestWindow)
  //     .__industrialPlannerAppHost?.workspace?.sync;
  //   return sync === null || sync === undefined
  //     ? null
  //     : {
  //         phase: sync.state.status.phase,
  //         lastDownloadAt: sync.state.status.lastDownloadAt,
  //       };
  // });
  // expect(syncStateAfterCheck).toEqual({
  //   phase: "idle",
  //   lastDownloadAt: lastDownloadAtBeforeCheck,
  // });
  await expect.poll(async () => await page.evaluate(() => {
    const sync = (window as unknown as BrowserTestWindow)
      .__industrialPlannerAppHost?.workspace?.sync;
    return sync === null || sync === undefined
      ? null
      : {
          phase: sync.state.status.phase,
          lastDownloadAt: sync.state.status.lastDownloadAt,
        };
  }), {
    message: "更新检查触发的后续同步应稳定结束且不产生下载",
    timeout: 60_000,
    intervals: [500],
  }).toEqual({
    phase: "idle",
    lastDownloadAt: lastDownloadAtBeforeCheck,
  });
  expect(
    await page.locator('[data-sync-initial-sync-stage="canvas"]').isVisible().catch(() => false)
  ).toBe(false);
  const localFurnaceCountAfterCheck = await page.evaluate(() =>
    Object.values(
      (window as unknown as BrowserTestWindow).__industrialPlannerAppHost
        ?.workspace?.editor?.document?.getSnapshot()?.entities ?? {},
    ).filter((entity) => entity.definitionId === "furnance_1").length
  );
  expect(localFurnaceCountAfterCheck).toBeGreaterThan(0);

  const planAfterCheck = await readRemotePlan(request, spaceId);
  const revisionAfterCheck = planAfterCheck.revision;
  console.log(`[TEST] Check completed, revision=${revisionAfterCheck}`);

  // ─── Phase 6: 通过 API 推送远端新版本（移除精炼炉） ───
  const currentDocument = await page.evaluate(() =>
    (window as unknown as BrowserTestWindow).__industrialPlannerAppHost
      ?.workspace?.editor?.document?.getSnapshot()
  );
  const remoteDocumentWithoutFurnace = {
    ...currentDocument,
    entities: Object.fromEntries(
      Object.entries(currentDocument!.entities).filter(
        ([, entity]) => entity.definitionId !== "furnance_1",
      ),
    ),
  };
  const remoteContent = JSON.stringify(remoteDocumentWithoutFurnace);

  const pushedRevision = await pushRemoteWorldDocument(
    request,
    spaceId,
    remoteAssetId,
    remoteContent,
    revisionAfterCheck,
  );
  expect(pushedRevision).not.toBe(revisionAfterCheck);
  console.log(`[TEST] Remote pushed: new revision=${pushedRevision} (removed furnace)`);

  // ─── Phase 7: 等待下一次检查 → 下载期间锁定画布 → 完成后解锁 ───
  // 确认没有冲突弹窗（本地无未提交改动，直接下载）
  expect(
    await page.getByRole("heading", { name: "同步冲突" }).isVisible().catch(() => false)
  ).toBe(false);
  console.log("[TEST] Waiting for auto-download...");

  // 浏览器内高频观察：phase 一旦进入 downloading，立即检查画布锁定遮罩是否可见
  const lockObservation = await page.evaluate(() =>
    new Promise<"locked" | "unlocked" | "no-downloading-observed">((resolve) => {
      const sync = (window as unknown as BrowserTestWindow)
        .__industrialPlannerAppHost?.workspace?.sync;
      if (!sync) {
        resolve("no-downloading-observed");
        return;
      }
      const startedAt = Date.now();
      const timer = setInterval(() => {
        if (sync.state.status.phase === "downloading") {
          clearInterval(timer);
          const gate = document.querySelector(
            '[data-sync-initial-sync-stage="canvas"]'
          );
          resolve(gate !== null ? "locked" : "unlocked");
          return;
        }
        if (Date.now() - startedAt > 80_000) {
          clearInterval(timer);
          resolve("no-downloading-observed");
        }
      }, 10);
    })
  );
  console.log(`[TEST] Lock observation during downloading: ${lockObservation}`);
  expect(lockObservation).toBe("locked");

  // 等待下载完成回到 idle
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
    message: "下载应完成并回到 idle 状态",
    timeout: 60_000,
  }).toEqual({
    phase: "idle",
    saveState: "idle",
    pendingLocalChangeCount: 0,
    lastError: null,
  });
  console.log("[TEST] Auto-download completed, back to idle");

  // 下载完成后画布锁定遮罩应消失（解锁）
  expect(
    await page.locator('[data-sync-initial-sync-stage="canvas"]').isVisible().catch(() => false)
  ).toBe(false);

  // ─── Phase 8: 验证画布反映远端内容（精炼炉被移除） ───
  const localFurnaceCountAfterDownload = await page.evaluate(() =>
    Object.values(
      (window as unknown as BrowserTestWindow).__industrialPlannerAppHost
        ?.workspace?.editor?.document?.getSnapshot()?.entities ?? {},
    ).filter((entity) => entity.definitionId === "furnance_1").length
  );
  expect(localFurnaceCountAfterDownload).toBe(0);
  console.log("[TEST] Local document reflects remote: furnace removed");

  // 验证远端 revision 未被额外推进
  const planAfterDownload = await readRemotePlan(request, spaceId);
  expect(planAfterDownload.revision).toBe(pushedRevision);

  // 确认没有冲突弹窗
  expect(
    await page.getByRole("heading", { name: "同步冲突" }).isVisible().catch(() => false)
  ).toBe(false);

  // ─── 汇总 ───
  console.log(`\n[TEST] SUMMARY: logs=${syncLogs.length} downloadCompleted=true`);
  expect(backendRequestFailures).toEqual([]);
  expect(backendHttpErrors).toEqual([]);
}
