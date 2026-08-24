// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from "vitest";

import {
  DEFAULT_CLOUDFLARE_SPACE_NAME,
  clearCloudflareSyncSettings,
  initializeCloudflareSyncSettings,
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
      remoteMode: "anonymous",
    });
    await expect(writeCloudflareSyncSettings({
      spaceName: "  production  ",
      remoteMode: "anonymous",
    })).resolves.toEqual({ spaceName: "production", remoteMode: "anonymous" });
    await expect(readCloudflareSyncSettings()).resolves.toEqual({
      spaceName: "production",
      remoteMode: "anonymous",
    });
    expect(resolveCloudflareSpaceId({
      spaceName: " shared-space ",
      remoteMode: "anonymous",
    }))
      .toBe("shared-space");
  });

  it("creates one stable random space for a first-time Cloudflare user", async () => {
    vi.stubGlobal("indexedDB", createFakeIndexedDbFactory());

    const initialized = await initializeCloudflareSyncSettings({
      preserveImplicitDefault: false,
    });

    expect(initialized.spaceName).toMatch(
      /^space-[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
    );
    await expect(initializeCloudflareSyncSettings({
      preserveImplicitDefault: false,
    })).resolves.toEqual(initialized);
    await expect(readCloudflareSyncSettings()).resolves.toEqual(initialized);
  });

  it("preserves implicit and explicitly saved default spaces", async () => {
    vi.stubGlobal("indexedDB", createFakeIndexedDbFactory());

    await expect(initializeCloudflareSyncSettings({
      preserveImplicitDefault: true,
    })).resolves.toEqual({
      spaceName: DEFAULT_CLOUDFLARE_SPACE_NAME,
      remoteMode: "anonymous",
    });

    await clearCloudflareSyncSettings();
    await writeCloudflareSyncSettings({
      spaceName: DEFAULT_CLOUDFLARE_SPACE_NAME,
      remoteMode: "anonymous",
    });
    await expect(initializeCloudflareSyncSettings({
      preserveImplicitDefault: false,
    })).resolves.toEqual({
      spaceName: DEFAULT_CLOUDFLARE_SPACE_NAME,
      remoteMode: "anonymous",
    });
  });

  it("rejects an empty space instead of resolving it to default", async () => {
    vi.stubGlobal("indexedDB", createFakeIndexedDbFactory());

    await expect(writeCloudflareSyncSettings({
      spaceName: "   ",
      remoteMode: "anonymous",
    }))
      .rejects.toThrow("Cloudflare space name must not be empty.");
    expect(() => resolveCloudflareSpaceId({
      spaceName: "   ",
      remoteMode: "anonymous",
    }))
      .toThrow("Cloudflare space name must not be empty.");
  });

  it("resets to default and notifies subscribers when local CF data is cleared", async () => {
    vi.stubGlobal("indexedDB", createFakeIndexedDbFactory());
    const listener = vi.fn();
    const unsubscribe = subscribeToCloudflareSyncSettingsChanges(listener);

    await writeCloudflareSyncSettings({
      spaceName: "temporary",
      remoteMode: "anonymous",
    });
    await clearCloudflareSyncSettings();

    expect(listener).toHaveBeenLastCalledWith({
      spaceName: DEFAULT_CLOUDFLARE_SPACE_NAME,
      remoteMode: "anonymous",
    });
    await expect(readCloudflareSyncSettings()).resolves.toEqual({
      spaceName: DEFAULT_CLOUDFLARE_SPACE_NAME,
      remoteMode: "anonymous",
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

    await writeCloudflareSyncSettings({
      spaceName: "another-space",
      remoteMode: "anonymous",
    });
    await expect(listActiveSyncTombstones("blueprints")).resolves.toEqual([]);

    await writeCloudflareSyncSettings({
      spaceName: "default",
      remoteMode: "anonymous",
    });
    await expect(listActiveSyncTombstones("blueprints")).resolves.toHaveLength(1);
  });
});
