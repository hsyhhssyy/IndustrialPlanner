import { expect, test } from "playwright/test";
import { normalizeBlueprintDocument } from "@/shared/blueprints/blueprint-document-codec";
import fixtureJson from "../fixtures/blueprints/editor-regional-dark-pipe/scene.schema6.json" with { type: "json" };

test("晚到旧资产只迁入出口文档；失败原子回滚，重复同步不复制链接", async ({ page }, testInfo) => {
  test.setTimeout(90_000);
  await page.goto("/");
  await page.waitForFunction(() => window.__industrialPlannerAppHost?.workspace.simulation != null);
  const result = await page.evaluate(async blueprint => {
    const app = window.__industrialPlannerAppHost!;
    const editor = app.workspace.editor!;
    const source = app.regionalSettings.createSyncSource();
    const storageUrl = "/src/shared/storage/browser-storage.ts";
    const worldUrl = "/src/shared/storage/world-document-storage.ts";
    const linkUrl = "/src/shared/dark-pipe-link.ts";
    const storage = await import(/* @vite-ignore */ storageUrl);
    const world = await import(/* @vite-ignore */ worldUrl);
    const links = await import(/* @vite-ignore */ linkUrl);
    await editor.queries.listBaseDocumentSummaries();
    const inlet = editor.document.getSnapshot().baseId;
    const region = app.workspace.registry.baseDefinitions.find(base => base.id === inlet)!.tag;
    const outlet = app.workspace.registry.baseDefinitions.find(base => base.tag === region && base.id !== inlet)!.id;
    const baseIds = [inlet, outlet];
    for (const before of await editor.queries.readLatestBaseDocuments(baseIds)) {
      await editor.actions.applySynchronizedDocument({
        ...before, entities: { ...before.entities, ...blueprint.entities },
        entityOrder: [...before.entityOrder, ...blueprint.entityOrder], slotLinks: [],
      });
    }
    const valid = links.createRegionalDarkPipeLink({ inlet: { baseId: inlet, entityId: "inlet" }, outlet: { baseId: outlet, entityId: "outlet" } });
    const missing = links.createRegionalDarkPipeLink({ inlet: { baseId: inlet, entityId: "missing-inlet" }, outlet: { baseId: outlet, entityId: "missing-outlet" } });
    const entry = { id: "default", value: { ...app.regionalSettings.asset, darkPipeLinks: [valid, missing] }, deletedAt: null };
    const location = { databaseName: "v3-industrial-planner", storeName: "regional-settings", key: "default" };
    const beforeFailure = await editor.queries.readLatestBaseDocuments(baseIds);
    const originalPut = IDBObjectStore.prototype.put;
    let failures = 0;
    let failedDocuments;
    let failedStoredDocuments;
    let failedAsset;
    try {
      // 文档 put 之后、旧资产清理之前失败，必须撤销整笔真实 IndexedDB 事务。
      IDBObjectStore.prototype.put = function (value, key) {
        if (this.name === location.storeName && typeof value === "string"
          && JSON.parse(value).data?.darkPipeLinks?.length === 1) {
          failures += 1;
          throw new DOMException("Injected legacy cleanup failure", "QuotaExceededError");
        }
        return originalPut.call(this, value, key);
      };
      await source.writeLocal(entry);
      failedDocuments = await editor.queries.readLatestBaseDocuments(baseIds);
      failedStoredDocuments = await Promise.all(failedDocuments.map(document => world.readWorldDocument(document.documentKey)));
      failedAsset = await storage.readFromIndexedDb(location);
    } finally {
      IDBObjectStore.prototype.put = originalPut;
    }
    await source.writeLocal(entry);
    const migrated = await editor.queries.readLatestBaseDocuments(baseIds);
    const stored = await Promise.all(migrated.map(document => world.readWorldDocument(document.documentKey)));
    await source.writeLocal(entry);
    const repeated = await editor.queries.readLatestBaseDocuments(baseIds);
    const remaining = await storage.readFromIndexedDb(location);
    return {
      failures, beforeFailure, failedDocuments, failedStoredDocuments,
      failedAssetLinks: failedAsset.data.darkPipeLinks,
      migrated, stored, repeated, remainingLinks: remaining.data.darkPipeLinks, missing,
    };
  }, normalizeBlueprintDocument(fixtureJson)!);

  expect(result.failures).toBeGreaterThan(0);
  expect(result.failedDocuments).toEqual(result.beforeFailure);
  expect(result.failedStoredDocuments).toEqual(result.beforeFailure);
  expect(result.failedAssetLinks).toHaveLength(2);
  expect(result.migrated.map(document => document.slotLinks.length)).toEqual([0, 1]);
  expect(result.migrated.map(document => document.schemaVersion)).toEqual([6, 6]);
  expect(result.stored).toEqual(result.migrated);
  expect(result.repeated).toEqual(result.migrated);
  expect(result.remainingLinks).toEqual([result.missing]);
  await testInfo.attach("migration-state.json", { body: JSON.stringify(result, null, 2), contentType: "application/json" });
});
