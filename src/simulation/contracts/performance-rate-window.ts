const PERFORMANCE_RATE_WINDOW_MS = 1_000;

/**
 * 低成本的固定墙钟窗口计数器。
 * 调用方只提交已有的 delta 与计数，不在每个仿真 tick 内读取时钟。
 */
export class SimulationPerformanceRateWindow {
  private accumulatedUnits = 0;
  private accumulatedMs = 0;
  private lastCompletedRatePerSecond = 0;

  public get ratePerSecond(): number {
    return this.lastCompletedRatePerSecond;
  }

  public record(elapsedMs: number, units: number): void {
    if (Number.isFinite(units) && units > 0) {
      this.accumulatedUnits += units;
    }
    if (!Number.isFinite(elapsedMs) || elapsedMs <= 0) return;
    this.accumulatedMs += elapsedMs;
    if (this.accumulatedMs < PERFORMANCE_RATE_WINDOW_MS) return;

    this.lastCompletedRatePerSecond = Math.round(
      this.accumulatedUnits / (this.accumulatedMs / 1_000) * 10,
    ) / 10;
    this.accumulatedUnits = 0;
    this.accumulatedMs = 0;
  }

  public reset(): void {
    this.accumulatedUnits = 0;
    this.accumulatedMs = 0;
    this.lastCompletedRatePerSecond = 0;
  }
}
