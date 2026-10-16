// AI-CORRECTION 2026-10-08: REQ-041 普通夹具空升级为 schema 7；归档注释中的 .schema6.json 路径现对应 .schema7.json，专用迁移输入保留原版。
// @vitest-environment node
import { describe, expect, it, vi } from "vitest";
import { mkdir, writeFile } from "node:fs/promises";
import type { BlueprintPlannerBlueprintOptimizations, BlueprintPlannerOptions } from "@/domain/blueprint-planner";
import type { WorkspaceContract } from "@/domain/document/workspace-contract";
import { createWorkspaceState } from "@/domain/document/workspace-state";
import { createRegistryContract } from "@/registry";
import { createSimulationHost } from "@/simulation/simulation-host";
import { createBlueprintPlannerHost } from "@/blueprint-planner/blueprint-planner-host";
import { PlannerCandidateError } from "@/blueprint-planner/model";
import { blueprintMaterialGraph, assertBlueprintRecognition, assertBlueprintSteadyState } from "@/blueprint-planner/blueprint-analysis";
import { assertBlueprintPreserved } from "@/blueprint-planner/blueprint-constraints";
import { blueprintReductionIds, reduceBlueprintNetwork } from "@/blueprint-planner/blueprint-candidate";
import { assertBlueprintOptimizationWires, assertBlueprintPortConfigurations, blueprintLogicalWires, blueprintRebuildableNodes, rebuildBlueprintLogistics, reassignBlueprintPorts, reassignBlueprintConnections } from "@/blueprint-planner/blueprint-optimizations";
import { DEFAULT_BLUEPRINT_OPTIMIZATIONS } from "@/shared/planner-task";
import { PlannerRandom } from "@/blueprint-planner/search-random";
import { plannerAttemptStrategy } from "@/blueprint-planner/strategy-schedule";
import { parsePlannerTaskFile, restorePlannerTaskFile, type PlannerCheckpoint } from "@/blueprint-planner/task-checkpoint";
import { restorePlannerSeed } from "@/blueprint-planner/search-seed";
import { meetsProductionTargets } from "@/blueprint-planner/verification";
import { NodePlannerClient } from "@/scripts/eda/node-planner-client";
import { loadBlueprintFromFile } from "../simulation/blueprint-test-helpers";

const directory = "src/tests/fixtures/blueprints/blueprint-planner/blueprint-optimization/";
const options: BlueprintPlannerOptions = { warehousePortPlacement: "any", solidSupply: "warehouse", fluidSupply: "conduit", warehouseBus: "straight",
  solidOutput: "auto", byproducts: "destroy", plantStartup: "preload", evaluationsPerRound: 20_000, concurrency: 1 };

function setup(engineKind: "legacy" | "dense-v2" = "dense-v2") {
  const workspace: WorkspaceContract = { state: createWorkspaceState(), registry: createRegistryContract(),
    app: null, audio: null, editor: null, render: null, simulation: null, sync: null, blueprintPlanner: null };
  const simulation = createSimulationHost(workspace, { engineKind, workerMode: "runtime", blueprintDenseTickRate: 2 });
  const planner = createBlueprintPlannerHost(workspace, { storage: null });
  return { workspace, simulation, planner, dispose: () => { planner.dispose(); simulation.dispose(); } };
}

describe("原蓝图识别与受约束优化", () => {
  it("同物品输入输出的旧任务迁移、复制与再次导入保持真实净产率", async () => {
    const env = setup();
    const blueprint = loadBlueprintFromFile(`${directory}plant-cycle-with-transit.schema7.json`);
    const original = structuredClone(blueprint);
    try {
      const boundaries = (await env.planner.actions.inspectBlueprint(blueprint, [])).map(boundary =>
        boundary.entityId.startsWith("net-pass-") ? { ...boundary, itemId: "item_plant_moss_3" } : boundary);
      const id = await env.planner.actions.createBlueprintTask({ blueprint, boundaries, activeActivityIds: [] }, options);
      await env.planner.whenSettled();
      await env.planner.actions.identifyBlueprint(id);
      const file = parsePlannerTaskFile(env.planner.queries.exportTask(id), env.workspace.registry);
      const outputs = [{ itemId: "item_plant_moss_3", perMinute: 30 }];
      expect(file.request.plan.targets).toEqual(outputs);
      const migrated = await restorePlannerTaskFile({ ...file, algorithmVersion: "before-net-output-migration" }, env.workspace.registry,
        request => env.simulation.actions.runBlueprint(request));
      const report = migrated.checkpoint.best!.report;
      expect(report.engineKind).toBe("dense-v2");
      expect(report.probes.find(probe => probe.id === "item_plant_moss_3")?.perMinute).toBe(60);
      expect(report.probes.find(probe => probe.id === "input:item_plant_moss_3")?.perMinute).toBe(30);
      expect(migrated.checkpoint.result!.measuredOutputs).toEqual(outputs);
      expect(meetsProductionTargets({ ...migrated.request, plan: { ...migrated.request.plan,
        targets: [{ itemId: "item_plant_moss_3", perMinute: 45 }] } }, report)).toBe(false);
      const imported = await env.planner.actions.importTask(migrated);
      const copied = await env.planner.actions.duplicateTask(imported);
      expect(env.planner.queries.getResult(copied)?.measuredOutputs).toEqual(outputs);
      const reimported = await env.planner.actions.importTask(env.planner.queries.exportTask(copied));
      expect(env.planner.queries.getResult(reimported)?.measuredOutputs).toEqual(outputs);
      expect(blueprint).toEqual(original);
      const success = `.temp/eda/success/net-output-migration-${Date.now()}`;
      await mkdir(success, { recursive: true });
      await Promise.all([writeFile(`${success}/input.json`, JSON.stringify(migrated.request)),
        writeFile(`${success}/blueprint.json`, JSON.stringify(migrated.checkpoint.result!.blueprint)),
        writeFile(`${success}/report.json`, JSON.stringify({ report, outputs: migrated.checkpoint.result!.measuredOutputs }))]);
    } finally { env.dispose(); }
  }, 60_000);

  it("优化开关独立约束换口、供料、物流展开和边界设施保留", async () => {
    const env = setup(), client = new NodePlannerClient();
    try {
      const blueprint = loadBlueprintFromFile(`${directory}plant-cycle.schema7.json`);
      const id = await env.planner.actions.createBlueprintTask({ blueprint, boundaries: [], activeActivityIds: [] }, options);
      await vi.waitFor(() => expect(env.planner.state.activeTaskId).toBeNull());
      await env.planner.actions.identifyBlueprint(id);
      const file = parsePlannerTaskFile(env.planner.queries.exportTask(id), env.workspace.registry);
      const baseline = file.checkpoint.blueprintBaseline!.candidate.seed!;
      const all = { reassignPorts: true, reassignConnections: true, rebuildLogistics: true, mergeBoundaryFacilities: true };
      const strict = restorePlannerSeed(env.workspace.registry, file.request, baseline);
      // AI-REMOVED 2026-10-12:
      // Reason: 测试仅改请求会触发种子指纹拒绝，无法验证授权行为。
      // Trigger: 新增权限测试的准备阶段错误。Evidence: restorePlannerSeed 校验 requestKey。
      // Replacement: 下方 configured 通过真实 Host 更新选项并重建种子。
      // Risk: Low。Human Review: Required
      // Original code:
      // const flexibleRequest = { ...file.request, options: { ...file.request.options, blueprintOptimizations: all } };
      // const portsOnly = { ...file.request, options: { ...file.request.options, blueprintOptimizations: { ...DEFAULT_BLUEPRINT_OPTIMIZATIONS, reassignPorts: true } } };
      // const connectionsOnly = { ...file.request, options: { ...file.request.options, blueprintOptimizations: { ...DEFAULT_BLUEPRINT_OPTIMIZATIONS, reassignConnections: true } } };
      const configured = async (blueprintOptimizations: BlueprintPlannerBlueprintOptimizations) => {
        await env.planner.actions.updateBlueprintOptions(id, { ...file.request.options, blueprintOptimizations });
        const task = parsePlannerTaskFile(env.planner.queries.exportTask(id), env.workspace.registry);
        return restorePlannerSeed(env.workspace.registry, task.request, task.checkpoint.blueprintBaseline!.candidate.seed!);
      };
      const flexible = await configured(all);
      const portVariants = Array.from({ length: 40 }, (_, seed) => {
        const network = { ...flexible.network, nodes: flexible.network.nodes.map(node => ({ ...node, entity: structuredClone(node.entity) })) };
        const wires = reassignBlueprintPorts(env.workspace.registry, network, flexible.wires, new PlannerRandom(seed + 1));
        network.nodes.forEach((node, index) => expect(() => assertBlueprintPortConfigurations(env.workspace.registry, flexible.network.nodes[index]!, node)).not.toThrow());
        return wires;
      });
      const identity = (wires: typeof flexible.wires) => JSON.stringify(wires.map(wire => [wire.source.entityId, wire.source.groupIndex,
        wire.source.portIndex, wire.target.entityId, wire.target.groupIndex, wire.target.portIndex]));
      const changedPorts = portVariants.find(wires => identity(wires) !== identity(flexible.wires));
      expect(changedPorts).toBeDefined();
      const originalPortOwner = flexible.network.nodes.find(node => node.definition.portGroups[0]?.ports.length)!;
      const changedControl = { ...originalPortOwner, entity: structuredClone(originalPortOwner.entity) };
      changedControl.entity.config["portGroups[0].ports[0].priorityGroup"] = 9999;
      expect(() => assertBlueprintPortConfigurations(env.workspace.registry, originalPortOwner, changedControl)).toThrow("控制语义");
      expect(() => assertBlueprintOptimizationWires(env.workspace.registry, strict.network, strict.wires, flexible.network, changedPorts!)).toThrow("未授权");
      const permittedPorts = await configured({ ...DEFAULT_BLUEPRINT_OPTIMIZATIONS, reassignPorts: true });
      expect(() => assertBlueprintOptimizationWires(env.workspace.registry, permittedPorts.network, permittedPorts.wires, flexible.network, changedPorts!)).not.toThrow();
      const connectionVariants = Array.from({ length: 40 }, (_, seed) => reassignBlueprintConnections(flexible.wires, new PlannerRandom(seed + 1)));
      const changedConnections = connectionVariants.find(wires => wires.some((wire, index) => wire.target.entityId !== flexible.wires[index]!.target.entityId));
      expect(changedConnections).toBeDefined();
      expect(() => assertBlueprintOptimizationWires(env.workspace.registry, strict.network, strict.wires, flexible.network, changedConnections!)).toThrow("未授权");
      const permittedConnections = await configured({ ...DEFAULT_BLUEPRINT_OPTIMIZATIONS, reassignConnections: true });
      expect(() => assertBlueprintOptimizationWires(env.workspace.registry, permittedConnections.network, permittedConnections.wires, flexible.network, changedConnections!)).not.toThrow();
      const controls = blueprintRebuildableNodes(env.workspace.registry, flexible.network, flexible.wires);
      const logical = blueprintLogicalWires(flexible.network, flexible.wires, controls);
      const redistributed = reassignBlueprintConnections(logical, new PlannerRandom(123), true);
      expect(() => assertBlueprintOptimizationWires(env.workspace.registry, flexible.network, flexible.wires, flexible.network, redistributed)).not.toThrow();
      flexible.network.nodes.splice(0, flexible.network.nodes.length, ...flexible.network.nodes.filter(node => !controls.has(node.entity.id)));
      const rebuilt = await rebuildBlueprintLogistics(env.workspace.registry, flexible.network, logical, () => {});
      const originalFlexible = await configured(all);
      expect(() => assertBlueprintOptimizationWires(env.workspace.registry, originalFlexible.network, originalFlexible.wires, flexible.network, rebuilt)).not.toThrow();
      const output = originalFlexible.network.nodes.find(node => node.purpose === "product")!;
      const outletWire = originalFlexible.wires.find(wire => wire.target.entityId === output.entity.id)!;
      const extra = { ...output, entity: { ...structuredClone(output.entity), id: "merge-extra-output" } };
      const withExtra = { ...originalFlexible.network, nodes: [...originalFlexible.network.nodes, extra] };
      const divided = originalFlexible.wires.map(wire => wire === outletWire ? { ...wire, perMinute: wire.perMinute / 2 } : wire);
      divided.push({ ...outletWire, perMinute: outletWire.perMinute / 2, target: { ...outletWire.target, entityId: extra.entity.id } });
      const merged = reduceBlueprintNetwork(env.workspace.registry, withExtra, divided, new Set([extra.entity.id]), 1, true);
      expect(withExtra.nodes.some(node => node.entity.id === extra.entity.id)).toBe(false);
      expect(merged.filter(wire => wire.target.entityId === output.entity.id).reduce((sum, wire) => sum + wire.perMinute, 0)).toBeCloseTo(outletWire.perMinute);
      expect(() => assertBlueprintOptimizationWires(env.workspace.registry, originalFlexible.network, originalFlexible.wires, withExtra, merged)).not.toThrow();
      const missingOutput = structuredClone(blueprint);
      const product = strict.network.nodes.find(node => node.purpose === "product")!.entity.id;
      delete missingOutput.entities[product]; missingOutput.entityOrder = missingOutput.entityOrder.filter(id => id !== product);
      expect(() => assertBlueprintPreserved(env.workspace.registry, file.request, baseline, missingOutput)).toThrow("被移除");
      const unknownSwitch = structuredClone(file);
      Object.assign(unknownSwitch.request.options.blueprintOptimizations!, { rebuildPower: true });
      expect(() => parsePlannerTaskFile(unknownSwitch, env.workspace.registry)).toThrow("四个明确的开关");
      const enabled = parsePlannerTaskFile(env.planner.queries.exportTask(id), env.workspace.registry);
      const seed = enabled.checkpoint.blueprintBaseline!.candidate.seed!;
      try {
        await client.build(enabled.request, 1, 40_000, { originSeed: seed, seed,
          targetOutline: { width: 16, height: 16 }, maxEvaluations: 1,
          attemptStrategy: { ...plannerAttemptStrategy(1), reduce: false, layoutSeed: 1 } });
        throw new Error("单次准备预算应返回失败摘要");
      } catch (error) {
        expect(error).toBeInstanceOf(PlannerCandidateError);
        const search = (error as PlannerCandidateError).search!;
        expect(search.evaluations).toBe(1);
        expect(search.diagnostics).toBeUndefined();
        expect(search.summary?.layoutIssues).toBeDefined();
      }
      const candidate = await client.build(enabled.request, 1, 40_000, { originSeed: seed, seed,
        targetOutline: { width: 16, height: 16 }, maxEvaluations: 20_000,
        attemptStrategy: { ...plannerAttemptStrategy(1), reduce: false, layoutSeed: 1 } });
      const report = await env.simulation.actions.runBlueprint(candidate.execution);
      expect(meetsProductionTargets(enabled.request, report)).toBe(true);
      expect(() => assertBlueprintPreserved(env.workspace.registry, enabled.request, seed, candidate.execution.blueprint, candidate.seed)).not.toThrow();
      const success = `.temp/eda/success/blueprint-optimization-options-${Date.now()}`;
      await mkdir(success, { recursive: true });
      await writeFile(`${success}/input.json`, JSON.stringify(enabled.request));
      await writeFile(`${success}/blueprint.json`, JSON.stringify(candidate.execution.blueprint));
      await writeFile(`${success}/report.json`, JSON.stringify({ report, search: candidate.search }));
    } finally { await client.dispose(); env.dispose(); }
  }, 60_000);
  it("真实仿真建立净产率基线，保留原图并通过导出、导入与检查点校验", async () => {
    const env = setup("legacy"), blueprint = loadBlueprintFromFile(`${directory}plant-cycle.schema7.json`);
    const before = JSON.stringify(blueprint);
    try {
      const boundaries = await env.planner.actions.inspectBlueprint(blueprint, []);
      expect(boundaries).toEqual([{ entityId: "eda-output-3", portGroupId: "", portId: "", direction: "output", kind: "facility", itemId: "item_plant_moss_3" }]);
      const id = await env.planner.actions.createBlueprintTask({ blueprint, boundaries, activeActivityIds: [] }, options);
      await vi.waitFor(() => expect(env.planner.state.activeTaskId).toBeNull());
      await env.planner.actions.identifyBlueprint(id);
      expect(env.planner.queries.getTask(id)?.status).toBe("waiting");
      expect(env.planner.queries.getResult(id)?.measuredOutputs).toEqual([{ itemId: "item_plant_moss_3", perMinute: 30 }]);
      expect(env.planner.queries.getResult(id)?.blueprint.blueprintId).not.toBe(blueprint.blueprintId);
      const file = parsePlannerTaskFile(env.planner.queries.exportTask(id), env.workspace.registry), checkpoint = file.checkpoint as PlannerCheckpoint;
      expect(checkpoint.blueprintBaseline?.candidate.metrics.area).toBe(150);
      expect(checkpoint.blueprintBaseline?.report.engineKind).toBe("dense-v2");
      const baseline = checkpoint.blueprintBaseline!;
      const lowerOutput = { ...baseline.report, probes: baseline.report.probes.map(probe => ({ ...probe, perMinute: probe.perMinute - 0.1 })) };
      expect(meetsProductionTargets(file.request, lowerOutput)).toBe(false);
      const draining = { ...baseline.report, inventorySamples: baseline.report.inventorySamples.map((sample, index) => ({ ...sample,
        itemAmounts: { ...sample.itemAmounts, item_plant_moss_seed_3: 1000 - index * 20 } })) };
      expect(() => assertBlueprintSteadyState(env.workspace.registry, draining, baseline.candidate.execution.probes)).toThrow("持续消耗");
      expect(parsePlannerTaskFile(file, env.workspace.registry).request.blueprintSource?.blueprint).toEqual(blueprint);
      const imported = await env.planner.actions.importTask(file);
      expect(imported).not.toBe(id);
      expect(env.planner.queries.getResult(imported)?.measuredOutputs).toEqual([{ itemId: "item_plant_moss_3", perMinute: 30 }]);
      const importedFile = env.planner.queries.exportTask(imported);
      expect(parsePlannerTaskFile(importedFile, env.workspace.registry).request.blueprintSource?.blueprint).toEqual(blueprint);
      const importedAgain = await env.planner.actions.importTask(importedFile);
      expect(env.planner.queries.getResult(importedAgain)?.measuredOutputs).toEqual([{ itemId: "item_plant_moss_3", perMinute: 30 }]);
      expect(JSON.stringify(blueprint)).toBe(before);
      expect(() => env.planner.actions.start(file.request)).toThrow("先识别");
      const damaged = structuredClone(file);
      Object.assign(damaged.checkpoint as PlannerCheckpoint, { blueprintBaseline: undefined });
      expect(() => parsePlannerTaskFile(damaged, env.workspace.registry)).toThrow("原图识别基线");
      const disconnected = structuredClone(file), point = disconnected.checkpoint as PlannerCheckpoint;
      point.best = structuredClone(point.best!);
      point.best.candidate.execution.blueprint.blueprintId = blueprint.blueprintId;
      const displaced = point.best.candidate.execution.blueprint.entities["eda-device-0"]!;
      displaced.position = { ...displaced.position, x: displaced.position.x + 50 };
      point.result = { ...point.result!, blueprint: point.best.candidate.execution.blueprint };
      await expect(restorePlannerTaskFile(disconnected, env.workspace.registry,
        request => env.simulation.actions.runBlueprint(request))).rejects.toThrow();
    } finally { env.dispose(); }
  }, 60_000);

  it("真实 Worker 压缩 150→140 格，设备和配置不变，产率仍为 30/min，夹具不进入交付", async () => {
    const env = setup(), client = new NodePlannerClient();
    try {
      const blueprint = loadBlueprintFromFile(`${directory}plant-cycle.schema7.json`);
      const boundaries = await env.planner.actions.inspectBlueprint(blueprint, []);
      const id = await env.planner.actions.createBlueprintTask({ blueprint, boundaries, activeActivityIds: [] }, options);
      await vi.waitFor(() => expect(env.planner.state.activeTaskId).toBeNull());
      await env.planner.actions.identifyBlueprint(id);
      const file = parsePlannerTaskFile(env.planner.queries.exportTask(id), env.workspace.registry), baseline = (file.checkpoint as PlannerCheckpoint).blueprintBaseline!.candidate;
      const candidate = await client.build(file.request, 1, 40_000, { originSeed: baseline.seed, seed: baseline.seed,
        targetOutline: { width: 10, height: 14 }, maxEvaluations: 15_000,
        attemptStrategy: { ...plannerAttemptStrategy(1), reduce: false, layoutSeed: 1 } });
      const report = await env.simulation.actions.runBlueprint(candidate.execution);
      expect(candidate.metrics.area).toBe(140);
      expect(candidate.metrics.productionDeviceCount).toBe(3);
      expect(report.engineKind).toBe("dense-v2");
      expect(meetsProductionTargets(file.request, report)).toBe(true);
      expect(() => assertBlueprintRecognition(env.workspace.registry, { ...file.request.blueprintSource!, blueprint: candidate.execution.blueprint }, report)).not.toThrow();
      expect(() => assertBlueprintSteadyState(env.workspace.registry, report, candidate.execution.probes)).not.toThrow();
      expect(() => assertBlueprintPreserved(env.workspace.registry, file.request, baseline.seed!, candidate.execution.blueprint, candidate.seed)).not.toThrow();
      expect(candidate.execution.blueprint.entityOrder.some(id => id.startsWith("__blueprint_fixture_") || id.startsWith("__blueprint_drain_"))).toBe(false);
      const altered = structuredClone(candidate.execution.blueprint);
      altered.entities["eda-device-0"]!.config.channelRecipes = {};
      expect(() => assertBlueprintPreserved(env.workspace.registry, file.request, baseline.seed!, altered)).toThrow("配置发生变化");
      const success = `.temp/eda/success/blueprint-optimization-${Date.now()}`;
      await mkdir(success, { recursive: true });
      await Promise.all([writeFile(`${success}/input.json`, JSON.stringify(file.request)),
        writeFile(`${success}/blueprint.json`, JSON.stringify(candidate.execution.blueprint)),
        writeFile(`${success}/report.json`, JSON.stringify({ metrics: candidate.metrics, search: candidate.search, report }))]);
    } finally { await client.dispose(); env.dispose(); }
  }, 60_000);

// AI-REMOVED 2026-10-07:
// Reason: 取消和失败不再丢弃原图识别任务。
// Trigger: 用户要求识别任务可恢复、自动识别出口与预览联动。
// Evidence: 原实现只在识别成功后建任务，边界必须全部手动补齐。
// Replacement: src/tests/blueprint-planner/blueprint-optimization.test.ts 取消识别保留任务
// Risk: 已保存规划任务保留原有格式和验收；Human Review: Required
// Original code:
//   it("未说明物品的断头必须配置，取消识别不会创建任务", async () => {
//     const env = setup();
//     try {
//       const blueprint = loadBlueprintFromFile(`${directory}unknown-entry.schema6.json`);
//       const boundaries = await env.planner.actions.inspectBlueprint(blueprint, []);
//       expect(boundaries).toHaveLength(2);
//       expect(boundaries.every(boundary => boundary.kind === "port" && boundary.itemId === null)).toBe(true);
//       await expect(env.planner.actions.identifyBlueprint({ blueprint, boundaries, activeActivityIds: [] }, options)).rejects.toThrow("补全所有边界物品");
//       const abort = new AbortController(); abort.abort();
//       await expect(env.planner.actions.identifyBlueprint({ blueprint, boundaries, activeActivityIds: [] }, options, abort.signal)).rejects.toThrow();
//       expect(env.planner.queries.listTasks()).toEqual([]);
//     } finally { env.dispose(); }
//   });
//
  it("未说明物品的输入必须配置，取消识别保留任务和原图", async () => {
    const env = setup();
    try {
      const blueprint = loadBlueprintFromFile(`${directory}unknown-entry.schema7.json`);
      const boundaries = await env.planner.actions.inspectBlueprint(blueprint, []);
      expect(boundaries).toHaveLength(2);
      expect(boundaries.every(boundary => boundary.kind === "port" && boundary.itemId === null)).toBe(true);
      const id = await env.planner.actions.createBlueprintTask({ blueprint, boundaries, activeActivityIds: [] }, options);
      await vi.waitFor(() => expect(env.planner.state.activeTaskId).toBeNull());
      await expect(env.planner.actions.identifyBlueprint(id)).rejects.toThrow("补全输入物品");
      const abort = new AbortController(); abort.abort();
      await expect(env.planner.actions.identifyBlueprint(id, abort.signal)).rejects.toThrow();
      expect(env.planner.queries.listTasks()).toHaveLength(1);
      expect(env.planner.queries.getTask(id)?.status).toBe("cancelled");
      expect(env.planner.queries.getResult(id)).toBeNull();
      expect(env.planner.queries.exportTask(id).request).toMatchObject({ kind: "blueprint-recognition", input: { blueprint } });
    } finally { env.dispose(); }
  });

  it.each([
    [`${directory}mixed-powered.schema7.json`, true],
    ["src/tests/fixtures/blueprints/simulation/converger-mixed-input/three-same-items.schema7.json", false],
    ["src/tests/fixtures/blueprints/simulation/bridge-direction/scene-01-bridge-direction-verify-a1e0eae4.schema7.json", false],
  ])("按库存通道追踪混带，不把同物品汇流或桥接器独立通道误报：%s", async (path, mixed) => {
    const env = setup();
    try {
      const blueprint = loadBlueprintFromFile(path);
      const report = await env.simulation.actions.runBlueprint({ blueprint,
        scene: { externalEntities: [], externalSlotLinks: [], initialSlots: [], powerMode: "infinite" },
        probes: [], warmupSeconds: 0, observationSeconds: 20, inventorySampleCount: 5, maxWallTimeMs: 10_000,
        activeActivityIds: [], collectAnalysis: true });
      expect(report.status).toBe("completed");
      const graph = blueprintMaterialGraph(env.workspace.registry, blueprint, report.analysis!, []);
      expect([...graph.items.values()].some(items => items.size > 1)).toBe(mixed);
      if (mixed) {
        expect(report.deviceStatuses.some(device => ["not-in-power-net", "no-power"].includes(device.status))).toBe(false);
        expect(() => assertBlueprintRecognition(env.workspace.registry,
          { blueprint, boundaries: [], activeActivityIds: [] }, report)).toThrow("疑似混带");
      }
    } finally { env.dispose(); }
  });

  it("随机删减偏向小改动，超过 16 个也覆盖所有个体及非相邻组合", async () => {
    const env = setup();
    try {
      const blueprint = loadBlueprintFromFile(`${directory}plant-cycle.schema7.json`);
      const boundaries = await env.planner.actions.inspectBlueprint(blueprint, []);
      const id = await env.planner.actions.createBlueprintTask({ blueprint, boundaries, activeActivityIds: [] }, options);
      await vi.waitFor(() => expect(env.planner.state.activeTaskId).toBeNull());
      await env.planner.actions.identifyBlueprint(id);
      const file = parsePlannerTaskFile(env.planner.queries.exportTask(id), env.workspace.registry), baseline = (file.checkpoint as PlannerCheckpoint).blueprintBaseline!.candidate;
      const { network } = restorePlannerSeed(env.workspace.registry, file.request, baseline.seed!);
      const terminal = network.nodes.find(node => node.purpose === "product")!;
      const nodes = Array.from({ length: 18 }, (_, index) => ({ ...terminal,
        entity: { ...terminal.entity, id: `source-${String(index).padStart(2, "0")}` },
        purpose: (["supply", "product", "environment"] as const)[index % 3]! }));
      // AI-REMOVED 2026-10-11:
      // Reason: 用户将编号枚举改为种子随机抽样，顺序已不属于契约。
      // Trigger: 五点随机调度方案；Evidence: blueprintReductionIds 改为独立 PRNG。
      // Replacement: 下方验证小改动权重和实际可访问对象。
      // Risk: 不再要求固定枚举顺序；Human Review: Required
      // Original code:
      // const singles = Array.from({ length: 18 }, (_, index) => [...blueprintReductionIds(nodes, index + 1)]);
      // expect(singles.every(ids => ids.length === 1)).toBe(true);
      // expect(new Set(singles.flat()).size).toBe(18);
      // expect(Array.from({ length: 153 }, (_, index) => [...blueprintReductionIds(nodes, index + 19)].join(",")))
      //   .toContain("source-00,source-17");
      const random = new PlannerRandom(12345);
      const samples = Array.from({ length: 8192 }, () => [...blueprintReductionIds(nodes, random)].sort());
      expect(new Set(samples.filter(ids => ids.length === 1).flat()).size).toBe(18);
      expect(samples.filter(ids => ids.length <= 2).length / samples.length).toBeGreaterThan(0.9);
      expect(samples.some(ids => ids.join(",") === "source-00,source-17")).toBe(true);
    } finally { env.dispose(); }
  });
});
