import { afterEach, describe, expect, it, vi } from "vitest";

import {
  createAppTelemetryController,
  createClientHeartbeatTelemetryPayload,
  createClientTelemetryUploadPayload,
  hashAppTelemetryUserIdentity,
  isLiveTelemetryBuild,
  type AppTelemetryTransport,
} from "@/app/telemetry";
import type { ScreenProfile } from "@/domain/app";

const MOBILE_SCREEN_PROFILE: ScreenProfile = {
  viewportWidth: 764,
  viewportHeight: 345,
  devicePixelRatio: 3.125,
  deviceClass: "mobile",
  screenShape: "landscape",
  aspectRatio: 2.214492753623188,
  hasTouch: true,
};

const DESKTOP_SCREEN_PROFILE: ScreenProfile = {
  viewportWidth: 2552,
  viewportHeight: 1315,
  devicePixelRatio: 1,
  deviceClass: "desktop",
  screenShape: "landscape",
  aspectRatio: 1.9406844106463879,
  hasTouch: true,
};

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("app telemetry controller", () => {
  it("uploads immediately and reads a fresh screen profile every 15 minutes", async () => {
    vi.useFakeTimers();
    let screenProfile = MOBILE_SCREEN_PROFILE;
    const upload = vi.fn<AppTelemetryTransport["upload"]>();
    const dispose = vi.fn();
    const controller = createAppTelemetryController({
      enabled: true,
      readScreenProfile: () => screenProfile,
      resolveUserIdentity: async () => ({
        kind: "account",
        code: "account-1",
      }),
      hashUserIdentity: async () => "a".repeat(32),
      readGameVersion: () => "v1.4.2",
      now: () => "2026-08-24T12:00:00.000Z",
      transportFactory: () => ({ upload, dispose }),
    });

    await flushPromises();
    expect(upload).toHaveBeenCalledTimes(1);
    expect(upload).toHaveBeenLastCalledWith({
      schemaVersion: 1,
      installIdHash: "a".repeat(32),
      trigger: "client-heartbeat",
      payload: expect.objectContaining({
        userIdentityKind: "account",
        userIdentityCode: "a".repeat(32),
        gameVersion: "v1.4.2",
        screenProfile: MOBILE_SCREEN_PROFILE,
      }),
    });

    screenProfile = DESKTOP_SCREEN_PROFILE;
    await vi.advanceTimersByTimeAsync(15 * 60 * 1000);
    expect(upload).toHaveBeenCalledTimes(2);
    expect(upload).toHaveBeenLastCalledWith(expect.objectContaining({
      payload: expect.objectContaining({
        screenProfile: DESKTOP_SCREEN_PROFILE,
      }),
    }));

    controller.dispose();
    expect(dispose).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(15 * 60 * 1000);
    expect(upload).toHaveBeenCalledTimes(2);
  });

  it("contains identity, version, time, and a detached screen profile snapshot", () => {
    const screenProfile = { ...MOBILE_SCREEN_PROFILE };
    const payload = createClientHeartbeatTelemetryPayload({
      identity: { kind: "installation", code: "b".repeat(32) },
      gameVersion: "  v1.4.2  ",
      screenProfile,
      createdAt: "2026-08-24T12:00:00.000Z",
    });

    screenProfile.viewportWidth = 999;
    expect(createClientTelemetryUploadPayload(payload)).toEqual({
      schemaVersion: 1,
      installIdHash: "b".repeat(32),
      trigger: "client-heartbeat",
      payload: {
        schemaVersion: 2,
        source: "industrial-planner",
        event: "client-heartbeat",
        createdAt: "2026-08-24T12:00:00.000Z",
        userIdentityKind: "installation",
        userIdentityCode: "b".repeat(32),
        gameVersion: "v1.4.2",
        screenProfile: MOBILE_SCREEN_PROFILE,
      },
    });
  });

  it("hashes the identity into the backend 32-character hexadecimal contract", async () => {
    const accountHash = await hashAppTelemetryUserIdentity({
      kind: "account",
      code: "identity-1",
    });
    const repeatedAccountHash = await hashAppTelemetryUserIdentity({
      kind: "account",
      code: "identity-1",
    });
    const installationHash = await hashAppTelemetryUserIdentity({
      kind: "installation",
      code: "identity-1",
    });

    expect(accountHash).toMatch(/^[a-f0-9]{32}$/);
    expect(repeatedAccountHash).toBe(accountHash);
    expect(installationHash).not.toBe(accountHash);
  });

  it("swallows collection and transport errors and retries on the next interval", async () => {
    vi.useFakeTimers();
    const upload = vi.fn<AppTelemetryTransport["upload"]>()
      .mockImplementationOnce(() => {
        throw new Error("postMessage failed");
      });
    let identityAttempt = 0;
    const controller = createAppTelemetryController({
      enabled: true,
      intervalMs: 100,
      readScreenProfile: () => MOBILE_SCREEN_PROFILE,
      resolveUserIdentity: async () => {
        identityAttempt += 1;
        if (identityAttempt === 1) {
          throw new Error("IndexedDB failed");
        }
        return { kind: "installation", code: "install-1" };
      },
      hashUserIdentity: async () => "b".repeat(32),
      transportFactory: () => ({ upload, dispose: () => undefined }),
    });

    await flushPromises();
    expect(upload).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(100);
    expect(upload).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(100);
    expect(upload).toHaveBeenCalledTimes(2);

    controller.dispose();
  });

  it("does not initialize telemetry outside a live backend build", async () => {
    const resolveUserIdentity = vi.fn(async () => ({
      kind: "installation" as const,
      code: "install-1",
    }));
    const transportFactory = vi.fn<() => AppTelemetryTransport>();
    const controller = createAppTelemetryController({
      enabled: false,
      readScreenProfile: () => MOBILE_SCREEN_PROFILE,
      resolveUserIdentity,
      transportFactory,
    });

    await flushPromises();
    expect(resolveUserIdentity).not.toHaveBeenCalled();
    expect(transportFactory).not.toHaveBeenCalled();
    controller.dispose();

    expect(isLiveTelemetryBuild("https://endfield-api.anonymous-test.top")).toBe(true);
    expect(isLiveTelemetryBuild("https://endfield-api.richetriotour.net")).toBe(false);
  });
});

async function flushPromises(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
}
