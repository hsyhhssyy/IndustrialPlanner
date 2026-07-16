import { DEBUG_PERFORMANCE_STATISTICS_PERIOD_MS } from "@/shared/debug-performance-statistics";

export interface TimelineFrameApplyPerformanceWindow {
  startedAtMs: number;
  requestCount: number;
  appliedFrameCount: number;
  totalRequestMs: number;
  totalApplyMs: number;
  maxRequestMs: number;
  maxApplyMs: number;
}

export interface TimelineFrameApplyPerformanceReport {
  readonly windowMs: number;
  readonly requests: number;
  readonly appliedFrames: number;
  readonly notAppliedFrames: number;
  readonly avgRequestMs: number;
  readonly avgApplyMs: number;
  readonly maxRequestMs: number;
  readonly maxApplyMs: number;
}

export function createTimelineFrameApplyPerformanceWindow(
  startedAtMs: number,
): TimelineFrameApplyPerformanceWindow {
  return {
    startedAtMs,
    requestCount: 0,
    appliedFrameCount: 0,
    totalRequestMs: 0,
    totalApplyMs: 0,
    maxRequestMs: 0,
    maxApplyMs: 0,
  };
}

export function recordTimelineFrameApplyPerformance(
  window: TimelineFrameApplyPerformanceWindow,
  durationMs: number,
  applied: boolean,
): void {
  const normalizedDurationMs = Math.max(0, durationMs);
  window.requestCount += 1;
  window.totalRequestMs += normalizedDurationMs;
  window.maxRequestMs = Math.max(window.maxRequestMs, normalizedDurationMs);

  if (!applied) {
    return;
  }

  window.appliedFrameCount += 1;
  window.totalApplyMs += normalizedDurationMs;
  window.maxApplyMs = Math.max(window.maxApplyMs, normalizedDurationMs);
}

export function takeTimelineFrameApplyPerformanceReport(
  window: TimelineFrameApplyPerformanceWindow,
  nowMs: number,
): TimelineFrameApplyPerformanceReport | null {
  const report = window.requestCount === 0
    ? null
    : {
        windowMs: roundPerformanceValue(Math.max(0, nowMs - window.startedAtMs)),
        requests: window.requestCount,
        appliedFrames: window.appliedFrameCount,
        notAppliedFrames: window.requestCount - window.appliedFrameCount,
        avgRequestMs: averagePerformanceValue(window.totalRequestMs, window.requestCount),
        avgApplyMs: averagePerformanceValue(window.totalApplyMs, window.appliedFrameCount),
        maxRequestMs: roundPerformanceValue(window.maxRequestMs),
        maxApplyMs: roundPerformanceValue(window.maxApplyMs),
      };

  resetTimelineFrameApplyPerformanceWindow(window, nowMs);
  return report;
}

export function getTimelineFrameApplyPerformancePeriodMs(): number {
  return DEBUG_PERFORMANCE_STATISTICS_PERIOD_MS;
}

function resetTimelineFrameApplyPerformanceWindow(
  window: TimelineFrameApplyPerformanceWindow,
  startedAtMs: number,
): void {
  Object.assign(window, createTimelineFrameApplyPerformanceWindow(startedAtMs));
}

function averagePerformanceValue(total: number, count: number): number {
  return count === 0 ? 0 : roundPerformanceValue(total / count);
}

function roundPerformanceValue(value: number): number {
  return Math.round(value * 100) / 100;
}
