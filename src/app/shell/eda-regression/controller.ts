import { makeAutoObservable, observable } from "mobx";
import type { BlueprintPlannerContract, BlueprintPlannerProgress, BlueprintPlannerResult, BlueprintPlannerTaskFile } from "@/domain/blueprint-planner";
import { checkEdaRegression, loadEdaRegressionInput, type EdaRegressionCase, type EdaRegressionReport } from "@/shared/eda-regression";

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
  private ownTask(id: string): void { this.taskId = id; }
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
    let cleanupPassed = true;
    const hardware = { userAgent: navigator.userAgent, logicalProcessors: navigator.hardwareConcurrency, hardwareGpu: false, gpuAdapter: null as string | null };
    try {
      input = await loadEdaRegressionInput(test.id);
      if (!("plan" in input.request)) throw new Error("EDA 回归输入必须是生产规划任务。");
      const current = planner.queries.exportDraft(input.request);
      if (current.algorithmVersion !== input.algorithmVersion) throw new Error(`用例输入版本 ${input.algorithmVersion} 与当前算法 ${current.algorithmVersion} 不一致，请重新生成零状态输入并更新用例记录。`);
      if (input.request.options.evaluationsPerRound !== test.roundEvaluations || input.request.options.concurrency !== test.concurrency
        || input.request.options.gpu !== test.gpu) throw new Error("用例输入的预算、并发或 GPU 设置与验收定义不一致。");
      const adapter = await navigator.gpu?.requestAdapter({ powerPreference: "high-performance" });
      hardware.hardwareGpu = !!adapter && !adapter.info.isFallbackAdapter;
      hardware.gpuAdapter = adapter ? `${adapter.info.vendor} ${adapter.info.architecture} ${adapter.info.description}`.trim() : null;
      if (this.cancelled || this.disposed) throw new Error("测试已取消。");
      if (planner.state.activeTaskId !== null) throw new Error("已有规划任务运行，无法启动测试。");
      this.ownTask(await planner.actions.importTask(input));
      const id = this.taskId!;
      initial = planner.queries.getTask(id); seed = planner.queries.getRandomSeed(id);
      this.updateProgress(initial);
      const preflight = checkEdaRegression(test, initial, initial, null, seed).filter(check => ["randomSeed", "coldStart", "initialArea"].includes(check.name));
      if (preflight.some(check => !check.passed)) throw new Error(`冷启动条件不符合要求：${preflight.filter(check => !check.passed).map(check => check.name).join("、")}`);
      if (this.cancelled || this.disposed) throw new Error("测试已取消。");
      if (planner.state.activeTaskId !== null) throw new Error("已有规划任务运行，无法启动测试。");
      planner.actions.continuePlanning(id, test.roundEvaluations, test.concurrency, test.gpu);
      while (planner.state.activeTaskId === id) {
        const progress = planner.queries.getTask(id);
        this.updateProgress(progress);
        if (progress?.bestArea !== null && progress?.bestArea !== undefined || this.cancelled || this.disposed
          || performance.now() - started >= test.timeoutMs) {
          if (performance.now() - started >= test.timeoutMs) error = "测试运行超时。";
          planner.actions.cancel(id);
          break;
        }
        await delay(100);
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
      const checks = checkEdaRegression(test, initial, final, result, seed);
      this.complete({ formatVersion: 1, test, status: this.cancelled || this.disposed ? "cancelled"
        : !error && cleanupPassed && checks.every(check => check.passed) ? "passed" : "failed",
      startedAt, finishedAt: new Date().toISOString(), elapsedMs: performance.now() - started,
      appVersion: import.meta.env.VITE_APP_VERSION ?? "dev", algorithmVersion: task?.algorithmVersion ?? input?.algorithmVersion ?? null,
      hardware, initial, final, checks, error, cleanupPassed, input, task, result });
    }
  }
}
