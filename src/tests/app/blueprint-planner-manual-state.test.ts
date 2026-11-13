import { expect, it } from "vitest";
import { createAppTestWorkspace } from "../helpers/app-test-workspace";
import { createBlueprintPlannerHost } from "@/blueprint-planner/blueprint-planner-host";
import { parsePlannerTaskFile } from "@/blueprint-planner/task-checkpoint";
import type { BlueprintPlannerRequest } from "@/domain/blueprint-planner";
import separator from "../blueprint-planner/fixtures/separator-core.json";
import input from "../blueprint-planner/fixtures/environment-supply.json";

it.each([{ request: input, hasPorts: false }, { request: separator.request, hasPorts: true }])("人工草稿保存、关闭、复制、导出及撤销保持独立：存取口 $hasPorts", async ({ request, hasPorts }) => {
  const { workspace, app } = createAppTestWorkspace();
  const planner = createBlueprintPlannerHost(workspace, { storage: null });
  const controller = app.blueprintPlannerDialog;
  try {
    await controller.open((request as BlueprintPlannerRequest).plan);
    controller.updateOptions((request as BlueprintPlannerRequest).options);
    const id = controller.viewTaskId!;
    controller.manual.setEnabled(true);
    await controller.manual.prepare(controller.getRequest());
    expect(controller.manual.error).toBeNull();
    expect(controller.manual.layout?.mode).toBe("recipe");
    const node = controller.manual.layout!.preparation.nodes.find(node => node.purpose === "production")!;
    const port = controller.manual.layout!.preparation.nodes.find(node => node.definitionId === "unloader_1")!;
    controller.manual.setOrientation("fixed");
    controller.manual.setBoundaryRotation(90);
    if (hasPorts) {
      expect(port).toBeDefined();
      controller.manual.setBoundarySide(port, "base");
      expect(controller.manual.layout!.boundary.assignments).toHaveLength(1);
      controller.manual.undo();
      expect(controller.manual.layout!.boundary.assignments).toHaveLength(0);
      controller.manual.redo();
    }
    await controller.manual.prepare(controller.getRequest());
    const position = hasPorts ? { x: -140, y: -250 } : { x: 4, y: 5 };
    controller.manual.place(node, position);
    controller.manual.rotate();
    // 2026-11-13：新增存取口场景的设备不是正方形；保存的是旋转后锚点，而非放置前锚点。
    const rotated = structuredClone(controller.manual.layout!.placements[0]!);
    expect(rotated.rotation).toBe(90);
    if (hasPorts) expect(rotated.position.x < 0 && rotated.position.y < 0).toBe(true);
    await controller.manual.prepare(controller.getRequest());
    await controller.saveProductionTask();
    const draft = planner.queries.exportTask(id);
    expect(parsePlannerTaskFile(JSON.parse(JSON.stringify(draft)), workspace.registry).request.manualLayout)
      .toMatchObject({ orientation: "fixed", boundary: { rotation: 90, assignments: hasPorts ? [{ referenceNode: { id: port.id }, side: "base" }] : [] } });
    expect((parsePlannerTaskFile(JSON.parse(JSON.stringify(draft)), workspace.registry).request as BlueprintPlannerRequest)
      .manualLayout?.placements[0]).toEqual(rotated);
    controller.manual.setEnabled(false);
    await controller.saveProductionTask();
    expect(controller.manual.layout?.placements).toHaveLength(1);
    await controller.duplicateTask();
    const copy = controller.viewTaskId!;
    expect(copy).not.toBe(id);
    controller.manual.setEnabled(true);
    expect(controller.manual.layout).toMatchObject({ orientation: "fixed", boundary: { rotation: 90, assignments: hasPorts ? [{ side: "base" }] : [] } });
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
