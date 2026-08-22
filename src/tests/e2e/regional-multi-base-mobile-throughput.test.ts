import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import {
  expect,
  test,
  type Page,
} from "playwright/test";

import type { BlueprintDocument } from "../../domain/document/blueprint-document";
import {
  WORLD_DOCUMENT_SCHEMA_VERSION,
  type WorldDocument,
} from "../../domain/document/world-document";
import { ensureProtocolCoreEntity } from "../../editor/ensure-protocol-core";
import { createRegistryContract } from "../../registry";

const BLUEPRINT_PATH = "public/blueprints/v1.4-4-core-xiranite.json";
const XIRANITE_ITEM_ID = "item_xiranite_powder";
const EXPECTED_XIRANITE_PER_MINUTE = 480;
const TICKS_PER_MINUTE = 1_200;
const WARMUP_MINUTES = 2;
const OBSERVATION_MINUTES = 3;
const WULING_BASE_IDS = [
  "wuling_protocol_core",
  "wuling_tianwangping_aid",
  "wuling_heart_repair_station",
  "stm_hongs_3",
] as const;

const blueprint = JSON.parse(
  readFileSync(resolve(process.cwd(), BLUEPRINT_PATH), "utf8"),
) as BlueprintDocument;
const registry = createRegistryContract();

interface BrowserTestWindow {
  readonly __industrialPlannerAppHost?: {
    readonly regionalSettings: {
      readonly multiBaseEnabled: boolean;
    };
    readonly workspace: {
      readonly editor: {
        readonly document: {
          getSnapshot(): {
            readonly baseId: string;
          };
        };
        readonly queries: {
          readLatestBaseDocuments(baseIds: readonly string[]): Promise<readonly WorldDocument[]>;
        };
      } | null;
      readonly simulation: {
        readonly state: {
          readonly runningState: string;
          readonly simulationMode: string;
          readonly currentPlaybackTickNumber: number;
          readonly runtimeStatus: {
            readonly error: string | null;
            readonly latestTickNumber: number;
          };
        };
        readonly queries: {
          getWarehouseStats(): {
            readonly statsWindowReady: boolean;
            readonly items: Readonly<Record<string, {
              readonly producedPerMinute: number;
            }>>;
          } | null;
        };
      } | null;
    };
  };
}

test.use({
  viewport: {
    width: 764,
    height: 345,
  },
  deviceScaleFactor: 3.125,
  hasTouch: true,
  isMobile: true,
  userAgent:
    "Mozilla/5.0 (Linux; Android 14; Mobile) AppleWebKit/537.36 Chrome/138.0 Mobile Safari/537.36",
});

test.skip("手机端从存档启动武陵四基地仿真，预热两分钟后连续三分钟达到 480 息壤/分钟", async ({
  page,
}) => {
  test.setTimeout(900_000);

  const pageErrors: string[] = [];
  const simulationConsoleErrors: string[] = [];
  page.on("pageerror", (error) => {
    pageErrors.push(error.message);
  });
  page.on("console", (message) => {
    if (
      message.type() === "error"
      && ["[RegionalSimulation]", "[RegionalSimWorker]", "[SimWorker]"]
        .some((prefix) => message.text().startsWith(prefix))
    ) {
      simulationConsoleErrors.push(message.text());
    }
  });

  await page.addInitScript(() => {
    localStorage.setItem("v3-experimental-regional-multi-base", "true");
    localStorage.setItem("v3-sync-provider", "none");
  });
  await page.goto("/");
  await page.waitForFunction(() => Boolean(
    (window as unknown as BrowserTestWindow).__industrialPlannerAppHost
      ?.workspace.editor?.document,
  ));

  const documents = createWulingWorldDocuments(blueprint);
  const injectionResult = await injectRegionalSave(page, documents);
  expect(injectionResult).toEqual({
    activeDocumentKey: documents[1]!.documentKey,
    documentCount: WULING_BASE_IDS.length,
    multiBaseEnabled: true,
  });

  await page.reload();
  await expect(page.getByRole("button", { name: "开始仿真" })).toBeVisible({
    timeout: 30_000,
  });
  await expect.poll(() => page.evaluate(() => {
    const host = (window as unknown as BrowserTestWindow).__industrialPlannerAppHost;
    return host?.workspace.simulation?.state.simulationMode ?? null;
  })).toBe("regional-multi-base");

  const restoredDocuments = await page.evaluate(async (baseIds) => {
    const host = (window as unknown as BrowserTestWindow).__industrialPlannerAppHost;
    const editor = host?.workspace.editor;
    if (host === undefined || editor === null || editor === undefined) {
      throw new Error("Editor is unavailable after restoring the injected save.");
    }
    const restored = await editor.queries.readLatestBaseDocuments(baseIds);
    return {
      currentBaseId: editor.document.getSnapshot().baseId,
      experimentalEnabled:
        localStorage.getItem("v3-experimental-regional-multi-base") === "true",
      multiBaseEnabled: host.regionalSettings.multiBaseEnabled,
      summaries: restored.map((document) => ({
        baseId: document.baseId,
        documentKey: document.documentKey,
        entityCount: document.entityOrder.length,
        protocolCoreCount: document.entityOrder.filter((entityId) =>
          document.entities[entityId]?.definitionId === "sp_hub_1"
        ).length,
      })),
    };
  }, WULING_BASE_IDS);
  expect(restoredDocuments).toEqual({
    currentBaseId: "wuling_tianwangping_aid",
    experimentalEnabled: true,
    multiBaseEnabled: true,
    summaries: documents.map((document) => ({
      baseId: document.baseId,
      documentKey: document.documentKey,
      entityCount: document.entityOrder.length,
      protocolCoreCount: 1,
    })),
  });

  const simulationButton = page.locator(
    '[data-ui-button-id="top-bar-simulation-control"]',
  );
  await expect(simulationButton).toBeEnabled();
  await simulationButton.tap();

  await expect.poll(() => page.evaluate(() => {
    const simulation = (window as unknown as BrowserTestWindow)
      .__industrialPlannerAppHost?.workspace.simulation;
    return {
      error: simulation?.state.runtimeStatus.error ?? null,
      runningState: simulation?.state.runningState ?? null,
    };
  }), {
    message: "手机触摸启动后，多基地仿真应进入 start 且没有 runtime 错误",
    timeout: 60_000,
  }).toEqual({
    error: null,
    runningState: "start",
  });
  await expect(simulationButton).toHaveAttribute("aria-pressed", "true");

  const simulationStartedAt = Date.now();
  const warmupMinuteOneStats = await waitForFirstMinuteStats(page);
  expect(warmupMinuteOneStats).toMatchObject({
    runningState: "start",
    runtimeError: null,
    statsWindowReady: true,
  });

  const warmupStats = await waitForStatsAtTick(
    page,
    WARMUP_MINUTES * TICKS_PER_MINUTE,
  );
  expect(warmupStats).toMatchObject({
    runningState: "start",
    runtimeError: null,
    statsWindowReady: true,
  });

  const observationStats = [];
  for (let minute = 1; minute <= OBSERVATION_MINUTES; minute += 1) {
    const targetTickNumber = (WARMUP_MINUTES + minute) * TICKS_PER_MINUTE;
    const stats = await waitForStatsAtTick(page, targetTickNumber);
    expect(stats).toMatchObject({
      producedPerMinute: EXPECTED_XIRANITE_PER_MINUTE,
      runningState: "start",
      runtimeError: null,
      statsWindowReady: true,
    });
    expect(stats.currentPlaybackTickNumber).toBeGreaterThanOrEqual(targetTickNumber);
    observationStats.push({ minute, targetTickNumber, ...stats });
  }

  console.log(JSON.stringify({
    elapsedWallClockSeconds: Math.round((Date.now() - simulationStartedAt) / 100) / 10,
    observationStats,
    warmupMinuteOneStats,
    warmupStats,
  }));
  expect(pageErrors).toEqual([]);
  expect(simulationConsoleErrors).toEqual([]);
});

function createWulingWorldDocuments(
  sourceBlueprint: BlueprintDocument,
): WorldDocument[] {
  return WULING_BASE_IDS.map((baseId) => ensureProtocolCoreEntity({
    document: {
      schemaVersion: WORLD_DOCUMENT_SCHEMA_VERSION,
      documentKey: `e2e-regional-mobile-${baseId}`,
      baseId,
      meta: {
        id: `world-e2e-regional-mobile-${baseId}`,
        name: `${sourceBlueprint.name}-${baseId}`,
        createdAt: sourceBlueprint.createdAt,
        updatedAt: sourceBlueprint.updatedAt,
      },
      entities: structuredClone(sourceBlueprint.entities),
      entityOrder: [...sourceBlueprint.entityOrder],
      slotLinks: structuredClone(sourceBlueprint.slotLinks),
      documentSettings: {
        viewport: {
          center: { ...sourceBlueprint.initialGridPoint },
          gridSize: 1,
          displayRotation: 0,
        },
        powerMode: "infinite",
      },
    },
    queries: registry.queries,
  }));
}

async function injectRegionalSave(
  page: Page,
  documents: readonly WorldDocument[],
): Promise<{
  readonly activeDocumentKey: string;
  readonly documentCount: number;
  readonly multiBaseEnabled: boolean;
}> {
  return await page.evaluate(async ({ activeDocumentKey, injectedDocuments }) => {
    const editorPersistModuleUrl = "/src/shared/storage/editor-persist-state-storage.ts";
    const regionalSettingsModuleUrl = "/src/app/regional-settings/storage.ts";
    const worldStorageModuleUrl = "/src/shared/storage/world-document-storage.ts";
    const [editorPersist, regionalSettings, worldStorage] = await Promise.all([
      import(/* @vite-ignore */ editorPersistModuleUrl),
      import(/* @vite-ignore */ regionalSettingsModuleUrl),
      import(/* @vite-ignore */ worldStorageModuleUrl),
    ]);

    const replaced = await worldStorage.replaceWorldDocuments(injectedDocuments);
    if (!replaced) {
      throw new Error("Failed to replace world documents for the regional E2E save.");
    }
    editorPersist.writeEditorPersistState({
      lastDocumentId: activeDocumentKey,
      latestDocumentIdByBaseId: Object.fromEntries(
        injectedDocuments.map((document) => [document.baseId, document.documentKey]),
      ),
    });
    await regionalSettings.saveRegionalSettingsAsset({
      schemaVersion: 1,
      multiBaseEnabled: true,
      regions: {},
    });

    return {
      activeDocumentKey,
      documentCount: injectedDocuments.length,
      multiBaseEnabled: true,
    };
  }, {
    activeDocumentKey: documents[1]!.documentKey,
    injectedDocuments: documents,
  });
}

async function waitForFirstMinuteStats(page: Page): Promise<{
  readonly currentPlaybackTickNumber: number;
  readonly latestTickNumber: number;
  readonly producedPerMinute: number | null;
  readonly runningState: string | null;
  readonly runtimeError: string | null;
  readonly statsWindowReady: boolean;
}> {
  return await waitForStatsAtTick(page, TICKS_PER_MINUTE);
}

async function waitForStatsAtTick(page: Page, targetTickNumber: number): Promise<{
  readonly currentPlaybackTickNumber: number;
  readonly latestTickNumber: number;
  readonly producedPerMinute: number | null;
  readonly runningState: string | null;
  readonly runtimeError: string | null;
  readonly statsWindowReady: boolean;
}> {
  await page.waitForFunction((itemId) => {
    const simulation = (window as unknown as BrowserTestWindow)
      .__industrialPlannerAppHost?.workspace.simulation;
    if (simulation === null || simulation === undefined) {
      return false;
    }
    const stats = simulation.queries.getWarehouseStats();
    return simulation.state.currentPlaybackTickNumber >= itemId.targetTickNumber
      && stats?.statsWindowReady === true
      && stats.items[itemId.itemId] !== undefined;
  }, {
    itemId: XIRANITE_ITEM_ID,
    targetTickNumber,
  }, { timeout: 180_000 });

  return await page.evaluate((itemId) => {
    const simulation = (window as unknown as BrowserTestWindow)
      .__industrialPlannerAppHost?.workspace.simulation;
    const stats = simulation?.queries.getWarehouseStats() ?? null;
    return {
      currentPlaybackTickNumber: simulation?.state.currentPlaybackTickNumber ?? 0,
      latestTickNumber: simulation?.state.runtimeStatus.latestTickNumber ?? 0,
      producedPerMinute: stats?.items[itemId]?.producedPerMinute ?? null,
      runningState: simulation?.state.runningState ?? null,
      runtimeError: simulation?.state.runtimeStatus.error ?? null,
      statsWindowReady: stats?.statsWindowReady ?? false,
    };
  }, XIRANITE_ITEM_ID);
}
