export interface ActiveTimeWatchdogOptions {
  readonly slowWarningMs: number;
  readonly timeoutMs: number;
  readonly initiallyActive: boolean;
  readonly onSlow: (activeElapsedMs: number) => void;
  readonly onTimeout: (activeElapsedMs: number) => void;
}

/**
 * 只累计 active 状态下经过时间的请求看门狗。
 * 页面进入后台时由调用方暂停，避免浏览器冻结 Worker 或节流定时器造成误报。
 */
export class ActiveTimeWatchdog {
  private activeElapsedMs = 0;
  private activeStartedAtMs: number | null = null;
  private slowTimerId: ReturnType<typeof globalThis.setTimeout> | null = null;
  private timeoutTimerId: ReturnType<typeof globalThis.setTimeout> | null = null;
  private slowWarningEmitted = false;
  private completed = false;

  public constructor(private readonly options: ActiveTimeWatchdogOptions) {
    if (
      !Number.isFinite(options.slowWarningMs)
      || options.slowWarningMs < 0
      || !Number.isFinite(options.timeoutMs)
      || options.timeoutMs <= options.slowWarningMs
    ) {
      throw new Error("Active-time watchdog requires 0 <= slowWarningMs < timeoutMs.");
    }
    if (options.initiallyActive) {
      this.resume();
    }
  }

  public setActive(active: boolean): void {
    if (this.completed) {
      return;
    }
    if (active) {
      this.resume();
    } else {
      this.pause();
    }
  }

  public complete(): void {
    if (this.completed) {
      return;
    }
    this.captureActiveElapsed();
    this.completed = true;
    this.clearTimers();
  }

  private resume(): void {
    if (this.activeStartedAtMs !== null) {
      return;
    }
    this.activeStartedAtMs = Date.now();
    this.scheduleTimers();
  }

  private pause(): void {
    if (this.activeStartedAtMs === null) {
      return;
    }
    this.captureActiveElapsed();
    this.clearTimers();
  }

  private captureActiveElapsed(): void {
    if (this.activeStartedAtMs === null) {
      return;
    }
    this.activeElapsedMs += Math.max(0, Date.now() - this.activeStartedAtMs);
    this.activeStartedAtMs = null;
  }

  private currentActiveElapsedMs(): number {
    return this.activeElapsedMs + (
      this.activeStartedAtMs === null
        ? 0
        : Math.max(0, Date.now() - this.activeStartedAtMs)
    );
  }

  private scheduleTimers(): void {
    this.clearTimers();
    if (!this.slowWarningEmitted) {
      const remainingSlowMs = Math.max(
        0,
        this.options.slowWarningMs - this.activeElapsedMs,
      );
      this.slowTimerId = globalThis.setTimeout(() => {
        this.slowTimerId = null;
        if (this.completed || this.activeStartedAtMs === null) {
          return;
        }
        this.slowWarningEmitted = true;
        this.options.onSlow(this.currentActiveElapsedMs());
      }, remainingSlowMs);
    }

    const remainingTimeoutMs = Math.max(
      0,
      this.options.timeoutMs - this.activeElapsedMs,
    );
    this.timeoutTimerId = globalThis.setTimeout(() => {
      this.timeoutTimerId = null;
      if (this.completed || this.activeStartedAtMs === null) {
        return;
      }
      this.captureActiveElapsed();
      this.completed = true;
      this.clearTimers();
      this.options.onTimeout(this.activeElapsedMs);
    }, remainingTimeoutMs);
  }

  private clearTimers(): void {
    if (this.slowTimerId !== null) {
      globalThis.clearTimeout(this.slowTimerId);
      this.slowTimerId = null;
    }
    if (this.timeoutTimerId !== null) {
      globalThis.clearTimeout(this.timeoutTimerId);
      this.timeoutTimerId = null;
    }
  }
}
