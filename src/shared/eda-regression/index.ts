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
    : id === "cuprium-canister-30-2s" ? (await import("./cases/cuprium-canister-30-2s.json")).default
    : id === "pyrrolite-canister-30-2s" ? (await import("./cases/pyrrolite-canister-30-2s.json")).default
    : id === "amethyst-cuprium-solution-30-2s" ? (await import("./cases/amethyst-cuprium-solution-30-2s.json")).default
    : id === "proc-battery-3-6-2s" ? (await import("./cases/proc-battery-3-6-2s.json")).default
    : id === "bottled-food-3-6-2s" ? (await import("./cases/bottled-food-3-6-2s.json")).default
    : id === "bottled-rec-hp-3-6-2s" ? (await import("./cases/bottled-rec-hp-3-6-2s.json")).default
    : id === "bottled-food-5-6-2s" ? (await import("./cases/bottled-food-5-6-2s.json")).default
    : id === "bottled-rec-hp-5-6-2s" ? (await import("./cases/bottled-rec-hp-5-6-2s.json")).default
    : id === "xiranite-2s-first-solution" ? (await import("./cases/xiranite-2s-first-solution.json")).default : null;
  if (input === null) throw new Error(`EDA 用例缺少声明式输入：${id}`);
  if (input.formatVersion !== 1) throw new Error("EDA 用例格式无效。");
  const request = structuredClone(input.request);
  return { ...request, options: { ...request.options, randomSeed: definition.seed, initialArea: definition.initialArea,
    evaluationsPerRound: definition.roundEvaluations, concurrency: definition.concurrency, gpu: definition.gpu,
    stopAfterFirstSolution: definition.budgetMode !== "milestones", deterministicSearch: definition.deterministicSearch } } as BlueprintPlannerRequest;
}

export interface EdaRegressionCheck {
  readonly name: string;
  readonly passed: boolean;
  readonly actual: unknown;
  readonly expected: unknown;
}

/** 保留正式导出的首解，不用曲线首次观察值替代在途工作结算后的计数。 */
// AI-CORRECTION 2026-10-22：milestones 模式保存完整首阶段检查点；最早首解次数与面积另取原生 areaHistory，不能把阶段最佳蓝图称为最早首解。
export interface EdaRegressionStage {
  readonly progress: BlueprintPlannerProgress | null;
  readonly result: BlueprintPlannerResult | null;
  readonly task: BlueprintPlannerTaskFile | null;
  readonly checks: readonly EdaRegressionCheck[];
}

/** 在当前任务检查点上续算；累计上限扣除首解消耗，再按正式入口的整万单位向下取整。 */
// AI-CORRECTION 2026-10-21：Host 已接受正安全整数；精确扣除已用次数，保留不足一万的尾额。阶段无首解也可续算。
export function createEdaRegressionContinuation(test: EdaRegressionCase, first: BlueprintPlannerTaskFile): {
  readonly input: BlueprintPlannerTaskFile; readonly evaluations: number;
} {
  const continuation = test.continuation, used = first.progress.evaluatedProposals;
  if (!continuation || !Number.isSafeInteger(used) || used <= 0
    || (test.budgetMode === "milestones" ? continuation.cumulativeRoundEvaluations !== continuation.evaluationLimit
      : continuation.cumulativeRoundEvaluations >= continuation.evaluationLimit)) throw new Error("EDA 续算预算无效。");
  // AI-REMOVED 2026-10-21:
  // Reason: 向下取整丢弃剩余预算，无法完整执行累计上限。
  // Trigger: 用户要求不因首解失败或提前改善而少跑。
  // Evidence: v52 针剂少执行 8641 次。
  // Replacement: 下方精确差额与正整数校验。
  // Risk: Low。Human Review: Required
  // Original code:
  // const evaluations = Math.floor((continuation.cumulativeRoundEvaluations - used) / 10_000) * 10_000;
  // if (evaluations < 10_000) throw new Error("EDA 累计预算不足以启动续算。");
  const evaluations = continuation.cumulativeRoundEvaluations - used;
  if (!Number.isSafeInteger(evaluations) || evaluations <= 0) throw new Error("EDA 累计预算不足以启动续算。");
  const input = structuredClone(first);
  return { evaluations, input: { ...input, request: { ...input.request, options: {
    ...input.request.options, stopAfterFirstSolution: false, evaluationsPerRound: continuation.cumulativeRoundEvaluations,
  } } } };
}

/** 本地和远端共用同一验收规则；结算总数严格小于阈值，不能用首解曲线代替。 */
// AI-CORRECTION 2026-10-22：新增 milestones 模式，阶段预算必须精确结算；首解门槛使用 Host 原生发现计数，晚到首解仍判失败。旧用例保留严格上限。
export function checkEdaRegression(test: EdaRegressionCase, initial: BlueprintPlannerProgress | null,
  final: BlueprintPlannerProgress | null, result: BlueprintPlannerResult | null, seed: number | null): EdaRegressionCheck[] {
  const check = (name: string, passed: boolean, actual: unknown, expected: unknown): EdaRegressionCheck => ({ name, passed, actual, expected });
  const milestones = test.budgetMode === "milestones", first = final?.areaHistory?.[0];
  return [
    check("randomSeed", seed === test.seed, seed, test.seed),
    check("coldStart", initial !== null && initial.evaluatedProposals === 0 && initial.roundEvaluatedProposals === 0
      && initial.validatedCandidateCount === 0 && initial.bestArea === null && !initial.areaHistory?.length,
    initial && { evaluations: initial.evaluatedProposals, validated: initial.validatedCandidateCount, bestArea: initial.bestArea }, "zero evaluations and no results"),
    check("initialArea", initial?.initialArea === test.initialArea && final?.initialArea === test.initialArea,
      { initial: initial?.initialArea, final: final?.initialArea }, test.initialArea),
    check("validatedResult", result !== null && (final?.validatedCandidateCount ?? 0) > 0, final?.validatedCandidateCount ?? 0, "> 0"),
    check("firstSolution", milestones ? !!first && first.evaluatedProposals > 0 && first.evaluatedProposals <= test.evaluationLimit
      && first.bestArea > 0 && first.bestArea <= test.maximumArea
      : final?.validatedCandidateCount === 1 && final.areaHistory?.length === 1
        && final.areaHistory[0]?.bestArea === result?.metrics.area,
    final && { validated: final.validatedCandidateCount, history: final.areaHistory },
    milestones ? `first accepted solution <= ${test.evaluationLimit}` : "exactly one accepted solution"),
    check("settled", final !== null && ["waiting", "completed", "cancelled"].includes(final.status) && final.activeWorkerCount === 0,
      final && { status: final.status, activeWorkers: final.activeWorkerCount }, "settled without failure; zero active workers"),
    check("finalArea", result !== null && result.metrics.area === result.metrics.width * result.metrics.height
      && result.metrics.area > 0 && result.metrics.area <= test.maximumArea && final?.bestArea === result.metrics.area,
    result?.metrics.area ?? null, `<= ${test.maximumArea}`),
    check("totalEvaluations", final !== null && (milestones ? final.evaluatedProposals === test.roundEvaluations
      : final.evaluatedProposals > 0 && final.evaluatedProposals < test.evaluationLimit),
    final?.evaluatedProposals ?? null, milestones ? `= ${test.roundEvaluations}` : `< ${test.evaluationLimit}`),
    ...test.targets.map(target => {
      const measured = result?.measuredOutputs.find(flow => flow.itemId === target.itemId)?.perMinute;
      return check(`output:${target.itemId}`, measured !== undefined && measured >= target.perMinute - 1e-6, measured ?? null, `>= ${target.perMinute}`);
    }),
  ];
}

/** 次解复用首解的物理与产率验收，同时要求保留累计计数并严格减小面积。 */
export function checkEdaRegressionContinuation(test: EdaRegressionCase, initial: BlueprintPlannerProgress | null,
  first: Pick<EdaRegressionStage, "progress" | "result"> | null, final: BlueprintPlannerProgress | null,
  result: BlueprintPlannerResult | null, seed: number | null): EdaRegressionCheck[] {
  if (!test.continuation) return [];
  const milestones = test.budgetMode === "milestones";
  const firstArea = milestones ? final?.areaHistory?.[0]?.bestArea : first?.result?.metrics.area;
  const checks = checkEdaRegression({ ...test, maximumArea: test.continuation.maximumArea,
    evaluationLimit: test.continuation.evaluationLimit, roundEvaluations: test.continuation.cumulativeRoundEvaluations }, initial, final, result, seed)
    .filter(check => check.name !== "firstSolution").map(check => ({ ...check, name: `continuation.${check.name}` }));
  return [...checks,
    { name: "continuation.improvedArea", passed: firstArea !== undefined && !!result && result.metrics.area < firstArea,
      actual: result?.metrics.area ?? null, expected: `< ${firstArea ?? "missing first solution"}` },
    { name: "continuation.retainedEvaluations", passed: !!first?.progress && !!final
      && final.evaluatedProposals > first.progress.evaluatedProposals
      && final.roundEvaluatedProposals === final.evaluatedProposals - first.progress.evaluatedProposals,
      actual: final && { total: final.evaluatedProposals, round: final.roundEvaluatedProposals },
      expected: { previousTotal: first?.progress?.evaluatedProposals ?? null, rule: "total = previousTotal + round; round > 0" } },
    { name: "continuation.additionalValidation", passed: !!first?.progress && !!final && (milestones
      ? final.validatedCandidateCount >= 2 && !!final.areaHistory?.some(point => firstArea !== undefined && point.bestArea < firstArea
        && point.evaluatedProposals <= test.continuation!.evaluationLimit)
      : final.validatedCandidateCount > first.progress.validatedCandidateCount),
    actual: final?.validatedCandidateCount ?? null, expected: milestones ? "at least two accepted solutions; smaller area within cumulative limit"
      : `> ${first?.progress?.validatedCandidateCount ?? "missing first solution"}` },
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
  readonly firstSolution?: EdaRegressionStage | null;
  readonly continuationInput?: BlueprintPlannerTaskFile | null;
}
