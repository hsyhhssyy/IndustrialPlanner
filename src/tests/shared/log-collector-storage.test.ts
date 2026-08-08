// @vitest-environment jsdom

import { describe, expect, it } from "vitest";

import { LogCollectorStorage } from "@/shared/logging/log-collector-storage";
import {
  createFakeIdbKeyRangeFactory,
  createFakeIndexedDbFactory,
} from "@/tests/shared/fake-indexed-db";

function createEntry(index: number) {
  return {
    occurredAt: 1_000 + index,
    level: "log" as const,
    source: "main" as const,
    instanceId: "main-test",
    message: `entry-${index}`,
  };
}

describe("LogCollectorStorage", () => {
  it("retains only the newest 500 entries in deterministic collector order", async () => {
    const storage = new LogCollectorStorage({
      indexedDb: createFakeIndexedDbFactory(),
      keyRange: createFakeIdbKeyRangeFactory(),
      databaseName: "log-retention-test",
    });

    for (let index = 1; index <= 501; index += 1) {
      await storage.append(createEntry(index));
    }

    const result = await storage.query({ limit: 500 });
    expect(result.total).toBe(500);
    expect(result.entries).toHaveLength(500);
    expect(result.entries[0]).toMatchObject({ id: 501, message: "entry-501" });
    expect(result.entries.at(-1)).toMatchObject({ id: 2, message: "entry-2" });
    expect(result.nextBeforeId).toBeUndefined();
  });

  it("supports stable beforeId pagination and explicit clear", async () => {
    const storage = new LogCollectorStorage({
      indexedDb: createFakeIndexedDbFactory(),
      keyRange: createFakeIdbKeyRangeFactory(),
      databaseName: "log-pagination-test",
    });
    for (let index = 1; index <= 5; index += 1) {
      await storage.append(createEntry(index));
    }

    const firstPage = await storage.query({ limit: 2 });
    expect(firstPage.entries.map((entry) => entry.id)).toEqual([5, 4]);
    expect(firstPage.nextBeforeId).toBe(4);

    const secondPage = await storage.query({
      beforeId: firstPage.nextBeforeId,
      limit: 2,
    });
    expect(secondPage.entries.map((entry) => entry.id)).toEqual([3, 2]);
    expect(secondPage.nextBeforeId).toBe(2);

    await storage.clear();
    await expect(storage.query({ limit: 10 })).resolves.toMatchObject({
      entries: [],
      total: 0,
    });
  });
});
