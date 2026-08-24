// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  createCloudflareOAuthBroadcastChannelName,
  createCloudflareOAuthFrontendRedirectUri,
  isCloudflareOAuthAckMessage,
  parseCloudflareOAuthCallbackFragment,
  startCloudflareOAuthLogin,
  type CloudflareOAuthLoginError,
} from "@/shared/storage/cloudflare-oauth-browser-flow";
import { readCloudflareOAuthSession } from "@/shared/storage/cloudflare-oauth-session";

const API_BASE = "https://backend.test";
const FRONTEND_CALLBACK = "https://frontend.test/auth/callback";
const CHANNEL_A = "01234567-89ab-4cde-8fab-0123456789ab";
const CHANNEL_B = "fedcba98-7654-4abc-8def-fedcba987654";

class TestBroadcastChannel extends EventTarget {
  private static readonly groups = new Map<string, Set<TestBroadcastChannel>>();

  public readonly name: string;

  public constructor(name: string) {
    super();
    this.name = name;
    const group = TestBroadcastChannel.groups.get(name) ?? new Set();
    group.add(this);
    TestBroadcastChannel.groups.set(name, group);
  }

  public postMessage(value: unknown): void {
    const peers = [...(TestBroadcastChannel.groups.get(this.name) ?? [])];
    for (const peer of peers) {
      if (peer !== this) {
        peer.dispatchEvent(new MessageEvent("message", { data: value }));
      }
    }
  }

  public close(): void {
    const group = TestBroadcastChannel.groups.get(this.name);
    group?.delete(this);
    if (group?.size === 0) {
      TestBroadcastChannel.groups.delete(this.name);
    }
  }

  public static reset(): void {
    TestBroadcastChannel.groups.clear();
  }
}

beforeEach(() => {
  localStorage.clear();
  TestBroadcastChannel.reset();
  vi.stubGlobal("BroadcastChannel", TestBroadcastChannel);
  vi.stubGlobal("open", vi.fn(() => ({ opener: {} })));
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("cloudflare-oauth-browser-flow", () => {
  it("parses only one bounded callback result and derives the exact callback path", () => {
    expect(createCloudflareOAuthFrontendRedirectUri(
      "https://frontend.test/planner?debug=1#section",
    )).toBe(FRONTEND_CALLBACK);
    expect(parseCloudflareOAuthCallbackFragment(
      `#code=callback-code&oauth_channel=${CHANNEL_A}`,
    )).toEqual({
      type: "cloudflare-oauth-result",
      version: 1,
      oauthChannel: CHANNEL_A,
      code: "callback-code",
    });
    expect(parseCloudflareOAuthCallbackFragment(
      `#code=callback-code&error=denied&oauth_channel=${CHANNEL_A}`,
    )).toBeNull();
    expect(parseCloudflareOAuthCallbackFragment("#code=callback-code&oauth_channel=short"))
      .toBeNull();
  });

  it("starts listening before opening the popup", async () => {
    const fetchImpl = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(Response.json({
        accessToken: "session-token",
        tokenType: "Bearer",
        expiresAt: "2099-01-01T00:00:00.000Z",
        account: { accountId: "account-1", username: "planner-user" },
      }))
      .mockResolvedValueOnce(Response.json({
        spaceId: "account-space-1",
        revision: "0",
        epoch: 1,
      }));
    vi.stubGlobal("open", vi.fn(() => {
      const callbackChannel = new TestBroadcastChannel(
        createCloudflareOAuthBroadcastChannelName(CHANNEL_A),
      );
      callbackChannel.postMessage({
        type: "cloudflare-oauth-result",
        version: 1,
        oauthChannel: CHANNEL_A,
        code: "callback-code",
      });
      callbackChannel.close();
      return { opener: {} };
    }));

    await expect(startCloudflareOAuthLogin({
      apiBaseUrl: API_BASE,
      fetchImpl,
      frontendRedirectUri: FRONTEND_CALLBACK,
      oauthChannel: CHANNEL_A,
    })).resolves.toMatchObject({ account: { username: "planner-user" } });
  });

  it("ACKs the matching channel, exchanges the code in the original tab, then persists", async () => {
    const fetchImpl = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(Response.json({
        accessToken: "session-token",
        tokenType: "Bearer",
        expiresAt: "2099-01-01T00:00:00.000Z",
        account: { accountId: "account-1", username: "planner-user" },
      }))
      .mockResolvedValueOnce(Response.json({
        spaceId: "account-space-1",
        revision: "0",
        epoch: 1,
      }));
    const login = startCloudflareOAuthLogin({
      apiBaseUrl: API_BASE,
      fetchImpl,
      frontendRedirectUri: FRONTEND_CALLBACK,
      oauthChannel: CHANNEL_A,
    });
    const callbackChannel = new TestBroadcastChannel(
      createCloudflareOAuthBroadcastChannelName(CHANNEL_A),
    );
    const acknowledgements: unknown[] = [];
    callbackChannel.addEventListener("message", (event) => {
      acknowledgements.push((event as MessageEvent).data);
    });
    callbackChannel.postMessage({
      type: "cloudflare-oauth-result",
      version: 1,
      oauthChannel: CHANNEL_A,
      code: "callback-code",
    });

    await expect(login).resolves.toMatchObject({
      account: { username: "planner-user" },
      spaceId: "account-space-1",
    });
    expect(acknowledgements).toHaveLength(1);
    expect(isCloudflareOAuthAckMessage(acknowledgements[0], CHANNEL_A)).toBe(true);
    expect(readCloudflareOAuthSession(API_BASE)).toMatchObject({
      accessToken: "session-token",
    });
  });

  it("isolates concurrent logins by channel", async () => {
    const fetchImpl = vi.fn<typeof fetch>(async (input, init) => {
      const url = String(input);
      if (url.endsWith("/v1/oauth/session")) {
        const body = JSON.parse(String(init?.body)) as { code: string };
        return Response.json({
          accessToken: `token-${body.code}`,
          tokenType: "Bearer",
          expiresAt: "2099-01-01T00:00:00.000Z",
          account: { accountId: `account-${body.code}`, username: body.code },
        });
      }
      return Response.json({ spaceId: `space-${init?.headers?.toString()}` });
    });
    const loginA = startCloudflareOAuthLogin({
      apiBaseUrl: API_BASE,
      fetchImpl,
      frontendRedirectUri: FRONTEND_CALLBACK,
      oauthChannel: CHANNEL_A,
    });
    const loginB = startCloudflareOAuthLogin({
      apiBaseUrl: API_BASE,
      fetchImpl,
      frontendRedirectUri: FRONTEND_CALLBACK,
      oauthChannel: CHANNEL_B,
    });
    const callbackA = new TestBroadcastChannel(
      createCloudflareOAuthBroadcastChannelName(CHANNEL_A),
    );
    const callbackB = new TestBroadcastChannel(
      createCloudflareOAuthBroadcastChannelName(CHANNEL_B),
    );

    callbackB.postMessage({
      type: "cloudflare-oauth-result",
      version: 1,
      oauthChannel: CHANNEL_B,
      code: "user-b",
    });
    callbackA.postMessage({
      type: "cloudflare-oauth-result",
      version: 1,
      oauthChannel: CHANNEL_A,
      code: "user-a",
    });

    await expect(loginA).resolves.toMatchObject({ account: { username: "user-a" } });
    await expect(loginB).resolves.toMatchObject({ account: { username: "user-b" } });
  });

  it("ACKs a provider error without exchanging a session", async () => {
    const fetchImpl = vi.fn<typeof fetch>();
    const login = startCloudflareOAuthLogin({
      apiBaseUrl: API_BASE,
      fetchImpl,
      frontendRedirectUri: FRONTEND_CALLBACK,
      oauthChannel: CHANNEL_A,
    });
    const callbackChannel = new TestBroadcastChannel(
      createCloudflareOAuthBroadcastChannelName(CHANNEL_A),
    );
    const acknowledgements: unknown[] = [];
    callbackChannel.addEventListener("message", (event) => {
      acknowledgements.push((event as MessageEvent).data);
    });
    callbackChannel.postMessage({
      type: "cloudflare-oauth-result",
      version: 1,
      oauthChannel: CHANNEL_A,
      error: "access_denied",
    });

    await expect(login).rejects.toMatchObject({
      code: "provider_error",
    } satisfies Partial<CloudflareOAuthLoginError>);
    expect(acknowledgements).toHaveLength(1);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("times out when no matching callback responds", async () => {
    vi.useFakeTimers();
    const login = startCloudflareOAuthLogin({
      apiBaseUrl: API_BASE,
      frontendRedirectUri: FRONTEND_CALLBACK,
      oauthChannel: CHANNEL_A,
      timeoutMs: 50,
    });
    const rejection = expect(login).rejects.toMatchObject({
      code: "login_timeout",
    } satisfies Partial<CloudflareOAuthLoginError>);

    await vi.advanceTimersByTimeAsync(50);
    await rejection;
  });
});
