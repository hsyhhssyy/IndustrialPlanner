import { expect, test } from "playwright/test";

test.beforeEach(async ({ page }) => {
  // 保留真实同源 IndexedDB 与生产存储模块，页面不启动其他业务模块。
  await page.route("**/__storage_regression__", (route) => route.fulfill({
    contentType: "text/html",
    body: "<!doctype html><title>Storage regression</title>",
  }));
  await page.goto("/__storage_regression__");
});

test("并发首次访问不同 IndexedDB 仓库时，全部写入成功并可读回", async ({ page }) => {
  const result = await page.evaluate(async () => {
    const moduleUrl = "/src/shared/storage/browser-storage.ts";
    const storage = await import(/* @vite-ignore */ moduleUrl);
    const locations = Array.from({ length: 8 }, (_, index) => ({
      databaseName: "concurrent-store-regression",
      storeName: `documents-${index}`,
      key: "document",
    }));
    const writes = await Promise.all(locations.map((location, index) => (
      storage.trySaveToIndexedDb(location, { documentKey: `document-${index}` })
    )));
    const documents = await Promise.all(locations.map((location) => storage.readFromIndexedDb(location)));
    return { writes, documents };
  });

  expect(result.writes).toEqual(Array(8).fill(true));
  expect(result.documents).toEqual(Array.from({ length: 8 }, (_, index) => ({
    documentKey: `document-${index}`,
  })));
});

test("跨仓库条件写入在版本冲突、途中取消或序列化失败时保持原子性", async ({ page }) => {
  const result = await page.evaluate(async () => {
    const moduleUrl = "/src/shared/storage/browser-storage.ts";
    const storage = await import(/* @vite-ignore */ moduleUrl);
    const database = { databaseName: "atomic-store-regression" };
    const locations = ["outlet", "inlet"].map((storeName) => ({
      ...database, storeName, key: "document",
    }));
    const makeBatches = (revision: number) => locations.map(({ storeName, key }) => ({
      storeName,
      operations: [{ type: "put", key, value: { revision } }],
    }));
    const readBoth = () => Promise.all(locations.map((location) => storage.readFromIndexedDb(location)));
    const seeded = await storage.applyIndexedDbTransactionMutations(database, makeBatches(1));
    const conflict = await storage.applyIndexedDbTransactionMutations(database, makeBatches(2), {}, {
      expectedValues: [{ storeName: "outlet", key: "document", value: { revision: 0 } }],
    });
    const afterConflict = await readBoth();

    const controller = new AbortController();
    let serialized = 0;
    const cancelled = await storage.applyIndexedDbTransactionMutations(database, makeBatches(3), {
      serialize(value: unknown) {
        serialized += 1;
        // 第一份文档的 put 已成功；此时取消必须连同第一份写入一起回滚。
        if (serialized === 2) controller.abort();
        return JSON.stringify(value);
      },
    }, { signal: controller.signal });
    const afterCancel = await readBoth();

    serialized = 0;
    const serializationFailure = await storage.applyIndexedDbTransactionMutations(database, makeBatches(4), {
      serialize(value: unknown) {
        serialized += 1;
        if (serialized === 2) throw new Error("Injected serialization failure");
        return JSON.stringify(value);
      },
    });
    const afterSerializationFailure = await readBoth();
    const committed = await storage.applyIndexedDbTransactionMutations(database, makeBatches(5), {}, {
      expectedValues: locations.map(({ storeName, key }) => ({ storeName, key, value: { revision: 1 } })),
    });
    return {
      seeded, conflict, afterConflict, cancelled, afterCancel,
      serializationFailure, afterSerializationFailure, committed, afterCommit: await readBoth(),
    };
  });

  expect(result.seeded).toBe(true);
  expect(result.conflict).toBe(false);
  expect(result.cancelled).toBe(false);
  expect(result.serializationFailure).toBe(false);
  for (const documents of [result.afterConflict, result.afterCancel, result.afterSerializationFailure]) {
    expect(documents).toEqual([{ revision: 1 }, { revision: 1 }]);
  }
  expect(result.committed).toBe(true);
  expect(result.afterCommit).toEqual([{ revision: 5 }, { revision: 5 }]);
});
