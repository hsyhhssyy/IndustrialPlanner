import { createEditableCanvasScene } from "@/app/canvas";
import { rotateManualPoint } from "@/shared/geometry/manual-layout-transform";
import { resolveViewportPointFromWorldPoint } from "@/shared/geometry/viewport-transform";
import type { GridRotation } from "@/domain/shared/grid";
import { resolveEntityGridRect } from "@/shared/geometry/power-range";
import { expect, it } from "vitest";
import { createAppTestWorkspace } from "../helpers/app-test-workspace";
import { createBlueprintPlannerHost } from "@/blueprint-planner/blueprint-planner-host";
import type { BlueprintPlannerRequest } from "@/domain/blueprint-planner";
import { EntityCollectionType } from "@/domain/editor/types/editor-types";
import separator from "../blueprint-planner/fixtures/separator-core.json";
import input from "../blueprint-planner/fixtures/environment-supply.json";

async function openManualTask(request: BlueprintPlannerRequest = input as BlueprintPlannerRequest) {
  const { workspace, app } = createAppTestWorkspace();
  const planner = createBlueprintPlannerHost(workspace, { storage: null });
  const controller = app.blueprintPlannerDialog;
  await controller.open(request.plan);
  controller.updateOptions(request.options);
  controller.manual.setEnabled(true);
  await controller.manual.prepare(controller.getRequest());
  const manual = controller.manual, session = manual.ensureSession();
  const node = manual.layout!.preparation.nodes.find(candidate => candidate.purpose === "production")!;
  return { workspace, app, planner, controller, manual, session, node,
    dispose: () => { planner.dispose(); app.dispose(); } };
}

it("人工放置原子发布稳定身份和职责，启停、绑定及几何使用同一撤销重做历史", async () => {
  const test = await openManualTask();
  try {
    const { manual, session, node } = test;
    const observations: Array<{ exists: boolean; referenced: boolean; sequence: number }> = [];
    const stop = session.snapshot.subscribe(snapshot => observations.push({
      exists: snapshot.document.entities[node.id] !== undefined,
      referenced: snapshot.intent.referencesByEntityId[node.id] !== undefined,
      sequence: session.editor.state.history.cursorSequence,
    }));
    try {
      // snapshot 订阅立即发送初值；下面单独观察一次放置提交的原子发布。
      expect(observations).toEqual([{ exists: false, referenced: false, sequence: session.editor.state.history.cursorSequence }]);
      observations.length = 0;
      manual.place(node, { x: 8, y: 8 });
      expect(manual.selectedId).toBe(node.id);
      expect(observations).toHaveLength(1);
      expect(observations[0]).toMatchObject({ exists: true, referenced: true });
      const placedSequence = session.editor.state.history.cursorSequence;
      manual.setMode("device");
      manual.setEnabled(false);
      expect(manual.canUndo).toBe(true);
      manual.undo();
      expect(manual.layout!.enabled).toBe(true);
      manual.undo();
      expect(manual.layout!.mode).toBe("recipe");
      expect(session.editor.state.history.cursorSequence).toBe(placedSequence);
      manual.undo();
      expect(session.snapshot.getSnapshot().document.entities[node.id]).toBeUndefined();
      expect(session.snapshot.getSnapshot().intent.referencesByEntityId[node.id]).toBeUndefined();
      manual.redo();
      expect(manual.layout!.placements[0]!.referenceNode.id).toBe(node.id);
      expect(observations.every(value => value.exists === value.referenced)).toBe(true);
    } finally { stop(); }
  } finally { test.dispose(); }
});

it("准备等待期间的移动保留最新位姿；纯几何变化复用准备结果", async () => {
  const test = await openManualTask();
  try {
    const { manual, controller, session, node, planner } = test;
    manual.place(node, { x: 8, y: 8 });
    manual.setMode("device");
    const key = planner.queries.getManualPreparationKey(controller.getRequest());
    const pending = manual.prepare(controller.getRequest());
    const before = { ...session.snapshot.getSnapshot().document.entities[node.id]!.position };
    session.editor.actions.moveCollectionTo({ collectionType: EntityCollectionType.selection,
      startGridPoint: before, endGridPoint: { x: before.x + 9, y: before.y + 7 } });
    const moved = { ...session.snapshot.getSnapshot().document.entities[node.id]!.position };
    expect(moved).not.toEqual(before);
    await pending;
    expect(manual.error).toBeNull();
    expect(manual.layout!.placements[0]!.position).toEqual(moved);
    expect(planner.queries.getManualPreparationKey(controller.getRequest())).toBe(key);
    const preparation = manual.preparation;
    await manual.prepare(controller.getRequest());
    expect(manual.preparation).toBe(preparation);
  } finally { test.dispose(); }
});

it("冲突草稿可以删除并撤销恢复；直接 Editor 写入口不能开启配置或蓝图操作", async () => {
  const test = await openManualTask();
  try {
    const { manual, controller, node } = test;
    manual.place(node, { x: 8, y: 8 });
    const current = manual.layout!;
    const second = { ...node, id: node.id + ":conflict" };
    manual.load({ ...current, placements: [...current.placements, { ...current.placements[0]!, referenceNode: second }] });
    const session = manual.ensureSession(controller.getRequest());
    await manual.prepare(controller.getRequest());
    expect(manual.invalidPositions()).toContain(node.id);
    expect(manual.blocked()).toBe(true);
    const before = session.snapshot.getSnapshot();
    session.editor.actions.patchEntityConfig(node.id, { recipeId: "unauthorized" });
    expect(session.snapshot.getSnapshot()).toBe(before);
    expect(session.editor.queries.getOperationAvailability("blueprint-placement").supported).toBe(false);
    manual.select(second.id);
    manual.remove();
    expect(session.snapshot.getSnapshot().document.entities[second.id]).toBeUndefined();
    manual.undo();
    expect(session.snapshot.getSnapshot().document.entities[second.id]).toBeDefined();
    expect(session.snapshot.getSnapshot().intent.referencesByEntityId[second.id]).toEqual(second);
  } finally { test.dispose(); }
});


it("边界意图同步空间及完整占地校验，冲突保留设备，撤销重做不重建会话", async () => {
  const test = await openManualTask();
  try {
    const { manual, controller, session, node, workspace } = test;
    manual.place(node, { x: -8, y: -8 });
    manual.setOrientation("fixed");
    manual.setBoundaryRotation(0);
    await manual.prepare(controller.getRequest());
    const document = session.snapshot.getSnapshot().document;
    const entity = document.entities[node.id]!;
    const definition = workspace.registry.queries.findEntityDefinition(entity.definitionId)!;
    const rect = resolveEntityGridRect({ entity, definition });
    const base = rect.y + rect.height;
    manual.setBoundaryPosition({ base, left: rect.x, right: rect.x + rect.width });
    expect(manual.session).toBe(session);
    expect(session.source.snapshot.getSnapshot().space.areas[0]!.bounds).toEqual({
      minX: rect.x, maxX: rect.x + rect.width, minY: null, maxY: base,
    });
    expect(manual.invalidPositions()).not.toContain(node.id);
    manual.setBoundaryPosition({ base: base - 1, left: null, right: null });
    expect(session.snapshot.getSnapshot().document).toBe(document);
    expect(session.source.snapshot.getSnapshot().space.areas[0]!.bounds.maxY).toBe(base - 1);
    expect(manual.invalidPositions()).toContain(node.id);
    expect(manual.blocked()).toBe(true);
    manual.undo();
    expect(manual.invalidPositions()).not.toContain(node.id);
    expect(session.source.snapshot.getSnapshot().space.areas[0]!.bounds.maxY).toBe(base);
    manual.redo();
    expect(manual.invalidPositions()).toContain(node.id);
    manual.setOrientation("free");
    expect(session.source.snapshot.getSnapshot().space.areas[0]!.bounds).toEqual({
      minX: null, maxX: null, minY: null, maxY: null,
    });
    expect(manual.layout!.boundary.position!.base).toBe(base - 1);
    expect(manual.invalidPositions()).not.toContain(node.id);
  } finally { test.dispose(); }
});

it("侧边非法次序保留已提交空间并阻止开始，合法提交清除输入错误", async () => {
  const test = await openManualTask();
  try {
    const { manual, session } = test;
    manual.setOrientation("fixed");
    manual.setBoundaryRotation(0);
    manual.setBoundaryPosition({ base: 20, left: 0, right: 24 });
    const before = session.snapshot.getSnapshot();
    manual.setBoundaryPosition({ base: 20, left: 24, right: 24 });
    expect(session.snapshot.getSnapshot()).toBe(before);
    expect(manual.boundaryInputError).not.toBeNull();
    expect(manual.blocked()).toBe(true);
    manual.setBoundaryPosition({ base: 20, left: -2, right: 24 });
    expect(manual.boundaryInputError).toBeNull();
    expect(session.source.snapshot.getSnapshot().space.areas[0]!.bounds.minX).toBe(-2);
  } finally { test.dispose(); }
});

it("双侧精确宽度立即遵守前序上限，尺寸调整无需重新准备即更新阻断", async () => {
  const test = await openManualTask(separator.request as BlueprintPlannerRequest);
  try {
    const { manual, controller } = test;
    manual.setOrientation("fixed");
    manual.setBoundaryRotation(0);
    manual.setBoundaryPosition({ base: 20, left: 0, right: 32 });
    controller.updateOptions({ warehouseBus: "straight", dimensionLimits: { straight: { edge: 30 } } });
    await manual.prepare(controller.getRequest());
    expect(manual.error).toBeNull();
    expect(manual.blocked()).toBe(true);
    const preparation = manual.preparation;
    controller.updateOptions({ dimensionLimits: { straight: { edge: 40 } } });
    expect(manual.preparation).toBe(preparation);
    expect(manual.blocked()).toBe(false);
  } finally { test.dispose(); }
});


it("相对模式与绝对模式前置条件明确，关闭绝对保留设备且撤销恢复定位", async () => {
  const test = await openManualTask();
  try {
    const { manual, node, session } = test;
    manual.place(node, { x: 4, y: 5 });
    const document = session.snapshot.getSnapshot().document;
    expect(manual.canEnterManualCanvas).toBe(true);
    manual.setBoundaryPosition({ base: 16, left: null, right: null });
    expect(manual.absoluteOrientationIncomplete).toBe(true);
    expect(manual.canEnterManualCanvas).toBe(false);
    manual.setOrientation("fixed");
    expect(manual.absoluteDirectionIncomplete).toBe(true);
    expect(manual.canEnterManualCanvas).toBe(false);
    manual.setBoundaryRotation(90);
    expect(manual.canEnterManualCanvas).toBe(true);
    manual.setBoundaryPosition(null);
    expect(manual.canEnterManualCanvas).toBe(true);
    expect(session.snapshot.getSnapshot().document).toBe(document);
    expect(session.source.snapshot.getSnapshot().space.areas[0]!.bounds).toEqual({ minX: null, maxX: null, minY: null, maxY: null });
    manual.undo();
    expect(manual.layout!.boundary.position).toEqual({ base: 16, left: null, right: null });
    expect(session.snapshot.getSnapshot().document).toBe(document);
    manual.setEnabled(false);
    manual.setOrientation("free");
    expect(manual.canEnterManualCanvas).toBe(true);
    expect(manual.blocked()).toBe(false);
  } finally { test.dispose(); }
});

it("精确底边长度只修改非锚定侧，拖动坐标与撤销仍使用同一几何", async () => {
  const test = await openManualTask();
  try {
    const { manual } = test;
    manual.setOrientation("fixed"); manual.setBoundaryRotation(0);
    manual.setBoundaryPosition({ base: 16, left: -4, right: 20 });
    manual.setBoundaryWidthAnchor("left"); manual.setBoundaryWidth(30);
    expect(manual.layout!.boundary.position).toEqual({ base: 16, left: -4, right: 26 });
    manual.setBoundaryWidthAnchor("right"); manual.setBoundaryWidth(18);
    expect(manual.layout!.boundary.position).toEqual({ base: 16, left: 8, right: 26 });
    manual.undo();
    expect(manual.layout!.boundary.position).toEqual({ base: 16, left: -4, right: 26 });
    manual.setBoundaryWidth(0);
    expect(manual.boundaryInputError).not.toBeNull();
    expect(manual.layout!.boundary.position).toEqual({ base: 16, left: -4, right: 26 });
  } finally { test.dispose(); }
});

it.each(([0, 90, 180, 270] as GridRotation[]).flatMap(rotation => ["none", "left", "right", "both"].map(mode => ({ rotation, mode }))))(
  "绝对空画布 $rotation 度/$mode 初始识别边界，有限方向受限且开放方向不产生顶边", async ({ rotation, mode }) => {
    const test = await openManualTask();
    let owner: ReturnType<typeof createEditableCanvasScene> | undefined;
    try {
      const { manual, app, session } = test;
      manual.setOrientation("fixed"); manual.setBoundaryRotation(rotation);
      manual.setBoundaryPosition({ base: 16, left: mode === "left" || mode === "both" ? 0 : null,
        right: mode === "right" || mode === "both" ? 24 : null });
      const focus = manual.initialViewRect();
      owner = createEditableCanvasScene({ appHost: app, session, readPalette: () => [], readOverlay: () => null, initialFocus: focus });
      const view = owner.canvas.view;
      view.actions.setViewportClientRect({ left: 10, top: 20, width: 460, height: 140 });
      const point = rotateManualPoint({ x: 12, y: 16 }, rotation);
      const projected = resolveViewportPointFromWorldPoint({ viewportBounds: view.state.clientRect, viewportCenter: view.state.center,
        gridCellPixelSize: view.state.gridCellPixelSize, displayRotation: view.state.displayRotation, worldPoint: point });
      expect(projected.x).toBeGreaterThanOrEqual(10);
      expect(projected.x).toBeLessThanOrEqual(470);
      expect(projected.y).toBeGreaterThanOrEqual(20);
      expect(projected.y).toBeLessThanOrEqual(160);
      const bounds = session.source.snapshot.getSnapshot().space.areas[0]!.bounds;
      expect(Object.values(bounds).filter(value => value !== null)).toHaveLength(mode === "none" ? 1 : mode === "both" ? 3 : 2);
      for (const delta of [-100_000, 100_000]) {
        view.actions.moveViewportByClientPixelVector({ startClientPixel: { x: 0, y: 0 }, endClientPixel: { x: delta, y: delta } });
        if (bounds.minX !== null) expect(view.state.center.x).toBeGreaterThanOrEqual(bounds.minX - 10);
        if (bounds.maxX !== null) expect(view.state.center.x).toBeLessThanOrEqual(bounds.maxX + 10);
        if (bounds.minY !== null) expect(view.state.center.y).toBeGreaterThanOrEqual(bounds.minY - 10);
        if (bounds.maxY !== null) expect(view.state.center.y).toBeLessThanOrEqual(bounds.maxY + 10);
      }
      // AI-REMOVED 2026-11-20:
      // Reason: 前两次相反方向平移后，释放再移动相同距离可能仅回到旧边界数值，绝对坐标 >1000 不是无界性判据。
      // Trigger: 定向单测出现 9 项旧阈值失败；主代理核对平移算式后批准精确位移断言。
      // Evidence: 0°/none 前位置 y=26-D，释放后 +D 得 y=26；source 四向 null，setBoundsPolicy 已收到四向 null。
      // Replacement: 下方比较真实平移前后差值及 gridCellPixelSize，临时 call-through 诊断结束。
      // Risk: Low；有限方向约束断言仍保留。Human Review: Required
      // Original code:
      // const policyCalls: unknown[] = [], spaceEvents: string[] = [];
      // const setPolicy = view.actions.setBoundsPolicy;
      // const policySpy = vi.spyOn(view.actions, "setBoundsPolicy").mockImplementation(policy => {
      // policyCalls.push(structuredClone(policy)); setPolicy(policy);
      // });
      // const stopSpaceTrace = session.source.snapshot.subscribe(snapshot => spaceEvents.push(JSON.stringify(snapshot.space.areas[0]!.bounds)));
      // manual.setBoundaryPosition(null);
      // stopSpaceTrace(); policySpy.mockRestore();
      // const beforeReleasedPan = { ...view.state.center };
      // view.actions.moveViewportByClientPixelVector({ startClientPixel: { x: 0, y: 0 }, endClientPixel: { x: -100_000, y: -100_000 } });
      // const releaseDiagnostic = JSON.stringify({ intent: session.snapshot.getSnapshot().intent,
      // bounds: session.source.snapshot.getSnapshot().space.areas[0]!.bounds, center: view.state.center, beforeReleasedPan, policyCalls, spaceEvents, sameSession: manual.session === session,
      // sourceDisposed: session.source.snapshot.getSnapshot().disposed, panAvailability: session.editor.queries.getOperationAvailability("pan-viewport") });
      // expect(view.state.center.x, releaseDiagnostic).toBeGreaterThan(1_000);
      // expect(view.state.center.y, releaseDiagnostic).toBeGreaterThan(1_000);
      manual.setBoundaryPosition(null);
      const beforeReleasedPan = { ...view.state.center }, pixelsPerCell = view.state.gridCellPixelSize;
      view.actions.moveViewportByClientPixelVector({ startClientPixel: { x: 0, y: 0 }, endClientPixel: { x: -100_000, y: -100_000 } });
      const releaseDiagnostic = JSON.stringify({ intent: session.snapshot.getSnapshot().intent,
        bounds: session.source.snapshot.getSnapshot().space.areas[0]!.bounds, center: view.state.center,
        beforeReleasedPan, pixelsPerCell, sameSession: manual.session === session,
        sourceDisposed: session.source.snapshot.getSnapshot().disposed });
      expect(manual.session).toBe(session);
      expect(session.source.snapshot.getSnapshot().space.areas[0]!.bounds).toEqual({ minX: null, minY: null, maxX: null, maxY: null });
      expect(view.state.center.x - beforeReleasedPan.x, releaseDiagnostic).toBeCloseTo(100_000 / pixelsPerCell, 6);
      expect(view.state.center.y - beforeReleasedPan.y, releaseDiagnostic).toBeCloseTo(100_000 / pixelsPerCell, 6);
    } finally { owner?.dispose(); test.dispose(); }
  });

it("选中设备净距以其完整占地测量，增删其他设备不改变底边或该设备参照", async () => {
  const test = await openManualTask();
  try {
    const { manual, controller, node, workspace, session } = test;
    manual.place(node, { x: 4, y: 5 });
    const entity = session.snapshot.getSnapshot().document.entities[node.id]!;
    const definition = workspace.registry.queries.findEntityDefinition(entity.definitionId)!;
    const rect = resolveEntityGridRect({ entity, definition });
    manual.setOrientation("fixed"); manual.setBoundaryRotation(0);
    const boundary = { base: rect.y + rect.height + 3, left: null, right: null };
    manual.setBoundaryPosition(boundary);
    manual.select(node.id);
    expect(manual.selectedDeviceBaseDistance()).toBe(3);
    await manual.prepare(controller.getRequest());
    const template = manual.layout!.preparation.facilityTemplates.find(candidate => candidate.purpose === "power")!;
    expect(template).toBeDefined();
    manual.addFacility(template, { x: 32, y: -24 });
    const facility = manual.layout!.facilities.at(-1)!;
    expect(facility).toBeDefined();
    manual.select(node.id);
    expect(manual.selectedDeviceBaseDistance()).toBe(3);
    expect(manual.layout!.boundary.position).toEqual(boundary);
    manual.select(facility.id); manual.remove(); manual.select(node.id);
    expect(manual.selectedDeviceBaseDistance()).toBe(3);
    expect(manual.layout!.boundary.position).toEqual(boundary);
  } finally { test.dispose(); }
});
