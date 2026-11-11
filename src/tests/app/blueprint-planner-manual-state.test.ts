import { expect, it } from "vitest";
import { createAppTestWorkspace } from "../helpers/app-test-workspace";
import { createBlueprintPlannerHost } from "@/blueprint-planner/blueprint-planner-host";
import { parsePlannerTaskFile } from "@/blueprint-planner/task-checkpoint";
import type { BlueprintPlannerRequest } from "@/domain/blueprint-planner";
import input from "../blueprint-planner/fixtures/environment-supply.json";

it("人工草稿保存、关闭、复制、导出及撤销保持独立，不把旧结果中的全部设备变为固定设备", async () => {
  const { workspace, app } = createAppTestWorkspace();
  const planner = createBlueprintPlannerHost(workspace, { storage: null });
  const controller = app.blueprintPlannerDialog;
  try {
    await controller.open((input as BlueprintPlannerRequest).plan);
    controller.updateOptions((input as BlueprintPlannerRequest).options);
    const id = controller.viewTaskId!;
    controller.manual.setEnabled(true);
    await controller.manual.prepare(controller.getRequest());
    expect(controller.manual.error).toBeNull();
    expect(controller.manual.layout?.mode).toBe("recipe");
    const node = controller.manual.layout!.preparation.nodes.find(node => node.purpose === "production")!;
    controller.manual.place(node, { x: 4, y: 5 });
    controller.manual.rotate();
    await controller.manual.prepare(controller.getRequest());
    await controller.saveProductionTask();
    const draft = planner.queries.exportTask(id);
    expect((parsePlannerTaskFile(JSON.parse(JSON.stringify(draft)), workspace.registry).request as BlueprintPlannerRequest)
      .manualLayout?.placements[0]).toMatchObject({ position: { x: 4, y: 5 }, rotation: 90 });
    controller.manual.setEnabled(false);
    await controller.saveProductionTask();
    expect(controller.manual.layout?.placements).toHaveLength(1);
    await controller.duplicateTask();
    const copy = controller.viewTaskId!;
    expect(copy).not.toBe(id);
    controller.manual.setEnabled(true);
    controller.manual.select(node.id); controller.manual.remove();
    expect(controller.manual.layout?.placements).toHaveLength(0);
    controller.manual.undo();
    expect(controller.manual.layout?.placements).toHaveLength(1);
    await controller.saveProductionTask();
    expect((planner.queries.getLastRequest(id) as BlueprintPlannerRequest).manualLayout?.enabled).toBe(false);
    expect((planner.queries.getLastRequest(copy) as BlueprintPlannerRequest).manualLayout?.enabled).toBe(true);
  } finally { planner.dispose(); app.dispose(); }
});

it("切换任务会取消旧准备，迟到的结果不能覆盖新任务", async () => {
  const { workspace, app } = createAppTestWorkspace();
  const planner = createBlueprintPlannerHost(workspace, { storage: null });
  const controller = app.blueprintPlannerDialog;
  try {
    await controller.open((input as BlueprintPlannerRequest).plan);
    controller.manual.setEnabled(true);
    const pending = controller.manual.prepare(controller.getRequest());
    await controller.open({ ...(input as BlueprintPlannerRequest).plan, name: "新的任务" });
    await pending;
    expect(controller.plan?.name).toBe("新的任务");
    expect(controller.manual.layout).toBeUndefined();
    expect(controller.manual.loading).toBe(false);
  } finally { planner.dispose(); app.dispose(); }
});
