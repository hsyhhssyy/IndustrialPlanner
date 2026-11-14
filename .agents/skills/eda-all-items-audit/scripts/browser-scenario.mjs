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
// AI-CORRECTION 2026-10-30：模式 3 在累计 50M 后每次追加 50M，始终续算同一内存任务。
// AI-CORRECTION 2026-10-30：模式 4 至少完整结算 50M，之后找到次解才停止；不足次解持续追加。
export async function browserScenario(record, measure, manualTools) {
  const app = window.__edaAuditHost, host = app.workspace.blueprintPlanner;
  let searchMode = record.searchMode ?? 2;
  let activeRecord = record, phase = record.manualOnly ? "manual-only" : "automatic", automatic = null;
  let manualInput = record.manualInput ?? null;
  const evidence = window.__edaAuditEvidence = {};
  let captures = {}, optimality = null;
  window.__edaAuditAccepted = file => {
    try {
      if (file.taskId !== taskId) return;
      const result = file.checkpoint.result;
      const kind = !captures.first ? "first" : result.metrics.area < captures.first.result.metrics.area && !captures.second ? "second" : null;
      if (kind) captures[kind] = clone({ evaluatedProposals: file.checkpoint.evaluations,
        result, best: file.checkpoint.best });
      if (kind === "first" && manualInput) {
        const lowerBound = manualTools.manualLayoutAreaLowerBound(manualInput.selection.blueprint, manualInput.footprints);
        if (result.metrics.area < lowerBound.area) throw new Error("人工首解面积小于保留设备群下界。");
        if (result.metrics.area === lowerBound.area) {
          captures.first.poses = manualTools.assertManualDevicePoses(manualInput.selection.blueprint, result.blueprint,
            manualInput.mapping, manualInput.orientation, manualInput.footprints);
          optimality = { ...lowerBound, evaluatedProposals: file.checkpoint.evaluations };
        }
      }
    } catch (error) { state.error = String(error); state.errorKind = "snapshot"; }
  };
  const clone = value => value == null ? value : JSON.parse(JSON.stringify(value));
  const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
  const state = window.__edaAudit = { done: false, phase: "starting", error: null, errorKind: null,
    pending: null, acknowledged: null, cancelled: false, stages: [], progress: null, completed: false };
  let taskId = null, improvementStopRequested = false, activeStage = null, activeRound = null;
  window.__edaAuditCancel = () => { state.cancelled = true; if (taskId && host.state.activeTaskId === taskId) host.actions.cancel(taskId); };
  const compact = progress => progress && { evaluatedProposals: progress.evaluatedProposals, bestArea: progress.bestArea,
    initialArea: progress.initialArea, activeWorkerCount: progress.activeWorkerCount, status: progress.status, ...measure(progress, searchMode) };
  async function publish(key, rounds, waitForAcknowledgement = true) {
    const task = host.queries.exportTask(taskId), progress = host.queries.getTask(taskId), result = host.queries.getResult(taskId);
    const measured = result?.measuredOutputs.find(output => output.itemId === record.itemId)?.perMinute;
    if (result && (measured === undefined || measured < record.perMinute - 1e-6 || result.metrics.area !== result.metrics.width * result.metrics.height
      || result.metrics.width > 70 || result.metrics.height > 70)) throw new Error("Host 成果产率或几何未通过复核。");
    if (progress.activeWorkerCount !== 0 || task.checkpoint.evaluations !== progress.evaluatedProposals
      || task.checkpoint.randomSeed !== activeRecord.request.options.randomSeed) throw new Error("检查点未结算或累计计数/种子不一致。");
    state.progress = compact(progress);
    state.area = clone(window.__edaAuditArea);
    state.stages.push({ key, ...state.progress, rounds, unspentEvaluations: task.checkpoint.unspentEvaluations ?? 0, measuredPerMinute: measured ?? null });
    if (manualInput) {
      for (const kind of ["first", "second"]) if (state.progress[`${kind}Attempts`] !== null && !captures[kind]) {
        throw new Error(`人工 ${kind} 解缺少正式验收时的独立快照。`);
      }
      for (const [kind, snapshot] of Object.entries(captures)) {
        snapshot.poses = manualTools.assertManualDevicePoses(manualInput.selection.blueprint, snapshot.result.blueprint,
          manualInput.mapping, manualInput.orientation, manualInput.footprints);
        if (snapshot.result.measuredOutputs.find(flow => flow.itemId === record.itemId)?.perMinute < record.perMinute - 1e-6) throw new Error("人工快照产率不足。");
        evidence[`manual-${kind}.json`] = snapshot;
      }
      evidence["manual-input.json"] = manualInput;
      evidence["manual-task.eda-task.json"] = task;
    } else for (const [kind, snapshot] of Object.entries(captures)) evidence[`automatic-${kind}.json`] = snapshot;
    window.__edaAuditPayload = automatic?.task ?? task;
    activeStage = null;
    if (!waitForAcknowledgement) return;
    state.pending = phase === "manual" ? `manual-${key}` : key;
    while (state.acknowledged !== state.pending && !state.cancelled) await delay(100);
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
      const settled = host.queries.exportTask(taskId);
      if (manualInput) evidence["manual-task.eda-task.json"] = settled;
      window.__edaAuditPayload = automatic?.task ?? settled;
      state.progress = compact(host.queries.getTask(taskId));
      // 异常收尾先等待原任务结算，再保存已发放额度和正式验收快照；仍由 completed=false 标识失败。
      if (activeStage) {
        if (activeRound) {
          activeStage.rounds.push({ ...activeRound, evaluatedProposals: settled.checkpoint.evaluations,
            unspentEvaluations: settled.checkpoint.unspentEvaluations ?? 0 });
          activeRound = null;
        }
        await publish(activeStage.key, activeStage.rounds, false);
      }
    }
    if (host.state.activeTaskId !== null) throw new Error("取消未结算，禁止继续队列。");
  }
  async function performTask() {
      measure(null, searchMode);
      const adapter = await navigator.gpu?.requestAdapter({ powerPreference: "high-performance" });
      if (!adapter || adapter.info.isFallbackAdapter) throw new Error("有界面 Windows 硬件 WebGPU 不可用。");
      state.hardware = { browser: navigator.userAgent, logicalProcessors: navigator.hardwareConcurrency,
        gpu: { vendor: adapter.info.vendor, architecture: adapter.info.architecture, description: adapter.info.description },
        screen: { width: window.innerWidth, height: window.innerHeight, dpr: window.devicePixelRatio } };
      if (record.manualFollowup || record.manualOnly) state.hardware.dimensionBackend = await window.__edaAuditCheckDimensions();
      if (host.state.activeTaskId !== null) throw new Error("已有活动规划任务。");
      state.phase = "importing";
      const draft = host.queries.exportDraft(activeRecord.request);
      if (draft.checkpoint.evaluations !== 0 || draft.checkpoint.parallel) throw new Error("草稿检查点不是独立冷启动。");
      draft.checkpoint.randomSeed = activeRecord.request.options.randomSeed;
      taskId = await host.actions.importTask(draft);
      const initial = host.queries.getTask(taskId);
      if (initial.evaluatedProposals !== 0 || initial.bestArea !== null || initial.areaHistory.length
        || initial.validatedCandidateCount !== 0) throw new Error("冷启动任务含有历史结果。");
      await app.blueprintPlannerDialog.selectTask(taskId, activeRecord.request);
      app.blueprintPlannerDialog.open();
      const started = performance.now();
      for (let limit = 20_000_000; [3, 4].includes(searchMode) || limit <= 50_000_000; limit = limit === 20_000_000 ? 50_000_000 : limit + 50_000_000) {
        if (state.cancelled) break;
        if (host.queries.getTask(taskId).evaluatedProposals >= limit) continue;
        if (!Number.isSafeInteger(limit)) throw new Error("累计预算超出安全整数范围，保留实际计数并停止。");
        state.phase = `search-${limit}`;
        const rounds = [];
        activeStage = { key: String(limit), rounds };
        do {
          const used = host.queries.getTask(taskId).evaluatedProposals;
          // AI-CORRECTION 2026-10-30：Host 自动合并上阶段保留的尾额，此处只追加尚未发放的额度，防止重复授予。
          // AI-CORRECTION 2026-11-01：用户指定额度默认是最低实际次数；尾额不足一批时补足原生批次，允许真实超额，不重开任务。
          const checkpoint = host.queries.exportTask(taskId).checkpoint;
          const retained = checkpoint.unspentEvaluations ?? 0;
          // 尚无原生批次信息时按本阶段名义额度补发，避免小尾额反复追加仍无法派发；超额仍按真实计数结算。
          const batch = checkpoint.parallel?.dimensionSchedule?.attemptsPerTask ?? (limit === 20_000_000 ? 20_000_000 : limit === 50_000_000 ? 30_000_000 : 50_000_000);
          const additional = Math.max(1, limit - used - retained, batch - retained);
          if (!Number.isSafeInteger(additional) || additional <= 0) throw new Error("新增预算无效，保留实际计数并停止。");
          host.actions.continuePlanning(taskId, additional, 24, true);
          activeRound = { before: used, retained, additional };
          let lastCount = used, lastChange = performance.now();
          while (host.state.activeTaskId === taskId) {
            const progress = host.queries.getTask(taskId);
            state.progress = compact(progress);
            // 次解一经正式验收即取消剩余额度；等待 Host 结算在途工作，不将正常提前结束标为用户取消。
            // AI-CORRECTION 2026-10-30：模式 1 保留完整预算；仅模式 2、3 在次解后取消。
            // AI-CORRECTION 2026-10-30：模式 4 的次解取消还需累计已达 50M，50M 前继续完整结算。
            // AI-CORRECTION 2026-11-14：人工首解已达固定群下界时独立以最优结束，不填写次解。
            if (([2, 3].includes(searchMode) || searchMode === 4 && progress.evaluatedProposals >= 50_000_000)
              && (state.progress.secondAttempts !== null || optimality !== null) && !improvementStopRequested) {
              improvementStopRequested = true;
              host.actions.cancel(taskId);
            }
            if (progress.evaluatedProposals !== lastCount) { lastCount = progress.evaluatedProposals; lastChange = performance.now(); }
            if (performance.now() - lastChange > 600_000 || (![3, 4].includes(searchMode) && performance.now() - started > 7_200_000)) {
              state.error = [3, 4].includes(searchMode) ? "进度停滞十分钟，实际预算保留。" : "进度停滞十分钟或总墙钟超过两小时，实际预算保留。";
              state.errorKind = "runtime";
              host.actions.cancel(taskId);
            }
            if (state.cancelled || state.error) host.actions.cancel(taskId);
            await delay(200);
          }
          const settled = host.queries.exportTask(taskId), progress = host.queries.getTask(taskId);
          const unspent = settled.checkpoint.unspentEvaluations ?? 0;
          const issued = used + retained + additional;
          rounds.push({ before: used, retained, additional, evaluatedProposals: progress.evaluatedProposals, unspentEvaluations: unspent });
          activeRound = null;
          if (!Number.isSafeInteger(issued) || !Number.isSafeInteger(unspent) || unspent < 0
            || progress.evaluatedProposals < used || progress.evaluatedProposals + unspent > issued) throw new Error("实际次数或保留尾额与发放预算不一致。");
          const improved = measure(progress, searchMode).secondAttempts !== null;
          const early = (improved || optimality !== null) && ([2, 3].includes(searchMode) || searchMode === 4 && progress.evaluatedProposals >= 50_000_000);
          if (state.error || state.cancelled || progress.status === "failed" || early || improvementStopRequested || progress.evaluatedProposals >= limit) break;
          if (progress.evaluatedProposals + unspent !== issued
            || rounds.length > 1 && progress.evaluatedProposals === used) throw new Error("最低额度未达到且任务没有正常结算，保留现场。");
        } while (!state.cancelled && !state.error);
        await publish(String(limit), rounds);
        const progress = host.queries.getTask(taskId);
        if (state.error || state.cancelled) break;
        if (progress.evaluatedProposals === 0 && progress.status === "failed") {
          state.error = progress.message ?? "正式 Host 预检拒绝"; state.errorKind = "request-rejected"; state.completed = true; break;
        }
        const improved = measure(progress, searchMode).secondAttempts !== null;
        const unspent = state.stages.at(-1).unspentEvaluations, accounted = progress.evaluatedProposals + unspent;
        // 保留尾额不是已执行次数；中间阶段按已执行加保留额度守恒，模式 4 的最低 50M 仍只检查真实已执行次数。
        // AI-CORRECTION 2026-11-01：所有阶段默认至少达到门槛，超额按真实次数保存；额度守恒改与实际发放记录核对。
        // AI-REMOVED 2026-11-01:
        // Reason: 精确门槛和上限断言误拒绝正常批次尾额与超额结算。
        // Trigger: 用户要求后续所有额度默认是最低计算量，允许超出。
        // Evidence: 灼铜块已算 99,974,000 次并保留 26,000 尾额，测试脚本因此误报失败。
        // Replacement: 上方同一 Host 补足批次循环及下方最低次数、实际发放预算校验。
        // Risk: 真实计算可能超过门槛；保留真实计数与原生尾额。
        // Human Review: Required
        // Original code:
        // if (progress.status === "failed" || !Number.isSafeInteger(unspent) || unspent < 0 || accounted > limit
        //   || ((searchMode === 1 || !improved || searchMode === 4 && progress.evaluatedProposals < 50_000_000) && accounted !== limit)
        //   || searchMode === 1 && limit === 50_000_000 && progress.evaluatedProposals !== limit) {
        const last = rounds.at(-1), issued = last.before + last.retained + last.additional;
        const early = [2, 3].includes(searchMode) && (improved || optimality !== null)
          || searchMode === 4 && improved && progress.evaluatedProposals >= 50_000_000;
        if (progress.status === "failed" || accounted > issued || !early && (progress.evaluatedProposals < limit || accounted !== issued)) {
          throw new Error(`累计预算未完整执行：${progress.evaluatedProposals}/${limit}；${progress.message ?? ""}`);
        }
        if (([2, 3].includes(searchMode) || searchMode === 4 && progress.evaluatedProposals >= 50_000_000) && (improved || optimality !== null)) break;
      }
      if (!state.error && !state.cancelled) state.completed = true;
  }
  async function run() {
    try {
      await performTask();
      if (record.manualFollowup && typeof state.progress?.secondAttempts === "number" && !captures.second) throw new Error("自动次解缺少正式验收快照。");
      if (record.manualFollowup && !state.error && !state.cancelled && captures.second) {
        await cleanup();
        automatic = { task: host.queries.exportTask(taskId), progress: clone(state.progress), stages: clone(state.stages), area: clone(state.area) };
        const registry = app.workspace.registry;
        const selection = manualTools.selectManualDevices(captures.second.result.blueprint,
          registry.entityDefinitions.filter(definition => registry.queries.isGeneralLogisticsDevice(definition.id)).map(definition => definition.id),
          record.deletionSeed);
        manualInput = await manualTools.prepareManualFollowup(host, registry, record.request, captures.second.best.candidate, selection, record.manualOrientation);
        activeRecord = { ...record, request: manualInput.request }; phase = "manual"; searchMode = 2;
        evidence["manual-input.json"] = manualInput;
        state.stages = []; state.progress = null; state.completed = false; state.acknowledged = null;
        captures = {}; taskId = null; improvementStopRequested = false; optimality = null;
        await performTask();
      }
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
      } finally {
        if (manualInput) {
          state.manual = { evaluatedProposals: 0, ...measure(null, 2), ...state.progress,
            completed: state.completed, error: state.error, errorKind: state.errorKind, stages: clone(state.stages), area: clone(state.area),
            orientation: manualInput.orientation, retainedCount: manualInput.selection.blueprint.entityOrder.length,
            firstPosePassed: captures.first?.poses?.passed ?? false, secondPosePassed: captures.second?.poses?.passed ?? false,
            optimality: clone(optimality), optimalPassed: state.completed && optimality !== null
              && state.progress?.firstPassed === true && captures.first?.poses?.passed === true };
        }
        if (automatic) {
          if (state.errorKind === "request-rejected") state.errorKind = "manual-request-rejected";
          state.progress = automatic.progress; state.stages = automatic.stages; state.area = automatic.area;
        }
        window.__edaAuditAccepted = undefined;
        state.phase = "done"; state.done = true;
      }
    }
  }
  void run();
  return { started: true, itemId: record.itemId };
}
