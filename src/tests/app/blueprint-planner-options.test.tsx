import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { act } from "react";
import { BlueprintPlannerDialog } from "@/app/shell/blueprint-planner-dialog";
import { createBlueprintPlannerHost } from "@/blueprint-planner/blueprint-planner-host";
import type { BlueprintPlannerRequest } from "@/domain/blueprint-planner";
import { createAppTestWorkspace } from "../helpers/app-test-workspace";
import { buttonWithText, changeTestValue, clickTestElement, mountTestComponent, selectWithLabel, settleTestDom } from "../helpers/react-test-dom";
import { createFakeIndexedDbFactory } from "../shared/fake-indexed-db";
import separator from "../blueprint-planner/fixtures/separator-core.json";
import converter from "../blueprint-planner/fixtures/converter-startup-liquid.json";
import plant from "../blueprint-planner/fixtures/plant-preload.json";
import environment from "../blueprint-planner/fixtures/environment-supply.json";
import type { BlueprintPlannerProductionPlan } from "@/domain/blueprint-planner";

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal("indexedDB", createFakeIndexedDbFactory());
  // 2026-10-11：用户授权补充 jsdom 缺失接口；不发送尺寸，不验证流程图排版。
  vi.stubGlobal("ResizeObserver", class {
    observe() {}
    unobserve() {}
    disconnect() {}
  });
});
afterEach(() => { localStorage.clear(); vi.unstubAllGlobals(); });

it("存取线选择随任务恢复，新草稿不读取或覆盖旧全局偏好", async () => {
  const { app, workspace } = createAppTestWorkspace();
  let planner = createBlueprintPlannerHost(workspace);
  const controller = app.blueprintPlannerDialog;
  controller.open((separator.request as BlueprintPlannerRequest).plan);
  let view = await mountTestComponent(<BlueprintPlannerDialog appHost={app} />);
  try {
    const field = selectWithLabel(view.container, "存取线形态");
    expect(field.value).toBe("straight");
    expect([...field.options].map(option => option.textContent)).toEqual(["直线存取线", "直角存取线", "U型存取线"]);
    await changeTestValue(field, "corner");
    expect(controller.getRequest().options.warehouseBus).toBe("corner");
    await changeTestValue(field, "u-shaped");
    const id = await planner.actions.importTask(planner.queries.exportDraft(controller.getRequest()));
    expect(localStorage.getItem("industrial-planner.eda.options")).toBeNull();
    await view.unmount();
    planner.dispose();
    planner = createBlueprintPlannerHost(workspace);
    await planner.whenSettled();
    controller.open((separator.request as BlueprintPlannerRequest).plan);
    view = await mountTestComponent(<BlueprintPlannerDialog appHost={app} />);
    expect(selectWithLabel(view.container, "存取线形态").value).toBe("straight");
    controller.selectTask(id, planner.queries.getLastRequest(id) ?? undefined);
    await settleTestDom();
    expect(selectWithLabel(view.container, "存取线形态").value).toBe("u-shaped");
    localStorage.setItem("industrial-planner.eda.options", JSON.stringify({ warehouseBus: "free" }));
    controller.open((separator.request as BlueprintPlannerRequest).plan);
    await settleTestDom();
    await changeTestValue(selectWithLabel(view.container, "存取线形态"), "corner");
    expect(JSON.parse(localStorage.getItem("industrial-planner.eda.options")!)).toEqual({ warehouseBus: "free" });
  } finally { await view.unmount(); planner.dispose(); app.dispose(); }
});

it("转换器默认拒绝自循环，手工或储罐启动解除阻断并随任务恢复", async () => {
  const { app, workspace } = createAppTestWorkspace();
  let planner = createBlueprintPlannerHost(workspace);
  const request = converter as BlueprintPlannerRequest;
  const controller = app.blueprintPlannerDialog;
  controller.open(request.plan);
  for (const policy of request.plan.supplyPolicies ?? []) controller.updateSupplyPolicy(policy);
  let view = await mountTestComponent(<BlueprintPlannerDialog appHost={app} />);
  try {
    const field = selectWithLabel(view.container, "固液气转换器启动");
    const warning = "液化息壤 自循环 需要外部启动器启动，请调整启动设置。";
    expect(field.value).toBe("reject");
    expect(view.container.textContent).toContain(warning);
    expect(buttonWithText(view.container, "开始规划").disabled).toBe(true);
    let id = "";
    for (const mode of ["manual", "tank"]) {
      await changeTestValue(field, mode);
      expect(view.container.textContent).not.toContain(warning);
      expect(buttonWithText(view.container, "开始规划").disabled).toBe(false);
      const file = planner.queries.exportDraft(controller.getRequest());
      expect(file.request.options.converterStartup).toBe(mode);
      id = await planner.actions.importTask(file);
      expect(planner.queries.getLastRequest(id)?.options.converterStartup).toBe(mode);
    }
    expect(localStorage.getItem("industrial-planner.eda.options")).toBeNull();
    await view.unmount();
    planner.dispose();
    planner = createBlueprintPlannerHost(workspace);
    await planner.whenSettled();
    controller.open(request.plan);
    view = await mountTestComponent(<BlueprintPlannerDialog appHost={app} />);
    expect(selectWithLabel(view.container, "固液气转换器启动").value).toBe("reject");
    controller.selectTask(id, planner.queries.getLastRequest(id) ?? undefined);
    await settleTestDom();
    expect(selectWithLabel(view.container, "固液气转换器启动").value).toBe("tank");
  } finally { await view.unmount(); planner.dispose(); app.dispose(); }
});


it("产线选项按布局、启动和计算分组，CPU/GPU switch 独立且随任务恢复", async () => {
  const { app, workspace } = createAppTestWorkspace();
  const planner = createBlueprintPlannerHost(workspace);
  const controller = app.blueprintPlannerDialog;
  controller.open((separator.request as BlueprintPlannerRequest).plan);
  const view = await mountTestComponent(<BlueprintPlannerDialog appHost={app} />);
  try {
    const groups = [...view.container.querySelectorAll('fieldset')].filter(group => group.querySelector('legend'));
    expect(groups.map(group => group.querySelector('legend')?.textContent)).toEqual(["布局规则", "启动方式", "计算设置"]);
    expect([...groups[0]!.querySelectorAll('label > span')].map(label => label.textContent)).toEqual(["取货口摆放规则", "存取线形态"]);
    expect([...groups[1]!.querySelectorAll('label > span')].map(label => label.textContent)).toEqual(["植物循环启动", "固液气转换器启动"]);
    const computation = groups[2]!;
    const [cpu, gpu] = [...computation.querySelectorAll<HTMLInputElement>('input[role="switch"]')];
    expect(cpu!.checked && gpu!.checked).toBe(true);
    await clickTestElement(cpu!);
    expect(controller.options).toMatchObject({ concurrency: 1, gpu: true });
    expect(gpu!.checked).toBe(true);
    await clickTestElement(gpu!);
    expect(controller.options).toMatchObject({ concurrency: 1, gpu: false });
    await clickTestElement(cpu!);
    expect(controller.options).toMatchObject({ concurrency: "auto", gpu: false });
    expect(gpu!.checked).toBe(false);
    const id = await planner.actions.importTask(planner.queries.exportDraft(controller.getRequest()));
    controller.open((separator.request as BlueprintPlannerRequest).plan);
    controller.selectTask(id, planner.queries.getLastRequest(id) ?? undefined);
    await settleTestDom();
    expect(controller.options).toMatchObject({ concurrency: "auto", gpu: false });
    expect(cpu!.checked).toBe(true);
    expect(gpu!.checked).toBe(false);
    expect(selectWithLabel(view.container, "存取线形态").disabled).toBe(true);
    expect(cpu!.disabled || gpu!.disabled).toBe(false);
  } finally { await view.unmount(); planner.dispose(); app.dispose(); }
});

it("取货口规则默认连续，单面强制直线并阻断非法固体外供，恢复后解锁", async () => {
  const { app, workspace } = createAppTestWorkspace();
  const planner = createBlueprintPlannerHost(workspace);
  const controller = app.blueprintPlannerDialog;
  controller.open((separator.request as BlueprintPlannerRequest).plan);
  const view = await mountTestComponent(<BlueprintPlannerDialog appHost={app} />);
  try {
    const rule = selectWithLabel(view.container, "取货口摆放规则");
    const bus = selectWithLabel(view.container, "存取线形态");
    expect(rule.value).toBe("continuous");
    await changeTestValue(bus, "corner");
    await changeTestValue(rule, "full-side");
    expect(bus.value).toBe("straight");
    expect(bus.disabled).toBe(true);
    const supply = [...view.container.querySelectorAll('select')]
      .find(field => field.querySelector('option[value="external"]'))!;
    expect(supply).toBeDefined();
    await changeTestValue(supply, "external");
    expect(supply.getAttribute("aria-invalid")).toBe("true");
    expect(buttonWithText(view.container, "开始规划").disabled).toBe(true);
    expect(controller.getRequest().options).toMatchObject({ warehousePortPlacement: "full-side", warehouseBus: "straight" });
    expect(controller.getRequest().options.itemPolicies?.some(policy => policy.supply === "external")).toBe(true);
    await changeTestValue(supply, "warehouse");
    expect(supply.getAttribute("aria-invalid")).not.toBe("true");
    expect(buttonWithText(view.container, "开始规划").disabled).toBe(false);
    await changeTestValue(rule, "continuous");
    expect(bus.disabled).toBe(false);
  } finally { await view.unmount(); planner.dispose(); app.dispose(); }
});

it("新草稿忽略旧全局预算；清空与逐位输入有效，复制保留历史和原配置", async () => {
  localStorage.setItem("industrial-planner.eda.options", JSON.stringify({ evaluationsPerRound: 70_000, concurrency: 1 }));
  const { app, workspace } = createAppTestWorkspace();
  const planner = createBlueprintPlannerHost(workspace);
  const controller = app.blueprintPlannerDialog;
  controller.open((plant.request as BlueprintPlannerRequest).plan);
  const view = await mountTestComponent(<BlueprintPlannerDialog appHost={app} />);
  try {
    const budget = view.container.querySelector<HTMLInputElement>('input[type="number"]')!;
    const defaults = structuredClone(controller.getRequest().options);
    expect(budget.value).toBe("500");
    expect(defaults).toMatchObject({ evaluationsPerRound: 5_000_000, concurrency: "auto", gpu: true,
      warehouseBus: "straight", plantStartup: "preload", itemPolicies: [] });
    expect(view.container.querySelectorAll('select[aria-label$=" · 外部接入"]')).toHaveLength(0);
    const outputs = [...view.container.querySelectorAll<HTMLSelectElement>('select[aria-label$=" · 产物去向"]')];
    expect(outputs.length).toBeGreaterThan(0);
    expect(outputs.every(field => field.value === "auto")).toBe(true);
    expect([...view.container.querySelectorAll<HTMLSelectElement>('select[aria-label$=" · 副产物处理"]')]
      .every(field => field.value === "destroy")).toBe(true);
    await changeTestValue(budget, "");
    budget.blur();
    await settleTestDom();
    expect(budget.value).toBe("");
    expect(controller.options.evaluationsPerRound).toBe(0);
    expect(buttonWithText(view.container, "开始规划").disabled).toBe(true);
    for (const value of ["1", "10", "100", "1000"]) {
      await changeTestValue(budget, value);
      expect(budget.value).toBe(value);
      expect(controller.options.evaluationsPerRound).toBe(Number(value) * 10_000);
    }
    expect(buttonWithText(view.container, "开始规划").disabled).toBe(false);
    await changeTestValue(budget, "7");
    controller.updateOptions({ concurrency: 1, gpu: false, warehouseBus: "corner" });
    controller.updateItemPolicy({ itemId: "item_plant_moss_3", output: "warehouse" });
    const id = await planner.actions.importTask(planner.queries.exportDraft(controller.getRequest()));
    controller.selectTask(id, planner.queries.getLastRequest(id) ?? undefined);
    await settleTestDom();
    expect(controller.options).toMatchObject({ evaluationsPerRound: 70_000, concurrency: 1, gpu: false });
    await changeTestValue(budget, "");
    expect(buttonWithText(view.container, "开始规划").disabled).toBe(true);
    await changeTestValue(budget, "7");
    expect(buttonWithText(view.container, "开始规划").disabled).toBe(false);
    const original = planner.queries.exportTask(id);
    await clickTestElement(buttonWithText(view.container, "复制任务"));
    await vi.waitFor(() => expect(controller.viewTaskId).not.toBe(id));
    expect(controller.viewTaskId).not.toBeNull();
    expect(controller.getRequest().options).toEqual(original.request.options);
    expect(budget.value).toBe("7");
    expect(planner.queries.listTasks()).toHaveLength(2);
    expect(planner.queries.getRandomSeed(controller.viewTaskId!)).not.toBe(planner.queries.getRandomSeed(id));
    expect(planner.queries.exportTask(id)).toEqual(original);
  } finally { await view.unmount(); planner.dispose(); app.dispose(); }
});

it("环境树展开与供料来源联动，逐物品规则随草稿恢复，复制不覆盖原任务", async () => {
  const { app, workspace } = createAppTestWorkspace();
  let planner = createBlueprintPlannerHost(workspace);
  const controller = app.blueprintPlannerDialog;
  const plan = environment.plan as BlueprintPlannerProductionPlan;
  controller.open(plan);
  expect(controller.plan?.supplyPolicies).toEqual([]);
  for (const policy of plan.supplyPolicies ?? []) controller.updateSupplyPolicy(policy);
  const view = await mountTestComponent(<BlueprintPlannerDialog appHost={app} />);
  try {
    const tree = view.container.querySelector('[aria-label="环境供料"]')!;
    expect(tree.querySelectorAll('tr')).toHaveLength(4);
    await clickTestElement(tree.querySelector<HTMLButtonElement>('button[aria-label="折叠"]')!);
    expect(tree.querySelectorAll('tr')).toHaveLength(2);
    await clickTestElement(tree.querySelector<HTMLButtonElement>('button[aria-label="展开"]')!);
    await clickTestElement(buttonWithText(tree, "外部供给"));
    expect(tree.querySelectorAll('tr')).toHaveLength(2);
    const supply = selectWithLabel(view.container, "酸气 · 外部接入");
    await changeTestValue(supply, "external");
    expect(controller.options.itemPolicies?.find(policy => policy.itemId === "item_gas_acid")?.supply).toBe("external");
    await changeTestValue(supply, "conduit");
    expect(tree.textContent).not.toContain("registry.recipe.");
    const file = planner.queries.exportDraft(controller.getRequest());
    expect(controller.viewTaskId).toBeNull();
    expect(planner.queries.listTasks()).toEqual([]);
    expect(planner.state.activeTaskId).toBeNull();
    let id = "";
    await act(async () => {
      id = await planner.actions.importTask(file);
      await planner.whenSettled();
      planner.dispose();
      planner = createBlueprintPlannerHost(workspace);
      await planner.whenSettled();
      controller.selectTask(id, planner.queries.getLastRequest(id) ?? undefined);
    });
    await settleTestDom();
    // 与 Playwright isDisabled 一致，检查祖先 fieldset 继承的有效禁用状态。
    expect(selectWithLabel(view.container, "酸气 · 外部接入").matches(":disabled")).toBe(true);
    const original = planner.queries.exportTask(id);
    expect(original.request).toEqual(file.request);
    expect(original.request).toMatchObject({ plan: { supplyPolicies: expect.arrayContaining([{ itemId: "item_gas_acid", source: "external" }]) },
      options: { itemPolicies: [{ itemId: "item_gas_acid", supply: "conduit" }] } });
    await clickTestElement(buttonWithText(view.container, "复制任务"));
    await vi.waitFor(() => expect(controller.viewTaskId).not.toBe(id));
    expect(controller.plan?.supplyPolicies).toEqual((original.request as BlueprintPlannerRequest).plan.supplyPolicies);
    expect(controller.options.itemPolicies).toEqual(original.request.options.itemPolicies);
    expect(planner.queries.exportTask(id)).toEqual(original);
    // 新副本保持原约束；供料编辑继续由新草稿覆盖，不把已持久化副本当作草稿。
    controller.open(plan);
    await settleTestDom();
    await clickTestElement(buttonWithText(tree, "外部供给"));
    expect(selectWithLabel(view.container, "酸气 · 外部接入").value).toBe("conduit");
    expect(selectWithLabel(view.container, "酸气 · 外部接入").matches(":disabled")).toBe(false);
    await clickTestElement(buttonWithText(tree, "内部生产"));
    expect(view.container.querySelector('select[aria-label="酸气 · 外部接入"]')).toBeNull();
    expect(planner.queries.listTasks()).toHaveLength(2);
  } finally { await view.unmount(); planner.dispose(); app.dispose(); }
});

it("删除确认取消不改变任务或关闭面板，确认只删除选中任务", async () => {
  const { app, workspace } = createAppTestWorkspace();
  const planner = createBlueprintPlannerHost(workspace);
  await planner.whenSettled();
  const controller = app.blueprintPlannerDialog;
  controller.open((plant.request as BlueprintPlannerRequest).plan);
  const first = await planner.actions.importTask(planner.queries.exportDraft(controller.getRequest()));
  const other = await planner.actions.importTask(planner.queries.exportDraft(controller.getRequest()));
  controller.selectTask(first, planner.queries.getLastRequest(first) ?? undefined);
  const view = await mountTestComponent(<BlueprintPlannerDialog appHost={app} />);
  try {
    await clickTestElement(buttonWithText(view.container, "删除任务"));
    const confirmation = document.querySelector('[data-dialog-key="eda-delete-task"]')!;
    expect(confirmation.textContent).toContain("删除后不可恢复");
    await clickTestElement(buttonWithText(confirmation, "取消"));
    expect(controller.dialogState.visible).toBe(true);
    expect(controller.viewTaskId).toBe(first);
    expect(planner.queries.listTasks()).toHaveLength(2);
    await clickTestElement(buttonWithText(view.container, "删除任务"));
    await clickTestElement(buttonWithText(document.querySelector('[data-dialog-key="eda-delete-task"]')!, "删除任务"));
    await planner.whenSettled();
    await settleTestDom();
    expect(planner.queries.getTask(first)).toBeNull();
    expect(planner.queries.getTask(other)).not.toBeNull();
    expect(controller.dialogState.visible).toBe(true);
  } finally { await view.unmount(); planner.dispose(); app.dispose(); }
});
