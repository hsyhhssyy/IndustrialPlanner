import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { BlueprintPlannerDialog } from "@/app/shell/blueprint-planner-dialog";
import { createBlueprintPlannerHost } from "@/blueprint-planner/blueprint-planner-host";
import type { BlueprintPlannerRequest } from "@/domain/blueprint-planner";
import { createAppTestWorkspace } from "../helpers/app-test-workspace";
import { buttonWithText, changeTestValue, mountTestComponent, selectWithLabel, settleTestDom } from "../helpers/react-test-dom";
import { createFakeIndexedDbFactory } from "../shared/fake-indexed-db";
import separator from "../blueprint-planner/fixtures/separator-core.json";
import converter from "../blueprint-planner/fixtures/converter-startup-liquid.json";

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
