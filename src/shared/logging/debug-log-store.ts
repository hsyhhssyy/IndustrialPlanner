// AI-REMOVED 2026-08-08:
// Reason: 主线程内存 string[]、captureEnabled 冗余镜像和 useSyncExternalStore 推送链路已被统一日志 Collector 替代。
// Trigger: ST2-RQ-009 要求 debugMode 成为唯一总开关，所有有效 Worker 直连 SharedWorker 并持久化到 IndexedDB。
// Evidence: 全仓调用审计确认旧文件仅由 WorkbenchApp 与 DebugLogDialog 使用；两处均已迁移到新链路。
// Replacement: src/shared/logging/log-collector-client.ts、debug-logging-runtime.ts、diagnostic-header.ts。
// Risk: 旧的同步内存 snapshot API 不再可用；调用方已经迁移为异步查询。
// Human Review: Required
//
// Original code:
// type DebugConsoleMethod = "debug" | "info" | "warn" | "error" | "log";
//
// export interface DebugLogSnapshot {
//   readonly version: number;
//   readonly entryCount: number;
//   readonly text: string;
// }
//
// const DEBUG_CONSOLE_METHODS: readonly DebugConsoleMethod[] = [
//   "debug",
//   "info",
//   "warn",
//   "error",
//   "log",
// ];
// const MAX_DEBUG_LOG_ENTRIES = 400;
//
// type DebugLogListener = () => void;
//
// const listeners = new Set<DebugLogListener>();
// const originalConsoleMethods = new Map<DebugConsoleMethod, typeof console.log>();
// const logLines: string[] = [];
//
// let captureEnabled = false;
// let disposeGlobalExceptionCapture = () => {};
// let installCount = 0;
// let snapshotVersion = 0;
// let sessionStartTime = 0;
// let snapshot: DebugLogSnapshot = {
//   version: 0,
//   entryCount: 0,
//   text: "",
// };
//
// function emitSnapshot(): void {
//   snapshotVersion += 1;
//   snapshot = {
//     version: snapshotVersion,
//     entryCount: logLines.length,
//     text: logLines.join("\n"),
//   };
//
//   for (const listener of listeners) {
//     listener();
//   }
// }
//
// function clearLogLines(): void {
//   if (logLines.length === 0) {
//     return;
//   }
//
//   logLines.length = 0;
//   emitSnapshot();
// }
//
// function serializeUnknown(value: unknown, seen = new WeakSet<object>()): string {
//   if (typeof value === "string") {
//     return value;
//   }
//
//   if (value instanceof Error) {
//     return value.stack ?? `${value.name}: ${value.message}`;
//   }
//
//   if (
//     value === null
//     || typeof value === "number"
//     || typeof value === "boolean"
//     || typeof value === "bigint"
//     || typeof value === "undefined"
//   ) {
//     return String(value);
//   }
//
//   if (typeof value === "symbol") {
//     return value.toString();
//   }
//
//   if (typeof value === "function") {
//     return value.name === "" ? "[Function anonymous]" : `[Function ${value.name}]`;
//   }
//
//   if (typeof value !== "object") {
//     return String(value);
//   }
//
//   try {
//     return JSON.stringify(
//       value,
//       (_key, nestedValue) => {
//         if (typeof nestedValue === "object" && nestedValue !== null) {
//           if (seen.has(nestedValue)) {
//             return "[Circular]";
//           }
//
//           seen.add(nestedValue);
//         }
//
//         if (nestedValue instanceof Error) {
//           return nestedValue.stack ?? `${nestedValue.name}: ${nestedValue.message}`;
//         }
//
//         if (typeof nestedValue === "bigint") {
//           return nestedValue.toString();
//         }
//
//         if (typeof nestedValue === "symbol") {
//           return nestedValue.toString();
//         }
//
//         if (typeof nestedValue === "function") {
//           return nestedValue.name === ""
//             ? "[Function anonymous]"
//             : `[Function ${nestedValue.name}]`;
//         }
//
//         return nestedValue;
//       },
//       2,
//     ) ?? String(value);
//   } catch {
//     return Object.prototype.toString.call(value);
//   }
// }
//
// function formatLogLine(level: DebugConsoleMethod, args: unknown[]): string {
//   const serializedArguments = args.map((value) => serializeUnknown(value)).join(" ");
//
//   return `${new Date().toISOString()} [${level.toUpperCase()}] ${serializedArguments}`.trimEnd();
// }
//
// function appendConsoleLine(level: DebugConsoleMethod, args: unknown[]): void {
//   if (!captureEnabled) {
//     return;
//   }
//
//   logLines.push(formatLogLine(level, args));
//
//   if (logLines.length > MAX_DEBUG_LOG_ENTRIES) {
//     logLines.splice(0, logLines.length - MAX_DEBUG_LOG_ENTRIES);
//   }
//
//   emitSnapshot();
// }
//
// function readEventField(event: Event, key: string): unknown {
//   if (typeof event !== "object" || event === null || !(key in event)) {
//     return undefined;
//   }
//
//   return (event as unknown as Record<string, unknown>)[key];
// }
//
// function formatErrorLocation(filename: unknown, lineno: unknown, colno: unknown): string | undefined {
//   if (typeof filename !== "string" || filename.length === 0) {
//     return undefined;
//   }
//
//   const line = typeof lineno === "number" ? `:${lineno}` : "";
//   const column = typeof colno === "number" ? `:${colno}` : "";
//
//   return `${filename}${line}${column}`;
// }
//
// function appendGlobalErrorEvent(event: Event): void {
//   const message = readEventField(event, "message");
//   const error = readEventField(event, "error");
//
//   if (message === undefined && error === undefined) {
//     return;
//   }
//
//   const location = formatErrorLocation(
//     readEventField(event, "filename"),
//     readEventField(event, "lineno"),
//     readEventField(event, "colno"),
//   );
//   const args: unknown[] = ["[window.error]"];
//
//   if (typeof message === "string" && message.length > 0) {
//     args.push(message);
//   }
//
//   if (location !== undefined) {
//     args.push(`at ${location}`);
//   }
//
//   if (error !== undefined && error !== message) {
//     args.push(error);
//   }
//
//   appendConsoleLine("error", args);
// }
//
// function appendUnhandledRejectionEvent(event: Event): void {
//   const reason = readEventField(event, "reason");
//
//   appendConsoleLine("error", [
//     "[window.unhandledrejection]",
//     reason ?? "Promise rejected without a reason.",
//   ]);
// }
//
// function installGlobalExceptionCapture(): () => void {
//   if (typeof window === "undefined") {
//     return () => {};
//   }
//
//   const handleError = (event: Event) => {
//     appendGlobalErrorEvent(event);
//   };
//   const handleUnhandledRejection = (event: Event) => {
//     appendUnhandledRejectionEvent(event);
//   };
//
//   window.addEventListener("error", handleError);
//   window.addEventListener("unhandledrejection", handleUnhandledRejection);
//
//   return () => {
//     window.removeEventListener("error", handleError);
//     window.removeEventListener("unhandledrejection", handleUnhandledRejection);
//   };
// }
//
// function patchConsole(): void {
//   for (const method of DEBUG_CONSOLE_METHODS) {
//     if (originalConsoleMethods.has(method)) {
//       continue;
//     }
//
//     const originalMethod = console[method].bind(console);
//     originalConsoleMethods.set(method, originalMethod);
//     console[method] = ((...args: unknown[]) => {
//       originalMethod(...args);
//       appendConsoleLine(method, args);
//     }) as typeof console[typeof method];
//   }
// }
//
// function restoreConsole(): void {
//   for (const method of DEBUG_CONSOLE_METHODS) {
//     const originalMethod = originalConsoleMethods.get(method);
//
//     if (originalMethod === undefined) {
//       continue;
//     }
//
//     console[method] = originalMethod as typeof console[typeof method];
//   }
//
//   originalConsoleMethods.clear();
// }
//
// export function installDebugLogCapture(): () => void {
//   installCount += 1;
//
//   if (installCount === 1) {
//     sessionStartTime = Date.now();
//     patchConsole();
//     disposeGlobalExceptionCapture = installGlobalExceptionCapture();
//     clearLogLines();
//   }
//
//   return () => {
//     installCount = Math.max(0, installCount - 1);
//
//     if (installCount !== 0) {
//       return;
//     }
//
//     captureEnabled = false;
//     disposeGlobalExceptionCapture();
//     restoreConsole();
//   };
// }
//
// export function setDebugLogCaptureEnabled(enabled: boolean): void {
//   captureEnabled = enabled;
// }
//
// export function clearDebugLogEntries(): void {
//   clearLogLines();
// }
//
// export function subscribeDebugLogSnapshot(listener: DebugLogListener): () => void {
//   listeners.add(listener);
//
//   return () => {
//     listeners.delete(listener);
//   };
// }
//
// export function getDebugLogSnapshot(): DebugLogSnapshot {
//   return snapshot;
// }
//
// function formatSessionDuration(): string {
//   if (sessionStartTime === 0) {
//     return "(unknown)";
//   }
//
//   const elapsed = Math.max(0, Date.now() - sessionStartTime);
//   const seconds = Math.floor(elapsed / 1000) % 60;
//   const minutes = Math.floor(elapsed / (1000 * 60));
//
//   if (minutes > 0) {
//     return `${minutes} 分钟 ${seconds} 秒`;
//   }
//
//   return `${seconds} 秒`;
// }
//
// function safeNavigatorField(getter: () => string | undefined, fallback: string): string {
//   try {
//     return getter() ?? fallback;
//   } catch {
//     return fallback;
//   }
// }
//
// /** 构建诊断报告头，附加在导出日志文件的开头 */
// export function buildDiagnosticHeader(logLevel: string): string {
//   const lines: string[] = [];
//   const version =
//     (typeof window !== "undefined" && (window as unknown as Record<string, unknown>).__APP_VERSION__ as string | undefined)
//     ?? "(Dev)";
//
//   lines.push("=== IndustrialPlanner 诊断报告 ===");
//   lines.push(`版本: ${version}`);
//   lines.push(`用户代理: ${safeNavigatorField(() => navigator.userAgent, "(unknown)")}`);
//   lines.push(`屏幕: ${screen.width}×${screen.height} @ ${Math.round(window.devicePixelRatio * 100) / 100}x`);
//   lines.push(`平台: ${safeNavigatorField(() => (navigator as unknown as Record<string, unknown>).platform as string | undefined, "(unknown)")}`);
//   lines.push(`语言: ${safeNavigatorField(() => navigator.language, "(unknown)")}`);
//   lines.push(`日志级别: ${logLevel}`);
//   lines.push(`日志条数: ${snapshot.entryCount}`);
//   lines.push(`会话时长: ${formatSessionDuration()}`);
//   lines.push(`导出时间: ${new Date().toISOString()}`);
//   lines.push("================================");
//   lines.push("");
//
//   return lines.join("\n");
// }

export {};
