import type { PlannerGpuLayoutMetrics, PlannerLayoutBackend, PlannerLayoutBatch, PlannerLayoutBatchResult } from "./layout-backend";

interface LayoutReply {
  readonly result: PlannerLayoutBatchResult | null;
  readonly metrics: PlannerGpuLayoutMetrics;
}

/** 每个搜索只允许一个在途数值批次；端口只运输数值快照，不运输任务、Registry 或候选蓝图。 */
export class PlannerGpuLayoutPort implements PlannerLayoutBackend {
  private pending: ((reply: LayoutReply) => void) | null = null;
  private stopped = false;
  readonly metrics: PlannerGpuLayoutMetrics = { batches: 0, evaluations: 0, kernelMs: 0, wallMs: 0, uploadedBytes: 0 };

  constructor(private readonly port: MessagePort) {
    port.onmessage = (event: MessageEvent<LayoutReply>) => this.pending?.(event.data);
    port.onmessageerror = () => this.dispose("GPU 数值结果无法读取");
    port.start();
  }

  search(input: PlannerLayoutBatch): Promise<PlannerLayoutBatchResult | null> {
    if (this.stopped) return Promise.resolve(null);
    if (this.pending) throw new Error("GPU 数值通道已有在途批次");
    return new Promise(resolve => {
      const timer = setTimeout(() => this.dispose("GPU 数值队列超时"), 10_000);
      this.pending = reply => {
        clearTimeout(timer); this.pending = null;
        for (const key of ["batches", "evaluations", "kernelMs", "wallMs", "uploadedBytes"] as const) this.metrics[key] += reply.metrics[key];
        if (reply.metrics.fallbackReason) { this.metrics.fallbackReason = reply.metrics.fallbackReason; this.stopped = true; }
        resolve(reply.result);
      };
      // CPU 回退仍需原快照；结构化复制的队列最多保留每个通道一个小型数值批次。
      try { this.port.postMessage(input); }
      catch (error) { this.dispose(error instanceof Error ? error.message : String(error)); }
    });
  }

  dispose(reason = "GPU 数值通道已关闭"): void {
    this.stopped = true;
    this.pending?.({ result: null, metrics: { batches: 0, evaluations: 0, kernelMs: 0, wallMs: 0, uploadedBytes: 0, fallbackReason: reason } });
    this.port.close();
  }
}

/** 全池共用一个设备，公平串行执行；端口释放时尚未开始的批次立即丢弃。 */
export class PlannerGpuLayoutQueue {
  private readonly clients = new Map<number, { port: MessagePort; pending: boolean }>();
  private readonly queue: Array<{ id: number; input: PlannerLayoutBatch }> = [];
  private running = false;

  constructor(private readonly backend: PlannerLayoutBackend & { readonly metrics: PlannerGpuLayoutMetrics }) {}

  attach(id: number, port: MessagePort): void {
    this.detach(id);
    const client = { port, pending: false };
    this.clients.set(id, client);
    port.onmessage = (event: MessageEvent<PlannerLayoutBatch>) => {
      if (client.pending || this.clients.get(id) !== client) return;
      client.pending = true; this.queue.push({ id, input: event.data });
      void this.drain();
    };
    port.onmessageerror = () => this.detach(id);
    port.start();
  }

  detach(id: number): void {
    this.clients.get(id)?.port.close(); this.clients.delete(id);
    for (let index = this.queue.length - 1; index >= 0; index--) if (this.queue[index]!.id === id) this.queue.splice(index, 1);
  }

  private async drain(): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      while (this.queue.length) {
        const { id, input } = this.queue.shift()!;
        const client = this.clients.get(id);
        if (!client) continue;
        const before = { ...this.backend.metrics };
        let result: PlannerLayoutBatchResult | null = null, failure: string | undefined;
        try { result = await this.backend.search(input); }
        catch (error) { failure = error instanceof Error ? error.message : String(error); }
        if (this.clients.get(id) !== client) continue;
        const after = this.backend.metrics;
        const metrics: PlannerGpuLayoutMetrics = {
          batches: after.batches - before.batches, evaluations: after.evaluations - before.evaluations,
          kernelMs: after.kernelMs - before.kernelMs, wallMs: after.wallMs - before.wallMs,
          uploadedBytes: after.uploadedBytes - before.uploadedBytes,
          ...(failure || after.fallbackReason ? { fallbackReason: failure ?? after.fallbackReason } : {}),
        };
        client.pending = false;
        try { client.port.postMessage({ result, metrics } satisfies LayoutReply); }
        catch { this.detach(id); }
      }
    } finally { this.running = false; }
  }
}
