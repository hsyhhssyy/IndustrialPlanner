import { expect, it } from "vitest";
import { initialPlannerArea, plannerAttemptBudget } from "@/blueprint-planner/search-policy";
import { assertPlannerDimensionSchedule, partitionPlannerDimensions } from "@/blueprint-planner/dimension-schedule";

// 2026-10-16：首解策略采用经 Windows 任务验证的五倍线性起点；单尺寸预算保持设备规模语义。
// AI-CORRECTION 2026-10-17：用户要求恢复两倍；同步线性面积及 4900 封顶边界，单尺寸预算仍按设备规模计算。
// AI-CORRECTION 2026-10-20：单尺寸预算提高四倍并保持 100k 封顶；全局预算和初始 2S 面积不变。
// AI-CORRECTION 2026-10-20：基础规模仍为 5k，仅在原有规模增长区间加深；覆盖增长边界及本次 Windows 案例。
// AI-CORRECTION 2026-10-25：默认面积在 400 格后增长、800 格达到 3S，保留 4900 封顶与原预算；S=680 避免浮点多取整。
// 文档：.docs/common/eda/算法探索/算法探索20261025-阈值起始面积.md
// AI-CORRECTION 2026-10-26：面积保留增长公式；单尺寸预算恢复 beta1/2 原公式，不保留四倍加深。
// AI-CORRECTION 2026-10-26：默认倍率改为 600～1200 格由 3 增至 4；覆盖阈值两侧、取整、4S 区间及 1225 格封顶，预算预期保持 beta1/2。
// 文档：.docs/common/eda/算法探索/算法探索20261026-三至四倍阈值起始面积.md
// AI-REMOVED 2026-10-26:
// Reason: 原面积预期描述已被替换的 400～800 格、2S～3S 规则。
// Trigger: 用户明确修改默认面积公式；测试随行为变更同步，不改变预算和验收门槛。
// Evidence: search-policy.ts initialPlannerArea 的新阈值与倍率。
// Replacement: 下方参数表，保留原规模预算并补充新阈值与封顶边界。
// Risk: Low；规划成功率仍需独立 EDA 实测。
// Human Review: Required
// Original code:
// it.each([[1, 2, 5000], [150, 300, 5000], [151, 302, 6000], [178, 356, 8000], [265, 530, 16000], [300, 600, 20000],
//   [399, 798, 36000], [400, 800, 36000], [401, 804, 36000], [474, 1036, 50000], [600, 1500, 80000],
//   [680, 1836, 100000], [765, 2229, 100000], [799, 2396, 100000], [800, 2400, 100000], [801, 2403, 100000],
//   [900, 2700, 100000], [1200, 3600, 100000], [1633, 4899, 100000], [1634, 4900, 100000], [2000, 4900, 100000],
//   [2450, 4900, 100000], [2451, 4900, 100000], [Number.MAX_SAFE_INTEGER, 4900, 100000]])(
// AI-CORRECTION 2026-10-26：覆盖 200/300/400 三个锚点及两侧、S=220 的精确取整，4S 与 4900 上限；单尺寸预算不变。
// 文档：.docs/common/eda/算法探索/算法探索20261026-二至四倍阈值起始面积.md
// AI-REMOVED 2026-10-26:
// Reason: 原参数表对应已替换的 600～1200 格 3S～4S 规则。
// Trigger: 用户明确要求 200→2S、300→3S、400→4S 并复测。
// Evidence: search-policy.ts initialPlannerArea 的新统一公式。
// Replacement: 下方参数表继续验证面积、阈值、取整和原预算。
// Risk: Low；通过面积测试不等于 EDA 成功率通过。
// Human Review: Required
// Original code:
// it.each([[1, 3, 5000], [150, 450, 5000], [151, 453, 6000], [178, 534, 8000], [195, 585, 9000], [220, 660, 11000],
//   [229, 687, 12000], [265, 795, 16000], [300, 900, 20000], [399, 1197, 36000], [400, 1200, 36000], [401, 1203, 36000],
//   [456, 1368, 47000], [474, 1422, 50000], [599, 1797, 80000], [600, 1800, 80000], [601, 1805, 81000],
//   [680, 2131, 100000], [765, 2506, 100000], [799, 2663, 100000], [800, 2667, 100000], [801, 2672, 100000],
//   [900, 3150, 100000], [1020, 3774, 100000], [1199, 4795, 100000], [1200, 4800, 100000], [1201, 4804, 100000],
//   [1224, 4896, 100000], [1225, 4900, 100000], [1226, 4900, 100000], [1633, 4900, 100000], [1634, 4900, 100000],
//   [2000, 4900, 100000], [2450, 4900, 100000], [2451, 4900, 100000], [Number.MAX_SAFE_INTEGER, 4900, 100000]])(
// AI-CORRECTION 2026-10-27：同步 100/200/400 三锚点、两段倍率、取整和封顶预期；本轮按用户要求不执行 Vitest。
// 文档：.docs/common/eda/算法探索/算法探索20261027-三锚点起始面积.md
// AI-REMOVED 2026-10-27:
// Reason: 原参数表对应上一轮 200/300/400 的增长公式。
// Trigger: 用户明确要求新三锚点公式并直接执行 EDA。
// Evidence: search-policy.ts 的新公式在 100/200/400 分别返回 200/600/1600。
// Replacement: 下方固定预期；单尺寸预算和其余断言保持。
// Risk: 本轮测试预期已同步但未运行 Vitest，算法效果以浏览器专项为准。
// Human Review: Required
// Original code:
// it.each([[1, 2, 5000], [150, 300, 5000], [151, 302, 6000], [178, 356, 8000], [195, 390, 9000],
//   [199, 398, 9000], [200, 400, 9000], [201, 405, 9000], [220, 484, 11000], [229, 525, 12000],
//   [265, 703, 16000], [299, 895, 20000], [300, 900, 20000], [301, 907, 21000], [399, 1593, 36000],
//   [400, 1600, 36000], [401, 1604, 36000], [456, 1824, 47000], [474, 1896, 50000], [599, 2396, 80000],
//   [600, 2400, 80000], [601, 2404, 81000], [680, 2720, 100000], [765, 3060, 100000], [799, 3196, 100000],
//   [800, 3200, 100000], [801, 3204, 100000], [900, 3600, 100000], [1020, 4080, 100000], [1199, 4796, 100000],
//   [1200, 4800, 100000], [1201, 4804, 100000], [1224, 4896, 100000], [1225, 4900, 100000], [1226, 4900, 100000],
//   [1633, 4900, 100000], [1634, 4900, 100000], [2000, 4900, 100000], [2450, 4900, 100000], [2451, 4900, 100000],
//   [Number.MAX_SAFE_INTEGER, 4900, 100000]])(
it.each([[1, 2, 5000], [99, 198, 5000], [100, 200, 5000], [101, 204, 5000], [150, 375, 5000],
  [151, 380, 6000], [178, 495, 8000], [195, 576, 9000], [199, 596, 9000], [200, 600, 9000],
  [201, 605, 9000], [220, 682, 11000], [229, 721, 12000], [265, 882, 16000], [299, 1046, 20000],
  [300, 1050, 20000], [301, 1056, 21000], [399, 1595, 36000], [400, 1600, 36000], [401, 1604, 36000],
  [456, 1824, 47000], [474, 1896, 50000], [599, 2396, 80000], [600, 2400, 80000], [601, 2404, 81000],
  [680, 2720, 100000], [765, 3060, 100000], [799, 3196, 100000], [800, 3200, 100000], [801, 3204, 100000],
  [900, 3600, 100000], [1020, 4080, 100000], [1199, 4796, 100000], [1200, 4800, 100000], [1201, 4804, 100000],
  [1224, 4896, 100000], [1225, 4900, 100000], [1226, 4900, 100000], [1633, 4900, 100000], [1634, 4900, 100000],
  [2000, 4900, 100000], [2450, 4900, 100000], [2451, 4900, 100000], [Number.MAX_SAFE_INTEGER, 4900, 100000]])(
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

// AI-REMOVED 2026-10-26:
// Reason: 同步撤下已移除搜索能力的专用用例；保留旧内核仍支持的随机流、严格缩面积与面积边界断言。
// Trigger: 用户明确要求恢复 beta1/2 搜索内核，保留业务修复与任务接口。
// Evidence: src/tests/blueprint-planner/search-policy.test.ts；原文件 SHA256 5de9fe9230280088ff8217ba117da889eec204fee48598f1217c9da3f76a3196。
// Replacement: beta1/2 内核的现有几何、Worker、任务与正式验产测试；search-policy.test.ts 验证新面积公式。
// Risk: 撤下的搜索分支不再参与运行，其专用覆盖同时退休；未修改现有业务正确性门槛。
// Human Review: Required
// Original code:
// import { expect, it } from "vitest";
// import { initialPlannerArea, plannerAttemptBudget, plannerRepeatedQuota } from "@/blueprint-planner/search-policy";
// import { assertPlannerDimensionSchedule, partitionPlannerDimensions } from "@/blueprint-planner/dimension-schedule";
//
// // 2026-10-16：首解策略采用经 Windows 任务验证的五倍线性起点；单尺寸预算保持设备规模语义。
// // AI-CORRECTION 2026-10-17：用户要求恢复两倍；同步线性面积及 4900 封顶边界，单尺寸预算仍按设备规模计算。
// // AI-CORRECTION 2026-10-20：单尺寸预算提高四倍并保持 100k 封顶；全局预算和初始 2S 面积不变。
// // AI-CORRECTION 2026-10-20：基础规模仍为 5k，仅在原有规模增长区间加深；覆盖增长边界及本次 Windows 案例。
// // AI-CORRECTION 2026-10-25：默认面积在 400 格后增长、800 格达到 3S，保留 4900 封顶与原预算；S=680 避免浮点多取整。
// // 文档：.docs/common/eda/算法探索/算法探索20261025-阈值起始面积.md
// it.each([[1, 2, 5000], [150, 300, 5000], [151, 302, 24000], [178, 356, 32000], [265, 530, 64000], [300, 600, 80000],
//   [399, 798, 100000], [400, 800, 100000], [401, 804, 100000], [474, 1036, 100000], [600, 1500, 100000],
//   [680, 1836, 100000], [765, 2229, 100000], [799, 2396, 100000], [800, 2400, 100000], [801, 2403, 100000],
//   [900, 2700, 100000], [1200, 3600, 100000], [1633, 4899, 100000], [1634, 4900, 100000], [2000, 4900, 100000],
//   [2450, 4900, 100000], [2451, 4900, 100000], [Number.MAX_SAFE_INTEGER, 4900, 100000]])(
//   "设备占地 %i 的首解面积为 %i、单尺寸预算为 %i", (devices, area, budget) => {
//     expect(initialPlannerArea(devices)).toBe(area);
//     expect(plannerAttemptBudget(devices)).toBe(budget);
//   });
//
// it("首次搜索包含面积上限，已有成果搜索严格缩小，并过滤放不下仓库口的尺寸", () => {
//   // AI-REMOVED 2026-10-16:
//   // Reason: 边界长度不再参与面积公式。
//   // Trigger: 用户改为线性起点；Evidence: 265 格设备使用 795 格初始面积。
//   // Replacement: 上方比例用例与下方尺寸过滤断言。Risk: Low；Human Review: Required
//   // Original code:
//   // expect(initialPlannerArea(474, 39)).toBe(1681);
//   // expect(initialPlannerArea(474, 70)).toBe(4900);
//   const initial = partitionPlannerDimensions(4900, { width: 5, height: 5 }, undefined, true, 36).flat();
//   expect(initial).toContainEqual({ width: 70, height: 70, area: 4900, weight: 1 });
//   const smaller = partitionPlannerDimensions(1223, { width: 5, height: 5 }, undefined, false, 36).flat();
//   expect(smaller.length).toBeGreaterThan(0);
//   for (const dimension of smaller) {
//     expect(dimension.area).toBeLessThan(1223);
//     expect(Math.max(dimension.width, dimension.height)).toBeGreaterThanOrEqual(36);
//   }
//   expect(partitionPlannerDimensions(4900, { width: 5, height: 5 }, undefined, true, 71).flat()).toEqual([]);
// });
//
// it("尺寸缩小后保留设备规模预算，持久化校验拒绝被篡改的预算", () => {
//   const schedule = { deviceArea: 474, boundaryLength: 36, inclusive: false, generation: 1,
//     targetArea: 1000, minimum: { width: 5, height: 5 }, attemptsPerTask: 100000 };
//   const shards = partitionPlannerDimensions(1000, schedule.minimum, undefined, false, 36)
//     .map(dimensions => ({ dimensions, dimensionCursor: 0 }));
//   expect(() => assertPlannerDimensionSchedule(schedule, shards)).not.toThrow();
//   expect(() => assertPlannerDimensionSchedule({ ...schedule, attemptsPerTask: 5000 }, shards)).toThrow();
// });
//
// it.each([0, -1, 1.5, NaN, Infinity])("拒绝无效设备面积 %s", area => {
//   expect(() => initialPlannerArea(area)).toThrow();
//   expect(() => plannerAttemptBudget(area)).toThrow();
// });
//
// // 2026-10-18：续搜份额按实际提案及在途预约分配，未消耗配额必须返还。
// it("子网预算按累计实际消耗补齐份额，零余额、关闭和全量模式均有界", () => {
//   expect(plannerRepeatedQuota(0, 0, 800_000)).toBe(0);
//   expect(plannerRepeatedQuota(100_000, 0, 700_000)).toBe(100_000);
//   expect(plannerRepeatedQuota(100_000, 100_000, 600_000)).toBe(0);
//   // 子网仅实际消耗 10k 后释放其余预约，后续整网消耗触发补齐剩余 90k。
//   expect(plannerRepeatedQuota(100_000, 10_000, 690_000)).toBe(90_000);
//   expect(plannerRepeatedQuota(1_000_000, 0, 37)).toBe(37);
//   expect(plannerRepeatedQuota(1_000_000, 0, 0)).toBe(0);
//   expect(plannerRepeatedQuota(100_000, 0, 700_000, 0)).toBe(0);
//   expect(plannerRepeatedQuota(0, 0, 700_000, 1)).toBe(700_000);
// });
//
// it.each([-1, 1.1, NaN, Infinity])("拒绝无效子网比例 %s", fraction => {
//   expect(() => plannerRepeatedQuota(100, 0, 100, fraction)).toThrow("子网搜索预算无效");
// });
//
