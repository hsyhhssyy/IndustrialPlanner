export interface DiagnosticHeaderOptions {
  readonly entryCount: number;
  readonly logLevel: string;
  readonly sessionStartedAt: number;
}

export function buildDiagnosticHeader(options: DiagnosticHeaderOptions): string {
  const lines: string[] = [];
  const version = typeof window === "undefined"
    ? "(unknown)"
    : (window as unknown as Record<string, unknown>).__APP_VERSION__ as string | undefined
      ?? "(Dev)";

  lines.push("=== IndustrialPlanner 诊断报告 ===");
  lines.push(`版本: ${version}`);
  lines.push(`用户代理: ${safeNavigatorField(() => navigator.userAgent, "(unknown)")}`);
  if (typeof window !== "undefined" && typeof screen !== "undefined") {
    lines.push(`屏幕: ${screen.width}×${screen.height} @ ${Math.round(window.devicePixelRatio * 100) / 100}x`);
  }
  lines.push(`平台: ${safeNavigatorField(
    () => (navigator as unknown as Record<string, unknown>).platform as string | undefined,
    "(unknown)",
  )}`);
  lines.push(`语言: ${safeNavigatorField(() => navigator.language, "(unknown)")}`);
  lines.push(`日志级别: ${options.logLevel}`);
  lines.push(`日志条数: ${options.entryCount}`);
  lines.push(`会话时长: ${formatSessionDuration(options.sessionStartedAt)}`);
  lines.push(`导出时间: ${new Date().toISOString()}`);
  lines.push("================================");
  lines.push("");
  return lines.join("\n");
}

function formatSessionDuration(sessionStartedAt: number): string {
  const elapsed = Math.max(0, Date.now() - sessionStartedAt);
  const seconds = Math.floor(elapsed / 1000) % 60;
  const minutes = Math.floor(elapsed / (1000 * 60));
  return minutes > 0 ? `${minutes} 分钟 ${seconds} 秒` : `${seconds} 秒`;
}

function safeNavigatorField(getter: () => string | undefined, fallback: string): string {
  try {
    return typeof navigator === "undefined" ? fallback : getter() ?? fallback;
  } catch {
    return fallback;
  }
}
