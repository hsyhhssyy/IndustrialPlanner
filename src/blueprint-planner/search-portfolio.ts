import { resolvePlannerOutputAttempt, restorePlannerOutputRequest, plannerUsesOutputStash, MAX_PLANNER_OUTPUT_MODES } from "./output-policy";
import type { BlueprintPlannerRequest } from "@/domain/blueprint-planner";
import { plannerRequestKey, type PlannerSearchSeed } from "./search-seed";
import { countPlannerOutputStashes } from "./quality";

interface SeedEntry {
  readonly seed: PlannerSearchSeed;
  readonly features: ReadonlyMap<string, string>;
  visits: number;
}

export interface PlannerPortfolioSnapshot {
  readonly pools: readonly { readonly key: string; readonly attemptsWithoutImprovement: number;
    readonly entries: readonly { readonly seed: PlannerSearchSeed; readonly visits: number }[] }[];
}

/** 比较设备摆位及端口连接；仅物流绕线路径不同不占用新的布局名额。 */
function seedFeatures(seed: PlannerSearchSeed): ReadonlyMap<string, string> {
  return new Map([
    ...seed.network.nodes.map(({ entity }) => [`node:${entity.id}`,
      `${entity.definitionId}/${entity.position.x}/${entity.position.y}/${entity.rotation}`] as const),
    ...seed.wires.map(wire => [`wire:${wire.target.entityId}/${wire.target.groupIndex}/${wire.target.portIndex}`,
      `${wire.source.entityId}/${wire.source.groupIndex}/${wire.source.portIndex}/${[...wire.itemIds].sort().join(",")}`] as const),
  ]);
}

function seedDistance(a: SeedEntry, b: SeedEntry): number {
  const keys = new Set([...a.features.keys(), ...b.features.keys()]);
  return [...keys].filter(key => a.features.get(key) !== b.features.get(key)).length / Math.max(1, keys.size);
}

// AI-REMOVED 2026-10-03:
// Reason: 自动去向改为逐物品组合，检查点需要保留每种组合。
// Trigger: 用户要求精确配置物品。
// Evidence: 原搜索和恢复只读取全局 solidOutput。
// Replacement: output-policy.ts
// Risk: 种子池上限增为 64 种组合。
// Human Review: Required
// Original code:
// /** 自动输出交替探索两种完整拓扑；每种模式拥有自己的随机序列和独立探索轮次。 */
// export function resolvePlannerAttempt(request: BlueprintPlannerRequest, variant: number) {
//   if (request.options.solidOutput !== "auto") return { request, variant };
//   return { request: { ...request, options: { ...request.options,
//     solidOutput: variant % 2 === 0 ? "stash" as const : "warehouse" as const } }, variant: Math.floor(variant / 2) };
// }
//
export function resolvePlannerAttempt(request: BlueprintPlannerRequest, variant: number) {
  return resolvePlannerOutputAttempt(request, variant);
}

/** 只记住真实验收通过的种子，避免一种输出的领先结果挤掉另一种拓扑的续搜机会。 */
export class PlannerSearchPortfolio {
  private readonly seeds = new Map<string, { entries: SeedEntry[]; attemptsWithoutImprovement: number }>();

  constructor(private readonly request: BlueprintPlannerRequest, seed?: PlannerSearchSeed) {
    if (seed) this.remember(seed);
  }

  snapshot(): PlannerPortfolioSnapshot {
    return structuredClone({ pools: [...this.seeds].map(([key, pool]) => ({ key,
      attemptsWithoutImprovement: pool.attemptsWithoutImprovement,
      entries: pool.entries.map(({ seed, visits }: PlannerPortfolioSnapshot["pools"][number]["entries"][number]) => ({ seed, visits })) })) });
  }

  restore(snapshot: PlannerPortfolioSnapshot): void {
    if (!Array.isArray(snapshot.pools) || snapshot.pools.length > MAX_PLANNER_OUTPUT_MODES) throw new Error("搜索种子池过多。");
    const pools = new Map<string, { entries: SeedEntry[]; attemptsWithoutImprovement: number }>();
    for (const pool of snapshot.pools) {
      if (pools.has(pool.key) || pool.entries.length < 1 || pool.entries.length > 4
        || !Number.isSafeInteger(pool.attemptsWithoutImprovement) || pool.attemptsWithoutImprovement < 0) throw new Error("无效的搜索种子池。");
      const entries = pool.entries.map(({ seed, visits }: PlannerPortfolioSnapshot["pools"][number]["entries"][number]) => {
// AI-REMOVED 2026-10-03:
// Reason: 自动去向改为逐物品组合，检查点需要保留每种组合。
// Trigger: 用户要求精确配置物品。
// Evidence: 原搜索和恢复只读取全局 solidOutput。
// Replacement: restorePlannerOutputRequest
// Risk: 种子池上限增为 64 种组合。
// Human Review: Required
// Original code:
//         const mode = seed.network.request.options.solidOutput;
//         const request = this.request.options.solidOutput === "auto"
//           ? { ...this.request, options: { ...this.request.options, solidOutput: mode } } : this.request;
        const request = restorePlannerOutputRequest(this.request, seed.network.request.options);
        if (seed.requestKey !== pool.key || seed.requestKey !== plannerRequestKey(request)
          || !Number.isSafeInteger(visits) || visits < 0) throw new Error("检查点与当前生产方案不匹配。");
        const copy = structuredClone(seed);
        return { seed: copy, visits, features: seedFeatures(copy) };
      });
      pools.set(pool.key, { entries, attemptsWithoutImprovement: pool.attemptsWithoutImprovement });
    }
    this.seeds.clear();
    for (const [key, pool] of pools) this.seeds.set(key, pool);
  }

  /** 全局改进后保留不同拓扑与近优布局，但所有分片重新从新最优分配续搜机会。 */
  restart(seed: PlannerSearchSeed | undefined): void {
    this.remember(seed);
    if (seed) {
      const pool = this.seeds.get(seed.requestKey)!;
      const entry: SeedEntry = { seed, features: seedFeatures(seed), visits: 0 };
      // 同面积的施工成本改善也必须成为主种子；仅线路变化时替换原有相同摆位。
      pool.entries = [entry, ...pool.entries.filter(item => seedDistance(item, entry) !== 0)].slice(0, 4);
    }
    for (const pool of this.seeds.values()) {
      pool.attemptsWithoutImprovement = 0;
      for (const entry of pool.entries) entry.visits = 0;
    }
  }

  next(variant: number, continuation = true, globalBest?: { readonly area: number; readonly outputStashCount?: number }) {
    const attempt = resolvePlannerAttempt(this.request, variant);
    // AI-REMOVED 2026-09-30:
    // Reason: 单一种子会丢弃同面积但通道不同的有效布局。
    // Trigger: 用户要求尝试多布局续搜并用一百万提案评估。
    // Evidence: 五百万提案在 400 格停滞，旧池只保留一个严格改善种子。
    // Replacement: 本方法的有界布局池调度。
    // Risk: 分散预算可能延后首次压缩；保留快速缩边及四轮一次独立探索。Human Review: Required
    // Original code:
    // return { ...attempt, seed: continuation && attempt.variant % 4 !== 3
    //   ? this.seeds.get(plannerRequestKey(attempt.request)) : undefined };
    const pool = this.seeds.get(plannerRequestKey(attempt.request));
    const bestArea = globalBest?.area ?? Math.min(...[...this.seeds.values()].map(value => value.entries[0]!.seed.width * value.entries[0]!.seed.height));
    const bestStashCount = globalBest ? (this.request.blueprintSource ? 0 : globalBest.outputStashCount ?? 0)
      : Math.min(...[...this.seeds.values()].flatMap(value => value.entries
      .filter(entry => entry.seed.width * entry.seed.height === bestArea).map(entry => this.request.blueprintSource ? 0 : countPlannerOutputStashes(entry.seed.network.nodes))));
    // 2026-09-30：同面积少箱也是改进；冷启动可能合箱，固定拓扑续搜只有本来更少箱时才放宽一格。
    let maximumArea = continuation && Number.isFinite(bestArea)
      ? bestArea - Number(!plannerUsesOutputStash(attempt.request.options) || bestStashCount <= 1) : undefined;
    if (!continuation || attempt.variant % 4 === 3 || !pool) return { ...attempt, seed: undefined, continuationStep: undefined, maximumArea };
    const stalled = pool.attemptsWithoutImprovement++;
    // 最小面积分支占三分之二续搜机会；停滞两轮后才轮流探索其他结构。
    const index = stalled >= 2 && stalled % 3 === 2 && pool.entries.length > 1
      ? 1 + (Math.floor(stalled / 3) % (pool.entries.length - 1)) : 0;
    const entry = pool.entries[index]!;
    if (maximumArea !== undefined && countPlannerOutputStashes(entry.seed.network.nodes) >= bestStashCount) maximumArea = bestArea - 1;
    return { ...attempt, seed: entry.seed, continuationStep: entry.visits++, maximumArea };
  }

  remember(seed: PlannerSearchSeed | undefined): void {
    if (!seed) return;
// AI-REMOVED 2026-10-03:
// Reason: 自动去向改为逐物品组合，检查点需要保留每种组合。
// Trigger: 用户要求精确配置物品。
// Evidence: 原搜索和恢复只读取全局 solidOutput。
// Replacement: restorePlannerOutputRequest
// Risk: 种子池上限增为 64 种组合。
// Human Review: Required
// Original code:
//     const mode = seed.network.request.options.solidOutput;
//     const request = this.request.options.solidOutput === "auto"
//       ? { ...this.request, options: { ...this.request.options, solidOutput: mode } } : this.request;
    const request = restorePlannerOutputRequest(this.request, seed.network.request.options);
    if (seed.requestKey !== plannerRequestKey(request)) {
      throw new Error("续搜布局与当前生产方案或供给条件不一致。");
    }
    // AI-REMOVED 2026-09-30:
    // Reason: 严格面积淘汰会抹掉可用于越过局部瓶颈的不同布局。
    // Trigger: 多种子续搜。Evidence: 同面积候选此前不进入池。
    // Replacement: 下方保留最优并按结构差异选择至多四个种子。
    // Risk: 多样性采用摆位与端口签名代理，不保证后续更优。Human Review: Required
    // Original code:
    // const previous = this.seeds.get(seed.requestKey);
    // if (!previous || seed.width * seed.height < previous.width * previous.height) this.seeds.set(seed.requestKey, seed);
    const previous = this.seeds.get(seed.requestKey);
    const entry: SeedEntry = { seed, features: seedFeatures(seed), visits: 0 };
    if (previous?.entries.some(item => item.seed.width === seed.width && item.seed.height === seed.height && seedDistance(item, entry) === 0)) return;
    const area = (item: SeedEntry) => item.seed.width * item.seed.height;
    const candidates = [...previous?.entries ?? [], entry].sort((a, b) => area(a) - area(b)
      || (this.request.blueprintSource ? 0 : countPlannerOutputStashes(a.seed.network.nodes) - countPlannerOutputStashes(b.seed.network.nodes)));
    const best = candidates[0]!;
    const selected = [best];
    const remaining = candidates.slice(1).filter(item => area(item) <= area(best) * 1.1);
    while (selected.length < 4 && remaining.length) {
      const merit = (item: SeedEntry) => Math.min(...selected.map(other => seedDistance(item, other))) * area(best) / area(item);
      remaining.sort((a, b) => merit(b) - merit(a) || area(a) - area(b));
      selected.push(remaining.shift()!);
    }
    const improved = !previous || area(best) < area(previous.entries[0]!)
      || (!this.request.blueprintSource && area(best) === area(previous.entries[0]!) && countPlannerOutputStashes(best.seed.network.nodes) < countPlannerOutputStashes(previous.entries[0]!.seed.network.nodes));
    this.seeds.set(seed.requestKey, { entries: selected, attemptsWithoutImprovement: improved ? 0 : previous.attemptsWithoutImprovement });
  }
}
