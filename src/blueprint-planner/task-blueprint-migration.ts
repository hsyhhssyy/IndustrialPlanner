import type { BlueprintDocument } from "@/domain/document/blueprint-document";
import { BLUEPRINT_SCHEMA_VERSION } from "@/domain/document/blueprint-document";
import type { BlueprintPlannerRequest, BlueprintPlannerTaskFile } from "@/domain/blueprint-planner";
import { normalizeBlueprintDocument } from "@/shared/blueprints/blueprint-document-codec";
import { isBlueprintRecognitionRequest } from "@/shared/planner-task";
import type { PlannerCheckpoint } from "./task-checkpoint";
import { plannerRequestKey, type PlannerSearchSeed } from "./search-seed";
import type { PlannerCandidate } from "./candidate";
import { PLANNER_ALGORITHM_VERSION } from "./search-policy";

/** 内嵌蓝图有自己的版本；空升级不重置算法状态，也不执行旧算法的几何转换。 */
// 订正 2026-10-11：同步补齐旧任务的任意摆放选项与尺寸算法版本，不改变旧任务的几何规则。
// AI-CORRECTION 2026-10-15：不改算法版本；旧缓存原样携带到用户继续时统一丢弃，不解析其结构。
export function migrateTaskBlueprintSchemas(value: BlueprintPlannerTaskFile): BlueprintPlannerTaskFile {
  const file: { -readonly [K in keyof BlueprintPlannerTaskFile]: BlueprintPlannerTaskFile[K] } = structuredClone(value);
  const options = (value: BlueprintPlannerRequest["options"]) => value.warehousePortPlacement === undefined
    ? { ...value, warehousePortPlacement: "any" as const } : value;
  file.request = { ...file.request, options: options(file.request.options) };
  // AI-REMOVED 2026-10-15:
  // Reason: 算法版本不同统一丢弃搜索缓存，不逐版本伪装为另一版本。
  // Trigger: 用户要求任何算法更新都从最优面积重新调度。
  // Evidence: 旧种子和分片结构无需被新算法理解。
  // Replacement: 下方版本不同的成果提取。
  // Risk: 未形成成果的进展丢弃；Human Review: Required。
  // Original code:
  // if (["dimension-shards-1", "warehouse-port-shards-1"].includes(file.algorithmVersion)) file.algorithmVersion = "seeded-strategies-1";
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
  const upgradeRequest = (request: BlueprintPlannerRequest): BlueprintPlannerRequest => ({ ...request, options: options(request.options),
    ...(request.blueprintSource ? { blueprintSource: { ...request.blueprintSource, blueprint: upgrade(request.blueprintSource.blueprint) } } : {}) });
  // 指纹保存原始请求，network.request 可能已被归一化；分别升级，不能用网络请求重建指纹。
  const upgradeKey = (key: string): string => {
    const request = JSON.parse(key) as BlueprintPlannerRequest;
    const upgraded = upgradeRequest(request);
    return upgraded === request ? key : plannerRequestKey(upgraded);
  };
  file.request = upgradeRequest(file.request);
  // AI-REMOVED 2026-10-15:
  // Reason: Schema 转换先于任务恢复，过早删除缓存会破坏损坏任务的原文保护。
  // Trigger: task-checkpoint 的损坏历史导出回归失败。
  // Evidence: 未完成恢复即丢失 attempt、portfolio 等原始字段。
  // Replacement: restorePlannerTaskFile 原子重置；此处旧缓存不解析、不迁移。
  // Risk: 用户继续前仍保存旧缓存；Human Review: Required
  // Original code:
  //   if (file.algorithmVersion !== PLANNER_ALGORITHM_VERSION) {
  //     // 只读取成果的公开场景和验收约束；旧 seed、portfolio、parallel 的形状完全不参与转换。
  //     const previous = file.checkpoint as PlannerCheckpoint | undefined;
  //     const original = previous?.best?.candidate;
  //     const best = original ? { report: previous!.best!.report, candidate: {
  //       outlineOrigin: original.outlineOrigin,
  //       execution: { ...original.execution, blueprint: upgrade(original.execution.blueprint) },
  //       metrics: original.metrics, connections: original.connections, supplyAudit: original.supplyAudit,
  //       search: { seed: 0, evaluationLimit: 0, evaluations: 0, acceptedMoves: 0, routingAttempts: 0,
  //         initialWireLength: 0, finalWireLength: 0, outline: { width: original.metrics.width, height: original.metrics.height } },
  //     } satisfies PlannerCandidate } : null;
  //     file.checkpoint = { best, savedBlueprintId: previous?.savedBlueprintId ?? null };
  //     return file;
  //   }
  if (file.algorithmVersion !== PLANNER_ALGORITHM_VERSION) {
    const point = file.checkpoint as PlannerCheckpoint | undefined;
    const best = point?.best;
    if (best) file.checkpoint = { ...point, best: { ...best, candidate: { ...best.candidate,
      execution: { ...best.candidate.execution, blueprint: upgrade(best.candidate.execution.blueprint) } } } };
    return file;
  }
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
