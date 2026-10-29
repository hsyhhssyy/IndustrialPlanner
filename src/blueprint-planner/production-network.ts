import { resolveProductivePlantCycleRate } from "@/shared/planner-plant-cycle";
import { assertPlannerTaskCycles } from "@/shared/planner-cycle";
import { PlannerItemRules, plannerDisposalItem } from "@/shared/planner-item-policy";
import type { BlueprintPlannerRequest } from "@/domain/blueprint-planner";
import type { RegistryContract } from "@/domain/registry/registry-contract";
import type { RecipeDefinition } from "@/domain/registry/types/recipe-definition";
import { isRecipeAvailableByActivity } from "@/shared/registry/activity-availability";
import { buildDeviceRunningConsumptionRecipesByMachine, resolveCompanionDeviceRunningConsumptionRecipe } from "@/shared/device-running-consumption";
// AI-REMOVED 2026-10-03:
// Reason: 配方筛选由共享供料规则负责。Trigger: 环境供料统一来源选择。
// Evidence: 当前函数使用 PlannerSupplyRules；Replacement: shared/planner-supply.ts。
// Risk: Low；Human Review: Required。
// Original code:
// import { CONSUMPTION_RECIPE_TAG } from "@/shared/consumption-channel";
import { lookupText } from "@/shared/i18n";
import { PlannerSupplyRules } from "@/shared/planner-supply";
import { PlannerCandidateError, sumMaterial, type PlannerNetwork, type PlannerNode } from "./model";

const EPSILON = 1e-6;

/** 自然采集只描述物料来源；保留用户选定的所有实际加工配方。 */
// AI-CORRECTION 2026-10-21：已声明副产物的纯处置沿用 EDA 去向；输出模式不实例化计算器附带的销毁设备，生产性加工仍全部保留。
export function normalizePlannerSources(registry: RegistryContract, request: BlueprintPlannerRequest): BlueprintPlannerRequest {
  const supplies = sumMaterial(request.plan.externalSupplies);
  const itemRules = new PlannerItemRules(registry, request.options);
  const internal = new Set([
    ...request.plan.supplyPolicies?.flatMap(policy => policy.source === "production" ? [policy.itemId] : []) ?? [],
    ...request.plan.recipes.flatMap(entry => {
      const recipe = registry.queries.findRecipeDefinition(entry.recipeId);
      return recipe && !recipe.tags.includes("自然资源采集") ? recipe.outputs.map(output => output.itemId) : [];
    }),
  ]);
  const recipes = request.plan.recipes.filter((entry) => {
    const recipe = registry.queries.findRecipeDefinition(entry.recipeId);
    const disposalItem = recipe && plannerDisposalItem(recipe);
    if (disposalItem && request.plan.byproductItemIds.includes(disposalItem)
      && itemRules.byproducts(disposalItem) === "output") return false;
    if (!recipe?.tags.includes("自然资源采集")) return true;
    for (const output of recipe.outputs) supplies.set(output.itemId,
      (supplies.get(output.itemId) ?? 0) + output.amount * entry.cyclesPerMinute);
    return false;
  });
  return { ...request, plan: { ...request.plan, recipes,
    externalSupplies: [...supplies].map(([itemId, perMinute]) => ({ itemId, perMinute })),
    infiniteItemIds: [...new Set([...request.plan.infiniteItemIds,
      ...request.plan.supplyPolicies?.flatMap(policy => policy.source === "external" ? [policy.itemId] : []) ?? [],
      ...registry.itemDefinitions.filter((item) => item.tags.includes("自然资源") && !internal.has(item.id)).map((item) => item.id)])],
  } };
}

export function createProductionNetwork(registry: RegistryContract, request: BlueprintPlannerRequest): PlannerNetwork {
  validatePlannerRequest(registry, request);
  assertPlannerTaskCycles(registry, request.plan);
  request = normalizePlannerSources(registry, request);
  const nodes: PlannerNode[] = [];
  let preferredGasCount = 0;
  for (const plan of request.plan.recipes) {
    const recipe = registry.queries.findRecipeDefinition(plan.recipeId)!;
    const count = Math.ceil(plan.deviceCount - EPSILON);
    const isEnvironment = recipe.environmentOutput !== undefined;
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
    recipe.environmentOutput !== undefined ? entry.type === "consumption-channel" : entry.type !== "consumption-channel");
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
  new PlannerItemRules(registry, options);
  if (options.warehousePortPlacement !== undefined && !["any", "continuous", "full-side"].includes(options.warehousePortPlacement)) throw new Error("未知取货口摆放规则。");
  if (options.warehousePortPlacement === "full-side" && options.warehouseBus !== "straight") throw new Error("连续且占据一边要求存取线使用一面。");
  if (!["straight", "corner", "u-shaped"].includes(options.warehouseBus)) throw new Error("未知存取线形态。");
  if (!["warehouse", "stash", "auto"].includes(options.solidOutput)) throw new Error("未知固体输出方式。");
  if (plan.containsModules) throw new Error("包含模块的规划不能自动规划产线。");
  if (!Number.isFinite(plan.unresolvedPerMinute) || plan.unresolvedPerMinute < 0 || plan.unresolvedPerMinute > EPSILON) throw new Error("产线规划仍有未满足需求，请先补齐生产方案。");
  // AI-REMOVED 2026-09-30:
  // Reason: 改为提案预算与真实累计计数，预览保留任务窗口。
  // Trigger: 用户批准本轮接口与交互调整。
  // Evidence: 原实现使用时间截止或关闭任务面板。
  // Replacement: src/blueprint-planner/production-network.ts
  // Risk: Low。Human Review: Required
  // Original code:
  //   if (!Number.isFinite(options.budgetMs) || options.budgetMs <= 0) throw new Error("规划时间必须大于零。");

  // AI-REMOVED 2026-10-21:
  // Reason: 网络入口不能拒绝累计预算的任意整数尾额。
  // Trigger: 用户要求累计 50M 完整执行；原取整使 v52 针剂少执行 8641 次。
  // Evidence: Host、任务导入和生产网络原有不同的整万/整千限制。
  // Replacement: 下方与 Host、task-checkpoint 一致的正安全整数校验。
  // Risk: 小尾批仍受搜索的统一硬预算限制。Human Review: Required
  // Original code:
  // if (!Number.isSafeInteger(options.evaluationsPerRound) || options.evaluationsPerRound < 1_000
  //   || options.evaluationsPerRound % 1_000 !== 0) throw new Error("每轮计算次数必须是大于零的 1000 整数倍。");
  if (!Number.isSafeInteger(options.evaluationsPerRound) || options.evaluationsPerRound <= 0) throw new Error("每轮计算次数必须为正安全整数。");
  if (!plan.targets.length || plan.targets.some((flow) => !Number.isFinite(flow.perMinute) || flow.perMinute <= 0)) {
    throw new Error("请提供有效的目标产物与产量。");
  }
  for (const recipePlan of plan.recipes) {
    const recipe = registry.queries.findRecipeDefinition(recipePlan.recipeId);
    if (recipe === null || !isRecipeAvailableByActivity(recipe, plan.activeActivityIds)) throw new Error(`配方当前不可用：${recipePlan.recipeId}`);
    if (recipe.tags.includes("StateControlled")) throw new Error(`阶段配方不能独立规划：${recipePlan.recipeId}`);
    if (![recipePlan.deviceCount, recipePlan.cyclesPerMinute].every((value) => Number.isFinite(value) && value > 0)) {
      throw new Error(`无效设备数量或配方流量：${recipePlan.recipeId}`);
    }
    if (recipe.tags.includes("自然资源采集")) continue;
    const device = registry.queries.findEntityDefinition(recipe.machineId);
    if (!device?.recipeChannels.some((entry) => recipe.environmentOutput !== undefined
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
  if (options.converterStartup !== undefined && !["manual", "tank", "reject"].includes(options.converterStartup)) throw new Error("未知转化设备启动方式。");
  const view = new PlannerSupplyRules(registry, plan, options.converterStartup).view();
  if (view.issues.length) {
    const issue = view.issues[0]!;
    if (issue.kind === "startup") {
      const item = registry.queries.findItemDefinition(issue.itemIds[0]!)!;
      throw new Error(`${lookupText("zh-CN", item.nameKey) ?? item.id} 自循环 需要外部启动器启动，请调整启动设置。`);
    }
    throw new Error(`${issue.kind === "cycle" ? "供料路线存在循环" : "缺少可用供料路线"}：${issue.itemIds.map(id => {
      const item = registry.queries.findItemDefinition(id);
      return item ? lookupText("zh-CN", item.nameKey) ?? id : id;
    }).join(" → ")}`);
  }
}

/** 只补充环境设施产生的额外需求；原有生产配方和数量保持不变。 */
// AI-CORRECTION 2026-10-03: 保持原配方和主体目标，允许已有生产设备增加负载以满足环境增量。
export function supplyAuxiliaryDemand(
  registry: RegistryContract, network: PlannerNetwork, itemId: string, perMinute: number,
): PlannerNode[] {
  const rules = new PlannerSupplyRules(registry, network.request.plan, network.request.options.converterStartup);
  const changed = new Set<PlannerNode>();
  const balance = (item: string) => network.nodes.reduce((sum, node) => sum
    + node.outputs.filter(flow => flow.itemId === item).reduce((total, flow) => total + flow.perMinute, 0)
    - node.inputs.filter(flow => flow.itemId === item).reduce((total, flow) => total + flow.perMinute, 0),
  -network.request.plan.targets.filter(flow => flow.itemId === item).reduce((sum, flow) => sum + flow.perMinute, 0));
  const cyclesFor = (recipe: RecipeDefinition, item: string) => network.nodes
    .filter(node => node.recipe?.id === recipe.id && node.purpose !== "environment")
    .reduce((sum, node) => sum + node.outputs.find(flow => flow.itemId === item)!.perMinute
      / recipe.outputs.find(flow => flow.itemId === item)!.amount, 0);
  const add = (item: string, rate: number, path: readonly string[]): void => {
    if (rate <= EPSILON) return;
    const policy = rules.resolve(item).policy;
    if (policy?.source === "external") return;
    if (!policy) throw new PlannerCandidateError(`气体环境的额外需求缺少可用来源：${item}`);
    if (path.includes(item)) throw new PlannerCandidateError(`辅助生产存在无法配平的循环：${[...path, item].join(" → ")}`);
    const recipe = registry.queries.findRecipeDefinition(policy.recipeId)!;
    const inputIncrease = new Map<string, number>();
    const expand = (currentRecipe: RecipeDefinition, outputItem: string, extraCycles: number, minimumDeviceCount = 0) => {
      const output = currentRecipe.outputs.find(flow => flow.itemId === outputItem)!;
      const maximumCycles = 60 / currentRecipe.durationSeconds;
      const self = rules.selfConsumption(currentRecipe);
      if (self && (self.netCapacityPerMinute <= EPSILON || (network.request.options.converterStartup ?? "reject") === "reject")) {
        throw new PlannerCandidateError(`辅助生产自循环无法启动：${outputItem}`);
      }
      let remaining = extraCycles;
      const grow = (node: PlannerNode | undefined, cycles: number) => {
        const previous = sumMaterial(node?.inputs ?? []);
        let sequence = network.nodes.length;
        while (!node && network.nodes.some(entry => entry.entity.id === `eda-aux-${sequence}`)) sequence++;
        const current = createRecipeNode(registry, currentRecipe, node?.entity.id ?? `eda-aux-${sequence}`,
          cycles, node?.purpose === "production" ? "production" : "auxiliary");
        for (const [input, value] of sumMaterial(current.inputs)) {
          if (input !== self?.itemId) inputIncrease.set(input,
            (inputIncrease.get(input) ?? 0) + value - (previous.get(input) ?? 0));
        }
        if (node) {
          node.inputs.splice(0, node.inputs.length, ...current.inputs);
          node.outputs.splice(0, node.outputs.length, ...current.outputs);
          changed.add(node);
        } else { network.nodes.push(current); changed.add(current); }
      };
      // 同一配方的已有设备先提高负载，达到容量后再增补实体；运行消耗按实际台数计算。
      for (const node of network.nodes.filter(entry => entry.recipe?.id === currentRecipe.id && entry.purpose !== "environment")) {
        const cycles = node.outputs.find(flow => flow.itemId === outputItem)!.perMinute / output.amount;
        const extra = Math.min(remaining, Math.max(0, maximumCycles - cycles));
        if (extra > EPSILON) { grow(node, cycles + extra); remaining -= extra; }
        if (remaining <= EPSILON) break;
      }
      while (remaining > EPSILON) {
        const cycles = Math.min(remaining + (self?.perMinute ?? 0) / output.amount, maximumCycles);
        if (self) remaining += self.perMinute / output.amount;
        grow(undefined, cycles); remaining -= cycles;
      }
      const nodes = network.nodes.filter(node => node.recipe?.id === currentRecipe.id && node.purpose !== "environment");
      if (nodes.length < minimumDeviceCount) {
        const cycles = cyclesFor(currentRecipe, outputItem) / minimumDeviceCount;
        for (const node of nodes) grow(node, cycles);
        for (let count = nodes.length; count < minimumDeviceCount; count++) grow(undefined, cycles);
      }
    };
    const pair = rules.plantCycle(item);
    const cycle = pair && !path.includes(pair.partnerItemId) ? resolveProductivePlantCycleRate({
      recipe, partnerRecipe: pair.partnerRecipe, itemId: item, externalDemand: rate,
      availablePartnerSupply: Math.max(0, balance(pair.partnerItemId)),
      existingCyclesPerMinute: cyclesFor(recipe, item),
      existingPartnerCyclesPerMinute: cyclesFor(pair.partnerRecipe, pair.partnerItemId),
    }) : null;
    if (cycle && pair) {
      // 先同时扩充回路两侧，回流不再作为递归外需求；只向上游传播循环外原料与运行耗材。
      expand(recipe, item, cycle.cyclesPerMinute, cycle.minimumDeviceCount);
      expand(pair.partnerRecipe, pair.partnerItemId, cycle.partnerCyclesPerMinute, cycle.minimumPartnerDeviceCount);
    } else {
      expand(recipe, item, rate / recipe.outputs.find(flow => flow.itemId === item)!.amount);
    }
    for (const [input, increase] of inputIncrease) {
      if (cycle && (input === item || input === cycle.partnerItemId)) continue;
      // 先消耗全网已有余量；不能借补料顺带掩盖主方案原本的缺口。
      const deficit = Math.min(increase, Math.max(0, -balance(input)));
      add(input, deficit, [...path, item]);
    }
  };
  add(itemId, perMinute, []);
  return [...changed];
}

// AI-REMOVED 2026-10-20:
// Reason: 将配方扩产与依赖递归分开，使合法植物回路两侧先完成净产配平。
// Trigger: 环境补料进入采种/种植回路时被路径重复检查拒绝。
// Evidence: 主规划已有正净产回路，旧 add 逐物料递归无法闭合。
// Replacement: 上方 expand、rules.plantCycle 与 shared/planner-plant-cycle.ts。
// Risk: 扩产台数和运行耗材影响来源审计；Human Review: Required。
// Original code:
//   const add = (item: string, rate: number, path: readonly string[]): void => {
//     if (rate <= EPSILON) return;
//     const policy = rules.resolve(item).policy;
//     if (policy?.source === "external") return;
//     if (!policy) throw new PlannerCandidateError(`气体环境的额外需求缺少可用来源：${item}`);
//     if (path.includes(item)) throw new PlannerCandidateError(`辅助生产存在无法配平的循环：${[...path, item].join(" → ")}`);
//     const recipe = registry.queries.findRecipeDefinition(policy.recipeId)!;
//     const output = recipe.outputs.find(flow => flow.itemId === item)!;
//     const maximumCycles = 60 / recipe.durationSeconds;
//     const self = rules.selfConsumption(recipe);
//     if (self && (self.netCapacityPerMinute <= EPSILON || (network.request.options.converterStartup ?? "reject") === "reject")) {
//       throw new PlannerCandidateError(`辅助生产自循环无法启动：${item}`);
//     }
//     let remaining = rate / output.amount;
//     const inputIncrease = new Map<string, number>();
//     const grow = (node: PlannerNode | undefined, cycles: number) => {
//       const previous = sumMaterial(node?.inputs ?? []);
//       let sequence = network.nodes.length;
//       while (!node && network.nodes.some(entry => entry.entity.id === `eda-aux-${sequence}`)) sequence++;
//       const current = createRecipeNode(registry, recipe, node?.entity.id ?? `eda-aux-${sequence}`,
//         cycles, node?.purpose === "production" ? "production" : "auxiliary");
//       for (const [input, value] of sumMaterial(current.inputs)) inputIncrease.set(input,
//         (inputIncrease.get(input) ?? 0) + value - (previous.get(input) ?? 0));
//       if (node) {
//         node.inputs.splice(0, node.inputs.length, ...current.inputs);
//         node.outputs.splice(0, node.outputs.length, ...current.outputs);
//         changed.add(node);
//       } else { network.nodes.push(current); changed.add(current); }
//     };
//     // 同一配方的已有设备先提高负载，达到容量后再增补实体；运行消耗按实际台数计算。
//     for (const node of network.nodes.filter(entry => entry.recipe?.id === recipe.id && entry.purpose !== "environment")) {
//       const cycles = node.outputs.find(flow => flow.itemId === item)!.perMinute / output.amount;
//       const extra = Math.min(remaining, Math.max(0, maximumCycles - cycles));
//       if (extra > EPSILON) { grow(node, cycles + extra); remaining -= extra; }
//       if (remaining <= EPSILON) break;
//     }
//     while (remaining > EPSILON) {
//       const cycles = Math.min(remaining + (self?.perMinute ?? 0) / output.amount, maximumCycles);
//       if (self) remaining += self.perMinute / output.amount;
//       grow(undefined, cycles); remaining -= cycles;
//     }
//     for (const [input, increase] of inputIncrease) {
//       if (input === self?.itemId) continue;
//       // 先消耗全网已有余量；不能借补料顺带掩盖主方案原本的缺口。
//       const deficit = Math.min(increase, Math.max(0, -balance(input)));
//       add(input, deficit, [...path, item]);
//     }
//   };

// AI-REMOVED 2026-10-03:
// Reason: 辅助供料改用与界面共用的按物品规则，并优先扩展已有设备产能。
// Trigger: 用户授权环境供料配置，要求沿用自产/外供选择并支持按实际需求扩产。
// Evidence: 旧算法只从已实例化配方猜测来源，每次递归单独增补设备，无法携带待用路线。
// Replacement: 本文件 supplyAuxiliaryDemand 与 shared/planner-supply.ts。
// Risk: 辅助产能分配和默认路线发生变化，需 Worker 与 Dense 验证；Human Review: Required。
// Original code:
// export function supplyAuxiliaryDemand(
//   registry: RegistryContract, network: PlannerNetwork, itemId: string, perMinute: number,
// ): PlannerNode[] {
//   const allowedSources = new Set([...network.request.plan.infiniteItemIds, ...network.request.plan.externalSupplies.map((entry) => entry.itemId)]);
//   const chosen = new Set(network.request.plan.recipes.map((entry) => entry.recipeId));
//   const selectedByOutput = new Map<string, Set<string>>();
//   for (const recipeId of chosen) {
//     for (const output of registry.queries.findRecipeDefinition(recipeId)!.outputs) {
//       const ids = selectedByOutput.get(output.itemId) ?? new Set<string>();
//       ids.add(recipeId); selectedByOutput.set(output.itemId, ids);
//     }
//   }
//   const usable = registry.recipeDefinitions.filter((recipe) =>
//     !recipe.tags.includes(CONSUMPTION_RECIPE_TAG) && recipe.gasDiffusionOutput === undefined
//     && !recipe.tags.includes("自然资源采集")
//     && isRecipeAvailableByActivity(recipe, network.request.plan.activeActivityIds)
//     && !registry.queries.findEntityDefinition(recipe.machineId)?.placementBehaviors.some((behavior) => behavior.type === "snap-to-outer-ring-edge")
//     && !recipe.machineId.startsWith("cheat_"));
//   function findRecipe(item: string, visiting: ReadonlySet<string>): { recipe: RecipeDefinition; cost: number } | null {
//     if (visiting.has(item)) return null;
//     const costs = new Map([...allowedSources].map((source) => [source, 0]));
//     const choices = new Map<string, { recipe: RecipeDefinition; cost: number }>();
//     // 正成本松弛只接受从已知来源可达的方案，避免配方环导致指数递归。
//     for (let pass = 0; pass < usable.length; pass++) {
//       let changed = false;
//       for (const recipe of usable) {
//         if (recipe.inputs.some((input) => visiting.has(input.itemId))) continue;
//         const cost = (chosen.has(recipe.id) ? 0.5 : 1) + recipe.inputs.reduce((sum, input) => sum + (costs.get(input.itemId) ?? Infinity), 0);
//         if (!Number.isFinite(cost)) continue;
//         for (const output of recipe.outputs) {
//           const selected = selectedByOutput.get(output.itemId);
//           if (selected !== undefined && !selected.has(recipe.id)) continue;
//           if (output.amount <= 0 || visiting.has(output.itemId) || cost >= (costs.get(output.itemId) ?? Infinity)) continue;
//           costs.set(output.itemId, cost);
//           choices.set(output.itemId, { recipe, cost });
//           changed = true;
//         }
//       }
//       if (!changed) break;
//     }
//     return choices.get(item) ?? null;
//   }
//   const added: PlannerNode[] = [];
//   function add(item: string, rate: number, visiting: ReadonlySet<string>): void {
//     if (rate <= EPSILON || allowedSources.has(item)) return;
//     const choice = findRecipe(item, visiting);
//     if (choice === null) throw new PlannerCandidateError(`气体环境的额外需求缺少可用来源：${item}`);
//     const output = choice.recipe.outputs.find((entry) => entry.itemId === item)!;
//     const cycles = rate / output.amount;
//     const count = Math.ceil(cycles * choice.recipe.durationSeconds / 60 - EPSILON);
//     const fresh: PlannerNode[] = [];
//     for (let index = 0; index < count; index++) {
//       const node = createRecipeNode(registry, choice.recipe, `eda-aux-${network.nodes.length}`, cycles / count, "auxiliary");
//       network.nodes.push(node); added.push(node); fresh.push(node);
//     }
//     const nextPath = new Set([...visiting, item]);
//     for (const [inputItem, inputRate] of sumMaterial(fresh.flatMap((node) => node.inputs))) add(inputItem, inputRate, nextPath);
//   }
//   add(itemId, perMinute, new Set());
//   return added;
// }
