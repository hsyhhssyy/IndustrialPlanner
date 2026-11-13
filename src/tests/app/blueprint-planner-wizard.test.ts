import { expect, it } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { PlannerWizardDraft, PLANNER_STEPS, visiblePlannerSteps } from "@/app/shell/blueprint-planner-wizard-state";
import { BlueprintPlannerManualPalette, groupManualPaletteNodes, visibleManualFacilityTemplates } from "@/app/shell/blueprint-planner-manual-palette";
import { createBlueprintPlannerHost } from "@/blueprint-planner/blueprint-planner-host";
import type { BlueprintPlannerManualLayout, BlueprintPlannerManualNode, BlueprintPlannerRequest } from "@/domain/blueprint-planner";
import { createAppTestWorkspace } from "../helpers/app-test-workspace";
import separator from "../blueprint-planner/fixtures/separator-core.json";
import environment from "../blueprint-planner/fixtures/environment-supply.json";

it.each([
  { name: "无环境需求", request: separator.request, expected: [] },
  { name: "存在环境与辅助供料需求", request: environment, expected: ["item_gas_acid"] },
])("人工设施入口仅展示产线需要的环境，保留电力入口：$name", async ({ request, expected }) => {
  const { app, workspace } = createAppTestWorkspace();
  const planner = createBlueprintPlannerHost(workspace, { storage: null });
  try {
    const controller = app.blueprintPlannerDialog;
    await controller.open((request as BlueprintPlannerRequest).plan);
    controller.updateOptions((request as BlueprintPlannerRequest).options);
    controller.manual.setEnabled(true);
    await controller.manual.prepare(controller.getRequest());
    expect(controller.manual.error).toBeNull();
    const layout = controller.manual.layout!;
    const before = layout.preparation.facilityTemplates;
    const visible = visibleManualFacilityTemplates(layout, workspace.registry);
    const environmentItems = visible.filter(template => template.purpose === "environment")
      .map(template => workspace.registry.queries.findRecipeDefinition(template.recipeId!)!.environmentOutput!.itemId);
    expect([...new Set(environmentItems)].sort()).toEqual(expected);
    expect(visible.some(template => template.purpose === "power")).toBe(true);
    expect(layout.preparation.facilityTemplates).toBe(before);
  } finally { planner.dispose(); app.dispose(); }
});

it("人工设备条目按绑定模式展示产物，移除节点标记且数量位于按钮外", async () => {
  const { app, workspace } = createAppTestWorkspace();
  const planner = createBlueprintPlannerHost(workspace, { storage: null });
  try {
    const controller = app.blueprintPlannerDialog;
    await controller.open((separator.request as BlueprintPlannerRequest).plan);
    controller.manual.setEnabled(true);
    await controller.manual.prepare(controller.getRequest());
    const layout = controller.manual.layout!;
    const node = layout.preparation.nodes.find(entry => entry.purpose === "production")!;
    const title = app.actions.translate(workspace.registry.queries.findEntityDefinition(node.definitionId)!.nameKey);
    const product = app.actions.translate(workspace.registry.queries.findItemDefinition(node.outputs[0]!.itemId)!.nameKey);
    for (const mode of ["device", "recipe", "topology"] as const) {
      const container = document.createElement("div");
      container.innerHTML = renderToStaticMarkup(createElement(BlueprintPlannerManualPalette, {
        layout: { ...layout, mode }, registry: workspace.registry, selection: null, disabled: false,
        onSelect: () => undefined, t: app.actions.translate,
      }));
      const button = [...container.querySelectorAll("button")].find(entry => entry.title === title)!;
      expect(button).toBeDefined();
      expect(button.parentElement!.firstElementChild!.tagName).toBe("SPAN");
      expect(button.parentElement!.firstElementChild!.textContent).toBe("1");
      expect(button.querySelectorAll("small")).toHaveLength(0);
      expect([...button.querySelectorAll("img")].some(img => img.alt === product)).toBe(mode !== "device");
      expect(button.textContent).toBe(title);
      expect(container.textContent).not.toMatch(/∞|×|点\s*\d/);
    }
  } finally { planner.dispose(); app.dispose(); }
});

it("环境与电力只从下方入口摆放，优先补足环境需求且额外设施被保留", async () => {
  const { app, workspace } = createAppTestWorkspace();
  const planner = createBlueprintPlannerHost(workspace, { storage: null });
  try {
    const controller = app.blueprintPlannerDialog, manual = controller.manual;
    await controller.open((environment as BlueprintPlannerRequest).plan);
    controller.updateOptions((environment as BlueprintPlannerRequest).options);
    manual.setEnabled(true);
    await manual.prepare(controller.getRequest());
    const initial = manual.layout!;
    const template = visibleManualFacilityTemplates(initial, workspace.registry).find(entry => entry.purpose === "environment")!;
    expect(initial.preparation.nodes.filter(entry => entry.purpose === "environment")).toHaveLength(1);
    for (const mode of ["device", "recipe", "topology"] as const) {
      const layout = { ...initial, mode };
      expect([...groupManualPaletteNodes(layout, workspace.registry).values()].flat().every(node => node.purpose !== "environment" && node.purpose !== "power")).toBe(true);
      const container = document.createElement("div");
      container.innerHTML = renderToStaticMarkup(createElement(BlueprintPlannerManualPalette, {
        layout, registry: workspace.registry, selection: null, disabled: false,
        onSelect: () => undefined, t: app.actions.translate,
      }));
      const heading = [...container.querySelectorAll("strong")].find(node => node.textContent === app.actions.translate("eda.manual.facilities"))!;
      const name = app.actions.translate(workspace.registry.queries.findEntityDefinition(template.definitionId)!.nameKey);
      const buttons = [...container.querySelectorAll("button")].filter(button => button.title === name);
      expect(buttons).toHaveLength(1);
      expect(heading.compareDocumentPosition(buttons[0]!) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    }
    manual.addFacility(template, { x: 8, y: 8 });
    await manual.prepare(controller.getRequest());
    expect(manual.layout!.placements).toHaveLength(1);
    expect(manual.layout!.facilities).toHaveLength(1);
    expect(manual.layout!.preparation.nodes.filter(entry => entry.purpose === "environment")).toHaveLength(1);
    expect(manual.layout!.preparation.placementIssues).toEqual([]);
    manual.addFacility(template, { x: 28, y: 8 });
    await manual.prepare(controller.getRequest());
    expect(manual.layout!.facilities).toHaveLength(2);
    expect(manual.layout!.placements).toHaveLength(2);
    expect(manual.layout!.preparation.nodes.filter(entry => entry.purpose === "environment")).toHaveLength(2);
    expect(manual.layout!.preparation.placementIssues).toEqual([]);
    expect(manual.invalidPositions()).toEqual([]);
  } finally { planner.dispose(); app.dispose(); }
});

it("返回不撤销已访问资格，失效只撤销确认状态，预算与标题修改不影响布局", async () => {
  const { app, workspace } = createAppTestWorkspace();
  const planner = createBlueprintPlannerHost(workspace, { storage: null });
  const controller = app.blueprintPlannerDialog;
  try {
    await controller.open((separator.request as BlueprintPlannerRequest).plan);
    const draft = controller.wizard.draft;
    expect(draft.canVisit("name")).toBe(false);
    for (const step of PLANNER_STEPS) { draft.setStep(step); draft.confirmStep(step); }
    draft.setStep("production");
    expect(draft.canVisit("result")).toBe(true);
    expect(draft.completedSteps.has("manual")).toBe(true);
    controller.updateOptions({ evaluationsPerRound: 10_000 });
    await controller.renameTask("独立命名");
    expect(draft.reviewSteps.size).toBe(0);
    controller.updateOptions({ warehouseBus: "corner" });
    expect([...draft.reviewSteps]).toEqual(["manual", "boundary", "result"]);
    expect(draft.completedSteps.has("manual")).toBe(false);
    expect(draft.canVisit("result")).toBe(true);
    draft.confirmStep("manual");
    expect(draft.reviewSteps.has("manual")).toBe(false);
    expect(new PlannerWizardDraft().canVisit("result")).toBe(false);
  } finally { planner.dispose(); app.dispose(); }
});

it("同类计数扣除兼容固定位置，取货口单独在所属边列表分组", () => {
  const { workspace, app } = createAppTestWorkspace();
  const node = (id: string, recipeId: string | null, definitionId = "furnance_1"): BlueprintPlannerManualNode => ({
    id, recipeId, definitionId, purpose: "production", inputs: [], outputs: [],
  });
  const nodes = [node("a", "recipe-a"), node("b", "recipe-a"), node("c", "recipe-b"),
    node("supply-a", null, "unloader_1"), node("supply-b", null, "unloader_1")];
  let layout: BlueprintPlannerManualLayout = { enabled: true, mode: "device", orientation: "free", boundary: { rotation: null, assignments: [] }, facilities: [], placements: [],
    preparation: { sourceKey: "test", nodes, connections: [], facilityTemplates: [], placementIssues: [] } };
  const counts = () => [...groupManualPaletteNodes(layout, workspace.registry).values()].map(group => group.length);
  expect(counts()).toEqual([3]);
  expect([...groupManualPaletteNodes(layout, workspace.registry, "boundary").values()].map(group => group.length)).toEqual([2]);
  layout = { ...layout, mode: "recipe" };
  expect(counts()).toEqual([2, 1]);
  layout = { ...layout, placements: [{ referenceNode: { ...nodes[0]!, id: "old-compatible-role" }, position: { x: 0, y: 0 }, rotation: 0 }] };
  expect(counts()).toEqual([1, 1]);
  layout = { ...layout, mode: "topology" };
  expect(counts()).toEqual([1, 1, 1]);
  layout = { ...layout, placements: [{ ...layout.placements[0]!, referenceNode: nodes[0]! }] };
  expect(counts()).toEqual([1, 1]);
  app.dispose();
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
    controller.wizard.draft.setStep("result");
    controller.wizard.draft.setStep("production");
    controller.updateItemPolicy({ itemId: separator.request.plan.externalSupplies[0]!.itemId, supply: "external" });
    expect(controller.options.warehousePortPlacement).toBe("continuous");
    expect(controller.wizard.draft.resetFields.has("eda.warehousePortPlacement")).toBe(true);
    expect(controller.wizard.draft.reviewSteps.has("manual")).toBe(true);
    expect(controller.manual.layout!.placements[0]!.position).toEqual({ x: 5, y: 6 });
    await controller.manual.prepare(controller.getRequest());
    expect(controller.manual.error).toBeNull();
    expect(controller.manual.layout!.placements[0]!.position).toEqual({ x: 5, y: 6 });
  } finally { planner.dispose(); app.dispose(); }
});

// AI-REMOVED 2026-11-13:
// Reason: 临时浏览器验证证明先绑定自动环境会在追加设施时超额，应测试显式人工设施保留。
// Trigger: 撤销错误的 resolveManualFacilitySelection 方案。Evidence: req048-groups/tablet-1794559376181。
// Replacement: 上方真实 Planner 对两次人工设施添加与零冲突的断言。Risk: Low；Human Review: Required
// Original code:
//     const selection = resolveManualFacilitySelection(initial, template);
//     expect("node" in selection).toBe(true);
//     if (!("node" in selection)) throw new Error("环境需求应由已有节点承担");
//     manual.place(selection.node, { x: 8, y: 8 });
//     await manual.prepare(controller.getRequest());
//     expect(manual.layout!.placements.some(entry => entry.referenceNode.id === selection.node.id)).toBe(true);
//     expect(manual.layout!.facilities).toHaveLength(0);
//     expect(resolveManualFacilitySelection(manual.layout!, template)).toEqual({ template });

it("存取线方向只在启用人工摆放后出现，步骤身份不随显隐改变", () => {
  expect(visiblePlannerSteps(false)).toEqual(["confirm", "name", "production", "layout", "manual", "result"]);
  expect(visiblePlannerSteps(true)).toEqual(PLANNER_STEPS);
});
