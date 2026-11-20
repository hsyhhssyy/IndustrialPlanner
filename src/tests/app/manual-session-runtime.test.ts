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
