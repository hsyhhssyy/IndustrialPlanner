import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { BlueprintDocument } from "@/domain/document/blueprint-document";
import type { BlueprintPlannerRequest, BlueprintPlannerTaskFile } from "@/domain/blueprint-planner";
import { createWorkspaceState } from "@/domain/document/workspace-state";
import { createRegistryContract } from "@/registry";
import { createBlueprintPlannerHost } from "@/blueprint-planner/blueprint-planner-host";
import { createRecognitionTaskFile } from "@/blueprint-planner/blueprint-recognition-task";
import { prepareEdaDataMigration, EDA_MIGRATION_VERSION } from "@/blueprint-planner/data-migration";
import { migrateTaskBlueprintSchemas } from "@/blueprint-planner/task-blueprint-migration";
import { emptyPlannerCheckpoint, parsePlannerTaskFile, PLANNER_ALGORITHM_VERSION } from "@/blueprint-planner/task-checkpoint";
import { createProductionNetwork } from "@/blueprint-planner/production-network";
import { capturePlannerSeed, plannerRequestKey } from "@/blueprint-planner/search-seed";
import { PlannerSearchPortfolio } from "@/blueprint-planner/search-portfolio";
import { createDataMigrationController, installDataMigrationController, readDataMigrationProgress } from "@/shared/data-migration";
import { isDataMigrationComplete, DATA_MIGRATION_STORE } from "@/shared/storage/data-migration-state";
import { prepareLocalMigrationRecovery } from "@/shared/storage/local-migration-recovery";
import { EDA_TASK_LOCATION, LEGACY_EDA_TASK_LOCATION, edaTaskStorage } from "@/shared/storage/eda-task-storage";
import * as browserStorage from "@/shared/storage/browser-storage";
import { normalizeBlueprintDocument } from "@/shared/blueprints/blueprint-document-codec";
import { createFakeIndexedDbFactory } from "../shared/fake-indexed-db";
import environment from "./fixtures/environment-supply.json";
import sourceBlueprint from "../fixtures/blueprints/blueprint-planner/blueprint-optimization/plant-cycle.schema6.json";

const registry = createRegistryContract();
let disposeRecovery: (() => void) | undefined;
let uninstall: (() => void) | undefined;
beforeEach(() => {
  vi.stubGlobal("indexedDB", createFakeIndexedDbFactory());
  vi.stubGlobal("navigator", { locks: { request: async (_name: string, _options: unknown, action: () => Promise<unknown>) => action() } });
});
afterEach(() => {
  uninstall?.(); disposeRecovery?.(); uninstall = undefined; disposeRecovery = undefined;
  localStorage.clear(); vi.unstubAllGlobals(); vi.restoreAllMocks();
});

function draft(taskId = "valid-task", request = structuredClone(environment) as BlueprintPlannerRequest) {
  return { formatVersion: 1, algorithmVersion: PLANNER_ALGORITHM_VERSION, taskId, request, checkpoint: emptyPlannerCheckpoint(),
    progress: { taskId, status: "waiting", phase: "preparing", startedAt: 1, elapsedMs: 0, estimatedProgress: null,
      evaluatedProposals: 0, roundEvaluatedProposals: 0, candidateCount: 0, validatedCandidateCount: 0,
      bestArea: null, areaHistory: [], message: null } } satisfies BlueprintPlannerTaskFile;
}

async function boot() {
  disposeRecovery?.();
  disposeRecovery = await prepareLocalMigrationRecovery({ schemaVersion: 7, migrationVersion: EDA_MIGRATION_VERSION,
    buildId: "eda-isolation-test", onInvalidated: () => {} });
}

function controller(verify = vi.fn(async () => { throw new Error("本场景不应启动验收"); })) {
  const prepare = vi.fn(() => prepareEdaDataMigration(registry, verify));
  const value = createDataMigrationController(EDA_MIGRATION_VERSION, [{ prepare }]);
  uninstall?.(); uninstall = installDataMigrationController(value);
  return { value, prepare, verify };
}

function host() {
  return createBlueprintPlannerHost({ state: createWorkspaceState(), registry,
    app: null, audio: null, editor: null, render: null, simulation: null, sync: null, blueprintPlanner: null });
}

it("6→7 同步迁移主池、并行池及原始请求指纹，保留归一化网络与搜索次数", () => {
  const request: BlueprintPlannerRequest = { ...structuredClone(environment) as BlueprintPlannerRequest,
    blueprintSource: { blueprint: structuredClone(sourceBlueprint) as BlueprintDocument, boundaries: [], activeActivityIds: [] } };
  const seed = capturePlannerSeed(request, createProductionNetwork(registry, request), [], [], 20, 20);
  expect(seed.requestKey).not.toBe(plannerRequestKey(seed.network.request));
  const portfolio = new PlannerSearchPortfolio(request, seed);
  portfolio.next(0); portfolio.next(1);
  const snapshot = portfolio.snapshot();
  const file = { ...draft("schema-task", request), checkpoint: { ...emptyPlannerCheckpoint(), portfolio: snapshot,
    parallel: { count: 1, originTaskId: "schema-task", baseAttempt: 0, baseEvaluations: 0, baseValidatedCandidates: 0,
      ownedShards: [0], requestKey: plannerRequestKey(request), nextShard: 0,
      shards: [{ index: 0, nextVariant: 1, attempts: 2, evaluations: 7, validatedCandidates: 0,
        portfolio: snapshot, pendingCandidate: null, shapeVisits: {} }] } } };
  const original = structuredClone(file);
  const migrated = migrateTaskBlueprintSchemas(file) as typeof file;
  const expected = plannerRequestKey(migrated.request);
  expect(migrated.checkpoint.parallel.requestKey).toBe(expected);
  for (const restored of [migrated.checkpoint.portfolio, migrated.checkpoint.parallel.shards[0]!.portfolio]) {
    expect(restored.pools[0]!.key).toBe(expected);
    expect(restored.pools[0]!.entries[0]!.seed.requestKey).toBe(expected);
    expect(restored.pools[0]!.entries[0]!.visits).toBe(snapshot.pools[0]!.entries[0]!.visits);
    expect(restored.pools[0]!.attemptsWithoutImprovement).toBe(snapshot.pools[0]!.attemptsWithoutImprovement);
    expect(() => new PlannerSearchPortfolio(migrated.request).restore(restored)).not.toThrow();
  }
  expect(migrated.progress).toEqual(file.progress);
  expect(migrated.checkpoint.parallel.shards[0]!.evaluations).toBe(7);
  expect(file).toEqual(original);
  expect(migrateTaskBlueprintSchemas(migrated)).toEqual(migrated);
});

it("没有来源蓝图时保留原始指纹，不用归一化后的网络请求覆盖它", () => {
  const file = draft();
  const seed = capturePlannerSeed(file.request, createProductionNetwork(registry, file.request), [], [], 20, 20);
  const portfolio = new PlannerSearchPortfolio(file.request, seed).snapshot();
  const source = { ...file, checkpoint: { ...file.checkpoint, portfolio } };
  const next = migrateTaskBlueprintSchemas(source) as typeof source;
  expect(next.checkpoint.portfolio).toEqual(portfolio);
  expect(() => parsePlannerTaskFile(next, registry)).not.toThrow();
});

it("迁移不能把不一致的旧池或其他生产方案的指纹修成合法检查点", () => {
  const file = draft();
  const seed = capturePlannerSeed(file.request, createProductionNetwork(registry, file.request), [], [], 20, 20);
  const portfolio = new PlannerSearchPortfolio(file.request, seed).snapshot();
  const mismatched = structuredClone(portfolio);
  Object.assign(mismatched.pools[0]!, { key: "broken" });
  expect(() => migrateTaskBlueprintSchemas({ ...file, checkpoint: { ...file.checkpoint, portfolio: mismatched } })).toThrow("不匹配");
  const foreign = structuredClone(portfolio);
  const key = plannerRequestKey({ ...file.request, plan: { ...file.request.plan, name: "其他方案" } });
  Object.assign(foreign.pools[0]!, { key });
  Object.assign(foreign.pools[0]!.entries[0]!.seed, { requestKey: key });
  const next = migrateTaskBlueprintSchemas({ ...file, checkpoint: { ...file.checkpoint, portfolio: foreign } });
  expect(() => parsePlannerTaskFile(next, registry)).toThrow("不匹配");
});

it("启动逐项隔离失败任务，保留磁盘原文和旧库，完成后刷新不重复迁移", async () => {
  const good = draft();
  const unknown = { ...draft("unknown"), algorithmVersion: "future" };
  const raw = "{broken-json";
  for (const file of [good, unknown]) await browserStorage.saveToIndexedDb({ ...LEGACY_EDA_TASK_LOCATION, key: file.taskId }, file);
  expect(await browserStorage.applyRawIndexedDbTransactionMutations(LEGACY_EDA_TASK_LOCATION, [
    { storeName: LEGACY_EDA_TASK_LOCATION.storeName, operations: [{ type: "put", key: "broken-json", value: raw }] },
  ])).toBe(true);
  await boot();
  const migration = controller();
  await expect(migration.value.run()).resolves.toBeUndefined();
  expect(await isDataMigrationComplete(EDA_MIGRATION_VERSION)).toBe(true);
  expect(readDataMigrationProgress().phase).toBe("idle");
  expect((await edaTaskStorage.load()).map(file => file.taskId)).toEqual([good.taskId]);
  expect(await edaTaskStorage.loadQuarantined()).toEqual(expect.arrayContaining([
    expect.objectContaining({ taskId: unknown.taskId, sourceKey: unknown.taskId, sourceValue: JSON.stringify(unknown) }),
    expect.objectContaining({ taskId: "broken-json", sourceValue: raw }),
  ]));
  expect(await browserStorage.readFromIndexedDb({ ...LEGACY_EDA_TASK_LOCATION, key: unknown.taskId })).toEqual(unknown);
  const first = host();
  try {
    await first.pauseForMigration();
    expect(first.queries.getTask(good.taskId)?.status).toBe("waiting");
    expect(first.queries.getTask(unknown.taskId)?.status).toBe("failed");
    expect(first.queries.exportTask(unknown.taskId)).toEqual(unknown);
    expect(first.queries.exportTask("broken-json")).toBe(raw);
    expect(() => first.actions.continuePlanning(unknown.taskId, 10000)).toThrow("无法继续");
    // 正常任务入口仍能接受新任务，不受隔离记录影响。
    expect(await first.actions.importTask(good)).not.toBe(good.taskId);
  } finally { first.dispose(); await first.pauseForMigration(); }
  await boot();
  await migration.value.run();
  expect(migration.prepare).toHaveBeenCalledTimes(1);
  const second = host();
  try {
    await second.pauseForMigration();
    expect(second.queries.exportTask(unknown.taskId)).toEqual(unknown);
    await second.actions.deleteTask(unknown.taskId);
    await second.actions.deleteTask("broken-json");
    expect(await edaTaskStorage.loadQuarantined()).toEqual([]);
    expect((await prepareEdaDataMigration(registry, migration.verify)).jobs).toHaveLength(0);
  } finally { second.dispose(); await second.pauseForMigration(); }
  expect(migration.verify).not.toHaveBeenCalled();
});

it.each([
  ["unsupported-schema", (): BlueprintPlannerTaskFile => {
    const file = createRecognitionTaskFile(registry, "unsupported-schema",
      { blueprint: normalizeBlueprintDocument(sourceBlueprint)!, boundaries: [], activeActivityIds: [] }, environment.options as BlueprintPlannerRequest["options"]);
    file.request.input.blueprint.schemaVersion = 999;
    return file;
  }],
  ["wrong-key", (): BlueprintPlannerTaskFile => draft("different-id")],
  ["null-record", (): null => null],
  ["bad-progress", (): BlueprintPlannerTaskFile => ({ ...draft("bad-progress"), progress: { ...draft("bad-progress").progress, elapsedMs: -1 } })],
] as const)("已迁入主库的 %s 在预检失败时也能原文隔离并移出活动库", async (key, makeSource) => {
  const source = makeSource();
  await browserStorage.saveToIndexedDb({ ...EDA_TASK_LOCATION, storeName: DATA_MIGRATION_STORE, key: "eda-store" }, 1);
  await browserStorage.saveToIndexedDb({ ...EDA_TASK_LOCATION, key }, source);
  await boot();
  const migration = controller();
  await migration.value.run();
  expect(await edaTaskStorage.load()).toEqual([]);
  expect(await edaTaskStorage.loadQuarantined()).toEqual([expect.objectContaining({
    taskId: key, sourceKey: key, sourceValue: JSON.stringify(source), migrationVersion: EDA_MIGRATION_VERSION,
  })]);
  expect(await isDataMigrationComplete(EDA_MIGRATION_VERSION)).toBe(true);
  await boot();
  await migration.value.run();
  expect(migration.prepare).toHaveBeenCalledTimes(1);
});

it("隔离事务未提交时不移除活动原件、不写完成标记，重试后正常进入", async () => {
  const file = { ...draft("blocked"), algorithmVersion: "future" };
  await browserStorage.saveToIndexedDb({ ...EDA_TASK_LOCATION, storeName: DATA_MIGRATION_STORE, key: "eda-store" }, 1);
  await browserStorage.saveToIndexedDb({ ...EDA_TASK_LOCATION, key: file.taskId }, file);
  await boot();
  const migration = controller();
  const fail = vi.spyOn(browserStorage, "applyRawIndexedDbTransactionMutations").mockResolvedValueOnce(false);
  await expect(migration.value.run()).rejects.toThrow("未能保存");
  expect(await isDataMigrationComplete(EDA_MIGRATION_VERSION)).toBe(false);
  expect(await edaTaskStorage.load()).toEqual([file]);
  expect(await edaTaskStorage.loadQuarantined()).toEqual([]);
  fail.mockRestore();
  await migration.value.run();
  expect(await edaTaskStorage.load()).toEqual([]);
  expect(await isDataMigrationComplete(EDA_MIGRATION_VERSION)).toBe(true);
});

it("工作台已打开时导入无法升级的任务不进入全局冻结，仍可导出原件", async () => {
  await boot();
  const migration = controller();
  await migration.value.run();
  const file = { ...draft("bad-import"), request: null } as unknown as BlueprintPlannerTaskFile;
  const planner = host();
  try {
    await planner.pauseForMigration();
    const id = await planner.actions.importTask(file);
    expect(planner.queries.getTask(id)?.status).toBe("failed");
    expect(planner.queries.exportTask(id)).toMatchObject({ algorithmVersion: file.algorithmVersion, request: null });
    expect(await edaTaskStorage.load()).toEqual([]);
    expect(await edaTaskStorage.loadQuarantined()).toEqual([expect.objectContaining({
      taskId: id, sourceValue: expect.objectContaining({ taskId: id, request: null }),
    })]);
    expect(readDataMigrationProgress().phase).toBe("idle");
    expect(migration.prepare).toHaveBeenCalledTimes(1);
    expect(await isDataMigrationComplete(EDA_MIGRATION_VERSION)).toBe(true);
  } finally { planner.dispose(); await planner.pauseForMigration(); }
});
