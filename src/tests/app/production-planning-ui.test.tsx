import { act } from "react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { ProductionPlanningPanel } from "@/app/shell/production-planning/production-planning-panel";
import { ToolboxDialog } from "@/app/shell/dialogs/toolbox-dialog";
import { LeftToolbar } from "@/app/shell/layout/left-toolbar";
import { createBlueprintPlannerHost } from "@/blueprint-planner/blueprint-planner-host";
import { createEditorHost } from "@/editor/editor-host";
import { TOOLBOX_DIALOG_TAB_IDS } from "@/app/state/state-impl";
import { createDefaultPlannerSessionState, loadPlannerState, savePlannerState, type PlannerPersistedState } from "@/shared/storage/planner-storage";
import { createAppTestWorkspace } from "../helpers/app-test-workspace";
import { buttonWithText, changeTestValue, clickTestElement, mountTestComponent, settleTestDom } from "../helpers/react-test-dom";
import { createFakeIndexedDbFactory } from "../shared/fake-indexed-db";

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal("indexedDB", createFakeIndexedDbFactory());
});
afterEach(() => { localStorage.clear(); vi.unstubAllGlobals(); });

function initialState(patch: Partial<PlannerPersistedState>): PlannerPersistedState {
  return {
    targets: [], supplies: [], displayMode: "item", viewMode: "tree", useModules: false,
    recipeChoices: {}, recipeChoicesDemandSignature: null,
    sourceConfig: { waterPolicy: "use-byproduct", acidPolicy: "use-byproduct", sewagePolicy: "external-supply",
      waterPurifierPolicy: "disabled", includeDeviceMinimumConsumption: "fractional" },
    session: createDefaultPlannerSessionState(), ...patch,
  };
}

it("两页共用顶栏 Switch 和计算入口，原料为空时展示视图引导，每次计算默认打开工序图", async () => {
  const { app } = createAppTestWorkspace();
  await savePlannerState(initialState({ targets: [{ id: "target", itemId: "item_xiranite_powder", perMinute: 30 }] }));
  const view = await mountTestComponent(<ProductionPlanningPanel appHost={app} isTouch={false} onOpenGeneratedModuleEditor={() => {}} />);
  try {
    await vi.waitFor(async () => { await settleTestDom(); expect(buttonWithText(view.container, "计算").disabled).toBe(false); });
    const toolbar = view.container.querySelector(".production-planning-toolbar")!;
    const toggle = toolbar.querySelector<HTMLInputElement>('input[role="switch"]')!;
    expect(toggle.closest("label")?.textContent).toContain("使用模块");
    expect(toolbar.contains(buttonWithText(view.container, "计算"))).toBe(true);
    expect(view.container.querySelector(".production-planning-input-footer")).toBeNull();
    // AI-REMOVED 2026-10-26:
    // Reason: 引导从文字标签改为实际界面示意，不再要求标签文字直接相邻。
    // Trigger: 用户要求突出两个视图中的按钮位置。
    // Evidence: 新引导以 role=img 分别描述树表详情和工序图弹窗。
    // Replacement: 下方两幅带位置说明的界面示意断言。Risk: Low。Human Review: Required
    // Original code:
    // expect(view.container.querySelector(".production-planning-material-guide")?.textContent)
    //   .toContain("树表设为原料工序图设为原料");
    const guide = view.container.querySelector(".production-planning-material-guide")!;
    expect([...guide.querySelectorAll('figure > [role="img"]')].map(image => image.getAttribute("aria-label")))
      .toEqual(["树表 · 右侧详情", "工序图 · 点击节点后的弹窗"]);
    expect(guide.querySelectorAll("figure")).toHaveLength(2);
    expect(buttonWithText(view.container, "选择原料")).toBeDefined();
    await clickTestElement(buttonWithText(view.container, "计算"));
    expect(view.container.querySelector('[class*="process-graph-canvas"]')).not.toBeNull();
    expect(toolbar.contains(buttonWithText(view.container, "自动规划该产线"))).toBe(true);
    await clickTestElement(buttonWithText(view.container, "树表"));
    expect(view.container.querySelector(".production-planning-tree-table")).not.toBeNull();
    await clickTestElement(buttonWithText(view.container, "计算"));
    expect(view.container.querySelector('[class*="process-graph-canvas"]')).not.toBeNull();
    await clickTestElement(buttonWithText(view.container, "修改"));
    expect(view.container.querySelector('input[role="switch"]')).toBe(toggle);
    expect(view.container.querySelectorAll('input[role="switch"]')).toHaveLength(1);
  } finally { await view.unmount(); app.dispose(); }
});

it("工序图支线默认收起，展开和收起保留入口，重新计算恢复默认", async () => {
  const { app } = createAppTestWorkspace();
  await savePlannerState(initialState({
    targets: [{ id: "target", itemId: "item_xiranite_enr_powder", perMinute: 12 }],
    recipeChoices: {
      item_xiranite_enr_powder: "liquid_transmuter_2_solid_xiranite_enr_powder_1",
      item_filter_core: "tools_proc_filter_core_2",
    },
  }));
  const view = await mountTestComponent(<ProductionPlanningPanel appHost={app} isTouch={false} onOpenGeneratedModuleEditor={() => {}} />);
  try {
    await vi.waitFor(async () => { await settleTestDom(); expect(buttonWithText(view.container, "计算").disabled).toBe(false); });
    await clickTestElement(buttonWithText(view.container, "计算"));
    const graph = view.container.querySelector('[class*="process-graph-canvas"]')!;
    const toggles = () => [...graph.querySelectorAll<HTMLButtonElement>('button[aria-expanded]')];
    expect(toggles().length).toBeGreaterThan(0);
    expect(toggles().every(button => button.getAttribute("aria-expanded") === "false")).toBe(true);
    const button = toggles()[0]!;
    const label = button.getAttribute("aria-label")!;
    expect(label).toMatch(/^展开.+的上游分支$/);
    expect(button.title).toBe(label);
    const before = graph.querySelectorAll('[class*="process-node"][role="button"]').length;
    await clickTestElement(button);
    const expandedButton = graph.querySelector<HTMLButtonElement>(`button[aria-label="${label.replace(/^展开/, "收起")}"]`)!;
    expect(expandedButton).toBe(button);
    expect(expandedButton.getAttribute("aria-expanded")).toBe("true");
    expect(graph.querySelectorAll('[class*="process-node"][role="button"]').length).toBeGreaterThan(before);
    await clickTestElement(expandedButton);
    expect(button.getAttribute("aria-expanded")).toBe("false");
    expect(graph.querySelectorAll('[class*="process-node"][role="button"]')).toHaveLength(before);
    await clickTestElement(button);
    await clickTestElement(buttonWithText(view.container, "计算"));
    expect(toggles().every(toggle => toggle.getAttribute("aria-expanded") === "false")).toBe(true);
    await vi.waitFor(async () => expect((await loadPlannerState())?.session.processExpandedItems).toEqual([]));
  } finally { await view.unmount(); app.dispose(); }
});

it("工序图详情设置原料填入真实需求，移除后恢复生产配方", async () => {
  const { app } = createAppTestWorkspace();
  const itemId = "item_xiranite_powder";
  const name = app.actions.translate(app.workspace.registry.queries.findItemDefinition(itemId)!.nameKey);
  await savePlannerState(initialState({ targets: [{ id: "target", itemId, perMinute: 30 }] }));
  const view = await mountTestComponent(<ProductionPlanningPanel appHost={app} isTouch={false} onOpenGeneratedModuleEditor={() => {}} />);
  const node = () => [...view.container.querySelectorAll<HTMLElement>('[class*="process-node"][role="button"]')]
    .find(element => element.getAttribute("aria-label") === name)!;
  try {
    await vi.waitFor(async () => { await settleTestDom(); expect(buttonWithText(view.container, "计算").disabled).toBe(false); });
    await clickTestElement(buttonWithText(view.container, "计算"));
    await clickTestElement(node());
    let popup = view.container.querySelector('[role="dialog"]')!;
    expect(buttonWithText(popup, "选择配方").disabled).toBe(false);
    await clickTestElement(buttonWithText(popup, "选择配方"));
    expect(app.recipePicker.dialogState.visible).toBe(true);
    const source = app.recipePicker.source;
    expect(source?.kind).toBe("recipes");
    if (source?.kind !== "recipes") throw new Error("配方按钮没有打开已有配方选择器");
    const selectedRecipe = source.recipes.at(-1)!;
    await act(async () => app.recipePicker.selectRecipe(selectedRecipe.id));
    await vi.waitFor(async () => expect((await loadPlannerState())?.recipeChoices[itemId]).toContain(selectedRecipe.id));
    await clickTestElement(node());
    popup = view.container.querySelector('[role="dialog"]')!;
    await clickTestElement(buttonWithText(popup, "设为原料"));
    expect(view.container.querySelector('[role="dialog"]')).toBeNull();
    expect(view.container.querySelector(".production-planning-material-guide")).toBeNull();
    expect(view.container.querySelectorAll('[class*="process-node"][role="button"]')).toHaveLength(1);
    expect(node().textContent).toContain("原料");
    expect(view.container.querySelectorAll('[class*="process-graph-svg"] path')).toHaveLength(0);
    await vi.waitFor(async () => expect((await loadPlannerState())?.supplies).toEqual([
      expect.objectContaining({ itemId, perMinute: 30 }),
    ]));
    await clickTestElement(node());
    await clickTestElement(buttonWithText(view.container.querySelector('[role="dialog"]')!, "移除外部供给"));
    await vi.waitFor(async () => expect((await loadPlannerState())?.supplies).toEqual([]));
    expect(view.container.querySelectorAll('[class*="process-node"][role="button"]').length).toBeGreaterThan(1);
    expect(view.container.querySelector(".production-planning-material-guide")).not.toBeNull();
    await clickTestElement(node());
    expect(buttonWithText(view.container.querySelector('[role="dialog"]')!, "设为原料")).toBeDefined();
  } finally { await view.unmount(); app.dispose(); }
});

it.each([false, true])("自然资源和农作物默认显示数量，可在各自卡片内独立展开完整图标，触控=%s", async isTouch => {
  const { app } = createAppTestWorkspace();
  const view = await mountTestComponent(<ProductionPlanningPanel appHost={app} isTouch={isTouch} onOpenGeneratedModuleEditor={() => {}} />);
  try {
    for (const tag of ["自然资源", "农作物"]) {
      const card = view.container.querySelector<HTMLElement>(`[role="group"][aria-label="${tag}"]`)!;
      expect(card).not.toBeNull();
      expect(card.textContent).toContain(tag);
      const items = app.workspace.registry.itemDefinitions.filter(item => item.tags.includes(tag));
      const toggle = card.querySelector<HTMLButtonElement>("button[aria-expanded]")!;
      const content = view.container.ownerDocument.getElementById(toggle.getAttribute("aria-controls")!)!;
      expect(toggle.textContent).toContain(`${items.length}种`);
      expect(toggle.textContent).toContain("查看物品");
      expect(toggle.getAttribute("aria-expanded")).toBe("false");
      expect(content.hidden).toBe(true);
      expect(card.querySelectorAll("img")).toHaveLength(0);
      await clickTestElement(toggle);
      expect(toggle.getAttribute("aria-expanded")).toBe("true");
      expect(toggle.textContent).toContain("收起");
      expect(content.hidden).toBe(false);
      expect([...card.querySelectorAll("img")].map(image => image.alt).sort())
        .toEqual(items.map(item => app.actions.translate(item.nameKey)).sort());
    }
    const toggles = [...view.container.querySelectorAll<HTMLButtonElement>('[role="group"] button[aria-expanded]')];
    expect(toggles).toHaveLength(2);
    expect(toggles.every(toggle => toggle.getAttribute("aria-expanded") === "true")).toBe(true);
    await clickTestElement(toggles[0]!);
    expect(toggles[0]!.getAttribute("aria-expanded")).toBe("false");
    expect(toggles[0]!.textContent).toContain("查看物品");
    expect(toggles[0]!.closest('[role="group"]')!.querySelectorAll("img")).toHaveLength(0);
    expect(toggles[1]!.getAttribute("aria-expanded")).toBe("true");
  } finally { await view.unmount(); app.dispose(); }
});

it.each([null, false, true])("EDA 工具栏和产线入口默认可用，不受旧开关值 %s 影响", async legacyEnabled => {
  if (legacyEnabled !== null) localStorage.setItem("industrial-planner.experimental.eda", JSON.stringify(legacyEnabled));
  localStorage.setItem("v3-user-settings-dialog", JSON.stringify({ values: {
    "other-experimental-features": false,
    "experimental-blueprint-planner": legacyEnabled,
  } }));
  const { app, workspace } = createAppTestWorkspace();
  const editor = createEditorHost(workspace, { persistence: "memory" });
  const planner = createBlueprintPlannerHost(workspace);
  await savePlannerState(initialState({ targets: [{ id: "target", itemId: "item_xiranite_powder", perMinute: 30 }] }));
  const view = await mountTestComponent(<>
    <LeftToolbar appHost={app} />
    <ProductionPlanningPanel appHost={app} isTouch={false} onOpenGeneratedModuleEditor={() => {}} />
  </>);
  try {
    await clickTestElement(buttonWithText(view.container, app.actions.translate("eda.toolbar")));
    expect(app.blueprintPlannerDialog.dialogState.visible).toBe(true);
    await act(async () => app.blueprintPlannerDialog.close());
    await vi.waitFor(async () => { await settleTestDom(); expect(buttonWithText(view.container, "计算").disabled).toBe(false); });
    await clickTestElement(buttonWithText(view.container, "计算"));
    const planButton = () => buttonWithText(view.container, app.actions.translate("eda.planThisLine"));
    await vi.waitFor(async () => { await settleTestDom(); expect(planButton().disabled).toBe(false); });
    await clickTestElement(planButton());
    expect(app.blueprintPlannerDialog.dialogState.visible).toBe(true);
    expect(app.blueprintPlannerDialog.plan?.targets).toEqual(expect.arrayContaining([
      expect.objectContaining({ itemId: "item_xiranite_powder", perMinute: 30 }),
    ]));
    expect(localStorage.getItem("industrial-planner.experimental.eda")).toBe(legacyEnabled === null ? null : JSON.stringify(legacyEnabled));
  } finally { await view.unmount(); planner.dispose(); editor.dispose(); app.dispose(); }
});

it.each([false, true])("自然资源无限切换保留有限速率，恢复后影响真实计算，触控布局=%s", async isTouch => {
  const { app } = createAppTestWorkspace();
  const natural = app.workspace.registry.itemDefinitions.filter(item => item.tags.includes("自然资源")).map(item => item.id);
  expect(natural).toContain("item_gas_xiranite");
  await savePlannerState(initialState({
    targets: [{ id: "target", itemId: "item_gas_xiranite", perMinute: 120 }],
    supplies: natural.map(itemId => ({ id: itemId, itemId, perMinute: 30 })),
  }));
  let view = await mountTestComponent(<ProductionPlanningPanel appHost={app} isTouch={isTouch} onOpenGeneratedModuleEditor={() => {}} />);
  const toggles = () => [...view.container.querySelectorAll<HTMLButtonElement>('button[aria-label="无限供给"]')];
  try {
    await vi.waitFor(async () => { await settleTestDom(); expect(toggles()).toHaveLength(natural.length); });
    for (const button of toggles()) {
      expect(button.getAttribute("aria-pressed")).toBe("false");
      await clickTestElement(button);
      expect(button.getAttribute("aria-pressed")).toBe("true");
      expect(button.parentElement!.querySelector("input")!.value).toBe("∞");
    }
    await vi.waitFor(async () => expect((await loadPlannerState())?.supplies.every(supply => supply.isInfinite)).toBe(true));
    await view.unmount();
    view = await mountTestComponent(<ProductionPlanningPanel appHost={app} isTouch={isTouch} onOpenGeneratedModuleEditor={() => {}} />);
    await vi.waitFor(async () => { await settleTestDom(); expect(toggles()).toHaveLength(natural.length); });
    expect(toggles().every(button => button.getAttribute("aria-pressed") === "true")).toBe(true);
    const gas = toggles()[natural.indexOf("item_gas_xiranite")]!;
    await clickTestElement(gas);
    expect(gas.parentElement!.querySelector("input")!.value).toBe("30");
    await clickTestElement(buttonWithText(view.container, "计算"));
    await clickTestElement(buttonWithText(view.container, "树表"));
    const gathering = app.workspace.registry.queries.findEntityDefinition("gas_pump_1")!;
    await vi.waitFor(async () => { await settleTestDom(); expect(view.container.textContent).toContain(app.actions.translate(gathering.nameKey)); });
    await clickTestElement(buttonWithText(view.container, "修改"));
    await clickTestElement(toggles()[natural.indexOf("item_gas_xiranite")]!);
    await clickTestElement(buttonWithText(view.container, "计算"));
    await clickTestElement(buttonWithText(view.container, "树表"));
    await vi.waitFor(async () => { await settleTestDom(); expect(buttonWithText(view.container, "移除外部供给")).toBeDefined(); });
    expect([...view.container.querySelectorAll("button")].some(button => button.textContent?.trim() === "设为原料")).toBe(false);
  } finally { await view.unmount(); app.dispose(); }
});

it("转为模块先打开编辑草稿，保存后写入真实模块库并成为规划候选", async () => {
  const { app } = createAppTestWorkspace();
  await savePlannerState(initialState({ targets: [{ id: "target", itemId: "item_xiranite_powder", perMinute: 30 }] }));
  app.internalActions.setDialogTab("toolbox", TOOLBOX_DIALOG_TAB_IDS[1]);
  app.internalActions.openDialog("toolbox");
  const view = await mountTestComponent(<ToolboxDialog appHost={app} />);
  try {
    await vi.waitFor(async () => { await settleTestDom(); expect(buttonWithText(view.container, "计算").disabled).toBe(false); });
    const useModules = view.container.querySelector<HTMLInputElement>('input[type="checkbox"]')!;
    await clickTestElement(useModules);
    expect(useModules.checked).toBe(true);
    await clickTestElement(buttonWithText(view.container, "计算"));
    await vi.waitFor(async () => { await settleTestDom(); expect(buttonWithText(view.container, "转为模块")).toBeDefined(); });
    await clickTestElement(buttonWithText(view.container, "转为模块"));
    await vi.waitFor(async () => { await settleTestDom(); expect(view.container.textContent).toContain("编辑模块"); });
    expect(app.internalState.workbench.toolbox.moduleBalancing.customModules).toHaveLength(0);
    const name = [...view.container.querySelectorAll("label")].find(label => label.textContent?.includes("模块名称"))!.querySelector("input")!;
    expect(name.value).toBe("未命名模块");
    await changeTestValue(name, "息壤产线模块");
    await clickTestElement(buttonWithText(view.container, "保存模块"));
    const modules = app.internalState.workbench.toolbox.moduleBalancing.customModules;
    expect(modules).toHaveLength(1);
    expect(modules[0]).toMatchObject({ name: "息壤产线模块", outputs: [{ itemId: "item_xiranite_powder", perMinute: 30 }] });
    // 2026-10-16：原木配方禁止自动选择后，锦草种植闭环额外消耗 15/min 清水，与息壤加工的 30/min 合计 45/min。
    expect(modules[0]!.inputs).toEqual(expect.arrayContaining([{ itemId: "item_liquid_water", perMinute: 45 }]));
    await act(async () => { app.internalActions.setDialogTab("toolbox", TOOLBOX_DIALOG_TAB_IDS[1]); });
    await clickTestElement(buttonWithText(view.container, "树表"));
    await vi.waitFor(async () => { await settleTestDom(); expect(view.container.textContent).toContain("自定义模块 · 由 息壤产线模块 产出"); });
    expect([...view.container.querySelectorAll("option")].filter(option => option.textContent === "息壤产线模块 · 自定义模块")).toHaveLength(1);
    expect(view.container.querySelector<HTMLInputElement>('input[type="checkbox"]')!.checked).toBe(true);
  } finally { await view.unmount(); app.dispose(); }
});


it.each([false, true])("单线芽针以植物循环展示，回流详情可跳转且不出现共享需求，触控=%s", async isTouch => {
  const { app } = createAppTestWorkspace();
  await savePlannerState(initialState({ targets: [{ id: "target", itemId: "item_plant_grass_powder_2", perMinute: 30 }] }));
  // jsdom 缺少原生滚动方法；这里只适配环境，真实滚动与布局由三种 Screen Profile 验证。
  const scrollIntoViewDescriptor = Object.getOwnPropertyDescriptor(HTMLElement.prototype, "scrollIntoView");
  Object.defineProperty(HTMLElement.prototype, "scrollIntoView", { configurable: true, value: vi.fn() });
  let unmount: (() => Promise<void>) | undefined;
  try {
    const view = await mountTestComponent(<ProductionPlanningPanel appHost={app} isTouch={isTouch} onOpenGeneratedModuleEditor={() => {}} />);
    unmount = view.unmount;
    await vi.waitFor(async () => { await settleTestDom(); expect(buttonWithText(view.container, "计算").disabled).toBe(false); });
    await clickTestElement(buttonWithText(view.container, "计算"));
    await clickTestElement(buttonWithText(view.container, "树表"));
    await vi.waitFor(async () => { await settleTestDom(); expect(view.container.textContent).toContain("植物循环"); });
    expect(view.container.textContent).not.toContain("共享需求");
    const feedbackButton = [...view.container.querySelectorAll<HTMLButtonElement>("button")]
      .find(button => button.textContent?.trim() === "芽针植物循环")!;
    expect(feedbackButton).toBeDefined();
    await clickTestElement(feedbackButton);
    expect(view.container.textContent).toContain("15/min");
    expect(view.container.textContent).not.toContain("shared-demand:");
    const machineName = app.actions.translate(app.workspace.registry.queries.findEntityDefinition("planter_1_liquid")!.nameKey);
    const sourceButton = [...view.container.querySelectorAll<HTMLButtonElement>("article button")]
      .find(button => button.textContent?.includes(machineName) && button.textContent?.includes("芽针"));
    expect(sourceButton).toBeDefined();
    await clickTestElement(sourceButton!);
    expect(view.container.querySelector("article")?.textContent).toContain("30/min");
  } finally {
    await unmount?.();
    app.dispose();
    if (scrollIntoViewDescriptor) Object.defineProperty(HTMLElement.prototype, "scrollIntoView", scrollIntoViewDescriptor);
    else Reflect.deleteProperty(HTMLElement.prototype, "scrollIntoView");
  }
});
