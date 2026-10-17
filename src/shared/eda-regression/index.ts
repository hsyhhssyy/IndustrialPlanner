import type { BlueprintPlannerProgress, BlueprintPlannerRequest, BlueprintPlannerResult, BlueprintPlannerTaskFile } from "@/domain/blueprint-planner";
import definitions from "./cases.json";

export type EdaRegressionCase = typeof definitions[number];
export const EDA_REGRESSION_CASES: readonly EdaRegressionCase[] = definitions;

/** 输入是正式任务文件；界面仅传递，不解释或改写规划器的 checkpoint。 */
// AI-CORRECTION 2026-10-17：改为声明式任务输入，不携带算法版本或检查点；正式 Host 每轮生成当前版本的空状态。
export async function loadEdaRegressionInput(id: string): Promise<BlueprintPlannerRequest> {
  if (!EDA_REGRESSION_CASES.some(test => test.id === id)) throw new Error(`未知 EDA 用例：${id}`);
  const definition = EDA_REGRESSION_CASES.find(test => test.id === id)!;
  const input = id === "filter-core-120-2s" ? (await import("./cases/filter-core-120-2s.json")).default
    : id === "xiranite-2s-first-solution" ? (await import("./cases/xiranite-2s-first-solution.json")).default : null;
  if (input === null) throw new Error(`EDA 用例缺少声明式输入：${id}`);
  if (input.formatVersion !== 1) throw new Error("EDA 用例格式无效。");
  const request = structuredClone(input.request);
  return { ...request, options: { ...request.options, randomSeed: definition.seed, initialArea: definition.initialArea,
    evaluationsPerRound: definition.roundEvaluations, concurrency: definition.concurrency, gpu: definition.gpu,
    stopAfterFirstSolution: true, deterministicSearch: true } } as BlueprintPlannerRequest;
}

export interface EdaRegressionCheck {
  readonly name: string;
  readonly passed: boolean;
  readonly actual: unknown;
  readonly expected: unknown;
}

/** 本地和远端共用同一验收规则；结算总数严格小于阈值，不能用首解曲线代替。 */
export function checkEdaRegression(test: EdaRegressionCase, initial: BlueprintPlannerProgress | null,
  final: BlueprintPlannerProgress | null, result: BlueprintPlannerResult | null, seed: number | null): EdaRegressionCheck[] {
  const check = (name: string, passed: boolean, actual: unknown, expected: unknown): EdaRegressionCheck => ({ name, passed, actual, expected });
  return [
    check("randomSeed", seed === test.seed, seed, test.seed),
    check("coldStart", initial !== null && initial.evaluatedProposals === 0 && initial.roundEvaluatedProposals === 0
      && initial.validatedCandidateCount === 0 && initial.bestArea === null && !initial.areaHistory?.length,
    initial && { evaluations: initial.evaluatedProposals, validated: initial.validatedCandidateCount, bestArea: initial.bestArea }, "zero evaluations and no results"),
    check("initialArea", initial?.initialArea === test.initialArea && final?.initialArea === test.initialArea,
      { initial: initial?.initialArea, final: final?.initialArea }, test.initialArea),
    check("validatedResult", result !== null && (final?.validatedCandidateCount ?? 0) > 0, final?.validatedCandidateCount ?? 0, "> 0"),
    check("firstSolution", final?.validatedCandidateCount === 1 && final.areaHistory?.length === 1
      && final.areaHistory[0]?.bestArea === result?.metrics.area,
    final && { validated: final.validatedCandidateCount, history: final.areaHistory }, "exactly one accepted solution"),
    check("settled", final !== null && ["waiting", "completed", "cancelled"].includes(final.status) && final.activeWorkerCount === 0,
      final && { status: final.status, activeWorkers: final.activeWorkerCount }, "settled without failure; zero active workers"),
    check("finalArea", result !== null && result.metrics.area === result.metrics.width * result.metrics.height
      && result.metrics.area > 0 && result.metrics.area <= test.maximumArea && final?.bestArea === result.metrics.area,
    result?.metrics.area ?? null, `<= ${test.maximumArea}`),
    check("totalEvaluations", final !== null && final.evaluatedProposals > 0 && final.evaluatedProposals < test.exclusiveEvaluationLimit,
      final?.evaluatedProposals ?? null, `< ${test.exclusiveEvaluationLimit}`),
    ...test.targets.map(target => {
      const measured = result?.measuredOutputs.find(flow => flow.itemId === target.itemId)?.perMinute;
      return check(`output:${target.itemId}`, measured !== undefined && measured >= target.perMinute - 1e-6, measured ?? null, `>= ${target.perMinute}`);
    }),
  ];
}

export interface EdaRegressionReport {
  readonly formatVersion: 1;
  readonly test: EdaRegressionCase;
  readonly status: "passed" | "failed" | "cancelled";
  readonly startedAt: string;
  readonly finishedAt: string;
  readonly elapsedMs: number;
  readonly appVersion: string;
  readonly algorithmVersion: string | null;
  readonly hardware: { readonly userAgent: string; readonly logicalProcessors: number; readonly hardwareGpu: boolean;
    readonly gpuAdapter: string | null };
  readonly initial: BlueprintPlannerProgress | null;
  readonly final: BlueprintPlannerProgress | null;
  readonly checks: readonly EdaRegressionCheck[];
  readonly error: string | null;
  readonly cleanupPassed: boolean;
  readonly input: BlueprintPlannerTaskFile | null;
  readonly task: BlueprintPlannerTaskFile | null;
  readonly result: BlueprintPlannerResult | null;
}
