import type { BlueprintPlannerOptions, BlueprintPlannerRequest } from "@/domain/blueprint-planner";
import type { RegistryContract } from "@/domain/registry/registry-contract";
import { normalizePlannerPersistedState } from "@/shared/storage/planner-storage";
import { buildProductionPlanningIndex, computeProductionPlan } from "@/app/shell/production-planning/production-planning-model";
import { createBlueprintPlannerPlan } from "@/app/shell/production-planning/blueprint-planner-adapter";

/** 接受已求解的 EDA 请求，或界面持久化的产线配置；后者先用同一规划模型求解一次。 */
export function readPlanningInput(registry: RegistryContract, value: unknown): BlueprintPlannerRequest {
  if (value === null || typeof value !== "object") throw new Error("规划配置必须是对象。");
  const input = value as Record<string, unknown>;
  if ("request" in input) return readPlanningInput(registry, input.request);
  if ("plan" in input && "options" in input) {
    const request = structuredClone(input) as unknown as {
      plan: BlueprintPlannerRequest["plan"];
      options: Partial<BlueprintPlannerOptions>;
    };
    return { ...request, options: {
      ...request.options,
      evaluationsPerRound: request.options.evaluationsPerRound ?? 50_000,
    } as BlueprintPlannerOptions };
  }
  const state = normalizePlannerPersistedState(input.plannerState ?? input);
  if (state === null || !state.targets.length) throw new Error("规划配置必须包含 targets。");
  if (state.useModules) throw new Error("EDA 批量入口不支持包含模块的产线配置。");
  const activeActivityIds = Array.isArray(input.activeActivityIds) ? input.activeActivityIds.filter((id): id is string => typeof id === "string") : [];
  const index = buildProductionPlanningIndex(registry, { activeActivityIds, includeInactiveActivityContent: false });
  const infiniteItemIds = new Set(state.supplies.filter((entry) => entry.isInfinite).map((entry) => entry.itemId));
  const result = computeProductionPlan({ targets: state.targets, supplies: state.supplies, infiniteItemIds,
    recipeChoices: new Map(Object.entries(state.recipeChoices)), sourceConfig: state.sourceConfig, useModules: false,
  }, index);
  const options: BlueprintPlannerOptions = {
    solidSupply: "warehouse", fluidSupply: "conduit", warehouseBus: "straight", solidOutput: "stash",
    byproducts: "output", plantStartup: "preload", budgetMs: 60_000, evaluationsPerRound: 50_000,
    ...(typeof input.options === "object" && input.options !== null ? input.options : {}),
  };
  return { options, plan: createBlueprintPlannerPlan({ result, targets: state.targets, supplies: state.supplies,
    infiniteItemIds, activeActivityIds, sourceBaseId: typeof input.sourceBaseId === "string" ? input.sourceBaseId : "wuling_protocol_core",
    name: typeof input.name === "string" ? input.name : "EDA 批量规划",
  }) };
}
