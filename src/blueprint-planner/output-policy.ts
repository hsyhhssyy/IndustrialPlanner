import { plannerRequestKey } from "./search-seed";
import type { BlueprintPlannerOptions, BlueprintPlannerRequest } from "@/domain/blueprint-planner";

export const MAX_PLANNER_OUTPUT_MODES = 64;

/** 自动项独立搜索；六个维度以内穷举，更多维度保留两种极端和确定性混合样本，限制种子池内存。 */
export function resolvePlannerOutputAttempt(request: BlueprintPlannerRequest, variant: number) {
  if (request.blueprintSource) return { request, variant };
  const automatic = request.options.itemPolicies?.filter(policy => policy.output === "auto") ?? [];
  const dimensions = automatic.length + Number(request.options.solidOutput === "auto");
  if (!dimensions) return { request, variant };
  const count = Math.min(MAX_PLANNER_OUTPUT_MODES, 2 ** dimensions);
  const attempt = variant % count;
  const mask = attempt === 1 ? count - 1 : attempt === 0 ? 0 : attempt - 1;
  let dimension = 0;
  const choose = (): "warehouse" | "stash" => {
    const index = dimension++;
    const bit = dimensions <= 6 ? Math.floor(mask / 2 ** index) % 2
      : attempt === 0 ? 0 : attempt === 1 ? 1 : (Math.imul(index + 1, 0x45d9f3b) ^ Math.imul(attempt + 1, 0x27d4eb2d)) >>> (index % 23) & 1;
    return bit ? "warehouse" : "stash";
  };
  const solidOutput = request.options.solidOutput === "auto" ? choose() : request.options.solidOutput;
  return { request: { ...request, options: { ...request.options, solidOutput,
    ...(request.options.itemPolicies === undefined ? {} : { itemPolicies: request.options.itemPolicies.map(policy =>
      policy.output === "auto" ? { ...policy, output: choose() } : policy) }),
  } }, variant: Math.floor(variant / count) };
}

/** 仅从检查点取回自动项的已解析值；固定项、来源、配方等仍由原请求定义并由 requestKey 校验。 */
export function restorePlannerOutputRequest(request: BlueprintPlannerRequest, resolved: BlueprintPlannerOptions): BlueprintPlannerRequest {
  const concrete = (mode: string | undefined): "warehouse" | "stash" => {
    if (mode !== "stash" && mode !== "warehouse") throw new Error("检查点含有未解析的自动输出规则。");
    return mode;
  };
  const additional = request.options.warehousePortPlacement === "full-side" ? (resolved.itemPolicies ?? []).filter(policy =>
    !request.options.itemPolicies?.some(original => original.itemId === policy.itemId)) : [];
  if (additional.some(policy => request.options.solidOutput !== "auto" || policy.supply !== undefined || policy.byproducts !== undefined)) {
    throw new Error("检查点改变了固定的物品规则。");
  }
  const restored = { ...request, options: { ...request.options,
    solidOutput: request.options.solidOutput === "auto" ? concrete(resolved.solidOutput) : request.options.solidOutput,
    ...(request.options.itemPolicies === undefined ? {} : { itemPolicies: request.options.itemPolicies.map(policy => policy.output === "auto"
        || request.options.warehousePortPlacement === "full-side" && policy.output === undefined && request.options.solidOutput === "auto"
          && resolved.itemPolicies?.some(entry => entry.itemId === policy.itemId && entry.output !== undefined)
      ? { ...policy, output: concrete(resolved.itemPolicies?.find(entry => entry.itemId === policy.itemId)?.output) } : policy) }),
  } };
  if (additional.length) Object.assign(restored.options, { itemPolicies: [...restored.options.itemPolicies ?? [],
    ...additional.map(policy => ({ itemId: policy.itemId, output: concrete(policy.output) }))] });
  if (plannerRequestKey(restored) !== plannerRequestKey({ ...request, options: resolved })) throw new Error("续搜布局与当前生产方案或供给条件不一致：检查点改变了固定的物品规则。");
  return restored;
}

export function plannerOutputModeKey(options: BlueprintPlannerOptions): string {
  const outputs = (options.itemPolicies ?? []).filter(policy => policy.output !== undefined)
    .map(policy => [policy.itemId, policy.output]).sort(([a], [b]) => a!.localeCompare(b!));
  return outputs.length ? `${options.solidOutput}:${encodeURIComponent(JSON.stringify(outputs))}` : options.solidOutput;
}

export function plannerUsesOutputStash(options: BlueprintPlannerOptions): boolean {
  return options.solidOutput === "stash" || (options.itemPolicies?.some(policy => policy.output === "stash") ?? false);
}
