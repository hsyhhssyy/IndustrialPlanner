import { expect, it } from "vitest";
import { PlannerAutomaticConcurrency, PlannerConcurrencyMemory, plannerConcurrencyLimit } from "@/blueprint-planner/automatic-concurrency";

it("容量提示保留 CPU 余量，缺失提示时不会盲目启满 32 Worker", () => {
  expect(plannerConcurrencyLimit({})).toBe(1);
  // 2026-10-06：用户要求放宽经验上限；每通道预留 256 MiB，实际档位交给在线测量。
  // AI-CORRECTION 2026-10-13：用户要求整页内存收敛；CPU 池改为固定 512MiB 上限，仍保留低内存保护。
  expect(plannerConcurrencyLimit({ hardwareConcurrency: 32 })).toBe(2);
  expect(plannerConcurrencyLimit({ hardwareConcurrency: 32, deviceMemory: 8 })).toBe(2);
  expect(plannerConcurrencyLimit({ hardwareConcurrency: 32, deviceMemory: 64 })).toBe(2);
  expect(plannerConcurrencyLimit({ hardwareConcurrency: 8, deviceMemory: 2 })).toBe(2);
  expect(plannerConcurrencyLimit({ hardwareConcurrency: 1, deviceMemory: 0.5 })).toBe(1);
});

// AI-REMOVED 2026-10-07:
// Reason: 旧用例要求四秒周期加压、连续缩容与缓存减半，和新的稳定吞吐策略冲突。
// Trigger: 用户授权修改控制器并以长时平均吞吐验收。
// Evidence: Windows 响应延迟反复触发 20→15→12→9，原测试未覆盖稳定保持。
// Replacement: 下方基于吞吐平台、过渡阶段和持续压力的回归。
// Risk: 不再保证旧调档时刻；保留资源上限与会话缓存测试。
// Human Review: Required
// Original code:
// it("增加并发没有吞吐收益时退回，冷却后仍可再次试探", () => {
//   const control = new PlannerAutomaticConcurrency(4, 0, 0);
//   const sample = (at: number, evaluations: number, activeWorkers: number) => control.observe({ at, evaluations, activeWorkers,
//     pendingVerifications: 0, lagMs: 0 });
//   expect(sample(1000, 100, 1)).toBe(1);
//   expect(sample(4000, 400, 1)).toBe(2);
//   expect(sample(8000, 800, 2)).toBe(1);
//   expect(sample(12_000, 1200, 1)).toBe(1);
//   expect(sample(40_000, 4000, 1)).toBe(2);
// });
//
// it("吞吐提升允许增容，验证积压和偶发卡顿不收缩，持续卡顿才退让", () => {
//   const control = new PlannerAutomaticConcurrency(3, 0, 0);
//   expect(control.observe({ at: 4000, evaluations: 400, activeWorkers: 1, pendingVerifications: 0, lagMs: 0 })).toBe(2);
//   expect(control.observe({ at: 8000, evaluations: 1200, activeWorkers: 2, pendingVerifications: 0, lagMs: 0 })).toBe(3);
//   expect(control.observe({ at: 12_000, evaluations: 2400, activeWorkers: 3, pendingVerifications: 0, lagMs: 0 })).toBe(3);
//   // AI-REMOVED 2026-10-03:
//   // Reason: 用户要求修正 Windows 上验证排队和一次卡顿导致长期单 Worker 的错误判断。
//   // Trigger: CPU 容量判断与验证背压分离。Evidence: before-desktop-02 的 nominal 压力及冷却记录。
//   // Replacement: 下方持续压力、偶发延迟与恢复断言。Risk: Low。Human Review: Required
//   // Original code:
//   // expect(control.observe({ at: 13_000, evaluations: 2700, activeWorkers: 3, pendingVerifications: 0, lagMs: 200 })).toBe(2);
//   // expect(control.observe({ at: 14_000, evaluations: 2900, activeWorkers: 2, pendingVerifications: 2, lagMs: 0 })).toBe(1);
//   // expect(control.observe({ at: 18_000, evaluations: 3300, activeWorkers: 1, pendingVerifications: 0, lagMs: 0 })).toBe(1);
//   expect(control.observe({ at: 13_000, evaluations: 2700, activeWorkers: 3, pendingVerifications: 0, lagMs: 200 })).toBe(3);
//   expect(control.observe({ at: 14_000, evaluations: 2900, activeWorkers: 0, pendingVerifications: 3, lagMs: 0 })).toBe(3);
//   for (const at of [15_000, 16_000]) {
//     expect(control.observe({ at, evaluations: at / 4, activeWorkers: 3, pendingVerifications: 0, lagMs: 200 })).toBe(3);
//   }
//   expect(control.observe({ at: 17_000, evaluations: 4500, activeWorkers: 3, pendingVerifications: 0, lagMs: 200 })).toBe(2);
//   expect(control.observe({ at: 21_000, evaluations: 5500, activeWorkers: 2, pendingVerifications: 0, lagMs: 0 })).toBe(3);
// });
//
// it("没有工作进展或执行通道未用满时不增容，CPU 压力可独立触发收缩", () => {
//   const control = new PlannerAutomaticConcurrency(8, 0, 0);
//   expect(control.observe({ at: 4000, evaluations: 0, activeWorkers: 1, pendingVerifications: 0, lagMs: 0 })).toBe(1);
//   expect(control.observe({ at: 8000, evaluations: 100, activeWorkers: 0, pendingVerifications: 0, lagMs: 0 })).toBe(1);
//   expect(control.observe({ at: 12_000, evaluations: 200, activeWorkers: 1, pendingVerifications: 0, lagMs: 0 })).toBe(2);
//   expect(control.observe({ at: 13_000, evaluations: 250, activeWorkers: 2, pendingVerifications: 0, lagMs: 0, pressure: "critical" })).toBe(1);
// });
//
//
// it("高上限先较大步幅爬升，无收益时回到探测前的完整档位", () => {
//   const control = new PlannerAutomaticConcurrency(24, 0, 0);
//   const sample = (at: number, evaluations: number) => control.observe({ at, evaluations,
//     activeWorkers: control.target, pendingVerifications: 0, lagMs: 0 });
//   expect(sample(4000, 100)).toBe(2);
//   expect(sample(8000, 300)).toBe(3);
//   expect(sample(12000, 600)).toBe(5);
//   expect(control.confirmedTarget).toBe(3);
//   expect(sample(16000, 900)).toBe(3);
//   expect(control.confirmedTarget).toBe(3);
//   expect(sample(20000, 1200)).toBe(3);
//   // 下一次改用更细的步幅，不反复从 3 跳到已经无收益的 5。
//   expect(sample(24000, 1500)).toBe(4);
// });
//
// it("恒定吞吐下重复探测不会让并发逐步漂移到上限", () => {
//   const control = new PlannerAutomaticConcurrency(32, 0, 0);
//   for (let window = 1; window <= 30; window++) {
//     const target = control.observe({ at: window * 4000, evaluations: window * 100,
//       activeWorkers: control.target, pendingVerifications: 0, lagMs: 0 });
//     expect(target).toBeLessThanOrEqual(2);
//     expect(control.confirmedTarget).toBe(1);
//   }
// });
//
// it("缓存起点必须重新测量，更少通道保留吞吐时采用较少通道", () => {
//   for (const retained of [true, false]) {
//     const control = new PlannerAutomaticConcurrency(8, 0, 0, 8);
//     expect(control.target).toBe(8);
//     expect(control.observe({ at: 4000, evaluations: 800, activeWorkers: 8, pendingVerifications: 0, lagMs: 0 })).toBe(4);
//     expect(control.observe({ at: 8000, evaluations: retained ? 1600 : 1200,
//       activeWorkers: 4, pendingVerifications: 0, lagMs: 0 })).toBe(retained ? 4 : 8);
//     expect(control.confirmedTarget).toBe(retained ? 4 : 8);
//   }
// });
//
// it("连续压力永不退到零，缓存并发受当前机器资源上限约束", () => {
//   const control = new PlannerAutomaticConcurrency(2, 0, 0, 16);
//   expect(control.target).toBe(2);
//   for (let second = 1; second <= 8; second++) {
//     expect(control.observe({ at: second * 1000, evaluations: second * 100, activeWorkers: 1,
//       pendingVerifications: 0, lagMs: 0, pressure: "critical" })).toBe(1);
//   }
// });
//
// it("累计工作时间识别批次交接，资源被另一阶段占用时不误判探测失败", () => {
//   const control = new PlannerAutomaticConcurrency(8, 0, 0);
//   expect(control.observe({ at: 4000, evaluations: 100, activeWorkers: 0,
//     pendingVerifications: 0, lagMs: 0, busyMs: 3900 })).toBe(2);
//   // 此窗被验证占用，只用了少量搜索时间，不能据此回退新增通道。
//   expect(control.observe({ at: 8000, evaluations: 110, activeWorkers: 0,
//     pendingVerifications: 4, lagMs: 0, busyMs: 4100 })).toBe(2);
//   expect(control.confirmedTarget).toBe(1);
//   expect(control.observe({ at: 12000, evaluations: 310, activeWorkers: 0,
//     pendingVerifications: 0, lagMs: 0, busyMs: 11900 })).toBe(3);
//   expect(control.confirmedTarget).toBe(2);
// });
//

/** 输入吞吐曲线，观察真实控制器的收敛与保护；不预设每次调档的内部时刻。 */
function drive(initial = 1, maximum = 24) {
  const control = new PlannerAutomaticConcurrency(maximum, 0, 0, initial);
  let at = 0, evaluations = 0, busyMs = 0;
  const changes: Array<{ at: number; from: number; to: number }> = [];
  const run = (seconds: number, rate: (workers: number) => number,
    options: { lagMs?: number; pressure?: "critical"; activeWorkers?: number; busy?: boolean } = {}) => {
    for (let second = 0; second < seconds; second++) {
      const from = control.target;
      at += 1000; evaluations += rate(from);
      busyMs += options.busy === false ? 0 : from * 1000;
      control.observe({ at, evaluations, busyMs, activeWorkers: options.activeWorkers ?? from,
        pendingVerifications: 0, lagMs: options.lagMs ?? 0, pressure: options.pressure });
      if (from !== control.target) changes.push({ at, from, to: control.target });
    }
  };
  return { control, changes, run };
}

it("真实吞吐在八路到达平台后回到最好档位，长期保持而非重复加压", () => {
  const test = drive();
  test.run(120, workers => Math.min(workers, 8) * 100);
  expect(test.control.target).toBe(8);
  expect(test.control.confirmedTarget).toBe(8);
  expect(Math.max(...test.changes.map(value => value.to))).toBeGreaterThan(8);
  const changes = test.changes.length;
  test.run(180, workers => Math.min(workers, 8) * 100);
  expect(test.changes).toHaveLength(changes);
});

it("恒定吞吐不因较大上限漂移，短窗交替峰谷不造成持续上探", () => {
  const test = drive();
  let second = 0;
  test.run(240, () => ++second % 2 ? 170 : 30);
  expect(test.control.target).toBe(1);
  expect(test.control.confirmedTarget).toBe(1);
  expect(Math.max(...test.changes.map(value => value.to))).toBe(2);
});

it("缓存并发先重新测量，少一个通道保留吞吐则采用，否则恢复", () => {
  for (const plateau of [6, 8]) {
    const test = drive(8);
    test.run(60, workers => Math.min(workers, plateau) * 100);
    expect(test.control.target).toBe(plateau === 6 ? 7 : 8);
    expect(test.control.confirmedTarget).toBe(test.control.target);
  }
});

it("持续明显卡顿每次退让后等待生效，不在三秒内连续砍半", () => {
  const test = drive(20);
  test.run(3, workers => workers * 100, { lagMs: 600 });
  expect(test.control.target).toBe(15);
  test.run(6, workers => workers * 100, { lagMs: 600 });
  expect(test.control.target).toBe(15);
  test.run(25, workers => workers * 100, { lagMs: 600 });
  const decreases = test.changes.filter(value => value.to < value.from);
  for (let i = 1; i < decreases.length; i++) expect(decreases[i]!.at - decreases[i - 1]!.at).toBeGreaterThanOrEqual(10_000);
  expect(test.control.target).toBeGreaterThanOrEqual(1);
});

it("普通响应延迟不否决吞吐观测，严重压力仍独立保护", () => {
  const test = drive();
  test.run(100, workers => Math.min(workers, 8) * 100, { lagMs: 200 });
  expect(test.control.target).toBe(8);
  test.run(1, workers => workers * 100, { pressure: "critical" });
  expect(test.control.target).toBe(6);
  test.run(60, workers => workers * 100, { pressure: "critical" });
  expect(test.control.target).toBe(1);
});

it("工作量不足与无进展不被误判为机器吞吐平台", () => {
  const test = drive();
  test.run(20, () => 0);
  expect(test.control.target).toBe(1);
  test.run(20, () => 100, { busy: false, activeWorkers: 0 });
  expect(test.control.target).toBe(1);
  test.run(40, workers => workers * 100);
  expect(test.control.target).toBeGreaterThan(1);
});

it("缩容时旧批次尚未退出，不把过渡期产出当成新档位的测量", () => {
  const test = drive(16);
  test.run(1, () => 1000, { pressure: "critical" });
  expect(test.control.target).toBe(12);
  test.run(8, () => 50_000, { activeWorkers: 16 });
  expect(test.control.confirmedTarget).toBe(1);
  test.run(30, () => 1000);
  expect(test.control.confirmedTarget).toBe(12);
});

it("长期吞吐持续恶化才重新测量，随后仍收敛到新的平台", () => {
  const test = drive();
  test.run(100, workers => Math.min(workers, 8) * 100);
  expect(test.control.target).toBe(8);
  const changes = test.changes.length;
  test.run(180, workers => Math.min(workers, 6) * 70);
  expect(test.changes.length).toBeGreaterThan(changes);
  expect(test.control.target).toBe(7);
  const settled = test.changes.length;
  test.run(120, workers => Math.min(workers, 6) * 70);
  expect(test.changes).toHaveLength(settled);
});

it("会话缓存按请求隔离、过期失效并限制存量", () => {
  const memory = new PlannerConcurrencyMemory();
  memory.remember("first", 8, 100);
  expect(memory.read("other", 101)).toBe(1);
  expect(memory.read("first", 101)).toBe(8);
  expect(memory.read("first", 600101)).toBe(1);
  for (let index = 0; index <= 32; index++) memory.remember(String(index), 4, 0);
  expect(memory.read("0", 1)).toBe(1);
  expect(memory.read("32", 1)).toBe(4);
  expect(new PlannerConcurrencyMemory().read("32", 1)).toBe(1);
});
