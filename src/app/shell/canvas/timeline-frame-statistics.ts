import type { SimulationTimelineState } from "@/domain/simulation/types/simulation-types";

export interface TimelineFrameStatisticsSample {
  readonly enabled: boolean;
  readonly availableFromTickNumber: number;
  readonly availableToTickNumber: number;
  readonly sampledAtMs: number;
}

export function createTimelineFrameStatisticsSample(
  timeline: SimulationTimelineState | null | undefined,
  sampledAtMs: number,
): TimelineFrameStatisticsSample {
  const enabled = timeline?.enabled === true;
  return {
    enabled,
    availableFromTickNumber: enabled
      ? Math.max(0, Math.floor(timeline.availableFromTickNumber))
      : 0,
    availableToTickNumber: enabled
      ? Math.max(0, Math.floor(timeline.availableToTickNumber))
      : 0,
    sampledAtMs,
  };
}

export function countSavedTimelineFrames(sample: TimelineFrameStatisticsSample): number {
  if (!sample.enabled) {
    return 0;
  }

  return Math.max(
    0,
    sample.availableToTickNumber - sample.availableFromTickNumber + 1,
  );
}

export function calculateTimelineFrameRate(
  previous: TimelineFrameStatisticsSample | null,
  current: TimelineFrameStatisticsSample,
): number {
  if (!current.enabled || previous?.enabled !== true) {
    return 0;
  }

  const elapsedMs = current.sampledAtMs - previous.sampledAtMs;
  const generatedFrames = current.availableToTickNumber - previous.availableToTickNumber;
  if (elapsedMs <= 0 || generatedFrames <= 0) {
    return 0;
  }

  return generatedFrames * 1000 / elapsedMs;
}
