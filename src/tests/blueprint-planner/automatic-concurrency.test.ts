// @vitest-environment node
import { expect, it } from "vitest";
import { DEFAULT_PLANNER_CONCURRENCY_POLICY, PlannerAutomaticConcurrency, plannerProbeCeiling,
  PLANNER_SAFETY_CEILING } from "@/blueprint-planner/automatic-concurrency";
import { nextStep, pickPlateau, stepUpThroughput } from "@/blueprint-planner/capacity-growth";

it("未标定时只给安全阀，容量结论不再由核数公式给出", () => {
  // 缺少提示或提示不影响容量：公式已删除，这里只回答"允许试探到多高"。
  expect(plannerProbeCeiling({})).toBe(PLANNER_SAFETY_CEILING);
  expect(plannerProbeCeiling({ hardwareConcurrency: 32 })).toBe(PLANNER_SAFETY_CEILING);
  expect(plannerProbeCeiling({ safetyCeiling: 6 })).toBe(6);
  expect(plannerProbeCeiling({ safetyCeiling: 0 })).toBe(PLANNER_SAFETY_CEILING);
  expect(plannerProbeCeiling({ safetyCeiling: 999 })).toBe(PLANNER_SAFETY_CEILING);
});

it("上探档位按 1.5 倍增长并在安全阀处停下", () => {
  expect(nextStep(1, 32)).toBe(2);
  expect(nextStep(2, 32)).toBe(3);
  expect(nextStep(3, 32)).toBe(5);
  expect(nextStep(16, 32)).toBe(24);
  expect(nextStep(24, 32)).toBe(32);
  expect(nextStep(32, 32)).toBeNull();
  expect(nextStep(8, 10)).toBe(10);
  // 固定步长模式（测试与离线对照用）。
  expect(nextStep(1, 32, 2)).toBe(2);
  expect(nextStep(2, 32, 2)).toBe(4);
  expect(nextStep(4, 32, 2)).toBe(6);
});

it("增益不足即取平台前一档，从未增长时取起点", () => {
  const flat = [{ value: 1, throughput: 100, gain: 1 }, { value: 2, throughput: 105, gain: 1.05 }];
  expect(pickPlateau(flat, 1, 1.1).best).toBe(1);
  const growing = [{ value: 1, throughput: 100, gain: 1 }, { value: 2, throughput: 195, gain: 1.95 },
    { value: 4, throughput: 380, gain: 1.95 }, { value: 8, throughput: 400, gain: 1.05 }];
  expect(pickPlateau(growing, 1, 1.1).best).toBe(4);
  expect(pickPlateau([], 1, 1.1).best).toBe(1);
});

it("上探测量在真实增益消失处停止，不依赖任何预设档位数", async () => {
  const seen: number[] = [];
  // 吞吐在 4 档后饱和：模拟一台只有 4 路可用算力的机器。
  const result = await stepUpThroughput(async value => {
    seen.push(value);
    return { throughput: Math.min(value, 4) * 100 };
  }, { start: 1, ceiling: 64, minGain: 1.1 });
  expect(seen).toEqual([1, 2, 3, 5, 8]);
  expect(result.best).toBe(5);
  expect(result.reason).toContain("增益仅");
});

it("上探测量遇到安全阀即停，仍在增长时取安全阀", async () => {
  const seen: number[] = [];
  const result = await stepUpThroughput(async value => {
    seen.push(value);
    return { throughput: value * 100 };
  }, { start: 1, ceiling: 5, minGain: 1.1 });
  expect(seen).toEqual([1, 2, 3, 5]);
  expect(result.best).toBe(5);
});

/** 每窗速率按 perWorker 累加：并发真的带来吞吐提升时才会继续加容。 */
function drive(control: PlannerAutomaticConcurrency, windows: number, perWorker: number, at0 = 0): number[] {
  const sequence: number[] = [];
  let at = at0, evaluations = 0, target = control.target;
  for (let index = 0; index < windows; index++) {
    evaluations += perWorker * target;
    at += DEFAULT_PLANNER_CONCURRENCY_POLICY.windowMs;
    target = control.observe({ at, evaluations, activeWorkers: target, pendingVerifications: 0, lagMs: 0 });
    sequence.push(target);
  }
  return sequence;
}

it("吞吐随并发近似线性时，按剩余空间的 25% 逐窗爬升到上限", () => {
  const control = new PlannerAutomaticConcurrency(8, 0, 0);
  expect(drive(control, 8, 100)).toEqual([2, 3, 4, 5, 6, 7, 8, 8]);
});

it("吞吐不随并发提升时退回一格并冷却，冷却后仍可再试探", () => {
  const control = new PlannerAutomaticConcurrency(4, 0, 0);
  // 无论并发多少，每窗只增加固定吞吐：第一窗加容后立即发现没有收益。
  let at = 4000, evaluations = 100;
  expect(control.observe({ at, evaluations, activeWorkers: 1, pendingVerifications: 0, lagMs: 0 })).toBe(2);
  at += 4000; evaluations += 100;
  expect(control.observe({ at, evaluations, activeWorkers: 2, pendingVerifications: 0, lagMs: 0 })).toBe(1);
  // 冷却窗口内保持不动（冷却覆盖两窗）。
  at += 4000; evaluations += 100;
  expect(control.observe({ at, evaluations, activeWorkers: 1, pendingVerifications: 0, lagMs: 0 })).toBe(1);
  // 冷却结束后重新试探加容。
  at += 4000; evaluations += 100;
  expect(control.observe({ at, evaluations, activeWorkers: 1, pendingVerifications: 0, lagMs: 0 })).toBe(2);
  // 再次没有收益，继续退回并冷却。
  at += 4000; evaluations += 100;
  expect(control.observe({ at, evaluations, activeWorkers: 2, pendingVerifications: 0, lagMs: 0 })).toBe(1);
  at += 4000; evaluations += 100;
  expect(control.observe({ at, evaluations, activeWorkers: 1, pendingVerifications: 0, lagMs: 0 })).toBe(1);
});

it("显式指定并发数时该数值即目标", () => {
  const control = new PlannerAutomaticConcurrency(32, 0, 0, { ...DEFAULT_PLANNER_CONCURRENCY_POLICY, target: 4 });
  expect(control.maximum).toBe(4);
  expect(drive(control, 6, 100).at(-1)).toBe(4);
});

it("标定值作为上限，容量提示只作兜底", () => {
  const calibrated = new PlannerAutomaticConcurrency(21, 0, 0, { ...DEFAULT_PLANNER_CONCURRENCY_POLICY, calibratedWorkers: 8 });
  expect(calibrated.maximum).toBe(8);
  expect(drive(calibrated, 10, 100).at(-1)).toBe(8);
  // 显式并发数优先于标定值。
  const explicit = new PlannerAutomaticConcurrency(21, 0, 0, { ...DEFAULT_PLANNER_CONCURRENCY_POLICY, calibratedWorkers: 8, target: 3 });
  expect(explicit.maximum).toBe(3);
});

it("标定值不被与机型无关的常量削顶", () => {
  // 2026-10-06 回归：控制律曾对 maximum 取 Math.min(..., 32)，
  // 64 核机器实测出 64 通道也会被削到 32，标定结果形同作废。
  const calibrated = new PlannerAutomaticConcurrency(64, 0, 0, { ...DEFAULT_PLANNER_CONCURRENCY_POLICY, calibratedWorkers: 48 });
  expect(calibrated.maximum).toBe(48);
  // 爬升按剩余空间的 25% 分配：越接近上限增量越小，会停在上限下方一个"不足一格"的固定点
  // （48 档时是 41）。这里只验证它确实越过了旧常量的 32，没有被常量削顶。
  let at = 0, evaluations = 0, target = calibrated.target;
  for (let index = 0; index < 200; index++) {
    evaluations += 100 * target;
    at += DEFAULT_PLANNER_CONCURRENCY_POLICY.windowMs;
    const next = calibrated.observe({ at, evaluations, activeWorkers: target, pendingVerifications: 0, lagMs: 0 });
    if (next === target) break;
    target = next;
  }
  expect(target).toBeGreaterThan(32);
  // 无标定时上界仍是调用方给的安全阀，不用常量另设一道。
  expect(new PlannerAutomaticConcurrency(40, 0, 0).maximum).toBe(40);
});

it("压力持续时当前占用降低 20%，偶发一次延迟不收缩", () => {
  const control = new PlannerAutomaticConcurrency(8, 0, 0);
  expect(drive(control, 5, 100).at(-1)).toBe(6);
  // 窗口未满的单次卡顿不收缩。
  expect(control.observe({ at: 21_000, evaluations: 2_000, activeWorkers: 6, pendingVerifications: 0, lagMs: 200 })).toBe(6);
  // 窗口跑满且持续卡顿：6 → 4（保留 80%）。
  expect(control.observe({ at: 24_000, evaluations: 2_100, activeWorkers: 6, pendingVerifications: 0, lagMs: 200 })).toBe(4);
  // 冷却期内不再调整。
  expect(control.observe({ at: 25_000, evaluations: 2_200, activeWorkers: 4, pendingVerifications: 0, lagMs: 300 })).toBe(4);
});

it("小上限时至少退让一个通道，不会卡死在同一占用", () => {
  const control = new PlannerAutomaticConcurrency(2, 0, 0);
  expect(drive(control, 2, 100).at(-1)).toBe(2);
  expect(control.observe({ at: 9000, evaluations: 400, activeWorkers: 2, pendingVerifications: 0, lagMs: 150 })).toBe(2);
  expect(control.observe({ at: 12_000, evaluations: 420, activeWorkers: 2, pendingVerifications: 0, lagMs: 150 })).toBe(1);
});

it("CPU 压力信号可独立触发收缩，fair 不触发", () => {
  const control = new PlannerAutomaticConcurrency(8, 0, 0, { ...DEFAULT_PLANNER_CONCURRENCY_POLICY, calibratedWorkers: 6 });
  expect(control.maximum).toBe(6);
  let at = 0, evaluations = 0, target = control.target;
  for (let index = 0; index < 6; index++) {
    evaluations += 100 * target;
    at += DEFAULT_PLANNER_CONCURRENCY_POLICY.windowMs;
    target = control.observe({ at, evaluations, activeWorkers: target, pendingVerifications: 0, lagMs: 0 });
  }
  expect(target).toBe(6);
  // 窗口未满的单次卡顿不收缩。
  expect(control.observe({ at: at + 500, evaluations, activeWorkers: 6, pendingVerifications: 0, lagMs: 0, pressure: "fair" })).toBe(6);
  expect(control.observe({ at: at + 1000, evaluations, activeWorkers: 6, pendingVerifications: 0, lagMs: 0, pressure: "critical" })).toBe(6);
  // 窗口跑满且持续压力：6 → 4（保留 80%）。
  expect(control.observe({ at: at + DEFAULT_PLANNER_CONCURRENCY_POLICY.windowMs, evaluations, activeWorkers: 6,
    pendingVerifications: 0, lagMs: 0, pressure: "critical" })).toBe(4);
});
