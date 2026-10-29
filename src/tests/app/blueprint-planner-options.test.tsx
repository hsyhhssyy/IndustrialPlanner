import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { act } from "react";
import { BlueprintPlannerDialog } from "@/app/shell/blueprint-planner-dialog";
import { createBlueprintPlannerHost } from "@/blueprint-planner/blueprint-planner-host";
import type { BlueprintPlannerRequest } from "@/domain/blueprint-planner";
import { createAppTestWorkspace } from "../helpers/app-test-workspace";
import { buttonWithText, changeTestValue, clickTestElement, mountTestComponent, radioWithLabel, settleTestDom } from "../helpers/react-test-dom";
import { createFakeIndexedDbFactory } from "../shared/fake-indexed-db";
import separator from "../blueprint-planner/fixtures/separator-core.json";
import converter from "../blueprint-planner/fixtures/converter-startup-liquid.json";
import plant from "../blueprint-planner/fixtures/plant-preload.json";
import environment from "../blueprint-planner/fixtures/environment-supply.json";
import itemPolicies from "../blueprint-planner/fixtures/pyrrolite-ore.json";
import type { BlueprintPlannerProductionPlan } from "@/domain/blueprint-planner";
import { buildPlannerTaskFlow } from "@/app/shell/production-planning/planner-task-flow";
import { createSimulationHost } from "@/simulation/simulation-host";

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

it("任务标题原位编辑并同步历史，空白恢复自动命名，新草稿恢复展开", async () => {
  const { app, workspace } = createAppTestWorkspace();
  const planner = createBlueprintPlannerHost(workspace, { storage: null });
  const controller = app.blueprintPlannerDialog;
  await controller.open((separator.request as BlueprintPlannerRequest).plan);
  const view = await mountTestComponent(<BlueprintPlannerDialog appHost={app} />);
  try {
    expect(view.container.querySelector('aside[aria-label="任务列表"]')).not.toBeNull();
    expect(controller.viewTaskId).not.toBeNull();
    expect(planner.queries.listTasks()).toHaveLength(1);
    expect(planner.queries.getTask(controller.viewTaskId!)?.planningStarted).toBe(false);
    expect(view.container.querySelector('[class*="taskList"] [class*="taskStatus"]')?.textContent).toBe("未启动");
    const edit = () => view.container.querySelector<HTMLButtonElement>('button[aria-label="编辑任务标题"]')!;
    await clickTestElement(edit());
    const input = view.container.querySelector<HTMLInputElement>('input[aria-label="任务标题"]')!;
    await changeTestValue(input, "  自定义任务标题  ");
    await clickTestElement(view.container.querySelector<HTMLButtonElement>('button[aria-label="确认"]')!);
    expect(controller.taskTitle).toBe("自定义任务标题");
    expect(edit().parentElement!.querySelector('h2')?.textContent).toBe("自定义任务标题");
    const id = await planner.actions.importTask({ ...planner.queries.exportDraft(controller.getRequest()), title: controller.taskTitle! });
    await act(async () => { controller.selectTask(id, planner.queries.getLastRequest(id) ?? undefined); });
    expect(view.container.querySelector('[class*="taskList"] strong')?.textContent).toBe("自定义任务标题");
    await clickTestElement(edit());
    const renamed = view.container.querySelector<HTMLInputElement>('input[aria-label="任务标题"]')!;
    await changeTestValue(renamed, "取消的标题");
    await act(async () => { renamed.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })); });
    expect(planner.queries.getTaskTitle(id)).toBe("自定义任务标题");
    expect(controller.dialogState.visible).toBe(true);
    await act(async () => { await controller.renameTask(""); });
    expect(edit().parentElement!.querySelector('h2')?.textContent).not.toBe("自定义任务标题");
    view.container.querySelector('details')!.open = false;
    await act(async () => { await controller.open((separator.request as BlueprintPlannerRequest).plan); });
    expect(view.container.querySelector('details')?.open).toBe(true);
    expect(controller.taskTitle).toBeNull();
  } finally { await view.unmount(); planner.dispose(); app.dispose(); }
});

it("重复进入各建一条未启动任务，普通重开不重复创建，切换后恢复已编辑配置", async () => {
  const { app, workspace } = createAppTestWorkspace();
  const planner = createBlueprintPlannerHost(workspace, { storage: null });
  const controller = app.blueprintPlannerDialog;
  try {
    await Promise.all([
      controller.open({ ...(separator.request as BlueprintPlannerRequest).plan, name: "任务 A" }),
      controller.open({ ...(plant.request as BlueprintPlannerRequest).plan, name: "任务 B" }),
    ]);
    const id = controller.viewTaskId!;
    expect(planner.queries.listTasks()).toHaveLength(2);
    expect((planner.queries.getLastRequest(id) as BlueprintPlannerRequest).plan.name).toBe("任务 B");
    expect(planner.state.activeTaskId).toBeNull();
    controller.updateOptions({ evaluationsPerRound: 0, warehouseBus: "corner" });
    controller.updateItemPolicy({ itemId: "item_plant_moss_3", output: "warehouse" });
    await vi.waitFor(() => expect(planner.queries.getLastRequest(id)?.options).toMatchObject({ evaluationsPerRound: 0,
      itemPolicies: [{ itemId: "item_plant_moss_3", output: "warehouse" }] }));
    const other = planner.queries.listTasks().find(task => task.taskId !== id)!.taskId;
    controller.selectTask(other, planner.queries.getLastRequest(other) ?? undefined);
    controller.selectTask(id, planner.queries.getLastRequest(id) ?? undefined);
    expect(controller.options).toMatchObject({ evaluationsPerRound: 0, warehouseBus: "corner",
      itemPolicies: [{ itemId: "item_plant_moss_3", output: "warehouse" }] });
    controller.close(); await controller.open();
    expect(planner.queries.listTasks()).toHaveLength(2);
    expect(controller.viewTaskId).toBe(id);
  } finally { planner.dispose(); app.dispose(); }
});

it("副产物处理同步上方状态，隐藏失效去向并保留外接选择，任务可导出恢复", async () => {
  const { app, workspace } = createAppTestWorkspace();
  const simulation = createSimulationHost(workspace, { engineKind: "dense-v2", workerMode: "runtime", blueprintDenseTickRate: 2 });
  const planner = createBlueprintPlannerHost(workspace);
  const recipe = workspace.registry.queries.findRecipeDefinition("r_chrono_liquid_furnace_refined_copper_from_copper_ore_basic")!;
  const plan: BlueprintPlannerProductionPlan = {
    ...(separator.request as BlueprintPlannerRequest).plan,
    targets: [{ itemId: "item_copper_nugget", perMinute: 30 }],
    externalSupplies: recipe.inputs.map(flow => ({ itemId: flow.itemId, perMinute: flow.amount * 30 })),
    recipes: [{ recipeId: recipe.id, deviceCount: 1, cyclesPerMinute: 30, runningInputs: [],
      inputs: recipe.inputs.map(flow => ({ itemId: flow.itemId, perMinute: flow.amount * 30 })),
      outputs: recipe.outputs.map(flow => ({ itemId: flow.itemId, perMinute: flow.amount * 30 })),
    }], byproductItemIds: ["item_liquid_sewage"],
  };
  const controller = app.blueprintPlannerDialog;
  await controller.open(plan);
  const queued = controller.viewTaskId!;
  const view = await mountTestComponent(<BlueprintPlannerDialog appHost={app} />);
  const summary = () => view.container.querySelector('[aria-label="副产物"]')?.textContent;
  try {
    expect(summary()).toContain("已由下方「副产物处理」设置接管：就地处理");
    expect(view.container.querySelector('[role="radiogroup"][aria-label="污水 · 产物去向"]')).toBeNull();
    await clickTestElement(radioWithLabel(view.container, "污水 · 副产物处理", "output"));
    expect(radioWithLabel(view.container, "污水 · 产物去向", "conduit").checked).toBe(true);
    await clickTestElement(radioWithLabel(view.container, "污水 · 产物去向", "external"));
    expect(summary()).toContain("管道外接");
    await clickTestElement(radioWithLabel(view.container, "污水 · 副产物处理", "destroy"));
    expect(summary()).toContain("已由下方「副产物处理」设置接管");
    expect(controller.options.itemPolicies?.find(policy => policy.itemId === "item_liquid_sewage")?.output).toBe("external");
    await clickTestElement(radioWithLabel(view.container, "污水 · 副产物处理", "output"));
    expect(radioWithLabel(view.container, "污水 · 产物去向", "external").checked).toBe(true);
    const id = await planner.actions.importTask(planner.queries.exportDraft(controller.getRequest()));
    expect(planner.queries.getLastRequest(id)?.options.itemPolicies?.find(policy => policy.itemId === "item_liquid_sewage"))
      .toMatchObject({ output: "external", byproducts: "output" });
    controller.updateOptions({ evaluationsPerRound: 10_000, concurrency: 1, gpu: false });
    await clickTestElement(buttonWithText(view.container, "开始规划"));
    const started = controller.viewTaskId!;
    expect(started).toBe(queued);
    expect(planner.queries.getLastRequest(started)?.options.itemPolicies?.find(policy => policy.itemId === "item_liquid_sewage"))
      .toMatchObject({ output: "external", byproducts: "output" });
    planner.actions.cancel(started);
    await planner.whenSettled();
    const disposal = workspace.registry.queries.findRecipeDefinition("r_chrono_wastewater_treatment_void_wastewater_basic")!;
    const graph = buildPlannerTaskFlow({ ...plan, recipes: [...plan.recipes, {
      recipeId: disposal.id, deviceCount: 1, cyclesPerMinute: 30, inputs: [{ itemId: "item_liquid_sewage", perMinute: 30 }],
      outputs: [], runningInputs: [],
    }] }, workspace.registry, app.actions.translate, controller.options);
    expect(graph.nodes.find(node => node.tone === "byproduct" && node.itemId === "item_liquid_sewage")?.subtitle).toContain("管道外接");
    expect(graph.nodes.some(node => node.recipeId === disposal.id)).toBe(false);
  } finally { await view.unmount(); planner.dispose(); simulation.dispose(); app.dispose(); }
});
afterEach(() => { localStorage.clear(); vi.unstubAllGlobals(); });

it("存取线选择随任务恢复，新草稿不读取或覆盖旧全局偏好", async () => {
  const { app, workspace } = createAppTestWorkspace();
  let planner = createBlueprintPlannerHost(workspace);
  const controller = app.blueprintPlannerDialog;
  await controller.open((separator.request as BlueprintPlannerRequest).plan);
  let view = await mountTestComponent(<BlueprintPlannerDialog appHost={app} />);
  try {
    const field = (value?: string) => radioWithLabel(view.container, "存取线形态", value);
    expect(field().value).toBe("straight");
    expect([...field().closest('[role="radiogroup"]')!.querySelectorAll('label > span')].map(option => option.textContent)).toEqual(["直线存取线", "直角存取线", "U型存取线"]);
    await clickTestElement(field("corner"));
    expect(controller.getRequest().options.warehouseBus).toBe("corner");
    await clickTestElement(field("u-shaped"));
    const id = await planner.actions.importTask(planner.queries.exportDraft(controller.getRequest()));
    expect(localStorage.getItem("industrial-planner.eda.options")).toBeNull();
    await view.unmount();
    planner.dispose();
    planner = createBlueprintPlannerHost(workspace);
    await planner.whenSettled();
    await controller.open((separator.request as BlueprintPlannerRequest).plan);
    view = await mountTestComponent(<BlueprintPlannerDialog appHost={app} />);
    expect(radioWithLabel(view.container, "存取线形态").value).toBe("straight");
    controller.selectTask(id, planner.queries.getLastRequest(id) ?? undefined);
    await settleTestDom();
    expect(radioWithLabel(view.container, "存取线形态").value).toBe("u-shaped");
    localStorage.setItem("industrial-planner.eda.options", JSON.stringify({ warehouseBus: "free" }));
    await controller.open((separator.request as BlueprintPlannerRequest).plan);
    await settleTestDom();
    await clickTestElement(radioWithLabel(view.container, "存取线形态", "corner"));
    expect(JSON.parse(localStorage.getItem("industrial-planner.eda.options")!)).toEqual({ warehouseBus: "free" });
  } finally { await view.unmount(); planner.dispose(); app.dispose(); }
});

it("转换器默认拒绝自循环，手工或储罐启动解除阻断并随任务恢复", async () => {
  const { app, workspace } = createAppTestWorkspace();
  let planner = createBlueprintPlannerHost(workspace);
  const request = converter as BlueprintPlannerRequest;
  const controller = app.blueprintPlannerDialog;
  await controller.open(request.plan);
  for (const policy of request.plan.supplyPolicies ?? []) controller.updateSupplyPolicy(policy);
  let view = await mountTestComponent(<BlueprintPlannerDialog appHost={app} />);
  try {
    const field = (value?: string) => radioWithLabel(view.container, "固液气转换器启动", value);
    const warning = "液化息壤 自循环 需要外部启动器启动，请调整启动设置。";
    expect(field().value).toBe("reject");
    expect(view.container.textContent).toContain(warning);
    expect(buttonWithText(view.container, "开始规划").disabled).toBe(true);
    let id = "";
    for (const mode of ["manual", "tank"]) {
      await clickTestElement(field(mode));
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
    await controller.open(request.plan);
    view = await mountTestComponent(<BlueprintPlannerDialog appHost={app} />);
    expect(radioWithLabel(view.container, "固液气转换器启动").value).toBe("reject");
    controller.selectTask(id, planner.queries.getLastRequest(id) ?? undefined);
    await settleTestDom();
    expect(radioWithLabel(view.container, "固液气转换器启动").value).toBe("tank");
  } finally { await view.unmount(); planner.dispose(); app.dispose(); }
});


it("产线选项按布局、启动和计算分组，CPU/GPU switch 独立且随任务恢复", async () => {
  const { app, workspace } = createAppTestWorkspace();
  const planner = createBlueprintPlannerHost(workspace);
  const controller = app.blueprintPlannerDialog;
  await controller.open((separator.request as BlueprintPlannerRequest).plan);
  const view = await mountTestComponent(<BlueprintPlannerDialog appHost={app} />);
  try {
    const groups = [...view.container.querySelectorAll('fieldset')].filter(group => group.querySelector('legend'));
    expect(groups.map(group => group.querySelector('legend')?.textContent)).toEqual(["布局规则", "启动方式", "计算设置"]);
    expect(view.container.querySelectorAll("select")).toHaveLength(0);
    expect([...groups[0]!.querySelectorAll('[role="radiogroup"]')].map(group => group.getAttribute('aria-label'))).toEqual(["取货口摆放规则", "存取线形态"]);
    expect([...groups[1]!.querySelectorAll('[role="radiogroup"]')].map(group => group.getAttribute('aria-label'))).toEqual(["植物循环启动", "固液气转换器启动"]);
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
    await controller.open((separator.request as BlueprintPlannerRequest).plan);
    controller.selectTask(id, planner.queries.getLastRequest(id) ?? undefined);
    await settleTestDom();
    expect(controller.options).toMatchObject({ concurrency: "auto", gpu: false });
    expect(cpu!.checked).toBe(true);
    expect(gpu!.checked).toBe(false);
    // AI-CORRECTION 2026-10-29：进入即创建后，存在 ID 不代表已启动；布局在首次启动前仍可编辑。
    expect(radioWithLabel(view.container, "存取线形态").disabled).toBe(false);
    expect(cpu!.disabled || gpu!.disabled).toBe(false);
  } finally { await view.unmount(); planner.dispose(); app.dispose(); }
});

it("取货口规则默认连续，单面强制直线并阻断非法固体外供，恢复后解锁", async () => {
  const { app, workspace } = createAppTestWorkspace();
  const planner = createBlueprintPlannerHost(workspace);
  const controller = app.blueprintPlannerDialog;
  await controller.open((separator.request as BlueprintPlannerRequest).plan);
  const view = await mountTestComponent(<BlueprintPlannerDialog appHost={app} />);
  try {
    const rule = (value?: string) => radioWithLabel(view.container, "取货口摆放规则", value);
    const bus = (value?: string) => radioWithLabel(view.container, "存取线形态", value);
    expect(rule().value).toBe("continuous");
    await clickTestElement(bus("corner"));
    await clickTestElement(rule("full-side"));
    expect(bus().value).toBe("straight");
    expect(bus().disabled).toBe(true);
    const supply = [...view.container.querySelectorAll('[role="radiogroup"]')]
      .find(field => field.querySelector('input[value="external"]'))!;
    expect(supply).toBeDefined();
    await clickTestElement(supply.querySelector<HTMLInputElement>('input[value="external"]')!);
    expect(supply.getAttribute("aria-invalid")).toBe("true");
    expect(buttonWithText(view.container, "开始规划").disabled).toBe(true);
    expect(controller.getRequest().options).toMatchObject({ warehousePortPlacement: "full-side", warehouseBus: "straight" });
    expect(controller.getRequest().options.itemPolicies?.some(policy => policy.supply === "external")).toBe(true);
    await clickTestElement(supply.querySelector<HTMLInputElement>('input[value="warehouse"]')!);
    expect(supply.getAttribute("aria-invalid")).not.toBe("true");
    expect(buttonWithText(view.container, "开始规划").disabled).toBe(false);
    await clickTestElement(rule("continuous"));
    expect(bus().disabled).toBe(false);
  } finally { await view.unmount(); planner.dispose(); app.dispose(); }
});

it("新草稿忽略旧全局预算；清空与逐位输入有效，复制保留历史和原配置", async () => {
  localStorage.setItem("industrial-planner.eda.options", JSON.stringify({ evaluationsPerRound: 70_000, concurrency: 1 }));
  const { app, workspace } = createAppTestWorkspace();
  const planner = createBlueprintPlannerHost(workspace);
  const controller = app.blueprintPlannerDialog;
  await controller.open((plant.request as BlueprintPlannerRequest).plan);
  const view = await mountTestComponent(<BlueprintPlannerDialog appHost={app} />);
  try {
    const budget = view.container.querySelector<HTMLInputElement>('input[type="number"]')!;
    const defaults = structuredClone(controller.getRequest().options);
    expect(budget.value).toBe("5000");
    expect(defaults).toMatchObject({ evaluationsPerRound: 50_000_000, concurrency: "auto", gpu: true,
      warehouseBus: "straight", plantStartup: "preload", itemPolicies: [] });
    const warning = () => view.container.querySelector('#eda-low-budget-warning');
    expect(warning()).toBeNull();
    await changeTestValue(budget, "4999");
    expect(warning()?.textContent?.trim()).toBe("您提供的搜寻预算较少,可能会导致部分布局无法被搜索到.推荐至少提供五千万次预算.");
    expect(budget.getAttribute("aria-describedby")).toBe("eda-low-budget-warning");
    expect(buttonWithText(view.container, "开始规划").disabled).toBe(false);
    for (const value of ["5000", "5001"]) {
      await changeTestValue(budget, value);
      expect(warning()).toBeNull();
      expect(budget.hasAttribute("aria-describedby")).toBe(false);
    }
    expect(view.container.querySelectorAll('[role="radiogroup"][aria-label$=" · 外部接入"]')).toHaveLength(0);
    const outputs = [...view.container.querySelectorAll('[role="radiogroup"][aria-label$=" · 产物去向"] input:checked')];
    expect(outputs.length).toBeGreaterThan(0);
    // AI-REMOVED 2026-10-29: 流体新增可选去向，缺省为 conduit；旧断言仅覆盖固体。Risk: Low；Human Review: Required
    // Original code: expect(outputs.every(field => (field as HTMLInputElement).value === "auto")).toBe(true);
    expect(outputs.every(field => ["auto", "conduit"].includes((field as HTMLInputElement).value))).toBe(true);
    expect([...view.container.querySelectorAll<HTMLInputElement>('[role="radiogroup"][aria-label$=" · 副产物处理"] input:checked')]
      .every(field => field.value === "destroy")).toBe(true);
    await changeTestValue(budget, "");
    budget.blur();
    await settleTestDom();
    expect(budget.value).toBe("");
    expect(warning()).toBeNull();
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
    await controller.saveProductionTask();
    const id = controller.viewTaskId!;
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

it("物品物流分段单选各组独立，切换产物、副产物和接入方式保留其他规则", async () => {
  const { app, workspace } = createAppTestWorkspace();
  const planner = createBlueprintPlannerHost(workspace);
  const controller = app.blueprintPlannerDialog;
  const plan = (itemPolicies.request as BlueprintPlannerRequest).plan;
  await controller.open(plan);
  const view = await mountTestComponent(<BlueprintPlannerDialog appHost={app} />);
  try {
    const groups = [...view.container.querySelectorAll('[role="radiogroup"]')];
    const names = groups.map(group => group.querySelector<HTMLInputElement>('input')!.name);
    expect(new Set(names).size).toBe(groups.length);
    expect(groups.every(group => group.querySelectorAll('input:checked').length === 1)).toBe(true);
    const output = groups.find(group => group.getAttribute("aria-label")?.endsWith(" · 产物去向")
      && group.querySelectorAll('input').length === 3)!;
    expect([...output.querySelectorAll('input')].map(input => input.value)).toEqual(["auto", "warehouse", "stash"]);
    for (const value of ["warehouse", "stash", "auto"]) {
      await clickTestElement(output.querySelector<HTMLInputElement>(`input[value="${value}"]`)!);
      expect(output.querySelector<HTMLInputElement>('input:checked')!.value).toBe(value);
      expect(controller.options.itemPolicies?.find(policy => policy.itemId === plan.targets[0]!.itemId)?.output).toBe(value);
    }
    const outputPolicies = structuredClone(controller.getRequest().options.itemPolicies);
    const byproducts = groups.find(group => group.getAttribute("aria-label")?.endsWith(" · 副产物处理"))!;
    expect([...byproducts.querySelectorAll('input')].map(input => input.value)).toEqual(["destroy", "output"]);
    await clickTestElement(byproducts.querySelector<HTMLInputElement>('input[value="output"]')!);
    expect(controller.options.itemPolicies?.some(policy => policy.byproducts === "output")).toBe(true);
    const supply = groups.find(group => group.getAttribute("aria-label")?.endsWith(" · 外部接入"))!;
    expect(supply.querySelectorAll('input')).toHaveLength(2);
    await clickTestElement(supply.querySelector<HTMLInputElement>('input[value="external"]')!);
    expect(controller.options.itemPolicies?.some(policy => policy.supply === "external")).toBe(true);
    expect(controller.options.itemPolicies).toEqual(expect.arrayContaining([...outputPolicies!]));
    expect(byproducts.querySelector<HTMLInputElement>('input[value="output"]')!.checked).toBe(true);
    expect(groups.every(group => group.querySelectorAll('input:checked').length === 1)).toBe(true);
    expect(view.container.querySelectorAll('[aria-label="物品物流"] select')).toHaveLength(0);
  } finally { await view.unmount(); planner.dispose(); app.dispose(); }
});

it("环境树展开与供料来源联动，逐物品规则随草稿恢复，复制不覆盖原任务", async () => {
  const { app, workspace } = createAppTestWorkspace();
  let planner = createBlueprintPlannerHost(workspace);
  const controller = app.blueprintPlannerDialog;
  const plan = environment.plan as BlueprintPlannerProductionPlan;
  await controller.open(plan);
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
    const supply = radioWithLabel(view.container, "酸气 · 外部接入", "external");
    await clickTestElement(supply);
    expect(controller.options.itemPolicies?.find(policy => policy.itemId === "item_gas_acid")?.supply).toBe("external");
    await clickTestElement(radioWithLabel(view.container, "酸气 · 外部接入", "conduit"));
    expect(tree.textContent).not.toContain("registry.recipe.");
    const file = planner.queries.exportDraft(controller.getRequest());
    expect(controller.viewTaskId).not.toBeNull();
    expect(planner.queries.listTasks()).toHaveLength(1);
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
    // AI-CORRECTION 2026-10-29：已入列表但未启动的任务仍允许编辑供料参数。
    expect(radioWithLabel(view.container, "酸气 · 外部接入", "conduit").matches(":disabled")).toBe(false);
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
    // AI-CORRECTION 2026-10-29：未启动副本可以编辑；下方新建仍创建独立任务并恢复默认选项。
    await controller.open(plan);
    await settleTestDom();
    await clickTestElement(buttonWithText(tree, "外部供给"));
    expect(radioWithLabel(view.container, "酸气 · 外部接入", "conduit").checked).toBe(true);
    expect(radioWithLabel(view.container, "酸气 · 外部接入", "conduit").matches(":disabled")).toBe(false);
    await clickTestElement(buttonWithText(tree, "内部生产"));
    expect(view.container.querySelector('[role="radiogroup"][aria-label="酸气 · 外部接入"]')).toBeNull();
    expect(planner.queries.listTasks()).toHaveLength(4);
  } finally { await view.unmount(); planner.dispose(); app.dispose(); }
});

it("删除确认取消不改变任务或关闭面板，确认只删除选中任务", async () => {
  const { app, workspace } = createAppTestWorkspace();
  const planner = createBlueprintPlannerHost(workspace);
  await planner.whenSettled();
  const controller = app.blueprintPlannerDialog;
  await controller.open((plant.request as BlueprintPlannerRequest).plan);
  const first = controller.viewTaskId!;
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

// AI-REMOVED 2026-10-25:
// Reason: 单选测试定位扩展为页面通用测试辅助函数。
// Trigger: 所有布局与启动下拉框改为单选组。
// Evidence: options 与 optimization 测试均需按组名定位选项。
// Replacement: helpers/react-test-dom.ts radioWithLabel。
// Risk: Low。Human Review: Required
// Original code:
// function policyChoice(container: ParentNode, label: string, value: string): HTMLInputElement {
//   const group = [...container.querySelectorAll('[role="radiogroup"]')].find(element => element.getAttribute("aria-label") === label);
//   const choice = group?.querySelector<HTMLInputElement>(`input[value="${value}"]`);
//   if (!choice) throw new Error(`未找到物品规则：${label} · ${value}`);
//   return choice;
// }

it("EDA 算法测试入口与面板跟随调试模式，关闭后不残留入口或面板", async () => {
  const { app, workspace } = createAppTestWorkspace();
  const planner = createBlueprintPlannerHost(workspace);
  await app.blueprintPlannerDialog.open((separator.request as BlueprintPlannerRequest).plan);
  const view = await mountTestComponent(<BlueprintPlannerDialog appHost={app} />);
  try {
    expect(view.container.querySelector('[data-testid="eda-regression-open"]')).toBeNull();
    await act(async () => { app.internalState.settings.debugMode = true; });
    await clickTestElement(view.container.querySelector<HTMLButtonElement>('[data-testid="eda-regression-open"]')!);
    expect(document.querySelector('[data-dialog-key="eda-regression"]')).not.toBeNull();
    await act(async () => { app.internalState.settings.debugMode = false; });
    expect(view.container.querySelector('[data-testid="eda-regression-open"]')).toBeNull();
    expect(document.querySelector('[data-dialog-key="eda-regression"]')).toBeNull();
    await act(async () => { app.internalState.settings.debugMode = true; });
    expect(document.querySelector('[data-dialog-key="eda-regression"]')).toBeNull();
  } finally { await view.unmount(); planner.dispose(); app.dispose(); }
});
