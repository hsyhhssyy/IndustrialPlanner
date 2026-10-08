// @vitest-environment node
import { describe, expect, it, vi } from "vitest";
import { mkdir, writeFile } from "node:fs/promises";
import type { BlueprintPlannerOptions } from "@/domain/blueprint-planner";
import type { WorkspaceContract } from "@/domain/document/workspace-contract";
import { createWorkspaceState } from "@/domain/document/workspace-state";
import { createRegistryContract } from "@/registry";
import { createSimulationHost } from "@/simulation/simulation-host";
import { createBlueprintPlannerHost } from "@/blueprint-planner/blueprint-planner-host";
import { blueprintMaterialGraph, assertBlueprintRecognition, assertBlueprintSteadyState } from "@/blueprint-planner/blueprint-analysis";
import { assertBlueprintPreserved } from "@/blueprint-planner/blueprint-constraints";
import { blueprintReductionIds } from "@/blueprint-planner/blueprint-candidate";
import { parsePlannerTaskFile, restorePlannerTaskFile, type PlannerCheckpoint } from "@/blueprint-planner/task-checkpoint";
import { restorePlannerSeed } from "@/blueprint-planner/search-seed";
import { meetsProductionTargets } from "@/blueprint-planner/verification";
import { NodePlannerClient } from "@/scripts/eda/node-planner-client";
import { loadBlueprintFromFile } from "../simulation/blueprint-test-helpers";

const directory = "src/tests/fixtures/blueprints/blueprint-planner/blueprint-optimization/";
const options: BlueprintPlannerOptions = { solidSupply: "warehouse", fluidSupply: "conduit", warehouseBus: "straight",
  solidOutput: "auto", byproducts: "destroy", plantStartup: "preload", evaluationsPerRound: 20_000, concurrency: 1 };

function setup(engineKind: "legacy" | "dense-v2" = "dense-v2") {
  const workspace: WorkspaceContract = { state: createWorkspaceState(), registry: createRegistryContract(),
    app: null, audio: null, editor: null, render: null, simulation: null, sync: null, blueprintPlanner: null };
  const simulation = createSimulationHost(workspace, { engineKind, workerMode: "runtime", blueprintDenseTickRate: 2 });
  const planner = createBlueprintPlannerHost(workspace, { storage: null });
  return { workspace, simulation, planner, dispose: () => { planner.dispose(); simulation.dispose(); } };
}

describe("原蓝图识别与受约束优化", () => {
  it("真实仿真建立净产率基线，保留原图并通过导出、导入与检查点校验", async () => {
    const env = setup("legacy"), blueprint = loadBlueprintFromFile(`${directory}plant-cycle.schema6.json`);
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
      const blueprint = loadBlueprintFromFile(`${directory}plant-cycle.schema6.json`);
      const boundaries = await env.planner.actions.inspectBlueprint(blueprint, []);
      const id = await env.planner.actions.createBlueprintTask({ blueprint, boundaries, activeActivityIds: [] }, options);
      await vi.waitFor(() => expect(env.planner.state.activeTaskId).toBeNull());
      await env.planner.actions.identifyBlueprint(id);
      const file = parsePlannerTaskFile(env.planner.queries.exportTask(id), env.workspace.registry), baseline = (file.checkpoint as PlannerCheckpoint).blueprintBaseline!.candidate;
      const candidate = await client.build(file.request, 1, 40_000, { originSeed: baseline.seed, seed: baseline.seed,
        targetOutline: { width: 10, height: 14 }, maxEvaluations: 15_000 });
      const report = await env.simulation.actions.runBlueprint(candidate.execution);
      expect(candidate.metrics.area).toBe(140);
      expect(candidate.metrics.productionDeviceCount).toBe(3);
      expect(report.engineKind).toBe("dense-v2");
      expect(meetsProductionTargets(file.request, report)).toBe(true);
      expect(() => assertBlueprintRecognition(env.workspace.registry, { ...file.request.blueprintSource!, blueprint: candidate.execution.blueprint }, report)).not.toThrow();
      expect(() => assertBlueprintSteadyState(env.workspace.registry, report, candidate.execution.probes)).not.toThrow();
      expect(() => assertBlueprintPreserved(env.workspace.registry, file.request, baseline.seed!, candidate.execution.blueprint)).not.toThrow();
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
      const blueprint = loadBlueprintFromFile(`${directory}unknown-entry.schema6.json`);
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
    [`${directory}mixed-powered.schema6.json`, true],
    ["src/tests/fixtures/blueprints/simulation/converger-mixed-input/three-same-items.schema6.json", false],
    ["src/tests/fixtures/blueprints/simulation/bridge-direction/scene-01-bridge-direction-verify-a1e0eae4.schema6.json", false],
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

  it("删减组合先遍历所有设施个体，超过 16 个也覆盖非相邻组合", async () => {
    const env = setup();
    try {
      const blueprint = loadBlueprintFromFile(`${directory}plant-cycle.schema6.json`);
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
      const singles = Array.from({ length: 18 }, (_, index) => [...blueprintReductionIds(nodes, index + 1)]);
      expect(singles.every(ids => ids.length === 1)).toBe(true);
      expect(new Set(singles.flat()).size).toBe(18);
      expect(Array.from({ length: 153 }, (_, index) => [...blueprintReductionIds(nodes, index + 19)].join(",")))
        .toContain("source-00,source-17");
    } finally { env.dispose(); }
  });
});
