import { describe, expect, it } from "vitest";

import {
  calculateTotalBytes,
  hashPrecacheEntries,
  normalizePrecacheEntries,
  resolvePrecacheEntryByteSize,
  type PrecacheEntry,
} from "@/app/pwa/precache-manifest";

describe("precache manifest helpers", () => {
  it("deduplicates entries by URL and keeps the entry with hash metadata", () => {
    const entries: readonly PrecacheEntry[] = [
      {
        revision: "legacy-revision",
        url: "pwa-icon.svg",
      },
      {
        bytes: 128,
        revision: "legacy-revision",
        sha256: "a".repeat(64),
        url: "pwa-icon.svg",
      },
      {
        bytes: 16,
        revision: "other",
        sha256: "b".repeat(64),
        url: "index.html",
      },
    ];

    expect(normalizePrecacheEntries(entries)).toEqual([
      {
        bytes: 128,
        revision: "legacy-revision",
        sha256: "a".repeat(64),
        url: "pwa-icon.svg",
      },
      {
        bytes: 16,
        revision: "other",
        sha256: "b".repeat(64),
        url: "index.html",
      },
    ]);
  });

  it("uses bytes before the legacy size field", () => {
    expect(resolvePrecacheEntryByteSize({
      bytes: 24,
      revision: "revision",
      size: 12,
      url: "asset.js",
    })).toBe(24);
    expect(calculateTotalBytes([
      {
        bytes: 24,
        revision: "revision-a",
        url: "asset-a.js",
      },
      {
        revision: "revision-b",
        size: 12,
        url: "asset-b.js",
      },
    ])).toBe(36);
  });

  it("includes sha256 and byte size in the cache name signature", () => {
    const baseEntries: readonly PrecacheEntry[] = [
      {
        bytes: 24,
        revision: "revision",
        sha256: "a".repeat(64),
        url: "asset.js",
      },
    ];

    expect(hashPrecacheEntries(baseEntries)).toBe(hashPrecacheEntries([...baseEntries].reverse()));
    expect(hashPrecacheEntries(baseEntries)).not.toBe(hashPrecacheEntries([
      {
        bytes: 24,
        revision: "revision",
        sha256: "b".repeat(64),
        url: "asset.js",
      },
    ]));
    expect(hashPrecacheEntries(baseEntries)).not.toBe(hashPrecacheEntries([
      {
        bytes: 25,
        revision: "revision",
        sha256: "a".repeat(64),
        url: "asset.js",
      },
    ]));
  });
});
