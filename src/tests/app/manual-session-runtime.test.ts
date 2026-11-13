import { expect, it } from "vitest";
import { createAppTestWorkspace } from "../helpers/app-test-workspace";
import { createBlueprintPlannerHost } from "@/blueprint-planner/blueprint-planner-host";
import type { BlueprintPlannerRequest } from "@/domain/blueprint-planner";
import { EntityCollectionType } from "@/domain/editor/types/editor-types";
import input from "../blueprint-planner/fixtures/environment-supply.json";

async function openManualTask() {
  const { workspace, app } = createAppTestWorkspace();
  const planner = createBlueprintPlannerHost(workspace, { storage: null });
  const controller = app.blueprintPlannerDialog;
  await controller.open((input as BlueprintPlannerRequest).plan);
  controller.updateOptions((input as BlueprintPlannerRequest).options);
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
