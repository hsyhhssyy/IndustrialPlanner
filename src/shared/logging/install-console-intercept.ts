import {
  LOG_COLLECTOR_MAX_MESSAGE_LENGTH,
  type DebugConsoleMethod,
  type LogEntryInput,
  type LogSource,
} from "./log-collector-protocol";

const CONSOLE_METHODS: readonly DebugConsoleMethod[] = [
  "debug",
  "info",
  "warn",
  "error",
  "log",
];
const TRUNCATION_SUFFIX = "… [truncated]";

interface ActiveConsoleIntercept {
  refCount: number;
  readonly restore: () => void;
}

let activeIntercept: ActiveConsoleIntercept | null = null;

export interface ConsoleInterceptOptions {
  readonly source: LogSource;
  readonly instanceId: string;
  readonly readEnabled: () => boolean;
  readonly send: (entry: LogEntryInput) => void;
}

export function installConsoleIntercept(options: ConsoleInterceptOptions): () => void {
  if (activeIntercept !== null) {
    activeIntercept.refCount += 1;
    return createRelease(activeIntercept);
  }

  const targetConsole = console as unknown as Record<
    DebugConsoleMethod,
    (...args: unknown[]) => void
  >;
  const originals = new Map<DebugConsoleMethod, (...args: unknown[]) => void>();
  const patchedMethods = new Map<DebugConsoleMethod, (...args: unknown[]) => void>();

  for (const method of CONSOLE_METHODS) {
    const original = targetConsole[method];
    const callOriginal = original.bind(console);
    originals.set(method, original);
    const patched = (...args: unknown[]) => {
      callOriginal(...args);

      if (!options.readEnabled()) {
        return;
      }

      try {
        options.send({
          occurredAt: Date.now(),
          level: method,
          source: options.source,
          instanceId: options.instanceId,
          message: truncateMessage(formatConsoleArguments(args)),
        });
      } catch {
        // 日志基础设施不得影响 console 的原始行为。
      }
    };
    patchedMethods.set(method, patched);
    targetConsole[method] = patched;
  }

  const installation: ActiveConsoleIntercept = {
    refCount: 1,
    restore: () => {
      for (const method of CONSOLE_METHODS) {
        const original = originals.get(method);
        if (original !== undefined && targetConsole[method] === patchedMethods.get(method)) {
          targetConsole[method] = original;
        }
      }
    },
  };
  activeIntercept = installation;
  return createRelease(installation);
}

function createRelease(installation: ActiveConsoleIntercept): () => void {
  let released = false;
  return () => {
    if (released) {
      return;
    }
    released = true;
    installation.refCount = Math.max(0, installation.refCount - 1);
    if (installation.refCount !== 0) {
      return;
    }
    installation.restore();
    if (activeIntercept === installation) {
      activeIntercept = null;
    }
  };
}

export function formatConsoleArguments(args: readonly unknown[]): string {
  return args.map((value) => serializeUnknown(value, new WeakSet<object>())).join(" ");
}

function serializeUnknown(value: unknown, seen: WeakSet<object>): string {
  if (typeof value === "string") {
    return value;
  }

  if (value instanceof Error) {
    return value.stack ?? `${value.name}: ${value.message}`;
  }

  if (
    value === null
    || typeof value === "number"
    || typeof value === "boolean"
    || typeof value === "bigint"
    || typeof value === "undefined"
  ) {
    return String(value);
  }

  if (typeof value === "symbol") {
    return value.toString();
  }

  if (typeof value === "function") {
    return value.name.length === 0 ? "[Function anonymous]" : `[Function ${value.name}]`;
  }

  if (typeof value !== "object") {
    return String(value);
  }

  try {
    return JSON.stringify(value, (_key, nestedValue: unknown) => {
      if (nestedValue instanceof Error) {
        return nestedValue.stack ?? `${nestedValue.name}: ${nestedValue.message}`;
      }
      if (typeof nestedValue === "bigint" || typeof nestedValue === "symbol") {
        return nestedValue.toString();
      }
      if (typeof nestedValue === "function") {
        return nestedValue.name.length === 0
          ? "[Function anonymous]"
          : `[Function ${nestedValue.name}]`;
      }
      if (typeof nestedValue === "object" && nestedValue !== null) {
        if (seen.has(nestedValue)) {
          return "[Circular]";
        }
        seen.add(nestedValue);
      }
      return nestedValue;
    }) ?? String(value);
  } catch {
    return Object.prototype.toString.call(value);
  }
}

function truncateMessage(message: string): string {
  if (message.length <= LOG_COLLECTOR_MAX_MESSAGE_LENGTH) {
    return message;
  }

  return `${message.slice(
    0,
    LOG_COLLECTOR_MAX_MESSAGE_LENGTH - TRUNCATION_SUFFIX.length,
  )}${TRUNCATION_SUFFIX}`;
}
