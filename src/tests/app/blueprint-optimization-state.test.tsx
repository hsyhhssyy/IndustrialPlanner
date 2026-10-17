import { renderToStaticMarkup } from "react-dom/server";
import { act } from "react";
import { toJS } from "mobx";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { createAppHost } from "@/app/host/app-host";
import { BlueprintPlannerDialog } from "@/app/shell/blueprint-planner-dialog";
import { createBlueprintPlannerHost } from "@/blueprint-planner/blueprint-planner-host";
import { parsePlannerTaskFile } from "@/blueprint-planner/task-checkpoint";
import { isBlueprintRecognitionRequest } from "@/shared/planner-task";
import { PlannerBatchSession } from "@/scripts/eda/planner-runner";
import { listBlueprintDirectory, readBlueprintRecord, saveBlueprintDocument } from "@/shared/storage/blueprint-storage";
import { loadBlueprintFromFile } from "../simulation/blueprint-test-helpers";
import { createFakeIndexedDbFactory } from "../shared/fake-indexed-db";
import { buttonWithText, changeTestValue, clickTestElement, mountTestComponent, selectWithLabel, settleTestDom } from "../helpers/react-test-dom";
import plant from "../blueprint-planner/fixtures/plant-preload.json" with { type: "json" };

beforeEach(() => {
  vi.stubGlobal("indexedDB", createFakeIndexedDbFactory());
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  // 2026-10-13：只验证普通 DOM 与真实任务状态，Canvas 尺寸和排版由浏览器验证。
  vi.stubGlobal("ResizeObserver", class { observe() {} unobserve() {} disconnect() {} });
});
afterEach(() => { localStorage.clear(); vi.unstubAllGlobals(); });

it("暂停立即提示通知 Worker，等待最终保存期间保持锁定，重开与续算不残留提示", async () => {
  const session = new PlannerBatchSession();
  const app = createAppHost(session.workspace);
  let releaseSave = () => {};
  const saveGate = new Promise<void>(resolve => { releaseSave = resolve; });
  let holdSave = false, waitingForSave = false, workerStarted = false;
  const planner = createBlueprintPlannerHost(session.workspace, {
    storage: { load: async () => [], delete: async () => {}, save: async file => {
      if (holdSave && file.progress.status !== "running") { waitingForSave = true; await saveGate; }
    } },
    worker: {
      build: (...args) => {
        workerStarted = true;
        return session.planner.build(args[0], args[1], args[2], { maxEvaluations: args[3] }, args[5], args[4]);
      },
      dispose: () => {},
    },
  });
  const controller = app.blueprintPlannerDialog;
  let view: Awaited<ReturnType<typeof mountTestComponent>> | null = null;
  try {
    await planner.whenSettled();
    const request = { ...plant.request, options: { ...toJS(controller.options), evaluationsPerRound: 100_000_000, concurrency: 1, gpu: false } };
    const id = await planner.actions.importTask(planner.queries.exportDraft(request));
    controller.selectTask(id, planner.queries.getLastRequest(id) ?? undefined);
    controller.open();
    view = await mountTestComponent(<BlueprintPlannerDialog appHost={app} />);
    await clickTestElement(buttonWithText(view.container, "开始规划"));
    // Worker 的异步进度会触发 React 更新；等待真实运行状态并在 act 内完成 DOM 提交。
    await act(async () => {
      await vi.waitFor(() => {
        const progress = planner.queries.getTask(id);
        expect(progress?.status, progress?.message ?? undefined).toBe("running");
        expect(workerStarted).toBe(true);
      });
    });
    holdSave = true;
    await clickTestElement(buttonWithText(view.container, "暂停计算"));
    expect(buttonWithText(view.container, "正在暂停").disabled).toBe(true);
    expect(view.container.textContent).toContain("正在通知各个Worker");
    await vi.waitFor(() => expect(waitingForSave).toBe(true));
    await settleTestDom();
    expect(session.planner.threadId).not.toBeNull();
    expect(planner.queries.getTask(id)?.status).not.toBe("running");
    expect(planner.state.activeTaskId).toBe(id);
    expect(buttonWithText(view.container, "正在暂停").disabled).toBe(true);
    expect(buttonWithText(view.container, "导入任务").disabled).toBe(true);
    await clickTestElement(buttonWithText(view.container, "关闭"));
    await act(async () => { controller.open(); });
    expect(buttonWithText(view.container, "正在暂停").disabled).toBe(true);
    expect(view.container.textContent).toContain("正在通知各个Worker");
    await act(async () => { releaseSave(); await planner.whenSettled(); });
    expect(view.container.textContent).not.toContain("正在通知各个Worker");
    expect(view.container.textContent).not.toContain("正在暂停");
    expect(buttonWithText(view.container, "继续规划").disabled).toBe(false);
    expect(buttonWithText(view.container, "导入任务").disabled).toBe(false);
    await clickTestElement(buttonWithText(view.container, "继续规划"));
    expect(buttonWithText(view.container, "暂停计算").disabled).toBe(false);
    await clickTestElement(buttonWithText(view.container, "暂停计算"));
    await clickTestElement(buttonWithText(view.container, "关闭"));
    await act(async () => { await planner.whenSettled(); controller.open(); });
    await clickTestElement(buttonWithText(view.container, "继续规划"));
    expect(buttonWithText(view.container, "暂停计算").disabled).toBe(false);
    expect(view.container.textContent).not.toContain("正在通知各个Worker");
    await clickTestElement(buttonWithText(view.container, "暂停计算"));
    await act(async () => { await planner.whenSettled(); });
  } finally {
    releaseSave();
    await view?.unmount(); planner.dispose(); app.dispose(); await session.dispose();
  }
}, 30_000);

it("未知输入表单仅编辑未识别边界，非法供料禁用识别，导入后恢复配置", async () => {
  const session = new PlannerBatchSession();
  const app = createAppHost(session.workspace);
  const planner = createBlueprintPlannerHost(session.workspace);
  const controller = app.blueprintPlannerDialog;
  controller.setBlueprintPlanningEnabled(true);
  let view: Awaited<ReturnType<typeof mountTestComponent>> | null = null;
  try {
    controller.openBlueprint(loadBlueprintFromFile("src/tests/fixtures/blueprints/blueprint-planner/blueprint-optimization/unknown-entry.schema7.json"));
    await vi.waitFor(() => { expect(controller.viewTaskId).not.toBeNull(); expect(planner.state.activeTaskId).toBeNull(); });
    view = await mountTestComponent(<BlueprintPlannerDialog appHost={app} />);
    const inputs = () => [...view!.container.querySelectorAll<HTMLSelectElement>('[class*="boundaryGroup"] select')];
    expect(inputs()).toHaveLength(1);
    await changeTestValue(inputs()[0]!, "item_iron_ore");
    const id = controller.viewTaskId!;
    await vi.waitFor(() => {
      const request = planner.queries.getLastRequest(id)!;
      expect(isBlueprintRecognitionRequest(request) && request.input.boundaries.some(boundary =>
        boundary.direction === "input" && boundary.itemId === "item_iron_ore")).toBe(true);
    });
    const rule = selectWithLabel(view.container, "取货口摆放规则");
    await changeTestValue(rule, "full-side");
    await vi.waitFor(() => expect(rule.disabled).toBe(false));
    expect(selectWithLabel(view.container, "存取线形态").disabled).toBe(true);
    expect(view.container.querySelectorAll('[aria-invalid="true"]')).toHaveLength(1);
    expect(buttonWithText(view.container, "识别蓝图").disabled).toBe(true);
    const file = planner.queries.exportTask(id);
    await view.unmount(); view = null;
    const imported = await planner.actions.importTask(file);
    controller.selectTask(imported, planner.queries.getLastRequest(imported) ?? undefined);
    view = await mountTestComponent(<BlueprintPlannerDialog appHost={app} />);
    expect(inputs()[0]!.value).toBe("item_iron_ore");
    expect(selectWithLabel(view.container, "取货口摆放规则").value).toBe("full-side");
    expect(buttonWithText(view.container, "识别蓝图").disabled).toBe(true);
    await changeTestValue(selectWithLabel(view.container, "取货口摆放规则"), "continuous");
    await vi.waitFor(() => expect(buttonWithText(view!.container, "识别蓝图").disabled).toBe(false));
    expect(selectWithLabel(view.container, "存取线形态").disabled).toBe(false);
    expect(planner.queries.exportTask(id)).toEqual(file);
  } finally { await view?.unmount(); planner.dispose(); app.dispose(); await session.dispose(); }
});

it("原图识别成为只读基线，保存副本不覆盖原图，重建主机恢复基线和边界", async () => {
  const session = new PlannerBatchSession();
  let app = createAppHost(session.workspace);
  app.blueprintPlannerDialog.setBlueprintPlanningEnabled(true);
  let planner = createBlueprintPlannerHost(session.workspace);
  const blueprint = loadBlueprintFromFile("src/tests/fixtures/blueprints/blueprint-planner/blueprint-optimization/plant-cycle.schema7.json");
  const readonlyBoundary = (planningStarted = false) => {
    // 仅检查实际组件输出；不执行 Canvas effects，几何与定位由识别预览 E2E 验证。
    const container = document.createElement("div");
    container.innerHTML = renderToStaticMarkup(<BlueprintPlannerDialog appHost={app} />);
    expect(container.querySelectorAll('[class*="boundaryGroup"] select')).toHaveLength(0);
    const options = [...container.querySelectorAll<HTMLSelectElement>('select')];
    expect(options).toHaveLength(2);
    expect(options.every(option => option.disabled === planningStarted)).toBe(true);
    // AI-REMOVED 2026-10-13:
    // Reason: CPU/GPU 也采用 switch，权限断言必须限定优化分组。
    // Trigger: 用户批准 EDA 选项分组与计算开关统一。
    // Evidence: 页面增加两个计算 switch，其锁定语义与优化权限不同。
    // Replacement: 下方按优化分组选择；Risk: Low；Human Review: Required
    // Original code:
    // const switches = [...container.querySelectorAll<HTMLInputElement>('input[role="switch"]')];
    const switches = [...container.querySelectorAll<HTMLInputElement>('[aria-labelledby="eda-optimization-options-title"] input[role="switch"]')];
    expect(switches).toHaveLength(4);
    expect(switches.every(input => input.disabled === planningStarted && !input.checked)).toBe(true);
    expect(container.querySelectorAll('[role="dialog"]')).toHaveLength(1);
    expect([...container.querySelectorAll('button')].some(button => button.textContent === (planningStarted ? "继续规划" : "开始规划"))).toBe(true);
    return [...container.querySelectorAll('[class*="boundaryRow"]')].map(row => row.textContent);
  };
  try {
    const original = await saveBlueprintDocument(blueprint, { parentFolderId: null });
    expect(original).not.toBeNull();
    app.blueprintPlannerDialog.openBlueprint(blueprint);
    await vi.waitFor(() => { expect(app.blueprintPlannerDialog.viewTaskId).not.toBeNull(); expect(planner.state.activeTaskId).toBeNull(); });
    const id = app.blueprintPlannerDialog.viewTaskId!;
    await planner.actions.updateBlueprintOptions(id, { ...toJS(app.blueprintPlannerDialog.options), warehousePortPlacement: "any" });
    await planner.actions.identifyBlueprint(id);
    app.blueprintPlannerDialog.selectTask(id, planner.queries.getLastRequest(id) ?? undefined);
    const result = planner.queries.getResult(id)!;
    expect(result.metrics.area).toBe(150);
    expect(planner.queries.getTask(id)?.initialArea).toBe(150);
    expect(result.measuredOutputs).toEqual([{ itemId: "item_plant_moss_3", perMinute: 30 }]);
    expect(result.blueprint.entities).toEqual(blueprint.entities);
    const originalReport = parsePlannerTaskFile(planner.queries.exportTask(id), session.workspace.registry).checkpoint.blueprintBaseline!.report;
    expect(parsePlannerTaskFile(planner.queries.exportTask(id), session.workspace.registry).checkpoint.blueprintBaseline?.report.engineKind).toBe("dense-v2");
    const rows = readonlyBoundary();
    expect(rows.length).toBeGreaterThan(0);
    await planner.actions.save(id);
    const source = await readBlueprintRecord(blueprint.blueprintId);
    expect(source).toEqual(original);
    const folder = (await listBlueprintDirectory()).folders.find(entry => entry.name === "自动规划")!;
    const copies = (await listBlueprintDirectory(folder.folderId)).blueprints;
    expect(copies).toHaveLength(1);
    expect(copies[0]!.blueprintId).not.toBe(source!.blueprintId);
    await planner.whenSettled();
    planner.dispose(); app.dispose();
    app = createAppHost(session.workspace);
    app.blueprintPlannerDialog.setBlueprintPlanningEnabled(true);
    planner = createBlueprintPlannerHost(session.workspace);
    await planner.whenSettled();
    const restored = planner.queries.getResult(id)!;
    expect(restored.metrics.area).toBe(150);
    expect(restored.measuredOutputs).toEqual(result.measuredOutputs);
    app.blueprintPlannerDialog.selectTask(id, planner.queries.getLastRequest(id) ?? undefined);
    app.blueprintPlannerDialog.open();
    expect(readonlyBoundary()).toEqual(rows);
    const restoredRequest = planner.queries.getLastRequest(id)!;
    await planner.actions.updateBlueprintOptions(id, { ...restoredRequest.options, warehouseBus: "corner" });
    app.blueprintPlannerDialog.selectTask(id, planner.queries.getLastRequest(id) ?? undefined);
    expect(readonlyBoundary()).toEqual(rows);
    const changed = parsePlannerTaskFile(planner.queries.exportTask(id), session.workspace.registry);
    expect(changed.request.options.warehouseBus).toBe("corner");
    expect(changed.checkpoint.blueprintBaseline!.report).toEqual(originalReport);
    planner.actions.continuePlanning(id, 10_000, 1, false);
    planner.actions.cancel(id);
    await planner.whenSettled();
    expect(planner.queries.getTask(id)).toMatchObject({ planningStarted: true, evaluatedProposals: 0 });
    app.blueprintPlannerDialog.selectTask(id, planner.queries.getLastRequest(id) ?? undefined);
    expect(readonlyBoundary(true)).toEqual(rows);
    await expect(planner.actions.updateBlueprintOptions(id, { ...changed.request.options, warehouseBus: "straight" })).rejects.toThrow("首次开始规划");
    await planner.whenSettled();
    planner.dispose(); app.dispose();
    app = createAppHost(session.workspace);
    app.blueprintPlannerDialog.setBlueprintPlanningEnabled(true);
    planner = createBlueprintPlannerHost(session.workspace);
    await planner.whenSettled();
    app.blueprintPlannerDialog.selectTask(id, planner.queries.getLastRequest(id) ?? undefined);
    app.blueprintPlannerDialog.open();
    expect(readonlyBoundary(true)).toEqual(rows);
    const imported = await planner.actions.importTask(planner.queries.exportTask(id));
    app.blueprintPlannerDialog.selectTask(imported, planner.queries.getLastRequest(imported) ?? undefined);
    expect(readonlyBoundary(true)).toEqual(rows);
    // 2026-10-15：合并原 EDA workflow E2E 的导入、历史和蓝图库隔离断言，复用本例真实识别结果。
    const importedResult = planner.queries.getResult(imported)!;
    expect(importedResult.folderId).toBeNull();
    expect(importedResult.blueprint.blueprintId).not.toBe(result.blueprint.blueprintId);
    expect(planner.queries.getTask(imported)?.areaHistory).toEqual(planner.queries.getTask(id)?.areaHistory);
    const view = await mountTestComponent(<BlueprintPlannerDialog appHost={app} />);
    try {
      await clickTestElement(buttonWithText(view.container, "预览蓝图"));
      expect(app.blueprintPreview.dialogState.visible).toBe(true);
      expect(app.blueprintPlannerDialog.dialogState.visible).toBe(true);
      app.blueprintPreview.close();
      expect(app.blueprintPlannerDialog.dialogState.visible).toBe(true);
    } finally { await view.unmount(); }
    await planner.actions.deleteTask(imported);
    expect(planner.queries.getTask(id)).not.toBeNull();
    await planner.actions.deleteTask(id);
    expect((await listBlueprintDirectory(folder.folderId)).blueprints).toEqual(copies);
    expect(await readBlueprintRecord(blueprint.blueprintId)).toEqual(original);
  } finally { planner.dispose(); app.dispose(); await session.dispose(); }
}, 60_000);

// 2026-10-16：用户将初始面积统一改为三倍；本例 88 格设备的参考点由 176 改为 264。
// AI-CORRECTION 2026-10-16：后续首解调优授权将共用线性起点改为五倍；本例参考点为 440，合规原图仍为 150。
// AI-CORRECTION 2026-10-17：用户要求恢复两倍；88 格设备的参考点改为 176，合规原图仍为 150。
it("不合规原图以两倍设备占地显示参考曲线，恢复后保持起点，合规原图仍显示已验证点", async () => {
  const session = new PlannerBatchSession();
  const app = createAppHost(session.workspace);
  let planner = createBlueprintPlannerHost(session.workspace);
  const controller = app.blueprintPlannerDialog;
  controller.setBlueprintPlanningEnabled(true);
  const blueprint = loadBlueprintFromFile("src/tests/fixtures/blueprints/blueprint-planner/blueprint-optimization/plant-cycle.schema7.json");
  const markup = () => {
    const container = document.createElement("div");
    container.innerHTML = renderToStaticMarkup(<BlueprintPlannerDialog appHost={app} />);
    return container;
  };
  try {
    controller.openBlueprint(blueprint);
    await vi.waitFor(() => { expect(controller.viewTaskId).not.toBeNull(); expect(planner.state.activeTaskId).toBeNull(); });
    const id = controller.viewTaskId!;
    await planner.actions.updateBlueprintOptions(id, { ...toJS(controller.options), warehousePortPlacement: "full-side" });
    await planner.actions.identifyBlueprint(id);
    controller.selectTask(id, planner.queries.getLastRequest(id) ?? undefined);
    expect(planner.queries.getTask(id)).toMatchObject({ initialArea: 176, bestArea: null, areaHistory: [] });
    expect(planner.queries.getResult(id)).toBeNull();
    const reference = markup();
    expect(reference.querySelector('svg[role="img"]')?.getAttribute('aria-label')).toContain("176 · 初始搜索基准");
    expect(reference.querySelectorAll('[class*="areaReferencePoint"]')).toHaveLength(1);
    expect(reference.querySelectorAll('circle[class*="areaPoint"]')).toHaveLength(0);
    expect(reference.textContent).toContain("初始搜索基准 176");
    const original = planner.queries.exportTask(id);
    expect(parsePlannerTaskFile(original, session.workspace.registry).checkpoint.blueprintBaseline!.candidate.metrics.area).toBe(150);
    await planner.whenSettled();
    planner.dispose();
    planner = createBlueprintPlannerHost(session.workspace);
    await planner.whenSettled();
    expect(planner.queries.getTask(id)?.initialArea).toBe(176);
    const imported = await planner.actions.importTask(original);
    controller.selectTask(imported, planner.queries.getLastRequest(imported) ?? undefined);
    expect(markup().querySelectorAll('[class*="areaReferencePoint"]')).toHaveLength(1);
    await planner.actions.updateBlueprintOptions(imported, { ...toJS(controller.options), warehousePortPlacement: "any" });
    controller.selectTask(imported, planner.queries.getLastRequest(imported) ?? undefined);
    expect(planner.queries.getTask(imported)).toMatchObject({ initialArea: 150, bestArea: 150,
      areaHistory: [{ evaluatedProposals: 0, bestArea: 150 }] });
    const verified = markup();
    expect(verified.querySelectorAll('[class*="areaReferencePoint"]')).toHaveLength(0);
    expect(verified.querySelectorAll('circle[class*="areaPoint"]')).toHaveLength(1);
  } finally { planner.dispose(); app.dispose(); await session.dispose(); }
}, 60_000);

it("四项权限与摆放规则常驻同一区域，保存选择后直接开始并随任务锁定", async () => {
  const session = new PlannerBatchSession();
  const app = createAppHost(session.workspace);
  const planner = createBlueprintPlannerHost(session.workspace);
  const controller = app.blueprintPlannerDialog;
  controller.setBlueprintPlanningEnabled(true);
  const blueprint = loadBlueprintFromFile("src/tests/fixtures/blueprints/blueprint-planner/blueprint-optimization/plant-cycle.schema7.json");
  let view: Awaited<ReturnType<typeof mountTestComponent>> | null = null;
  try {
    controller.openBlueprint(blueprint);
    await vi.waitFor(() => { expect(controller.viewTaskId).not.toBeNull(); expect(planner.state.activeTaskId).toBeNull(); });
    const id = controller.viewTaskId!;
    view = await mountTestComponent(<BlueprintPlannerDialog appHost={app} />);
    // AI-REMOVED 2026-10-13:
    // Reason: 页面新增 CPU/GPU switch，四项权限需按优化分组定位。
    // Trigger: 用户批准 EDA 选项分组；Evidence: 计算配置暂停后可调整。
    // Replacement: 下方优化分组选择；Risk: Low；Human Review: Required
    // Original code:
    // const switches = () => [...view!.container.querySelectorAll<HTMLInputElement>('input[role="switch"]')];
    const switches = () => [...view!.container.querySelectorAll<HTMLInputElement>('[aria-labelledby="eda-optimization-options-title"] input[role="switch"]')];
    const group = view.container.querySelector('[class*="blueprintPlacement"]')!;
    expect(group.querySelectorAll('select')).toHaveLength(2);
    expect(group.querySelectorAll('input[role="switch"]')).toHaveLength(4);
    expect(switches().every(input => !input.checked && !input.disabled)).toBe(true);
    await changeTestValue(selectWithLabel(view.container, "取货口摆放规则"), "any");
    await vi.waitFor(() => expect(selectWithLabel(view!.container, "取货口摆放规则").disabled).toBe(false));
    await clickTestElement(switches()[0]!);
    await vi.waitFor(() => {
      expect(planner.queries.getLastRequest(id)?.options.blueprintOptimizations?.reassignPorts).toBe(true);
      expect(switches()[0]!.disabled).toBe(false);
    });
    controller.selectTask(id, planner.queries.getLastRequest(id) ?? undefined);
    await planner.actions.identifyBlueprint(id);
    controller.selectTask(id, planner.queries.getLastRequest(id) ?? undefined);
    controller.updateOptions({ evaluationsPerRound: 10_000, concurrency: 1, gpu: false });
    await settleTestDom();
    expect(switches()[0]!.checked).toBe(true);
    expect(view.container.querySelectorAll('[role="dialog"]')).toHaveLength(1);
    await clickTestElement(buttonWithText(view.container, "开始规划"));
    await vi.waitFor(() => expect(planner.queries.getTask(id)?.planningStarted).toBe(true));
    expect(view.container.querySelectorAll('[role="dialog"]')).toHaveLength(1);
    planner.actions.cancel(id);
    await planner.whenSettled();
    await settleTestDom();
    expect(switches().every(input => input.disabled)).toBe(true);
    const computation = [...view.container.querySelectorAll('fieldset')].find(group => group.querySelector('legend')?.textContent === "计算设置")!;
    expect(computation.querySelectorAll('input[role="switch"]')).toHaveLength(2);
    expect([...computation.querySelectorAll<HTMLInputElement>('input')].every(input => !input.disabled)).toBe(true);
    expect(switches()[0]!.checked).toBe(true);
    expect(buttonWithText(view.container, "继续规划")).toBeDefined();
    const saved = planner.queries.exportTask(id);
    expect(saved.request.options.blueprintOptimizations).toEqual({
      reassignPorts: true, reassignConnections: false, rebuildLogistics: false, mergeBoundaryFacilities: false,
    });
    expect(saved.progress.planningStarted).toBe(true);
    expect(saved.request.options.evaluationsPerRound).toBe(10_000);
  } finally { await view?.unmount(); planner.dispose(); app.dispose(); await session.dispose(); }
}, 60_000);
