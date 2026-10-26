// AI-REMOVED 2026-10-26:
// Reason: navigator 已由当前 ESLint 的 Node 全局配置声明，重复声明触发 no-redeclare。
// Trigger: 用户要求修复完整检查发现的 ESLint 错误。
// Evidence: eslint.config.mjs 对专项脚本启用 globals.node；首轮检查报告 browser-scenario.mjs:1。
// Replacement: 下方仅声明页面专属的 window。
// Risk: Low；不改变页面内的全局对象访问。
// Human Review: Required
// Original code:
// /* global window, navigator */
/* global window */

/** 在远端页面内启动一次冷任务。20M/50M 在同一 Host 实例续算，不重新导入检查点。 */
export async function browserScenario(record, measure) {
  const app = window.__edaAuditHost, host = app.workspace.blueprintPlanner;
  const clone = value => value == null ? value : JSON.parse(JSON.stringify(value));
  const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
  const state = window.__edaAudit = { done: false, phase: "starting", error: null, errorKind: null,
    pending: null, acknowledged: null, cancelled: false, stages: [], progress: null, completed: false };
  let taskId = null;
  window.__edaAuditCancel = () => { state.cancelled = true; if (taskId && host.state.activeTaskId === taskId) host.actions.cancel(taskId); };
  const compact = progress => progress && { evaluatedProposals: progress.evaluatedProposals, bestArea: progress.bestArea,
    initialArea: progress.initialArea, activeWorkerCount: progress.activeWorkerCount, status: progress.status, ...measure(progress) };
  async function publish(key) {
    const task = host.queries.exportTask(taskId), progress = host.queries.getTask(taskId), result = host.queries.getResult(taskId);
    const measured = result?.measuredOutputs.find(output => output.itemId === record.itemId)?.perMinute;
    if (result && (measured === undefined || measured < record.perMinute - 1e-6 || result.metrics.area !== result.metrics.width * result.metrics.height
      || result.metrics.width > 70 || result.metrics.height > 70)) throw new Error("Host 成果产率或几何未通过复核。");
    if (progress.activeWorkerCount !== 0 || task.checkpoint.evaluations !== progress.evaluatedProposals
      || task.checkpoint.randomSeed !== record.request.options.randomSeed) throw new Error("检查点未结算或累计计数/种子不一致。");
    state.progress = compact(progress);
    state.area = clone(window.__edaAuditArea);
    state.stages.push({ key, ...state.progress, measuredPerMinute: measured ?? null });
    window.__edaAuditPayload = task;
    state.pending = key;
    while (state.acknowledged !== key && !state.cancelled) await delay(100);
    state.pending = null;
  }
  // AI-CORRECTION 2026-10-26：清理动作独立成阶段，异常由 run 的收尾捕获并记录，不在 finally 中直接抛出。
  async function cleanup() {
    if (taskId && host.state.activeTaskId === taskId) {
      host.actions.cancel(taskId);
      const deadline = performance.now() + 120_000;
      while (host.state.activeTaskId === taskId && performance.now() < deadline) await delay(100);
    }
    if (taskId && host.state.activeTaskId === null) {
      window.__edaAuditPayload = host.queries.exportTask(taskId);
      state.progress = compact(host.queries.getTask(taskId));
    }
    if (host.state.activeTaskId !== null) throw new Error("取消未结算，禁止继续队列。");
  }
  async function run() {
    try {
      const adapter = await navigator.gpu?.requestAdapter({ powerPreference: "high-performance" });
      if (!adapter || adapter.info.isFallbackAdapter) throw new Error("有界面 Windows 硬件 WebGPU 不可用。");
      state.hardware = { browser: navigator.userAgent, logicalProcessors: navigator.hardwareConcurrency,
        gpu: { vendor: adapter.info.vendor, architecture: adapter.info.architecture, description: adapter.info.description },
        screen: { width: window.innerWidth, height: window.innerHeight, dpr: window.devicePixelRatio } };
      if (host.state.activeTaskId !== null) throw new Error("已有活动规划任务。");
      state.phase = "importing";
      const draft = host.queries.exportDraft(record.request);
      if (draft.checkpoint.evaluations !== 0 || draft.checkpoint.parallel) throw new Error("草稿检查点不是独立冷启动。");
      draft.checkpoint.randomSeed = record.request.options.randomSeed;
      taskId = await host.actions.importTask(draft);
      const initial = host.queries.getTask(taskId);
      if (initial.evaluatedProposals !== 0 || initial.bestArea !== null || initial.areaHistory.length
        || initial.validatedCandidateCount !== 0) throw new Error("冷启动任务含有历史结果。");
      app.blueprintPlannerDialog.selectTask(taskId, record.request);
      app.blueprintPlannerDialog.open();
      const started = performance.now();
      for (const limit of [20_000_000, 50_000_000]) {
        if (state.cancelled) break;
        state.phase = `search-${limit}`;
        const used = host.queries.getTask(taskId).evaluatedProposals;
        host.actions.continuePlanning(taskId, limit - used, 24, true);
        let lastCount = used, lastChange = performance.now();
        while (host.state.activeTaskId === taskId) {
          const progress = host.queries.getTask(taskId);
          state.progress = compact(progress);
          if (progress.evaluatedProposals !== lastCount) { lastCount = progress.evaluatedProposals; lastChange = performance.now(); }
          if (performance.now() - lastChange > 600_000 || performance.now() - started > 7_200_000) {
            state.error = "进度停滞十分钟或总墙钟超过两小时，实际预算保留。";
            state.errorKind = "runtime";
            host.actions.cancel(taskId);
          }
          if (state.cancelled) host.actions.cancel(taskId);
          await delay(200);
        }
        await publish(String(limit));
        const progress = host.queries.getTask(taskId);
        if (state.error || state.cancelled) break;
        if (progress.evaluatedProposals === 0 && progress.status === "failed") {
          state.error = progress.message ?? "正式 Host 预检拒绝"; state.errorKind = "request-rejected"; state.completed = true; break;
        }
        if (progress.evaluatedProposals !== limit || progress.status === "failed") throw new Error(`累计预算未完整执行：${progress.evaluatedProposals}/${limit}；${progress.message ?? ""}`);
      }
      if (!state.error && !state.cancelled) state.completed = true;
    } catch (error) {
      state.errorKind = state.phase === "importing" ? "request-rejected" : "runtime";
      state.completed = state.errorKind === "request-rejected";
      state.error = error.stack ?? String(error);
    } finally {
      try {
        await cleanup();
      } catch (error) {
        state.error = `${state.error ?? ""}; 导出或清理失败：${String(error)}`;
        state.errorKind = "runtime"; state.completed = false;
      } finally { state.phase = "done"; state.done = true; }
    }
  }
  void run();
  return { started: true, itemId: record.itemId };
}
