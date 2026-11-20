import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { BlueprintDocument } from "@/domain/document/blueprint-document";
import type { BlueprintPlannerOptions, BlueprintPlannerRequest, BlueprintPlannerTaskFile } from "@/domain/blueprint-planner";
import { createRegistryContract } from "@/registry";
import { prepareEdaDataMigration } from "@/blueprint-planner/data-migration";
import { migrateTaskBlueprintSchemas } from "@/blueprint-planner/task-migration";
import { createRecognitionTaskFile } from "@/blueprint-planner/blueprint-recognition-task";
import { plannerRequestKey } from "@/blueprint-planner/search-seed";
import { PLANNER_ALGORITHM_VERSION, type PlannerCheckpoint } from "@/blueprint-planner/task-checkpoint";
import { EDA_TASK_LOCATION, LEGACY_EDA_TASK_LOCATION, edaTaskStorage } from "@/shared/storage/eda-task-storage";
import { readFromIndexedDb, saveToIndexedDb } from "@/shared/storage/browser-storage";
import { subscribeToStorageChanges } from "@/shared/storage/storage-change-event";
import { normalizeBlueprintDocument } from "@/shared/blueprints/blueprint-document-codec";
import { createFakeIndexedDbFactory } from "../shared/fake-indexed-db";
import legacy from "./fixtures/legacy-boundary-task.json";
import blueprint from "../fixtures/blueprints/migration/plant-cycle.schema6.json";
import manualDraft from "./fixtures/manual-frozen-terminals.json";
import { manualPreparationKey } from "@/blueprint-planner/manual-constraints";
import { DATA_MIGRATION_STORE } from "@/shared/storage/data-migration-state";

beforeEach(() => { vi.stubGlobal("indexedDB", createFakeIndexedDbFactory()); });
afterEach(() => { localStorage.clear(); vi.unstubAllGlobals(); });
const registry = createRegistryContract();
const options: BlueprintPlannerOptions = { warehousePortPlacement: "any", solidSupply: "warehouse", fluidSupply: "conduit", warehouseBus: "straight",
  solidOutput: "stash", byproducts: "destroy", plantStartup: "preload", evaluationsPerRound: 20_000 };

it("旧人工草稿只补缺省字段，同步有效准备指纹，显式值与失效准备均保留", () => {
  const file = structuredClone(legacy.file) as unknown as BlueprintPlannerTaskFile & { request: BlueprintPlannerRequest; checkpoint: PlannerCheckpoint };
  const request = structuredClone(manualDraft) as BlueprintPlannerRequest;
  const manual = request.manualLayout!;
  const key = manualPreparationKey(request);
  Object.assign(manual.preparation, { sourceKey: JSON.stringify((JSON.parse(key) as unknown[]).slice(0, 5)) });
  Reflect.deleteProperty(manual, "orientation");
  Reflect.deleteProperty(manual, "boundary");
  file.request = request;
  const original = structuredClone(file);
  const next = migrateTaskBlueprintSchemas(file) as typeof file;
  expect(next.request.manualLayout).toEqual({ ...manual, orientation: "fixed", boundary: { position: null, rotation: null, assignments: [] },
    preparation: { ...manual.preparation, sourceKey: manualPreparationKey(next.request) } });
  expect(next.progress).toEqual(file.progress);
  expect(file).toEqual(original);
  expect(migrateTaskBlueprintSchemas(next)).toEqual(next);
  Object.assign(manual.preparation, { sourceKey: "stale" });
  expect((migrateTaskBlueprintSchemas(file).request as BlueprintPlannerRequest).manualLayout!.preparation.sourceKey).toBe("stale");
  const explicit = { ...next, request: { ...next.request, manualLayout: { ...next.request.manualLayout!, orientation: "free" as const,
    boundary: { position: null, rotation: 90 as const, assignments: [] } } } };
  expect(migrateTaskBlueprintSchemas(explicit).request).toEqual(explicit.request);
});

it("主库旧人工草稿在集中启动迁移落盘后补齐默认值，再次迁移不重复改写", async () => {
  const file = structuredClone(legacy.file) as unknown as BlueprintPlannerTaskFile & { request: BlueprintPlannerRequest };
  file.request = structuredClone(manualDraft) as BlueprintPlannerRequest;
  Reflect.deleteProperty(file.request.manualLayout!, "orientation");
  Reflect.deleteProperty(file.request.manualLayout!, "boundary");
  const original = structuredClone(file);
  await saveToIndexedDb({ ...EDA_TASK_LOCATION, key: file.taskId }, file);
  // 已迁入主库的正式版用户不会重新扫描旧库。
  await saveToIndexedDb({ databaseName: EDA_TASK_LOCATION.databaseName, storeName: DATA_MIGRATION_STORE, key: "eda-store" }, 1);
  const plan = await prepareEdaDataMigration();
  expect(plan.jobs).toHaveLength(1);
  for (const job of plan.jobs) await job.run();
  expect(await readFromIndexedDb({ ...EDA_TASK_LOCATION, key: file.taskId })).toEqual(original);
  await plan.finish?.();
  expect((await edaTaskStorage.load())[0]!.request).toMatchObject({ manualLayout: { orientation: "fixed", boundary: { position: null, rotation: null, assignments: [] } } });
  expect((await prepareEdaDataMigration()).jobs).toHaveLength(0);
});

it("内嵌蓝图空升级同步更新请求指纹且保留检查点、计数和原件", () => {
  const file = structuredClone(legacy.file) as unknown as BlueprintPlannerTaskFile & { request: BlueprintPlannerRequest; checkpoint: PlannerCheckpoint };
  // 2026-10-15：Schema 空升级仅在相同算法版本内维护种子；跨算法计算缓存按用户要求丢弃。
  Object.assign(file, { algorithmVersion: PLANNER_ALGORITHM_VERSION });
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

it("已完成旧人工约束迁移的主库任务再次补齐position，保留任务事实且重复启动无任务", async () => {
  const file = structuredClone(legacy.file) as unknown as BlueprintPlannerTaskFile & { request: BlueprintPlannerRequest };
  file.request = structuredClone(manualDraft) as BlueprintPlannerRequest;
  Reflect.deleteProperty(file.request.manualLayout!.boundary, "position");
  const original = structuredClone(file);
  await saveToIndexedDb({ ...EDA_TASK_LOCATION, key: file.taskId }, file);
  await saveToIndexedDb({ databaseName: EDA_TASK_LOCATION.databaseName, storeName: DATA_MIGRATION_STORE, key: "eda-store" }, 1);
  // AI-REMOVED 2026-11-20:
  // Reason: EDA转换器只持有eda-store迁入标记，版本调度由外层负责。Trigger: REQ-051迁移测试。
  // Evidence: prepareEdaDataMigration读取transferLocation。Replacement: 上方真实eda-store标记。Risk: Low。Human Review: Required。
  // Original code:
  // await saveToIndexedDb({ databaseName: EDA_TASK_LOCATION.databaseName, storeName: DATA_MIGRATION_STORE, key: "eda-blueprint-schema" },
  //   "eda-store-4:task-title-1:manual-constraints-1");
  const plan = await prepareEdaDataMigration();
  expect(plan.jobs).toHaveLength(1);
  for (const job of plan.jobs) await job.run();
  expect(await readFromIndexedDb({ ...EDA_TASK_LOCATION, key: file.taskId })).toEqual(original);
  await plan.finish?.();
  const restored = (await edaTaskStorage.load())[0]!;
  expect((restored.request as BlueprintPlannerRequest).manualLayout!.boundary.position).toBeNull();
  expect(restored.progress).toEqual(original.progress);
  expect((await prepareEdaDataMigration()).jobs).toHaveLength(0);
});

// AI-REMOVED 2026-11-20:
// Reason: it.each将[]解释成空参数行而非boundary值。Trigger: 非法边界迁移专项覆盖。
// Evidence: normal日志用例名显示undefined。Replacement: 下方对象行包装。Risk: Low。Human Review: Required。
// Original code:
// it.each([null, false, true, 0, 7, "invalid", [], {}, { rotation: 0 },
//   { rotation: 90, assignments: "invalid" }, { rotation: 30, assignments: [] }])(
//   "集中迁移保留显式非法boundary且不抛错：%j", boundary => {
it.each([null, false, true, 0, 7, "invalid", [], {}, { rotation: 0 },
  { rotation: 90, assignments: "invalid" }, { rotation: 30, assignments: [] }].map(boundary => ({ boundary })))(
  "集中迁移保留显式非法boundary且不抛错：$boundary", ({ boundary }) => {
    for (const missingOrientation of [false, true]) {
      const file = structuredClone(legacy.file) as unknown as BlueprintPlannerTaskFile & { request: BlueprintPlannerRequest };
      file.request = structuredClone(manualDraft) as BlueprintPlannerRequest;
      Object.assign(file.request.manualLayout!, { boundary });
      if (missingOrientation) Reflect.deleteProperty(file.request.manualLayout!, "orientation");
      const original = structuredClone(file);
      const upgraded = migrateTaskBlueprintSchemas(file);
      expect((upgraded.request as BlueprintPlannerRequest).manualLayout!.boundary).toEqual(boundary);
      expect(file).toEqual(original);
      expect(migrateTaskBlueprintSchemas(upgraded)).toEqual(upgraded);
    }
  },
);
