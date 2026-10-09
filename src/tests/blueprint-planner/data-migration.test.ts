import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { BlueprintDocument } from "@/domain/document/blueprint-document";
import type { BlueprintPlannerOptions, BlueprintPlannerRequest, BlueprintPlannerTaskFile } from "@/domain/blueprint-planner";
import { createRegistryContract } from "@/registry";
import { prepareEdaDataMigration } from "@/blueprint-planner/data-migration";
import { migrateTaskBlueprintSchemas } from "@/blueprint-planner/task-blueprint-migration";
import { createRecognitionTaskFile } from "@/blueprint-planner/blueprint-recognition-task";
import { plannerRequestKey } from "@/blueprint-planner/search-seed";
import type { PlannerCheckpoint } from "@/blueprint-planner/task-checkpoint";
import { EDA_TASK_LOCATION, LEGACY_EDA_TASK_LOCATION, edaTaskStorage } from "@/shared/storage/eda-task-storage";
import { readFromIndexedDb, saveToIndexedDb } from "@/shared/storage/browser-storage";
import { subscribeToStorageChanges } from "@/shared/storage/storage-change-event";
import { normalizeBlueprintDocument } from "@/shared/blueprints/blueprint-document-codec";
import { createFakeIndexedDbFactory } from "../shared/fake-indexed-db";
import legacy from "./fixtures/legacy-boundary-task.json";
import blueprint from "../fixtures/blueprints/migration/plant-cycle.schema6.json";

beforeEach(() => { vi.stubGlobal("indexedDB", createFakeIndexedDbFactory()); });
afterEach(() => { localStorage.clear(); vi.unstubAllGlobals(); });
const registry = createRegistryContract();
const options: BlueprintPlannerOptions = { solidSupply: "warehouse", fluidSupply: "conduit", warehouseBus: "straight",
  solidOutput: "stash", byproducts: "destroy", plantStartup: "preload", evaluationsPerRound: 20_000 };

it("内嵌蓝图空升级同步更新请求指纹且保留检查点、计数和原件", () => {
  const file = structuredClone(legacy.file) as unknown as BlueprintPlannerTaskFile & { request: BlueprintPlannerRequest; checkpoint: PlannerCheckpoint };
  const source = { blueprint: blueprint as BlueprintDocument, boundaries: [], activeActivityIds: [] };
  file.request = { ...file.request, blueprintSource: source };
  const seed = file.checkpoint.best!.candidate.seed!;
  Object.assign(seed.network, { request: file.request });
  Object.assign(seed, { requestKey: plannerRequestKey(file.request) });
  const original = structuredClone(file);
  const next = migrateTaskBlueprintSchemas(file) as typeof file;
  expect(next.request.blueprintSource!.blueprint).toEqual({ ...source.blueprint, schemaVersion: 7 });
  expect(next.checkpoint.best!.candidate.execution.blueprint).toEqual({ ...file.checkpoint.best!.candidate.execution.blueprint, schemaVersion: 7 });
  expect(next.checkpoint.best!.candidate.seed!.requestKey).toBe(plannerRequestKey(next.request));
  expect(next.progress).toEqual(file.progress);
  expect(next.checkpoint.evaluations).toBe(file.checkpoint.evaluations);
  expect(next.checkpoint.best!.report).toEqual(file.checkpoint.best!.report);
  expect(file).toEqual(original);
  expect(migrateTaskBlueprintSchemas(next)).toEqual(next);
});

it("EDA 一次性迁入主库，无同步事件；删光后不重新导入旧库", async () => {
  const file = createRecognitionTaskFile(registry, "recognition", { blueprint: normalizeBlueprintDocument(blueprint)!, boundaries: [], activeActivityIds: [] }, options);
  const old = { ...file, request: { ...file.request, input: { ...file.request.input, blueprint: { ...file.request.input.blueprint, schemaVersion: 6 } } } };
  await saveToIndexedDb({ ...LEGACY_EDA_TASK_LOCATION, key: old.taskId }, old);
  const changed = vi.fn();
  const stop = subscribeToStorageChanges(changed);
  const verify = vi.fn(async () => { throw new Error("识别检查点不应提前运行仿真"); });
  try {
    const plan = await prepareEdaDataMigration();
    expect(plan.jobs).toHaveLength(1);
    for (const job of plan.jobs) await job.run();
    expect(await readFromIndexedDb({ ...EDA_TASK_LOCATION, key: old.taskId })).toBeNull();
    await plan.finish?.();
    const [current] = await edaTaskStorage.load();
    expect(current?.request).toMatchObject({ input: { blueprint: { schemaVersion: 7 } } });
    expect(current?.progress).toEqual(old.progress);
    expect(await readFromIndexedDb({ ...LEGACY_EDA_TASK_LOCATION, key: old.taskId })).toEqual(old);
    await edaTaskStorage.delete(old.taskId);
    expect((await prepareEdaDataMigration()).jobs).toHaveLength(0);
    expect(await edaTaskStorage.load()).toEqual([]);
    expect(changed).not.toHaveBeenCalled();
    expect(verify).not.toHaveBeenCalled();
  } finally { stop(); }
});

it("启动迁移仅更新 JSON；旧算法和验收结果原样保留，不进入任务恢复", async () => {
  const file = structuredClone(legacy.file) as unknown as BlueprintPlannerTaskFile;
  await saveToIndexedDb({ ...LEGACY_EDA_TASK_LOCATION, key: file.taskId }, file);
  const plan = await prepareEdaDataMigration();
  for (const job of plan.jobs) await job.run();
  await plan.finish?.();
  const [stored] = await edaTaskStorage.load();
  expect(stored).toEqual(migrateTaskBlueprintSchemas(file));
  expect(stored?.algorithmVersion).toBe(file.algorithmVersion);
  expect(stored?.progress).toEqual(file.progress);
  expect((stored?.checkpoint as PlannerCheckpoint).best?.report).toEqual((file.checkpoint as PlannerCheckpoint).best?.report);
});
