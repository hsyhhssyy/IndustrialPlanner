/// <reference types="@webgpu/types" />
import type { GridPoint } from "@/domain/shared/grid";
import { DEFAULT_GPU_TUNING, deriveGpuTuning, PlannerRoutingPerformance, type PlannerGpuTuning,
  type PlannerRoutingBackend, type PlannerRoutingMetrics, type PlannerRoutingProblem } from "./routing-backend";
import { ROUTE_BLOCKED, type PlannerRoutingSnapshot } from "./routing-grid";
import shader from "./routing-wave.wgsl?raw";

/** deriveGpuTuning 的默认超时倍率；回退时用它从当前预算反推"实测值"。 */
const RETUNE_FACTOR = 3;
/** 至少积累这么多次布线样本才重算边界，避免用一两次抖动改预算。 */
const RETUNE_MIN_SAMPLES = 12;
/** 重算次数上限：边界收敛后不再反复改动，保证长任务里预算稳定。 */
const MAX_RETUNES = 8;
/** 单条路径达到登记上限时，说明结果被截断；按此倍率放宽上限（受 deriveGpuTuning 的 4096 截断）。 */
const PATH_BOUND_GROWTH = 1.5;

/** 一个混合通道持有一个设备；每个 Worker 各持自己的设备与流水线，允许并发在途。 */
export class PlannerGpuRouting implements PlannerRoutingBackend {
  readonly metrics: PlannerRoutingMetrics = { gpuAttempts: 0, gpuAccepted: 0, cpuRoutes: 0, pairedSamples: 0,
    gpuMs: 0, cpuMs: 0, uploadedBytes: 0 };
  readonly performance = new PlannerRoutingPerformance();
  private device: GPUDevice | null = null;
  private pipeline: GPUComputePipeline | null = null;
  private buffers: GPUBuffer[] = [];
  private binding: GPUBindGroup | null = null;
  private snapshot: PlannerRoutingSnapshot | null = null;
  private initialized = false;
  private stopped = false;
  private adapter: { vendor?: string; architecture?: string; fallback?: boolean } | undefined;

  get tuning(): PlannerGpuTuning { return this.gpuTuning; }

  /** 适配器信息，供标定报告记录实测机型；未初始化时为 undefined。 */
  get adapterInfo(): { vendor?: string; architecture?: string; fallback?: boolean } | undefined {
    return this.adapter;
  }

  /**
   * 2026-10-06：标定专用的纯测量入口 —— 绕过 PlannerRoutingPerformance 的准入判定直接跑 GPU 布线。
   * 交叉点测量必须不受既有 bucket 决策影响，否则"GPU 只在规模已经很大时才跑"会把测量本身锁死。
   * `deadlineMs` 与 `maxPathSteps` 可单独放宽：产品内的保守值会把大栅格的测量直接判成超时或被截断。
   * 返回的是**稳态单位成本**：连跑 repetitions 次，扣除第一次（含一次性初始化与缓冲分配）后取平均。
   */
  async measure(problem: PlannerRoutingProblem, repetitions = 1, deadlineMs = this.gpuTuning.searchDeadlineMs,
    maxPathSteps?: number): Promise<{ cells: number; milliseconds: number } | null> {
    this.measurementFailure = undefined;
    this.traceHeader = undefined;
    if (maxPathSteps !== undefined) this.applyMeasurement({ maxPathSteps });
    await this.initialize();
    if (!this.device || !this.pipeline || this.stopped) {
      this.measurementFailure = this.metrics.fallbackReason ?? "WebGPU 不可用";
      return null;
    }
    let firstMs = 0;
    let totalMs = 0;
    let accepted = 0;
    let pathCells = 0;
    for (let attempt = 0; attempt < Math.max(1, repetitions); attempt++) {
      const started = performance.now();
      const cells = await this.attempt(problem, deadlineMs);
      if (cells === null) break;
      const milliseconds = performance.now() - started;
      if (attempt === 0) firstMs = milliseconds; else { totalMs += milliseconds; accepted++; }
      pathCells = cells.length;
    }
    if (accepted === 0) {
      // 只跑一次时（repetitions=1）没有可平均的样本，退回首次耗时。
      if (firstMs === 0) return null;
      return { cells: pathCells, milliseconds: firstMs };
    }
    return { cells: pathCells, milliseconds: totalMs / accepted };
  }

  /** 单次测量的包装：把超时与"没解出"都收敛成 null，并留下可读的失败原因。 */
  private async attempt(problem: PlannerRoutingProblem, deadlineMs: number): Promise<readonly GridPoint[] | null> {
    try {
      const cells = await this.deadline(this.search(problem), deadlineMs);
      if (cells === null) {
        const header = this.traceHeader;
        this.measurementFailure ??= `search 返回 null（着色器返回码 ${header ? header.code : "?"}、登记长度 ${header ? header.length : "?"}）`;
      }
      return cells;
    } catch (error) {
      this.measurementFailure = error instanceof Error ? error.message : String(error);
      return null;
    }
  }

  /** 最近一次标定测量的失败原因；成功时为 undefined。用于区分"超时"与"没解出"。 */
  measurementFailure: string | undefined;
  /** 标定期记录着色器返回的结果头（返回码/登记长度/当时的上限），定位"没搜到"还是"被截断"。 */
  traceHeader: { code: number; length: number; maxPathSteps: number } | undefined;

  /** 释放设备与缓冲；标定结束后必须调用，避免为一次测量长期占用 GPU 资源。 */
  dispose(): void { this.stop("已释放"); }

  /**
   * 用实测样本更新运行边界：单次布线 P90、初始化耗时、GPU 仍占优的最大格数、最长路径。
   * 未提供的字段保持现状；调用方可在标定后一次性写入。
   */
  applyMeasurement(measurement: { searchMsP90?: number; initMs?: number; maxProfitableCells?: number; maxPathSteps?: number }): void {
    this.gpuTuning = deriveGpuTuning({
      searchMsP90: measurement.searchMsP90 ?? this.p90SearchMs() ?? this.gpuTuning.searchDeadlineMs / RETUNE_FACTOR,
      initMs: measurement.initMs ?? this.initSamples.at(-1),
      maxProfitableCells: measurement.maxProfitableCells ?? this.performance.profitableCeiling() ?? this.gpuTuning.maxBoundsCells,
      maxPathSteps: measurement.maxPathSteps ?? this.gpuTuning.maxPathSteps,
    });
  }

  /**
   * 2026-10-06：GPU 的准入规模、超时和路径上限此前只有一次性写入入口，实际从不调用，
   * 等价于写死常量——低端 GPU 会被长超时拖住，高端 GPU 的可用规模又被保守值压住（实测 GPU 占用 < 5%）。
   * 现在每积累一批样本就按实测重算一次，运行边界随机器自己收敛，不需要机型常量。
   */
  private retune(): void {
    if (this.retunes >= MAX_RETUNES) return;
    const p90 = this.p90SearchMs();
    if (p90 === null) return;
    this.retunes++;
    this.applyMeasurement({ searchMsP90: p90 });
  }

  /** 单次布线耗时的 P90：取最近样本，避免早期慢样本永久拉高超时预算。 */
  private p90SearchMs(): number | null {
    if (this.samples.length < RETUNE_MIN_SAMPLES) return null;
    const sorted = this.samples.slice(-64).map(sample => sample.gpuMs).sort((left, right) => left - right);
    return sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * 0.9))]!;
  }

  private gpuTuning: PlannerGpuTuning = DEFAULT_GPU_TUNING;
  private readonly samples: Array<{ gpuMs: number }> = [];
  private readonly initSamples: number[] = [];
  private retunes = 0;

  async connect(problem: PlannerRoutingProblem, checkBudget: () => void, cpu: () => Promise<{ length: number; searchMs: number }>,
    validate: (cells: readonly GridPoint[]) => boolean, accept: (cells: readonly GridPoint[]) => boolean): Promise<number> {
    checkBudget();
    const size = problem.bounds.width * problem.bounds.height;
    const mode = this.performance.choose(size, performance.now());
    if (mode === "cpu" || this.stopped) return (await cpu()).length;
    await this.initialize();
    checkBudget();
    if (!this.device || !this.pipeline || this.stopped) return (await cpu()).length;
    const started = performance.now();
    let cells: readonly GridPoint[] | null = null;
    try {
      cells = await this.deadline(this.search(problem), this.gpuTuning.searchDeadlineMs);
      if (cells) this.samples.push({ gpuMs: performance.now() - started });
      if (cells && mode === "compare" && !validate(cells)) cells = null;
      this.retune();
    }
    catch (error) { this.stop(error instanceof Error ? error.message : String(error)); }
    const gpuMs = performance.now() - started;
    this.metrics.gpuMs += gpuMs;
    checkBudget();
    if (mode === "gpu" && cells && accept(cells)) { this.metrics.gpuAccepted++; return cells.length; }
    if (mode === "gpu") cells = null;
    const cpuStarted = performance.now();
    let measuredCpuMs: number | undefined;
    try { const result = await cpu(); measuredCpuMs = result.searchMs; return result.length; }
    finally {
      const cpuMs = measuredCpuMs ?? performance.now() - cpuStarted;
      this.metrics.cpuMs += cpuMs; this.metrics.cpuRoutes++;
      // 2026-10-06 订正：原实现用 max(gpuMs, cpuMs*2) 合成 CPU 基线，会在 GPU 没产出路径时
      // 系统性抬高 CPU 成本，使 choose() 误判「GPU 更快」而持续选 GPU 再超时。
      // 现在只记真实样本：GPU 没产出路径就不计入对照；GPU 在 gpu 模式下被拒时按已测时间记一次。
      if (cells) this.performance.record(size, cpuMs, gpuMs, performance.now());
      else if (mode === "gpu") this.performance.record(size, cpuMs, gpuMs * 2, performance.now());
      this.metrics.pairedSamples++;
    }
  }

  private async initialize(): Promise<void> {
    if (this.initialized) return;
    this.initialized = true;
    const initStarted = performance.now();
    try {
      await this.deadline((async () => {
        const adapter = await navigator.gpu?.requestAdapter({ powerPreference: "high-performance" });
        if (!adapter || adapter.info.isFallbackAdapter) throw new Error("硬件 WebGPU 不可用");
        this.adapter = { vendor: adapter.info.vendor, architecture: adapter.info.architecture,
          fallback: adapter.info.isFallbackAdapter };
        const device = await adapter.requestDevice();
        if (this.stopped) { device.destroy(); return; }
        this.device = device;
        void device.lost.then(info => this.stop(`WebGPU device lost: ${info.message}`));
        device.addEventListener("uncapturederror", event => this.stop(event.error.message));
        const module = device.createShaderModule({ code: shader });
        this.pipeline = await device.createComputePipelineAsync({ layout: "auto", compute: { module, entryPoint: "main" } });
      })(), this.gpuTuning.initDeadlineMs);
      this.initSamples.push(performance.now() - initStarted);
    } catch (error) { this.stop(error instanceof Error ? error.message : String(error)); }
  }

  private async deadline<T>(operation: Promise<T>, milliseconds: number): Promise<T> {
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      return await Promise.race([operation, new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error("WebGPU 计算超时，回退 CPU")), milliseconds);
      })]);
    } finally { clearTimeout(timer); }
  }

  private stop(reason: string): void {
    if (this.stopped) return;
    this.stopped = true; this.metrics.fallbackReason = reason;
    for (const buffer of this.buffers) buffer.destroy();
    this.buffers = []; this.binding = null; this.snapshot = null;
    this.device?.destroy(); this.device = null; this.pipeline = null;
  }

  private async search(problem: PlannerRoutingProblem): Promise<readonly GridPoint[] | null> {
    const { bounds, start, goal, kind } = problem;
    const index = (point: GridPoint) => (point.y - bounds.y) * bounds.width + point.x - bounds.x;
    const inside = (point: GridPoint) => Number.isSafeInteger(point.x) && Number.isSafeInteger(point.y)
      && point.x >= bounds.x && point.x < bounds.x + bounds.width && point.y >= bounds.y && point.y < bounds.y + bounds.height;
    if (!inside(start) || !inside(goal)) return null;
    const snapshot = problem.grid.dense(bounds), size = bounds.width * bounds.height;
    if ((snapshot.values[index(start) * 2 + kind]! | snapshot.values[index(goal) * 2 + kind]!) & ROUTE_BLOCKED) return null;
    const device = this.device!, pipeline = this.pipeline!;
    // 结果缓冲按标定出的最长路径动态分配，不再写死 514（512 步 + 头）。
    const resultWords = this.gpuTuning.maxPathSteps + 2;
    if (!this.binding || this.buffers[1]!.size < snapshot.values.byteLength || this.buffers[3]!.size !== resultWords * 4) {
      for (const buffer of this.buffers) buffer.destroy();
      this.buffers = [device.createBuffer({ size: 32, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST }),
        device.createBuffer({ size: snapshot.values.byteLength, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST }),
        device.createBuffer({ size: size * 16, usage: GPUBufferUsage.STORAGE }),
        device.createBuffer({ size: resultWords * 4, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC }),
        device.createBuffer({ size: resultWords * 4, usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST })];
      this.binding = device.createBindGroup({ layout: pipeline.getBindGroupLayout(0), entries:
        this.buffers.slice(0, 4).map((buffer, binding) => ({ binding, resource: { buffer } })) });
      this.snapshot = null;
    }
    const [parameters, grid, , output, readback] = this.buffers as [GPUBuffer, GPUBuffer, GPUBuffer, GPUBuffer, GPUBuffer];
    const first = this.snapshot === snapshot ? snapshot.firstDirty : 0;
    const last = this.snapshot === snapshot ? snapshot.lastDirty : snapshot.values.length;
    if (last > first) {
      device.queue.writeBuffer(grid, first * 4, snapshot.values, first, last - first);
      this.metrics.uploadedBytes += (last - first) * 4;
    }
    snapshot.firstDirty = snapshot.values.length; snapshot.lastDirty = 0; this.snapshot = snapshot;
    device.queue.writeBuffer(parameters, 0, new Uint32Array([bounds.width, bounds.height, index(start), index(goal),
      problem.startDirection, problem.finalDirection, kind, this.gpuTuning.maxPathSteps]));
    const encoder = device.createCommandEncoder(), pass = encoder.beginComputePass();
    pass.setPipeline(pipeline); pass.setBindGroup(0, this.binding); pass.dispatchWorkgroups(1); pass.end();
    encoder.copyBufferToBuffer(output, 0, readback, 0, readback.size);
    this.metrics.gpuAttempts++; device.queue.submit([encoder.finish()]);
    await readback.mapAsync(GPUMapMode.READ);
    try {
      const result = new Uint32Array(readback.getMappedRange());
      // 标定期记录原始返回头，用于区分"没搜索到"与"路径被截断"。
      this.traceHeader = { code: result[0]!, length: result[1] ?? 0, maxPathSteps: this.gpuTuning.maxPathSteps };
      if (result[0] !== 1 || !result[1]) return null;
      // 登记到上限说明路径被截断：放宽上限，让后续同类问题由 CPU 完整搜索而不是被静默丢弃。
      if (result[1] >= this.gpuTuning.maxPathSteps) {
        this.applyMeasurement({ maxPathSteps: Math.ceil(this.gpuTuning.maxPathSteps * PATH_BOUND_GROWTH) });
        return null;
      }
      const cells: GridPoint[] = [];
      for (let offset = result[1] + 1; offset >= 2; offset--) {
        const cell = result[offset]!;
        if (cell >= size) return null;
        cells.push({ x: bounds.x + cell % bounds.width, y: bounds.y + Math.floor(cell / bounds.width) });
      }
      return cells;
    } finally { readback.unmap(); }
  }
}
