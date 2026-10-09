// @vitest-environment node
import { mkdir, writeFile } from "node:fs/promises";
import { describe, expect, it, vi } from "vitest";
import type { WorkspaceContract } from "@/domain/document/workspace-contract";
import { createWorkspaceState } from "@/domain/document/workspace-state";
import { createRegistryContract } from "@/registry";
import { createSimulationHost } from "@/simulation/simulation-host";
import { createBlueprintPlannerHost } from "@/blueprint-planner/blueprint-planner-host";
import { blueprintRecognitionScene } from "@/blueprint-planner/blueprint-scene";
import { parseRecognitionTaskFile, type BlueprintRecognitionTaskFile } from "@/blueprint-planner/blueprint-recognition-task";
import { parsePlannerTaskFile } from "@/blueprint-planner/task-checkpoint";
import type { BlueprintPlannerTaskFile } from "@/domain/blueprint-planner";
import { loadBlueprintFromFile } from "../simulation/blueprint-test-helpers";

const fixtures = "src/tests/fixtures/blueprints/blueprint-planner/blueprint-optimization/";
const options = { solidSupply: "warehouse", fluidSupply: "conduit", warehouseBus: "straight", solidOutput: "auto",
  byproducts: "destroy", plantStartup: "preload", evaluationsPerRound: 10_000, concurrency: 1 } as const;

function setup(records?: Map<string, BlueprintPlannerTaskFile>) {
  const workspace: WorkspaceContract = { state: createWorkspaceState(), registry: createRegistryContract(),
    app: null, audio: null, editor: null, render: null, simulation: null, sync: null, blueprintPlanner: null };
  const simulation = createSimulationHost(workspace, { engineKind: "dense-v2", workerMode: "runtime", blueprintDenseTickRate: 2 });
  const host = createBlueprintPlannerHost(workspace, { storage: records ? {
    load: async () => [...records.values()].map(file => structuredClone(file)),
    save: async file => { records.set(file.taskId, structuredClone(file)); }, delete: async id => { records.delete(id); },
  } : null });
  return { workspace, host, dispose: () => { host.dispose(); simulation.dispose(); } };
}

describe("持久蓝图识别任务", () => {
  it("边界检查运行中即可导出，输入配置、未知出口和原图可导入并继续识别", async () => {
    const env = setup(), blueprint = loadBlueprintFromFile(`${fixtures}unknown-entry.schema7.json`);
    const original = JSON.stringify(blueprint);
    try {
      const id = await env.host.actions.createBlueprintTask({ blueprint, boundaries: [], activeActivityIds: [] }, options);
      const early = parseRecognitionTaskFile(env.host.queries.exportTask(id), env.workspace.registry);
      expect(early.request.input.blueprint).toEqual(blueprint);
      expect(env.host.queries.listTasks()).toHaveLength(1);
      await vi.waitFor(() => expect(env.host.state.activeTaskId).toBeNull());
      const pending = parseRecognitionTaskFile(env.host.queries.exportTask(id), env.workspace.registry);
      expect(pending.request.input.boundaries.every(boundary => boundary.itemId === null)).toBe(true);
      await env.host.actions.updateBlueprintBoundaries(id, pending.request.input.boundaries.map(boundary =>
        boundary.direction === "input" ? { ...boundary, itemId: "item_iron_ore" } : boundary));
      const file = JSON.parse(JSON.stringify(env.host.queries.exportTask(id))) as BlueprintRecognitionTaskFile;
      expect(file.request.input.boundaries.find(boundary => boundary.direction === "output")?.itemId).toBeNull();
      const imported = await env.host.actions.importTask(file);
      expect(imported).not.toBe(id);
      expect(env.host.state.activeTaskId).toBeNull();
      expect(env.host.queries.getLastRequest(imported)).toEqual(file.request);
      // 用户只配置输入；直接穿过的物品必须被自动发现，并以零净产出拒绝优化。
      await expect(env.host.actions.identifyBlueprint(imported)).rejects.toThrow("净产出");
      const discovered = parseRecognitionTaskFile(env.host.queries.exportTask(imported), env.workspace.registry);
      expect(discovered.request.input.boundaries.find(boundary => boundary.direction === "output")?.itemId).toBe("item_iron_ore");
      expect(discovered.checkpoint.step).toBe("verification");
      expect(env.host.queries.getTask(imported)?.status).toBe("failed");
      const discovery = blueprintRecognitionScene(env.workspace.registry, discovered.request.input, blueprint, 30, true);
      expect(discovery).toMatchObject({ warmupSeconds: 360, observationSeconds: 30,
        engine: { kind: "dense-v2", ticksPerSecond: 2 } });
      expect(JSON.stringify(blueprint)).toBe(original);
    } finally { env.dispose(); }
  });

  it("刷新恢复部分识别任务，失败和取消仍可下载", async () => {
    const records = new Map<string, BlueprintPlannerTaskFile>(), env = setup(records);
    const blueprint = loadBlueprintFromFile(`${fixtures}unknown-entry.schema7.json`);
    let restored: ReturnType<typeof setup> | null = null;
    let initialDisposed = false;
    try {
      const id = await env.host.actions.createBlueprintTask({ blueprint, boundaries: [], activeActivityIds: [] }, options);
      await vi.waitFor(() => expect(env.host.state.activeTaskId).toBeNull());
      const pending = parseRecognitionTaskFile(env.host.queries.exportTask(id), env.workspace.registry);
      await env.host.actions.updateBlueprintBoundaries(id, pending.request.input.boundaries.map(boundary =>
        boundary.direction === "input" ? { ...boundary, itemId: "item_iron_ore" } : boundary));
      env.dispose(); initialDisposed = true;
      restored = setup(records);
      await vi.waitFor(() => expect(restored!.host.queries.getTask(id)).not.toBeNull());
      const saved = parseRecognitionTaskFile(restored.host.queries.exportTask(id), restored.workspace.registry);
      expect(saved.request.input.blueprint).toEqual(blueprint);
      expect(saved.request.input.boundaries.find(boundary => boundary.direction === "input")?.itemId).toBe("item_iron_ore");
      const cancel = new AbortController(); cancel.abort();
      await expect(restored.host.actions.identifyBlueprint(id, cancel.signal)).rejects.toThrow();
      expect(restored.host.queries.getTask(id)?.status).toBe("cancelled");
      expect(parseRecognitionTaskFile(restored.host.queries.exportTask(id), restored.workspace.registry).checkpoint.step).toBe("inputs");
    } finally { restored?.dispose(); if (!initialDisposed) env.dispose(); }
  });

  it("识别成功沿用任务身份进入优化，固定配置不可覆盖", async () => {
    const env = setup(), blueprint = loadBlueprintFromFile(`${fixtures}plant-cycle.schema7.json`);
    try {
      const id = await env.host.actions.createBlueprintTask({ blueprint, boundaries: [], activeActivityIds: [] }, options);
      await vi.waitFor(() => expect(env.host.state.activeTaskId).toBeNull());
      const request = parseRecognitionTaskFile(env.host.queries.exportTask(id), env.workspace.registry).request;
      await expect(env.host.actions.updateBlueprintBoundaries(id, request.input.boundaries.map(boundary =>
        ({ ...boundary, itemId: "item_iron_ore" })))).rejects.toThrow("固定");
      await env.host.actions.identifyBlueprint(id);
      expect(env.host.queries.listTasks().map(task => task.taskId)).toEqual([id]);
      expect(env.host.queries.getResult(id)?.measuredOutputs).toEqual([{ itemId: "item_plant_moss_3", perMinute: 30 }]);
      const file = parsePlannerTaskFile(env.host.queries.exportTask(id), env.workspace.registry);
      expect(file.request.blueprintSource?.blueprint).toEqual(blueprint);
      const result = env.host.queries.getResult(id)!;
      expect(result.warmupSeconds).toBe(360);
      expect(file.checkpoint.blueprintBaseline!.candidate.execution).toMatchObject({
        warmupSeconds: 360, observationSeconds: 600, engine: { kind: "dense-v2", ticksPerSecond: 2 },
      });
      const directory = `.temp/eda/success/blueprint-recognition-${Date.now()}`;
      await mkdir(directory, { recursive: true });
      await Promise.all([writeFile(`${directory}/input.json`, JSON.stringify(file.request)),
        writeFile(`${directory}/blueprint.json`, JSON.stringify(result.blueprint)),
        writeFile(`${directory}/report.json`, JSON.stringify({ result, checkpoint: file.checkpoint }))]);
    } finally { env.dispose(); }
  });
});
