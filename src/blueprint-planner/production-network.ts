import type { BlueprintPlannerRequest } from "@/domain/blueprint-planner";
import type { RegistryContract } from "@/domain/registry/registry-contract";
import type { RecipeDefinition } from "@/domain/registry/types/recipe-definition";
import { isRecipeAvailableByActivity } from "@/shared/registry/activity-availability";
import { buildDeviceRunningConsumptionRecipesByMachine, resolveCompanionDeviceRunningConsumptionRecipe } from "@/shared/device-running-consumption";
import { CONSUMPTION_RECIPE_TAG } from "@/shared/consumption-channel";
import { lookupText } from "@/shared/i18n";
import { PlannerCandidateError, sumMaterial, type PlannerNetwork, type PlannerNode } from "./model";

const EPSILON = 1e-6;

/** 自然采集只描述物料来源；保留用户选定的所有实际加工配方。 */
export function normalizePlannerSources(registry: RegistryContract, request: BlueprintPlannerRequest): BlueprintPlannerRequest {
  const supplies = sumMaterial(request.plan.externalSupplies);
  const recipes = request.plan.recipes.filter((entry) => {
    const recipe = registry.queries.findRecipeDefinition(entry.recipeId);
    if (!recipe?.tags.includes("自然资源采集")) return true;
    for (const output of recipe.outputs) supplies.set(output.itemId,
      (supplies.get(output.itemId) ?? 0) + output.amount * entry.cyclesPerMinute);
    return false;
  });
  return { ...request, plan: { ...request.plan, recipes,
    externalSupplies: [...supplies].map(([itemId, perMinute]) => ({ itemId, perMinute })),
    infiniteItemIds: [...new Set([...request.plan.infiniteItemIds,
      ...registry.itemDefinitions.filter((item) => item.tags.includes("自然资源")).map((item) => item.id)])],
  } };
}

export function createProductionNetwork(registry: RegistryContract, request: BlueprintPlannerRequest): PlannerNetwork {
  validatePlannerRequest(registry, request);
  request = normalizePlannerSources(registry, request);
  const nodes: PlannerNode[] = [];
  let preferredGasCount = 0;
  for (const plan of request.plan.recipes) {
    const recipe = registry.queries.findRecipeDefinition(plan.recipeId)!;
    const count = Math.ceil(plan.deviceCount - EPSILON);
    const isEnvironment = recipe.gasDiffusionOutput !== undefined;
    if (isEnvironment) preferredGasCount += count;
    for (let index = 0; index < count; index++) {
      nodes.push(createRecipeNode(registry, recipe, `eda-device-${nodes.length}`,
        isEnvironment ? 60 / recipe.durationSeconds : plan.cyclesPerMinute / count,
        isEnvironment ? "environment" : "production"));
    }
  }
  return { request, nodes, slotLinks: [], initialSlots: [], preferredGasCount };
}

export function createRecipeNode(
  registry: RegistryContract, recipe: RecipeDefinition, id: string, cyclesPerMinute: number,
  purpose: "production" | "auxiliary" | "environment" | "byproduct",
): PlannerNode {
  const definition = registry.queries.findEntityDefinition(recipe.machineId);
  if (definition === null) throw new Error(`配方设备未注册：${recipe.machineId}`);
  const channel = definition.recipeChannels.find((entry) =>
    recipe.gasDiffusionOutput !== undefined ? entry.type === "consumption-channel" : entry.type !== "consumption-channel");
  if (channel === undefined) throw new Error(`配方缺少生产通道：${recipe.id}`);
  const config: Record<string, unknown> = { channelRecipes: { [channel.id]: recipe.id } };
  if (definition.recipeChannelBehavior?.automaticModeConfigKey !== undefined) {
    config[definition.recipeChannelBehavior.automaticModeConfigKey] = false;
  }
  definition.recipeChannels.forEach((entry, index) => {
    if (entry.type !== "consumption-channel") config[`recipeChannels[${index}].manualRecipeOnly`] = true;
  });
  const consumption = resolveCompanionDeviceRunningConsumptionRecipe(recipe,
    buildDeviceRunningConsumptionRecipesByMachine(registry.recipeDefinitions));
  const consumptionGroups = [...new Set(definition.recipeChannels
    .filter((entry) => entry.type === "consumption-channel").flatMap((entry) => entry.ingredientStorageGroupIds))];
  return {
    entity: { id, definitionId: definition.id, position: { x: 0, y: 0 }, rotation: 0, config, tags: [] },
    definition, recipe, purpose,
    inputs: [
      ...recipe.inputs.map((input) => ({ itemId: input.itemId, perMinute: input.amount * cyclesPerMinute, storageGroupIds: channel.ingredientStorageGroupIds })),
      ...(consumption?.inputs ?? []).map((input) => ({
        itemId: input.itemId, perMinute: input.amount * 60 / consumption!.durationSeconds, storageGroupIds: consumptionGroups,
      })),
    ],
    outputs: recipe.outputs.map((output) => ({ itemId: output.itemId, perMinute: output.amount * cyclesPerMinute, storageGroupIds: channel.productStorageGroupIds })),
  };
}

export function validatePlannerRequest(registry: RegistryContract, request: BlueprintPlannerRequest): void {
  const { plan, options } = request;
  if (plan.containsModules) throw new Error("包含模块的规划不能自动规划产线。");
  if (!Number.isFinite(plan.unresolvedPerMinute) || plan.unresolvedPerMinute < 0 || plan.unresolvedPerMinute > EPSILON) throw new Error("产线规划仍有未满足需求，请先补齐生产方案。");
  if (!Number.isFinite(options.budgetMs) || options.budgetMs <= 0) throw new Error("规划时间必须大于零。");
  if (!Number.isSafeInteger(options.evaluationsPerRound) || options.evaluationsPerRound < 1_000
    || options.evaluationsPerRound % 1_000 !== 0) throw new Error("每轮计算次数必须是大于零的 1000 整数倍。");
  if (!plan.targets.length || plan.targets.some((flow) => !Number.isFinite(flow.perMinute) || flow.perMinute <= 0)) {
    throw new Error("请提供有效的目标产物与产量。");
  }
  for (const recipePlan of plan.recipes) {
    const recipe = registry.queries.findRecipeDefinition(recipePlan.recipeId);
    if (recipe === null || !isRecipeAvailableByActivity(recipe, plan.activeActivityIds)) throw new Error(`配方当前不可用：${recipePlan.recipeId}`);
    if (![recipePlan.deviceCount, recipePlan.cyclesPerMinute].every((value) => Number.isFinite(value) && value > 0)) {
      throw new Error(`无效设备数量或配方流量：${recipePlan.recipeId}`);
    }
    if (recipe.tags.includes("自然资源采集")) continue;
    const device = registry.queries.findEntityDefinition(recipe.machineId);
    if (!device?.recipeChannels.some((entry) => recipe.gasDiffusionOutput !== undefined
      ? entry.type === "consumption-channel" : entry.type !== "consumption-channel")) {
      throw new Error(`配方缺少生产通道：${recipe.id}`);
    }
    if (device?.placementBehaviors.some((behavior) => behavior.type === "snap-to-outer-ring-edge")) {
      throw new Error(`${lookupText("zh-CN", device.nameKey) ?? device.id}需要地图边界；空地规划请在原产线规划中将对应资源设为外供。`);
    }
    if (recipePlan.cyclesPerMinute > Math.ceil(recipePlan.deviceCount - EPSILON) * 60 / recipe.durationSeconds + EPSILON) {
      throw new Error(`规划设备数量不足：${recipePlan.recipeId}`);
    }
  }
  for (const flow of [...plan.targets, ...plan.externalSupplies]) {
    if (registry.queries.findItemDefinition(flow.itemId) === null || !Number.isFinite(flow.perMinute) || flow.perMinute < 0) {
      throw new Error(`无效物料需求：${flow.itemId}`);
    }
  }
  if (plan.infiniteItemIds.some((itemId) => registry.queries.findItemDefinition(itemId) === null)) throw new Error("外部供给包含未知物料。");
}

/** 只补充环境设施产生的额外需求；原有生产配方和数量保持不变。 */
export function supplyAuxiliaryDemand(
  registry: RegistryContract, network: PlannerNetwork, itemId: string, perMinute: number,
): PlannerNode[] {
  const allowedSources = new Set([...network.request.plan.infiniteItemIds, ...network.request.plan.externalSupplies.map((entry) => entry.itemId)]);
  const chosen = new Set(network.request.plan.recipes.map((entry) => entry.recipeId));
  const selectedByOutput = new Map<string, Set<string>>();
  for (const recipeId of chosen) {
    for (const output of registry.queries.findRecipeDefinition(recipeId)!.outputs) {
      const ids = selectedByOutput.get(output.itemId) ?? new Set<string>();
      ids.add(recipeId); selectedByOutput.set(output.itemId, ids);
    }
  }
  const usable = registry.recipeDefinitions.filter((recipe) =>
    !recipe.tags.includes(CONSUMPTION_RECIPE_TAG) && recipe.gasDiffusionOutput === undefined
    && !recipe.tags.includes("自然资源采集")
    && isRecipeAvailableByActivity(recipe, network.request.plan.activeActivityIds)
    && !registry.queries.findEntityDefinition(recipe.machineId)?.placementBehaviors.some((behavior) => behavior.type === "snap-to-outer-ring-edge")
    && !recipe.machineId.startsWith("cheat_"));
  function findRecipe(item: string, visiting: ReadonlySet<string>): { recipe: RecipeDefinition; cost: number } | null {
    if (visiting.has(item)) return null;
    const costs = new Map([...allowedSources].map((source) => [source, 0]));
    const choices = new Map<string, { recipe: RecipeDefinition; cost: number }>();
    // 正成本松弛只接受从已知来源可达的方案，避免配方环导致指数递归。
    for (let pass = 0; pass < usable.length; pass++) {
      let changed = false;
      for (const recipe of usable) {
        if (recipe.inputs.some((input) => visiting.has(input.itemId))) continue;
        const cost = (chosen.has(recipe.id) ? 0.5 : 1) + recipe.inputs.reduce((sum, input) => sum + (costs.get(input.itemId) ?? Infinity), 0);
        if (!Number.isFinite(cost)) continue;
        for (const output of recipe.outputs) {
          const selected = selectedByOutput.get(output.itemId);
          if (selected !== undefined && !selected.has(recipe.id)) continue;
          if (output.amount <= 0 || visiting.has(output.itemId) || cost >= (costs.get(output.itemId) ?? Infinity)) continue;
          costs.set(output.itemId, cost);
          choices.set(output.itemId, { recipe, cost });
          changed = true;
        }
      }
      if (!changed) break;
    }
    return choices.get(item) ?? null;
  }
  const added: PlannerNode[] = [];
  function add(item: string, rate: number, visiting: ReadonlySet<string>): void {
    if (rate <= EPSILON || allowedSources.has(item)) return;
    const choice = findRecipe(item, visiting);
    if (choice === null) throw new PlannerCandidateError(`气体环境的额外需求缺少可用来源：${item}`);
    const output = choice.recipe.outputs.find((entry) => entry.itemId === item)!;
    const cycles = rate / output.amount;
    const count = Math.ceil(cycles * choice.recipe.durationSeconds / 60 - EPSILON);
    const fresh: PlannerNode[] = [];
    for (let index = 0; index < count; index++) {
      const node = createRecipeNode(registry, choice.recipe, `eda-aux-${network.nodes.length}`, cycles / count, "auxiliary");
      network.nodes.push(node); added.push(node); fresh.push(node);
    }
    const nextPath = new Set([...visiting, item]);
    for (const [inputItem, inputRate] of sumMaterial(fresh.flatMap((node) => node.inputs))) add(inputItem, inputRate, nextPath);
  }
  add(itemId, perMinute, new Set());
  return added;
}
