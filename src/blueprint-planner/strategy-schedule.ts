import { PlannerRandom, assertPlannerRandomState, plannerRandomSeed } from "./search-random";

/** 每项决策单独抽样；布局种子不再承担策略编号的职责。 */
export interface PlannerAttemptStrategy {
  readonly restart: boolean;
  readonly reduce: boolean;
  readonly conduitTopology: "shared" | "trunk" | "local";
  readonly outputSeed: number;
  readonly portfolioSeed: number;
  readonly reductionSeed: number;
  readonly matchingSeed: number;
  readonly placementSeed: number;
  readonly packingSeed: number;
  readonly converterSeed: number;
  readonly boundarySeed: number;
  readonly outlineSeed: number;
  readonly layoutSeed: number;
}

export interface PlannerDimensionRandomState {
  state: number;
  visits: number;
  restarts: number[];
  reductions: number[];
  topologies: number[];
}

const TOPOLOGIES = ["shared", "trunk", "local"] as const;

/** 单次直接调用也走同一 PRNG；variant 只作为可复现的调用身份。 */
export function plannerAttemptStrategy(variant: number): PlannerAttemptStrategy {
  return sample(new PlannerRandom(plannerRandomSeed(`attempt/${variant}`)));
}

function sample(random: PlannerRandom): PlannerAttemptStrategy {
  return { restart: random.integer(4) === 0, reduce: random.integer(2) === 0,
    conduitTopology: TOPOLOGIES[random.integer(3)]!, outputSeed: random.next(), portfolioSeed: random.next(),
    reductionSeed: random.next(), matchingSeed: random.next(), placementSeed: random.next(), packingSeed: random.next(),
    converterSeed: random.next(), boundarySeed: random.next(), outlineSeed: random.next(), layoutSeed: random.next() };
}

/** 普通构网复用连接随机流，独立选择备用供液口与逐点合流；不绑定物品、尺寸或另一项结构选择。 */
export function plannerConnectionChoices(seed: number) {
  const random = new PlannerRandom(seed);
  return { spareSupplyPorts: random.integer(2) === 0, serialConvergers: random.integer(2) === 0 };
}

/** 按尺寸而非分片轮次维护覆盖；返回副本，由 Host 在本次搜索结算时提交。 */
export function nextPlannerStrategy(seed: number, dimension: string, previous?: PlannerDimensionRandomState) {
  const state: PlannerDimensionRandomState = previous ? structuredClone(previous) : {
    state: plannerRandomSeed(`${seed}/${dimension}`), visits: 0, restarts: [], reductions: [], topologies: [],
  };
  const random = new PlannerRandom(state.state);
  const take = (bag: number[], values: readonly number[]) => {
    if (!bag.length) bag.push(...random.shuffle(values));
    return bag.pop()!;
  };
  // 各自打乱，避免把两个轮转表按相同索引绑定；不枚举策略的笛卡尔积。
  const restart = take(state.restarts, [0, 0, 0, 1]) === 1;
  const reduce = take(state.reductions, [0, 1]) === 1;
  const conduitTopology = TOPOLOGIES[take(state.topologies, [0, 1, 2])]!;
  const strategy = { ...sample(random), restart, reduce, conduitTopology };
  state.state = random.state; state.visits++;
  return { strategy, state };
}

export function assertPlannerStrategyStates(states: Record<string, PlannerDimensionRandomState>, attempts: number): void {
  if (!states || typeof states !== "object" || Array.isArray(states)) throw new Error("尺寸随机检查点无效。");
  let visits = 0;
  for (const [key, state] of Object.entries(states)) {
    if (!/^\d+\/\d+\/(?:[0-3]|any)\/(?:\d+|any)$/.test(key) || !state) throw new Error("尺寸随机检查点无效。");
    const [width, height] = key.split("/").map(Number);
    if (width! < 1 || width! > 70 || height! < 1 || height! > 70) throw new Error("尺寸随机检查点无效。");
    assertPlannerRandomState(state.state);
    if (!Number.isSafeInteger(state.visits) || state.visits < 1) throw new Error("尺寸随机访问计数无效。");
    for (const [bag, values] of [[state.restarts, [0, 0, 0, 1]], [state.reductions, [0, 1]], [state.topologies, [0, 1, 2]]] as const) {
      if (!Array.isArray(bag) || bag.length !== (values.length - state.visits % values.length) % values.length
        || bag.some(value => !(values as readonly number[]).includes(value))
        || values.some(value => bag.filter(entry => entry === value).length > values.filter(entry => entry === value).length)) {
        throw new Error("策略轮转检查点无效。");
      }
    }
    visits += state.visits;
  }
  if (visits > attempts) throw new Error("尺寸随机访问次数超过分片搜索次数。");
}
