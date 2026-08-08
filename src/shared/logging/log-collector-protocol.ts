export const LOG_COLLECTOR_DATABASE_NAME = "industrial-planner-logs";
export const LOG_COLLECTOR_DATABASE_VERSION = 1;
export const LOG_COLLECTOR_STORE_NAME = "entries";
export const LOG_COLLECTOR_MAX_ENTRIES = 500;
export const LOG_COLLECTOR_MAX_MESSAGE_LENGTH = 64 * 1024;

export type DebugConsoleMethod = "debug" | "info" | "warn" | "error" | "log";

export type LogSource =
  | "main"
  | "simulation"
  | "timeline"
  | "cloudflare"
  | "webdav"
  | "sync-telemetry";

export interface LogEntryInput {
  readonly occurredAt: number;
  readonly level: DebugConsoleMethod;
  readonly source: LogSource;
  readonly instanceId: string;
  readonly message: string;
}

export interface PersistedLogEntry extends LogEntryInput {
  readonly id: number;
  readonly collectedAt: number;
}

export type LogCollectorRequest =
  | { readonly type: "log"; readonly entry: LogEntryInput }
  | {
      readonly type: "query";
      readonly requestId: number;
      readonly beforeId?: number;
      readonly limit: number;
    }
  | { readonly type: "clear"; readonly requestId: number };

export type LogCollectorResponse =
  | {
      readonly type: "query-result";
      readonly requestId: number;
      readonly entries: PersistedLogEntry[];
      readonly nextBeforeId?: number;
      readonly total: number;
    }
  | { readonly type: "cleared"; readonly requestId: number }
  | {
      readonly type: "collector-error";
      readonly requestId?: number;
      readonly code: string;
    };

const CONSOLE_METHODS: readonly DebugConsoleMethod[] = [
  "debug",
  "info",
  "warn",
  "error",
  "log",
];

const LOG_SOURCES: readonly LogSource[] = [
  "main",
  "simulation",
  "timeline",
  "cloudflare",
  "webdav",
  "sync-telemetry",
];

export function isLogEntryInput(value: unknown): value is LogEntryInput {
  if (typeof value !== "object" || value === null) {
    return false;
  }

  const candidate = value as Partial<LogEntryInput>;
  return typeof candidate.occurredAt === "number"
    && Number.isFinite(candidate.occurredAt)
    && typeof candidate.level === "string"
    && CONSOLE_METHODS.includes(candidate.level as DebugConsoleMethod)
    && typeof candidate.source === "string"
    && LOG_SOURCES.includes(candidate.source as LogSource)
    && typeof candidate.instanceId === "string"
    && candidate.instanceId.length > 0
    && typeof candidate.message === "string"
    && candidate.message.length <= LOG_COLLECTOR_MAX_MESSAGE_LENGTH;
}

export function isLogCollectorResponse(value: unknown): value is LogCollectorResponse {
  if (typeof value !== "object" || value === null || !("type" in value)) {
    return false;
  }

  const candidate = value as Record<string, unknown>;
  if (candidate.type === "query-result") {
    return isRequestId(candidate.requestId)
      && Array.isArray(candidate.entries)
      && candidate.entries.every(isPersistedLogEntry)
      && typeof candidate.total === "number"
      && Number.isInteger(candidate.total)
      && candidate.total >= 0
      && (candidate.nextBeforeId === undefined || isPositiveInteger(candidate.nextBeforeId));
  }

  if (candidate.type === "cleared") {
    return isRequestId(candidate.requestId);
  }

  return candidate.type === "collector-error"
    && typeof candidate.code === "string"
    && candidate.code.length > 0
    && (candidate.requestId === undefined || isRequestId(candidate.requestId));
}

function isPersistedLogEntry(value: unknown): value is PersistedLogEntry {
  return isLogEntryInput(value)
    && "id" in value
    && isPositiveInteger(value.id)
    && "collectedAt" in value
    && typeof value.collectedAt === "number"
    && Number.isFinite(value.collectedAt);
}

function isRequestId(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= 0;
}

function isPositiveInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value > 0;
}
