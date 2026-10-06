// @vitest-environment node
import { expect, it } from "vitest";
import type { BlueprintPlannerRequest, BlueprintPlannerTaskFile } from "@/domain/blueprint-planner";
import { createRegistryContract } from "@/registry";
import { createProductionNetwork } from "@/blueprint-planner/production-network";
import { PlannerPlacement, placeProduction } from "@/blueprint-planner/placement";
import { addTerminals } from "@/blueprint-planner/terminals";
import { capturePlannerSeed, plannerRequestKey } from "@/blueprint-planner/search-seed";
import { PlannerSearchPortfolio, resolvePlannerAttempt } from "@/blueprint-planner/search-portfolio";
import { plannerOutputModeKey } from "@/blueprint-planner/output-policy";
import { emptyPlannerCheckpoint, parsePlannerTaskFile, PLANNER_ALGORITHM_VERSION } from "@/blueprint-planner/task-checkpoint";
import separator from "./fixtures/separator-core.json";
import yazhen from "./fixtures/yazhen-syringe.json";

function input(): BlueprintPlannerRequest {
  const base = structuredClone(separator.request) as BlueprintPlannerRequest;
  const component = structuredClone(yazhen.request.plan.recipes[0]!);
  return { ...base, plan: { ...base.plan, recipes: [...base.plan.recipes, component],
    externalSupplies: [...base.plan.externalSupplies, { itemId: "item_copper_nugget", perMinute: 60 }],
    targets: [...base.plan.targets, ...component.outputs],
  }, options: { ...base.options, itemPolicies: [
    { itemId: "item_copper_jar", supply: "warehouse" }, { itemId: "item_xiranite_powder", supply: "external" },
    { itemId: "item_filter_core", output: "stash" }, { itemId: component.outputs[0]!.itemId, output: "warehouse" },
  ] } };
}

it("同一产线按物品建立不同输入和输出设施，产线来源不变", async () => {
  const registry = createRegistryContract(), request = input(), original = JSON.stringify(request);
  const network = createProductionNetwork(registry, request), placement = new PlannerPlacement(registry, 80, 8, 2);
  await placeProduction(registry, network, placement, 0);
  addTerminals(registry, network, placement);
  const source = (id: string) => network.nodes.filter(node => node.purpose === "supply" && node.outputs.some(flow => flow.itemId === id));
  const output = (id: string) => network.nodes.filter(node => node.purpose === "product" && node.inputs.some(flow => flow.itemId === id));
  expect(source("item_copper_jar").every(node => node.definition.id === "unloader_1")).toBe(true);
  expect(source("item_xiranite_powder")).toHaveLength(1);
  expect(source("item_xiranite_powder")[0]!.external).toBe(true);
  expect(output("item_filter_core").map(node => node.definition.id)).toEqual(["storager_1"]);
  expect(output(request.plan.targets[1]!.itemId).every(node => node.definition.id === "loader_1")).toBe(true);
  expect(JSON.stringify(request)).toBe(original);
});

it("自动输出搜索混合组合，固定供给和去向不会被覆盖，种子池可恢复", () => {
  const registry = createRegistryContract(), base = input();
  const request: BlueprintPlannerRequest = { ...base, options: { ...base.options, itemPolicies: base.options.itemPolicies!.map(policy =>
    policy.output ? { ...policy, output: "auto" } : policy) } };
  const portfolio = new PlannerSearchPortfolio(request), combinations = new Set<string>();
  for (let variant = 0; variant < 4; variant++) {
    const attempt = resolvePlannerAttempt(request, variant);
    combinations.add(attempt.request.options.itemPolicies!.filter(policy => policy.output).map(policy => policy.output).join("/"));
    expect(attempt.request.options.itemPolicies![1]!.supply).toBe("external");
    portfolio.remember(capturePlannerSeed(attempt.request, createProductionNetwork(registry, attempt.request), [], [], 40, 40));
  }
  expect(combinations).toEqual(new Set(["stash/stash", "warehouse/warehouse", "warehouse/stash", "stash/warehouse"]));
  const copy = new PlannerSearchPortfolio(request);
  copy.restore(JSON.parse(JSON.stringify(portfolio.snapshot())));
  expect(copy.snapshot().pools).toHaveLength(4);
  for (let i = 0; i < 4; i++) expect(copy.next(i).seed?.requestKey).toBe(plannerRequestKey(resolvePlannerAttempt(request, i).request));
  const changed = structuredClone(portfolio.snapshot());
  const seed = changed.pools[0]!.entries[0]!.seed;
  Object.assign(seed.network.request.options.itemPolicies![1]!, { supply: "warehouse" });
  expect(() => copy.restore(changed)).toThrow("固定的物品规则");
});

it("四个逐物品输出组合连同检查点可以导出导入，修改规则会隔离旧种子", () => {
  const registry = createRegistryContract(), base = input();
  const request: BlueprintPlannerRequest = { ...base, options: { ...base.options, itemPolicies: base.options.itemPolicies!.map(policy =>
    policy.output ? { ...policy, output: "auto" } : policy) } };
  const portfolio = new PlannerSearchPortfolio(request);
  for (let variant = 0; variant < 4; variant++) {
    const attempt = resolvePlannerAttempt(request, variant);
    portfolio.remember(capturePlannerSeed(attempt.request, createProductionNetwork(registry, attempt.request), [], [], 40, 40));
    expect(plannerOutputModeKey(attempt.request.options)).toContain(":");
  }
  const file: BlueprintPlannerTaskFile = { formatVersion: 1, algorithmVersion: PLANNER_ALGORITHM_VERSION,
    taskId: "items", request, checkpoint: { ...emptyPlannerCheckpoint(), portfolio: portfolio.snapshot() },
    progress: { taskId: "items", status: "waiting", phase: "preparing", startedAt: 1, elapsedMs: 0, estimatedProgress: null,
      candidateCount: 0, evaluatedProposals: 0, roundEvaluatedProposals: 0, validatedCandidateCount: 0, bestArea: null, message: null } };
  const parsed = parsePlannerTaskFile(JSON.parse(JSON.stringify(file)), registry);
  expect(parsed.request.options.itemPolicies).toEqual(request.options.itemPolicies);
  expect(parsed.checkpoint.portfolio.pools).toHaveLength(4);
  expect(() => new PlannerSearchPortfolio(base).restore(parsed.checkpoint.portfolio)).toThrow();
});

it("目标物品保持输出，无销毁配方的剩余按指定去向输出", async () => {
  const registry = createRegistryContract(), base = input(), component = base.plan.targets[1]!.itemId;
  for (const mode of ["destroy", "output"] as const) {
    const request: BlueprintPlannerRequest = { ...base, plan: { ...base.plan, targets: [base.plan.targets[0]!] },
      options: { ...base.options, itemPolicies: [
        { itemId: "item_filter_core", output: "stash", byproducts: "destroy" },
        { itemId: component, output: "warehouse", byproducts: mode },
      ] } };
    const network = createProductionNetwork(registry, request), placement = new PlannerPlacement(registry, 80, 8, 2);
    await placeProduction(registry, network, placement, 0);
    addTerminals(registry, network, placement);
    expect(network.nodes.filter(node => node.purpose === "product").some(node => node.inputs.some(flow => flow.itemId === "item_filter_core"))).toBe(true);
    const sink = network.nodes.filter(node => node.purpose === "byproduct" && node.inputs.some(flow => flow.itemId === component));
    expect(sink.length).toBeGreaterThan(0);
    // AI-REMOVED 2026-10-03:
    // Reason: 无合法销毁配方时，应按物品配置的去向输出。
    // Trigger: 用户授权修正本次新增测试中的错误预期。
    // Evidence: item_copper_cmpt 无合法销毁配方；addTerminals 的 destroy 选项仅在可销毁时生效。
    // Replacement: 下方验证两种处理方式均使用已配置的仓库输出。
    // Risk: Low，合法销毁及目标物品保护由本文件其他用例覆盖。
    // Human Review: Required
    //
    // Original code:
    // expect(sink.every(node => mode === "destroy" ? node.recipe !== null && node.recipe.outputs.length === 0 : node.definition.id === "loader_1")).toBe(true);
    expect(sink.every(node => node.definition.id === "loader_1")).toBe(true);
  }
});

it("混合物流设施通过真实 Worker 布线和 Dense 2 tick/s 产量验收", async () => {
  const { runPlannerBatch } = await import("@/scripts/eda/planner-runner");
  const result = await runPlannerBatch(input(), { engineKind: "dense-v2", attempts: 1, localEvaluations: 5_000 });
  expect(result.successes).toBe(1);
  expect(result.records[0]!.constraints).toEqual({ placementErrors: [], excessiveOperatingInputs: [] });
  expect(result.records[0]!.itemPolicies).toEqual(input().options.itemPolicies);
  expect(result.records[0]!.measuredOutputs?.map(output => output.perMinute)).toEqual([60, 60]);
  // AI-CORRECTION 2026-10-06: 原断言内嵌 POSIX 分隔符，Windows 上 edaOutputPath 返回反斜杠路径必然失败；改为按分隔符归一后比较，预期语义不变。
  const artifactPath = result.records[0]!.artifactPath;
  expect(artifactPath).toBeDefined();
  expect(artifactPath!.replaceAll("\\", "/")).toContain(".temp/eda/success/");
}, 120_000);

it.each([
  { itemId: "item_liquid_sewage", recipeId: "r_chrono_liquid_furnace_refined_copper_from_copper_ore_basic", target: false, destroyable: true },
  { itemId: "item_liquid_acid", recipeId: "liquid_transmuter_1_liquid_liquid_acid_1", target: false, destroyable: false },
  { itemId: "item_liquid_sewage", recipeId: "r_chrono_liquid_furnace_refined_copper_from_copper_ore_basic", target: true, destroyable: true },
])("合法处置与虚拟设备回退：$itemId，目标=$target", async ({ itemId, recipeId, target, destroyable }) => {
  const registry = createRegistryContract(), base = structuredClone(separator.request) as BlueprintPlannerRequest;
  const recipe = registry.queries.findRecipeDefinition(recipeId)!;
  const inputs = recipe.inputs.map(flow => ({ itemId: flow.itemId, perMinute: flow.amount * 30 }));
  const outputs = recipe.outputs.map(flow => ({ itemId: flow.itemId, perMinute: flow.amount * 30 }));
  const runningInputs = itemId === "item_liquid_acid" ? [{ itemId: "item_liquid_xiranite", perMinute: 6 }] : [];
  for (const byproducts of ["destroy", "output"] as const) {
    const request: BlueprintPlannerRequest = { ...base, plan: { ...base.plan,
      recipes: [...base.plan.recipes, { recipeId, cyclesPerMinute: 30, deviceCount: 1, inputs, outputs, runningInputs }],
      externalSupplies: [...base.plan.externalSupplies, ...inputs, ...runningInputs],
      targets: [...base.plan.targets, ...outputs.filter(flow => target || flow.itemId !== itemId)],
    }, options: { ...base.options, itemPolicies: [{ itemId, byproducts }] } };
    const network = createProductionNetwork(registry, request), placement = new PlannerPlacement(registry, 80, 8, 2);
    await placeProduction(registry, network, placement, 0);
    addTerminals(registry, network, placement);
    const sinks = network.nodes.filter(node => node.purpose === (target ? "product" : "byproduct")
      && node.inputs.some(flow => flow.itemId === itemId));
    expect(sinks.map(node => node.definition.id)).toEqual([destroyable && !target && byproducts === "destroy" ? "liquid_cleaner_1" : "udpipe_loader_1"]);
    expect(network.nodes.some(node => node.definition.id === "dumper_1")).toBe(false);
    expect(sinks.flatMap(node => node.inputs).reduce((sum, flow) => sum + flow.perMinute, 0)).toBe(30);
  }
});
