/** 一个 Surface 的异步资源边界；等待首屏，并在后续加载结束时通知按需绘制。 */
export class RenderResourceScope {
  private readonly pending = new Set<Promise<unknown>>();
  private readonly observed = new WeakSet<Promise<unknown>>();
  private readonly failures: unknown[] = [];
  private disposed = false;
  private cancelWait: () => void = () => {};
  private readonly cancelled = new Promise<void>((resolve) => { this.cancelWait = resolve; });

  public constructor(private readonly invalidate: () => void) {}

  public track<T>(task: Promise<T>): Promise<T> {
    if (this.disposed || this.observed.has(task)) return task;
    this.observed.add(task);
    this.pending.add(task);
    void task.then(
      () => this.settled(task),
      (error: unknown) => { if (!this.disposed) this.failures.push(error); this.settled(task); },
    );
    return task;
  }

  public get loading(): boolean { return this.pending.size > 0; }

  public async waitForIdle(): Promise<void> {
    while (!this.disposed && this.pending.size > 0) {
      await Promise.race([Promise.allSettled([...this.pending]), this.cancelled]);
    }
    if (this.disposed) throw new DOMException("Scene view disposed", "AbortError");
    // Promise.reject(undefined) 也是失败，不能以错误值本身是否存在判定。
    if (this.failures.length > 0) throw this.failures.shift();
  }

  public dispose(): void {
    this.disposed = true;
    this.cancelWait();
    this.pending.clear();
    this.failures.length = 0;
  }

  private settled(task: Promise<unknown>): void {
    this.pending.delete(task);
    // 消费方的 then 会同步更新 Sprite；微任务末尾才唤醒外部驱动。
    if (!this.disposed) queueMicrotask(() => { if (!this.disposed) this.invalidate(); });
  }
}
