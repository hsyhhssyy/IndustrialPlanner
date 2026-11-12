import { expect, it } from "vitest";
import { PlannerWizardDraft } from "@/app/shell/blueprint-planner-wizard-state";
import { groupManualPaletteNodes } from "@/app/shell/blueprint-planner-manual-palette";
import { createBlueprintPlannerHost } from "@/blueprint-planner/blueprint-planner-host";
import type { BlueprintPlannerManualLayout, BlueprintPlannerManualNode, BlueprintPlannerRequest } from "@/domain/blueprint-planner";
import { createAppTestWorkspace } from "../helpers/app-test-workspace";
import separator from "../blueprint-planner/fixtures/separator-core.json";

it("返回不撤销已访问资格，失效只撤销确认状态，预算与标题修改不影响布局", async () => {
  const { app, workspace } = createAppTestWorkspace();
  const planner = createBlueprintPlannerHost(workspace, { storage: null });
  const controller = app.blueprintPlannerDialog;
  try {
    await controller.open((separator.request as BlueprintPlannerRequest).plan);
    const draft = controller.wizard.draft;
    expect(draft.canVisit(1)).toBe(false);
    for (let step = 0; step < 5; step++) { draft.confirmStep(step); draft.setStep(step + 1); }
    draft.setStep(2);
    expect(draft.canVisit(5)).toBe(true);
    expect(draft.completedSteps.has(4)).toBe(true);
    controller.updateOptions({ evaluationsPerRound: 10_000 });
    await controller.renameTask("独立命名");
    expect(draft.reviewSteps.size).toBe(0);
    controller.updateOptions({ warehouseBus: "corner" });
    expect([...draft.reviewSteps]).toEqual([4, 5]);
    expect(draft.completedSteps.has(4)).toBe(false);
    expect(draft.canVisit(5)).toBe(true);
    draft.confirmStep(4);
    expect(draft.reviewSteps.has(4)).toBe(false);
    expect(new PlannerWizardDraft().canVisit(5)).toBe(false);
  } finally { planner.dispose(); app.dispose(); }
});

it("同类计数扣除兼容固定位置，配方与拓扑档不能合并不同职责，取货口也分组", () => {
  const node = (id: string, recipeId: string | null, definitionId = "machine"): BlueprintPlannerManualNode => ({
    id, recipeId, definitionId, purpose: "production", inputs: [], outputs: [],
  });
  const nodes = [node("a", "recipe-a"), node("b", "recipe-a"), node("c", "recipe-b"),
    node("supply-a", null, "unloader_1"), node("supply-b", null, "unloader_1")];
  let layout: BlueprintPlannerManualLayout = { enabled: true, mode: "device", facilities: [], placements: [],
    preparation: { sourceKey: "test", nodes, connections: [], facilityTemplates: [], placementIssues: [] } };
  const counts = () => [...groupManualPaletteNodes(layout).values()].map(group => group.length);
  expect(counts()).toEqual([3, 2]);
  layout = { ...layout, mode: "recipe" };
  expect(counts()).toEqual([2, 1, 2]);
  layout = { ...layout, placements: [{ referenceNode: { ...nodes[0]!, id: "old-compatible-role" }, position: { x: 0, y: 0 }, rotation: 0 }] };
  expect(counts()).toEqual([1, 1, 2]);
  layout = { ...layout, mode: "topology" };
  expect(counts()).toEqual([1, 1, 1, 1, 1]);
  layout = { ...layout, placements: [{ ...layout.placements[0]!, referenceNode: nodes[0]! }] };
  expect(counts()).toEqual([1, 1, 1, 1]);
});

it("生产选择使后序单面规则失效时保留人工位置并恢复默认排列", async () => {
  const { app, workspace } = createAppTestWorkspace();
  const planner = createBlueprintPlannerHost(workspace, { storage: null });
  const controller = app.blueprintPlannerDialog;
  try {
    await controller.open((separator.request as BlueprintPlannerRequest).plan);
    controller.manual.setEnabled(true);
    await controller.manual.prepare(controller.getRequest());
    const node = controller.manual.layout!.preparation.nodes.find(node => node.purpose === "production")!;
    controller.manual.place(node, { x: 5, y: 6 });
    controller.updateOptions({ warehousePortPlacement: "full-side" });
    controller.wizard.draft.setStep(5);
    controller.wizard.draft.setStep(2);
    controller.updateItemPolicy({ itemId: separator.request.plan.externalSupplies[0]!.itemId, supply: "external" });
    expect(controller.options.warehousePortPlacement).toBe("continuous");
    expect(controller.wizard.draft.resetFields.has("eda.warehousePortPlacement")).toBe(true);
    expect(controller.wizard.draft.reviewSteps.has(4)).toBe(true);
    expect(controller.manual.layout!.placements[0]!.position).toEqual({ x: 5, y: 6 });
    await controller.manual.prepare(controller.getRequest());
    expect(controller.manual.error).toBeNull();
    expect(controller.manual.layout!.placements[0]!.position).toEqual({ x: 5, y: 6 });
  } finally { planner.dispose(); app.dispose(); }
});
