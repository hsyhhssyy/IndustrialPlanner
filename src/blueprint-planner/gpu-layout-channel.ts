// AI-CORRECTION 2026-10-26：保留物理通行规则、GPU 容量和背压修复；不恢复新搜索分支。
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
      // 2026-10-16：只预排两批，队列已满时本批立即由调用者在 CPU 执行，避免所有搜索 Worker 等待同一个 GPU。
      // 尚未执行的批次不计 GPU 次数，也不永久关闭通道；后续切片仍可复用同一设备。
      if (this.queue.length >= 2) {
        try { client.port.postMessage({ result: null,
          metrics: { batches: 0, evaluations: 0, kernelMs: 0, wallMs: 0, uploadedBytes: 0 } } satisfies LayoutReply); }
        catch { this.detach(id); }
        return;
      }
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

// AI-REMOVED 2026-10-26:
// Reason: 用户要求恢复 beta1/2 搜索内核，撤回其后搜索实现；保留业务正确性修复与公开任务接口。
// Trigger: 多版本对照后用户明确要求回退算法并使用 2S 渐增至 3S 初始面积。
// Evidence: .temp/eda/all-items/comparisons/default-area-20261026T015057315Z.json；回退前 SHA256 78e975b506dabd1c2166a29a2a47c00554bc02b5a861e3b6bdf69e8240e652d2。
// Replacement: src/blueprint-planner/gpu-layout-channel.ts 上方 beta1/2 活动实现
// Risk: 搜索策略、检查点及后续局部修复能力变化；原始未提交内容完整保留。
// Human Review: Required
// Original code (src/blueprint-planner/gpu-layout-channel.ts):
// import type { PlannerGpuLayoutMetrics, PlannerLayoutBackend, PlannerLayoutBatch, PlannerLayoutBatchResult } from "./layout-backend";
//
// interface LayoutReply {
//   readonly result: PlannerLayoutBatchResult | null;
//   readonly metrics: PlannerGpuLayoutMetrics;
// }
//
// /** 每个搜索只允许一个在途数值批次；端口只运输数值快照，不运输任务、Registry 或候选蓝图。 */
// export class PlannerGpuLayoutPort implements PlannerLayoutBackend {
//   private pending: ((reply: LayoutReply) => void) | null = null;
//   private stopped = false;
//   readonly metrics: PlannerGpuLayoutMetrics = { batches: 0, evaluations: 0, kernelMs: 0, wallMs: 0, uploadedBytes: 0 };
//
//   constructor(private readonly port: MessagePort) {
//     port.onmessage = (event: MessageEvent<LayoutReply>) => this.pending?.(event.data);
//     port.onmessageerror = () => this.dispose("GPU 数值结果无法读取");
//     port.start();
//   }
//
//   search(input: PlannerLayoutBatch): Promise<PlannerLayoutBatchResult | null> {
//     if (this.stopped) return Promise.resolve(null);
//     if (this.pending) throw new Error("GPU 数值通道已有在途批次");
//     return new Promise(resolve => {
//       const timer = setTimeout(() => this.dispose("GPU 数值队列超时"), 10_000);
//       this.pending = reply => {
//         clearTimeout(timer); this.pending = null;
//         for (const key of ["batches", "evaluations", "kernelMs", "wallMs", "uploadedBytes"] as const) this.metrics[key] += reply.metrics[key];
//         if (reply.metrics.fallbackReason) { this.metrics.fallbackReason = reply.metrics.fallbackReason; this.stopped = true; }
//         resolve(reply.result);
//       };
//       // CPU 回退仍需原快照；结构化复制的队列最多保留每个通道一个小型数值批次。
//       try { this.port.postMessage(input); }
//       catch (error) { this.dispose(error instanceof Error ? error.message : String(error)); }
//     });
//   }
//
//   dispose(reason = "GPU 数值通道已关闭"): void {
//     this.stopped = true;
//     this.pending?.({ result: null, metrics: { batches: 0, evaluations: 0, kernelMs: 0, wallMs: 0, uploadedBytes: 0, fallbackReason: reason } });
//     this.port.close();
//   }
// }
//
// /** 全池共用一个设备，公平串行执行；端口释放时尚未开始的批次立即丢弃。 */
// export class PlannerGpuLayoutQueue {
//   private readonly clients = new Map<number, { port: MessagePort; pending: boolean }>();
//   private readonly queue: Array<{ id: number; input: PlannerLayoutBatch }> = [];
//   private running = false;
//
//   constructor(private readonly backend: PlannerLayoutBackend & { readonly metrics: PlannerGpuLayoutMetrics }) {}
//
//   attach(id: number, port: MessagePort): void {
//     this.detach(id);
//     const client = { port, pending: false };
//     this.clients.set(id, client);
//     port.onmessage = (event: MessageEvent<PlannerLayoutBatch>) => {
//       if (client.pending || this.clients.get(id) !== client) return;
//       // 2026-10-16：只预排两批，队列已满时本批立即由调用者在 CPU 执行，避免所有搜索 Worker 等待同一个 GPU。
//       // 尚未执行的批次不计 GPU 次数，也不永久关闭通道；后续切片仍可复用同一设备。
//       if (this.queue.length >= 2) {
//         try { client.port.postMessage({ result: null,
//           metrics: { batches: 0, evaluations: 0, kernelMs: 0, wallMs: 0, uploadedBytes: 0 } } satisfies LayoutReply); }
//         catch { this.detach(id); }
//         return;
//       }
//       client.pending = true; this.queue.push({ id, input: event.data });
//       void this.drain();
//     };
//     port.onmessageerror = () => this.detach(id);
//     port.start();
//   }
//
//   detach(id: number): void {
//     this.clients.get(id)?.port.close(); this.clients.delete(id);
//     for (let index = this.queue.length - 1; index >= 0; index--) if (this.queue[index]!.id === id) this.queue.splice(index, 1);
//   }
//
//   private async drain(): Promise<void> {
//     if (this.running) return;
//     this.running = true;
//     try {
//       while (this.queue.length) {
//         const { id, input } = this.queue.shift()!;
//         const client = this.clients.get(id);
//         if (!client) continue;
//         const before = { ...this.backend.metrics };
//         let result: PlannerLayoutBatchResult | null = null, failure: string | undefined;
//         try { result = await this.backend.search(input); }
//         catch (error) { failure = error instanceof Error ? error.message : String(error); }
//         if (this.clients.get(id) !== client) continue;
//         const after = this.backend.metrics;
//         const metrics: PlannerGpuLayoutMetrics = {
//           batches: after.batches - before.batches, evaluations: after.evaluations - before.evaluations,
//           kernelMs: after.kernelMs - before.kernelMs, wallMs: after.wallMs - before.wallMs,
//           uploadedBytes: after.uploadedBytes - before.uploadedBytes,
//           ...(failure || after.fallbackReason ? { fallbackReason: failure ?? after.fallbackReason } : {}),
//         };
//         client.pending = false;
//         try { client.port.postMessage({ result, metrics } satisfies LayoutReply); }
//         catch { this.detach(id); }
//       }
//     } finally { this.running = false; }
//   }
// }
//
