import type { BlueprintPlannerRequest } from "@/domain/blueprint-planner";
import { NodePlannerClient } from "./node-planner-client";
import { PlannerBatchSession } from "./planner-runner";
import type { PlannerCapacityProbe, PlannerCapacityProbeOptions } from "@/blueprint-planner/capacity-calibration";
import { LoopLagSampler } from "@/blueprint-planner/loop-lag-sampler";

// AI-REMOVED 2026-10-06:
// Reason: 事件循环延迟采样器与浏览器侧容量探针必须同口径，重复实现会各自漂移。
// Trigger: 浏览器探针恒返回 lagMs=0，无法判断"算力已满导致调度跟不上"。
// Evidence: browser-capacity-probe.ts 原先没有该采样器。
// Replacement: @/blueprint-planner/loop-lag-sampler。
// Risk: Low。Human Review: Required
//
// Original code:
// /** 主线程事件循环延迟：定时器应到与实际到的差值，用于识别"算力已满导致调度跟不上"。 */
// class LoopLagSampler {
//   private expected = 0;
//   private worst = 0;
//   private readonly timer: ReturnType<typeof setInterval>;
//   constructor(private readonly intervalMs = 200) {
//     this.expected = performance.now() + intervalMs;
//     this.timer = setInterval(() => {
//       const now = performance.now();
//       this.worst = Math.max(this.worst, Math.max(0, now - this.expected));
//       this.expected = now + this.intervalMs;
//     }, intervalMs);
//   }
//   stop(): number { clearInterval(this.timer); return this.worst; }
// }

export interface NodeCapacityProbeOptions {
  /**
   * 单通道提案预算上限。必须显著高于窗口内可能达到的量：
   * 若预算先于时间窗耗尽，实际测量时长会随档位漂移（低档 2.0s、高档 3.1s），吞吐就不可比了。
   */
  readonly localEvaluationsPerWorker?: number;
  readonly onProgress?: (message: string) => void;
}

/**
 * Node 侧算力探针：并行启动 N 个真实规划器 Worker，在固定时间窗内统计累计提案数。
 *
 * 只测量「布局生成」这一段：不接仿真验证。原因是最初的探针每通道都挂一套仿真 Host，
 * 2 通道就出现"膝盖点"，实测那其实是仿真内存/CPU 争用（连 28 逻辑核的机器也一样），
 * 用它会标定出严重偏低的并发上限。仿真吞吐由 simulation-performace-monitor 单独负责。
 */
export async function probeNodePlannerCapacity(options: PlannerCapacityProbeOptions,
  probeOptions: NodeCapacityProbeOptions = {}): Promise<PlannerCapacityProbe> {
  const { request, workers, windowMs } = options;
  const budgetPerWorker = probeOptions.localEvaluationsPerWorker ?? 500_000;
  const clients = Array.from({ length: workers }, () => new NodePlannerClient());
  const samples = new PlannerBatchSession();
  const sampler = new LoopLagSampler();
  const startedAt = performance.now();
  try {
    probeOptions.onProgress?.(`${workers} 通道并行测量中（${Math.round(windowMs / 1000)} 秒窗口）…`);
    const outcomes = await Promise.allSettled(clients.map(client => client.build(request as BlueprintPlannerRequest,
      0, windowMs, { maxEvaluations: budgetPerWorker })));
    const evaluations = outcomes.reduce((sum, outcome) => sum
      + (outcome.status === "fulfilled" ? outcome.value.search.evaluations : 0), 0);
    // 探针必须暴露失败原因：静默吞掉会让整条吞吐曲线变成 0 而看不出问题。
    const failures = outcomes.flatMap(outcome => outcome.status === "rejected"
      ? [outcome.reason instanceof Error ? outcome.reason.message : String(outcome.reason)] : []);
    if (failures.length) console.error(`[容量探针] ${workers} 通道有 ${failures.length} 个会话失败: ${failures[0]}`);
    return { workers, windowMs: performance.now() - startedAt, evaluations, lagMs: sampler.stop() };
  } finally {
    sampler.stop();
    await Promise.allSettled(clients.map(client => client.dispose()));
    await samples.dispose();
  }
}
