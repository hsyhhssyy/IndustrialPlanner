import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { toJS } from "mobx";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { BlueprintPlannerDialog } from "@/app/shell/blueprint-planner-dialog";
import { BlueprintPreviewDialog } from "@/app/shell/dialogs/blueprint-preview-dialog";
import { createBlueprintPlannerHost } from "@/blueprint-planner/blueprint-planner-host";
import { createSimulationHost } from "@/simulation/simulation-host";
import type { BlueprintPlannerRequest } from "@/domain/blueprint-planner";
import { createAppTestWorkspace } from "../helpers/app-test-workspace";
import { createFakeIndexedDbFactory } from "../shared/fake-indexed-db";
import { loadBlueprintFromFile } from "../simulation/blueprint-test-helpers";
import plant from "../blueprint-planner/fixtures/plant-preload.json";

beforeEach(() => { vi.stubGlobal("indexedDB", createFakeIndexedDbFactory()); });
afterEach(() => { localStorage.clear(); vi.unstubAllGlobals(); });

it("蓝图实验开关统一控制预览入口、识别和优化任务，保留普通任务及持久化数据", async () => {
  const { app, workspace } = createAppTestWorkspace();
  const simulation = createSimulationHost(workspace, { engineKind: "dense-v2", workerMode: "runtime", blueprintDenseTickRate: 2 });
  let planner = createBlueprintPlannerHost(workspace);
  const controller = app.blueprintPlannerDialog;
  const directory = "src/tests/fixtures/blueprints/blueprint-planner/blueprint-optimization/";
  const blueprint = { ...loadBlueprintFromFile(`${directory}unknown-entry.schema7.json`), name: "识别任务 A" };
  const optimizedBlueprint = { ...loadBlueprintFromFile(`${directory}plant-cycle.schema7.json`), name: "优化任务 B" };
  const render = () => {
    // 只验证组件输出及真实主机状态；Canvas 与三屏布局另由开发浏览器验证。
    const container = document.createElement("div");
    container.innerHTML = renderToStaticMarkup(createElement("div", null,
      createElement(BlueprintPreviewDialog, { appHost: app, controller: app.blueprintPreview }),
      createElement(BlueprintPlannerDialog, { appHost: app })));
    return container;
  };
  const taskNames = () => [...render().querySelectorAll('[class*="taskList"] button strong')].map(button => button.textContent).sort();
  try {
    await planner.whenSettled();
    expect(controller.blueprintPlanningEnabled).toBe(false);
    controller.openBlueprint(blueprint);
    expect(controller.dialogState.visible).toBe(false);
    expect(planner.queries.listTasks()).toHaveLength(0);

    const options = { ...toJS(controller.options), warehousePortPlacement: "any" as const };
    const recognitionId = await planner.actions.createBlueprintTask({ blueprint, boundaries: [], activeActivityIds: [] }, options);
    await planner.whenSettled();
    const optimizationId = await planner.actions.createBlueprintTask({ blueprint: optimizedBlueprint, boundaries: [], activeActivityIds: [] }, options);
    await planner.whenSettled();
    await planner.actions.identifyBlueprint(optimizationId);
    const request = plant.request as BlueprintPlannerRequest;
    const productionId = await planner.actions.importTask(planner.queries.exportDraft({ ...request, plan: { ...request.plan, name: "普通产线 C" } }));
    await planner.whenSettled();
    const saved = planner.queries.listTasks().map(task => planner.queries.exportTask(task.taskId));
    app.blueprintPreview.open({ ...blueprint, parentFolderId: null });
    controller.open();
    expect(taskNames()).toEqual(["普通产线 C"]);
    expect(render().querySelector('[data-ui-button-id="blueprint-preview-optimize-button"]')).toBeNull();
    controller.selectTask(recognitionId, planner.queries.getLastRequest(recognitionId) ?? undefined);
    expect(controller.viewTaskId).toBeNull();

    controller.setBlueprintPlanningEnabled(true);
    expect(taskNames()).toEqual(["优化任务 B", "普通产线 C", "识别任务 A"].sort());
    expect(render().querySelector('[data-ui-button-id="blueprint-preview-optimize-button"]')).not.toBeNull();
    controller.selectTask(optimizationId, planner.queries.getLastRequest(optimizationId) ?? undefined);
    expect(controller.blueprintRequest).not.toBeNull();
    controller.setBlueprintPlanningEnabled(false);
    expect(controller.viewTaskId).toBeNull();
    expect(controller.plan).toBeNull();
    expect(controller.blueprintRequest).toBeNull();
    expect(taskNames()).toEqual(["普通产线 C"]);
    controller.selectTask(productionId, planner.queries.getLastRequest(productionId) ?? undefined);
    controller.selectTask(optimizationId);
    expect(controller.viewTaskId).toBe(productionId);
    expect(planner.queries.listTasks().map(task => planner.queries.exportTask(task.taskId))).toEqual(saved);

    planner.dispose();
    planner = createBlueprintPlannerHost(workspace);
    await planner.whenSettled();
    expect(taskNames()).toEqual(["普通产线 C"]);
    controller.setBlueprintPlanningEnabled(true);
    expect(taskNames()).toEqual(["优化任务 B", "普通产线 C", "识别任务 A"].sort());
    controller.selectTask(recognitionId, planner.queries.getLastRequest(recognitionId) ?? undefined);
    controller.setBlueprintPlanningEnabled(false);
    expect(controller.blueprintDraft).toBeNull();
    expect(controller.viewTaskId).toBeNull();
    expect(planner.queries.listTasks()).toHaveLength(3);
  } finally { planner.dispose(); app.dispose(); simulation.dispose(); }
});
