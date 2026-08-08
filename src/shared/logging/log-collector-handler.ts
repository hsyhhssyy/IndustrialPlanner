import {
  isLogEntryInput,
  type LogCollectorRequest,
  type LogCollectorResponse,
} from "./log-collector-protocol";
import { LogCollectorStorage } from "./log-collector-storage";

export interface LogCollectorMessageHandler {
  handle(request: unknown): Promise<LogCollectorResponse | null>;
}

export interface LogCollectorStorageContract {
  append(entry: Parameters<LogCollectorStorage["append"]>[0]): ReturnType<LogCollectorStorage["append"]>;
  query(options: Parameters<LogCollectorStorage["query"]>[0]): ReturnType<LogCollectorStorage["query"]>;
  clear(): ReturnType<LogCollectorStorage["clear"]>;
}

export function createLogCollectorMessageHandler(
  storage: LogCollectorStorageContract = new LogCollectorStorage(),
): LogCollectorMessageHandler {
  return {
    async handle(request: unknown): Promise<LogCollectorResponse | null> {
      if (!isCollectorRequest(request)) {
        return null;
      }

      if (request.type === "log") {
        if (isLogEntryInput(request.entry)) {
          await storage.append(request.entry);
        }
        return null;
      }

      if (request.type === "clear") {
        await storage.clear();
        return { type: "cleared", requestId: request.requestId };
      }

      const result = await storage.query({
        ...(request.beforeId === undefined ? {} : { beforeId: request.beforeId }),
        limit: request.limit,
      });
      return {
        type: "query-result",
        requestId: request.requestId,
        entries: result.entries,
        ...(result.nextBeforeId === undefined ? {} : { nextBeforeId: result.nextBeforeId }),
        total: result.total,
      };
    },
  };
}

function isCollectorRequest(value: unknown): value is LogCollectorRequest {
  if (typeof value !== "object" || value === null || !("type" in value)) {
    return false;
  }

  const candidate = value as Record<string, unknown>;
  if (candidate.type === "log") {
    return "entry" in candidate;
  }

  if (candidate.type === "clear") {
    return typeof candidate.requestId === "number"
      && Number.isInteger(candidate.requestId)
      && candidate.requestId >= 0;
  }

  return candidate.type === "query"
    && typeof candidate.requestId === "number"
    && Number.isInteger(candidate.requestId)
    && candidate.requestId >= 0
    && typeof candidate.limit === "number"
    && Number.isFinite(candidate.limit)
    && candidate.limit > 0
    && (candidate.beforeId === undefined
      || (typeof candidate.beforeId === "number"
        && Number.isInteger(candidate.beforeId)
        && candidate.beforeId > 0));
}
