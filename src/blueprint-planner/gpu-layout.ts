// AI-CORRECTION 2026-10-26：保留物理通行规则、GPU 容量和背压修复；不恢复新搜索分支。
/// <reference types="@webgpu/types" />
import type { GridRotation } from "@/domain/shared/grid";
import type { PlannerGpuLayoutMetrics, PlannerLayoutBackend, PlannerLayoutBatch, PlannerLayoutBatchResult } from "./layout-backend";
import shader from "./layout-search.wgsl?raw";

/** 仅专用布局 Worker 拥有设备；CPU Worker 从同一调度器领取其他分片。 */
// AI-CORRECTION 2026-10-14：生产路径由独立数值 Worker 统一拥有设备，所有搜索通道经有界端口队列使用。
export class PlannerGpuLayout implements PlannerLayoutBackend {
  readonly metrics: PlannerGpuLayoutMetrics = { batches: 0, evaluations: 0, kernelMs: 0, wallMs: 0, uploadedBytes: 0 };
  private device: GPUDevice | null = null;
  private initialization: Promise<void> | null = null;
  private stopped = false;
  private readonly pipelines = new Map<string, GPUComputePipeline>();

  get available(): boolean { return !this.stopped; }

  async search(input: PlannerLayoutBatch): Promise<PlannerLayoutBatchResult | null> {
    if (this.stopped) return null;
    const started = performance.now();
    try {
      await (this.initialization ??= this.deadline(this.initialize(), 3000));
      if (!this.device || this.stopped) return null;
      const result = await this.deadline(this.run(input), 2000);
      this.metrics.batches++; this.metrics.evaluations += result.evaluations;
      this.metrics.kernelMs += result.kernelMs;
      return result;
    } catch (error) {
      this.stop(error instanceof Error ? error.message : String(error));
      return null;
    } finally { this.metrics.wallMs += performance.now() - started; }
  }

  private async initialize(): Promise<void> {
    const adapter = typeof navigator === "undefined" ? null : await navigator.gpu?.requestAdapter({ powerPreference: "high-performance" });
    if (!adapter || adapter.info.isFallbackAdapter) throw new Error("硬件 WebGPU 不可用");
    const device = await adapter.requestDevice({ requiredFeatures: adapter.features.has("timestamp-query") ? ["timestamp-query"] : [],
      requiredLimits: { maxComputeWorkgroupStorageSize: Math.min(32768, adapter.limits.maxComputeWorkgroupStorageSize) } });
    if (this.stopped) { device.destroy(); return; }
    this.device = device;
    void device.lost.then(info => this.stop(`WebGPU device lost: ${info.message}`));
    device.addEventListener("uncapturederror", event => this.stop(event.error.message));
  }

  private async run(input: PlannerLayoutBatch): Promise<PlannerLayoutBatchResult> {
    const device = this.device!, [nodes, , width, height, steps] = input.parameters;
    const capacity = Math.ceil(width! * height! / 128) * 128;
    const nodeCapacity = nodes! > 64 ? 128 : 64;
    const pipelineKey = `${nodeCapacity}/${capacity}`;
    if (capacity * 4 + nodeCapacity * 48 + 352 > device.limits.maxComputeWorkgroupStorageSize) {
      throw new Error("当前 GPU 工作组存储不足以容纳布局");
    }
    let pipeline = this.pipelines.get(pipelineKey);
    if (!pipeline) {
      const module = device.createShaderModule({ code: shader.replace("array<atomic<u32>,4900>", `array<atomic<u32>,${capacity}>`)
        .replaceAll("array<vec3<i32>,64>", `array<vec3<i32>,${nodeCapacity}>`)
        .replaceAll("array<i32,64>", `array<i32,${nodeCapacity}>`)
        .replaceAll("array<vec2<i32>,64>", `array<vec2<i32>,${nodeCapacity}>`) });
      pipeline = await device.createComputePipelineAsync({ layout: "auto", compute: { module, entryPoint: "main" } });
      this.pipelines.set(pipelineKey, pipeline);
    }
    if (this.stopped) throw new Error("GPU 已停止");
    const buffers: GPUBuffer[] = [];
    let query: GPUQuerySet | undefined;
    try {
      const allocate = (size: number, usage: GPUBufferUsageFlags) => {
        const buffer = device.createBuffer({ size: Math.max(4, size), usage }); buffers.push(buffer); return buffer;
      };
      const initial = new Int32Array(input.poses.length + (input.states?.length ?? 0));
      initial.set(input.poses); if (input.states) initial.set(input.states, input.poses.length);
      const parameters = input.parameters.slice(); parameters[9] = Math.floor((input.states?.length ?? 0) / (nodes! * 3 + 2));
      const inputs = [parameters, input.geometry, input.edges, input.overlaps, initial].map(array => {
        const buffer = allocate(array.byteLength, GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST);
        device.queue.writeBuffer(buffer, 0, array as Int32Array<ArrayBuffer>);
        this.metrics.uploadedBytes += array.byteLength;
        return buffer;
      });
      const stride = nodes! * 6 + 3, size = input.chains * stride * 4;
      const output = allocate(size, GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC);
      const readback = allocate(size, GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST);
      const binding = device.createBindGroup({ layout: pipeline.getBindGroupLayout(0), entries: [...inputs, output]
        .map((buffer, binding) => ({ binding, resource: { buffer } })) });
      query = device.features.has("timestamp-query") ? device.createQuerySet({ type: "timestamp", count: 2 }) : undefined;
      const resolved = query ? allocate(16, GPUBufferUsage.QUERY_RESOLVE | GPUBufferUsage.COPY_SRC) : undefined;
      const timing = query ? allocate(16, GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST) : undefined;
      const encoder = device.createCommandEncoder();
      const pass = encoder.beginComputePass(query ? { timestampWrites: { querySet: query, beginningOfPassWriteIndex: 0, endOfPassWriteIndex: 1 } } : {});
      pass.setPipeline(pipeline); pass.setBindGroup(0, binding); pass.dispatchWorkgroups(input.chains); pass.end();
      encoder.copyBufferToBuffer(output, 0, readback, 0, size);
      if (query) { encoder.resolveQuerySet(query, 0, 2, resolved!, 0); encoder.copyBufferToBuffer(resolved!, 0, timing!, 0, 16); }
      device.queue.submit([encoder.finish()]);
      await Promise.all([readback.mapAsync(GPUMapMode.READ), ...(timing ? [timing.mapAsync(GPUMapMode.READ)] : [])]);
      const data = new Int32Array(readback.getMappedRange());
      // 每批至多完整检查 16 个不同快照；代理分只排序，不允许直接把 GPU 的“可行”交付。
      const order = Array.from({ length: input.chains }, (_, index) => index).sort((a, b) => data[a * stride]! - data[b * stride]!);
      const states = new Int32Array(input.chains * (nodes! * 3 + 2));
      for (let chain = 0; chain < input.chains; chain++) states.set(data.subarray(chain * stride + nodes! * 3 + 1, (chain + 1) * stride), chain * (nodes! * 3 + 2));
      const scores: number[] = [];
      const seen = new Set<string>();
      const poses: Array<Array<{ x: number; y: number; rotation: GridRotation }>> = [];
      for (const chain of order) {
        const offset = chain * stride + 1, values = data.subarray(offset, offset + nodes! * 3), key = values.join(",");
        if (seen.has(key)) continue;
        seen.add(key); scores.push(data[chain * stride]!);
        poses.push(Array.from({ length: nodes! }, (_, index) => ({ x: values[index * 3]!, y: values[index * 3 + 1]!,
          rotation: (values[index * 3 + 2]! * 90) as GridRotation })));
        if (poses.length === 16) break;
      }
      let kernelMs = 0;
      if (timing) { const times = new BigUint64Array(timing.getMappedRange()); kernelMs = Number(times[1]! - times[0]!) / 1e6; }
      return { poses, states, scores, evaluations: input.chains * steps!, kernelMs };
    } finally { for (const buffer of buffers) buffer.destroy(); query?.destroy(); }
  }

  private async deadline<T>(operation: Promise<T>, milliseconds: number): Promise<T> {
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      return await Promise.race([operation, new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error("GPU 批量搜索超时")), milliseconds);
      })]);
    } finally { clearTimeout(timer); }
  }

  private stop(reason: string): void {
    if (this.stopped) return;
    this.stopped = true; this.metrics.fallbackReason = reason;
    this.device?.destroy(); this.device = null; this.pipelines.clear();
  }

  dispose(): void { this.stop("GPU 搜索器已关闭"); }
}

// AI-REMOVED 2026-10-26:
// Reason: 用户要求恢复 beta1/2 搜索内核，撤回其后搜索实现；保留业务正确性修复与公开任务接口。
// Trigger: 多版本对照后用户明确要求回退算法并使用 2S 渐增至 3S 初始面积。
// Evidence: .temp/eda/all-items/comparisons/default-area-20261026T015057315Z.json；回退前 SHA256 b354bccc2ac68086d93e1d4c283cb0de482b91aecb0c6fb33a9acab5266d1f51。
// Replacement: src/blueprint-planner/gpu-layout.ts 上方 beta1/2 活动实现
// Risk: 搜索策略、检查点及后续局部修复能力变化；原始未提交内容完整保留。
// Human Review: Required
// Original code (src/blueprint-planner/gpu-layout.ts):
// /// <reference types="@webgpu/types" />
// import type { GridRotation } from "@/domain/shared/grid";
// import type { PlannerGpuLayoutMetrics, PlannerLayoutBackend, PlannerLayoutBatch, PlannerLayoutBatchResult } from "./layout-backend";
// import shader from "./layout-search.wgsl?raw";
//
// /** 仅专用布局 Worker 拥有设备；CPU Worker 从同一调度器领取其他分片。 */
// // AI-CORRECTION 2026-10-14：生产路径由独立数值 Worker 统一拥有设备，所有搜索通道经有界端口队列使用。
// export class PlannerGpuLayout implements PlannerLayoutBackend {
//   readonly metrics: PlannerGpuLayoutMetrics = { batches: 0, evaluations: 0, kernelMs: 0, wallMs: 0, uploadedBytes: 0 };
//   private device: GPUDevice | null = null;
//   private initialization: Promise<void> | null = null;
//   private stopped = false;
//   private readonly pipelines = new Map<string, GPUComputePipeline>();
//
//   get available(): boolean { return !this.stopped; }
//
//   async search(input: PlannerLayoutBatch): Promise<PlannerLayoutBatchResult | null> {
//     if (this.stopped) return null;
//     const started = performance.now();
//     try {
//       await (this.initialization ??= this.deadline(this.initialize(), 3000));
//       if (!this.device || this.stopped) return null;
//       const result = await this.deadline(this.run(input), 2000);
//       this.metrics.batches++; this.metrics.evaluations += result.evaluations;
//       this.metrics.kernelMs += result.kernelMs;
//       return result;
//     } catch (error) {
//       this.stop(error instanceof Error ? error.message : String(error));
//       return null;
//     } finally { this.metrics.wallMs += performance.now() - started; }
//   }
//
//   private async initialize(): Promise<void> {
//     const adapter = typeof navigator === "undefined" ? null : await navigator.gpu?.requestAdapter({ powerPreference: "high-performance" });
//     if (!adapter || adapter.info.isFallbackAdapter) throw new Error("硬件 WebGPU 不可用");
//     const device = await adapter.requestDevice({ requiredFeatures: adapter.features.has("timestamp-query") ? ["timestamp-query"] : [],
//       requiredLimits: { maxComputeWorkgroupStorageSize: Math.min(32768, adapter.limits.maxComputeWorkgroupStorageSize) } });
//     if (this.stopped) { device.destroy(); return; }
//     this.device = device;
//     void device.lost.then(info => this.stop(`WebGPU device lost: ${info.message}`));
//     device.addEventListener("uncapturederror", event => this.stop(event.error.message));
//   }
//
//   private async run(input: PlannerLayoutBatch): Promise<PlannerLayoutBatchResult> {
//     const device = this.device!, [nodes, , width, height, steps] = input.parameters;
//     const capacity = Math.ceil(width! * height! / 128) * 128;
//     const nodeCapacity = nodes! > 64 ? 128 : 64;
//     const pipelineKey = `${nodeCapacity}/${capacity}`;
//     if (capacity * 4 + nodeCapacity * 48 + 352 > device.limits.maxComputeWorkgroupStorageSize) {
//       throw new Error("当前 GPU 工作组存储不足以容纳布局");
//     }
//     let pipeline = this.pipelines.get(pipelineKey);
//     if (!pipeline) {
//       const module = device.createShaderModule({ code: shader.replace("array<atomic<u32>,4900>", `array<atomic<u32>,${capacity}>`)
//         .replaceAll("array<vec3<i32>,64>", `array<vec3<i32>,${nodeCapacity}>`)
//         .replaceAll("array<i32,64>", `array<i32,${nodeCapacity}>`)
//         .replaceAll("array<vec2<i32>,64>", `array<vec2<i32>,${nodeCapacity}>`) });
//       pipeline = await device.createComputePipelineAsync({ layout: "auto", compute: { module, entryPoint: "main" } });
//       this.pipelines.set(pipelineKey, pipeline);
//     }
//     if (this.stopped) throw new Error("GPU 已停止");
//     const buffers: GPUBuffer[] = [];
//     let query: GPUQuerySet | undefined;
//     try {
//       const allocate = (size: number, usage: GPUBufferUsageFlags) => {
//         const buffer = device.createBuffer({ size: Math.max(4, size), usage }); buffers.push(buffer); return buffer;
//       };
//       const initial = new Int32Array(input.poses.length + (input.states?.length ?? 0));
//       initial.set(input.poses); if (input.states) initial.set(input.states, input.poses.length);
//       const parameters = input.parameters.slice(); parameters[9] = Math.floor((input.states?.length ?? 0) / (nodes! * 3 + 2));
//       const inputs = [parameters, input.geometry, input.edges, input.overlaps, initial].map(array => {
//         const buffer = allocate(array.byteLength, GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST);
//         device.queue.writeBuffer(buffer, 0, array as Int32Array<ArrayBuffer>);
//         this.metrics.uploadedBytes += array.byteLength;
//         return buffer;
//       });
//       const stride = nodes! * 6 + 3, size = input.chains * stride * 4;
//       const output = allocate(size, GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC);
//       const readback = allocate(size, GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST);
//       const binding = device.createBindGroup({ layout: pipeline.getBindGroupLayout(0), entries: [...inputs, output]
//         .map((buffer, binding) => ({ binding, resource: { buffer } })) });
//       query = device.features.has("timestamp-query") ? device.createQuerySet({ type: "timestamp", count: 2 }) : undefined;
//       const resolved = query ? allocate(16, GPUBufferUsage.QUERY_RESOLVE | GPUBufferUsage.COPY_SRC) : undefined;
//       const timing = query ? allocate(16, GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST) : undefined;
//       const encoder = device.createCommandEncoder();
//       const pass = encoder.beginComputePass(query ? { timestampWrites: { querySet: query, beginningOfPassWriteIndex: 0, endOfPassWriteIndex: 1 } } : {});
//       pass.setPipeline(pipeline); pass.setBindGroup(0, binding); pass.dispatchWorkgroups(input.chains); pass.end();
//       encoder.copyBufferToBuffer(output, 0, readback, 0, size);
//       if (query) { encoder.resolveQuerySet(query, 0, 2, resolved!, 0); encoder.copyBufferToBuffer(resolved!, 0, timing!, 0, 16); }
//       device.queue.submit([encoder.finish()]);
//       await Promise.all([readback.mapAsync(GPUMapMode.READ), ...(timing ? [timing.mapAsync(GPUMapMode.READ)] : [])]);
//       const data = new Int32Array(readback.getMappedRange());
//       // 每批至多完整检查 16 个不同快照；代理分只排序，不允许直接把 GPU 的“可行”交付。
//       const order = Array.from({ length: input.chains }, (_, index) => index).sort((a, b) => data[a * stride]! - data[b * stride]!);
//       const states = new Int32Array(input.chains * (nodes! * 3 + 2));
//       for (let chain = 0; chain < input.chains; chain++) states.set(data.subarray(chain * stride + nodes! * 3 + 1, (chain + 1) * stride), chain * (nodes! * 3 + 2));
//       const scores: number[] = [];
//       const seen = new Set<string>();
//       const poses: Array<Array<{ x: number; y: number; rotation: GridRotation }>> = [];
//       for (const chain of order) {
//         const offset = chain * stride + 1, values = data.subarray(offset, offset + nodes! * 3), key = values.join(",");
//         if (seen.has(key)) continue;
//         seen.add(key); scores.push(data[chain * stride]!);
//         poses.push(Array.from({ length: nodes! }, (_, index) => ({ x: values[index * 3]!, y: values[index * 3 + 1]!,
//           rotation: (values[index * 3 + 2]! * 90) as GridRotation })));
//         if (poses.length === 16) break;
//       }
//       let kernelMs = 0;
//       if (timing) { const times = new BigUint64Array(timing.getMappedRange()); kernelMs = Number(times[1]! - times[0]!) / 1e6; }
//       return { poses, states, scores, evaluations: input.chains * steps!, kernelMs };
//     } finally { for (const buffer of buffers) buffer.destroy(); query?.destroy(); }
//   }
//
//   private async deadline<T>(operation: Promise<T>, milliseconds: number): Promise<T> {
//     let timer: ReturnType<typeof setTimeout> | undefined;
//     try {
//       return await Promise.race([operation, new Promise<never>((_, reject) => {
//         timer = setTimeout(() => reject(new Error("GPU 批量搜索超时")), milliseconds);
//       })]);
//     } finally { clearTimeout(timer); }
//   }
//
//   private stop(reason: string): void {
//     if (this.stopped) return;
//     this.stopped = true; this.metrics.fallbackReason = reason;
//     this.device?.destroy(); this.device = null; this.pipelines.clear();
//   }
//
//   dispose(): void { this.stop("GPU 搜索器已关闭"); }
// }
//
