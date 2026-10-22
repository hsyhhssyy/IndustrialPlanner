import { makeAutoObservable, observable } from "mobx";
import type { BlueprintPlannerContract, BlueprintPlannerProgress, BlueprintPlannerResult, BlueprintPlannerTaskFile } from "@/domain/blueprint-planner";
import { checkEdaRegression, checkEdaRegressionContinuation, createEdaRegressionContinuation, loadEdaRegressionInput,
  type EdaRegressionCase, type EdaRegressionReport, type EdaRegressionStage } from "@/shared/eda-regression";

const delay = (ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms));

/** 仅显式开始时创建自己的任务；使用正式 Host，不注入 Worker 参数或替换算法。 */
export class EdaRegressionController {
  visible = false;
  running = false;
  suiteRunning = false;
  reports: readonly EdaRegressionReport[] = [];
  progress: BlueprintPlannerProgress | null = null;
  report: EdaRegressionReport | null = null;
  currentCaseId: string | null = null;
  private taskId: string | null = null;
  private cancelled = false;
  private disposed = false;

  constructor(private readonly getPlanner: () => BlueprintPlannerContract | null) {
    makeAutoObservable(this, { progress: observable.ref, report: observable.ref, reports: observable.ref }, { autoBind: true });
  }

  open(): void { this.visible = true; }
  close(): void { this.visible = false; }
  activate(): void { this.disposed = false; }
  cancel(): void {
    this.cancelled = true;
    const planner = this.getPlanner();
    if (this.taskId && planner?.state.activeTaskId === this.taskId) planner.actions.cancel(this.taskId);
  }
  dispose(): void { this.disposed = true; this.cancel(); }
  private updateProgress(value: BlueprintPlannerProgress | null): void { this.progress = value; }
  private complete(report: EdaRegressionReport): void {
    this.report = report;
    this.reports = [...this.reports.filter(previous => previous.test.id !== report.test.id), report];
    this.running = false; this.taskId = null; this.currentCaseId = null;
  }
  private ownTask(id: string | null): void { this.taskId = id; }
  private finishSuite(): void { this.suiteRunning = false; }

  async runAll(tests: readonly EdaRegressionCase[]): Promise<void> {
    if (this.running || this.suiteRunning || this.disposed) return;
    this.suiteRunning = true; this.cancelled = false;
    try {
      for (const test of tests) {
        if (this.cancelled || this.disposed) break;
        await this.run(test);
        if (this.report?.cleanupPassed === false) break;
      }
    } finally { this.finishSuite(); }
  }

  async run(test: EdaRegressionCase): Promise<void> {
    if (this.running || this.disposed) return;
    const planner = this.getPlanner();
    if (!planner || planner.state.activeTaskId !== null) return;
    this.running = true; this.cancelled = false; this.report = null; this.progress = null; this.currentCaseId = test.id;
    const startedAt = new Date().toISOString(), started = performance.now();
    let input: BlueprintPlannerTaskFile | null = null, task: BlueprintPlannerTaskFile | null = null;
    let initial: BlueprintPlannerProgress | null = null, final: BlueprintPlannerProgress | null = null;
    let result: BlueprintPlannerResult | null = null, seed: number | null = null, error: string | null = null;
    let firstSolution: EdaRegressionStage | null = null, continuationInput: BlueprintPlannerTaskFile | null = null;
    let cleanupPassed = true;
    const hardware = { userAgent: navigator.userAgent, logicalProcessors: navigator.hardwareConcurrency, hardwareGpu: false, gpuAdapter: null as string | null };
    try {
      // AI-REMOVED 2026-10-17:
      // Reason: 固定用例不能绑定算法版本及旧计算检查点。
      // Trigger: 用户要求算法升级后继续运行相同输入并检测搜索性能退化。
      // Evidence: 此版本判断在启动搜索前拒绝所有算法升级。
      // Replacement: loadEdaRegressionInput 返回固定请求，exportDraft 生成当前版本的空任务。
      // Risk: Low；固定种子和初始面积由正式 Host 参数控制。
      // Human Review: Required
      // Original code:
      // input = await loadEdaRegressionInput(test.id);
      // if (!("plan" in input.request)) throw new Error("EDA 回归输入必须是生产规划任务。");
      // const current = planner.queries.exportDraft(input.request);
      // if (current.algorithmVersion !== input.algorithmVersion) throw new Error(`用例输入版本 ${input.algorithmVersion} 与当前算法 ${current.algorithmVersion} 不一致，请重新生成零状态输入并更新用例记录。`);
      // if (input.request.options.evaluationsPerRound !== test.roundEvaluations || input.request.options.concurrency !== test.concurrency
      //   || input.request.options.gpu !== test.gpu) throw new Error("用例输入的预算、并发或 GPU 设置与验收定义不一致。");
      input = planner.queries.exportDraft(await loadEdaRegressionInput(test.id));
      const adapter = await navigator.gpu?.requestAdapter({ powerPreference: "high-performance" });
      hardware.hardwareGpu = !!adapter && !adapter.info.isFallbackAdapter;
      hardware.gpuAdapter = adapter ? `${adapter.info.vendor} ${adapter.info.architecture} ${adapter.info.description}`.trim() : null;
      if (this.cancelled || this.disposed) throw new Error("测试已取消。");
      if (planner.state.activeTaskId !== null) throw new Error("已有规划任务运行，无法启动测试。");
      this.ownTask(await planner.actions.importTask(input));
      let id = this.taskId!;
      initial = planner.queries.getTask(id); seed = planner.queries.getRandomSeed(id);
      this.updateProgress(initial);
      const preflight = checkEdaRegression(test, initial, initial, null, seed).filter(check => ["randomSeed", "coldStart", "initialArea"].includes(check.name));
      if (preflight.some(check => !check.passed)) throw new Error(`冷启动条件不符合要求：${preflight.filter(check => !check.passed).map(check => check.name).join("、")}`);
      if (this.cancelled || this.disposed) throw new Error("测试已取消。");
      if (planner.state.activeTaskId !== null) throw new Error("已有规划任务运行，无法启动测试。");
      for (let stage = 0; stage < (test.continuation ? 2 : 1); stage++) {
        let evaluations = test.roundEvaluations;
        if (stage === 1) {
          const continuation = createEdaRegressionContinuation(test, firstSolution!.task!);
          continuationInput = continuation.input; evaluations = continuation.evaluations;
          // 2026-10-21：通过正式导出/导入切换首解停止选项；检查点及累计消耗完整保留。
          // AI-CORRECTION 2026-10-22：完整预算模式从开始即关闭首解停止，直接续算同一任务，避免导入丢失内存中的未完成布局池。
          if (firstSolution!.task!.request.options.stopAfterFirstSolution !== false) {
            await planner.actions.deleteTask(id);
            this.ownTask(null);
            if (this.cancelled || this.disposed) break;
            if (planner.state.activeTaskId !== null) throw new Error("已有规划任务运行，无法启动续算。");
            this.ownTask(await planner.actions.importTask(continuationInput));
            id = this.taskId!; seed = planner.queries.getRandomSeed(id);
          }
          const resumed = planner.queries.getTask(id);
          if (resumed?.evaluatedProposals !== firstSolution!.progress?.evaluatedProposals
            || resumed?.bestArea !== firstSolution!.progress?.bestArea || seed !== test.seed) throw new Error("首解续算未保留累计计数、面积或种子。");
        }
        if (this.cancelled || this.disposed) break;
        if (performance.now() - started >= test.timeoutMs) throw new Error("测试运行超时。");
        if (planner.state.activeTaskId !== null) throw new Error("已有规划任务运行，无法启动测试。");
        planner.actions.continuePlanning(id, evaluations, test.concurrency, test.gpu);
        while (planner.state.activeTaskId === id) {
          const progress = planner.queries.getTask(id);
          this.updateProgress(progress);
          // AI-CORRECTION 2026-10-17：首解由 Host 原子停止；页面轮询只负责进度、主动取消及超时。
          // AI-CORRECTION 2026-10-22：milestones 用例两阶段都由预算结算，首次验收通过不停止。
          // 2026-10-21：次解按固定累计预算完整结算，不以页面首次观察到改善的时间取消搜索。
          if (this.cancelled || this.disposed
            || performance.now() - started >= test.timeoutMs) {
            if (performance.now() - started >= test.timeoutMs) error = "测试运行超时。";
            planner.actions.cancel(id);
            break;
          }
          await delay(100);
        }
        if (planner.state.activeTaskId === id) break;
        final = planner.queries.getTask(id); result = planner.queries.getResult(id); task = planner.queries.exportTask(id);
        if (stage === 1 && final?.evaluatedProposals !== test.continuation!.cumulativeRoundEvaluations) {
          error = `累计搜索未完整执行：${final?.evaluatedProposals ?? "未知"}/${test.continuation!.cumulativeRoundEvaluations}。`;
        }
        if (stage === 0 && test.continuation) firstSolution = { progress: final, result, task,
          checks: checkEdaRegression(test, initial, final, result, seed) };
        // AI-REMOVED 2026-10-21:
        // Reason: 首阶段未达标是验收结果，不能剥夺后续搜索预算。
        // Trigger: 用户要求 20M 无首解也继续跑满累计预算。
        // Evidence: 原分支使无首解任务不进入 continuation。
        // Replacement: 下方只因运行故障、明确取消或销毁停止；首阶段检查仍进入最终报告。
        // Risk: 失败用例的运行时间增加。Human Review: Required
        // Original code:
        // if (error || this.cancelled || this.disposed || firstSolution?.checks.some(check => !check.passed)) break;
        if (error || this.cancelled || this.disposed || final?.status === "failed") break;
      }
    } catch (failure) { error = failure instanceof Error ? failure.message : String(failure); }
    finally {
      const id = this.taskId;
      if (id) {
        try {
          if (planner.state.activeTaskId === id) planner.actions.cancel(id);
          const deadline = performance.now() + 60_000;
          while (planner.state.activeTaskId === id && performance.now() < deadline) await delay(50);
          if (planner.state.activeTaskId === id) {
            cleanupPassed = false;
            error = [error, "规划任务未完成取消结算，禁止将当前计数作为测试结果。"].filter(Boolean).join("；");
          } else {
            final = planner.queries.getTask(id); result = planner.queries.getResult(id); task = planner.queries.exportTask(id);
            this.updateProgress(final);
            await planner.actions.deleteTask(id);
          }
        } catch (failure) { cleanupPassed = false; error = [error, String(failure)].filter(Boolean).join("；"); }
      }
      const checks = [...(firstSolution?.checks ?? checkEdaRegression(test, initial, final, result, seed)),
        ...checkEdaRegressionContinuation(test, initial, firstSolution, final, result, seed)];
      this.complete({ formatVersion: 1, test, status: this.cancelled || this.disposed ? "cancelled"
        : !error && cleanupPassed && checks.every(check => check.passed) ? "passed" : "failed",
      startedAt, finishedAt: new Date().toISOString(), elapsedMs: performance.now() - started,
      appVersion: import.meta.env.VITE_APP_VERSION ?? "dev", algorithmVersion: task?.algorithmVersion ?? input?.algorithmVersion ?? null,
      hardware, initial, final, checks, error, cleanupPassed, input, task, result, firstSolution, continuationInput });
    }
  }
}
