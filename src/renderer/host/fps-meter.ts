const DEFAULT_FPS_SAMPLE_WINDOW_MS = 1000;
const DEFAULT_FPS_DISPLAY_UPDATE_INTERVAL_MS = 250;

export interface FpsMeter {
  recordFrame: (now: number) => boolean;
  getLabel: () => string;
}

export interface CreateFpsMeterOptions {
  sampleWindowMs?: number;
  displayUpdateIntervalMs?: number;
}

function clampToPositiveInt(value: number, fallback: number): number {
  return Number.isFinite(value) && value > 0 ? Math.round(value) : fallback;
}

function pruneFrameTimes(frameTimes: number[], sampleWindowMs: number, now: number): void {
  while (frameTimes.length > 0 && now - frameTimes[0]! > sampleWindowMs) {
    frameTimes.shift();
  }
}

function calculateFramesPerSecond(frameTimes: number[]): number {
  if (frameTimes.length < 2) {
    return 0;
  }

  const first = frameTimes[0]!;
  const last = frameTimes[frameTimes.length - 1]!;
  const durationMs = last - first;

  if (durationMs <= 0) {
    return 0;
  }

  return Math.round(((frameTimes.length - 1) * 1000) / durationMs);
}

export function createFpsMeter(options: CreateFpsMeterOptions = {}): FpsMeter {
  const sampleWindowMs = clampToPositiveInt(
    options.sampleWindowMs ?? DEFAULT_FPS_SAMPLE_WINDOW_MS,
    DEFAULT_FPS_SAMPLE_WINDOW_MS,
  );
  const displayUpdateIntervalMs = clampToPositiveInt(
    options.displayUpdateIntervalMs ?? DEFAULT_FPS_DISPLAY_UPDATE_INTERVAL_MS,
    DEFAULT_FPS_DISPLAY_UPDATE_INTERVAL_MS,
  );
  const frameTimes: number[] = [];
  let displayedFramesPerSecond = 0;
  let lastDisplayUpdateAt: number | null = null;

  return {
    recordFrame(now) {
      frameTimes.push(now);
      pruneFrameTimes(frameTimes, sampleWindowMs, now);

      if (
        lastDisplayUpdateAt !== null &&
        now - lastDisplayUpdateAt < displayUpdateIntervalMs
      ) {
        return false;
      }

      lastDisplayUpdateAt = now;
      const nextFramesPerSecond = calculateFramesPerSecond(frameTimes);

      if (nextFramesPerSecond === displayedFramesPerSecond) {
        return false;
      }

      displayedFramesPerSecond = nextFramesPerSecond;
      return true;
    },
    getLabel() {
      return `FPS:${displayedFramesPerSecond}`;
    },
  };
}
