// @vitest-environment node
import { expect, it } from "vitest";
import type { BlueprintPlannerOptions, BlueprintPlannerRequest, BlueprintPlannerTaskFile } from "@/domain/blueprint-planner";
import { normalizePlannerProductionDimensionOptions } from "@/shared/planner-production-dimensions";
import { resolvePlannerDimensionConstraint, validateBlueprintPlannerDimensionOptions, validatePlannerDimensionOptions } from "@/shared/planner-dimension-limits";
import { plannerRequestKey } from "@/blueprint-planner/search-seed";
import { migrateTaskBlueprintSchemas } from "@/blueprint-planner/task-migration";
import { createBlueprintPlannerHost } from "@/blueprint-planner/blueprint-planner-host";
import { parsePlannerTaskFile, type PlannerCheckpoint } from "@/blueprint-planner/task-checkpoint";
import { assertPlannerWarehousePorts } from "@/blueprint-planner/verification";
import { PlannerBatchSession } from "@/scripts/eda/planner-runner";
import { createRegistryContract } from "@/registry";
import fixture from "./fixtures/separator-core.json";

const registry = createRegistryContract();
const base = fixture.request as BlueprintPlannerRequest;

it.each([0, -1, 0.5, Infinity, NaN, "12", null, [], {}].map(value => ({ value })))("生产忽略任意旧尺寸值 $value，独立两轴与原图严格校验不放宽", ({ value }) => {
  const options = { ...base.options, dimensionLimits: { shortest: value, straight: value, uShaped: value,
    maxBaseLength: 28, exactSideLength: 12 } } as unknown as BlueprintPlannerOptions;
  const normalized = normalizePlannerProductionDimensionOptions(options);
  expect(normalized.dimensionLimits).toEqual({ maxBaseLength: 28, exactSideLength: 12 });
  expect(() => validatePlannerDimensionOptions(options)).not.toThrow();
  expect(() => validateBlueprintPlannerDimensionOptions({ ...options, dimensionLimits: { shortest: value } } as never)).toThrow();
  const request = { ...base, options };
  expect(plannerRequestKey(request)).toBe(plannerRequestKey({ ...request, options: normalized }));
  expect(resolvePlannerDimensionConstraint(registry, request)).toMatchObject({ maxBaseLength: 28, exactSideLength: 12 });
  expect(() => validatePlannerDimensionOptions({ ...options, dimensionLimits: { exactBaseLength: 24, exactSideLength: 12 } })).toThrow();
});

it("无旧字段不复制，新轴零值仍拒绝；只有旧字段时与未填完全同义", () => {
  expect(normalizePlannerProductionDimensionOptions(base.options)).toBe(base.options);
  const options = { ...base.options, dimensionLimits: { shortest: 1, straight: { edge: 1 } } };
  expect(normalizePlannerProductionDimensionOptions(options).dimensionLimits).toBeUndefined();
  expect(resolvePlannerDimensionConstraint(registry, { ...base, options })).toEqual({ mode: "axes", baseSide: 2 });
  expect(() => validatePlannerDimensionOptions({ ...options, dimensionLimits: { maxSideLength: 0, shortest: -1 } })).toThrow();
  expect(() => validateBlueprintPlannerDimensionOptions({ ...base.options, dimensionLimits: { shortest: 5 } })).not.toThrow();
});

it("真实Host导入旧无效尺寸正常产解，历史成果恢复只重建旧调度并保留统计尾额与新轴", async () => {
  const batch = new PlannerBatchSession();
  const host = createBlueprintPlannerHost(batch.workspace, { storage: null, gpuLayout: false, worker: {
    build: (input, variant, budgetMs, evaluations, signal, update, seed, continuationStep, maximumArea, targetOutline, originSeed, sessionKey, attemptStrategy) =>
      batch.planner.build(input, variant, budgetMs, { maxEvaluations: evaluations, seed, continuationStep, maximumArea, targetOutline, originSeed, sessionKey, attemptStrategy }, update, signal),
    dispose: () => { void batch.planner.dispose(); },
  } });
  try {
    await host.whenSettled();
    const request: BlueprintPlannerRequest = { ...structuredClone(base), manualLayout: undefined, options: { ...base.options,
      warehouseBus: "corner", solidOutput: "warehouse", concurrency: 1, gpu: false, deterministicSearch: true,
      randomSeed: 85196838, initialArea: 336, evaluationsPerRound: 20_000, stopAfterFirstSolution: true,
      dimensionLimits: { exactBaseLength: 24, maxSideLength: 12 } } };
    const draft = host.queries.exportDraft(request);
    const raw = structuredClone(draft) as BlueprintPlannerTaskFile & { request: BlueprintPlannerRequest };
    Object.assign(raw.request, { options: { ...raw.request.options, dimensionLimits: { ...request.options.dimensionLimits,
      shortest: null, straight: { edge: -1 }, uShaped: "invalid" } } });
    const id = await host.actions.importTask(raw);
    host.actions.continuePlanning(id, 20_000, 1, false); await host.whenSettled();
    const first = host.queries.exportTask(id), point = first.checkpoint as PlannerCheckpoint;
    expect(point.best).not.toBeNull(); expect(point.result).not.toBeNull();
    expect((first.request as BlueprintPlannerRequest).options.dimensionLimits).toEqual(request.options.dimensionLimits);
    const candidate = point.best!.candidate, side = candidate.search.outline.baseSide!;
    expect(side % 2 === 0 ? candidate.metrics.width : candidate.metrics.height).toBe(24);
    expect(side % 2 === 0 ? candidate.metrics.height : candidate.metrics.width).toBeLessThanOrEqual(12);
    assertPlannerWarehousePorts(registry, request, candidate);
    // 以真实已保存任务恢复历史快照：旧上限70容纳现有成果；所有旧指纹同源，不伪造派发或评价。
    const legacy = JSON.parse(JSON.stringify(first), (_key, value: unknown) => {
      if (typeof value === "string" && value.startsWith('{"boundaryVersion":1,')) {
        const bound = JSON.parse(value) as BlueprintPlannerRequest;
        Object.assign(bound, { options: { ...bound.options, dimensionLimits: { ...bound.options.dimensionLimits, shortest: 70 } } });
        return JSON.stringify(bound);
      }
      if (value && typeof value === "object" && "warehouseBus" in value) {
        const options = value as BlueprintPlannerOptions;
        return { ...options, dimensionLimits: { ...options.dimensionLimits, shortest: 70 } };
      }
      return value;
    }) as BlueprintPlannerTaskFile;
    const original = structuredClone(legacy);
    const migrated = migrateTaskBlueprintSchemas(legacy), next = migrated.checkpoint as PlannerCheckpoint;
    expect(legacy).toEqual(original);
    expect(next.parallel!.dimensionSchedule).toBeUndefined();
    expect(next.parallel!.shards.every(shard => shard.dimensions === undefined && shard.unitStates === undefined)).toBe(true);
    expect(next.evaluations).toBe(point.evaluations); expect(next.unspentEvaluations).toBe(point.unspentEvaluations);
    expect(next.best!.candidate.execution).toEqual(candidate.execution); expect(next.result).toEqual(point.result);
    expect(parsePlannerTaskFile(migrated, registry).checkpoint.best).not.toBeNull();
    expect(migrateTaskBlueprintSchemas(migrated)).toEqual(migrated);
    // 与既有恢复测试相同：公开导入文件只调整被请求指纹排除的执行控制，再正式继续。
    const restoredId = await host.actions.importTask({ ...legacy, request: { ...(legacy.request as BlueprintPlannerRequest),
      options: { ...(legacy.request as BlueprintPlannerRequest).options, stopAfterFirstSolution: false } } });
    expect(host.queries.getResult(restoredId)).not.toBeNull();
    host.actions.continuePlanning(restoredId, 20_000, 1, false); await host.whenSettled();
    const restored = host.queries.exportTask(restoredId), restoredPoint = restored.checkpoint as PlannerCheckpoint;
    expect(restoredPoint.evaluations).toBeGreaterThanOrEqual(point.evaluations);
    expect(restoredPoint.evaluations + (restoredPoint.unspentEvaluations ?? 0)).toBe(point.evaluations + (point.unspentEvaluations ?? 0) + 20_000);
    expect((restored.request as BlueprintPlannerRequest).options.dimensionLimits).toEqual(request.options.dimensionLimits);
    assertPlannerWarehousePorts(registry, request, restoredPoint.best!.candidate);
  } finally { host.dispose(); await host.whenSettled(); await batch.dispose(); }
}, 90_000);
