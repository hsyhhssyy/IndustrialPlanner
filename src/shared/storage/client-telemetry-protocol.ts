import type { ScreenProfile } from "@/domain/app";

export const CLIENT_TELEMETRY_INTERVAL_MS = 15 * 60 * 1000;

export type ClientTelemetryUserIdentityKind = "account" | "installation";

export interface ClientHeartbeatTelemetryPayload {
  readonly schemaVersion: 2;
  readonly source: "industrial-planner";
  readonly event: "client-heartbeat";
  readonly createdAt: string;
  readonly userIdentityKind: ClientTelemetryUserIdentityKind;
  readonly userIdentityCode: string;
  readonly gameVersion: string;
  readonly screenProfile: ScreenProfile;
}

export interface ClientTelemetryUploadPayload {
  readonly schemaVersion: 1;
  readonly installIdHash: string;
  readonly trigger: "client-heartbeat";
  readonly payload: ClientHeartbeatTelemetryPayload;
}

export interface ClientTelemetryWorkerRequest {
  readonly type: "upload-telemetry";
  readonly apiBaseUrl: string;
  readonly payload: ClientTelemetryUploadPayload;
}

export function isClientTelemetryWorkerRequest(
  value: unknown,
): value is ClientTelemetryWorkerRequest {
  if (!isRecord(value) || value.type !== "upload-telemetry") {
    return false;
  }

  return isNonEmptyString(value.apiBaseUrl)
    && isClientTelemetryUploadPayload(value.payload);
}

export function isClientTelemetryUploadPayload(
  value: unknown,
): value is ClientTelemetryUploadPayload {
  return isRecord(value)
    && value.schemaVersion === 1
    && isIdentityHash(value.installIdHash)
    && value.trigger === "client-heartbeat"
    && isClientHeartbeatTelemetryPayload(value.payload);
}

export function isClientHeartbeatTelemetryPayload(
  value: unknown,
): value is ClientHeartbeatTelemetryPayload {
  if (
    !isRecord(value)
    || value.schemaVersion !== 2
    || value.source !== "industrial-planner"
    || value.event !== "client-heartbeat"
    || !isTimestamp(value.createdAt)
    || !isClientTelemetryUserIdentityKind(value.userIdentityKind)
    || !isIdentityHash(value.userIdentityCode)
    || !isNonEmptyString(value.gameVersion)
    || !isScreenProfile(value.screenProfile)
  ) {
    return false;
  }

  return true;
}

function isScreenProfile(value: unknown): value is ScreenProfile {
  return isRecord(value)
    && isPositiveFiniteNumber(value.viewportWidth)
    && isPositiveFiniteNumber(value.viewportHeight)
    && isPositiveFiniteNumber(value.devicePixelRatio)
    && (
      value.deviceClass === "mobile"
      || value.deviceClass === "tablet"
      || value.deviceClass === "desktop"
    )
    && (
      value.screenShape === "portrait"
      || value.screenShape === "landscape"
      || value.screenShape === "square"
    )
    && isPositiveFiniteNumber(value.aspectRatio)
    && typeof value.hasTouch === "boolean";
}

function isClientTelemetryUserIdentityKind(
  value: unknown,
): value is ClientTelemetryUserIdentityKind {
  return value === "account" || value === "installation";
}

function isTimestamp(value: unknown): value is string {
  return typeof value === "string" && Number.isFinite(Date.parse(value));
}

function isPositiveFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value > 0;
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim() !== "";
}

function isIdentityHash(value: unknown): value is string {
  return typeof value === "string" && /^[a-f0-9]{32}$/i.test(value);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
