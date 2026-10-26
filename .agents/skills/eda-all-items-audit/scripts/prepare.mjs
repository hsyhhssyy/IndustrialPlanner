import assert from "node:assert/strict";
import { mkdir, rm, rename, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { register } from "tsx/esm/api";
import { ROOT, SKILL, OUTPUT, LATEST, WORK, readJson, saveJson, hash, fingerprint, writeHistory, measureMilestones, selectAuditCases } from "./common.mjs";
import { parseAreaFormula } from "./area-formula.mjs";
import { buildFrozen } from "./test-build.mjs";
import { stageAlgorithmSource } from "./algorithm-source.mjs";

/** Extend + Compose：当前 Registry、正式产线求解/适配器及原生 Host，无历史运行目录依赖。 */
export async function prepare(formula = null, algorithmRef = null, selectedItemIds = null) {
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
  const plantMachines = new Set(["seedcol_1", "planter_1", "planter_1_liquid"]);
  const nonPlantCycles = result => {
    const cycles = [];
    const visit = (node, path) => {
      if (node.isCycleSource) {
        const loop = path.slice(path.findIndex(parent => parent.itemId === node.itemId));
        if (!loop.every(parent => plantMachines.has(index.recipeById.get(parent.recipeNode?.recipeId)?.machineId))) cycles.push(loop.map(parent => parent.itemId));
        return;
      }
      if (node.recipeNode) for (const child of [...node.recipeNode.inputItems, ...node.recipeNode.deviceMinimumConsumptionItems]) visit(child, [...path, node]);
    };
    for (const root of result.roots) visit(root, []);
    return cycles;
  };
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
    const queue = [{ ...policy.recipeChoices, [itemId]: recipe.id }], visited = new Set();
    let chosen = null;
    while (queue.length && visited.size < 2048) {
      const choices = queue.shift(), key = JSON.stringify(Object.entries(choices).sort());
      if (visited.has(key)) continue;
      visited.add(key);
      const request = { targets, supplies: [], infiniteItemIds: new Set(["item_liquid_sewage"]), recipeChoices: new Map(Object.entries(choices)), sourceConfig, useModules: false };
      try {
        const result = model.computeProductionPlan({ ...request, sourceConfig: { ...sourceConfig, includeDeviceMinimumConsumption: "ceil" } }, index);
        const cycles = nonPlantCycles(result);
        const plan = createBlueprintPlannerPlan({ request, index, activeActivityIds, sourceBaseId: policy.sourceBaseId, name: `全物品 ${name} ${perMinute}/min` });
        const passed = result.unresolvedPerMinute <= 0.0001 && cycles.length === 0
          && plan.recipes.some(entry => entry.outputs.some(output => output.itemId === itemId));
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
    const randomSeed = Number.parseInt(hash(`${policy.seedNamespace}:${itemId}`).slice(0, 8), 16);
    cases.push({ itemId, name, perMinute, recipeId: recipe.id, recipeChoices: chosen.choices,
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
    firstLimit: 20_000_000, totalLimit: 50_000_000, windows: policy.windows, state: "prepared" };
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
  const { execFileSync } = await import("node:child_process");
  const { browserScenario } = await import("./browser-scenario.mjs");
  await writeFile(resolve(staging, "runtime/browser-scenario.txt"), browserScenario.toString());
  await writeFile(resolve(staging, "runtime/measure.txt"), measureMilestones.toString());
  execFileSync("tar", ["-czf", resolve(staging, "runtime/bundle.tar.gz"), "-C", resolve(staging, "runtime"), "dist", "cases.json", "browser-scenario.txt", "measure.txt"]);
  manifest.bundleSha256 = hash(await (await import("node:fs/promises")).readFile(resolve(staging, "runtime/bundle.tar.gz")));
  await saveJson(resolve(staging, "manifest.json"), manifest);
  await mkdir(OUTPUT, { recursive: true });
  // 2026-10-26 用户明确要求：新一轮清理上轮任务，仅轮换本技能自有 latest，历史 CSV 保留。
  await rm(LATEST, { recursive: true, force: true });
  await rename(staging, LATEST);
  await writeHistory(manifest, []);
  return { runId, items: selectedCases.length, preparationFailed: selectedCases.filter(item => item.preparationError).length, formula: formula ?? "Host 默认公式",
    algorithmVersion: manifest.algorithmVersion, algorithmSource: historical?.metadata.reference ?? "当前工作区" };
}
