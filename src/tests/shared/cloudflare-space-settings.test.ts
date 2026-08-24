// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { DEFAULT_CLOUDFLARE_SPACE_NAME } from "@/shared/storage/cloudflare-sync-settings";
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

  it("assigns a random space when Cloudflare has never been used", async () => {
    const settings = await initializeCloudflareSpaceSettings({
      apiBase: API_BASE,
      cloudflareProviderSelected: false,
    });

    expect(settings.spaceName).toMatch(/^space-/);
    expect(settings.spaceName).not.toBe(DEFAULT_CLOUDFLARE_SPACE_NAME);
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
