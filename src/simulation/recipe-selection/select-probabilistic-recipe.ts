import type { RecipeRandomSource } from "./recipe-random";

/** 仅对已经完成准入检查的非空候选选择；普通候选保留调用方顺序。 */
export function selectProbabilisticRecipe<T>(
  candidates: readonly T[],
  probabilityOf: (candidate: T) => number | undefined,
  random: RecipeRandomSource,
): T {
  if (candidates.length === 1) return candidates[0]!;
  let firstOrdinary: T | undefined;
  let maxProbability = 0;
  let totalProbability = 0;
  for (const candidate of candidates) {
    const probability = probabilityOf(candidate);
    if (probability === undefined) firstOrdinary ??= candidate;
    else {
      maxProbability = Math.max(maxProbability, probability);
      totalProbability += probability;
    }
  }
  if (maxProbability === 0) return firstOrdinary!;
  const sample = random.next();
  // 混合且总概率不超过 1 时保留普通配方区间，半开边界归下一候选。
  if (firstOrdinary !== undefined && totalProbability <= 1) {
    let cumulative = 0;
    for (const candidate of candidates) {
      const probability = probabilityOf(candidate);
      if (probability === undefined) continue;
      cumulative += probability;
      if (sample < cumulative) return candidate;
    }
    return firstOrdinary;
  }
  // 先按最大权重缩放，避免多个合法有限大值相加溢出。
  let scaledTotal = 0;
  for (const candidate of candidates) {
    const probability = probabilityOf(candidate);
    if (probability !== undefined) scaledTotal += probability / maxProbability;
  }
  const target = sample * scaledTotal;
  let cumulative = 0;
  let lastProbability: T = candidates[0]!;
  for (const candidate of candidates) {
    const probability = probabilityOf(candidate);
    if (probability === undefined) continue;
    lastProbability = candidate;
    cumulative += probability / maxProbability;
    if (target < cumulative) return candidate;
  }
  // 浮点尾差仅落到最后一个概率候选，不能落到普通配方或空闲。
  return lastProbability;
}

