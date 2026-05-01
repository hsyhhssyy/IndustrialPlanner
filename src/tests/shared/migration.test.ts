import { afterEach, describe, expect, it, vi } from "vitest";

import {
  readFromLocalStorageWithMigration,
  readFromIndexedDbWithMigration,
  saveToLocalStorageWithVersion,
  saveToIndexedDbWithVersion,
  type StorageMigration,
} from "@/shared/storage/migration";
import type { IndexedDbStorageLocation } from "@/shared/storage/browser-storage";
import { createFakeIndexedDbFactory } from "./fake-indexed-db";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

interface TestDocumentV1 {
  name: string;
}

interface TestDocumentV2 {
  name: string;
  age: number;
}

interface TestDocumentV3 {
  name: string;
  age: number;
  email: string;
}

const MIGRATIONS_V1_TO_V3: readonly StorageMigration<
  TestDocumentV3,
  string
>[] = [
  {
    version: 1,
    migrate(raw: unknown, fallbackName: string): TestDocumentV3 | null {
      if (
        typeof raw !== "object" ||
        raw === null ||
        !("name" in raw) ||
        typeof (raw as TestDocumentV1).name !== "string"
      ) {
        return null;
      }

      return {
        name: (raw as TestDocumentV1).name || fallbackName,
        age: 0,
        email: "",
      };
    },
  },
  {
    version: 2,
    migrate(raw: unknown): TestDocumentV3 | null {
      if (typeof raw !== "object" || raw === null) {
        return null;
      }

      const doc = raw as Partial<TestDocumentV2>;

      if (typeof doc.name !== "string") {
        return null;
      }

      const age =
        typeof doc.age === "number" && Number.isFinite(doc.age) ? doc.age : 0;

      return { name: doc.name, age, email: "" };
    },
  },
  {
    version: 3,
    migrate(raw: unknown): TestDocumentV3 | null {
      const doc = raw as TestDocumentV3;

      // v3 新增 email 字段，补默认值。
      if (typeof doc.email !== "string") {
        return { ...doc, email: "" };
      }

      return doc;
    },
  },
];

function createIndexedDbLocation(
  overrides: Partial<IndexedDbStorageLocation> = {},
): IndexedDbStorageLocation {
  return {
    databaseName: "industrial-planner-test",
    storeName: "migration-test",
    key: "primary",
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

afterEach(() => {
  localStorage.clear();
  vi.unstubAllGlobals();
});

describe("migration", () => {
  // -----------------------------------------------------------------------
  // localStorage
  // -----------------------------------------------------------------------

  describe("readFromLocalStorageWithMigration", () => {
    it("returns null when localStorage key does not exist", () => {
      expect(
        readFromLocalStorageWithMigration("nonexistent", 3, MIGRATIONS_V1_TO_V3, "fallback"),
      ).toBeNull();
    });

    it("migrates unversioned (v0) raw data through full chain to v3", () => {
      // 模拟旧代码写入的裸数据（无 _v 包装）。
      localStorage.setItem("doc", JSON.stringify({ name: "Alice" }));

      const result = readFromLocalStorageWithMigration(
        "doc",
        3,
        MIGRATIONS_V1_TO_V3,
        "fallback",
      );

      expect(result).toEqual({ name: "Alice", age: 0, email: "" });
    });

    it("migrates v1-wrapped data to v3 (skips v1, runs v2 + v3)", () => {
      // v1 包装数据：只有 name，无 age。
      localStorage.setItem(
        "doc",
        JSON.stringify({ _v: 1, data: { name: "Bob" } }),
      );

      const result = readFromLocalStorageWithMigration(
        "doc",
        3,
        MIGRATIONS_V1_TO_V3,
        "fallback",
      );

      expect(result).toEqual({ name: "Bob", age: 0, email: "" });
    });

    it("migrates v2-wrapped data to v3 (runs only v3)", () => {
      localStorage.setItem(
        "doc",
        JSON.stringify({ _v: 2, data: { name: "Carol", age: 30 } }),
      );

      const result = readFromLocalStorageWithMigration(
        "doc",
        3,
        MIGRATIONS_V1_TO_V3,
        "fallback",
      );

      expect(result).toEqual({ name: "Carol", age: 30, email: "" });
    });

    it("returns data as-is when already at latest version (v3)", () => {
      const snapshot: TestDocumentV3 = { name: "Dan", age: 40, email: "dan@example.com" };

      localStorage.setItem(
        "doc",
        JSON.stringify({ _v: 3, data: snapshot }),
      );

      const result = readFromLocalStorageWithMigration(
        "doc",
        3,
        MIGRATIONS_V1_TO_V3,
        "fallback",
      );

      expect(result).toEqual(snapshot);
    });

    it("returns null when a migration step returns null (corrupted v1)", () => {
      localStorage.setItem("doc", JSON.stringify({ _v: 1, data: null }));

      const result = readFromLocalStorageWithMigration(
        "doc",
        3,
        MIGRATIONS_V1_TO_V3,
        "fallback",
      );

      expect(result).toBeNull();
    });

    it("returns null when stored version exceeds current version (downgrade)", () => {
      localStorage.setItem(
        "doc",
        JSON.stringify({ _v: 10, data: { name: "Future" } }),
      );

      const result = readFromLocalStorageWithMigration(
        "doc",
        3,
        MIGRATIONS_V1_TO_V3,
        "fallback",
      );

      expect(result).toBeNull();
    });

    it("handles corrupted JSON in localStorage gracefully", () => {
      localStorage.setItem("doc", "{");

      const result = readFromLocalStorageWithMigration(
        "doc",
        3,
        MIGRATIONS_V1_TO_V3,
        "fallback",
      );

      expect(result).toBeNull();
    });

    it("round-trips: save with version then read with migration", () => {
      const snapshot: TestDocumentV3 = { name: "Eve", age: 25, email: "eve@example.com" };

      saveToLocalStorageWithVersion("doc", 3, snapshot);

      const result = readFromLocalStorageWithMigration(
        "doc",
        3,
        MIGRATIONS_V1_TO_V3,
        "fallback",
      );

      expect(result).toEqual(snapshot);
    });
  });

  // -----------------------------------------------------------------------
  // IndexedDB
  // -----------------------------------------------------------------------

  describe("readFromIndexedDbWithMigration", () => {
    it("returns null when IndexedDB is unavailable", async () => {
      vi.stubGlobal("indexedDB", undefined);

      await expect(
        readFromIndexedDbWithMigration(
          createIndexedDbLocation(),
          3,
          MIGRATIONS_V1_TO_V3,
          "fallback",
        ),
      ).resolves.toBeNull();
    });

    it("migrates unversioned raw data through full chain", async () => {
      vi.stubGlobal("indexedDB", createFakeIndexedDbFactory());

      // 模拟旧代码写入的裸对象（无 _v 包装）。
      await saveToIndexedDbWithVersion(
        createIndexedDbLocation(),
        0, // 故意写 v0 来模拟无版本旧数据：_v:0, data:{name:"Alice"}
        { name: "Alice" } as unknown as TestDocumentV3,
      );

      const result = await readFromIndexedDbWithMigration(
        createIndexedDbLocation(),
        3,
        MIGRATIONS_V1_TO_V3,
        "fallback",
      );

      expect(result).toEqual({ name: "Alice", age: 0, email: "" });
    });

    it("migrates v2 data to v3", async () => {
      vi.stubGlobal("indexedDB", createFakeIndexedDbFactory());

      await saveToIndexedDbWithVersion(
        createIndexedDbLocation(),
        2,
        { name: "Bob", age: 35 } as unknown as TestDocumentV3,
      );

      const result = await readFromIndexedDbWithMigration(
        createIndexedDbLocation(),
        3,
        MIGRATIONS_V1_TO_V3,
        "fallback",
      );

      expect(result).toEqual({ name: "Bob", age: 35, email: "" });
    });

    it("round-trips: save v3 then read v3", async () => {
      vi.stubGlobal("indexedDB", createFakeIndexedDbFactory());

      const snapshot: TestDocumentV3 = { name: "Carol", age: 28, email: "carol@example.com" };

      await saveToIndexedDbWithVersion(createIndexedDbLocation(), 3, snapshot);

      const result = await readFromIndexedDbWithMigration(
        createIndexedDbLocation(),
        3,
        MIGRATIONS_V1_TO_V3,
        "fallback",
      );

      expect(result).toEqual(snapshot);
    });

    it("returns null when stored version > current version", async () => {
      vi.stubGlobal("indexedDB", createFakeIndexedDbFactory());

      await saveToIndexedDbWithVersion(
        createIndexedDbLocation(),
        10,
        { name: "Future" } as unknown as TestDocumentV3,
      );

      const result = await readFromIndexedDbWithMigration(
        createIndexedDbLocation(),
        3,
        MIGRATIONS_V1_TO_V3,
        "fallback",
      );

      expect(result).toBeNull();
    });
  });

  // -----------------------------------------------------------------------
  // Edge cases
  // -----------------------------------------------------------------------

  describe("edge cases", () => {
    it("passes context to each migration step", () => {
      const migrationsWithContext: readonly StorageMigration<
        { label: string },
        string
      >[] = [
        {
          version: 1,
          migrate(raw: unknown, context: string) {
            return { label: `${String((raw as { label?: string })?.label ?? "")}${context}` };
          },
        },
      ];

      localStorage.setItem("ctx", JSON.stringify({ label: "Hello, " }));

      const result = readFromLocalStorageWithMigration(
        "ctx",
        1,
        migrationsWithContext,
        "World!",
      );

      expect(result).toEqual({ label: "Hello, World!" });
    });

    it("returns null when empty migrations array and unversioned data", () => {
      localStorage.setItem("bare", JSON.stringify({ some: "data" }));

      const result = readFromLocalStorageWithMigration<{ some: string }>(
        "bare",
        0,
        [],
        undefined as void,
      );

      expect(result).toEqual({ some: "data" });
    });

    it("returns data when empty migrations and at current version", () => {
      localStorage.setItem(
        "ver",
        JSON.stringify({ _v: 1, data: { hello: "world" } }),
      );

      const result = readFromLocalStorageWithMigration<{ hello: string }>(
        "ver",
        1,
        [],
        undefined as void,
      );

      expect(result).toEqual({ hello: "world" });
    });
  });
});
