import type { BlueprintDocument } from "@/domain/document/blueprint-document";
import { BLUEPRINT_SCHEMA_VERSION } from "@/domain/document/blueprint-document";
import type { BlueprintPlannerRequest, BlueprintPlannerTaskFile } from "@/domain/blueprint-planner";
import { normalizeBlueprintDocument } from "@/shared/blueprints/blueprint-document-codec";
import { isBlueprintRecognitionRequest } from "@/shared/planner-task";
import type { PlannerCheckpoint } from "./task-checkpoint";
import { plannerRequestKey, type PlannerSearchSeed } from "./search-seed";
import type { PlannerCandidate } from "./candidate";

/** 内嵌蓝图有自己的版本；空升级不重置算法状态，也不执行旧算法的几何转换。 */
export function migrateTaskBlueprintSchemas(value: BlueprintPlannerTaskFile): BlueprintPlannerTaskFile {
  const file: { -readonly [K in keyof BlueprintPlannerTaskFile]: BlueprintPlannerTaskFile[K] } = structuredClone(value);
  const upgrade = (blueprint: BlueprintDocument): BlueprintDocument => {
    if (blueprint.schemaVersion === BLUEPRINT_SCHEMA_VERSION) return blueprint;
    const next = normalizeBlueprintDocument(blueprint);
    if (next === null) throw new Error("计算任务中的蓝图版本无法升级，原始任务已保留。");
    return next;
  };
  if (isBlueprintRecognitionRequest(file.request)) {
    file.request = { ...file.request, input: { ...file.request.input, blueprint: upgrade(file.request.input.blueprint) } };
    return file;
  }
  const upgradeRequest = (request: BlueprintPlannerRequest): BlueprintPlannerRequest => request.blueprintSource
    ? { ...request, blueprintSource: { ...request.blueprintSource, blueprint: upgrade(request.blueprintSource.blueprint) } } : request;
  // 指纹保存原始请求，network.request 可能已被归一化；分别升级，不能用网络请求重建指纹。
  const upgradeKey = (key: string): string => {
    const request = JSON.parse(key) as BlueprintPlannerRequest;
    const upgraded = upgradeRequest(request);
    return upgraded === request ? key : plannerRequestKey(upgraded);
  };
  file.request = upgradeRequest(file.request);
  const seed = (value: PlannerSearchSeed): PlannerSearchSeed => {
    const request = upgradeRequest(value.network.request);
    return { ...value, network: { ...value.network, request }, requestKey: upgradeKey(value.requestKey) };
  };
  const candidate = (value: PlannerCandidate | null | undefined): PlannerCandidate | null => value == null ? null : ({
    ...value, execution: { ...value.execution, blueprint: upgrade(value.execution.blueprint) },
    seed: value.seed ? seed(value.seed) : value.seed,
  });
  const point = file.checkpoint as PlannerCheckpoint;
  if (!point) return file;
  const pools = (portfolio: PlannerCheckpoint["portfolio"] | undefined) => portfolio === undefined ? portfolio : ({
    ...portfolio, pools: portfolio.pools.map(pool => {
      if (pool.entries.some(entry => entry.seed.requestKey !== pool.key)) throw new Error("检查点与当前生产方案不匹配。");
      return { ...pool, key: upgradeKey(pool.key), entries: pool.entries.map(entry => ({ ...entry, seed: seed(entry.seed) })) };
    }),
  });
  file.checkpoint = { ...point,
    ...(point.blueprintBaseline ? { blueprintBaseline: { ...point.blueprintBaseline, candidate: candidate(point.blueprintBaseline.candidate)! } } : {}),
    best: point.best ? { ...point.best, candidate: candidate(point.best.candidate)! } : point.best,
    pendingCandidate: candidate(point.pendingCandidate),
    result: point.result ? { ...point.result, blueprint: upgrade(point.result.blueprint) } : point.result,
    portfolio: pools(point.portfolio),
    ...(point.parallel ? { parallel: { ...point.parallel, requestKey: upgradeKey(point.parallel.requestKey),
      shards: point.parallel.shards.map(shard => ({ ...shard, portfolio: pools(shard.portfolio), pendingCandidate: candidate(shard.pendingCandidate) })) } } : {}),
  };
  return file;
}
