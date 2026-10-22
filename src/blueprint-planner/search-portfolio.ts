import { resolvePlannerOutputAttempt, restorePlannerOutputRequest, MAX_PLANNER_OUTPUT_MODES } from "./output-policy";
import type { BlueprintPlannerRequest } from "@/domain/blueprint-planner";
import { plannerRequestKey, retainPlannerSeed, comparePlannerPartialSeeds, type PlannerSearchSeed } from "./search-seed";
import { comparePlannerRanks, countPlannerOutputStashes } from "./quality";
import { plannerAttemptStrategy, type PlannerAttemptStrategy } from "./strategy-schedule";
import { PlannerRandom } from "./search-random";
import { PLANNER_MAX_SIDE } from "./search-outline";

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

// AI-REMOVED 2026-10-21:
// Reason: 部分状态排序必须同时考虑静态通道缺口，与局部修复和本批快照统一。
// Trigger: v37 的 31/32 最佳缓存被设备静态隔断，短距离并不表示更接近可交付。
// Evidence: Windows probe52；Replacement: search-seed.ts plannerPartialRank / comparePlannerPartialSeeds。
// Risk: 排序改变，必须重新验证固定预算冷启动；Human Review: Required。
// Original code:
// /** 同连通率时保留更短的待接线路，使局部修复的几何改善能够跨领取累积。 */
// function partialSeedDistance(seed: PlannerSearchSeed): number {
//   const routed = new Set(seed.routes.map(route => `${route.sourcePort}>${route.targetPort}`));
//   return seed.wires.reduce((sum, wire) => {
//     const key = `${wire.source.entityId}/${wire.source.groupIndex}/${wire.source.portIndex}>${wire.target.entityId}/${wire.target.groupIndex}/${wire.target.portIndex}`;
//     return sum + (Math.abs(wire.source.outside.x - wire.target.outside.x) + Math.abs(wire.source.outside.y - wire.target.outside.y))
//       * (routed.has(key) ? 0.05 : 1);
//   }, 0) / seed.wires.length;
// }

/** 形状相差过大时无法沿用局部布线；缓存淘汰与取用使用同一个兼容范围。 */
// AI-CORRECTION 2026-10-21：兼容范围只用于缺少同尺寸快照时的取用；淘汰优先保留精确宽高，不能用相近盒子代替真实进展。
function compatiblePartialOutline(a: { width: number; height: number }, b: { width: number; height: number }): boolean {
  return Math.max(a.width / b.width, b.width / a.width, a.height / b.height, b.height / a.height) <= 1.25;
}

/** 首解前的临时布局池；不进入已验收成果或其持久化快照，独立重启始终绕过此池。 */
// AI-CORRECTION 2026-10-18：也供原生子网续搜使用；仍是有界会话指导，暂停保留、刷新后重新积累。
// AI-CORRECTION 2026-10-20：整图缩面积也复用该池；只保留严格小于已验收面积的未完成布局。
export class PlannerPartialPortfolio {
  private entries: SeedEntry[] = [];

  remember(seed: PlannerSearchSeed | undefined): void {
    if (!seed?.routes.length || !seed.wires.length) return;
    const entry: SeedEntry = { seed: retainPlannerSeed(seed), visits: 0, features: seedFeatures(seed) };
    const quality = (left: SeedEntry, right: SeedEntry) => comparePlannerPartialSeeds(left.seed, right.seed);
    const same = this.entries.findIndex(other => other.seed.requestKey === seed.requestKey
      && other.seed.width === seed.width && other.seed.height === seed.height && seedDistance(other, entry) < 0.1);
    if (same >= 0) {
      const previous = this.entries[same]!;
      if (quality(previous, entry) <= 0) return;
      this.entries[same] = entry;
    } else this.entries.push(entry);
    this.entries.sort(quality);
    // 2026-10-20：先保留不同兼容形状的代表，再填充近邻；一种长宽比的高连通率不能挤掉其他尺寸的全部进展。
    // AI-CORRECTION 2026-10-21：先保留每个精确尺寸的代表；Windows v34 的 94 批跨尺寸复用中 89 批无法进入局部修复。
    const representatives: SeedEntry[] = [];
    for (const candidate of this.entries) if (!representatives.some(other => other.seed.requestKey === candidate.seed.requestKey
      && other.seed.width === candidate.seed.width && other.seed.height === candidate.seed.height)) representatives.push(candidate);
    // 一个面积前沿每个宽度至多一种高度；两倍边长上限为所有尺寸留位，并允许保留其他拓扑/摆位。缓存仍有硬上限。
    // AI-CORRECTION 2026-10-21：调度现包含两个前沿，每宽最多两种高度；140 仍是硬上限，不承诺为所有请求组合另留拓扑名额。
    this.entries = [...representatives, ...this.entries.filter(candidate => !representatives.includes(candidate))].slice(0, PLANNER_MAX_SIDE * 2);
  }

  next(request: BlueprintPlannerRequest, outline: { width: number; height: number }, strategy: PlannerAttemptStrategy,
    maximumArea?: number): PlannerSearchSeed | undefined {
    if (maximumArea !== undefined) this.entries = this.entries.filter(entry => entry.seed.width * entry.seed.height <= maximumArea);
    if (strategy.restart) return undefined;
    const key = plannerRequestKey(request);
    const distance = (entry: SeedEntry) => Math.abs(entry.seed.width - outline.width) + Math.abs(entry.seed.height - outline.height);
    const entries = this.entries.filter(entry => entry.seed.requestKey === key && compatiblePartialOutline(entry.seed, outline));
    // 2026-10-20：相同盒子中的实际进展优先；其他盒子的高连通率不代表缩边后仍可复用。
    entries.sort((a, b) => distance(a) - distance(b)
      || comparePlannerPartialSeeds(a.seed, b.seed) || a.visits - b.visits);
    if (!entries.length) return undefined;
    const random = new PlannerRandom(strategy.portfolioSeed);
    // 2026-10-16：整网重启之外，子网本身也保留三分之一的无指导尝试，避免局部池垄断全部子网搜索。
    if (random.integer(3) === 0) return undefined;
    const entry = entries[random.integer(3) === 0 ? random.integer(Math.min(4, entries.length)) : 0]!;
    entry.visits++;
    return entry.seed;
  }
}

/** 只记住真实验收通过的种子，避免一种输出的领先结果挤掉另一种拓扑的续搜机会。 */
export class PlannerSearchPortfolio {
  private readonly seeds = new Map<string, { entries: SeedEntry[]; attemptsWithoutImprovement: number }>();

  constructor(private readonly request: BlueprintPlannerRequest, seed?: PlannerSearchSeed) {
    if (seed) this.remember(seed);
  }

  snapshot(): PlannerPortfolioSnapshot {
    return { pools: [...this.seeds].map(([key, pool]) => ({ key,
      attemptsWithoutImprovement: pool.attemptsWithoutImprovement,
      entries: pool.entries.map(({ seed, visits }: PlannerPortfolioSnapshot["pools"][number]["entries"][number]) => ({ seed, visits })) })) };
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
        const copy = retainPlannerSeed(seed, true);
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
      seed = retainPlannerSeed(seed);
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

  next(variant: number, continuation = true, globalBest?: { readonly area: number; readonly outputStashCount?: number }, assigned?: BlueprintPlannerRequest,
    strategy: PlannerAttemptStrategy = plannerAttemptStrategy(variant), firstSolution = false) {
    // 2026-10-16：必须在自动项解析为固定选择之前应用首解偏好；明确的口数分片和独立重启不受影响。
    const attempt = { request: assigned ?? resolvePlannerAttempt(this.request, firstSolution && !strategy.restart ? 0 : strategy.outputSeed).request, variant };
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
    // AI-REMOVED 2026-10-17:
    // Reason: 同面积供料合并必须获得搜索预算，不能只为减少产物箱放宽面积。
    // Trigger: 用户要求面积不变时仍减少暗管。Evidence: 原分支固定 bestArea - 1。
    // Replacement: 下方统一最大面积及 Host inclusive 调度。
    // Risk: 部分预算用于同面积优化；独立重启保留。Human Review: Required
    // Original code:
    // const bestStashCount = globalBest ? (this.request.blueprintSource ? 0 : globalBest.outputStashCount ?? 0)
    // : Math.min(...[...this.seeds.values()].flatMap(value => value.entries
    // .filter(entry => entry.seed.width * entry.seed.height === bestArea).map(entry => this.request.blueprintSource ? 0 : countPlannerOutputStashes(entry.seed.network.nodes))));
    // // 2026-09-30：同面积少箱也是改进；冷启动可能合箱，固定拓扑续搜只有本来更少箱时才放宽一格。
    // let maximumArea = continuation && Number.isFinite(bestArea)
    // ? bestArea - Number(!plannerUsesOutputStash(attempt.request.options) || bestStashCount <= 1) : undefined;
    const maximumArea = continuation && Number.isFinite(bestArea) ? bestArea : undefined;
    if (!continuation || strategy.restart || !pool) return { ...attempt, seed: undefined, continuationStep: undefined, maximumArea, attemptStrategy: strategy };
    const stalled = pool.attemptsWithoutImprovement++;
    // 最小面积分支占三分之二续搜机会；停滞两轮后才轮流探索其他结构。
    // AI-CORRECTION 2026-10-11：停滞后以独立随机流按原权重选择，避免与尺寸周期绑定。
    const random = new PlannerRandom(strategy.portfolioSeed);
    const index = stalled >= 2 && random.integer(3) === 0 && pool.entries.length > 1
      ? 1 + random.integer(pool.entries.length - 1) : 0;
    const entry = pool.entries[index]!;
    // AI-REMOVED 2026-10-17:
    // Reason: 固定连接和全局重建均允许同面积改进，不再按箱数收紧一格。
    // Trigger: 用户要求同面积减少供料入口。Evidence: 原最大面积排除现有面积。
    // Replacement: 上方统一 maximumArea。Risk: Low；Human Review: Required
    // Original code: if (maximumArea !== undefined && countPlannerOutputStashes(entry.seed.network.nodes) >= bestStashCount) maximumArea = bestArea - 1;
    return { ...attempt, seed: entry.seed, continuationStep: entry.visits++, maximumArea, attemptStrategy: strategy };
  }

  remember(seed: PlannerSearchSeed | undefined): void {
    if (!seed) return;
    seed = retainPlannerSeed(seed);
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
    if (!this.seeds.has(seed.requestKey) && this.seeds.size >= MAX_PLANNER_OUTPUT_MODES) {
      // 2026-10-11：口数组合不截断；仅淘汰最早的续搜缓存，仍能独立重建该组合。
      this.seeds.delete(this.seeds.keys().next().value!);
    }
    const previous = this.seeds.get(seed.requestKey);
    const entry: SeedEntry = { seed, features: seedFeatures(seed), visits: 0 };
    if (previous?.entries.some(item => item.seed.width === seed.width && item.seed.height === seed.height && seedDistance(item, entry) === 0)) return;
    const area = (item: SeedEntry) => item.seed.width * item.seed.height;
    const rank = (item: SeedEntry) => ({ ...item.seed.quality, area: area(item),
      outputStashCount: this.request.blueprintSource ? 0 : countPlannerOutputStashes(item.seed.network.nodes) });
    const candidates = [...previous?.entries ?? [], entry].sort((a, b) => comparePlannerRanks(rank(a), rank(b)));
    const best = candidates[0]!;
    const selected = [best];
    const remaining = candidates.slice(1).filter(item => area(item) <= area(best) * 1.1);
    while (selected.length < 4 && remaining.length) {
      const merit = (item: SeedEntry) => Math.min(...selected.map(other => seedDistance(item, other))) * area(best) / area(item);
      remaining.sort((a, b) => merit(b) - merit(a) || area(a) - area(b));
      selected.push(remaining.shift()!);
    }
    const improved = !previous || comparePlannerRanks(rank(best), rank(previous.entries[0]!)) < 0;
    this.seeds.set(seed.requestKey, { entries: selected, attemptsWithoutImprovement: improved ? 0 : previous.attemptsWithoutImprovement });
  }
}
