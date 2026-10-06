/**
 * 主线程（或 Node 主线程）事件循环延迟采样：定时器"应到"与"实际到"的差值。
 * 2026-10-06：浏览器容量探针与 Node 容量探针必须用同一口径判断"算力已满导致调度跟不上"，
 * 否则两条曲线不可比；原先该采样器只存在于 Node 探针里，浏览器探针恒返回 0。
 */
export class LoopLagSampler {
  private expected: number;
  private worst = 0;
  private readonly timer: ReturnType<typeof setInterval>;

  constructor(private readonly intervalMs = 200) {
    this.expected = performance.now() + intervalMs;
    this.timer = setInterval(() => {
      const now = performance.now();
      this.worst = Math.max(this.worst, Math.max(0, now - this.expected));
      this.expected = now + this.intervalMs;
    }, intervalMs);
  }

  stop(): number { clearInterval(this.timer); return this.worst; }
}
