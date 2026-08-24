// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  DEFAULT_CLOUDFLARE_SPACE_NAME,
  writeCloudflareSyncSettings,
} from "@/shared/storage/cloudflare-sync-settings";
import { initializeCloudflareSpaceSettings } from "@/sync/clients/cloudflare";
import {
  CloudflareV2LocalStateStore,
  hasPersistedCloudflareV2LocalState,
} from "@/sync/clients/cloudflare/cloudflare-v2-local-state";
import { createFakeIndexedDbFactory } from "./fake-indexed-db";

const API_BASE = "https://sync.example.test";

describe("Cloudflare 首次空间初始化", () => {
  beforeEach(() => {
    vi.stubGlobal("indexedDB", createFakeIndexedDbFactory());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("keeps Cloudflare unconfigured when it has never been activated", async () => {
    const settings = await initializeCloudflareSpaceSettings({
      apiBase: API_BASE,
      cloudflareProviderSelected: false,
    });

    // AI-REMOVED 2026-08-24:
    // Reason: 未确认 Cloudflare 的新用户不再获得随机 Space ID。
    // Trigger: provider 两阶段激活行为变更。
    // Evidence: initializeCloudflareSpaceSettings 返回空目标且不写远端。
    // Replacement: 下方空目标断言。
    // Risk: Low。
    // Human Review: Required
    //
    // Original code:
    // expect(settings.spaceName).toMatch(/^space-/);
    // expect(settings.spaceName).not.toBe(DEFAULT_CLOUDFLARE_SPACE_NAME);
    expect(settings).toEqual({
      spaceName: "",
      remoteMode: "anonymous",
    });
  });

  it("keeps default when Cloudflare is currently selected", async () => {
    await expect(initializeCloudflareSpaceSettings({
      apiBase: API_BASE,
      cloudflareProviderSelected: true,
    })).resolves.toEqual({
      spaceName: DEFAULT_CLOUDFLARE_SPACE_NAME,
      remoteMode: "anonymous",
    });
  });

  it("discards an unused random target left by the legacy initializer", async () => {
    await writeCloudflareSyncSettings({
      spaceName: "space-01234567-89ab-4cde-8fab-0123456789ab",
      remoteMode: "anonymous",
    });

    await expect(initializeCloudflareSpaceSettings({
      apiBase: API_BASE,
      cloudflareProviderSelected: false,
    })).resolves.toEqual({
      spaceName: "",
      remoteMode: "anonymous",
    });
  });

  it("keeps default when an inactive provider still has default sync state", async () => {
    await expect(hasPersistedCloudflareV2LocalState(
      `${API_BASE}/`,
      DEFAULT_CLOUDFLARE_SPACE_NAME,
    )).resolves.toBe(false);

    const localState = new CloudflareV2LocalStateStore(
      API_BASE,
      DEFAULT_CLOUDFLARE_SPACE_NAME,
    );
    await localState.readAppliedRevision();

    await expect(hasPersistedCloudflareV2LocalState(
      `${API_BASE}/`,
      DEFAULT_CLOUDFLARE_SPACE_NAME,
    )).resolves.toBe(true);
    await expect(initializeCloudflareSpaceSettings({
      apiBase: `${API_BASE}/`,
      cloudflareProviderSelected: false,
    })).resolves.toEqual({
      spaceName: DEFAULT_CLOUDFLARE_SPACE_NAME,
      remoteMode: "anonymous",
    });
  });
});
