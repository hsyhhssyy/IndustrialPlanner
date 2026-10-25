import { expect, it } from "vitest";
import { initialPlannerArea, plannerAttemptBudget, plannerRepeatedQuota } from "@/blueprint-planner/search-policy";
import { assertPlannerDimensionSchedule, partitionPlannerDimensions } from "@/blueprint-planner/dimension-schedule";

// 2026-10-16：首解策略采用经 Windows 任务验证的五倍线性起点；单尺寸预算保持设备规模语义。
// AI-CORRECTION 2026-10-17：用户要求恢复两倍；同步线性面积及 4900 封顶边界，单尺寸预算仍按设备规模计算。
// AI-CORRECTION 2026-10-20：单尺寸预算提高四倍并保持 100k 封顶；全局预算和初始 2S 面积不变。
// AI-CORRECTION 2026-10-20：基础规模仍为 5k，仅在原有规模增长区间加深；覆盖增长边界及本次 Windows 案例。
// AI-CORRECTION 2026-10-25：默认面积在 400 格后增长、800 格达到 3S，保留 4900 封顶与原预算；S=680 避免浮点多取整。
// 文档：.docs/common/eda/算法探索/算法探索20261025-阈值起始面积.md
it.each([[1, 2, 5000], [150, 300, 5000], [151, 302, 24000], [178, 356, 32000], [265, 530, 64000], [300, 600, 80000],
  [399, 798, 100000], [400, 800, 100000], [401, 804, 100000], [474, 1036, 100000], [600, 1500, 100000],
  [680, 1836, 100000], [765, 2229, 100000], [799, 2396, 100000], [800, 2400, 100000], [801, 2403, 100000],
  [900, 2700, 100000], [1200, 3600, 100000], [1633, 4899, 100000], [1634, 4900, 100000], [2000, 4900, 100000],
  [2450, 4900, 100000], [2451, 4900, 100000], [Number.MAX_SAFE_INTEGER, 4900, 100000]])(
  "设备占地 %i 的首解面积为 %i、单尺寸预算为 %i", (devices, area, budget) => {
    expect(initialPlannerArea(devices)).toBe(area);
    expect(plannerAttemptBudget(devices)).toBe(budget);
  });

it("首次搜索包含面积上限，已有成果搜索严格缩小，并过滤放不下仓库口的尺寸", () => {
  // AI-REMOVED 2026-10-16:
  // Reason: 边界长度不再参与面积公式。
  // Trigger: 用户改为线性起点；Evidence: 265 格设备使用 795 格初始面积。
  // Replacement: 上方比例用例与下方尺寸过滤断言。Risk: Low；Human Review: Required
  // Original code:
  // expect(initialPlannerArea(474, 39)).toBe(1681);
  // expect(initialPlannerArea(474, 70)).toBe(4900);
  const initial = partitionPlannerDimensions(4900, { width: 5, height: 5 }, undefined, true, 36).flat();
  expect(initial).toContainEqual({ width: 70, height: 70, area: 4900, weight: 1 });
  const smaller = partitionPlannerDimensions(1223, { width: 5, height: 5 }, undefined, false, 36).flat();
  expect(smaller.length).toBeGreaterThan(0);
  for (const dimension of smaller) {
    expect(dimension.area).toBeLessThan(1223);
    expect(Math.max(dimension.width, dimension.height)).toBeGreaterThanOrEqual(36);
  }
  expect(partitionPlannerDimensions(4900, { width: 5, height: 5 }, undefined, true, 71).flat()).toEqual([]);
});

it("尺寸缩小后保留设备规模预算，持久化校验拒绝被篡改的预算", () => {
  const schedule = { deviceArea: 474, boundaryLength: 36, inclusive: false, generation: 1,
    targetArea: 1000, minimum: { width: 5, height: 5 }, attemptsPerTask: 100000 };
  const shards = partitionPlannerDimensions(1000, schedule.minimum, undefined, false, 36)
    .map(dimensions => ({ dimensions, dimensionCursor: 0 }));
  expect(() => assertPlannerDimensionSchedule(schedule, shards)).not.toThrow();
  expect(() => assertPlannerDimensionSchedule({ ...schedule, attemptsPerTask: 5000 }, shards)).toThrow();
});

it.each([0, -1, 1.5, NaN, Infinity])("拒绝无效设备面积 %s", area => {
  expect(() => initialPlannerArea(area)).toThrow();
  expect(() => plannerAttemptBudget(area)).toThrow();
});

// 2026-10-18：续搜份额按实际提案及在途预约分配，未消耗配额必须返还。
it("子网预算按累计实际消耗补齐份额，零余额、关闭和全量模式均有界", () => {
  expect(plannerRepeatedQuota(0, 0, 800_000)).toBe(0);
  expect(plannerRepeatedQuota(100_000, 0, 700_000)).toBe(100_000);
  expect(plannerRepeatedQuota(100_000, 100_000, 600_000)).toBe(0);
  // 子网仅实际消耗 10k 后释放其余预约，后续整网消耗触发补齐剩余 90k。
  expect(plannerRepeatedQuota(100_000, 10_000, 690_000)).toBe(90_000);
  expect(plannerRepeatedQuota(1_000_000, 0, 37)).toBe(37);
  expect(plannerRepeatedQuota(1_000_000, 0, 0)).toBe(0);
  expect(plannerRepeatedQuota(100_000, 0, 700_000, 0)).toBe(0);
  expect(plannerRepeatedQuota(0, 0, 700_000, 1)).toBe(700_000);
});

it.each([-1, 1.1, NaN, Infinity])("拒绝无效子网比例 %s", fraction => {
  expect(() => plannerRepeatedQuota(100, 0, 100, fraction)).toThrow("子网搜索预算无效");
});
