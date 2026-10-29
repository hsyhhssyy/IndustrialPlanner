import type { BlueprintPlannerRequest } from "@/domain/blueprint-planner";
import type { RegistryContract } from "@/domain/registry/registry-contract";
import { resolvePlannerOutputAttempt, MAX_PLANNER_OUTPUT_MODES } from "./output-policy";
import { createConverterSupplyContext, planConverterSupply } from "./converter-supply";
import { PlannerCandidateError, type PlannerNetwork } from "./model";
import { PlannerRandom, plannerRandomSeed } from "./search-random";
import { plannerAttemptStrategy, type PlannerAttemptStrategy } from "./strategy-schedule";
import { ItemDomainFlag } from "@/domain/shared/item-domain-flags";
import { PlannerItemRules } from "@/shared/planner-item-policy";
import { LOGISTICS_KIND } from "@/domain/shared/logistics";
import { transportCapacity } from "./geometry";
import { capturePlannerSeed, type PlannerSearchSeed } from "./search-seed";
import type { PlannerSearchSession } from "./search-sessions";
import { createSha256CanonicalHash } from "@/shared/storage/hash-utils";

/** 离散候选轴；混合进位按需展开，避免复制尺寸×设备×拓扑的笛卡尔积。 */
export interface PlannerUnitCatalog {
  /** 已验证成果本身也是一个具体设备与拓扑候选，不能被新构网候选挤掉。 */
  readonly reference?: { readonly id: string; readonly seed: PlannerSearchSeed };
  readonly outputs: readonly number[];
  readonly packings: readonly string[];
  readonly converters: readonly number[];
  readonly conduits: readonly ("shared" | "trunk" | "local")[];
  readonly reductions: readonly string[];
}

export interface PlannerUnitProgress {
  cursor: number;
  used: number;
  strategy?: PlannerAttemptStrategy;
  /** 未验收的搜索状态只用于本单元续搜，不进入正式最优或已验证种子池。 */
  seed?: PlannerSearchSeed;
}

export function plannerUnitCount(catalog: PlannerUnitCatalog): bigint {
  const count = catalog.packings.reduce((sum, value) => sum + BigInt(value), 0n)
    * BigInt(catalog.converters.length) * BigInt(catalog.conduits.length) * (1n << BigInt(catalog.reductions.length));
  if (count <= 0n) throw new Error("搜索组合数量无效。");
  return count + BigInt(catalog.reference !== undefined);
}

export function assertPlannerUnitCatalog(catalog: PlannerUnitCatalog): void {
  if (!catalog || !Array.isArray(catalog.outputs) || !Array.isArray(catalog.converters) || !Array.isArray(catalog.conduits)
    || catalog.reference !== undefined && (!catalog.reference || typeof catalog.reference.id !== "string"
      || !catalog.reference.id || catalog.reference.id.length > 200 || !catalog.reference.seed)
    || !Array.isArray(catalog.reductions) || catalog.reductions.some(value => typeof value !== "string" || !value)
    || new Set(catalog.reductions).size !== catalog.reductions.length
    || !Array.isArray(catalog.packings) || catalog.packings.length !== catalog.outputs.length
    || catalog.packings.some(value => typeof value !== "string" || !/^[1-9]\d*$/.test(value))
    || catalog.outputs.some(value => !Number.isSafeInteger(value) || value < 0 || value >= MAX_PLANNER_OUTPUT_MODES)
    || catalog.converters.some(value => !Number.isSafeInteger(value) || value < 0)
    || catalog.conduits.some(value => !["shared", "trunk", "local"].includes(value))
    || [catalog.outputs, catalog.converters, catalog.conduits].some(values => new Set(values).size !== values.length)) {
    throw new Error("搜索组合目录无效。");
  }
  plannerUnitCount(catalog);
}

export async function createPlannerUnitCatalog(registry: RegistryContract, request: BlueprintPlannerRequest, network: PlannerNetwork,
  checkBudget: () => void = () => undefined): Promise<PlannerUnitCatalog> {
  const modes = new Set<string>(), outputs: number[] = [];
  for (let index = 0; index < MAX_PLANNER_OUTPUT_MODES; index++) {
    const key = JSON.stringify(resolvePlannerOutputAttempt(request, index).request.options);
    if (!modes.has(key)) { outputs.push(index); modes.add(key); }
  }
  const context = createConverterSupplyContext(registry, network);
  const count = context.consumers.length;
  const converters: number[] = [], seen = new Set<string>();
  const variants = Math.max(1, 3 * count ** 2) * Number(request.options.converterStartup === "manual" || request.options.converterStartup === "tank" ? 2 : 1);
  for (let index = 0; index < variants; index++) {
    checkBudget();
    if (index > 0 && index % 64 === 0) await new Promise<void>(resolve => setTimeout(resolve, 0));
    try {
      const flows = planConverterSupply(registry, network, index, context);
      const rows = flows.map(flow => [flow.entityId, flow.itemId, flow.sourceId, flow.perMinute, flow.storageGroupIds]);
      rows.sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)));
      const key = await createSha256CanonicalHash(rows);
      if (!seen.has(key)) { converters.push(index); seen.add(key); }
    } catch (error) {
      if (!(error instanceof PlannerCandidateError)) throw error;
    }
  }
  if (!converters.length) throw new Error("没有满足启动策略的转换机供料组合。");
  // 源汇整数选型沿用既有进位规则；每种输出物品的可用箱数范围单独进入设备轴。
  const sinks = new Map<string, number>();
  for (const node of network.nodes) if (node.purpose === "product" || node.purpose === "byproduct") {
    for (const input of node.inputs) sinks.set(input.itemId, (sinks.get(input.itemId) ?? 0) + input.perMinute);
  }
  const packings = outputs.map(output => {
    const rules = new PlannerItemRules(registry, resolvePlannerOutputAttempt(request, output).request.options);
    let count = 1n;
    for (const [item, rate] of sinks) {
      if (registry.queries.resolveItemDomain(item) !== ItemDomainFlag.Solid || rules.output(item) === "warehouse") continue;
      const lanes = Math.max(1, Math.ceil(rate / transportCapacity(LOGISTICS_KIND.belt) - 1e-6));
      const ports = registry.queries.findEntityDefinition("storager_1")!.portGroups.filter(group => group.direction === "input")
        .reduce((sum, group) => sum + group.ports.length, 0);
      count *= BigInt(lanes - Math.ceil(lanes / Math.max(1, ports)) + 1);
    }
    return count.toString();
  });
  const hasFluidSupply = request.options.fluidSupply === "conduit" && network.nodes.some(node => node.inputs.some(flow => registry.queries.resolveItemDomain(flow.itemId) !== ItemDomainFlag.Solid));
  const policy = request.options.blueprintOptimizations;
  const reductions = request.blueprintSource ? network.nodes.filter(node => ["environment", "supply", "product"].includes(node.purpose)
    && (!policy || policy.mergeBoundaryFacilities && ["supply", "product"].includes(node.purpose))
    && (request.options.warehousePortPlacement !== "full-side" || !["loader_1", "unloader_1"].includes(node.entity.definitionId)))
    .map(node => node.entity.id).sort() : [];
  const catalog: PlannerUnitCatalog = { outputs, packings, converters, reductions, conduits: hasFluidSupply ? ["shared", "trunk", "local"] : ["shared"] };
  plannerUnitCount(catalog);
  return catalog;
}

/** 随机只作用于布局轨迹；设备选型与逻辑拓扑由单元身份确定，不在批次内重抽。 */
export function plannerUnitStrategy(catalog: PlannerUnitCatalog, dimension: string, cursor: number, seed: number): PlannerAttemptStrategy {
  if (!Number.isSafeInteger(cursor) || cursor < 0) throw new Error("搜索组合游标无效。");
  const count = plannerUnitCount(catalog), round = BigInt(cursor) / count;
  let index = BigInt(cursor) % count;
  if (catalog.reference !== undefined) {
    if (index === 0n) {
      const fixed = plannerAttemptStrategy(plannerRandomSeed(`${seed}/reference/${catalog.reference.id}`));
      return { ...fixed, unitKey: `${dimension}/reference/${encodeURIComponent(catalog.reference.id)}`,
        unitReference: catalog.reference.id, unitReduction: [], reduce: false, restart: false,
        layoutSeed: plannerRandomSeed(`${seed}/${dimension}/${catalog.reference.id}/${round}`) };
    }
    index--;
  }
  const take = (size: bigint) => { const value = index % size; index /= size; return value; };
  const mask = take(1n << BigInt(catalog.reductions.length));
  const unitReduction = catalog.reductions.filter((_, index) => Boolean(mask & (1n << BigInt(index))));
  const converter = catalog.converters[Number(take(BigInt(catalog.converters.length)))]!;
  const conduitTopology = catalog.conduits[Number(take(BigInt(catalog.conduits.length)))]!;
  let outputIndex = 0;
  while (index >= BigInt(catalog.packings[outputIndex]!)) index -= BigInt(catalog.packings[outputIndex++]!);
  const packing = Number(index), output = catalog.outputs[outputIndex]!;
  const unitKey = `${dimension}/${output}/${packing}/${conduitTopology}/${converter}/${mask.toString(16)}`;
  const fixed = plannerAttemptStrategy(plannerRandomSeed(`${seed}/${unitKey.split("/").slice(2).join("/")}`));
  const layout = new PlannerRandom(plannerRandomSeed(`${seed}/${unitKey}/${round}`));
  return { ...fixed, unitKey, unitReduction, outputSeed: output, packingSeed: packing, converterSeed: converter,
    conduitTopology, restart: true, reduce: unitReduction.length > 0, layoutSeed: layout.next(), boundarySeed: fixed.boundarySeed };
}

/** 每次领取完整剩余批次；总预算尾额不会生成比 X 更小的新搜索单元。 */
export function plannerUnitQuota(available: number, limit: number, used = 0): number {
  if (![available, limit, used].every(Number.isSafeInteger) || available < 0 || limit <= 0 || used < 0 || used >= limit) throw new Error("搜索单元预算无效。");
  const remaining = limit - used;
  return available >= remaining ? remaining : 0;
}

/** 尺寸不同仍可复用兼容组合的摆位，但端口边界及设备、拓扑选择必须保持一致。 */
export function plannerUnitsCompatible(previous: string | undefined, current: string | undefined): boolean {
  return previous !== undefined && current !== undefined && previous.split("/").slice(2).join("/") === current.split("/").slice(2).join("/");
}

export function capturePlannerUnitSeed(request: BlueprintPlannerRequest, unitKey: string | undefined, session: PlannerSearchSession | undefined): PlannerSearchSeed | undefined {
  if (!unitKey || !session) return undefined;
  session.search.applyBest();
  const { width, height } = session.search.statistics.outline;
  return { ...capturePlannerSeed(request, session.network, session.wires, [], width, height), unitKey };
}
