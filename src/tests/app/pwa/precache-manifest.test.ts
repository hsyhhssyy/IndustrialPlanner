import { describe, expect, it } from "vitest";

import {
  calculateTotalBytes,
  createRuntimePrecacheCacheUrl,
  hashPrecacheEntries,
  isDeviceAnimationAssetUrl,
  normalizePrecacheEntries,
  partitionPrecacheEntries,
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

  it("partitions device animation assets from the atomic core package", () => {
    const scope = "https://planner.example.com/tools/current/";
    const entries: readonly PrecacheEntry[] = [
      {
        bytes: 10,
        revision: "core",
        url: "assets/index.js",
      },
      {
        bytes: 20,
        revision: "manifest",
        url: "3d-top-view/animations/reaction-pool.manifest.json",
      },
      {
        bytes: 30,
        revision: "page",
        url: "/tools/current/3d-top-view/animations/reaction-pool-page-00.webp",
      },
    ];

    expect(partitionPrecacheEntries(entries, scope)).toEqual({
      animationEntries: [entries[1], entries[2]],
      coreEntries: [entries[0]],
    });
  });

  it("matches only the animation directory inside the current service-worker scope", () => {
    const scope = "https://planner.example.com/tools/current/";

    expect(isDeviceAnimationAssetUrl(
      "3d-top-view/animations/reaction-pool-page-00.webp?revision=1",
      scope,
    )).toBe(true);
    expect(isDeviceAnimationAssetUrl(
      "https://planner.example.com/tools/current/3d-top-view/animations/reaction-pool.manifest.json",
      scope,
    )).toBe(true);
    expect(isDeviceAnimationAssetUrl(
      "https://planner.example.com/tools/other/3d-top-view/animations/reaction-pool.manifest.json",
      scope,
    )).toBe(false);
    expect(isDeviceAnimationAssetUrl(
      "https://cdn.example.com/tools/current/3d-top-view/animations/reaction-pool.manifest.json",
      scope,
    )).toBe(false);
    expect(isDeviceAnimationAssetUrl("3d-top-view/static/device.webp", scope)).toBe(false);
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

  it("ignores the version script cache buster when resolving runtime cache URLs", () => {
    const scope = "https://planner.example.com/tools/27629/";

    expect(createRuntimePrecacheCacheUrl(
      new URL("https://planner.example.com/tools/27629/version.js?v=v1.3.0"),
      scope,
    )).toBe("https://planner.example.com/tools/27629/version.js");
    expect(createRuntimePrecacheCacheUrl(
      new URL("https://planner.example.com/tools/27629/assets/index.js?v=v1.3.0"),
      scope,
    )).toBe("https://planner.example.com/tools/27629/assets/index.js?v=v1.3.0");
  });
});
