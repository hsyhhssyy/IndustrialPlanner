import { BlueprintPlannerBusPortHints } from "@/app/shell/blueprint-planner-dimension-guides";
import { transformManualPlacement } from "@/shared/geometry/manual-layout-transform";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { act } from "react";
// AI-REMOVED 2026-11-21: Reason: 四向摘要已移除。Trigger: REQ-051。Evidence: 双轴摘要。Replacement: None。Risk: Low。Human Review: Required
// import { BlueprintPlannerSummary } from "@/app/shell/blueprint-planner-summary";
import { BlueprintPlannerBoundary } from "@/app/shell/blueprint-planner-boundary";
import { BlueprintPlannerManualOptions } from "@/app/shell/blueprint-planner-manual";
import { createBlueprintPlannerHost } from "@/blueprint-planner/blueprint-planner-host";
import type { BlueprintPlannerRequest } from "@/domain/blueprint-planner";
import { createAppTestWorkspace } from "../helpers/app-test-workspace";
import { buttonWithText, changeTestValue, clickTestElement, mountTestComponent, radioWithLabel } from "../helpers/react-test-dom";
// AI-REMOVED 2026-11-21: Reason: 该真实产线只生成一个边口，不能证明多实例。
// Trigger: targeted-final节点证据。Replacement: 下方静态真实节点组件fixture。Risk: Low。Human Review: Required
// Original code: import unequalSupplies from "../blueprint-planner/fixtures/manual-unequal-supplies.json";
import { isPlannerManualBoundaryDevice } from "@/shared/planner-manual-devices";
import separator from "../blueprint-planner/fixtures/separator-core.json";

beforeEach(() => vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true));
afterEach(() => vi.unstubAllGlobals());

it("双轴选项、参考线和历史恢复不改变已摆设备", async () => {
  const { app, workspace } = createAppTestWorkspace();
  const planner = createBlueprintPlannerHost(workspace, { storage: null });
  const c = app.blueprintPlannerDialog;
  await c.open((separator.request as BlueprintPlannerRequest).plan);
  c.manual.setEnabled(true); await c.manual.prepare(c.getRequest());
  c.manual.place(c.manual.preparation.nodes.find(n => n.purpose === "production")!, { x: 8, y: 6 });
  const pose = JSON.stringify(c.manual.layout!.placements);
  const view = await mountTestComponent(<BlueprintPlannerManualOptions appHost={app} disabled={false} />);
  const update = async (fn: () => void) => act(async () => { fn(); });
  try {
    await update(() => c.manual.setPlacementMode("absolute"));
    expect(c.manual.placementMode).toBe("absolute");
    expect(c.manual.axisPositionMode("x")).toBe("free"); expect(c.manual.axisPositionMode("y")).toBe("free");
    expect(c.manual.canEnterManualCanvas).toBe(true);
    for (const [axis, modes] of [["x", ["left", "right", "free"]], ["y", ["top", "base", "free"]]] as const)
      for (const mode of modes) {
        await clickTestElement(radioWithLabel(view.container, `${axis.toUpperCase()} 方向`, mode));
        expect(c.manual.axisPositionMode(axis)).toBe(mode);
        expect(JSON.stringify(c.manual.layout!.placements)).toBe(pose);
      }
    await update(() => c.manual.setAxisPositionMode("y", "top"));
    expect(c.manual.selectedDeviceBoundaryDistances()).toEqual([{ side: "top", distance: 6 }]);
    await update(() => c.updateOptions({ dimensionLimits: { exactSideLength: 24 } }));
    expect(c.manual.axisPositionMode("y")).toBe("locked");
    expect(view.container.textContent).toContain("仅允许沿 X 整体平移");
    await update(() => c.manual.setAxisPositionMode("x", "right"));
    expect(view.container.textContent).toContain("EDA 不整体平移设备组");
    expect(view.container.textContent).not.toContain("可沿 X、Y 自由平移");
    await update(() => app.internalActions.setLocale("en-US"));
    expect(view.container.textContent).toContain("EDA does not translate the group");
    await update(() => app.internalActions.setLocale("zh-CN"));
    await update(() => c.manual.setAxisPositionMode("y", "free"));
    expect(view.container.textContent).toContain("仅允许沿 Y 整体平移");
    await update(() => { c.manual.setAxisPositionMode("x", "free"); c.manual.setAxisPositionMode("y", "locked"); });
    expect(view.container.querySelector('[role="radiogroup"][aria-label="Y 方向"]')?.querySelectorAll('input')).toHaveLength(2);
    await update(() => c.updateOptions({ dimensionLimits: { maxSideLength: 30 } }));
    expect(c.manual.axisPositionMode("y")).toBe("base");
    await update(() => c.manual.setAxisPositionMode("y", "free"));
    expect(c.manual.placementMode).toBe("absolute");
    expect(view.container.querySelectorAll('[data-preview-boundary]')).toHaveLength(0);
    const saved = structuredClone(c.manual.layout!);
    await update(() => { c.manual.load(saved); c.manual.ensureSession(); });
    expect(c.manual.placementMode).toBe("absolute");
    expect(JSON.stringify(c.manual.layout!.placements)).toBe(pose);
    await update(() => c.manual.setPlacementMode("relative-fixed"));
    await update(() => c.updateOptions({ dimensionLimits: { exactBaseLength: 24 } }));
    expect(view.container.querySelectorAll('[data-preview-reference]')).toHaveLength(2);
    await update(() => c.manual.setPlacementMode("relative-free"));
    expect(view.container.querySelectorAll('[data-preview-boundary],[data-preview-reference]')).toHaveLength(0);
    await update(() => app.internalActions.setLocale("en-US"));
    expect(view.container.textContent).not.toContain("eda.manual.");
    await update(() => app.internalActions.setLocale("zh-CN"));
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


// AI-REMOVED 2026-11-21:
// Reason: 用户明确每口原生select唯一写入，图标和边线改为只读。
// Trigger: 本轮交互订正。Evidence: boundary data-port-select与无图内回调。
// Replacement: 下方select分配及图点击无写入回归，保留三形态/多实例/fallback。Risk: Low。Human Review: Required
// Original code:
// it.each(["straight", "corner", "u-shaped"] as const)("第二步%s固定屏幕四向与口分配同源，已有设备回退仍零Canvas", async shape => {
//   const { app, workspace } = createAppTestWorkspace();
//   const planner = createBlueprintPlannerHost(workspace, { storage: null });
//   const c = app.blueprintPlannerDialog;
//   await c.open((separator.request as BlueprintPlannerRequest).plan);
//   c.updateOptions({ warehouseBus: shape });
//   c.manual.setEnabled(true); c.manual.setOrientation("free"); c.manual.setBoundaryRotation(null);
//   await c.manual.prepare(c.getRequest());
//   const production = c.manual.preparation.nodes.find(n => n.purpose === "production")!;
//   c.manual.place(production, { x: 8, y: 8 });
//   const pose = JSON.stringify(c.manual.layout!.placements);
//   const view = await mountTestComponent(<BlueprintPlannerBoundary appHost={app} request={c.getRequest()} disabled={false} />);
//   try {
//     await expect.poll(() => ({ loading: c.manual.loading, error: c.manual.error })).toEqual({ loading: false, error: null });
//     const graph = () => view.container.querySelector('[data-shape]')!;
//     expect(view.container.querySelector("canvas")).toBeNull();
//     expect(view.container.querySelector('[data-relative-direction-preview]')).toBeNull();
//     expect(graph().getAttribute("data-direction")).toBe("auto");
//     const sides = shape === "straight" ? ["base"] : shape === "corner" ? ["base", "left"] : ["base", "left", "right"];
//     for (const side of sides) expect(graph.querySelector(`[data-boundary-side="${side}"]`)?.getAttribute("data-edge")).toBe(String({ base: 2, left: 3, right: 1 }[side as "base" | "left" | "right"]));
//     const select = view.container.querySelector<HTMLSelectElement>('select')!;
//     //     expect(select).not.toBeNull();
//     //     for (const side of sides) {
//     //       await changeTestValue(select, side);
//     //       const chip = graph().querySelector(`[data-port-side="${side}"] [data-port-id]`)!;
//     //       expect(chip).not.toBeNull();
//     //       expect(chip.querySelector("img")?.getAttribute("src")).toMatch(/device-icons/);
//     //       expect(c.manual.layout!.boundary.assignments.some(a => a.side === side)).toBe(true);
//     //     }
//     //     await changeTestValue(select, "auto");
//     //     expect(c.manual.layout!.boundary.assignments).toHaveLength(0);
//     //     expect(graph().querySelector('[data-port-id]')).toBeNull();
//     //     await clickTestElement(graph().querySelector<HTMLButtonElement>('button[data-edge="1"]')!);
//     //     expect(c.manual.layout!.boundary.rotation).toBeNull();
//     //     await clickTestElement(radioWithLabel(view.container, "存取线相对设备组的位置", "auto"));
//     //     expect(c.manual.layout!.boundary.rotation).toBeNull();
//     // AI-REMOVED 2026-11-21: Reason: 新增独立存取线选边控件。Trigger: REQ-051。
    // Evidence: 图外选择物理边，图内仍只读。Replacement: 下方角色控件断言。Risk: Low。Human Review: Required
    // Original code:
    // expect(view.container.querySelectorAll('[role="radiogroup"]')).toHaveLength(0);
// AI-CORRECTION 2026-11-21: 上方归档测试不再执行；当前选边断言位于下方现行测试。
// expect(view.container.querySelectorAll('[role="radiogroup"]')).toHaveLength(shape === "corner" ? 2 : 1);
//     expect(view.container.querySelector('select')).toBeNull();
//     expect(view.container.querySelector('[aria-label="存取口所属边"]')).toBeNull();
//     const unassigned = view.container.querySelector<HTMLButtonElement>('[data-port-id]')!;
//     const id = unassigned.getAttribute("data-port-id")!;
//     const icon = unassigned.querySelector("img")!;
//     expect(unassigned.getAttribute("data-icon-kind")).toBe("item");
//     expect(icon.getAttribute("src")).toContain("item-icons/");
//     expect(unassigned.getAttribute("aria-label")).toMatch(/#\d+ · .+/);
//     expect(icon.alt).toBe("");
//     const direction = c.manual.layout!.boundary.rotation;
//     for (const side of sides) {
//       await clickTestElement(view.container.querySelector<HTMLButtonElement>(`[data-port-id="${id}"]`)!);
//       await clickTestElement(graph().querySelector<HTMLButtonElement>(`button[data-side="${side}"]`)!);
//       await expect.poll(() => c.manual.loading).toBe(false);
//       expect(graph().querySelector(`[data-port-side="${side}"] [data-port-id="${id}"]`)).not.toBeNull();
//       expect(c.manual.layout!.boundary.assignments).toHaveLength(1);
//       expect(c.manual.layout!.boundary.assignments[0]!.side).toBe(side);
//       expect(c.manual.layout!.boundary.rotation).toBe(direction);
//     }
//     await clickTestElement(buttonWithText(view.container, "解除分配（自动）"));
//     await expect.poll(() => c.manual.loading).toBe(false);
//     expect(c.manual.layout!.boundary.assignments).toHaveLength(0);
//     expect(graph().querySelector('[data-port-id]')).toBeNull();
//     expect(c.manual.layout!.boundary.rotation).toBe(direction);
//     expect(graph().querySelectorAll('button[data-side]')).toHaveLength(sides.length);
//     expect(graph().querySelector('button[data-side=""]')).toBeNull();
//     await clickTestElement(radioWithLabel(view.container, "存取线相对设备组的位置", "auto"));
//     expect(c.manual.layout!.boundary.rotation).toBeNull();
//     expect(JSON.stringify(c.manual.layout!.placements)).toBe(pose);
//     expect(view.container.querySelector("canvas")).toBeNull();
//   } finally { await view.unmount(); planner.dispose(); app.dispose(); }
// });
//
//
// it("同物料不同真实存取口实例独立分配和解除，图标与可访问身份不合并", async () => {
//   const { app, workspace } = createAppTestWorkspace();
//   const planner = createBlueprintPlannerHost(workspace, { storage: null });
//   // AI-REMOVED 2026-11-21:
//   // Reason: unequal产线仅一个真实边口，夹具前提错误。Trigger: targeted-final.json节点证据。
//   // Replacement: 用户批准的小型静态真实节点组件fixture。Risk: Low。Human Review: Required
//   // Original code:
//   //   const c = app.blueprintPlannerDialog, request = unequalSupplies as BlueprintPlannerRequest;
//   //   await c.open(request.plan); c.updateOptions({ ...request.options, warehouseBus: "u-shaped" });
//   //   c.manual.setEnabled(true); c.manual.setBoundaryRotation(90);
//   //   await c.manual.prepare(c.getRequest());
//   //   const nodes = c.manual.preparation.nodes.filter(n => isPlannerManualBoundaryDevice(workspace.registry.queries.findEntityDefinition(n.definitionId)!));
//   //   const groups = new Map<string, typeof nodes>();
//   //   for (const n of nodes) {
//   //     const item = (n.outputs.length ? n.outputs : n.inputs)[0]?.itemId;
//   //     if (item) groups.set(item, [...groups.get(item) ?? [], n]);
//   //   }
//   //   const pair = [...groups.values()].find(group => group.length >= 2);
//   //   expect(pair, JSON.stringify(nodes.map(n => ({ id: n.id, inputs: n.inputs, outputs: n.outputs })))).toBeDefined();
//   //   const [first, second] = pair!;
//   const c = app.blueprintPlannerDialog, request = separator.request as BlueprintPlannerRequest;
//   await c.open(request.plan); c.updateOptions({ ...request.options, warehouseBus: "u-shaped" });
//   c.manual.setEnabled(true); c.manual.setBoundaryRotation(90);
//   await c.manual.prepare(c.getRequest());
//   const current = c.manual.layout!;
//   const first = c.manual.preparation.nodes.find(n => isPlannerManualBoundaryDevice(workspace.registry.queries.findEntityDefinition(n.definitionId)!))!;
//   // 此处只验证组件实例呈现，不声称人工扩展节点已经算法验收。
//   const second = { ...first, id: first.id + ":same-item-instance" };
//   const fallback = { ...first, id: first.id + ":no-flow", inputs: [], outputs: [] };
//   c.manual.load({ ...current, preparation: { ...current.preparation, nodes: [first, second, fallback] } });
//   const view = await mountTestComponent(<BlueprintPlannerBoundary appHost={app} request={c.getRequest()} disabled={false} />);
//   try {
//     await expect.poll(() => c.manual.loading).toBe(false);
//     const button = (id: string) => view.container.querySelector<HTMLButtonElement>(`[data-port-id="${id}"]`)!;
//     const assign = async (id: string, side: string) => {
//       await clickTestElement(button(id));
//       await clickTestElement(view.container.querySelector<HTMLButtonElement>(`button[data-side="${side}"]`)!);
//       await expect.poll(() => c.manual.loading).toBe(false);
//     };
//     expect(button(fallback.id).getAttribute("data-icon-kind")).toBe("entity");
//     expect(button(fallback.id).querySelector("img")!.src).toContain("device-icons/");
//     expect(button(first!.id).querySelector("img")!.src).toBe(button(second!.id).querySelector("img")!.src);
//     expect(button(first!.id).getAttribute("aria-label")).not.toBe(button(second!.id).getAttribute("aria-label"));
//     await assign(first!.id, "base"); await assign(second!.id, "left");
//     expect(c.manual.layout!.boundary.assignments.map(a => ({ id: a.referenceNode.id, side: a.side }))).toEqual([
//       { id: first!.id, side: "base" }, { id: second!.id, side: "left" },
//     ]);
//     await clickTestElement(button(first!.id));
//     await clickTestElement(buttonWithText(view.container, "解除分配（自动）"));
//     expect(c.manual.layout!.boundary.assignments.map(a => a.referenceNode.id)).toEqual([second!.id]);
//     expect(c.manual.layout!.boundary.rotation).toBe(90);
//     expect(view.container.querySelector("canvas,select")).toBeNull();
//   } finally { await view.unmount(); planner.dispose(); app.dispose(); }
// });
//

it.each(["straight", "corner", "u-shaped"] as const)("%s每口下拉唯一写入，四向只读图不改变分配或设备", async shape => {
  const { app, workspace } = createAppTestWorkspace();
  const planner = createBlueprintPlannerHost(workspace, { storage: null });
  const c = app.blueprintPlannerDialog;
  await c.open((separator.request as BlueprintPlannerRequest).plan); c.updateOptions({ warehouseBus: shape });
  c.manual.setEnabled(true); c.manual.setOrientation("fixed"); await c.manual.prepare(c.getRequest());
  c.manual.place(c.manual.preparation.nodes.find(n => n.purpose === "production")!, { x: 8, y: 8 });
  const pose = JSON.stringify(c.manual.layout!.placements);
  const view = await mountTestComponent(<BlueprintPlannerBoundary appHost={app} request={c.getRequest()} disabled={false} />);
  try {
    await expect.poll(() => c.manual.loading).toBe(false);
    const graph = view.container.querySelector('[data-shape]')!;
    expect(view.container.querySelector("canvas")).toBeNull();
    // AI-REMOVED 2026-11-21: Reason: 新增独立存取线选边控件。Trigger: REQ-051。
    // Evidence: 图外控件选择物理边，图内仍只读。Replacement: 下方控件数断言。Risk: Low。Human Review: Required
    // Original code:
    // expect(view.container.querySelectorAll('[role="radiogroup"]')).toHaveLength(0);
    expect(view.container.querySelectorAll('[role="radiogroup"]')).toHaveLength(shape === "corner" ? 2 : 1);
    expect(graph.querySelector('button,select,input,[data-boundary-hit]')).toBeNull();
    const sides = shape === "straight" ? ["base"] : shape === "corner" ? ["base", "left"] : ["base", "left", "right"];
    for (const side of sides) expect(graph.querySelector(`[data-boundary-side="${side}"]`)?.getAttribute("data-edge")).toBe(String({ base: 2, left: 3, right: 1 }[side as "base" | "left" | "right"]));
    const select = view.container.querySelector<HTMLSelectElement>('[data-port-select]')!;
    const id = select.dataset.portSelect!;
    expect([...select.options].map(o => o.value)).toEqual(["auto", ...sides]);
    expect(view.container.querySelectorAll('select')).toHaveLength(c.manual.preparation.nodes.filter(n => isPlannerManualBoundaryDevice(workspace.registry.queries.findEntityDefinition(n.definitionId)!)).length);
    for (const side of sides) {
      await changeTestValue(select, side); await expect.poll(() => c.manual.loading).toBe(false);
      expect(c.manual.layout!.boundary.assignments).toHaveLength(1);
      expect(graph.querySelector(`[data-port-side="${side}"] [data-port-id="${id}"]`)).not.toBeNull();
      expect(c.manual.layout!.boundary.rotation).toBe(0);
    }
    await clickTestElement(view.container.querySelector<HTMLInputElement>('[data-bus-role="base"] input[value="top"]')!);
    await expect.poll(() => c.manual.loading).toBe(false);
    expect(graph.querySelector('[data-boundary-side="base"]')?.getAttribute("data-edge")).toBe("0");
    expect(select.querySelector('option[value="base"]')?.textContent).toBe("顶边");
    expect(c.manual.layout!.boundary.assignments[0]!.side).toBe(sides.at(-1));
    const icon = graph.querySelector(`[data-port-id="${id}"]`)!;
    expect(icon.tagName).toBe("SPAN"); expect(icon.getAttribute("data-icon-kind")).toBe("item");
    expect(icon.querySelector('img')?.getAttribute("src")).toContain("item-icons/");
    const before = JSON.stringify(c.getRequest());
    await act(async () => { icon.dispatchEvent(new MouseEvent("click", { bubbles: true })); graph.querySelector('path')!.dispatchEvent(new MouseEvent("click", { bubbles: true })); });
    expect(JSON.stringify(c.getRequest())).toBe(before);
    await changeTestValue(select, "auto"); await expect.poll(() => c.manual.loading).toBe(false);
    expect(c.manual.layout!.boundary.assignments).toHaveLength(0);
    expect(graph.querySelector('[data-port-id]')).toBeNull();
    expect(JSON.stringify(c.manual.layout!.placements)).toBe(pose);
  } finally { await view.unmount(); planner.dispose(); app.dispose(); }
});

it("同物料两实例下拉独立写入并保留无物料设备fallback", async () => {
  const { app, workspace } = createAppTestWorkspace(); const planner = createBlueprintPlannerHost(workspace, { storage: null });
  const c = app.blueprintPlannerDialog; await c.open((separator.request as BlueprintPlannerRequest).plan); c.updateOptions({ warehouseBus: "u-shaped" });
  c.manual.setEnabled(true); c.manual.setBoundaryRotation(90); await c.manual.prepare(c.getRequest());
  const current = c.manual.layout!, first = c.manual.preparation.nodes.find(n => isPlannerManualBoundaryDevice(workspace.registry.queries.findEntityDefinition(n.definitionId)!))!;
  // 静态真实节点组件fixture仅验证实例呈现，不声称算法生成。
  const second = { ...first, id: first.id + ":same-item-instance" }, fallback = { ...first, id: first.id + ":no-flow", inputs: [], outputs: [] };
  c.manual.load({ ...current, preparation: { ...current.preparation, nodes: [first, second, fallback] } });
  const view = await mountTestComponent(<BlueprintPlannerBoundary appHost={app} request={c.getRequest()} disabled={false} />);
  try {
    await expect.poll(() => c.manual.loading).toBe(false);
    const select = (id: string) => view.container.querySelector<HTMLSelectElement>(`[data-port-select="${id}"]`)!;
    const set = async (id: string, side: string) => { await changeTestValue(select(id), side); await expect.poll(() => c.manual.loading).toBe(false); };
    expect(select(first.id).getAttribute("aria-label")).not.toBe(select(second.id).getAttribute("aria-label"));
    await set(first.id, "base"); await set(second.id, "left"); await set(fallback.id, "right");
    const icon = (id: string) => view.container.querySelector(`[data-port-side] [data-port-id="${id}"]`)!;
    expect(icon(first.id).querySelector('img')!.src).toBe(icon(second.id).querySelector('img')!.src);
    expect(icon(fallback.id).getAttribute("data-icon-kind")).toBe("entity");
    expect(icon(fallback.id).querySelector('img')!.src).toContain("device-icons/");
    await set(first.id, "auto");
    expect(c.manual.layout!.boundary.assignments.map(a => a.referenceNode.id)).toEqual([second.id, fallback.id]);
    expect(c.manual.layout!.boundary.rotation).toBe(90);
  } finally { await view.unmount(); planner.dispose(); app.dispose(); }
});

it("历史同ID不同物料职责引用不能冒充当前口，失效提示可独立删除", async () => {
  const { app, workspace } = createAppTestWorkspace();
  const planner = createBlueprintPlannerHost(workspace, { storage: null });
  const c = app.blueprintPlannerDialog;
  await c.open((separator.request as BlueprintPlannerRequest).plan);
  c.manual.setEnabled(true); await c.manual.prepare(c.getRequest());
  const node = c.manual.preparation.nodes.find(n => isPlannerManualBoundaryDevice(workspace.registry.queries.findEntityDefinition(n.definitionId)!))!;
  const current = c.manual.layout!;
  c.manual.load({ ...current, boundary: { ...current.boundary, assignments: [{ side: "base", referenceNode: {
    ...node, inputs: [], outputs: [{ itemId: "item_carbon_mtl", perMinute: 987 }],
  } }] } });
  const view = await mountTestComponent(<BlueprintPlannerBoundary appHost={app} request={c.getRequest()} disabled={false} />);
  try {
    await expect.poll(() => c.manual.loading).toBe(false);
    expect(view.container.querySelector('[data-port-side="base"] [data-port-id]')).toBeNull();
    expect(view.container.querySelector(`[data-port-id="${node.id}"]`)?.getAttribute("aria-label")).toContain("未分配");
    expect(view.container.querySelector('[role="alert"]')).not.toBeNull();
    await clickTestElement(buttonWithText(view.container, "移除"));
    expect(c.manual.layout!.boundary.assignments).toHaveLength(0);
  } finally { await view.unmount(); planner.dispose(); app.dispose(); }
});

it("历史U形右侧关联在直线形下显式保留为不可用，下拉自动可解除", async () => {
  const { app, workspace } = createAppTestWorkspace(); const planner = createBlueprintPlannerHost(workspace, { storage: null });
  const c = app.blueprintPlannerDialog; await c.open((separator.request as BlueprintPlannerRequest).plan);
  c.updateOptions({ warehouseBus: "straight" }); c.manual.setEnabled(true); await c.manual.prepare(c.getRequest());
  const current = c.manual.layout!, node = c.manual.preparation.nodes.find(n => isPlannerManualBoundaryDevice(workspace.registry.queries.findEntityDefinition(n.definitionId)!))!;
  c.manual.load({ ...current, boundary: { ...current.boundary, assignments: [{ referenceNode: node, side: "right" }] } });
  const view = await mountTestComponent(<BlueprintPlannerBoundary appHost={app} request={c.getRequest()} disabled={false} />);
  try {
    await expect.poll(() => c.manual.loading).toBe(false);
    const select = view.container.querySelector<HTMLSelectElement>(`[data-port-select="${node.id}"]`)!;
    expect(select.value).toBe("right"); expect(select.getAttribute("aria-invalid")).toBe("true");
    expect([...select.options].find(o => o.value === "right")?.disabled).toBe(true);
    expect(view.container.querySelector('[role="alert"]')).not.toBeNull();
    await changeTestValue(select, "auto"); await expect.poll(() => c.manual.loading).toBe(false);
    expect(c.manual.layout!.boundary.assignments).toHaveLength(0); expect(select.value).toBe("auto");
  } finally { await view.unmount(); planner.dispose(); app.dispose(); }
});

// 2026-11-21：free旧方向仅是草稿原文，不再是可见约束；fixed仍用草稿投影。

it("三态摆放模式在准备前配置并回显旧草稿，中英文不改变请求", async () => {
  const { app, workspace } = createAppTestWorkspace();
  const planner = createBlueprintPlannerHost(workspace, { storage: null });
  app.internalActions.setLocale("zh-CN");
  const c = app.blueprintPlannerDialog;
  await c.open((separator.request as BlueprintPlannerRequest).plan);
  c.manual.setEnabled(true);
  const view = await mountTestComponent(<BlueprintPlannerManualOptions appHost={app} disabled={false} />);
  try {
    expect(view.container.querySelector('[role="radiogroup"][aria-label="整体朝向"]')).toBeNull();
    expect(view.container.querySelector('[role="radiogroup"][aria-label="摆放方式"]')).toBeNull();
    for (const mode of ["relative-free", "relative-fixed", "absolute", "relative-fixed"] as const) {
      await clickTestElement(radioWithLabel(view.container, "摆放模式", mode));
      expect(c.manual.placementMode).toBe(mode);
      expect(c.manual.layout!.orientation).toBe(mode === "relative-free" ? "free" : "fixed");
      expect(view.container.querySelector('[role="radiogroup"][aria-label="X 方向"]') !== null).toBe(mode === "absolute");
      expect(view.container.querySelector('[data-manual-preview]')?.getAttribute('data-manual-preview'))
        .toBe(mode === "absolute" ? "boundary" : mode);
    }
    const valid = structuredClone(c.manual.layout!);
    for (const [orientation, position, expected] of [
      ["free", null, "relative-free"], ["fixed", null, "relative-fixed"],
      ["fixed", { base: 16, left: null, right: null }, "absolute"],
      ["free", { base: 16, left: null, right: null }, undefined],
    ] as const) {
      await act(async () => { c.manual.load({ ...valid, orientation, boundary: { ...valid.boundary, position } }); });
      expect(c.manual.placementMode).toBe(expected);
      const group = view.container.querySelector('[role="radiogroup"][aria-label="摆放模式"]')!;
      expect(group.querySelector<HTMLInputElement>('input:checked')?.value).toBe(expected);
    }
    const before = JSON.stringify(c.getRequest());
    await act(async () => { app.internalActions.setLocale("en-US"); });
    const group = view.container.querySelector('[role="radiogroup"][aria-label="Placement mode"]')!;
    expect(group).not.toBeNull();
    expect(group.querySelectorAll('input[type="radio"]')).toHaveLength(3);
    expect(group.textContent).not.toContain("eda.manual.");
    expect(JSON.stringify(c.getRequest())).toBe(before);
  } finally { await view.unmount(); planner.dispose(); app.dispose(); }
});

// AI-REMOVED 2026-11-21: Reason: 双轴契约替代旧单底边/四向控件断言。Trigger: 用户明确行为变更。Evidence: REQ-051。Replacement: 双轴测试。Risk: Low。Human Review: Required
// Original code:
// it("人工预览覆盖关闭、相对两种和绝对三种侧边，精确与最大不混淆且只读", async () => {
//   const { app, workspace } = createAppTestWorkspace();
//   const planner = createBlueprintPlannerHost(workspace, { storage: null });
//   const c = app.blueprintPlannerDialog;
//   await c.open((separator.request as BlueprintPlannerRequest).plan);
//   const view = await mountTestComponent(<BlueprintPlannerManualOptions appHost={app} disabled={false} />);
//   const preview = () => view.container.querySelector('[data-manual-preview]');
//   const update = async (fn: () => void) => { await act(async () => { fn(); }); };
//   const assertReadonly = async () => {
//     const before = JSON.stringify(c.getRequest());
//     await update(() => app.internalActions.setLocale("en-US"));
//     expect(view.container.textContent).not.toContain("eda.manual.preview.");
//     expect(view.container.textContent).toContain("Device binding");
//     await update(() => app.internalActions.setLocale("zh-CN"));
//     expect(JSON.stringify(c.getRequest())).toBe(before);
//     expect(preview()?.querySelector('input,button,select')).toBeNull();
//   };
//   try {
//     // AI-CORRECTION 2026-11-21: 关闭说明新增遵守布局尺寸，保留自动摆放行为断言。
//     // Original code: expect(view.container.textContent).toContain("由规划器自动摆放全部设备");
//     expect(view.container.textContent).toContain("规划器遵守布局尺寸设置，自动摆放全部设备");
//     expect(preview()).toBeNull();
//     await update(() => c.manual.setEnabled(true));
//     await update(() => c.manual.setOrientation("free"));
//     expect(preview()?.getAttribute('data-manual-preview')).toBe("relative-free");
//     // AI-CORRECTION 2026-11-21：free新语义明确四向搜索且忽略旧方向。
//     // Original assertion: expect(preview()?.textContent).toContain("整组可以平移、旋转");
//     expect(preview()?.textContent).toContain("四种朝向");
//     await update(() => c.manual.setOrientation("fixed"));
//     expect(preview()?.getAttribute('data-manual-preview')).toBe("relative-fixed");
//     // AI-CORRECTION 2026-11-21：fixed由下一步指定草稿相对朝向。
//     // Original assertion: expect(preview()?.textContent).toContain("当前朝向");
//     expect(preview()?.textContent).toContain("哪一侧面向布局底边");
//     await update(() => c.manual.setPositioningMode("absolute"));
//     expect(preview()?.getAttribute('data-manual-preview')).toBe("absolute-none");
//     expect(preview()?.textContent).toContain("3 格净距");
//     expect(preview()?.querySelector('[data-preview-grid]')?.getAttribute("data-preview-grid")).toBe("10");
//     const grid = preview()!.querySelector('pattern')!;
//     const devices = [...preview()!.querySelectorAll('svg > rect')].filter(rect => rect.getAttribute("height") === "30");
//     expect(devices).toHaveLength(2);
//     for (const device of devices) expect((129 - Number(device.getAttribute("y")) - Number(device.getAttribute("height"))) / Number(grid.getAttribute("height"))).toBe(3);
//     expect(preview()?.querySelector('[data-preview-motion="parallel"]')).not.toBeNull();
//     expect(preview()?.querySelectorAll('[data-preview-boundary]')).toHaveLength(1);
//     await update(() => c.manual.setBoundarySideMode("single"));
//     expect(preview()?.getAttribute('data-manual-preview')).toBe("absolute-single");
//     expect(preview()?.querySelectorAll('[data-preview-boundary]')).toHaveLength(2);
//     await update(() => c.updateOptions({ dimensionLimits: { exactBaseLength: 24 } }));
//     expect(preview()?.querySelector('[data-preview-boundary="right"][data-derived="true"]')).not.toBeNull();
//     expect(preview()?.querySelector("[data-preview-dimensions]")?.textContent).toContain("24");
//     await update(() => c.manual.setBoundarySideMode("both"));
//     expect(preview()?.getAttribute('data-manual-preview')).toBe("absolute-both");
//     expect(preview()?.querySelectorAll('[data-preview-boundary]')).toHaveLength(3);
//     await update(() => { c.manual.setBoundarySideMode("single"); c.updateOptions({ dimensionLimits: { maxBaseLength: 24, exactSideLength: 12 } }); });
//     expect(preview()?.querySelector('[data-preview-boundary="top"][data-derived="true"]')).not.toBeNull();
//     expect(preview()?.textContent).toContain("固定顶边");
//     await update(() => c.updateOptions({ dimensionLimits: { maxBaseLength: 24, maxSideLength: 12 } }));
//     expect(preview()?.querySelector('[data-preview-boundary="top"]')).toBeNull();
//     expect(preview()?.textContent).toContain("最大值仅限制最终布局尺寸");
//     await assertReadonly();
//     for (const [mode, text] of [["recipe", "按生产配方绑定"], ["topology", "按拓扑关系绑定"]] as const) {
//       await update(() => c.manual.setMode(mode));
//       expect(preview()?.textContent).toContain(text);
//     }
//     // AI-CORRECTION 2026-11-21：三态摆放模式替代两组联动控件；同步当前交互契约。
//     // Original code: await clickTestElement(radioWithLabel(view.container, "整体朝向", "free"));
//     await clickTestElement(radioWithLabel(view.container, "摆放模式", "relative-free"));
//     expect(c.manual.layout?.boundary.position).toBeNull();
//     expect(preview()?.getAttribute('data-manual-preview')).toBe("relative-free");
//   } finally { await view.unmount(); planner.dispose(); app.dispose(); }
// });

// AI-REMOVED 2026-11-21: Reason: 四向入口移除。Trigger: REQ-051。Evidence: 固定屏幕边。Replacement: 上方。Risk: Low。Human Review: Required
//     const expected = { base: [2, 3, 0, 1], left: [3, 0, 1, 2], right: [1, 2, 3, 0] };
// //     for (const [index, rotation] of [0, 90, 180, 270].entries()) {
// //       await clickTestElement(radioWithLabel(view.container, "存取线相对设备组的位置", String(rotation)));
// //       for (const side of sides) {
// //         const line = graph().querySelector(`[data-boundary-side="${side}"]`)!;
// //         expect(line.getAttribute("d")).toBe(["M40 35H280", "M280 35V205", "M40 205H280", "M40 35V205"][expected[side as keyof typeof expected][index]!]);
// //         expect(line.getAttribute("data-edge"), JSON.stringify({ rotation, actual: c.manual.layout?.boundary.rotation, loading: c.manual.loading, disabled: radioWithLabel(view.container, "存取线相对设备组的位置", String(rotation)).disabled, error: c.manual.error })).toBe(String(expected[side as keyof typeof expected][index]));
// //       }
// //       expect(JSON.stringify(c.manual.layout!.placements)).toBe(pose);
// //     }
// //     // AI-REMOVED 2026-11-21:
// //     // Reason: 用户移除select列表及图内方向操作，分配改为圆图标与有效边。
// //     // Trigger: 第二步重设计。Evidence: 单一顶部方向组。
// //     // Replacement: 下方图标分配/切边/解除与方向不变断言。Risk: Low。Human Review: Required
// //     // Original code:
// //     //

// AI-REMOVED 2026-11-21: Reason: 双轴契约替代旧单底边/四向控件断言。Trigger: 用户明确行为变更。Evidence: REQ-051。Replacement: 双轴测试。Risk: Low。Human Review: Required
// Original code:
// it("free隐藏四向且旧任务方向不改变只读图，fixed回填相对朝向并保持设备和镜头", async () => {
//   const { app, workspace } = createAppTestWorkspace();
//   const planner = createBlueprintPlannerHost(workspace, { storage: null });
//   const c = app.blueprintPlannerDialog;
//   await c.open((separator.request as BlueprintPlannerRequest).plan);
//   c.updateOptions({ warehouseBus: "u-shaped" }); c.manual.setEnabled(true);
//   await c.manual.prepare(c.getRequest());
//   c.manual.place(c.manual.preparation.nodes.find(n => n.purpose === "production")!, { x: 8, y: 6 });
//   const initial = c.manual.layout!, placements = JSON.stringify(initial.placements);
//   c.manual.load({ ...initial, orientation: "free", boundary: { ...initial.boundary, rotation: 90 } });
//   const view = await mountTestComponent(<>
//     <BlueprintPlannerManualOptions appHost={app} disabled={false} />
//     <BlueprintPlannerBoundary appHost={app} request={c.getRequest()} disabled={false} />
//     <BlueprintPlannerSummary appHost={app} supply={null} mode="straight" />
//   </>);
//   const boundary = () => view.container.querySelector("[data-shape]")!.closest("section")!;
//   const summary = () => [...view.container.querySelectorAll("dl dt")].filter(e => e.textContent === "设备组面向底边的一侧");
//   try {
//     await expect.poll(() => c.manual.loading).toBe(false);
//     for (const rotation of [0, 90, 180, 270] as const) {
//       await act(async () => { const current = c.manual.layout!; c.manual.load({ ...current, orientation: "free", boundary: { ...current.boundary, rotation } }); });
//       expect(boundary().querySelector('[role="radiogroup"]')).toBeNull();
//       expect(boundary().querySelector('[data-boundary-side="base"]')?.getAttribute("data-edge")).toBe("2");
//       expect(boundary().querySelector('[data-boundary-side="left"]')?.getAttribute("data-edge")).toBe("3");
//       expect(boundary().textContent).toContain("四种朝向");
//       expect(c.manual.layout!.boundary.rotation).toBe(rotation);
//       expect(summary()).toHaveLength(0);
//     }
//     // AI-CORRECTION 2026-11-21：三态控件替代旧朝向入口，保留方向回显行为断言。
//     // Original code: await clickTestElement(radioWithLabel(view.container, "整体朝向", "fixed"));
//     await clickTestElement(radioWithLabel(view.container, "摆放模式", "relative-fixed"));
//     expect(radioWithLabel(boundary() as HTMLElement, "设备组面向底边的一侧", "270").checked).toBe(true);
//     expect(boundary().querySelector('[data-boundary-side="base"]')?.getAttribute("data-edge")).toBe("1");
//     expect(summary()).toHaveLength(1); expect(summary()[0]!.nextElementSibling?.textContent).toBe("右");
//     await clickTestElement(radioWithLabel(boundary() as HTMLElement, "设备组面向底边的一侧", "auto"));
//     expect(boundary().textContent).toContain("沿用草稿下侧");
//     expect(boundary().querySelector('[data-boundary-side="base"]')?.getAttribute("data-edge")).toBe("2");
//     await clickTestElement(radioWithLabel(boundary() as HTMLElement, "设备组面向底边的一侧", "90"));
//     // AI-CORRECTION 2026-11-21：三态摆放模式替代两组联动控件；同步当前交互契约。
//     // Original code: await clickTestElement(radioWithLabel(view.container, "整体朝向", "free"));
//     await clickTestElement(radioWithLabel(view.container, "摆放模式", "relative-free"));
//     expect(boundary().querySelector('[role="radiogroup"]')).toBeNull();
//     expect(c.manual.layout!.boundary.rotation).toBe(90);
//     expect(JSON.stringify(c.manual.layout!.placements)).toBe(placements);
//     // AI-REMOVED 2026-11-21: Reason: Session不持有View；镜头0通过浏览器真实画布检查。
//     // Trigger: 测试契约核对。Evidence: EditableSceneSession无view。Replacement: 本轮三屏场景。
//     // Risk: Low。Human Review: Required
//     // Original code: expect(c.manual.ensureSession().view.camera.state.displayRotation).toBe(0);
//     await act(async () => { await c.saveProductionTask(); });
//     const saved = planner.queries.exportTask(c.viewTaskId!).request as BlueprintPlannerRequest;
//     expect(saved.manualLayout).toMatchObject({ orientation: "free", boundary: { rotation: 90 } });
//     await act(async () => { app.internalActions.setLocale("en-US"); });
//     expect(boundary().textContent).toContain("four group orientations");
//     expect(boundary().textContent).not.toContain("eda.manual.");
//   } finally { await view.unmount(); planner.dispose(); app.dispose(); }
// });

// AI-REMOVED 2026-11-21: Reason: 四向入口移除。Trigger: REQ-051。Evidence: 固定屏幕边。Replacement: 上方。Risk: Low。Human Review: Required
//     const expected = { base: [2, 3, 0, 1], left: [3, 0, 1, 2], right: [1, 2, 3, 0] };
//     for (const [index, rotation] of [0, 90, 180, 270].entries()) {
//       await clickTestElement(radioWithLabel(view.container, "设备组面向底边的一侧", String(rotation)));
//       for (const side of sides) expect(graph.querySelector(`[data-boundary-side="${side}"]`)?.getAttribute("data-edge")).toBe(String(expected[side as keyof typeof expected][index]));
//     }

it("旧固定草稿逆转角落到画布实体且只应用一次，自由草稿切固定忽略旧方向", async () => {
  const { app, workspace } = createAppTestWorkspace();
  const planner = createBlueprintPlannerHost(workspace, { storage: null });
  const c = app.blueprintPlannerDialog;
  await c.open((separator.request as BlueprintPlannerRequest).plan);
  c.manual.setEnabled(true); await c.manual.prepare(c.getRequest());
  c.manual.place(c.manual.preparation.nodes.find(n => n.purpose === "production")!, { x: 8, y: 6 });
  const old = structuredClone(c.manual.layout!);
  try {
    const placement = old.placements[0]!;
    const definition = workspace.registry.queries.findEntityDefinition(placement.referenceNode.definitionId)!;
    const expected = transformManualPlacement(placement, definition, { rotation: 270, translation: { x: 0, y: 0 } });
    c.manual.load({ ...old, orientation: "fixed", boundary: { ...old.boundary, rotation: 90 } });
    c.manual.ensureSession();
    expect(c.manual.layout!.boundary.rotation).toBe(0);
    expect(c.manual.layout!.placements[0]).toEqual(expected);
    c.manual.ensureSession(); expect(c.manual.layout!.placements[0]).toEqual(expected);
    c.manual.load({ ...old, orientation: "free", boundary: { ...old.boundary, rotation: 90 } });
    c.manual.setPlacementMode("relative-fixed");
    expect(c.manual.layout!.boundary.rotation).toBe(0);
    expect(c.manual.layout!.placements).toEqual(old.placements);
  } finally { planner.dispose(); app.dispose(); }
});

it("取货口视口提示只接收布局与物品，不依赖相机或锁边坐标", async () => {
  const { app, workspace } = createAppTestWorkspace();
  const planner = createBlueprintPlannerHost(workspace, { storage: null });
  const c = app.blueprintPlannerDialog;
  await c.open((separator.request as BlueprintPlannerRequest).plan);
  c.manual.setEnabled(true);
  await c.manual.prepare(c.getRequest());
  const port = c.manual.preparation.nodes.find(node => node.definitionId === "unloader_1")!;
  c.manual.setBoundarySide(port, "base"); c.manual.setBusEdge("base", "top");
  const view = await mountTestComponent(<BlueprintPlannerBusPortHints layout={c.manual.layout!} shape="straight" registry={workspace.registry} label="取货口: " />);
  try {
    const hint = view.container.querySelector('[data-bus-hint-role="base"]')!;
    expect(hint.getAttribute("data-bus-hint-edge")).toBe("top");
    expect(hint.hasAttribute("style")).toBe(false);
    expect(hint.hasAttribute("data-locked")).toBe(false);
    expect(hint.querySelector("span")?.textContent).toBe("取货口: ");
    expect(hint.querySelectorAll("img").length).toBeGreaterThan(0);
  } finally { await view.unmount(); planner.dispose(); app.dispose(); }
});
