// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from "vitest";

import {
  CLOUDFLARE_OAUTH_SESSION_LOCAL_STORAGE_KEY,
  clearCloudflareOAuthSession,
  completeCloudflareOAuthLogin,
  readCloudflareOAuthSession,
  subscribeToCloudflareOAuthSessionChanges,
  writeCloudflareOAuthSession,
  type CloudflareOAuthSession,
} from "@/shared/storage/cloudflare-oauth-session";
import { createCloudflareOAuthAuthorizeUrl } from "@/shared/storage/cloudflare-oauth-browser-flow";
import { writeBackendApiAddressOverride } from "@/shared/storage/backend-api-address";

const API_BASE = "https://backend.test";

function createSession(
  patch: Partial<CloudflareOAuthSession> = {},
): CloudflareOAuthSession {
  return {
    schemaVersion: 1,
    apiBaseUrl: API_BASE,
    accessToken: "session-token",
    tokenType: "Bearer",
    expiresAt: "2099-01-01T00:00:00.000Z",
    account: {
      accountId: "account-1",
      username: "planner-user",
    },
    spaceId: "account-space-1",
    ...patch,
  };
}

afterEach(() => {
  localStorage.clear();
  vi.restoreAllMocks();
});

describe("cloudflare-oauth-session", () => {
  it("persists only a valid unexpired session bound to the active API base", () => {
    const session = writeCloudflareOAuthSession(createSession());

    expect(readCloudflareOAuthSession(API_BASE)).toEqual(session);
    expect(readCloudflareOAuthSession("https://another-backend.test")).toBeNull();
    expect(readCloudflareOAuthSession(API_BASE)).toBeNull();

    localStorage.setItem(
      CLOUDFLARE_OAUTH_SESSION_LOCAL_STORAGE_KEY,
      JSON.stringify(createSession({ expiresAt: "2020-01-01T00:00:00.000Z" })),
    );
    expect(readCloudflareOAuthSession(API_BASE)).toBeNull();
  });

  it("exchanges the callback code, resolves the account space, then writes once", async () => {
    const fetchImpl = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(Response.json({
        accessToken: "session-token",
        tokenType: "Bearer",
        expiresAt: "2099-01-01T00:00:00.000Z",
        account: {
          accountId: "account-1",
          username: "planner-user",
        },
      }))
      .mockResolvedValueOnce(Response.json({
        spaceId: "account-space-1",
        revision: "0",
        epoch: 1,
      }));

    await expect(completeCloudflareOAuthLogin(" callback-code ", {
      apiBaseUrl: `${API_BASE}/`,
      fetchImpl,
    })).resolves.toEqual(createSession());

    expect(fetchImpl).toHaveBeenNthCalledWith(1, `${API_BASE}/v1/oauth/session`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ code: "callback-code" }),
    });
    expect(fetchImpl).toHaveBeenNthCalledWith(2, `${API_BASE}/v1/sync/spaces/mine`, {
      headers: { authorization: "Bearer session-token" },
    });
    expect(readCloudflareOAuthSession(API_BASE)).toEqual(createSession());
  });

  it("does not persist a partial login when account space lookup fails", async () => {
    const fetchImpl = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(Response.json({
        accessToken: "session-token",
        tokenType: "Bearer",
        expiresAt: "2099-01-01T00:00:00.000Z",
        account: {
          accountId: "account-1",
          username: "planner-user",
        },
      }))
      .mockResolvedValueOnce(Response.json(
        { error: "unauthorized", message: "Unauthorized" },
        { status: 401 },
      ));

    await expect(completeCloudflareOAuthLogin("callback-code", {
      apiBaseUrl: API_BASE,
      fetchImpl,
    })).rejects.toThrow("Unauthorized");
    expect(readCloudflareOAuthSession(API_BASE)).toBeNull();
  });

  it("builds the authorize URL with the exact frontend callback and channel", () => {
    expect(createCloudflareOAuthAuthorizeUrl(
      "https://frontend.test/auth/callback",
      "01234567-89ab-4cde-8fab-0123456789ab",
      API_BASE,
    )).toBe(
      `${API_BASE}/v1/oauth/authorize?frontend_redirect_uri=https%3A%2F%2Ffrontend.test%2Fauth%2Fcallback&oauth_channel=01234567-89ab-4cde-8fab-0123456789ab`,
    );
  });

  it("notifies same-window writes, clears, cross-window storage and focus rereads", () => {
    writeBackendApiAddressOverride(API_BASE);
    const listener = vi.fn();
    const unsubscribe = subscribeToCloudflareOAuthSessionChanges(listener);
    const session = writeCloudflareOAuthSession(createSession());
    expect(listener).toHaveBeenLastCalledWith(session);

    globalThis.dispatchEvent(new StorageEvent("storage", {
      key: CLOUDFLARE_OAUTH_SESSION_LOCAL_STORAGE_KEY,
    }));
    expect(listener).toHaveBeenLastCalledWith(session);

    globalThis.dispatchEvent(new Event("focus"));
    expect(listener).toHaveBeenLastCalledWith(session);

    clearCloudflareOAuthSession();
    expect(listener).toHaveBeenLastCalledWith(null);
    unsubscribe();
  });
});
