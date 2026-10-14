/** Host 每轮拥有一个 GPU 执行环境；搜索 Worker 通过可释放端口提交已有数值批次。 */
export class PlannerGpuLayoutPool {
  private readonly worker = new Worker(new URL("./gpu-layout-worker.ts", import.meta.url), { type: "module" });
  private nextId = 0;
  private stopped = false;

  constructor() {
    this.worker.addEventListener("error", () => this.dispose());
    this.worker.addEventListener("messageerror", () => this.dispose());
  }

  connect(): { port: MessagePort; release: () => void } | null {
    if (this.stopped) return null;
    const id = ++this.nextId, channel = new MessageChannel();
    try { this.worker.postMessage({ id, port: channel.port2 }, [channel.port2]); }
    catch { channel.port1.close(); channel.port2.close(); this.dispose(); return null; }
    let released = false;
    return { port: channel.port1, release: () => {
      if (released) return;
      released = true;
      if (!this.stopped) this.worker.postMessage({ id });
      channel.port1.close();
    } };
  }

  dispose(): void {
    if (this.stopped) return;
    this.stopped = true; this.worker.terminate();
  }
}
