import type { BlueprintPlannerRequest } from "@/domain/blueprint-planner";
import type { PlannerNetwork } from "./model";
import { PlannerItemRules } from "@/shared/planner-item-policy";
import type { RegistryContract } from "@/domain/registry/registry-contract";
import { PlannerRandom } from "./search-random";

export interface PlannerWarehousePortProfile {
  readonly pickupLength: number;
  readonly storageLength: number;
  readonly fixedStorageCount: number;
  readonly automatic: readonly { readonly itemId: string; readonly count: number }[];
}

/** 从正式终端生成结果取数，自动项先按存货口准备，手选存储箱保持原配置。 */
export function warehouseMaximumRequest(request: BlueprintPlannerRequest): BlueprintPlannerRequest {
  if (request.blueprintSource) return request;
  return { ...request, options: { ...request.options,
    solidOutput: request.options.solidOutput === "auto" ? "warehouse" : request.options.solidOutput,
    itemPolicies: request.options.itemPolicies?.map(policy => policy.output === "auto" ? { ...policy, output: "warehouse" } : policy),
  } };
}

export function warehousePortProfile(registry: RegistryContract, request: BlueprintPlannerRequest,
  network: PlannerNetwork): PlannerWarehousePortProfile {
  const rules = new PlannerItemRules(registry, request.options);
  const counts = new Map<string, number>();
  let pickupLength = 0, fixedStorageCount = 0;
  for (const node of network.nodes) {
    if (node.entity.definitionId === "unloader_1") pickupLength += Math.max(node.definition.footprint.width, node.definition.footprint.height);
    if (node.entity.definitionId !== "loader_1") continue;
    const itemId = node.inputs[0]?.itemId;
    if (!request.blueprintSource && itemId && rules.output(itemId) === "auto") counts.set(itemId, (counts.get(itemId) ?? 0) + 1);
    else fixedStorageCount++;
  }
  const storage = registry.queries.findEntityDefinition("loader_1")!.footprint;
  return { pickupLength, storageLength: Math.max(storage.width, storage.height), fixedStorageCount,
    automatic: [...counts].sort(([a], [b]) => a.localeCompare(b)).map(([itemId, count]) => ({ itemId, count })) };
}

/** 按口数做子集和，不展开指数个组合；同一口数只进入调度一次。 */
export function warehouseStorageCounts(profile: PlannerWarehousePortProfile): number[] {
  let sums = new Set([profile.fixedStorageCount]);
  for (const entry of profile.automatic) sums = new Set([...sums, ...[...sums].map(value => value + entry.count)]);
  return [...sums].sort((a, b) => a - b);
}

/** 给定口数后才轮转产物组合；组合数量不会影响该口数的调度概率。 */
// AI-CORRECTION 2026-10-11：生产调度传入独立随机流抽样；显式组合编号供枚举及对照使用。
export function warehouseCountRequest(request: BlueprintPlannerRequest, profile: PlannerWarehousePortProfile,
  storageCount: number, variant: number | PlannerRandom): BlueprintPlannerRequest {
  if (request.blueprintSource) return request;
  const groups = profile.automatic;
  const ways = Array.from({ length: groups.length + 1 }, () => new Map<number, bigint>());
  ways[groups.length]!.set(0, 1n);
  for (let i = groups.length - 1; i >= 0; i--) for (const [sum, count] of ways[i + 1]!) {
    ways[i]!.set(sum, (ways[i]!.get(sum) ?? 0n) + count);
    const next = sum + groups[i]!.count;
    ways[i]!.set(next, (ways[i]!.get(next) ?? 0n) + count);
  }
  let remaining = storageCount - profile.fixedStorageCount;
  const count = ways[0]!.get(remaining);
  if (!count) throw new Error("存货口数量与固定产物规则不匹配。");
  let rank = variant instanceof PlannerRandom ? variant.bigint(count) : BigInt(variant) % count;
  const outputs = new Map<string, "warehouse" | "stash">();
  for (let i = 0; i < groups.length; i++) {
    const group = groups[i]!, skip = ways[i + 1]!.get(remaining) ?? 0n;
    const warehouse = rank >= skip;
    if (warehouse) { rank -= skip; remaining -= group.count; }
    outputs.set(group.itemId, warehouse ? "warehouse" : "stash");
  }
  const policies = new Map((request.options.itemPolicies ?? []).map(policy => [policy.itemId, { ...policy, ...(policy.output === "auto" ? { output: "stash" as const } : {}) }]));
  for (const [itemId, output] of outputs) policies.set(itemId, { ...policies.get(itemId), itemId, output });
  return { ...request, options: { ...request.options,
    solidOutput: request.options.solidOutput === "auto" ? "stash" : request.options.solidOutput,
    ...(policies.size || request.options.itemPolicies ? { itemPolicies: [...policies.values()] } : {}) } };
}
