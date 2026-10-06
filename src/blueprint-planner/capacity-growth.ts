/**
 * 逐步上探测量：从保守起点开始，一档一档加，直到收益不再值得为止。
 * 2026-10-06：并发/验证/GPU 的容量上限都不允许写死常量——每台机器的核数、内存带宽、GPU 差异很大，
 * 统一改为「从保守值上探 + 增益判定」，由机器自己给出上限。
 */
export interface StepUpPoint {
  readonly value: number;
  readonly throughput: number;
  /** 相对上一档的吞吐倍数；首档为 1。 */
  readonly gain: number;
}

export interface StepUpOptions {
  /** 保守起点，必须 >= 1。 */
  readonly start: number;
  /** 安全阀：用户可覆盖的硬上限，只用于防止无界试探，不作为容量结论。 */
  readonly ceiling: number;
  /** 单档最大步进。 */
  readonly maxStep?: number;
  /** 吞吐增益低于该值即认为到达平台。 */
  readonly minGain?: number;
  readonly signal?: AbortSignal;
  readonly onProgress?: (message: string) => void;
}

export interface StepUpResult {
  readonly points: readonly StepUpPoint[];
  /** 取平台前一档；从未增长时取起点。 */
  readonly best: number;
  readonly reason: string;
}

/** 纯函数：按增益序列取平台前一档，供测量循环与测试共用。 */
export function pickPlateau(points: readonly StepUpPoint[], start: number, minGain: number): { best: number; reason: string } {
  if (points.length === 0) return { best: Math.max(1, start), reason: "未测得有效档位，取保守起点" };
  // 首档没有可比基准，它的 gain=1 不是衰减信号：跳过它，否则永远只能取起点。
  let best = Math.max(1, start);
  for (let index = 0; index < points.length; index++) {
    const point = points[index]!;
    if (index > 0 && point.gain < minGain) {
      return { best, reason: `${point.value} 档增益仅 ${point.gain.toFixed(2)}×，取上一档 ${best}` };
    }
    best = point.value;
  }
  return { best, reason: `已测到 ${points.at(-1)!.value} 档仍持续增益，取该档` };
}

/**
 * 下一档取值：按 1.5 倍增长（1→2→3→4→6→9→13…），到安全阀截断。
 * 用 1.5 倍而不是倍增或 +1：倍增在高端机器上会把平台整段跳过去（8 与 16 之间可能差 40% 算力），
 * +1 又需要太多档位、测量时间过长。maxStep 留给测试用固定步长。
 */
export function nextStep(value: number, ceiling: number, maxStep?: number): number | null {
  if (value >= ceiling) return null;
  const growth = maxStep === undefined ? Math.max(1, Math.ceil(value / 2)) : Math.min(maxStep, value);
  return Math.min(ceiling, value + growth);
}

export async function stepUpThroughput(measure: (value: number) => Promise<{ throughput: number; note?: string }>,
  options: StepUpOptions): Promise<StepUpResult> {
  const ceiling = Math.max(1, Math.floor(options.ceiling));
  const start = Math.max(1, Math.min(Math.floor(options.start), ceiling));
  const minGain = options.minGain ?? 1.1;
  const maxStep = options.maxStep === undefined ? undefined : Math.max(1, options.maxStep);
  const points: StepUpPoint[] = [];
  let previous = 0;
  let value = start;
  for (;;) {
    if (options.signal?.aborted) throw new DOMException("容量测量已取消", "AbortError");
    options.onProgress?.(`测量 ${value} 档…`);
    const { throughput } = await measure(value);
    const gain = previous > 0 ? throughput / previous : 1;
    points.push({ value, throughput, gain });
    previous = throughput;
    if (points.length > 1 && gain < minGain) break;
    const next = nextStep(value, ceiling, maxStep);
    if (next === null) break;
    value = next;
  }
  const { best, reason } = pickPlateau(points, start, minGain);
  return { points, best, reason };
}
