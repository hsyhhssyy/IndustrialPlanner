import {
  ENABLE_LOCAL_SYNC_TELEMETRY_UPLOAD,
} from "./sync-shadow-build-flags";
import {
  createLocalSyncOwnerScopeKey,
  ensureLocalSyncOwnerState,
} from "./sync-owner-storage";
import {
  createStableJsonHash,
  listLocalSyncCompactSummaries,
  listLocalSyncDiagnosticEvents,
} from "./sync-shadow-storage";
import {
  resolveBackendApiBaseUrl,
} from "./backend-api-address";

const LOCAL_SYNC_TELEMETRY_TIMEOUT_MS = 3000;
export const LOCAL_SYNC_TELEMETRY_MIN_INTERVAL_MS = 15 * 60 * 1000;
const LOCAL_SYNC_TELEMETRY_MAX_DIAGNOSTIC_EVENTS = 50;
const LOCAL_SYNC_TELEMETRY_MAX_COMPACT_SUMMARIES = 20;
const LOCAL_SYNC_TELEMETRY_MAX_DETAIL_STRING_LENGTH = 200;

let lastTelemetryUploadAttemptAt = 0;

export type LocalSyncTelemetryUploadStatus =
  | "disabled"
  | "skipped"
  | "unavailable"
  | "uploaded"
  | "failed";

export interface LocalSyncTelemetryUploadResult {
  readonly status: LocalSyncTelemetryUploadStatus;
  readonly healthStatus: number | null;
  readonly uploadStatus: number | null;
  readonly errorMessage: string | null;
}

export interface LocalSyncTelemetryPayload {
  readonly schemaVersion: 1;
  readonly source: "industrial-planner";
  readonly trigger: string;
  readonly createdAt: string;
  readonly appVersion: string;
  readonly userAgentHash: string | null;
  readonly installIdHash: string;
  readonly deviceIdHash: string;
  readonly ownerKind: "anonymous" | "account";
  readonly ownerScopeHash: string;
  readonly diagnostics: readonly LocalSyncTelemetryDiagnosticEvent[];
  readonly compactSummaries: readonly LocalSyncTelemetryCompactSummary[];
}

export interface LocalSyncTelemetryDiagnosticEvent {
  readonly severity: string;
  readonly category: string;
  readonly code: string;
  readonly assetType: string;
  readonly assetIdHash: string | null;
  readonly localSequence: number | null;
  readonly details: Record<string, string | number | boolean | null>;
  readonly createdAt: string;
}

export interface LocalSyncTelemetryCompactSummary {
  readonly assetType: "world-document";
  readonly assetIdHash: string;
  readonly fromLocalSequence: number;
  readonly toLocalSequence: number;
  readonly operationCount: number;
  readonly baseContentHash: string;
  readonly compactedAt: string;
}

export async function tryUploadLocalSyncTelemetry(options: {
  readonly trigger: string;
  readonly now?: string;
  readonly minIntervalMs?: number;
}): Promise<LocalSyncTelemetryUploadResult> {
  if (!ENABLE_LOCAL_SYNC_TELEMETRY_UPLOAD) {
    return createTelemetryUploadResult("disabled");
  }

  const timestamp = options.now ?? new Date().toISOString();
  const nowMs = timestampToNumber(timestamp);
  const minIntervalMs = options.minIntervalMs ?? LOCAL_SYNC_TELEMETRY_MIN_INTERVAL_MS;

  if (nowMs - lastTelemetryUploadAttemptAt < minIntervalMs) {
    return createTelemetryUploadResult("skipped");
  }

  lastTelemetryUploadAttemptAt = nowMs;

  try {
    const apiBaseUrl = resolveBackendApiBaseUrl();
    const healthResponse = await fetchWithTimeout(`${apiBaseUrl}/health`, {
      method: "GET",
      cache: "no-store",
      credentials: "omit",
    });

    if (healthResponse.status !== 200) {
      return createTelemetryUploadResult("unavailable", {
        healthStatus: healthResponse.status,
      });
    }

    const payload = await createLocalSyncTelemetryPayload({
      trigger: options.trigger,
      now: timestamp,
    });
    const uploadResponse = await fetchWithTimeout(`${apiBaseUrl}/v1/telemetry/sync-shadow`, {
      method: "POST",
      cache: "no-store",
      credentials: "omit",
      headers: {
        "content-type": "application/json",
      },
      keepalive: JSON.stringify(payload).length < 60_000,
      body: JSON.stringify(payload),
    });

    if (!uploadResponse.ok) {
      return createTelemetryUploadResult("failed", {
        healthStatus: healthResponse.status,
        uploadStatus: uploadResponse.status,
      });
    }

    return createTelemetryUploadResult("uploaded", {
      healthStatus: healthResponse.status,
      uploadStatus: uploadResponse.status,
    });
  } catch (error) {
    return createTelemetryUploadResult("unavailable", {
      errorMessage: error instanceof Error ? error.message : "Telemetry upload failed.",
    });
  }
}

export async function createLocalSyncTelemetryPayload(options: {
  readonly trigger: string;
  readonly now?: string;
}): Promise<LocalSyncTelemetryPayload> {
  const timestamp = options.now ?? new Date().toISOString();
  const ownerState = await ensureLocalSyncOwnerState({ now: timestamp });
  const owner = ownerState.activeOwner;
  const diagnosticEvents = await listLocalSyncDiagnosticEvents({ owner });
  const compactSummaries = await listLocalSyncCompactSummaries({ owner });

  return {
    schemaVersion: 1,
    source: "industrial-planner",
    trigger: options.trigger,
    createdAt: timestamp,
    appVersion: normalizeAppVersion(),
    userAgentHash: hashNullableString(resolveUserAgent()),
    installIdHash: createStableJsonHash(ownerState.installId),
    deviceIdHash: createStableJsonHash(ownerState.deviceId),
    ownerKind: owner.kind,
    ownerScopeHash: createStableJsonHash(createLocalSyncOwnerScopeKey(owner)),
    diagnostics: diagnosticEvents
      .slice(-LOCAL_SYNC_TELEMETRY_MAX_DIAGNOSTIC_EVENTS)
      .map((event) => ({
        severity: event.severity,
        category: event.category,
        code: event.code,
        assetType: event.assetType,
        assetIdHash: hashNullableString(event.assetId),
        localSequence: event.localSequence,
        details: sanitizeTelemetryDetails(event.details),
        createdAt: event.createdAt,
      })),
    compactSummaries: compactSummaries
      .slice(-LOCAL_SYNC_TELEMETRY_MAX_COMPACT_SUMMARIES)
      .map((summary) => ({
        assetType: summary.assetType,
        assetIdHash: createStableJsonHash(summary.assetId),
        fromLocalSequence: summary.fromLocalSequence,
        toLocalSequence: summary.toLocalSequence,
        operationCount: summary.operationCount,
        baseContentHash: summary.baseContentHash,
        compactedAt: summary.compactedAt,
      })),
  };
}

async function fetchWithTimeout(
  input: RequestInfo | URL,
  init: RequestInit,
): Promise<Response> {
  const controller = new AbortController();
  const timeoutId = globalThis.setTimeout(() => {
    controller.abort();
  }, LOCAL_SYNC_TELEMETRY_TIMEOUT_MS);

  try {
    return await fetch(input, {
      ...init,
      signal: controller.signal,
    });
  } finally {
    globalThis.clearTimeout(timeoutId);
  }
}

function createTelemetryUploadResult(
  status: LocalSyncTelemetryUploadStatus,
  options: {
    readonly healthStatus?: number | null;
    readonly uploadStatus?: number | null;
    readonly errorMessage?: string | null;
  } = {},
): LocalSyncTelemetryUploadResult {
  return {
    status,
    healthStatus: options.healthStatus ?? null,
    uploadStatus: options.uploadStatus ?? null,
    errorMessage: options.errorMessage ?? null,
  };
}

function sanitizeTelemetryDetails(
  details: Record<string, string | number | boolean | null>,
): Record<string, string | number | boolean | null> {
  return Object.fromEntries(
    Object.entries(details).map(([key, value]) => [
      key,
      typeof value === "string"
        ? value.slice(0, LOCAL_SYNC_TELEMETRY_MAX_DETAIL_STRING_LENGTH)
        : value,
    ]),
  );
}

function normalizeAppVersion(): string {
  const envValue = import.meta.env.VITE_APP_VERSION;
  if (typeof envValue === "string" && envValue.trim() !== "") {
    return envValue;
  }

  const windowValue = (globalThis as { window?: { __APP_VERSION__?: string } }).window
    ?.__APP_VERSION__;
  if (typeof windowValue === "string" && windowValue.trim() !== "") {
    return windowValue;
  }

  return "0.0.0.1";
}

function resolveUserAgent(): string | null {
  try {
    return typeof globalThis.navigator?.userAgent === "string"
      ? globalThis.navigator.userAgent
      : null;
  } catch {
    return null;
  }
}

function hashNullableString(value: string | null): string | null {
  return value === null ? null : createStableJsonHash(value);
}

function timestampToNumber(value: string): number {
  const timestamp = Date.parse(value);

  return Number.isFinite(timestamp) ? timestamp : 0;
}
