import { expect, it } from "vitest";
import { initialPlannerArea, plannerAttemptBudget } from "@/blueprint-planner/search-policy";
import { assertPlannerDimensionSchedule, partitionPlannerDimensions } from "@/blueprint-planner/dimension-schedule";

// 2026-10-16：首解策略采用经 Windows 任务验证的五倍线性起点；单尺寸预算保持设备规模语义。
// AI-CORRECTION 2026-10-17：用户要求恢复两倍；同步线性面积及 4900 封顶边界，单尺寸预算仍按设备规模计算。
it.each([[150, 300, 5000], [265, 530, 16000], [300, 600, 20000], [474, 948, 50000], [600, 1200, 80000],
  [765, 1530, 100000], [900, 1800, 100000], [1200, 2400, 100000], [2000, 4000, 100000],
  [2450, 4900, 100000], [2451, 4900, 100000]])(
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
    targetArea: 1000, minimum: { width: 5, height: 5 }, attemptsPerTask: 50000 };
  const shards = partitionPlannerDimensions(1000, schedule.minimum, undefined, false, 36)
    .map(dimensions => ({ dimensions, dimensionCursor: 0 }));
  expect(() => assertPlannerDimensionSchedule(schedule, shards)).not.toThrow();
  expect(() => assertPlannerDimensionSchedule({ ...schedule, attemptsPerTask: 5000 }, shards)).toThrow();
});

it.each([0, -1, 1.5, NaN, Infinity])("拒绝无效设备面积 %s", area => {
  expect(() => initialPlannerArea(area)).toThrow();
  expect(() => plannerAttemptBudget(area)).toThrow();
});
