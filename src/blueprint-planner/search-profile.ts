// AI-CORRECTION 2026-10-26：保留既有溢出权重参数的有效范围，默认值与搜索配置仍为 beta1/2。
import defaultSearchProfile from "./default-search-profile.json";

/** 仅控制搜索过程；不得修改交付验收和质量评分。 */
export interface PlannerSearchProfile {
  readonly initialTemperature: number;
  readonly coolingRatio: number;
  readonly congestionWeight: number;
  readonly areaWeight: number;
  readonly overflowWeight: number;
  readonly portAlignmentProbability: number;
  readonly compactionProbability: number;
  readonly routeFeedbackWeight: number;
  readonly initialClearance: number;
  readonly separateOperatingSupply: number;
  readonly fluidGroupSize: number;
}

export const DEFAULT_SEARCH_PROFILE: PlannerSearchProfile = Object.freeze(defaultSearchProfile);

export function resolveSearchProfile(input: Partial<PlannerSearchProfile> = {}): PlannerSearchProfile {
  const result = { ...DEFAULT_SEARCH_PROFILE, ...input };
  const ranges: Record<keyof PlannerSearchProfile, readonly [number, number]> = {
    initialTemperature: [0.1, 200], coolingRatio: [0.001, 1], congestionWeight: [0, 30],
    areaWeight: [0, 5], overflowWeight: [1, 2000], portAlignmentProbability: [0, 0.5],
    compactionProbability: [0, 0.4], routeFeedbackWeight: [0.1, 20], initialClearance: [0, 2], separateOperatingSupply: [0, 1], fluidGroupSize: [1, 64],
  };
  for (const key of Object.keys(input)) if (!(key in ranges)) throw new Error(`未知搜索参数：${key}`);
  for (const [key, [min, max]] of Object.entries(ranges)) {
    const value = result[key as keyof PlannerSearchProfile];
    if (!Number.isFinite(value) || value < min || value > max) throw new Error(`搜索参数越界：${key}`);
  }
  if (!Number.isInteger(result.initialClearance)) throw new Error("初排间距必须为整数。");
  if (!Number.isInteger(result.separateOperatingSupply)) throw new Error("运行供料分组策略必须为 0 或 1。");
  if (!Number.isInteger(result.fluidGroupSize)) throw new Error("流体设施服务组大小必须为整数。");
  return Object.freeze(result);
}

// AI-REMOVED 2026-10-26:
// Reason: 用户要求恢复 beta1/2 搜索内核，撤回其后搜索实现；保留业务正确性修复与公开任务接口。
// Trigger: 多版本对照后用户明确要求回退算法并使用 2S 渐增至 3S 初始面积。
// Evidence: .temp/eda/all-items/comparisons/default-area-20261026T015057315Z.json；回退前 SHA256 40baa12fa5483da69bd929c7e99e134aa20e87e6b26439391a4c7f34f28d657c。
// Replacement: src/blueprint-planner/search-profile.ts 上方 beta1/2 活动实现
// Risk: 搜索策略、检查点及后续局部修复能力变化；原始未提交内容完整保留。
// Human Review: Required
// Original code (src/blueprint-planner/search-profile.ts):
// import defaultSearchProfile from "./default-search-profile.json";
//
// /** 仅控制搜索过程；不得修改交付验收和质量评分。 */
// export interface PlannerSearchProfile {
//   readonly initialTemperature: number;
//   readonly coolingRatio: number;
//   readonly congestionWeight: number;
//   readonly areaWeight: number;
//   readonly overflowWeight: number;
//   /** 几何、覆盖和连通约束的搜索代价，与软通道间距独立。 */
//   readonly constraintWeight: number;
//   readonly portAlignmentProbability: number;
//   readonly compactionProbability: number;
//   readonly routeFeedbackWeight: number;
//   readonly initialClearance: number;
//   /** 首解搜索的软通道间距；零关闭，不改变交付规则。 */
//   readonly routingClearance: number;
//   readonly separateOperatingSupply: number;
//   readonly fluidGroupSize: number;
//   /** 工作消耗流体单独选择服务组大小；零沿用普通流体的拓扑与分组。 */
//   readonly operatingFluidGroupSize: number;
// }
//
// export const DEFAULT_SEARCH_PROFILE: PlannerSearchProfile = Object.freeze(defaultSearchProfile);
//
// export function resolveSearchProfile(input: Partial<PlannerSearchProfile> = {}): PlannerSearchProfile {
//   const result = { ...DEFAULT_SEARCH_PROFILE, ...input };
//   const ranges: Record<keyof PlannerSearchProfile, readonly [number, number]> = {
//     initialTemperature: [0.1, 200], coolingRatio: [0.001, 1], congestionWeight: [0, 30],
//     areaWeight: [0, 5], overflowWeight: [1, 2000], constraintWeight: [1, 10000], portAlignmentProbability: [0, 0.5],
//     compactionProbability: [0, 0.4], routeFeedbackWeight: [0.1, 20], initialClearance: [0, 2], routingClearance: [0, 2], separateOperatingSupply: [0, 1], fluidGroupSize: [1, 64], operatingFluidGroupSize: [0, 64],
//   };
//   for (const key of Object.keys(input)) if (!(key in ranges)) throw new Error(`未知搜索参数：${key}`);
//   for (const [key, [min, max]] of Object.entries(ranges)) {
//     const value = result[key as keyof PlannerSearchProfile];
//     if (!Number.isFinite(value) || value < min || value > max) throw new Error(`搜索参数越界：${key}`);
//   }
//   if (!Number.isInteger(result.initialClearance)) throw new Error("初排间距必须为整数。");
//   if (!Number.isInteger(result.routingClearance)) throw new Error("通道间距必须为整数。");
//   if (!Number.isInteger(result.separateOperatingSupply)) throw new Error("运行供料分组策略必须为 0 或 1。");
//   if (!Number.isInteger(result.fluidGroupSize)) throw new Error("流体设施服务组大小必须为整数。");
//   if (!Number.isInteger(result.operatingFluidGroupSize)) throw new Error("工作消耗流体服务组大小必须为整数。");
//   return Object.freeze(result);
// }
//

// AI-REMOVED 2026-10-26:
// Reason: 用户要求恢复 beta1/2 搜索内核，撤回其后搜索实现；保留业务正确性修复与公开任务接口。
// Trigger: 多版本对照后用户明确要求回退算法并使用 2S 渐增至 3S 初始面积。
// Evidence: .temp/eda/all-items/comparisons/default-area-20261026T015057315Z.json；回退前 SHA256 ca4655fbee4c59589f9d81fb235f0bc39b5b8d5161a1972df2a488abdc445d41。
// Replacement: default-search-profile.json 的 beta1/2 默认配置
// Risk: 搜索策略、检查点及后续局部修复能力变化；原始未提交内容完整保留。
// Human Review: Required
// Original code (src/blueprint-planner/default-search-profile.json):
// {
//   "initialTemperature": 80,
//   "coolingRatio": 0.025,
//   "congestionWeight": 6,
//   "areaWeight": 0.04,
//   "overflowWeight": 80,
//   "constraintWeight": 100,
//   "portAlignmentProbability": 0.34,
//   "compactionProbability": 0.25,
//   "routeFeedbackWeight": 6,
//   "initialClearance": 0,
//   "routingClearance": 0,
//   "separateOperatingSupply": 1,
//   "fluidGroupSize": 3,
//   "operatingFluidGroupSize": 0
// }
//
