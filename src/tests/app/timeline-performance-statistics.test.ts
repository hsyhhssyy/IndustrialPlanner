import { describe, expect, it } from "vitest";

import {
  createTimelineFrameApplyPerformanceWindow,
  getTimelineFrameApplyPerformancePeriodMs,
  recordTimelineFrameApplyPerformance,
  takeTimelineFrameApplyPerformanceReport,
} from "@/app/shell/dialogs/timeline-performance-statistics";
import {
  calculateTimelineFrameRate,
  countSavedTimelineFrames,
  createTimelineFrameStatisticsSample,
} from "@/app/shell/canvas/timeline-frame-statistics";
import { DEBUG_PERFORMANCE_STATISTICS_PERIOD_MS } from "@/shared/debug-performance-statistics";

describe("timeline performance statistics", () => {
  it("averages completed frame applications inside the shared performance period", () => {
    const window = createTimelineFrameApplyPerformanceWindow(100);

    recordTimelineFrameApplyPerformance(window, 20, true);
    recordTimelineFrameApplyPerformance(window, 40, false);
    recordTimelineFrameApplyPerformance(window, 60, true);

    expect(getTimelineFrameApplyPerformancePeriodMs()).toBe(
      DEBUG_PERFORMANCE_STATISTICS_PERIOD_MS,
    );
    expect(takeTimelineFrameApplyPerformanceReport(window, 10_100)).toEqual({
      windowMs: 10_000,
      requests: 3,
      appliedFrames: 2,
      notAppliedFrames: 1,
      avgRequestMs: 40,
      avgApplyMs: 40,
      maxRequestMs: 60,
      maxApplyMs: 60,
    });
    expect(takeTimelineFrameApplyPerformanceReport(window, 20_100)).toBeNull();
  });

  it("counts retained timeline frames and calculates generation speed from the tail delta", () => {
    const previous = createTimelineFrameStatisticsSample({
      enabled: true,
      tickDurationSeconds: 0.5,
      rulerDurationSeconds: 300,
      windowStartTickNumber: 0,
      cursorTickNumber: 0,
      availableFromTickNumber: 100,
      availableToTickNumber: 199,
      marks: [],
      isSeeking: false,
    }, 1_000);
    const current = createTimelineFrameStatisticsSample({
      enabled: true,
      tickDurationSeconds: 0.5,
      rulerDurationSeconds: 300,
      windowStartTickNumber: 0,
      cursorTickNumber: 0,
      availableFromTickNumber: 150,
      availableToTickNumber: 249,
      marks: [],
      isSeeking: false,
    }, 1_500);

    expect(countSavedTimelineFrames(current)).toBe(100);
    expect(calculateTimelineFrameRate(previous, current)).toBe(100);
  });

  it("reports zero speed while the timeline is disabled or its generated tail moves backward", () => {
    const disabled = createTimelineFrameStatisticsSample(undefined, 1_000);
    const enabled = createTimelineFrameStatisticsSample({
      enabled: true,
      tickDurationSeconds: 0.5,
      rulerDurationSeconds: 300,
      windowStartTickNumber: 0,
      cursorTickNumber: 0,
      availableFromTickNumber: 0,
      availableToTickNumber: 10,
      marks: [],
      isSeeking: false,
    }, 2_000);
    const rebased = {
      ...enabled,
      availableToTickNumber: 5,
      sampledAtMs: 3_000,
    };

    expect(countSavedTimelineFrames(disabled)).toBe(0);
    expect(calculateTimelineFrameRate(disabled, enabled)).toBe(0);
    expect(calculateTimelineFrameRate(enabled, rebased)).toBe(0);
  });
});
