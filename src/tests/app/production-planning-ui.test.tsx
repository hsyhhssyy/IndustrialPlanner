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
    const gathering = app.workspace.registry.queries.findEntityDefinition("gas_pump_1")!;
    await vi.waitFor(async () => { await settleTestDom(); expect(view.container.textContent).toContain(app.actions.translate(gathering.nameKey)); });
    await clickTestElement(buttonWithText(view.container, "修改"));
    await clickTestElement(toggles()[natural.indexOf("item_gas_xiranite")]!);
    await clickTestElement(buttonWithText(view.container, "计算"));
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
