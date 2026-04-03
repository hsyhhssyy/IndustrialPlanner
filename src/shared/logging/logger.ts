export const LOG_LEVELS = [
  "silent",
  "error",
  "warn",
  "info",
  "debug",
] as const;

export type LogLevel = (typeof LOG_LEVELS)[number];

export interface Logger {
  error: (message: string, context?: unknown) => void;
  warn: (message: string, context?: unknown) => void;
  info: (message: string, context?: unknown) => void;
  debug: (message: string, context?: unknown) => void;
}

const LOG_LEVEL_PRIORITY: Record<LogLevel, number> = {
  silent: 0,
  error: 1,
  warn: 2,
  info: 3,
  debug: 4,
};

const DEFAULT_LOG_LEVEL: LogLevel = "warn";
const LOGGER_PREFIX = "industrial-planner";

let activeLogLevel: LogLevel = DEFAULT_LOG_LEVEL;

export function isLogLevel(value: unknown): value is LogLevel {
  return (
    typeof value === "string" &&
    LOG_LEVELS.includes(value as LogLevel)
  );
}

export function getLogLevel(): LogLevel {
  return activeLogLevel;
}

export function setLogLevel(
  level: LogLevel,
  options: {
    announce?: boolean;
  } = {},
): LogLevel {
  const previousLevel = activeLogLevel;
  activeLogLevel = level;

  if (options.announce && previousLevel !== level) {
    console.info(
      `[${LOGGER_PREFIX}] Log level changed from "${previousLevel}" to "${level}".`,
    );
  }

  return activeLogLevel;
}

function shouldLog(level: Exclude<LogLevel, "silent">): boolean {
  return LOG_LEVEL_PRIORITY[level] <= LOG_LEVEL_PRIORITY[activeLogLevel];
}

function formatMessage(scope: string, message: string): string {
  return `[${LOGGER_PREFIX}:${scope}] ${message}`;
}

function emit(
  level: Exclude<LogLevel, "silent">,
  scope: string,
  message: string,
  context?: unknown,
): void {
  if (!shouldLog(level)) {
    return;
  }

  const formattedMessage = formatMessage(scope, message);

  if (context === undefined) {
    console[level](formattedMessage);
    return;
  }

  console[level](formattedMessage, context);
}

export function createLogger(scope: string): Logger {
  return {
    error: (message, context) => emit("error", scope, message, context),
    warn: (message, context) => emit("warn", scope, message, context),
    info: (message, context) => emit("info", scope, message, context),
    debug: (message, context) => emit("debug", scope, message, context),
  };
}

export const DEFAULT_WORKBENCH_LOG_LEVEL = DEFAULT_LOG_LEVEL;
