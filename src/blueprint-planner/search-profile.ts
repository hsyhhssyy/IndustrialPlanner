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
    areaWeight: [0, 5], overflowWeight: [1, 300], portAlignmentProbability: [0, 0.5],
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
