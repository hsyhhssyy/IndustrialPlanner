import { renderToStaticMarkup } from "react-dom/server";
import { toJS } from "mobx";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { createAppHost } from "@/app/host/app-host";
import { BlueprintPlannerDialog } from "@/app/shell/blueprint-planner-dialog";
import { createBlueprintPlannerHost } from "@/blueprint-planner/blueprint-planner-host";
import { parsePlannerTaskFile } from "@/blueprint-planner/task-checkpoint";
import { PlannerBatchSession } from "@/scripts/eda/planner-runner";
import { listBlueprintDirectory, readBlueprintRecord, saveBlueprintDocument } from "@/shared/storage/blueprint-storage";
import { loadBlueprintFromFile } from "../simulation/blueprint-test-helpers";
import { createFakeIndexedDbFactory } from "../shared/fake-indexed-db";
import { buttonWithText, changeTestValue, clickTestElement, mountTestComponent, selectWithLabel, settleTestDom } from "../helpers/react-test-dom";

beforeEach(() => {
  vi.stubGlobal("indexedDB", createFakeIndexedDbFactory());
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  // 2026-10-13：只验证普通 DOM 与真实任务状态，Canvas 尺寸和排版由浏览器验证。
  vi.stubGlobal("ResizeObserver", class { observe() {} unobserve() {} disconnect() {} });
});
afterEach(() => { localStorage.clear(); vi.unstubAllGlobals(); });

it("原图识别成为只读基线，保存副本不覆盖原图，重建主机恢复基线和边界", async () => {
  const session = new PlannerBatchSession();
  let app = createAppHost(session.workspace);
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
    planner = createBlueprintPlannerHost(session.workspace);
    await planner.whenSettled();
    app.blueprintPlannerDialog.selectTask(id, planner.queries.getLastRequest(id) ?? undefined);
    app.blueprintPlannerDialog.open();
    expect(readonlyBoundary(true)).toEqual(rows);
    const imported = await planner.actions.importTask(planner.queries.exportTask(id));
    app.blueprintPlannerDialog.selectTask(imported, planner.queries.getLastRequest(imported) ?? undefined);
    expect(readonlyBoundary(true)).toEqual(rows);
  } finally { planner.dispose(); app.dispose(); await session.dispose(); }
}, 60_000);

it("不合规原图以两倍设备占地显示参考曲线，恢复后保持起点，合规原图仍显示已验证点", async () => {
  const session = new PlannerBatchSession();
  const app = createAppHost(session.workspace);
  let planner = createBlueprintPlannerHost(session.workspace);
  const controller = app.blueprintPlannerDialog;
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
