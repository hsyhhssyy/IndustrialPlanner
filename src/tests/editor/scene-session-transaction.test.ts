// @vitest-environment node
import { afterEach, describe, expect, it, vi } from "vitest";
import { createWorldDocument } from "@/domain/document/world-document";
import { EntityCollectionType } from "@/domain/editor/types/editor-types";
import type { EditorSessionPolicy } from "@/domain/editor/types/editor-session-types";
import { createEditorRuntime } from "@/editor/editor-host";
import { createRegistryContract } from "@/registry";

interface Intent { enabled: boolean; members: readonly string[] }
const dispose: Array<() => void> = [];
afterEach(() => { while (dispose.length) dispose.pop()!(); vi.restoreAllMocks(); });

function createRuntime(control: { failReducer?: boolean; reject?: boolean } = {}) {
  const registry = createRegistryContract();
  const policy: EditorSessionPolicy<Intent> = {
    getOperationAvailability: () => ({ supported: true, enabled: true, reason: null }),
    resolvePlacementAreaIds: (_entity, space) => space.areas.map((area) => area.id),
    validateTransition: () => control.reject ? ["rejected"] : [],
  };
  const editor = createEditorRuntime({ registry }, {
    persistence: "memory", initialDocument: createWorldDocument({ baseId: "draft_box" }),
    initialIntent: { enabled: true, members: [] } as Intent, policy,
    reduceIntent: (intent, transition) => {
      if (control.failReducer) throw new Error("Reducer failed");
      return { ...intent, members: [...transition.after.entityOrder] };
    },
  });
  dispose.push(editor.dispose);
  return editor;
}

function place(editor: ReturnType<typeof createRuntime>, entityId = "stable-node") {
  editor.actions.createSinglePlacementDraft({
    definitionId: "storager_1", centerGridPoint: { x: 35, y: 35 }, entityId,
    config: { nested: { value: "retained" } },
  });
}

describe("会话原子事务与稳定身份", () => {
  it("原位确认接受合法移动并清理预览，不增加历史；策略拒绝仍保留预览", () => {
    const control = { reject: false };
    const editor = createRuntime(control);
    place(editor);
    expect(editor.actions.applyPlacementDraft()).toBe(true);
    editor.actions.addToCollection({ collectionType: EntityCollectionType.selection, entityId: "stable-node" });
    const before = editor.internalSessionSnapshot.getSnapshot();
    const sequence = editor.state.history.cursorSequence;
    editor.actions.createMoveOperationDraft();
    control.reject = true;
    expect(editor.actions.applyMoveOerationDraft()).toBe(false);
    expect(editor.state.collections.preview).toHaveLength(1);
    control.reject = false;
    expect(editor.actions.applyMoveOerationDraft()).toBe(true);
    expect(editor.state.collections.preview).toHaveLength(0);
    // AI-REMOVED 2026-11-12:
    // Reason: 单设备移动成功后沿用既有清空选择语义，原位确认只新增“不记录空历史”的要求。
    // Trigger: REQ-048 原位确认测试新增时误将批量移动选择保留规则套用于单设备。
    // Evidence: applyMoveOerationDraft 的 ghostEntityIds.size === 1 分支。
    // Replacement: 下方检查既有清理语义；原子快照与历史断言保持。
    // Risk: Low；Human Review: Required
    // Original code:
    // expect([...editor.state.collections.selection]).toEqual(["stable-node"]);
    expect([...editor.state.collections.selection]).toEqual([]);
    expect(editor.state.history.cursorSequence).toBe(sequence);
    expect(editor.internalSessionSnapshot.getSnapshot()).toBe(before);
  });
  it("无 DOM 和 Workspace 创建，文档订阅同时观察新意图与新历史游标", () => {
    expect(typeof document).toBe("undefined");
    const editor = createRuntime();
    const observed: unknown[] = [];
    editor.document.subscribe((document) => observed.push({
      ids: document.entityOrder,
      intent: editor.internalSessionSnapshot.getSnapshot().intent,
      cursor: editor.state.history.cursorSequence,
    }));
    place(editor);
    expect(editor.actions.applyPlacementDraft()).toBe(true);
    expect(observed).toHaveLength(2);
    expect(observed[1]).toEqual({ ids: ["stable-node"], intent: { enabled: true, members: ["stable-node"] }, cursor: 1 });
    expect(editor.document.getSnapshot().entities["stable-node"]!.config).toMatchObject({ nested: { value: "retained" } });
    expect(editor.state.history.records[0]!.action.entityIds).toEqual(["stable-node"]);
  });

  it.each(["failReducer", "reject"] as const)("%s 不改变文档、意图、历史或预览，随后仍可确认", (failure) => {
    const control: { failReducer?: boolean; reject?: boolean } = {};
    const editor = createRuntime(control);
    place(editor);
    const before = editor.internalSessionSnapshot.getSnapshot();
    control[failure] = true;
    if (failure === "failReducer") expect(() => editor.actions.applyPlacementDraft()).toThrow("Reducer failed");
    else expect(editor.actions.applyPlacementDraft()).toBe(false);
    expect(editor.internalSessionSnapshot.getSnapshot()).toBe(before);
    expect(editor.state.history.cursorSequence).toBe(0);
    expect([...editor.state.collections.preview]).toEqual(["stable-node"]);
    expect(editor.internalState.drafts).toHaveLength(1);
    control[failure] = false;
    expect(editor.actions.applyPlacementDraft()).toBe(true);
  });

  it("几何编辑和纯意图共享撤销、重做、跳转与分支裁剪", () => {
    const editor = createRuntime();
    place(editor);
    expect(editor.actions.applyPlacementDraft()).toBe(true);
    const action = { type: "session.intent" as const, label: "关闭人工模式" };
    expect(editor.internalDocumentWriter.commitIntent({ enabled: false, members: ["stable-node"] }, action)).toBe(true);
    expect(editor.state.history.records).toHaveLength(2);
    expect(editor.actions.undoDocumentHistory()).toBe(true);
    expect(editor.internalSessionSnapshot.getSnapshot().intent.enabled).toBe(true);
    expect(editor.document.getSnapshot().entityOrder).toEqual(["stable-node"]);
    expect(editor.actions.undoDocumentHistory()).toBe(true);
    expect(editor.internalSessionSnapshot.getSnapshot().intent.members).toEqual([]);
    expect(editor.document.getSnapshot().entityOrder).toEqual([]);
    expect(editor.actions.restoreDocumentHistoryTo(2)).toBe(true);
    expect(editor.internalSessionSnapshot.getSnapshot().intent).toEqual({ enabled: false, members: ["stable-node"] });
    expect(editor.actions.restoreDocumentHistoryTo(0)).toBe(true);
    expect(editor.internalSessionSnapshot.getSnapshot().intent).toEqual({ enabled: true, members: [] });
    expect(editor.actions.redoDocumentHistory()).toBe(true);
    const abandoned = editor.state.history.records[1]!;
    expect(editor.internalDocumentWriter.commitIntent({ enabled: true, members: ["changed"] }, action)).toBe(true);
    expect(editor.internalHistory.getIntentChange(abandoned)).toBeUndefined();
    expect(editor.actions.redoDocumentHistory()).toBe(false);
    editor.actions.clearDocumentHistory();
    expect(editor.state.history.records).toHaveLength(0);
    expect(editor.actions.undoDocumentHistory()).toBe(false);
  });

  it("显式身份重复拒绝，未指定身份仍按既有格式分配，删除撤销恢复原身份", () => {
    const editor = createRuntime();
    place(editor);
    expect(editor.actions.applyPlacementDraft()).toBe(true);
    place(editor);
    expect(editor.state.collections.preview).toHaveLength(0);
    editor.actions.createSinglePlacementDraft({ definitionId: "storager_1", centerGridPoint: { x: 55, y: 55 } });
    expect(editor.actions.applyPlacementDraft()).toBe(true);
    expect(editor.document.getSnapshot().entityOrder).toEqual(["stable-node", "storager_1:1"]);
    editor.actions.addToCollection({ collectionType: EntityCollectionType.selection, entityId: "stable-node" });
    editor.actions.deleteCollection(EntityCollectionType.selection);
    expect(editor.document.getSnapshot().entities["stable-node"]).toBeUndefined();
    expect(editor.internalSessionSnapshot.getSnapshot().intent.members).toEqual(["storager_1:1"]);
    expect(editor.actions.undoDocumentHistory()).toBe(true);
    expect(editor.document.getSnapshot().entities["stable-node"]!.config).toMatchObject({ nested: { value: "retained" } });
    expect(editor.internalSessionSnapshot.getSnapshot().intent.members).toEqual(["stable-node", "storager_1:1"]);
  });

  it("订阅者抛错不会阻断其他订阅或已提交动作", () => {
    const editor = createRuntime();
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    editor.document.subscribe((_document) => { if (_document.entityOrder.length) throw new Error("consumer failed"); });
    const notified = vi.fn();
    const committed = vi.fn();
    editor.document.subscribe(notified);
    editor.queries.subscribeCommittedEdits(committed);
    place(editor);
    expect(editor.actions.applyPlacementDraft()).toBe(true);
    expect(notified).toHaveBeenCalledTimes(2);
    expect(committed).toHaveBeenCalledTimes(1);
    expect(error).toHaveBeenCalled();
    expect(editor.state.collections.preview).toHaveLength(0);
  });
});
