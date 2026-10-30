import assert from "node:assert/strict";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { register } from "tsx/esm/api";
import { ROOT, SKILL, OUTPUT, WORK, readJson, saveJson, hash, fingerprint, writeHistory, measureMilestones, selectAuditCases, executionIdentity } from "./common.mjs";
import { parseAreaFormula } from "./area-formula.mjs";
import { buildFrozen } from "./test-build.mjs";
import { stageAlgorithmSource } from "./algorithm-source.mjs";
import { replacePreparedRun } from "./result-retention.mjs";

/** 复用正式循环诊断，先选出闭合产线再调用会拒绝错误循环的 EDA 适配器。 */
export function selectClosedProductionPlan(itemId, recipeId, policy, index, model, evaluate) {
  const queue = [{ ...policy.recipeChoices, [itemId]: recipeId }], visited = new Set();
  let chosen = null;
  while (queue.length && visited.size < 2048) {
    const choices = queue.shift(), key = JSON.stringify(Object.entries(choices).sort());
    if (visited.has(key)) continue;
    visited.add(key);
    try {
      const { result, build } = evaluate(choices);
      const cycles = result.cycleIssues.map(issue => [...issue.itemIds]);
      const plan = result.unresolvedPerMinute <= 0.0001 && cycles.length === 0 ? build() : null;
      const passed = !!plan && plan.recipes.some(entry => entry.outputs.some(output => output.itemId === itemId));
      if (!chosen || passed || cycles.length < chosen.cycles.length) chosen = { plan, passed, cycles, choices,
        preparationError: passed ? null : `需求未闭合：缺口 ${result.unresolvedPerMinute}；非植物循环 ${JSON.stringify(cycles)}` };
      if (passed || cycles.length === 0) break;
      for (const cycleItem of new Set(cycles.flat())) {
        if (cycleItem === itemId || policy.recipeChoices[cycleItem]) continue;
        for (const alternative of index.recipesByOutputItem.get(cycleItem) ?? []) {
          if (!model.isRecipeExcludedFromProductionPlanningAuto(alternative, index) && alternative.id !== choices[cycleItem]) queue.push({ ...choices, [cycleItem]: alternative.id });
        }
      }
    } catch (error) {
      chosen ??= { passed: false, cycles: [], choices, plan: null, preparationError: String(error) };
    }
  }
  return chosen;
}

/** Extend + Compose：当前 Registry、正式产线求解/适配器及原生 Host，无历史运行目录依赖。 */
export async function prepare(formula = null, algorithmRef = null, selectedItemIds = null, searchMode = 2) {
  assert([1, 2, 3, 4].includes(searchMode), "搜索模式必须为 1、2、3 或 4。");
  const formulaTree = formula === null ? null : parseAreaFormula(formula);
  const policy = await readJson(resolve(SKILL, "policy.json"));
  const before = await fingerprint();
  register({ tsconfig: resolve(ROOT, "tsconfig.app.json") });
  const load = path => import(pathToFileURL(resolve(ROOT, path)).href);
  const [{ createRegistryContract }, model, { createBlueprintPlannerPlan }, { ProductionPlanningInputStore }, { ACTIVITY_DEFINITIONS }, { lookupText }, { PLANNER_ALGORITHM_VERSION }] = await Promise.all([
    load("src/registry/index.ts"), load("src/app/shell/production-planning/production-planning-model.ts"),
    load("src/app/shell/production-planning/blueprint-planner-adapter.ts"), load("src/app/shell/production-planning/production-planning-state.ts"),
    load("src/shared/registry/activity-availability.ts"), load("src/shared/i18n/index.ts"), load("src/blueprint-planner/search-policy.ts"),
  ]);
  const registry = createRegistryContract(), activeActivityIds = ACTIVITY_DEFINITIONS.map(activity => activity.id);
  const index = model.buildProductionPlanningIndex(registry, { activeActivityIds, includeInactiveActivityContent: false });
  const sourceConfig = new ProductionPlanningInputStore().sourceConfig;
  assert.equal(sourceConfig.sewagePolicy, "external-supply", "默认污水来源已变化，需审查测试口径。");
  // AI-REMOVED 2026-10-30:
  // Reason: 正式模型已提供 cycleIssues，重复树遍历在 EDA 适配器抛错前未能驱动选方重试。
  // Trigger: 工业爆炸物和高晶零件的紫晶互转循环导致请求准备失败。
  // Evidence: computeProductionPlan 返回 cycleIssues；createBlueprintPlannerPlan 在原队列展开前抛出错误循环。
  // Replacement: selectClosedProductionPlan 使用正式 cycleIssues，闭合后才调用适配器。
  // Risk: 不改变生产算法、目标产率或政策锁定的配方；只修正专项准备顺序。
  // Human Review: Required
  // Original code:
  // const plantMachines = new Set(["seedcol_1", "planter_1", "planter_1_liquid"]);
  // const nonPlantCycles = result => {
  //   const cycles = [];
  //   const visit = (node, path) => {
  //     if (node.isCycleSource) {
  //       const loop = path.slice(path.findIndex(parent => parent.itemId === node.itemId));
  //       if (!loop.every(parent => plantMachines.has(index.recipeById.get(parent.recipeNode?.recipeId)?.machineId))) cycles.push(loop.map(parent => parent.itemId));
  //       return;
  //     }
  //     if (node.recipeNode) for (const child of [...node.recipeNode.inputItems, ...node.recipeNode.deviceMinimumConsumptionItems]) visit(child, [...path, node]);
  //   };
  //   for (const root of result.roots) visit(root, []);
  //   return cycles;
  // };
  const industrial = [...index.recipesByOutputItem].filter(([, recipes]) => recipes.some(recipe => !recipe.tags.includes("自然资源采集")));
  const cases = [];
  for (const [itemId, recipes] of industrial.sort(([a], [b]) => a.localeCompare(b))) {
    if (policy.excludedItems[itemId]) continue;
    const name = lookupText("zh-CN", index.itemById.get(itemId).nameKey) ?? itemId;
    const candidates = recipes.filter(recipe => !recipe.tags.includes("自然资源采集") && recipe.durationSeconds > 0);
    const recipe = policy.recipeChoices[itemId] ? index.recipeById.get(policy.recipeChoices[itemId])
      : model.resolveProductionPlanningAutoRecipe(candidates, index) ?? candidates[0];
    assert(recipe, `找不到目标配方：${itemId}`);
    const perMinute = recipe.outputs.find(output => output.itemId === itemId).amount * 60 / recipe.durationSeconds;
    const targets = [{ id: `target-${itemId}`, itemId, perMinute }];
    // AI-REMOVED 2026-10-30:
    // Reason: 原选方循环在识别非法循环后仍立即调用适配器，抛错后无法展开备用配方。
    // Trigger: 两个指定物品在搜索前准备失败，无法交付原生 EDA 任务。
    // Evidence: 生成的 cases.json 记录紫晶纤维与紫晶粉末互转错误；正式 result.cycleIssues 已包含可选方的物品。
    // Replacement: 上方 selectClosedProductionPlan 与下方正式模型回调。
    // Risk: 仅闭合方案进入 EDA；保留原 2048 次准备上限和 policy 配方约束。
    // Human Review: Required
    // Original code:
    // const queue = [{ ...policy.recipeChoices, [itemId]: recipe.id }], visited = new Set();
    // let chosen = null;
    // while (queue.length && visited.size < 2048) {
    //   const choices = queue.shift(), key = JSON.stringify(Object.entries(choices).sort());
    //   if (visited.has(key)) continue;
    //   visited.add(key);
    //   const request = { targets, supplies: [], infiniteItemIds: new Set(["item_liquid_sewage"]), recipeChoices: new Map(Object.entries(choices)), sourceConfig, useModules: false };
    //   try {
    //     const result = model.computeProductionPlan({ ...request, sourceConfig: { ...sourceConfig, includeDeviceMinimumConsumption: "ceil" } }, index);
    //     const cycles = nonPlantCycles(result);
    //     const plan = createBlueprintPlannerPlan({ request, index, activeActivityIds, sourceBaseId: policy.sourceBaseId, name: `全物品 ${name} ${perMinute}/min` });
    //     const passed = result.unresolvedPerMinute <= 0.0001 && cycles.length === 0
    //       && plan.recipes.some(entry => entry.outputs.some(output => output.itemId === itemId));
    //     if (!chosen || passed || cycles.length < chosen.cycles.length) chosen = { plan, passed, cycles, choices,
    //       preparationError: passed ? null : `需求未闭合：缺口 ${result.unresolvedPerMinute}；非植物循环 ${JSON.stringify(cycles)}` };
    //     if (passed || cycles.length === 0) break;
    //     for (const cycleItem of new Set(cycles.flat())) {
    //       if (cycleItem === itemId || policy.recipeChoices[cycleItem]) continue;
    //       for (const alternative of index.recipesByOutputItem.get(cycleItem) ?? []) {
    //         if (!model.isRecipeExcludedFromProductionPlanningAuto(alternative, index) && alternative.id !== choices[cycleItem]) queue.push({ ...choices, [cycleItem]: alternative.id });
    //       }
    //     }
    //   } catch (error) {
    //     chosen ??= { passed: false, cycles: [], choices, plan: null, preparationError: String(error) };
    //   }
    // }
    const chosen = selectClosedProductionPlan(itemId, recipe.id, policy, index, model, choices => {
      const request = { targets, supplies: [], infiniteItemIds: new Set(["item_liquid_sewage"]), recipeChoices: new Map(Object.entries(choices)), sourceConfig, useModules: false };
      return { result: model.computeProductionPlan({ ...request, sourceConfig: { ...sourceConfig, includeDeviceMinimumConsumption: "ceil" } }, index),
        build: () => createBlueprintPlannerPlan({ request, index, activeActivityIds, sourceBaseId: policy.sourceBaseId, name: `全物品 ${name} ${perMinute}/min` }) };
    });
    const randomSeed = Number.parseInt(hash(`${policy.seedNamespace}:${itemId}`).slice(0, 8), 16);
    cases.push({ itemId, name, perMinute, searchMode, recipeId: recipe.id, recipeChoices: chosen.choices,
      preparationError: chosen.preparationError, request: chosen.plan ? { plan: chosen.plan, options: {
        warehousePortPlacement: "continuous", solidSupply: "warehouse", fluidSupply: "conduit", warehouseBus: "straight", solidOutput: "stash",
        byproducts: "output", plantStartup: "preload", converterStartup: "reject", evaluationsPerRound: 20_000_000,
        concurrency: 24, gpu: true, randomSeed, stopAfterFirstSolution: false, deterministicSearch: false,
      } } : null });
  }
  assert(cases.length > 0, "当前 Registry 没有可测试的工业物品。");
  const selectedCases = selectAuditCases(cases, selectedItemIds);
  const runId = `${new Date().toISOString().replace(/[-:.]/g, "")}-${process.pid}`;
  const staging = resolve(WORK, "prepared");
  await rm(staging, { recursive: true, force: true });
  await mkdir(resolve(staging, "runtime"), { recursive: true });
  const manifest = { formatVersion: 1, runId, createdAt: new Date().toISOString(), formula, formulaTree,
    seedNamespace: policy.seedNamespace, algorithmVersion: PLANNER_ALGORITHM_VERSION, sourceHash: hash(JSON.stringify(before)),
    itemIds: selectedCases.map(item => item.itemId), selectedItemIds, excludedItems: policy.excludedItems, activeActivityIds, testOnly: true,
    searchMode, firstLimit: 20_000_000, totalLimit: [3, 4].includes(searchMode) ? null : 50_000_000, windows: policy.windows, state: "prepared" };
  await saveJson(resolve(staging, "manifest.json"), manifest);
  await saveJson(resolve(staging, "runtime/cases.json"), selectedCases);
  await saveJson(resolve(staging, "runtime/source-fingerprint.json"), before);
  const historical = algorithmRef === null ? null : await stageAlgorithmSource(algorithmRef);
  try {
    if (historical) {
      manifest.algorithmVersion = historical.metadata.algorithmVersion;
      manifest.algorithmSource = historical.metadata;
      manifest.sourceHash = hash(JSON.stringify({ current: before, historical: historical.metadata }));
      await saveJson(resolve(staging, "runtime/algorithm-source.json"), historical.metadata);
    }
    await buildFrozen(staging, manifest, historical?.root ?? ROOT);
    await historical?.verify();
  } finally { await historical?.dispose(); }
  assert.deepEqual(await fingerprint(), before, "准备或构建期间工作区变化；本轮未替换 latest，请重新准备。");
  manifest.executionIdentity = executionIdentity(manifest, before);
  const { execFileSync } = await import("node:child_process");
  const { browserScenario } = await import("./browser-scenario.mjs");
  await writeFile(resolve(staging, "runtime/browser-scenario.txt"), browserScenario.toString());
  await writeFile(resolve(staging, "runtime/measure.txt"), measureMilestones.toString());
  execFileSync("tar", ["-czf", resolve(staging, "runtime/bundle.tar.gz"), "-C", resolve(staging, "runtime"), "dist", "cases.json", "browser-scenario.txt", "measure.txt"]);
  manifest.bundleSha256 = hash(await (await import("node:fs/promises")).readFile(resolve(staging, "runtime/bundle.tar.gz")));
  await saveJson(resolve(staging, "manifest.json"), manifest);
  await mkdir(OUTPUT, { recursive: true });
  // 2026-10-26 用户明确要求：新一轮清理上轮任务，仅轮换本技能自有 latest，历史 CSV 保留。
  // AI-CORRECTION 2026-10-30：改为按物品保留最新已结算结果；轮换 latest 前先迁出旧结果，后续新结果验收落盘才替换。
  // AI-REMOVED 2026-10-30:
  // Reason: 准备新轮次时删除上轮全部任务会在新结果出现前丢失最后可用结果。
  // Trigger: 用户要求每个物品获取最新结果后再删除旧结果。
  // Evidence: 原 prepare 在构建成功后直接 rm(LATEST)，collect 尚未回收任何新结果。
  // Replacement: result-retention.mjs 的 replacePreparedRun、acceptCollectedResult。
  // Risk: 迁移失败会阻止轮换，避免丢失旧结果。
  // Human Review: Required
  // Original code:
  // await rm(LATEST, { recursive: true, force: true });
  // await rename(staging, LATEST);
  await replacePreparedRun(staging);
  await writeHistory(manifest, []);
  return { runId, searchMode, items: selectedCases.length, preparationFailed: selectedCases.filter(item => item.preparationError).length, formula: formula ?? "Host 默认公式",
    algorithmVersion: manifest.algorithmVersion, algorithmSource: historical?.metadata.reference ?? "当前工作区" };
}
