import { describe, expect, it } from "vitest";

import {
  isClientHeartbeatTelemetryPayload,
  isClientTelemetryUploadPayload,
  isClientTelemetryWorkerRequest,
  type ClientHeartbeatTelemetryPayload,
} from "@/shared/storage/client-telemetry-protocol";

function createPayload(): ClientHeartbeatTelemetryPayload {
  return {
    schemaVersion: 2,
    source: "industrial-planner",
    event: "client-heartbeat",
    createdAt: "2026-08-24T12:00:00.000Z",
    userIdentityKind: "account",
    userIdentityCode: "a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6",
    gameVersion: "v1.4.2",
    screenProfile: {
      viewportWidth: 764,
      viewportHeight: 345,
      devicePixelRatio: 3.125,
      deviceClass: "mobile",
      screenShape: "landscape",
      aspectRatio: 2.214492753623188,
      hasTouch: true,
    },
  };
}

describe("client telemetry protocol", () => {
  it("accepts the versioned client heartbeat payload and worker request", () => {
    const heartbeat = createPayload();
    const payload = {
      schemaVersion: 1,
      installIdHash: heartbeat.userIdentityCode,
      trigger: "client-heartbeat",
      payload: heartbeat,
    } as const;

    expect(isClientHeartbeatTelemetryPayload(heartbeat)).toBe(true);
    expect(isClientTelemetryUploadPayload(payload)).toBe(true);
    expect(JSON.stringify(payload).length).toBeLessThanOrEqual(1024);
    expect(isClientTelemetryWorkerRequest({
      type: "upload-telemetry",
      apiBaseUrl: "https://endfield-api.anonymous-test.top",
      payload,
    })).toBe(true);
  });

  it("rejects legacy, unidentified, or invalid screen profile payloads", () => {
    const payload = createPayload();

    expect(isClientHeartbeatTelemetryPayload({
      ...payload,
      schemaVersion: 1,
    })).toBe(false);
    expect(isClientHeartbeatTelemetryPayload({
      ...payload,
      userIdentityCode: "account-1",
    })).toBe(false);
    expect(isClientHeartbeatTelemetryPayload({
      ...payload,
      screenProfile: {
        ...payload.screenProfile,
        viewportWidth: 0,
      },
    })).toBe(false);
    expect(isClientTelemetryUploadPayload({
      schemaVersion: 2,
      installIdHash: payload.userIdentityCode,
      trigger: "client-heartbeat",
      payload,
    })).toBe(false);
  });
});
