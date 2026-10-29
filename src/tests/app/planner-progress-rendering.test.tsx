import { runInAction } from "mobx";
import { act, useState } from "react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { createAppHost } from "@/app/host/app-host";
import { PlannerTaskFlow } from "@/app/shell/production-planning/planner-task-flow";
import { BlueprintPlannerItemPolicies } from "@/app/shell/blueprint-planner-item-policies";
import { PlannerBatchSession } from "@/scripts/eda/planner-runner";
import { PlannerSupplyRules } from "@/shared/planner-supply";
import type { BlueprintPlannerProductionPlan } from "@/domain/blueprint-planner";
import fixture from "../blueprint-planner/fixtures/yazhen-syringe.json";
import { buttonWithText, clickTestElement, mountTestComponent, settleTestDom } from "../helpers/react-test-dom";

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  // 普通 DOM 响应式验证；真实布局与视口适配单独由浏览器检查。
  vi.stubGlobal("ResizeObserver", class { observe() {} unobserve() {} disconnect() {} });
});
afterEach(() => { localStorage.clear(); vi.unstubAllGlobals(); });

it("进度刷新跳过静态流程和物料表，稳定翻译函数仍响应语言及配置变化", async () => {
  const session = new PlannerBatchSession(), app = createAppHost(session.workspace);
  const controller = app.blueprintPlannerDialog;
  await controller.open(fixture.request.plan as BlueprintPlannerProductionPlan);
  const plan = controller.plan!, registry = session.workspace.registry;
  const environment = new PlannerSupplyRules(registry, plan).view();
  // 包装真实翻译只计数，不替换其 MobX locale 读取或翻译行为。
  const translate = vi.fn(app.actions.translate);
  function Panels() {
    const [progress, setProgress] = useState(0);
    return <><button onClick={() => setProgress(progress + 1)}>progress {progress}</button>
      <PlannerTaskFlow plan={plan} registry={registry} t={translate} />
      <BlueprintPlannerItemPolicies plan={plan} registry={registry} environment={environment}
        options={controller.options} disabled={false} onChange={controller.updateItemPolicy} t={translate} />
    </>;
  }
  let view: Awaited<ReturnType<typeof mountTestComponent>> | undefined;
  try {
    view = await mountTestComponent(<Panels />); await settleTestDom();
    const original = view.container.textContent;
    expect(view.container.querySelectorAll('input[type="radio"]').length).toBeGreaterThan(0);
    translate.mockClear();
    await clickTestElement(buttonWithText(view.container, "progress 0"));
    expect(translate).not.toHaveBeenCalled();
    await act(async () => { app.internalActions.setLocale("en-US"); });
    expect(translate).toHaveBeenCalled();
    expect(view.container.textContent).not.toBe(original);
    expect(view.container.querySelector('section')?.getAttribute('aria-label')).toBe(app.actions.translate("eda.itemLogistics"));
    // 更新既有可观察对象，验证 observer 不仅依靠 props 引用变化。
    // AI-CORRECTION 2026-10-13：options 为只读契约；通过真实控制器替换配置，再由父组件传入。
    await act(async () => { runInAction(() => { controller.updateOptions({ solidSupply: "external" }); }); });
    await clickTestElement(buttonWithText(view.container, "progress 1"));
    expect([...view.container.querySelectorAll<HTMLInputElement>('input[type="radio"]:checked')].some(radio => radio.value === "external")).toBe(true);
  } finally { await view?.unmount(); app.dispose(); await session.dispose(); }
});
