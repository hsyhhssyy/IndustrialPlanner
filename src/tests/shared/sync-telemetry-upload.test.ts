import { afterEach, describe, expect, it, vi } from "vitest";

import { ensureLocalSyncOwnerState } from "@/shared/storage/sync-owner-storage";
import {
  appendLocalSyncDiagnosticEvent,
  createStableJsonHash,
} from "@/shared/storage/sync-shadow-storage";
import {
  DEFAULT_BACKEND_API_BASE_URL,
  resolveBackendApiBaseUrl,
  writeBackendApiAddressOverride,
} from "@/shared/storage/backend-api-address";
import {
  createLocalSyncTelemetryPayload,
  tryUploadLocalSyncTelemetry,
} from "@/shared/storage/sync-telemetry-upload";
import { createFakeIndexedDbFactory } from "./fake-indexed-db";

afterEach(() => {
  localStorage.clear();
  vi.unstubAllGlobals();
});

describe("sync telemetry upload", () => {
  it("resolves the backend API address override and falls back to the default for whitespace", () => {
    expect(resolveBackendApiBaseUrl()).toBe(DEFAULT_BACKEND_API_BASE_URL);

    writeBackendApiAddressOverride(" https://debug.example.test/api/ ");
    expect(resolveBackendApiBaseUrl()).toBe("https://debug.example.test/api");

    writeBackendApiAddressOverride("localhost:8787/");
    expect(resolveBackendApiBaseUrl()).toBe("http://localhost:8787");

    writeBackendApiAddressOverride("   ");
    expect(resolveBackendApiBaseUrl()).toBe(DEFAULT_BACKEND_API_BASE_URL);
  });

  it("probes health and uploads sanitized telemetry when the backend is available", async () => {
    vi.stubGlobal("indexedDB", createFakeIndexedDbFactory());
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response("ok", { status: 200 }))
      .mockResolvedValueOnce(new Response(null, { status: 204 }));
    vi.stubGlobal("fetch", fetchMock);

    const ownerState = await ensureLocalSyncOwnerState({
      now: "2026-07-15T00:00:00.000Z",
    });
    await appendLocalSyncDiagnosticEvent({
      severity: "error",
      category: "replay",
      code: "replay.mismatch",
      assetType: "world-document",
      assetId: "document-raw-id",
      localSequence: 12,
      details: {
        expectedHash: "expected",
        actualHash: "actual",
        longMessage: "x".repeat(300),
      },
      now: "2026-07-15T00:01:00.000Z",
    });

    const result = await tryUploadLocalSyncTelemetry({
      trigger: "test",
      now: "2026-07-15T00:02:00.000Z",
      minIntervalMs: 0,
    });

    expect(result).toEqual({
      status: "uploaded",
      healthStatus: 200,
      uploadStatus: 204,
      errorMessage: null,
    });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls[0]?.[0]).toBe("https://endfield-api.amiyabot.com/health");
    expect(fetchMock.mock.calls[1]?.[0]).toBe(
      "https://endfield-api.amiyabot.com/v1/telemetry/sync-shadow",
    );

    const uploadInit = fetchMock.mock.calls[1]?.[1] as RequestInit;
    const payload = JSON.parse(String(uploadInit.body));

    expect(JSON.stringify(payload)).not.toContain("document-raw-id");
    expect(payload).toMatchObject({
      schemaVersion: 1,
      source: "industrial-planner",
      trigger: "test",
      installIdHash: createStableJsonHash(ownerState.installId),
      deviceIdHash: createStableJsonHash(ownerState.deviceId),
      ownerKind: "anonymous",
      diagnostics: [{
        severity: "error",
        category: "replay",
        code: "replay.mismatch",
        assetType: "world-document",
        assetIdHash: createStableJsonHash("document-raw-id"),
        localSequence: 12,
      }],
    });
    expect(payload.diagnostics[0].details.longMessage).toHaveLength(200);
  });

  it("uses the backend API address override for telemetry requests", async () => {
    vi.stubGlobal("indexedDB", createFakeIndexedDbFactory());
    writeBackendApiAddressOverride("https://debug.example.test/api/");
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response("ok", { status: 200 }))
      .mockResolvedValueOnce(new Response(null, { status: 204 }));
    vi.stubGlobal("fetch", fetchMock);

    const result = await tryUploadLocalSyncTelemetry({
      trigger: "test",
      now: "2026-07-15T00:02:30.000Z",
      minIntervalMs: 0,
    });

    expect(result).toMatchObject({
      status: "uploaded",
      healthStatus: 200,
      uploadStatus: 204,
    });
    expect(fetchMock.mock.calls[0]?.[0]).toBe("https://debug.example.test/api/health");
    expect(fetchMock.mock.calls[1]?.[0]).toBe(
      "https://debug.example.test/api/v1/telemetry/sync-shadow",
    );
  });

  it("does not upload telemetry when health is not 200", async () => {
    vi.stubGlobal("indexedDB", createFakeIndexedDbFactory());
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response("unavailable", { status: 503 }));
    vi.stubGlobal("fetch", fetchMock);

    const result = await tryUploadLocalSyncTelemetry({
      trigger: "test",
      now: "2026-07-15T00:03:00.000Z",
      minIntervalMs: 0,
    });

    expect(result).toEqual({
      status: "unavailable",
      healthStatus: 503,
      uploadStatus: null,
      errorMessage: null,
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("throttles health checks and telemetry uploads by default", async () => {
    vi.stubGlobal("indexedDB", createFakeIndexedDbFactory());
    const fetchMock = vi.fn()
      .mockResolvedValue(new Response("ok", { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      tryUploadLocalSyncTelemetry({
        trigger: "first",
        now: "2026-07-16T00:00:00.000Z",
      }),
    ).resolves.toMatchObject({
      status: "uploaded",
    });

    await expect(
      tryUploadLocalSyncTelemetry({
        trigger: "second",
        now: "2026-07-16T00:14:00.000Z",
      }),
    ).resolves.toEqual({
      status: "skipped",
      healthStatus: null,
      uploadStatus: null,
      errorMessage: null,
    });

    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("builds telemetry payloads without raw owner ids", async () => {
    vi.stubGlobal("indexedDB", createFakeIndexedDbFactory());

    const ownerState = await ensureLocalSyncOwnerState({
      now: "2026-07-15T00:00:00.000Z",
    });
    const payload = await createLocalSyncTelemetryPayload({
      trigger: "test",
      now: "2026-07-15T00:04:00.000Z",
    });

    expect(JSON.stringify(payload)).not.toContain(ownerState.installId);
    expect(JSON.stringify(payload)).not.toContain(ownerState.deviceId);
    expect(JSON.stringify(payload)).not.toContain(ownerState.anonymousDatasetId);
    expect(payload.ownerScopeHash).toBe(createStableJsonHash(
      `anonymous:${ownerState.anonymousDatasetId}`,
    ));
  });
});
