// @vitest-environment jsdom

import { afterEach, describe, expect, it } from "vitest";

import {
  activateSyncProvider,
  createCloudflareAccountSyncTargetKey,
  createCloudflareAnonymousSyncTargetKey,
  createWebDavSyncTargetKey,
  isSyncProviderTargetActive,
  readActiveSyncProvider,
  readSelectedSyncProvider,
  readSyncProviderActivation,
  requestSyncProvider,
  SYNC_PROVIDER_ACTIVATION_STORAGE_KEY,
  SYNC_PROVIDER_STORAGE_KEY,
} from "@/shared/storage/sync-provider-activation";

afterEach(() => {
  localStorage.clear();
});

describe("sync provider activation", () => {
  it("keeps a selected provider pending until its exact target is confirmed", () => {
    const targetKey = createWebDavSyncTargetKey({
      url: "https://dav.example.test/root/",
      username: "planner",
    });

    expect(requestSyncProvider("webdav")).toBe(true);
    expect(readSelectedSyncProvider()).toBe("webdav");
    expect(readActiveSyncProvider()).toBeNull();
    expect(readSyncProviderActivation()).toEqual({
      schemaVersion: 1,
      state: "pending",
      provider: "webdav",
    });
    expect(isSyncProviderTargetActive("webdav", targetKey)).toBe(false);

    expect(activateSyncProvider("webdav", targetKey)).toBe(true);
    expect(readActiveSyncProvider()).toBe("webdav");
    expect(isSyncProviderTargetActive("webdav", targetKey)).toBe(true);
    expect(isSyncProviderTargetActive(
      "webdav",
      createWebDavSyncTargetKey({
        url: "https://dav.example.test/other",
        username: "planner",
      }),
    )).toBe(false);
  });

  it("treats a legacy provider record as active until the host records its target", () => {
    localStorage.setItem(SYNC_PROVIDER_STORAGE_KEY, "cloudflare");

    expect(localStorage.getItem(SYNC_PROVIDER_ACTIVATION_STORAGE_KEY)).toBeNull();
    expect(readSyncProviderActivation()).toEqual({
      schemaVersion: 1,
      state: "active",
      provider: "cloudflare",
      confirmedTargetKey: null,
    });
    expect(isSyncProviderTargetActive(
      "cloudflare",
      createCloudflareAnonymousSyncTargetKey({
        apiBaseUrl: "https://sync.example.test",
        spaceId: "legacy-space",
      }),
    )).toBe(true);
  });

  it("keeps account and anonymous Cloudflare targets distinct", () => {
    const anonymousTarget = createCloudflareAnonymousSyncTargetKey({
      apiBaseUrl: "https://sync.example.test/",
      spaceId: "shared-space",
    });
    const accountTarget = createCloudflareAccountSyncTargetKey({
      apiBaseUrl: "https://sync.example.test",
      accountId: "account-1",
      spaceId: "shared-space",
    });

    expect(activateSyncProvider("cloudflare", anonymousTarget)).toBe(true);
    expect(isSyncProviderTargetActive("cloudflare", anonymousTarget)).toBe(true);
    expect(isSyncProviderTargetActive("cloudflare", accountTarget)).toBe(false);
  });

  it("disables sync without deleting the legacy provider compatibility key", () => {
    expect(requestSyncProvider("cloudflare")).toBe(true);
    expect(requestSyncProvider("none")).toBe(true);

    expect(readSyncProviderActivation()).toEqual({
      schemaVersion: 1,
      state: "disabled",
    });
    expect(localStorage.getItem(SYNC_PROVIDER_STORAGE_KEY)).toBe("none");
  });
});
