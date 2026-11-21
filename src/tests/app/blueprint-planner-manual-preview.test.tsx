import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { act } from "react";
import { BlueprintPlannerBoundary } from "@/app/shell/blueprint-planner-boundary";
import { BlueprintPlannerManualOptions } from "@/app/shell/blueprint-planner-manual";
import { createBlueprintPlannerHost } from "@/blueprint-planner/blueprint-planner-host";
import type { BlueprintPlannerRequest } from "@/domain/blueprint-planner";
import { createAppTestWorkspace } from "../helpers/app-test-workspace";
import { changeTestValue, clickTestElement, mountTestComponent, radioWithLabel } from "../helpers/react-test-dom";
import separator from "../blueprint-planner/fixtures/separator-core.json";

beforeEach(() => vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true));
afterEach(() => vi.unstubAllGlobals());

it("人工预览覆盖关闭、相对两种和绝对三种侧边，精确与最大不混淆且只读", async () => {
  const { app, workspace } = createAppTestWorkspace();
  const planner = createBlueprintPlannerHost(workspace, { storage: null });
  const c = app.blueprintPlannerDialog;
  await c.open((separator.request as BlueprintPlannerRequest).plan);
  const view = await mountTestComponent(<BlueprintPlannerManualOptions appHost={app} disabled={false} />);
  const preview = () => view.container.querySelector('[data-manual-preview]');
  const update = async (fn: () => void) => { await act(async () => { fn(); }); };
  const assertReadonly = async () => {
    const before = JSON.stringify(c.getRequest());
    await update(() => app.internalActions.setLocale("en-US"));
    expect(view.container.textContent).not.toContain("eda.manual.preview.");
    expect(view.container.textContent).toContain("Device binding");
    await update(() => app.internalActions.setLocale("zh-CN"));
    expect(JSON.stringify(c.getRequest())).toBe(before);
    expect(preview()?.querySelector('input,button,select')).toBeNull();
  };
  try {
    // AI-CORRECTION 2026-11-21: 关闭说明新增遵守布局尺寸，保留自动摆放行为断言。
    // Original code: expect(view.container.textContent).toContain("由规划器自动摆放全部设备");
    expect(view.container.textContent).toContain("规划器遵守布局尺寸设置，自动摆放全部设备");
    expect(preview()).toBeNull();
    await update(() => c.manual.setEnabled(true));
    await update(() => c.manual.setOrientation("free"));
    expect(preview()?.getAttribute('data-manual-preview')).toBe("relative-free");
    expect(preview()?.textContent).toContain("整组可以平移、旋转");
    await update(() => c.manual.setOrientation("fixed"));
    expect(preview()?.getAttribute('data-manual-preview')).toBe("relative-fixed");
    expect(preview()?.textContent).toContain("当前朝向");
    await update(() => c.manual.setPositioningMode("absolute"));
    expect(preview()?.getAttribute('data-manual-preview')).toBe("absolute-none");
    expect(preview()?.textContent).toContain("3 格净距");
    expect(preview()?.querySelector('[data-preview-grid]')?.getAttribute("data-preview-grid")).toBe("10");
    const grid = preview()!.querySelector('pattern')!;
    const devices = [...preview()!.querySelectorAll('svg > rect')].filter(rect => rect.getAttribute("height") === "30");
    expect(devices).toHaveLength(2);
    for (const device of devices) expect((129 - Number(device.getAttribute("y")) - Number(device.getAttribute("height"))) / Number(grid.getAttribute("height"))).toBe(3);
    expect(preview()?.querySelector('[data-preview-motion="parallel"]')).not.toBeNull();
    expect(preview()?.querySelectorAll('[data-preview-boundary]')).toHaveLength(1);
    await update(() => c.manual.setBoundarySideMode("single"));
    expect(preview()?.getAttribute('data-manual-preview')).toBe("absolute-single");
    expect(preview()?.querySelectorAll('[data-preview-boundary]')).toHaveLength(2);
    await update(() => c.updateOptions({ dimensionLimits: { exactBaseLength: 24 } }));
    expect(preview()?.querySelector('[data-preview-boundary="right"][data-derived="true"]')).not.toBeNull();
    expect(preview()?.querySelector("[data-preview-dimensions]")?.textContent).toContain("24");
    await update(() => c.manual.setBoundarySideMode("both"));
    expect(preview()?.getAttribute('data-manual-preview')).toBe("absolute-both");
    expect(preview()?.querySelectorAll('[data-preview-boundary]')).toHaveLength(3);
    await update(() => { c.manual.setBoundarySideMode("single"); c.updateOptions({ dimensionLimits: { maxBaseLength: 24, exactSideLength: 12 } }); });
    expect(preview()?.querySelector('[data-preview-boundary="top"][data-derived="true"]')).not.toBeNull();
    expect(preview()?.textContent).toContain("固定顶边");
    await update(() => c.updateOptions({ dimensionLimits: { maxBaseLength: 24, maxSideLength: 12 } }));
    expect(preview()?.querySelector('[data-preview-boundary="top"]')).toBeNull();
    expect(preview()?.textContent).toContain("最大值仅限制最终布局尺寸");
    await assertReadonly();
    for (const [mode, text] of [["recipe", "按生产配方绑定"], ["topology", "按拓扑关系绑定"]] as const) {
      await update(() => c.manual.setMode(mode));
      expect(preview()?.textContent).toContain(text);
    }
    await clickTestElement(radioWithLabel(view.container, "整体朝向", "free"));
    expect(c.manual.layout?.boundary.position).toBeNull();
    expect(preview()?.getAttribute('data-manual-preview')).toBe("relative-free");
  } finally { await view.unmount(); planner.dispose(); app.dispose(); }
});


// AI-REMOVED 2026-11-21:
// Reason: 第二步按用户订正改为可选单图，移除共转双帧与实际Canvas。
// Trigger: 第二/三步方向理解不一致。Evidence: 新固定屏幕边示意职责。
// Replacement: 下方三线形四向交互回归。Risk: Low。Human Review: Required
// Original code:
// it("方向自动不画固定边，手选相对方向与设备共转，固定朝向恢复世界方向且预览不提交", async () => {
//   const { app, workspace } = createAppTestWorkspace();
//   const planner = createBlueprintPlannerHost(workspace, { storage: null });
//   const c = app.blueprintPlannerDialog;
//   await c.open((separator.request as BlueprintPlannerRequest).plan);
//   c.manual.setEnabled(true); c.manual.setOrientation("free"); c.manual.setBoundaryRotation(null);
//   await c.manual.prepare(c.getRequest());
//   const view = await mountTestComponent(<BlueprintPlannerBoundary appHost={app} request={c.getRequest()} disabled={false} />);
//   try {
//     const root = () => view.container.querySelector('[data-relative-direction-preview]')!;
//     expect(root().getAttribute("data-automatic")).toBe("true");
//     expect(root().querySelector('[data-base-direction]')).toBeNull();
//     expect(root().textContent).toContain("EDA 自动选择");
//     await clickTestElement(radioWithLabel(view.container, "存取线相对设备组的位置", "0"));
//     expect(c.manual.layout?.boundary.rotation).toBe(0);
//     const before = JSON.stringify(c.getRequest());
//     const groups = root().querySelectorAll('[data-group-rotation]');
//     expect([...groups].map(g => g.getAttribute("data-group-rotation"))).toEqual(["0", "90"]);
//     for (const g of groups) {
//       expect(g.querySelector('[data-device-group]')).not.toBeNull();
//       expect(g.querySelector('[data-base-direction="0"]')).not.toBeNull();
//     }
//     expect(root().textContent).toContain("当前设备组");
//     await act(async () => { app.internalActions.setLocale("en-US"); });
//     expect(root().textContent).not.toContain("eda.manual.direction.");
//     await act(async () => { app.internalActions.setLocale("zh-CN"); });
//     expect(JSON.stringify(c.getRequest())).toBe(before);
//     await act(async () => { c.manual.setOrientation("fixed"); });
//     expect(view.container.querySelector('[data-relative-direction-preview]')).toBeNull();
//     expect(radioWithLabel(view.container, "存取线底边方向", "0").checked).toBe(true);
//     expect(c.manual.layout?.boundary.rotation).toBe(0);
//   } finally { await view.unmount(); planner.dispose(); app.dispose(); }
// });


it.each(["straight", "corner", "u-shaped"] as const)("第二步%s固定屏幕四向与口分配同源，已有设备回退仍零Canvas", async shape => {
  const { app, workspace } = createAppTestWorkspace();
  const planner = createBlueprintPlannerHost(workspace, { storage: null });
  const c = app.blueprintPlannerDialog;
  await c.open((separator.request as BlueprintPlannerRequest).plan);
  c.updateOptions({ warehouseBus: shape });
  c.manual.setEnabled(true); c.manual.setOrientation("free"); c.manual.setBoundaryRotation(null);
  await c.manual.prepare(c.getRequest());
  const production = c.manual.preparation.nodes.find(n => n.purpose === "production")!;
  c.manual.place(production, { x: 8, y: 8 });
  const pose = JSON.stringify(c.manual.layout!.placements);
  const view = await mountTestComponent(<BlueprintPlannerBoundary appHost={app} request={c.getRequest()} disabled={false} />);
  try {
    await expect.poll(() => ({ loading: c.manual.loading, error: c.manual.error })).toEqual({ loading: false, error: null });
    const graph = () => view.container.querySelector('[data-shape]')!;
    expect(view.container.querySelector("canvas")).toBeNull();
    expect(view.container.querySelector('[data-relative-direction-preview]')).toBeNull();
    expect(graph().getAttribute("data-direction")).toBe("auto");
    const sides = shape === "straight" ? ["base"] : shape === "corner" ? ["base", "left"] : ["base", "left", "right"];
    const expected = { base: [2, 3, 0, 1], left: [3, 0, 1, 2], right: [1, 2, 3, 0] };
    for (const [index, rotation] of [0, 90, 180, 270].entries()) {
      await clickTestElement(radioWithLabel(view.container, "存取线相对设备组的位置", String(rotation)));
      for (const side of sides) {
        const line = graph().querySelector(`[data-boundary-side="${side}"]`)!;
        expect(line.getAttribute("data-edge"), JSON.stringify({ rotation, actual: c.manual.layout?.boundary.rotation, loading: c.manual.loading, disabled: radioWithLabel(view.container, "存取线相对设备组的位置", String(rotation)).disabled, error: c.manual.error })).toBe(String(expected[side as keyof typeof expected][index]));
      }
      expect(JSON.stringify(c.manual.layout!.placements)).toBe(pose);
    }
    const select = view.container.querySelector<HTMLSelectElement>('select')!;
    expect(select).not.toBeNull();
    for (const side of sides) {
      await changeTestValue(select, side);
      const chip = graph().querySelector(`[data-port-side="${side}"] [data-port-id]`)!;
      expect(chip).not.toBeNull();
      expect(chip.querySelector("img")?.getAttribute("src")).toMatch(/device-icons/);
      expect(c.manual.layout!.boundary.assignments.some(a => a.side === side)).toBe(true);
    }
    await changeTestValue(select, "auto");
    expect(c.manual.layout!.boundary.assignments).toHaveLength(0);
    expect(graph().querySelector('[data-port-id]')).toBeNull();
    await clickTestElement(graph().querySelector<HTMLButtonElement>('button[data-edge="1"]')!);
    expect(c.manual.layout!.boundary.rotation).toBe(270);
    await clickTestElement(radioWithLabel(view.container, "存取线相对设备组的位置", "auto"));
    expect(c.manual.layout!.boundary.rotation).toBeNull();
    expect(JSON.stringify(c.manual.layout!.placements)).toBe(pose);
    expect(view.container.querySelector("canvas")).toBeNull();
  } finally { await view.unmount(); planner.dispose(); app.dispose(); }
});
