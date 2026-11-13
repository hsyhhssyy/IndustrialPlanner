// @vitest-environment node
import { afterEach, describe, expect, it, vi } from "vitest";
import { createWorldDocument } from "@/domain/document/world-document";
import type { EditorSessionPolicy } from "@/domain/editor/types/editor-session-types";
import type { SceneSpace } from "@/domain/shared/scene-space";
import { EntityCollectionType } from "@/domain/editor/types/editor-types";
import { createSceneSessionFactories } from "@/editor/scene-session";
import { createRegistryContract } from "@/registry";

const factories = createSceneSessionFactories(createRegistryContract());
const cleanups: Array<() => void> = [];
afterEach(() => { while (cleanups.length) cleanups.pop()!(); });
const space: SceneSpace = { areas: [{ id: "task", bounds: { minX: 0, minY: 0, maxX: 70, maxY: 70 }, outerRing: { top: 0, bottom: 0, left: 0, right: 0 } }] };
const policy: EditorSessionPolicy<boolean> = {
  getOperationAvailability: (operation) => ({ supported: operation !== "configure-device", enabled: operation !== "configure-device", reason: null }),
  resolvePlacementAreaIds: () => ["task"], validateTransition: () => [],
};
function session(id: string) {
  const session = factories.createMemorySession({ id, initialDocument: createWorldDocument({ baseId: "wuling_agricultural_land" }),
    initialIntent: true, space, policy, reduceIntent: (intent) => intent });
  cleanups.push(session.dispose);
  return session;
}

describe("统一场景源", () => {
  it("独立 View 的悬停写入和清理原子通知场景，不产生 action 警告或文档历史", () => {
    const current = session("hover");
    const view = factories.createView({ id: "hover-view",
      initialViewport: { center: { x: 12, y: 12 }, gridSize: 1, displayRotation: 0 },
      bounds: { kind: "space", bounds: space.areas[0]!.bounds, padding: 0 },
      getOperationAvailability: current.editor.queries.getOperationAvailability,
    });
    view.actions.setViewportClientRect({ left: 0, top: 0, width: 160, height: 160 });
    const before = current.snapshot.getSnapshot();
    const observed: Array<{ x: number; y: number } | null> = [];
    const stop = current.source.snapshot.subscribe(snapshot => observed.push(snapshot.interaction?.hoverTarget?.gridPoint ?? null));
    const warn = vi.spyOn(console, "warn");
    try {
      current.editor.actions.setHoverPoint({ x: 80, y: 80 }, view.state);
      expect(current.source.snapshot.getSnapshot().interaction?.hoverTarget).toEqual({ entity: null, gridPoint: { x: 12, y: 12 } });
      current.editor.actions.clearHoverPoint();
      expect(current.source.snapshot.getSnapshot().interaction?.hoverTarget).toBeNull();
      current.editor.actions.setHoverPoint({ x: 80, y: 80 }, view.state);
      view.actions.setViewportClientRect({ left: 0, top: 0, width: 0, height: 0 });
      current.editor.actions.setHoverPoint({ x: 80, y: 80 }, view.state);
      expect(observed).toEqual([null, { x: 12, y: 12 }, null, { x: 12, y: 12 }, null]);
      expect(current.snapshot.getSnapshot()).toBe(before);
      expect(current.editor.state.history.cursorSequence).toBe(0);
      expect(warn).not.toHaveBeenCalled();
    } finally { stop(); warn.mockRestore(); view.dispose(); }
  });

  it("内存会话使用任务空间与资格，不附带来源基地内置实体，且会话互不影响", () => {
    const left = session("left"), right = session("right");
    expect(typeof document).toBe("undefined");
    expect(left.source.queries.listEntities()).toEqual([]);
    expect(right.source.queries.listEntities()).toEqual([]);
    left.editor.actions.createSinglePlacementDraft({ definitionId: "storager_1", entityId: "node", centerGridPoint: { x: 12, y: 12 } });
    expect(left.editor.queries.getEntityPlacementValidation("node").reasons.some((reason) => reason.code === "outside-base")).toBe(false);
    expect(left.editor.actions.applyPlacementDraft()).toBe(true);
    expect(left.source.queries.listEntities().map((entity) => entity.id)).toEqual(["node"]);
    expect(right.source.queries.listEntities()).toEqual([]);
    expect(right.editor.state.history.cursorSequence).toBe(0);
    expect(left.snapshot.getSnapshot().intent).toBe(true);
  });

  it("瞬态选择与虚影唤醒源，直接调用被禁写动作也不能绕过 policy", () => {
    const current = session("selection");
    const revisions: number[] = [];
    current.source.snapshot.subscribe((snapshot) => revisions.push(snapshot.revision));
    current.editor.actions.createSinglePlacementDraft({ definitionId: "storager_1", entityId: "node", centerGridPoint: { x: 12, y: 12 } });
    expect(revisions.length).toBeGreaterThan(1);
    expect(current.editor.actions.applyPlacementDraft()).toBe(true);
    const before = current.source.snapshot.getSnapshot().revision;
    current.editor.actions.addToCollection({ collectionType: EntityCollectionType.selection, entityId: "node" });
    expect(current.source.snapshot.getSnapshot().revision).toBeGreaterThan(before);
    expect(current.source.snapshot.getSnapshot().interaction?.collections.selection).toContain("node");
    const document = current.snapshot.getSnapshot().document;
    current.editor.actions.patchEntityConfig("node", { forbidden: true });
    expect(current.snapshot.getSnapshot().document).toBe(document);
    expect(current.editor.queries.getOperationAvailability("configure-device").supported).toBe(false);
  });

  it("只读源提供实体与校验查询，替换和销毁均通知，但不暴露编辑或历史", () => {
    const editable = session("editable");
    editable.editor.actions.createSinglePlacementDraft({ definitionId: "storager_1", entityId: "node", centerGridPoint: { x: 12, y: 12 } });
    expect(editable.editor.actions.applyPlacementDraft()).toBe(true);
    const readonly = factories.createReadonlySource({ id: "readonly", document: editable.snapshot.getSnapshot().document, space });
    cleanups.push(readonly.dispose);
    const observed: boolean[] = [];
    readonly.source.snapshot.subscribe((snapshot) => observed.push(snapshot.disposed));
    expect(readonly.source.snapshot.getSnapshot().interaction).toBeNull();
    expect("actions" in readonly.source).toBe(false);
    expect("history" in readonly.source).toBe(false);
    expect(readonly.source.queries.getEntityById("node")?.definitionId).toBe("storager_1");
    expect(readonly.source.queries.getEntityPlacementValidation("node").reasons.some((reason) => reason.code === "outside-base")).toBe(false);
    readonly.replace(createWorldDocument(), space);
    expect(readonly.source.queries.listEntities()).toEqual([]);
    readonly.dispose();
    readonly.dispose();
    readonly.replace(editable.snapshot.getSnapshot().document, space);
    expect(observed).toEqual([false, false, true]);
    expect(readonly.source.queries.listEntities()).toEqual([]);
  });

  it("销毁后的会话拒绝写入，来源销毁只通知一次", () => {
    const current = session("disposed");
    let disposedNotifications = 0;
    current.source.snapshot.subscribe((snapshot) => { if (snapshot.disposed) disposedNotifications += 1; });
    current.dispose();
    current.dispose();
    const before = current.snapshot.getSnapshot();
    expect(current.commitIntent(false, { type: "session.intent", label: "关闭" })).toBe(false);
    current.editor.actions.createSinglePlacementDraft({ definitionId: "storager_1", entityId: "late", centerGridPoint: { x: 12, y: 12 } });
    expect(current.snapshot.getSnapshot()).toBe(before);
    expect(current.source.queries.listEntities()).toEqual([]);
    expect(disposedNotifications).toBe(1);
  });
});
