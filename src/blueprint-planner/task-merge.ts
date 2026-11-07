import type { BlueprintPlannerTaskFile } from "@/domain/blueprint-planner";
import type { RegistryContract } from "@/domain/registry/registry-contract";
import { hasPlannerStarted } from "@/shared/planner-task";
import { restorePlannerTaskFile } from "./task-migration";
import { parsePlannerTaskFile, type PlannerCheckpoint, type PlannerShardCheckpoint } from "./task-checkpoint";
import { comparePlannerRanks } from "./quality";
import { partitionPlannerDimensions } from "./dimension-schedule";
import { mergePlannerFailureSummaries } from "./failure-summary";

/** 独立分片的已提交检查点合并；跨机器没有可信的全局事件时钟，只记录合并时的准确总计数。 */
export async function mergePlannerTaskFiles(values: readonly BlueprintPlannerTaskFile[], registry: RegistryContract): Promise<BlueprintPlannerTaskFile> {
  if (values.length < 1) throw new Error("至少提供一个分片任务。");
  const files = [];
  for (const value of values) files.push(await restorePlannerTaskFile(value, registry));
  const first = files[0]!;
  const base = first.checkpoint.parallel;
  if (!base) throw new Error("任务没有分片检查点。");
  const selected = new Map<number, PlannerShardCheckpoint>();
  for (const file of files) {
    const parallel = file.checkpoint.parallel;
    if (!parallel || parallel.count !== base.count || parallel.originTaskId !== base.originTaskId
      || parallel.requestKey !== base.requestKey || parallel.baseAttempt !== base.baseAttempt
      || parallel.baseVariant !== base.baseVariant
      || file.checkpoint.randomSeed !== first.checkpoint.randomSeed
      || parallel.baseEvaluations !== base.baseEvaluations
      || parallel.baseValidatedCandidates !== base.baseValidatedCandidates) throw new Error("分片任务不是同一计算起点。");
    for (const index of parallel.ownedShards) {
      if (selected.has(index)) throw new Error(`分片 ${index} 重复，不能合并。`);
      selected.set(index, structuredClone(parallel.shards[index]!));
    }
  }
  if (selected.size !== base.count) throw new Error(`分片不完整：已收到 ${selected.size}/${base.count}。`);
  const shards = Array.from({ length: base.count }, (_, index) => selected.get(index)!);
  const attempt = base.baseAttempt + shards.reduce((sum, shard) => sum + shard.attempts, 0);
  const evaluations = base.baseEvaluations + shards.reduce((sum, shard) => sum + shard.evaluations, 0);
  const ranked = files.filter(file => file.checkpoint.best !== null).sort((a, b) => {
    const candidateA = a.checkpoint.best!.candidate, candidateB = b.checkpoint.best!.candidate;
    return comparePlannerRanks({ area: candidateA.metrics.area,
      outputStashCount: candidateA.search.quality?.outputStashCount,
      secondary: candidateA.search.quality?.secondary ?? candidateA.metrics.score },
    { area: candidateB.metrics.area, outputStashCount: candidateB.search.quality?.outputStashCount,
      secondary: candidateB.search.quality?.secondary ?? candidateB.metrics.score });
  });
  const winner = ranked[0];
  const best = winner?.checkpoint.best ?? null;
  const result = winner?.checkpoint.result ?? null;
  // 离线进程可能独立发现不同面积；合并采用胜出目标的唯一分配，异目标游标不能拼接。
  const schedule = winner?.checkpoint.parallel?.dimensionSchedule
    ?? (!best || base.dimensionSchedule?.targetArea === best.candidate.metrics.area ? base.dimensionSchedule : undefined);
  if (schedule) {
    const dimensions = partitionPlannerDimensions(schedule.targetArea, schedule.minimum, schedule.warehousePorts, schedule.inclusive, schedule.boundaryLength);
    for (const shard of shards) {
      const source = files.find(file => file.checkpoint.parallel!.ownedShards.includes(shard.index))!.checkpoint.parallel!;
      const sameTarget = source.dimensionSchedule?.targetArea === schedule.targetArea
        && source.dimensionSchedule.minimum.width === schedule.minimum.width
        && source.dimensionSchedule.minimum.height === schedule.minimum.height
        && JSON.stringify(source.dimensionSchedule.units) === JSON.stringify(schedule.units);
      shard.dimensions = dimensions[shard.index]!;
      if (!sameTarget) { shard.dimensionCursor = 0; shard.pendingCandidate = null; shard.unitStates = {}; }
    }
  } else for (const shard of shards) {
    // 新旧算法混合且胜出目标尚无分配：保留统计，下一次运行统一生成，不能拼接不同目标的清单。
    Reflect.deleteProperty(shard, "dimensions");
    Reflect.deleteProperty(shard, "dimensionCursor");
  }
  const taskId = base.originTaskId;
  const initialAreas = new Set(files.flatMap(file => file.progress.initialArea === undefined ? [] : [file.progress.initialArea]));
  if (initialAreas.size > 1) throw new Error("分片的初始面积基准不一致。");
  const merged: BlueprintPlannerTaskFile = {
    ...first, taskId,
    checkpoint: { ...first.checkpoint, attempt, evaluations, best,
      unspentEvaluations: files.reduce((sum, file) => sum + (file.checkpoint.unspentEvaluations ?? 0), 0),
      unspentEvaluationsOwner: shards[0]?.index,
      failureSummary: mergePlannerFailureSummaries(files.map(file => ({ summary: file.checkpoint.failureSummary,
        ownedShards: file.checkpoint.parallel!.ownedShards }))),
      result: result ? { ...result, taskId, folderId: null } : null,
      savedBlueprintId: null, pendingCandidate: null, legacyHistoryLength: 0,
      parallel: { ...base, dimensionSchedule: schedule, ownedShards: shards.map(shard => shard.index), shards } } satisfies PlannerCheckpoint,
    progress: { ...first.progress, taskId, status: "waiting", estimatedProgress: null,
      planningStarted: files.some(file => hasPlannerStarted(file.progress)),
      initialArea: initialAreas.values().next().value,
      elapsedMs: Math.max(...files.map(file => file.progress.elapsedMs)),
      evaluatedProposals: evaluations, roundEvaluatedProposals: 0, candidateCount: attempt,
      validatedCandidateCount: base.baseValidatedCandidates + shards.reduce((sum, shard) => sum + shard.validatedCandidates, 0),
      bestArea: best?.candidate.metrics.area ?? null,
      areaHistory: best ? [{ evaluatedProposals: evaluations, bestArea: best.candidate.metrics.area }] : [],
      message: "分片结果已合并，可以继续计算或保存蓝图。" },
  };
  return parsePlannerTaskFile(merged, registry);
}
