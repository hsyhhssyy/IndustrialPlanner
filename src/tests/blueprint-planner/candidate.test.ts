import { describe, expect, it } from "vitest";
import type { BlueprintPlannerRequest } from "@/domain/blueprint-planner";
import { createWorkspaceState } from "@/domain/document/workspace-state";
import { createWorldDocument } from "@/domain/document/world-document";
import type { WorkspaceContract } from "@/domain/document/workspace-contract";
import { createRegistryContract } from "@/registry";
import { createSimulationHost } from "@/simulation/simulation-host";
import { resolvePlacementValidations } from "@/editor/placement-validation";
import { createEditorStateReadWrite } from "@/editor/state-impl";
import { createPlannerCandidate } from "@/blueprint-planner/candidate";
import { createProductionNetwork, validatePlannerRequest } from "@/blueprint-planner/production-network";
import nugget from "./fixtures/pyrrolite-nugget.json";
import ore from "./fixtures/pyrrolite-ore.json";
import plantPreload from "./fixtures/plant-preload.json";
import plantWarehouse from "./fixtures/plant-warehouse.json";
import planterPreload from "./fixtures/plant-planter-preload.json";
import planterWarehouse from "./fixtures/plant-planter-warehouse.json";
import { saveSuccessfulPlanning } from "@/scripts/eda/artifacts";

const scenarios = [
  { name: "灼铜块：赤铜块外供", input: nugget, variant: 0 },
  { name: "灼铜块：赤铜矿外供", input: ore, variant: 5 },
  { name: "植物循环：预置 50 个", input: plantPreload, variant: 0 },
  { name: "植物循环：仓库启动", input: plantWarehouse, variant: 7 },
  { name: "种植增产循环：预置 50 个", input: planterPreload, variant: 0 },
  { name: "种植增产循环：仓库启动", input: planterWarehouse, variant: 0 },
];

describe("EDA 固定生产方案", () => {
  it("拒绝模块和未配平方案；设备小数向上取整并保持配方", () => {
    const registry = createRegistryContract();
    const request = structuredClone(nugget.request) as BlueprintPlannerRequest;
    expect(() => validatePlannerRequest(registry, { ...request, plan: { ...request.plan, containsModules: true } })).toThrow("模块");
    expect(() => validatePlannerRequest(registry, { ...request, plan: { ...request.plan, unresolvedPerMinute: 1 } })).toThrow("未满足");
    const network = createProductionNetwork(registry, request);
    expect(network.nodes).toHaveLength(request.plan.recipes.reduce((sum, recipe) => sum + Math.ceil(recipe.deviceCount), 0));
    expect(network.nodes.filter((node) => node.recipe?.id === "liquid_transmuter_1_gas_gas_acid_1")).toHaveLength(1);
    expect(new Set(network.nodes.map((node) => node.recipe?.id))).toEqual(new Set(request.plan.recipes.map((recipe) => recipe.recipeId)));
  });

  it.each(scenarios)("$name：生成物理产线并在独立仿真中达到目标", async ({ input, variant }) => {
    const request = structuredClone(input.request) as BlueprintPlannerRequest;
    const before = JSON.stringify(request);
    const workspace: WorkspaceContract = {
      state: createWorkspaceState(), registry: createRegistryContract(),
      app: null, editor: null, render: null, simulation: null, sync: null, blueprintPlanner: null,
    };
    const host = createSimulationHost(workspace, { engineKind: "dense-v2", workerMode: "runtime", blueprintDenseTickRate: 2 });
    try {
      const deadline = performance.now() + 90_000;
      const candidate = await createPlannerCandidate(workspace.registry, request, variant,
        () => { if (performance.now() >= deadline) throw new Error("布局验证超时"); }, () => {});
      workspace.registry.baseDefinitions = [...workspace.registry.baseDefinitions, {
        id: "eda-validation-land", name: "空地校验", tag: "武陵", tags: ["武陵"],
        placeableArea: { width: 1000, height: 1000 }, outerRing: { top: 0, right: 0, bottom: 0, left: 0 }, builtinEntities: [],
      }];
      const document = createWorldDocument({ baseId: "eda-validation-land" });
      document.entities = candidate.execution.blueprint.entities;
      document.entityOrder = candidate.execution.blueprint.entityOrder;
      document.slotLinks = candidate.execution.blueprint.slotLinks;
      const placement = resolvePlacementValidations({ document, workspace, state: createEditorStateReadWrite() });
      expect(Object.entries(placement).filter(([, result]) => !result.canPlace)).toEqual([]);
      const report = await host.actions.runBlueprint({ ...candidate.execution, maxWallTimeMs: 240_000 });
      expect(report.status).toBe("completed");
      expect(report.diagnostics.filter((entry) => entry.severity === "error")).toEqual([]);
      expect(report.probes[0]?.perMinute).toBeGreaterThanOrEqual(30);
      expect(report.deviceStatuses.some((entry) => ["no-power", "not-in-power-net"].includes(entry.status))).toBe(false);
      expect(candidate.metrics.productionDeviceCount).toBe(request.plan.recipes.filter((recipe) => !recipe.recipeId.startsWith("r_gas_diffuser_")).reduce((sum, recipe) => sum + Math.ceil(recipe.deviceCount), 0));
      expect(Object.values(candidate.execution.blueprint.entities).some((entity) => entity.definitionId.startsWith("cheat_"))).toBe(false);
      expect(JSON.stringify(request)).toBe(before);
      if (request.options.plantStartup === "warehouse") {
        const startup = Object.values(candidate.execution.blueprint.entities).find((entity) => entity.id.startsWith("eda-startup-admission-"));
        expect(Object.values(startup!.config)).toContainEqual({ itemId: request.plan.targets[0]!.itemId, limit: 29, perMinuteLimit: null });
      }
      await saveSuccessfulPlanning(workspace.registry, `${request.plan.name}-${request.options.plantStartup}-${variant}`,
        candidate.execution.blueprint, request, { variant, engineKind: "dense-v2", ticksPerSecond: 2, metrics: candidate.metrics, report });
    } finally { host.dispose(); }
  }, 360_000);
});
