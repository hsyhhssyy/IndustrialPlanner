import { describe, expect, it } from "vitest";
import type { BlueprintPlannerRequest } from "@/domain/blueprint-planner";
import { createWorkspaceState } from "@/domain/document/workspace-state";
// AI-REMOVED 2026-10-05:
// Reason: 存取线改为盒外边界，统一仓库口与外接入口布局。
// Trigger: 用户确认外部存取线、最多连续面数及外接传送带互斥规则。
// Evidence: 旧实现固定设施撑大包围盒并进入面积与导出。
// Replacement: @/scripts/eda/placement-scene
// Risk: 旧搜索种子失效，按算法版本重置。
// Human Review: Required
// Original code:
// import { createWorldDocument } from "@/domain/document/world-document";
import { createPlannerPlacementRegistry, createPlannerPlacementScene } from "@/scripts/eda/placement-scene";
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
      app: null, editor: null, render: null, simulation: null, sync: null, audio: null, blueprintPlanner: null,
    };
    const host = createSimulationHost(workspace, { engineKind: "dense-v2", workerMode: "runtime", blueprintDenseTickRate: 2 });
    try {
      const deadline = performance.now() + 90_000;
      const candidate = await createPlannerCandidate(workspace.registry, request, variant,
        () => { if (performance.now() >= deadline) throw new Error("布局验证超时"); }, () => {});
      // AI-REMOVED 2026-10-12:
      // Reason: 虚构地图身份使结构化白名单验收失真，且不应修改原 Registry。
      // Trigger: 用户授权修正 EDA 验收上下文，保留验收目标、断言和真实设备规则。
      // Evidence: 新增白名单回归通过；旧场景使用未注册于设备白名单的临时地图 ID。
      // Replacement: @/scripts/eda/placement-scene#createPlannerPlacementRegistry
      // Risk: 临时几何只验收模板，实际地图落位仍须按真实几何检查。
      // Human Review: Required
      //
      // Original code:
      //       workspace.registry.baseDefinitions = [...workspace.registry.baseDefinitions, {
      //         id: "eda-validation-land", name: "空地校验", tag: "武陵", tags: ["武陵"],
      //         placeableArea: { width: 1000, height: 1000 }, outerRing: { top: 0, right: 0, bottom: 0, left: 0 }, builtinEntities: [],
      //       }];
      const validationRegistry = createPlannerPlacementRegistry(workspace.registry, candidate.execution.blueprint.baseId,
        { width: 1000, height: 1000 });
// AI-REMOVED 2026-10-05:
// Reason: 存取线改为盒外边界，统一仓库口与外接入口布局。
// Trigger: 用户确认外部存取线、最多连续面数及外接传送带互斥规则。
// Evidence: 旧实现固定设施撑大包围盒并进入面积与导出。
// Replacement: @/scripts/eda/placement-scene
// Risk: 旧搜索种子失效，按算法版本重置。
// Human Review: Required
// Original code:
//       const document = createWorldDocument({ baseId: "eda-validation-land" });
//       document.entities = candidate.execution.blueprint.entities;
//       document.entityOrder = candidate.execution.blueprint.entityOrder;
//       document.slotLinks = candidate.execution.blueprint.slotLinks;
//       // 2026-10-05：交付蓝图不含存取线，施工检查按用户补齐外部存取线后的场景进行。
//       const buses = candidate.execution.scene.externalEntities.filter(entity => entity.definitionId === "log_hongs_bus" || entity.definitionId === "log_hongs_bus_source");
//       document.entities = { ...document.entities, ...Object.fromEntries(buses.map(entity => [entity.id, entity])) };
//       document.entityOrder = [...document.entityOrder, ...buses.map(entity => entity.id)];
      const document = createPlannerPlacementScene(validationRegistry, candidate.execution);
      const placement = resolvePlacementValidations({ document, workspace: { ...workspace, registry: validationRegistry }, state: createEditorStateReadWrite() });
      expect(Object.entries(placement).filter(([, result]) => !result.canPlace)).toEqual([]);
      // 取货口必须只凭交付蓝图配置持续供料，不能依赖验证场景覆盖库存来掩盖导出缺失。
      const report = await host.actions.runBlueprint({ ...candidate.execution, maxWallTimeMs: 240_000,
        scene: { ...candidate.execution.scene, initialSlots: candidate.execution.scene.initialSlots.filter(slot =>
          candidate.execution.blueprint.entities[slot.entityId]?.definitionId !== "unloader_1") } });
      expect(report.status).toBe("completed");
      expect(report.diagnostics.filter((entry) => entry.severity === "error")).toEqual([]);
      expect(report.probes[0]?.perMinute).toBeGreaterThanOrEqual(30);
      expect(report.deviceStatuses.some((entry) => ["no-power", "not-in-power-net"].includes(entry.status))).toBe(false);
      expect(candidate.metrics.productionDeviceCount).toBe(request.plan.recipes.filter((recipe) => !recipe.recipeId.startsWith("r_gas_diffuser_")).reduce((sum, recipe) => sum + Math.ceil(recipe.deviceCount), 0));
      expect(Object.values(candidate.execution.blueprint.entities).some((entity) => entity.definitionId.startsWith("cheat_"))).toBe(false);
      expect(JSON.stringify(request)).toBe(before);
      for (const entity of Object.values(candidate.execution.blueprint.entities).filter(entity => entity.definitionId === "unloader_1")) {
        expect(entity.config["storageSlotGroups[0].slots[0].ignoreStock"]).toBe(true);
        expect(entity.config["storageSlotGroups[0].slots[0].initialCount"]).toBeGreaterThan(0);
      }
      for (const entity of Object.values(candidate.execution.blueprint.entities).filter(entity =>
        entity.definitionId === "udpipe_unloader_1" || entity.definitionId === "udpipe_unloader_2")) {
        const links = candidate.execution.blueprint.slotLinks.filter(link => link.source.entityId === entity.id);
        expect(links).toHaveLength(1);
        expect(links[0]).toMatchObject({ linkType: "share-all",
          source: { entityId: entity.id, storageSlotGroupId: "unloader_buffer", slotId: "slot_1" },
          target: { entityId: "warehouse", storageSlotGroupId: "warehouse" } });
        expect(entity.config["storageSlotGroups[0].slots[0].ignoreStock"]).toBe(true);
        expect(entity.config["storageSlotGroups[0].slots[0].initialCount"]).toBeUndefined();
        expect(entity.config["storageSlotGroups[0].slots[0].initialItemType"]).toBeUndefined();
        expect(entity.config["storageSlotGroups[0].slots[0].lock"]).toBeUndefined();
      }
      if (request.options.plantStartup === "warehouse") {
        const startup = Object.values(candidate.execution.blueprint.entities).find((entity) => entity.id.startsWith("eda-startup-admission-"));
        expect(Object.values(startup!.config)).toContainEqual({ itemId: request.plan.targets[0]!.itemId, limit: 29, perMinuteLimit: null });
      }
      await saveSuccessfulPlanning(workspace.registry, `${request.plan.name}-${request.options.plantStartup}-${variant}`,
        candidate.execution.blueprint, request, { variant, engineKind: "dense-v2", ticksPerSecond: 2, metrics: candidate.metrics, report });
    } finally { host.dispose(); }
  }, 360_000);
});
