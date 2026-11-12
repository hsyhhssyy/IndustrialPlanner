// @vitest-environment node
import { describe, expect, it } from "vitest";
import type { BlueprintPlannerManualBindingMode, BlueprintPlannerManualLayout, BlueprintPlannerRequest } from "@/domain/blueprint-planner";
import { createRegistryContract } from "@/registry";
import { createManualProductionNetwork, prepareManualLayout, stabilizeManualNodes, verifyManualPreparation } from "@/blueprint-planner/manual-layout";
import { assertManualEntities, assertManualLayoutReady, bindManualPositions, manualNodeView, matchManualPlacements, validateManualLayout } from "@/blueprint-planner/manual-constraints";
import { prepareProductionDevices } from "@/blueprint-planner/production-preparation";
import { createPlainNode, PlannerPlacement } from "@/blueprint-planner/placement";
import type { PlannerNetwork } from "@/blueprint-planner/model";
import { resolveSearchProfile } from "@/blueprint-planner/search-profile";
import { CompactLayoutSearch } from "@/blueprint-planner/compact-layout";
import { capturePlannerSeed, restorePlannerSeed } from "@/blueprint-planner/search-seed";
import { wireProductionNetwork } from "@/blueprint-planner/wiring";
import { assertManualTopology } from "@/blueprint-planner/manual-verification";
import input from "./fixtures/environment-supply.json";
import separator from "./fixtures/separator-core.json";
import { createPlannerCandidate } from "@/blueprint-planner/candidate";
import { createWorkspaceState } from "@/domain/document/workspace-state";
import type { WorkspaceContract } from "@/domain/document/workspace-contract";
import { createSimulationHost } from "@/simulation/simulation-host";
import { assertPlannerWarehousePorts } from "@/blueprint-planner/verification";
import { fixedOutlineMinimum, initialPlannerOutline, plannerDeviceArea } from "@/blueprint-planner/search-outline";

const registry = createRegistryContract();
function request(mode: BlueprintPlannerManualBindingMode = "recipe"): BlueprintPlannerRequest {
  return { ...structuredClone(input) as BlueprintPlannerRequest, manualLayout: { enabled: true, mode, facilities: [], placements: [],
    preparation: { sourceKey: "", nodes: [], connections: [], facilityTemplates: [], placementIssues: [] } } };
}
async function prepare(value: BlueprintPlannerRequest): Promise<BlueprintPlannerRequest & { manualLayout: BlueprintPlannerManualLayout }> {
  return { ...value, manualLayout: { ...value.manualLayout!, preparation: await prepareManualLayout(registry, value) } };
}

describe("人工设备约束", () => {
  it("初始搜索尺寸包含尚未生成的人工仓库与出口，停用草稿恢复普通下界", async () => {
    const base = await prepare({ ...structuredClone(separator.request) as BlueprintPlannerRequest, manualLayout: request().manualLayout });
    const referenceNode = base.manualLayout.preparation.nodes.find(node => node.purpose === "product")!;
    const current = await prepare({ ...base, manualLayout: { ...base.manualLayout,
      placements: [{ referenceNode, position: { x: 40, y: 30 }, rotation: 90 }] } });
    const network = createManualProductionNetwork(registry, current);
    expect(network.nodes.some(node => node.entity.id === referenceNode.id)).toBe(false);
    const minimum = fixedOutlineMinimum(registry, network.nodes, current.manualLayout);
    const footprint = registry.queries.findEntityDefinition(referenceNode.definitionId)!.footprint;
    expect(minimum.width).toBeGreaterThanOrEqual(40 + footprint.height);
    expect(minimum.height).toBeGreaterThanOrEqual(30 + footprint.width);
    const outline = initialPlannerOutline(plannerDeviceArea(registry, network.nodes), minimum, 0);
    expect(outline.width).toBeGreaterThanOrEqual(minimum.width);
    expect(outline.height).toBeGreaterThanOrEqual(minimum.height);
    expect(fixedOutlineMinimum(registry, network.nodes, { ...current.manualLayout, enabled: false }))
      .toEqual(fixedOutlineMinimum(registry, network.nodes));
  });
  it.each(["recipe", "topology"] as const)("%s：同物料的两个职责按模式决定能否互换，未摆的上下游同样受第三档约束", async mode => {
    const sources = [0, 1].map(index => {
      const node = createPlainNode(registry, "furnance_1", `source-${index}`, "production");
      node.outputs.push({ itemId: "item_copper_nugget", perMinute: 30 });
      node.entity.position = { x: index * 20, y: 0 }; return node;
    });
    const consumers = [0, 1].map(index => {
      const node = createPlainNode(registry, "shaper_1", `target-${index}`, "production");
      node.inputs.push({ itemId: "item_copper_nugget", perMinute: 30 });
      node.entity.position = { x: (1 - index) * 20, y: 5 }; return node;
    });
    const current = request(mode);
    const network: PlannerNetwork = { request: { ...current, manualLayout: { ...current.manualLayout!, preparation: {
      ...current.manualLayout!.preparation, nodes: [...sources, ...consumers].map(manualNodeView),
      connections: sources.map((node, index) => ({ sourceNodeId: node.entity.id, targetNodeId: consumers[index]!.entity.id,
        itemId: "item_copper_nugget", perMinute: 30 })),
    } } }, nodes: [...sources, ...consumers], slotLinks: [], initialSlots: [], preferredGasCount: 0 };
    const wires = await wireProductionNetwork(registry, network, new PlannerPlacement(registry, 50, 0, 0, 1), undefined, true);
    expect(wires.find(wire => wire.target.entityId === "target-0")?.source.entityId).toBe(mode === "topology" ? "source-0" : "source-1");
    assertManualTopology(registry, network, wires);
  });
  it("真实候选保留人工设备和冗余电力设施，严格拓扑下自动完成其余布局并达到产量", async () => {
    const base = await prepare({ ...structuredClone(separator.request) as BlueprintPlannerRequest, manualLayout: request("topology").manualLayout });
    const referenceNode = base.manualLayout.preparation.nodes.find(node => node.purpose === "production")!;
    const power = base.manualLayout.preparation.facilityTemplates.find(template => template.definitionId === "power_diffuser_1")!;
    const powerId = "manual-facility-fixed-power";
    const current = await prepare({ ...base, manualLayout: { ...base.manualLayout, facilities: [{ ...power, id: powerId }], placements: [
      { referenceNode, position: { x: 5, y: 5 }, rotation: 0 },
      { referenceNode: { ...power, id: powerId, inputs: [], outputs: [] }, position: { x: 15, y: 15 }, rotation: 0 },
    ] } });
    const deadline = performance.now() + 60_000;
    const candidate = await createPlannerCandidate(registry, current, 0,
      () => { if (performance.now() > deadline) throw new Error("人工布局验证超时"); }, () => {},
      { maxEvaluations: 50_000, outline: { width: 30, height: 24 } });
    assertManualEntities(current, Object.values(candidate.execution.blueprint.entities));
    assertPlannerWarehousePorts(registry, current, candidate);
    expect(candidate.execution.blueprint.entities[powerId]?.position).toEqual({ x: 15, y: 15 });
    const workspace: WorkspaceContract = { state: createWorkspaceState(), registry, app: null, editor: null, render: null,
      simulation: null, sync: null, audio: null, blueprintPlanner: null };
    const simulation = createSimulationHost(workspace, { engineKind: "dense-v2", workerMode: "runtime", blueprintDenseTickRate: 2 });
    try {
      const report = await simulation.actions.runBlueprint(candidate.execution);
      expect(report.status).toBe("completed");
      expect(report.probes.find(probe => probe.id === "item_filter_core")?.perMinute).toBeGreaterThanOrEqual(60);
    } finally { simulation.dispose(); }
  }, 90_000);
  it("三档匹配分别约束设备、配方及实例，超额组让用户选择保留位置", async () => {
    const current = await prepare(request()), first = current.manualLayout.preparation.nodes.find(node => node.purpose === "production")!;
    const old = { ...first, id: "previous-role", recipeId: "previous-recipe" };
    const pinned = [{ referenceNode: old, position: { x: 5, y: 5 }, rotation: 0 as const }];
    expect(matchManualPlacements([first], pinned, "device").issues).toEqual([]);
    expect(matchManualPlacements([first], pinned, "recipe").issues[0]?.kind).toBe("excess");
    expect(matchManualPlacements([first], [{ ...pinned[0]!, referenceNode: { ...first, id: old.id } }], "topology").issues[0]?.kind).toBe("role-removed");
    const same = [{ ...pinned[0]!, referenceNode: first }, { ...pinned[0]!, referenceNode: { ...first, id: "second-role" } }];
    expect(matchManualPlacements([first], same, "recipe").issues).toEqual([{ kind: "excess", nodeIds: [first.id, "second-role"], excessCount: 1 }]);
  });

  it("环境增删全量重算，保留冗余人工设施，失效位置不反向产生需求", async () => {
    const base = await prepare(request());
    const template = base.manualLayout.preparation.facilityTemplates.find(entry => entry.recipeId === "r_gas_diffuser_acid_gas_environment_basic")!;
    expect(template).toBeDefined();
    const expanded = await prepare({ ...base, manualLayout: { ...base.manualLayout,
      facilities: Array.from({ length: 12 }, (_, index) => ({ ...template, id: `manual-facility-${index}` })) } });
    const producer = (value: typeof expanded) => value.manualLayout.preparation.nodes.filter(node => node.recipeId === "liquid_transmuter_1_gas_gas_acid_1");
    expect(producer(expanded).length).toBeGreaterThan(producer(base).length);
    expect(expanded.manualLayout.preparation.nodes.filter(node => node.id.startsWith("manual-facility-"))).toHaveLength(12);
    const shrunk = await prepare({ ...expanded, manualLayout: { ...expanded.manualLayout, facilities: [],
      placements: producer(expanded).map((referenceNode, index) => ({ referenceNode, position: { x: 10 * index, y: 10 }, rotation: 0 })) } });
    expect(producer(shrunk)).toHaveLength(producer(base).length);
    expect(shrunk.manualLayout.placements).toHaveLength(producer(expanded).length);
    expect(shrunk.manualLayout.preparation.placementIssues.some(issue => issue.kind === "excess")).toBe(true);
    expect(() => assertManualLayoutReady(registry, shrunk)).toThrow("标红");
    expect(() => validateManualLayout(registry, shrunk)).not.toThrow();
    expect(() => assertManualLayoutReady(registry, { ...shrunk, manualLayout: { ...shrunk.manualLayout, enabled: false } })).not.toThrow();
  });

  it("外供环境耗材不会新增生产设备，电力模板可重复保留", async () => {
    const original = request();
    const base = await prepare({ ...original, plan: { ...original.plan,
      supplyPolicies: [{ itemId: "item_gas_acid", source: "external" }] } });
    const environment = base.manualLayout.preparation.facilityTemplates.find(entry => entry.recipeId === "r_gas_diffuser_acid_gas_environment_basic")!;
    const power = base.manualLayout.preparation.facilityTemplates.find(entry => entry.purpose === "power")!;
    const current = await prepare({ ...base, manualLayout: { ...base.manualLayout,
      facilities: [environment, environment, power, power].map((template, index) => ({ ...template, id: `manual-facility-${index}` })) } });
    expect(current.manualLayout.preparation.nodes.filter(node => node.purpose === "production" || node.purpose === "auxiliary")).toHaveLength(1);
    expect(current.manualLayout.preparation.nodes.filter(node => node.purpose === "power")).toHaveLength(2);
    expect(current.manualLayout.preparation.nodes.every(node => !registry.queries.isGeneralLogisticsDevice(node.definitionId))).toBe(true);
    await expect(verifyManualPreparation(registry, current)).resolves.toBeUndefined();
  });

  it("准备清单排除热能池和洒水机，旧草稿可保留但不能开始规划", async () => {
    const base = await prepare(request("topology"));
    expect(base.manualLayout.preparation.facilityTemplates.some(entry => ["power_sta_1", "squirter_1"].includes(entry.definitionId))).toBe(false);
    const facility = { id: "manual-facility-unsupported", definitionId: "power_sta_1", recipeId: "r_power_gen_originium_ore", purpose: "power" as const };
    const current = { ...base, manualLayout: { ...base.manualLayout, facilities: [facility],
      placements: [{ referenceNode: { ...facility, inputs: [], outputs: [] }, position: { x: 0, y: 0 }, rotation: 0 as const }] } };
    expect(() => validateManualLayout(registry, current)).not.toThrow();
    expect(() => assertManualLayoutReady(registry, current)).toThrow("不支持热能池");
    await expect(prepareManualLayout(registry, current)).rejects.toThrow("不在当前可用");
    await expect(prepareManualLayout(registry, { ...current, manualLayout: { ...current.manualLayout, facilities: [], placements: [] } })).resolves.toBeDefined();
  });

  it.each(["device", "recipe", "topology"] as const)("%s：搜索与种子恢复不移动人工位姿，严格拓扑保留未摆节点关系", async mode => {
    const base = await prepare(request(mode));
    const referenceNode = base.manualLayout.preparation.nodes.find(node => node.purpose === "production")!;
    const current = await prepare({ ...base, manualLayout: { ...base.manualLayout,
      placements: [{ referenceNode, position: { x: 10, y: 10 }, rotation: 90 }] } });
    const network = createManualProductionNetwork(registry, current);
    const placement = new PlannerPlacement(registry, 70, 1, 1, 1, 1);
    await prepareProductionDevices(registry, network, placement, 0, resolveSearchProfile(), { strategy: "compact" }, () => {});
    stabilizeManualNodes(registry, network, current.manualLayout.preparation); bindManualPositions(registry, network);
    placement.remove([...placement.placed]); placement.reserve(network.nodes);
    const wires = await wireProductionNetwork(registry, network, placement, undefined, true);
    const statistics = { seed: 1, evaluationLimit: 100, evaluations: 0, acceptedMoves: 0, routingAttempts: 0,
      initialWireLength: 0, finalWireLength: 0, outline: { width: 70, height: 70 }, strategy: "compact" as const };
    const search = new CompactLayoutSearch(registry, network, wires, statistics);
    await search.advance(100, () => {}); search.applyBest();
    assertManualEntities(current, network.nodes.map(node => node.entity));
    assertManualTopology(registry, network, wires);
    const seed = capturePlannerSeed(current, network, wires, [], 70, 70);
    const restored = restorePlannerSeed(registry, current, seed);
    expect(restored.network.nodes.find(node => node.manualPlacement)?.entity).toMatchObject({ position: { x: 10, y: 10 }, rotation: 90 });
    const missingFlags = { ...seed, network: { ...seed.network,
      nodes: seed.network.nodes.map(node => ({ ...node, manualPlacement: undefined })) } };
    expect(restorePlannerSeed(registry, current, missingFlags).network.nodes.filter(node => node.manualPlacement)).toHaveLength(1);
    expect(() => assertManualEntities(current, network.nodes.filter(node => !node.manualPlacement).map(node => node.entity))).toThrow("人工固定");
  });

  it("禁止通过 purpose 伪装物流设备，拒绝过期或伪造的准备数据", async () => {
    const current = await prepare(request());
    const node = current.manualLayout.preparation.nodes[0]!;
    const logistics = registry.entityDefinitions.find(definition => registry.queries.isGeneralLogisticsDevice(definition.id))!;
    expect(() => validateManualLayout(registry, { ...current, manualLayout: { ...current.manualLayout,
      placements: [{ referenceNode: { ...node, definitionId: logistics.id, recipeId: null, purpose: "power" }, position: { x: 0, y: 0 }, rotation: 0 }] } })).toThrow();
    const changed = { ...current, options: { ...current.options, warehouseBus: "corner" as const } };
    expect(() => assertManualLayoutReady(registry, changed)).toThrow("重新准备");
    const forged = { ...current, manualLayout: { ...current.manualLayout, preparation: { ...current.manualLayout.preparation,
      nodes: current.manualLayout.preparation.nodes.map((entry, index) => index === 0 ? { ...entry, outputs: entry.outputs.map(flow => ({ ...flow, perMinute: flow.perMinute * 2 })) } : entry) } } };
    await expect(verifyManualPreparation(registry, forged)).rejects.toThrow("过期");
  });
});

// AI-REMOVED 2026-11-11:
// Reason: 用户明确取消热能池的人工添加，原正向用例不再成立。
// Trigger: REQ-047 人工设备范围收紧。
// Evidence: manualFacilityTemplates 使用共享设备资格。
// Replacement: 上方不支持设备与旧草稿校验用例。
// Risk: Low。Human Review: Required
// Original code:
//   it("发电设备可重复添加，其燃料需求和供料关系进入冻结清单", async () => {
//     const base = await prepare(request("topology"));
//     const template = base.manualLayout.preparation.facilityTemplates.find(entry => entry.recipeId === "r_power_gen_originium_ore")!;
//     expect(template).toBeDefined();
//     const current = await prepare({ ...base, manualLayout: { ...base.manualLayout,
//       facilities: [0, 1].map(index => ({ ...template, id: `manual-facility-generator-${index}` })) } });
//     const generators = current.manualLayout.preparation.nodes.filter(node => node.definitionId === "power_sta_1");
//     expect(generators).toHaveLength(2);
//     for (const node of generators) {
//       expect(node.inputs).toEqual([{ itemId: "item_originium_ore", perMinute: 7.5 }]);
//       expect(current.manualLayout.preparation.connections.filter(edge => edge.targetNodeId === node.id)
//         .reduce((sum, edge) => sum + edge.perMinute, 0)).toBe(7.5);
//     }
//     expect(createManualProductionNetwork(registry, current).nodes.filter(node => node.recipe?.powerOutput)).toHaveLength(2);
//     await expect(verifyManualPreparation(registry, current)).resolves.toBeUndefined();
//   });
