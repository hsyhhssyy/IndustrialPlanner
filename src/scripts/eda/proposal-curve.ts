import { writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import type { PlannerAttemptRecord } from "./planner-runner";
import { comparePlannerRanks } from "@/blueprint-planner/quality";

/** 只在真实验收成功后降低面积；失败消耗保留，未知提案数不能伪装成精确横轴。 */
export function createProposalCurve(records: readonly PlannerAttemptRecord[]) {
  let cumulativeEvaluations = 0;
  let exact = true;
  let bestArea: number | null = null;
  let bestOccupiedCells: number | null = null;
  let bestCoverage: number | null = null;
  let bestRank: { area: number; outputStashCount?: number; secondary?: number } | null = null;
  const points = records.map((record, index) => {
    if (!Number.isSafeInteger(record.evaluations) || record.evaluations < 0) throw new Error("提案计数必须为非负安全整数。");
    cumulativeEvaluations += record.evaluations;
    exact &&= record.evaluationAccounting === "exact";
    const candidateArea = record.outcome === "success" ? record.area : undefined;
    if (record.outcome === "success" && (candidateArea === undefined || !Number.isFinite(candidateArea) || candidateArea <= 0)) {
      throw new Error("成功记录缺少有效面积。");
    }
    const improved = candidateArea !== undefined && (bestArea === null || candidateArea < bestArea);
    const quality = candidateArea === undefined ? undefined : record.search?.quality;
    if (quality && (!Number.isSafeInteger(quality.occupiedCells) || quality.occupiedCells < 0
      || quality.occupiedCells > candidateArea! || !Number.isFinite(quality.utilization)
      || Math.abs(quality.utilization - quality.occupiedCells / candidateArea!) > 1e-9)) {
      throw new Error("成功记录的占用并集与覆盖率不一致。");
    }
    const rank = candidateArea === undefined ? null : { ...quality, area: candidateArea,
      outputStashCount: quality?.outputStashCount, secondary: quality?.secondary };
    const selected = rank !== null && (bestRank === null || comparePlannerRanks(rank, bestRank) < 0);
    // 2026-09-30：面积下降点仍只记录面积下降；同面积少箱选优会同步当前方案的覆盖率。
    if (selected) {
      bestRank = rank;
      bestArea = candidateArea!;
      bestOccupiedCells = quality?.occupiedCells ?? null;
      bestCoverage = quality?.utilization ?? null;
    }
    return { attempt: index + 1, variant: record.variant, evaluations: record.evaluations, cumulativeEvaluations,
      exactCumulativeEvaluations: exact ? cumulativeEvaluations : null, evaluationAccounting: record.evaluationAccounting,
      elapsedMs: record.elapsedMs, outcome: record.outcome, candidateArea: candidateArea ?? null, bestArea, improved,
      candidateOccupiedCells: quality?.occupiedCells ?? null, candidateCoverage: quality?.utilization ?? null,
      bestOccupiedCells, bestCoverage,
      selected, candidateOutputStashCount: quality?.outputStashCount ?? null, bestOutputStashCount: bestRank?.outputStashCount ?? null,
      width: record.width, height: record.height, artifactPath: record.artifactPath };
  });
  return { schemaVersion: 3, exact, totalEvaluations: cumulativeEvaluations, bestArea,
    coverageDefinition: "union-of-delivered-entity-cells / bounding-box-area",
    bestOccupiedCells: points.at(-1)?.bestOccupiedCells ?? null, bestCoverage: points.at(-1)?.bestCoverage ?? null,
    improvements: points.filter(point => point.improved), points };
}

export async function saveProposalCurve(directory: string, curve: ReturnType<typeof createProposalCurve>): Promise<void> {
  const columns = ["attempt", "variant", "evaluations", "cumulativeEvaluations", "exactCumulativeEvaluations",
    "evaluationAccounting", "elapsedMs", "outcome", "candidateArea", "bestArea", "improved", "candidateOccupiedCells",
    "candidateCoverage", "bestOccupiedCells", "bestCoverage", "selected", "candidateOutputStashCount", "bestOutputStashCount", "width", "height", "artifactPath"] as const;
  const csv = [columns.join(","), ...curve.points.map(point => columns.map(column => {
    const value = point[column];
    return value === null || value === undefined ? "" : `"${String(value).replaceAll('"', '""')}"`;
  }).join(","))].join("\n") + "\n";
  await Promise.all([
    writeFile(resolve(directory, "proposal-area.json"), JSON.stringify(curve, null, 2)),
    writeFile(resolve(directory, "proposal-area.csv"), csv),
  ]);
}
