// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from "vitest";

import {
  DEFAULT_CLOUDFLARE_SPACE_NAME,
  clearCloudflareSyncSettings,
  readCloudflareSyncSettings,
  resolveCloudflareSpaceId,
  subscribeToCloudflareSyncSettingsChanges,
  writeCloudflareSyncSettings,
} from "@/shared/storage/cloudflare-sync-settings";
import { createFakeIndexedDbFactory } from "./fake-indexed-db";
import {
  listActiveSyncTombstones,
  writeActiveSyncTombstone,
} from "@/shared/storage/sync-tombstone-storage";

afterEach(() => {
  localStorage.clear();
  vi.unstubAllGlobals();
});

describe("cloudflare-sync-settings", () => {
  it("uses default until a trimmed space name is explicitly saved", async () => {
    vi.stubGlobal("indexedDB", createFakeIndexedDbFactory());

    await expect(readCloudflareSyncSettings()).resolves.toEqual({
      spaceName: DEFAULT_CLOUDFLARE_SPACE_NAME,
    });
    await expect(writeCloudflareSyncSettings({
      spaceName: "  production  ",
    })).resolves.toEqual({ spaceName: "production" });
    await expect(readCloudflareSyncSettings()).resolves.toEqual({
      spaceName: "production",
    });
    expect(resolveCloudflareSpaceId({ spaceName: " shared-space " }))
      .toBe("shared-space");
  });

  it("resets to default and notifies subscribers when local CF data is cleared", async () => {
    vi.stubGlobal("indexedDB", createFakeIndexedDbFactory());
    const listener = vi.fn();
    const unsubscribe = subscribeToCloudflareSyncSettingsChanges(listener);

    await writeCloudflareSyncSettings({ spaceName: "temporary" });
    await clearCloudflareSyncSettings();

    expect(listener).toHaveBeenLastCalledWith({
      spaceName: DEFAULT_CLOUDFLARE_SPACE_NAME,
    });
    await expect(readCloudflareSyncSettings()).resolves.toEqual({
      spaceName: DEFAULT_CLOUDFLARE_SPACE_NAME,
    });
    unsubscribe();
  });

  it("isolates sync tombstones when the saved Cloudflare space changes", async () => {
    vi.stubGlobal("indexedDB", createFakeIndexedDbFactory());
    localStorage.setItem("v3-sync-provider", "cloudflare");

    await writeActiveSyncTombstone({
      adapterId: "blueprints",
      assetId: "blueprint-a",
      value: { blueprintId: "blueprint-a" },
      deletedAt: "2026-08-08T00:00:00.000Z",
    });
    await expect(listActiveSyncTombstones("blueprints")).resolves.toHaveLength(1);

    await writeCloudflareSyncSettings({ spaceName: "another-space" });
    await expect(listActiveSyncTombstones("blueprints")).resolves.toEqual([]);

    await writeCloudflareSyncSettings({ spaceName: "default" });
    await expect(listActiveSyncTombstones("blueprints")).resolves.toHaveLength(1);
  });
});
