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
  it("stays unconfigured until a trimmed space ID is explicitly saved", async () => {
    vi.stubGlobal("indexedDB", createFakeIndexedDbFactory());

    await expect(readCloudflareSyncSettings()).resolves.toEqual({
      spaceName: "",
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

  it("does not create a random space while Cloudflare is unconfirmed", async () => {
    vi.stubGlobal("indexedDB", createFakeIndexedDbFactory());

    const initialized = await initializeCloudflareSyncSettings({
      preserveImplicitDefault: false,
    });

    // AI-REMOVED 2026-08-24:
    // Reason: 初始化不再生成随机 Space ID。
    // Trigger: 用户要求匿名 Space 必须显式确认。
    // Evidence: preserveImplicitDefault=false 现在表示未配置。
    // Replacement: 下方空目标断言。
    // Risk: Low。
    // Human Review: Required
    //
    // Original code:
    // expect(initialized.spaceName).toMatch(
    //   /^space-[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
    // );
    expect(initialized).toEqual({
      spaceName: "",
      remoteMode: "anonymous",
    });
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
    await expect(writeCloudflareSyncSettings({
      spaceName: "",
      remoteMode: "account",
    })).resolves.toEqual({
      spaceName: "",
      remoteMode: "account",
    });
  });

  it("resets to an unconfigured target and notifies subscribers when local CF data is cleared", async () => {
    vi.stubGlobal("indexedDB", createFakeIndexedDbFactory());
    const listener = vi.fn();
    const unsubscribe = subscribeToCloudflareSyncSettingsChanges(listener);

    await writeCloudflareSyncSettings({
      spaceName: "temporary",
      remoteMode: "anonymous",
    });
    await clearCloudflareSyncSettings();

    expect(listener).toHaveBeenLastCalledWith({
      spaceName: "",
      remoteMode: "anonymous",
    });
    await expect(readCloudflareSyncSettings()).resolves.toEqual({
      spaceName: "",
      remoteMode: "anonymous",
    });
    unsubscribe();
  });

  it("isolates sync tombstones when the saved Cloudflare space changes", async () => {
    vi.stubGlobal("indexedDB", createFakeIndexedDbFactory());
    localStorage.setItem("v3-sync-provider", "cloudflare");
    await writeCloudflareSyncSettings({
      spaceName: DEFAULT_CLOUDFLARE_SPACE_NAME,
      remoteMode: "anonymous",
    });

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
