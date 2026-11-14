// @vitest-environment node
import { describe, expect, it } from "vitest";
import type { BlueprintPlannerManualBindingMode, BlueprintPlannerManualLayout, BlueprintPlannerRequest } from "@/domain/blueprint-planner";
import { createRegistryContract } from "@/registry";
import { createManualProductionNetwork, prepareManualLayout, stabilizeManualNodes, verifyManualPreparation } from "@/blueprint-planner/manual-layout";
import { assertManualEntities, assertManualLayoutReady, bindManualPositions, manualNodeView, matchManualPlacements, validateManualLayout } from "@/blueprint-planner/manual-constraints";
import { prepareProductionDevices } from "@/blueprint-planner/production-preparation";
import { createPlainNode, PlannerPlacement } from "@/blueprint-planner/placement";
import { PlannerCandidateError, type PlannerNetwork } from "@/blueprint-planner/model";
import { resolveSearchProfile } from "@/blueprint-planner/search-profile";
import { CompactLayoutSearch } from "@/blueprint-planner/compact-layout";
import { capturePlannerSeed, restorePlannerSeed } from "@/blueprint-planner/search-seed";
import { wireProductionNetwork } from "@/blueprint-planner/wiring";
import { assertManualTopology } from "@/blueprint-planner/manual-verification";
import input from "./fixtures/environment-supply.json";
import separator from "./fixtures/separator-core.json";
import unequalSupplies from "./fixtures/manual-unequal-supplies.json";
import frozenTerminals from "./fixtures/manual-frozen-terminals.json";
import retainedTerminals from "./fixtures/manual-retained-terminals.json";
import positionTopology from "./fixtures/manual-position-topology.json";
import touchingDevices from "./fixtures/manual-touching-devices.json";
import boundaryTopology from "./fixtures/manual-boundary-topology.json";
import narrowTerminal from "./fixtures/manual-narrow-terminal.json";
import { configureManualFrame } from "@/blueprint-planner/manual-frame";
import { createPlannerCandidate } from "@/blueprint-planner/candidate";
import { createWorkspaceState } from "@/domain/document/workspace-state";
import type { WorkspaceContract } from "@/domain/document/workspace-contract";
import { createSimulationHost } from "@/simulation/simulation-host";
import { assertPlannerWarehousePorts } from "@/blueprint-planner/verification";
import { transformManualPlacement } from "@/shared/geometry/manual-layout-transform";
import { fixedOutlineMinimum, initialPlannerOutline, plannerDeviceArea } from "@/blueprint-planner/search-outline";

const registry = createRegistryContract();
function request(mode: BlueprintPlannerManualBindingMode = "recipe"): BlueprintPlannerRequest {
  return { ...structuredClone(input) as BlueprintPlannerRequest, manualLayout: { enabled: true, mode, orientation: "fixed", boundary: { rotation: null, assignments: [] }, facilities: [], placements: [],
    preparation: { sourceKey: "", nodes: [], connections: [], facilityTemplates: [], placementIssues: [] } } };
}
async function prepare(value: BlueprintPlannerRequest): Promise<BlueprintPlannerRequest & { manualLayout: BlueprintPlannerManualLayout }> {
  return { ...value, manualLayout: { ...value.manualLayout!, preparation: await prepareManualLayout(registry, value) } };
}

describe("人工设备约束", () => {
  it("贴边固定储存箱不受自动初排边距限制，两种狭长尺寸均补齐供电且保持位姿和产率", async () => {
    const current = structuredClone(narrowTerminal) as BlueprintPlannerRequest;
    const original = structuredClone(current.manualLayout!.placements);
    const workspace: WorkspaceContract = { state: createWorkspaceState(), registry, app: null, editor: null, render: null,
      simulation: null, sync: null, audio: null, blueprintPlanner: null };
    const simulation = createSimulationHost(workspace, { engineKind: "dense-v2", workerMode: "runtime", blueprintDenseTickRate: 2 });
    try {
      for (const height of [14, 13]) {
        const candidate = await createPlannerCandidate(registry, current, 0, () => {}, () => {},
          { targetOutline: { width: 3, height }, maxEvaluations: 5000 });
        expect(candidate.metrics.area).toBe(3 * height);
        const entities = Object.values(candidate.execution.blueprint.entities);
        expect(entities.some(entity => entity.definitionId === "power_diffuser_1")).toBe(true);
        assertManualEntities(registry, current, entities, candidate.manualTransform);
        const report = await simulation.actions.runBlueprint(candidate.execution);
        expect(report.status).toBe("completed");
        expect(report.probes.find(probe => probe.id === "item_byproduct_bean_moss_1")?.perMinute).toBeGreaterThanOrEqual(90);
      }
      expect(current.manualLayout!.placements).toEqual(original);
    } finally { simulation.dispose(); }
  });
  it("首次拓扑准备先补齐固定仓库口的连续边界，不把临时原点冻结成阻塞供货关系", async () => {
    const input = structuredClone(boundaryTopology) as BlueprintPlannerRequest;
    const current = await prepare(input);
    const nearBoundary = current.manualLayout.placements.find(entry => entry.referenceNode.definitionId === "furnance_1_liquid"
      && entry.position.x === 6 && entry.position.y === 6)!.referenceNode.id;
    const farBoundary = current.manualLayout.placements.find(entry => entry.referenceNode.definitionId === "furnance_1_liquid"
      && entry.position.x === 2 && entry.position.y === 1)!.referenceNode.id;
    expect(current.manualLayout.preparation.connections).toContainEqual({ sourceNodeId: "manual-retained-eda-source-5",
      targetNodeId: farBoundary, itemId: "item_copper_ore", perMinute: 30 });
    expect(current.manualLayout.preparation.connections.filter(edge => edge.targetNodeId === nearBoundary && edge.itemId === "item_copper_ore"))
      .toEqual([expect.objectContaining({ sourceNodeId: expect.not.stringMatching(/^manual-retained-/), perMinute: 30 })]);
    await expect(verifyManualPreparation(registry, current)).resolves.toBeUndefined();
    // AI-REMOVED 2026-11-14:
    // Reason: 固定源汇提前占位会改变自由设施的初排，单一变体不能代表有界可布通性。
    // Trigger: v13 固定源汇初排修复后 variant 3 布线失败。
    // Evidence: 相同输入与尺寸在固定 0～7 变体、每个 625 次的总预算内成功。
    // Replacement: 下方总计不超过 5000 次的固定变体搜索，保留拓扑、面积及位姿断言。
    // Risk: Low；真实任务仍按原种子硬件复验。Human Review: Required。
    // Original code:
    // const candidate = await createPlannerCandidate(registry, current, 3, () => {}, () => {},
    //   { targetOutline: { width: 17, height: 11 }, maxEvaluations: 5000 });
    let candidate: Awaited<ReturnType<typeof createPlannerCandidate>> | undefined;
    let evaluations = 0;
    for (let variant = 0; variant < 8 && !candidate; variant++) {
      try {
        candidate = await createPlannerCandidate(registry, current, variant, () => {}, () => {},
          { targetOutline: { width: 17, height: 11 }, maxEvaluations: 625 });
        evaluations += candidate.search.evaluations;
      } catch (error) {
        if (!(error instanceof PlannerCandidateError) || !error.search) throw error;
        expect(error.search.evaluations).toBeGreaterThan(0);
        evaluations += error.search.evaluations;
      }
    }
    expect(evaluations).toBeLessThanOrEqual(5000);
    expect(candidate).toBeDefined();
    if (!candidate) throw new Error("固定边界拓扑在 5000 次内未布通。");
    expect(candidate.metrics.area).toBe(187);
    assertManualEntities(registry, current, Object.values(candidate.execution.blueprint.entities), candidate.manualTransform);
    expect(input.manualLayout!.placements).toEqual(current.manualLayout.placements);
  });
  it.each([false, true])("全部设备固定后，完整布局检查仍消耗预算且可取消（重叠=%s）", async overlap => {
    const nodes = [0, 1].map(index => {
      const node = createPlainNode(registry, "furnance_1", `fixed-${index}`, "production");
      node.entity.position = { x: overlap ? 0 : index * 8, y: 0 };
      return node;
    });
    const network: PlannerNetwork = { request: request(), nodes, slotLinks: [], initialSlots: [], preferredGasCount: 0 };
    const poses = nodes.map(node => ({ position: { ...node.entity.position }, rotation: node.entity.rotation }));
    const statistics = { seed: 1, evaluationLimit: 2, evaluations: 0, acceptedMoves: 0, routingAttempts: 0,
      initialWireLength: 0, finalWireLength: 0, outline: { width: 20, height: 20 }, strategy: "compact" as const };
    configureManualFrame(registry, network, statistics.outline, 0);
    const search = new CompactLayoutSearch(registry, network, [], statistics, undefined, undefined, new Set(nodes.map(node => node.entity.id)));
    await expect(search.advance(1, () => {})).resolves.toBe(!overlap);
    expect(statistics.evaluations).toBe(1);
    const cancelled = new DOMException("固定布局检查已取消", "AbortError");
    await expect(search.advance(1, () => { throw cancelled; })).rejects.toBe(cancelled);
    expect(statistics.evaluations).toBe(1);
    search.applyBest();
    expect(nodes.map(node => ({ position: node.entity.position, rotation: node.entity.rotation }))).toEqual(poses);
  });
  it("首次准备先保留固定近邻的完整流量，较大的排液组不能抢走其唯一相邻来源", async () => {
    const sources = [0, 1, 2].map(index => {
      const node = createPlainNode(registry, "furnance_1_liquid", `source-${index}`, "production");
      node.outputs.push({ itemId: "item_liquid_sewage", perMinute: 30 });
      node.entity.position = [{ x: 0, y: 0 }, { x: 0, y: 8 }, { x: 8, y: 8 }][index]!;
      return node;
    });
    const sinks = [60, 30].map((rate, index) => {
      const node = createPlainNode(registry, "udpipe_loader_1", `sink-${index}`, "byproduct");
      node.inputs.push({ itemId: "item_liquid_sewage", perMinute: rate });
      node.entity.position = { x: 4, y: index === 0 ? 4 : 0 };
      return node;
    });
    const nodes = [...sources, ...sinks];
    const current = request("topology");
    const network: PlannerNetwork = { request: { ...current, manualLayout: { ...current.manualLayout!,
      placements: nodes.map(node => ({ referenceNode: manualNodeView(node), position: { ...node.entity.position }, rotation: node.entity.rotation })),
    } }, nodes, slotLinks: [], initialSlots: [], preferredGasCount: 0, preparingManual: true };
    const poses = nodes.map(node => ({ position: { ...node.entity.position }, rotation: node.entity.rotation }));
    const wires = await wireProductionNetwork(registry, network, new PlannerPlacement(registry, 50, 0, 0, 1), undefined, true);
    const adjacent = wires.filter(wire => wire.target.entityId === "sink-1");
    expect(adjacent).toHaveLength(1);
    expect(adjacent[0]!.source.entityId).toBe("source-0");
    expect(adjacent[0]!.perMinute).toBe(30);
    expect(wires.filter(wire => wire.target.entityId === "sink-0").reduce((sum, wire) => sum + wire.perMinute, 0)).toBe(60);
    expect(nodes.slice(0, 5).map(node => ({ position: node.entity.position, rotation: node.entity.rotation }))).toEqual(poses);
  });
  it("固定相邻普通设备的端口重配保留物流格，不选择被对方占用的伪直连端口", async () => {
    const current = structuredClone(touchingDevices) as BlueprintPlannerRequest;
    const network = createManualProductionNetwork(registry, current);
    configureManualFrame(registry, network, { width: 41, height: 24 }, 0);
    const placement = new PlannerPlacement(registry, 70, 1, 1, 1, 1);
    await prepareProductionDevices(registry, network, placement, 0, resolveSearchProfile(), { strategy: "compact" }, () => {});
    stabilizeManualNodes(registry, network, current.manualLayout!.preparation);
    bindManualPositions(registry, network, 0);
    placement.remove([...placement.placed]); placement.reserve(network.nodes);
    const wires = await wireProductionNetwork(registry, network, placement, () => {}, true);
    const target = "manual-retained-eda-output-18";
    const wire = wires.find(wire => wire.target.entityId === target)!;
    expect(wire).toBeDefined();
    const fixed = network.nodes.filter(node => node.manualPlacement);
    const poses = fixed.map(node => ({ position: { ...node.entity.position }, rotation: node.entity.rotation }));
    const statistics = { seed: 1, evaluationLimit: 0, evaluations: 0, acceptedMoves: 0, routingAttempts: 0,
      initialWireLength: 0, finalWireLength: 0, outline: { width: 41, height: 24 }, strategy: "compact" as const };
    const search = new CompactLayoutSearch(registry, network, wires, statistics);
    search.applyBest();
    expect(search.inspectProposal().issues.filter(issue => issue.kind === "port-blocked"
      && issue.entityIds.includes(wire.source.entityId) && issue.entityIds.includes(target))).toEqual([]);
    expect(fixed.map(node => ({ position: node.entity.position, rotation: node.entity.rotation }))).toEqual(poses);
  });
  it.each([false, true])("首次准备按固定位置分配相邻供货口，不依赖同配方实例的编号顺序（交换=%s）", async exchange => {
    let input = structuredClone(positionTopology) as BlueprintPlannerRequest;
    if (exchange) {
      const devices = input.manualLayout!.placements.filter(placement => placement.referenceNode.definitionId === "furnance_1_liquid");
      const first = devices[0]!, adjacent = devices.find(placement => placement.position.x === 22 && placement.position.y === 15)!;
      input = { ...input, manualLayout: { ...input.manualLayout!, placements: input.manualLayout!.placements.map(placement =>
        placement === first ? { ...placement, position: adjacent.position, rotation: adjacent.rotation }
          : placement === adjacent ? { ...placement, position: first.position, rotation: first.rotation } : placement) } };
    }
    let current = await prepare(input);
    const target = current.manualLayout.placements.find(placement => placement.referenceNode.definitionId === "furnance_1_liquid"
      && placement.position.x === 22 && placement.position.y === 15)!.referenceNode.id;
    expect(current.manualLayout.preparation.connections).toContainEqual({ sourceNodeId: "manual-retained-eda-source-11",
      targetNodeId: target, itemId: "item_copper_ore", perMinute: 30 });
    const expected = current.manualLayout.preparation;
    for (let count = 0; count < 3; count++) {
      current = await prepare(current);
      expect(current.manualLayout.preparation).toEqual(expected);
      await expect(verifyManualPreparation(registry, current)).resolves.toBeUndefined();
    }
  });
  it("实际蓝图的供排设备分组多于默认清单时，准备保留全部设备并严格守恒物料", async () => {
    const current = await prepare(structuredClone(retainedTerminals) as BlueprintPlannerRequest);
    expect(current.manualLayout.preparation.placementIssues).toEqual([]);
    const terminals = current.manualLayout.preparation.nodes.filter(node => node.recipeId === null && ["supply", "product", "byproduct"].includes(node.purpose));
    expect(terminals).toHaveLength(current.manualLayout.placements.length);
    for (const { referenceNode } of current.manualLayout.placements) {
      expect(terminals.find(node => node.id === referenceNode.id)).toEqual(referenceNode);
    }
    await expect(verifyManualPreparation(registry, current)).resolves.toBeUndefined();
    const network = createManualProductionNetwork(registry, current);
    const placement = new PlannerPlacement(registry, 70, 1, 1, 1, 1);
    await prepareProductionDevices(registry, network, placement, 3, resolveSearchProfile(), { strategy: "compact" }, () => {});
    stabilizeManualNodes(registry, network, current.manualLayout.preparation);
    bindManualPositions(registry, network, 3);
    const wires = await wireProductionNetwork(registry, network, placement, () => {}, true);
    assertManualTopology(registry, network, wires);
  });
  it("冻结拓扑在不同初排下保留已确认供排设备与物料职责，不重新按位置划分排液组", async () => {
    const current = structuredClone(frozenTerminals) as BlueprintPlannerRequest;
    await verifyManualPreparation(registry, current);
    for (const variant of [0, 3, 7]) {
      const network = createManualProductionNetwork(registry, current);
      const placement = new PlannerPlacement(registry, 70, 1, 1, 1, 1);
      await prepareProductionDevices(registry, network, placement, variant, resolveSearchProfile(), { strategy: "compact" }, () => {});
      stabilizeManualNodes(registry, network, current.manualLayout!.preparation);
      bindManualPositions(registry, network, variant);
      const wires = await wireProductionNetwork(registry, network, placement, () => {}, true);
      expect(wires.length).toBeGreaterThan(0);
      assertManualTopology(registry, network, wires);
    }
  });
  it("重复准备保持同物料不同负荷的供料设备身份及拓扑，刚生成的准备可立即正式校验", async () => {
    let current = await prepare({ ...structuredClone(unequalSupplies) as BlueprintPlannerRequest,
      manualLayout: request("topology").manualLayout });
    const canonical = (value: BlueprintPlannerManualLayout["preparation"]) => ({
      nodes: [...value.nodes].sort((a, b) => a.id.localeCompare(b.id)),
      connections: [...value.connections].sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b))),
    });
    const original = canonical(current.manualLayout.preparation);
    for (let round = 0; round < 3; round++) {
      current = await prepare(current);
      expect(canonical(current.manualLayout.preparation)).toEqual(original);
      await expect(verifyManualPreparation(registry, current)).resolves.toBeUndefined();
    }
  });
  it("搜索下界取人工设备群跨度，与草图原点无关；停用草稿恢复普通下界", async () => {
    const base = await prepare({ ...structuredClone(separator.request) as BlueprintPlannerRequest, manualLayout: request().manualLayout });
    const referenceNode = base.manualLayout.preparation.nodes.find(node => node.purpose === "production")!;
    const current = await prepare({ ...base, manualLayout: { ...base.manualLayout,
      placements: [{ referenceNode, position: { x: 40, y: 30 }, rotation: 90 }] } });
    const network = createManualProductionNetwork(registry, current);
    expect(network.nodes.some(node => node.entity.id === referenceNode.id)).toBe(true);
    const minimum = fixedOutlineMinimum(registry, network.nodes, current.manualLayout);
    const footprint = registry.queries.findEntityDefinition(referenceNode.definitionId)!.footprint;
    expect(minimum.width).toBeGreaterThanOrEqual(footprint.height);
    expect(minimum.width).toBeLessThan(40);
    expect(minimum.height).toBeGreaterThanOrEqual(footprint.width);
    expect(minimum.height).toBeLessThan(30);
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
    const port = base.manualLayout.preparation.nodes.find(node => node.definitionId === "unloader_1")!;
    const current = await prepare({ ...base, manualLayout: { ...base.manualLayout, facilities: [{ ...power, id: powerId }],
      boundary: { rotation: 90, assignments: [{ referenceNode: port, side: "base" }] }, placements: [
      { referenceNode, position: { x: -105, y: -105 }, rotation: 0 },
      { referenceNode: { ...power, id: powerId, inputs: [], outputs: [] }, position: { x: -95, y: -95 }, rotation: 0 },
    ] } });
    const deadline = performance.now() + 60_000;
    const candidate = await createPlannerCandidate(registry, current, 0,
      () => { if (performance.now() > deadline) throw new Error("人工布局验证超时"); }, () => {},
      { maxEvaluations: 50_000, outline: { width: 30, height: 24 } });
    assertManualEntities(registry, current, Object.values(candidate.execution.blueprint.entities), candidate.manualTransform);
    assertPlannerWarehousePorts(registry, current, candidate);
    const changed = structuredClone(candidate);
    changed.execution.blueprint.entities[port.id]!.rotation = ((changed.execution.blueprint.entities[port.id]!.rotation + 90) % 360) as 0 | 90 | 180 | 270;
    expect(() => assertPlannerWarehousePorts(registry, current, changed)).toThrow("成果违反");
    expect(candidate.execution.blueprint.entities[powerId]?.position).toEqual(transformManualPlacement(
      current.manualLayout.placements[1]!, registry.queries.findEntityDefinition(power.definitionId)!, candidate.manualTransform!).position);
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
    assertManualEntities(registry, current, network.nodes.map(node => node.entity), network.manualTransform);
    assertManualTopology(registry, network, wires);
    const seed = capturePlannerSeed(current, network, wires, [], 70, 70);
    const restored = restorePlannerSeed(registry, current, seed);
    const pose = transformManualPlacement(current.manualLayout.placements[0]!, registry.queries.findEntityDefinition(referenceNode.definitionId)!, restored.network.manualTransform!);
    expect(restored.network.nodes.find(node => node.manualPlacement)?.entity).toMatchObject({ position: pose.position, rotation: pose.rotation });
    const missingFlags = { ...seed, network: { ...seed.network,
      nodes: seed.network.nodes.map(node => ({ ...node, manualPlacement: undefined })) } };
    expect(restorePlannerSeed(registry, current, missingFlags).network.nodes.filter(node => node.manualPlacement)).toHaveLength(1);
    expect(() => assertManualEntities(registry, current, network.nodes.filter(node => !node.manualPlacement).map(node => node.entity), network.manualTransform)).toThrow("人工固定");
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
