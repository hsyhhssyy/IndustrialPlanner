interface GlobalErrorTarget {
  addEventListener(type: string, listener: EventListener): void;
  removeEventListener(type: string, listener: EventListener): void;
}

export interface GlobalErrorCaptureOptions {
  readonly preventDefault?: boolean;
  readonly onCaptured?: (error: unknown) => void;
}

export function installGlobalErrorCapture(
  target: GlobalErrorTarget,
  options: GlobalErrorCaptureOptions = {},
): () => void {
  const handleError: EventListener = (event) => {
    const message = readEventField(event, "message");
    const error = readEventField(event, "error");
    const location = formatErrorLocation(
      readEventField(event, "filename"),
      readEventField(event, "lineno"),
      readEventField(event, "colno"),
    );

    if (message === undefined && error === undefined) {
      return;
    }

    console.error(
      "[global.error]",
      ...(message === undefined ? [] : [message]),
      ...(location === undefined ? [] : [`at ${location}`]),
      ...(error === undefined || error === message ? [] : [error]),
    );
    safelyNotify(options.onCaptured, error ?? message ?? "Unknown global error.");
    if (options.preventDefault) {
      event.preventDefault();
    }
  };
  const handleUnhandledRejection: EventListener = (event) => {
    const reason = readEventField(event, "reason") ?? "Promise rejected without a reason.";
    console.error(
      "[global.unhandledrejection]",
      reason,
    );
    safelyNotify(options.onCaptured, reason);
    if (options.preventDefault) {
      event.preventDefault();
    }
  };

  target.addEventListener("error", handleError);
  target.addEventListener("unhandledrejection", handleUnhandledRejection);

  return () => {
    target.removeEventListener("error", handleError);
    target.removeEventListener("unhandledrejection", handleUnhandledRejection);
  };
}

function safelyNotify(listener: ((error: unknown) => void) | undefined, error: unknown): void {
  try {
    listener?.(error);
  } catch {
    // 全局异常注入不得再次抛出异常。
  }
}

function readEventField(event: Event, key: string): unknown {
  if (!(key in event)) {
    return undefined;
  }

  return (event as unknown as Record<string, unknown>)[key];
}

function formatErrorLocation(
  filename: unknown,
  lineNumber: unknown,
  columnNumber: unknown,
): string | undefined {
  if (typeof filename !== "string" || filename.length === 0) {
    return undefined;
  }

  const line = typeof lineNumber === "number" ? `:${lineNumber}` : "";
  const column = typeof columnNumber === "number" ? `:${columnNumber}` : "";
  return `${filename}${line}${column}`;
}
