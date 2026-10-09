// @vitest-environment node
import { mkdir, writeFile } from "node:fs/promises";
import { describe, expect, it, vi } from "vitest";
import { createWorkspaceState } from "@/domain/document/workspace-state";
import type { WorkspaceContract } from "@/domain/document/workspace-contract";
import { createRegistryContract } from "@/registry";
import { createSimulationHost } from "@/simulation/simulation-host";
import { createBlueprintPlannerHost } from "@/blueprint-planner/blueprint-planner-host";
import { excludeDisconnectedBlueprintPipes } from "@/blueprint-planner/blueprint-disconnections";
import { inspectBlueprintBoundaries } from "@/blueprint-planner/blueprint-analysis";
import { parseRecognitionTaskFile } from "@/blueprint-planner/blueprint-recognition-task";
import { parsePlannerTaskFile } from "@/blueprint-planner/task-checkpoint";
import { assertBlueprintPreserved } from "@/blueprint-planner/blueprint-constraints";
import { loadBlueprintFromFile } from "../simulation/blueprint-test-helpers";

const directory = "src/tests/fixtures/blueprints/blueprint-planner/blueprint-disconnections/";
const registry = createRegistryContract();
const options = { solidSupply: "warehouse", fluidSupply: "conduit", warehouseBus: "straight", solidOutput: "auto",
  byproducts: "destroy", plantStartup: "preload", evaluationsPerRound: 10_000, concurrency: 1 } as const;

describe("内部断连管道按支路排除", () => {
  it.each([
    ["broken-branch", ["bad1", "admission", "bad2", "bad3"]],
    ["bridge-channels", ["bad1", "bad2", "admission", "bad3"]],
    ["intact-branch", []],
    ["external-pipe", []],
  ] as const)("%s：排除整段支路，保留正常支路和真正外接断口", (name, expected) => {
    const blueprint = loadBlueprintFromFile(`${directory}${name}.schema7.json`), original = structuredClone(blueprint);
    const result = excludeDisconnectedBlueprintPipes(registry, { blueprint, boundaries: [], activeActivityIds: [] });
    expect([...result.excludedEntityIds].sort()).toEqual([...expected].sort());
    expect(blueprint).toEqual(original);
    expect(result.input.blueprint.entityOrder).toEqual(blueprint.entityOrder.filter(id => !expected.some(entry => entry === id)));
    expect(result.warning === null).toBe(expected.length === 0);
  });

  it("旧识别任务的内部假边界在导入时排除；成功后完整原图与有效验收图分别保留", async () => {
    const workspace: WorkspaceContract = { state: createWorkspaceState(), registry, app: null, audio: null, editor: null,
      render: null, simulation: null, sync: null, blueprintPlanner: null };
    const simulation = createSimulationHost(workspace, { engineKind: "dense-v2", workerMode: "runtime", blueprintDenseTickRate: 2 });
    const planner = createBlueprintPlannerHost(workspace, { storage: null });
    const blueprint = loadBlueprintFromFile(`${directory}plant-with-broken-pipe.schema7.json`), original = structuredClone(blueprint);
    try {
      const id = await planner.actions.createBlueprintTask({ blueprint, boundaries: [], activeActivityIds: [] }, options);
      await vi.waitFor(() => expect(planner.state.activeTaskId).toBeNull());
      const exported = parseRecognitionTaskFile(planner.queries.exportTask(id), registry);
      expect(exported.progress.message).toContain("内部管道断连");
      expect(exported.request.input.boundaries.every(boundary => !["bad1", "bad2", "bad3", "admission"].includes(boundary.entityId))).toBe(true);
      // 真实原图编译产生旧版假边界，导入必须清除其供料声明，不能因缺少物品锁住继续按钮。
      const rawReport = await simulation.actions.runBlueprint({ blueprint, activeActivityIds: [], engine: { kind: "dense-v2", ticksPerSecond: 2 },
        scene: { externalEntities: [], externalSlotLinks: [], initialSlots: [], powerMode: "infinite" }, probes: [],
        warmupSeconds: 0, observationSeconds: .5, inventorySampleCount: 2, maxWallTimeMs: 30_000, collectAnalysis: true });
      const oldBoundaries = inspectBlueprintBoundaries(registry, blueprint, rawReport.analysis!);
      expect(oldBoundaries.some(boundary => boundary.entityId === "bad2")).toBe(true);
      const old = { ...exported, request: { ...exported.request, detectedBoundaries: oldBoundaries,
        input: { ...exported.request.input, boundaries: oldBoundaries } }, checkpoint: { step: "verification" as const } };
      const imported = await planner.actions.importTask(old);
      const restored = parseRecognitionTaskFile(planner.queries.exportTask(imported), registry);
      expect(restored.checkpoint.step).toBe("inputs");
      expect(restored.request.input.blueprint).toEqual(original);
      expect(restored.request.input.boundaries).toEqual(exported.request.input.boundaries);
      expect(restored.progress.message).toContain("内部管道断连");
      await planner.actions.identifyBlueprint(imported);
      const file = parsePlannerTaskFile(planner.queries.exportTask(imported), registry);
      expect(file.request.blueprintSource!.blueprint).toEqual(original);
      expect(file.checkpoint.blueprintBaseline!.candidate.execution.blueprint.entities.admission).toBeUndefined();
      const baseline = file.checkpoint.blueprintBaseline!.candidate;
      expect(() => assertBlueprintPreserved(registry, file.request, baseline.seed!, { ...baseline.execution.blueprint,
        entities: { ...baseline.execution.blueprint.entities, admission: original.entities.admission! },
        entityOrder: [...baseline.execution.blueprint.entityOrder, "admission"] })).toThrow("新增了原图之外的设备或控制配置");
      expect(planner.queries.getResult(imported)!.measuredOutputs).toEqual([{ itemId: "item_plant_moss_3", perMinute: 30 }]);
      expect(planner.queries.getTask(imported)!.message).toContain("内部管道断连");
      const reimported = await planner.actions.importTask(file);
      expect(planner.queries.getResult(reimported)!.measuredOutputs).toEqual([{ itemId: "item_plant_moss_3", perMinute: 30 }]);
      expect(blueprint).toEqual(original);
      const resultDirectory = `.temp/eda/success/blueprint-disconnections-${Date.now()}`;
      await mkdir(resultDirectory, { recursive: true });
      await Promise.all([writeFile(`${resultDirectory}/input.json`, JSON.stringify(file.request)),
        writeFile(`${resultDirectory}/blueprint.json`, JSON.stringify(planner.queries.getResult(imported)!.blueprint)),
        writeFile(`${resultDirectory}/report.json`, JSON.stringify({ progress: file.progress, checkpoint: file.checkpoint }))]);
    } finally { planner.dispose(); simulation.dispose(); }
  });

  it("排除后没有有效设备时明确失败并保留原图，不补成外部供料", async () => {
    const workspace: WorkspaceContract = { state: createWorkspaceState(), registry, app: null, audio: null, editor: null,
      render: null, simulation: null, sync: null, blueprintPlanner: null };
    const simulation = createSimulationHost(workspace, { engineKind: "dense-v2", workerMode: "runtime", blueprintDenseTickRate: 2 });
    const planner = createBlueprintPlannerHost(workspace, { storage: null });
    const blueprint = loadBlueprintFromFile(`${directory}broken-only.schema7.json`);
    try {
      const id = await planner.actions.createBlueprintTask({ blueprint, boundaries: [], activeActivityIds: [] }, options);
      await vi.waitFor(() => expect(planner.state.activeTaskId).toBeNull());
      expect(planner.queries.getTask(id)).toMatchObject({ status: "failed", message: expect.stringContaining("没有可识别的设备") });
      expect(parseRecognitionTaskFile(planner.queries.exportTask(id), registry).request.input.blueprint).toEqual(blueprint);
    } finally { planner.dispose(); simulation.dispose(); }
  });
});
