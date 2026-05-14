type DebugConsoleMethod = "debug" | "info" | "warn" | "error" | "log";

export interface DebugLogSnapshot {
  readonly version: number;
  readonly entryCount: number;
  readonly text: string;
}

const DEBUG_CONSOLE_METHODS: readonly DebugConsoleMethod[] = [
  "debug",
  "info",
  "warn",
  "error",
  "log",
];
const MAX_DEBUG_LOG_ENTRIES = 400;

type DebugLogListener = () => void;

const listeners = new Set<DebugLogListener>();
const originalConsoleMethods = new Map<DebugConsoleMethod, typeof console.log>();
const logLines: string[] = [];

let captureEnabled = false;
let disposeGlobalExceptionCapture = () => {};
let installCount = 0;
let snapshotVersion = 0;
let snapshot: DebugLogSnapshot = {
  version: 0,
  entryCount: 0,
  text: "",
};

function emitSnapshot(): void {
  snapshotVersion += 1;
  snapshot = {
    version: snapshotVersion,
    entryCount: logLines.length,
    text: logLines.join("\n"),
  };

  for (const listener of listeners) {
    listener();
  }
}

function clearLogLines(): void {
  if (logLines.length === 0) {
    return;
  }

  logLines.length = 0;
  emitSnapshot();
}

function serializeUnknown(value: unknown, seen = new WeakSet<object>()): string {
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
    return value.name === "" ? "[Function anonymous]" : `[Function ${value.name}]`;
  }

  if (typeof value !== "object") {
    return String(value);
  }

  try {
    return JSON.stringify(
      value,
      (_key, nestedValue) => {
        if (typeof nestedValue === "object" && nestedValue !== null) {
          if (seen.has(nestedValue)) {
            return "[Circular]";
          }

          seen.add(nestedValue);
        }

        if (nestedValue instanceof Error) {
          return nestedValue.stack ?? `${nestedValue.name}: ${nestedValue.message}`;
        }

        if (typeof nestedValue === "bigint") {
          return nestedValue.toString();
        }

        if (typeof nestedValue === "symbol") {
          return nestedValue.toString();
        }

        if (typeof nestedValue === "function") {
          return nestedValue.name === ""
            ? "[Function anonymous]"
            : `[Function ${nestedValue.name}]`;
        }

        return nestedValue;
      },
      2,
    ) ?? String(value);
  } catch {
    return Object.prototype.toString.call(value);
  }
}

function formatLogLine(level: DebugConsoleMethod, args: unknown[]): string {
  const serializedArguments = args.map((value) => serializeUnknown(value)).join(" ");

  return `${new Date().toISOString()} [${level.toUpperCase()}] ${serializedArguments}`.trimEnd();
}

function appendConsoleLine(level: DebugConsoleMethod, args: unknown[]): void {
  if (!captureEnabled) {
    return;
  }

  logLines.push(formatLogLine(level, args));

  if (logLines.length > MAX_DEBUG_LOG_ENTRIES) {
    logLines.splice(0, logLines.length - MAX_DEBUG_LOG_ENTRIES);
  }

  emitSnapshot();
}

function readEventField(event: Event, key: string): unknown {
  if (typeof event !== "object" || event === null || !(key in event)) {
    return undefined;
  }

  return (event as unknown as Record<string, unknown>)[key];
}

function formatErrorLocation(filename: unknown, lineno: unknown, colno: unknown): string | undefined {
  if (typeof filename !== "string" || filename.length === 0) {
    return undefined;
  }

  const line = typeof lineno === "number" ? `:${lineno}` : "";
  const column = typeof colno === "number" ? `:${colno}` : "";

  return `${filename}${line}${column}`;
}

function appendGlobalErrorEvent(event: Event): void {
  const message = readEventField(event, "message");
  const error = readEventField(event, "error");

  if (message === undefined && error === undefined) {
    return;
  }

  const location = formatErrorLocation(
    readEventField(event, "filename"),
    readEventField(event, "lineno"),
    readEventField(event, "colno"),
  );
  const args: unknown[] = ["[window.error]"];

  if (typeof message === "string" && message.length > 0) {
    args.push(message);
  }

  if (location !== undefined) {
    args.push(`at ${location}`);
  }

  if (error !== undefined && error !== message) {
    args.push(error);
  }

  appendConsoleLine("error", args);
}

function appendUnhandledRejectionEvent(event: Event): void {
  const reason = readEventField(event, "reason");

  appendConsoleLine("error", [
    "[window.unhandledrejection]",
    reason ?? "Promise rejected without a reason.",
  ]);
}

function installGlobalExceptionCapture(): () => void {
  if (typeof window === "undefined") {
    return () => {};
  }

  const handleError = (event: Event) => {
    appendGlobalErrorEvent(event);
  };
  const handleUnhandledRejection = (event: Event) => {
    appendUnhandledRejectionEvent(event);
  };

  window.addEventListener("error", handleError);
  window.addEventListener("unhandledrejection", handleUnhandledRejection);

  return () => {
    window.removeEventListener("error", handleError);
    window.removeEventListener("unhandledrejection", handleUnhandledRejection);
  };
}

function patchConsole(): void {
  for (const method of DEBUG_CONSOLE_METHODS) {
    if (originalConsoleMethods.has(method)) {
      continue;
    }

    const originalMethod = console[method].bind(console);
    originalConsoleMethods.set(method, originalMethod);
    console[method] = ((...args: unknown[]) => {
      originalMethod(...args);
      appendConsoleLine(method, args);
    }) as typeof console[typeof method];
  }
}

function restoreConsole(): void {
  for (const method of DEBUG_CONSOLE_METHODS) {
    const originalMethod = originalConsoleMethods.get(method);

    if (originalMethod === undefined) {
      continue;
    }

    console[method] = originalMethod as typeof console[typeof method];
  }

  originalConsoleMethods.clear();
}

export function installDebugLogCapture(): () => void {
  installCount += 1;

  if (installCount === 1) {
    patchConsole();
    disposeGlobalExceptionCapture = installGlobalExceptionCapture();
    clearLogLines();
  }

  return () => {
    installCount = Math.max(0, installCount - 1);

    if (installCount !== 0) {
      return;
    }

    captureEnabled = false;
    disposeGlobalExceptionCapture();
    restoreConsole();
  };
}

export function setDebugLogCaptureEnabled(enabled: boolean): void {
  captureEnabled = enabled;
}

export function clearDebugLogEntries(): void {
  clearLogLines();
}

export function subscribeDebugLogSnapshot(listener: DebugLogListener): () => void {
  listeners.add(listener);

  return () => {
    listeners.delete(listener);
  };
}

export function getDebugLogSnapshot(): DebugLogSnapshot {
  return snapshot;
}