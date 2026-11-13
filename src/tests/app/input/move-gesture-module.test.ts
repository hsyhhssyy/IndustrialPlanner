import type { CanvasRightDockToolbarItemRequest } from "@/app/state";
import { createCanvasTestSession } from "@/tests/helpers/canvas-test-session";
const cleanups: Array<() => void> = [];
afterEach(() => { for (const dispose of cleanups.splice(0).reverse()) dispose(); vi.restoreAllMocks(); });
import { loadBlueprintFromFile, getBlueprintEntityArray, createWorldDocumentFromBlueprint } from "@/tests/simulation/blueprint-test-helpers";
import { afterEach, describe, expect, it, vi } from "vitest";

// AI-REMOVED 2026-11-12:
// Reason: 旧假 App、Editor、视口及集合已不适用于独立 Canvas。
// Trigger: REQ-048 场景接口迁移。
// Evidence: 移动草稿、坐标换算和选择来自真实会话动作。
// Replacement: createCanvasTestSession 与版本化场景；原行为覆盖保留。
// Risk: 实际鼠标触控布局另由浏览器验收。
// Human Review: Required
// Original code:
// import { SHORTCUT_KEY } from "@/app/actions/keyboard-shortcut-manager";

// AI-REMOVED 2026-11-12:
// Reason: 旧假 App、Editor、视口及集合已不适用于独立 Canvas。
// Trigger: REQ-048 场景接口迁移。
// Evidence: 移动草稿、坐标换算和选择来自真实会话动作。
// Replacement: createCanvasTestSession 与版本化场景；原行为覆盖保留。
// Risk: 实际鼠标触控布局另由浏览器验收。
// Human Review: Required
// Original code:
// import type { AppHost } from "@/app/host/app-host";

// AI-REMOVED 2026-11-12:
// Reason: 旧假 App、Editor、视口及集合已不适用于独立 Canvas。
// Trigger: REQ-048 场景接口迁移。
// Evidence: 移动草稿、坐标换算和选择来自真实会话动作。
// Replacement: createCanvasTestSession 与版本化场景；原行为覆盖保留。
// Risk: 实际鼠标触控布局另由浏览器验收。
// Human Review: Required
// Original code:
// import type { KeyboardSnapshot } from "@/app/input/gesture/adapter";

// AI-REMOVED 2026-11-12:
// Reason: 旧假 App、Editor、视口及集合已不适用于独立 Canvas。
// Trigger: REQ-048 场景接口迁移。
// Evidence: 移动草稿、坐标换算和选择来自真实会话动作。
// Replacement: createCanvasTestSession 与版本化场景；原行为覆盖保留。
// Risk: 实际鼠标触控布局另由浏览器验收。
// Human Review: Required
// Original code:
// import type { CanvasRightDockToolbarItemRequest } from "@/app/state/state-impl";

import {
  createHypergryphMoveGestureModule,

} from "@/app/input/gesture/actions";
// AI-REMOVED 2026-11-12:
// Reason: 旧假 App、Editor、视口及集合已不适用于独立 Canvas。
// Trigger: REQ-048 场景接口迁移。
// Evidence: 移动草稿、坐标换算和选择来自真实会话动作。
// Replacement: createCanvasTestSession 与版本化场景；原行为覆盖保留。
// Risk: 实际鼠标触控布局另由浏览器验收。
// Human Review: Required
// Original code:
// import { WorkbenchOverlapEntityMenuController } from "@/app/shell/state/overlap-entity-menu-state";

// AI-REMOVED 2026-11-12:
// Reason: 旧假 App、Editor、视口及集合已不适用于独立 Canvas。
// Trigger: REQ-048 场景接口迁移。
// Evidence: 移动草稿、坐标换算和选择来自真实会话动作。
// Replacement: createCanvasTestSession 与版本化场景；原行为覆盖保留。
// Risk: 实际鼠标触控布局另由浏览器验收。
// Human Review: Required
// Original code:
// import type { WorkspaceContract } from "@/domain/document/workspace-contract";

// AI-REMOVED 2026-11-12:
// Reason: 旧假 App、Editor、视口及集合已不适用于独立 Canvas。
// Trigger: REQ-048 场景接口迁移。
// Evidence: 移动草稿、坐标换算和选择来自真实会话动作。
// Replacement: createCanvasTestSession 与版本化场景；原行为覆盖保留。
// Risk: 实际鼠标触控布局另由浏览器验收。
// Human Review: Required
// Original code:
// import type { EditorContract } from "@/domain/editor/editor-contract";

import { createWorldDocument, type WorldEntity } from "@/domain/document/world-document";
import {
  EntityCollectionType,

} from "@/domain/editor/types/editor-types";
import type { ActiveTool } from "@/domain/app/types/app-types";
import type { GridPoint, GridRect } from "@/domain/shared/grid";
// AI-REMOVED 2026-11-12:
// Reason: 旧假 App、Editor、视口及集合已不适用于独立 Canvas。
// Trigger: REQ-048 场景接口迁移。
// Evidence: 移动草稿、坐标换算和选择来自真实会话动作。
// Replacement: createCanvasTestSession 与版本化场景；原行为覆盖保留。
// Risk: 实际鼠标触控布局另由浏览器验收。
// Human Review: Required
// Original code:
// import { createRegistryContract } from "@/registry";

import { handleKeyboardShortcutThroughRouter } from "./shortcut-route-test-helper";

describe("createHypergryphMoveGestureModule", () => {
  it("opens the overlap entity menu before entering move from a stacked long-press cell", () => {
    // AI-REMOVED 2026-11-12:
// Reason: 重叠菜单的所有者已是 Canvas。
// Trigger: REQ-048 场景接口迁移。
// Evidence: 移动草稿、坐标换算和选择来自真实会话动作。
// Replacement: createCanvasTestSession 与版本化场景；原行为覆盖保留。
// Risk: 实际鼠标触控布局另由浏览器验收。
// Human Review: Required
// Original code:
// const overlapEntityMenu = new WorkbenchOverlapEntityMenuController();

    // AI-REMOVED 2026-09-14:
    // Reason: 场景构造已批量固化为带版本的蓝图文件。
    // Trigger: 用户要求测试通过蓝图文件装载场景，保留版本便于后续迁移。
    // Evidence: 原构造表达式已解析为完整实体集合，按正式迁移规则保存。
    // Replacement: src/tests/fixtures/blueprints/simulation/move-gesture-module/index.json
    // AI-CORRECTION 2026-09-14: 上述自动归档路径按仿真目录生成；实际替代场景索引为 src/tests/fixtures/blueprints/collections-extra/app/input/move-gesture-module/index.json。
    // Risk: Low；断言与被测动作不变。
    // Human Review: Required
    // Original code:
    // const bottomEntity = entity("bottom-overlap-entity", { x: 2, y: 2 });
    const topEntity = entity("top-overlap-entity", { x: 2, y: 2 }, "pipe_straight_1x1");
    // AI-REMOVED 2026-09-14:
    // Reason: 场景构造已批量固化为带版本的蓝图文件。
    // Trigger: 用户要求测试通过蓝图文件装载场景，保留版本便于后续迁移。
    // Evidence: 原构造表达式已解析为完整实体集合，按正式迁移规则保存。
    // Replacement: src/tests/fixtures/blueprints/collections-extra/app/input/move-gesture-module/index.json
    // Risk: Low；断言与被测动作不变。
    // Human Review: Required
    // Original code:
    // [bottomEntity, topEntity]
    // AI-REMOVED 2026-11-12: Reason: Canvas 迁移后旧解构未使用；Trigger: REQ-048；Evidence: ESLint；Replacement: context.canvas；Risk: Low；Human Review: Required
    // Original code: const { context, editor, appHost } = createContext({
    const { context, editor } = createContext({

      listedEntities: getBlueprintEntityArray(loadBlueprintFromFile("src/tests/fixtures/blueprints/collections-extra/app/input/move-gesture-module/scene-01-variant-1.schema7.json")),
    });
    const overlapEntityMenu = context.canvas.overlapEntityMenu;
    const module = createHypergryphMoveGestureModule();

    const result = module.handle(
      mouseLongPressReadyEvent({
        pointerEntity: topEntity,
        position: { x: 2, y: 2 },
      }),
      context,
    );

    expect(result).toEqual({ status: "handled" });
    expect(overlapEntityMenu.visible).toBe(true);
    expect(overlapEntityMenu.candidates.map((candidate) => candidate.entityId)).toEqual([
      "top-overlap-entity",
      "bottom-overlap-entity",
    ]);
    expect(editor.actions.createMoveOperationDraft).not.toHaveBeenCalled();

    overlapEntityMenu.select("bottom-overlap-entity");

    expect(editor.actions.clearCollection).toHaveBeenCalledWith(EntityCollectionType.selection);
    expect(editor.actions.addToCollection).toHaveBeenCalledWith({
      collectionType: EntityCollectionType.selection,
      entityId: "bottom-overlap-entity",
    });
    expect(editor.actions.createMoveOperationDraft).toHaveBeenCalledTimes(1);
    expect(context.canvas.actions.setActiveTool).toHaveBeenCalledWith("move");
  });

  it("resolves immediate-drag overlap candidates from the drag start position", () => {
    // AI-REMOVED 2026-11-12:
// Reason: 重叠菜单的所有者已是 Canvas。
// Trigger: REQ-048 场景接口迁移。
// Evidence: 移动草稿、坐标换算和选择来自真实会话动作。
// Replacement: createCanvasTestSession 与版本化场景；原行为覆盖保留。
// Risk: 实际鼠标触控布局另由浏览器验收。
// Human Review: Required
// Original code:
// const overlapEntityMenu = new WorkbenchOverlapEntityMenuController();

    // AI-REMOVED 2026-09-14:
    // Reason: 场景构造已批量固化为带版本的蓝图文件。
    // Trigger: 用户要求测试通过蓝图文件装载场景，保留版本便于后续迁移。
    // Evidence: 原构造表达式已解析为完整实体集合，按正式迁移规则保存。
    // Replacement: src/tests/fixtures/blueprints/simulation/move-gesture-module/index.json
    // AI-CORRECTION 2026-09-14: 上述自动归档路径按仿真目录生成；实际替代场景索引为 src/tests/fixtures/blueprints/collections-extra/app/input/move-gesture-module/index.json。
    // Risk: Low；断言与被测动作不变。
    // Human Review: Required
    // Original code:
    // const bottomEntity = entity("bottom-overlap-entity", { x: 2, y: 2 });
    // AI-REMOVED 2026-09-14:
    // Reason: 场景构造已批量固化为带版本的蓝图文件。
    // Trigger: 用户要求测试通过蓝图文件装载场景，保留版本便于后续迁移。
    // Evidence: 原构造表达式已解析为完整实体集合，按正式迁移规则保存。
    // Replacement: src/tests/fixtures/blueprints/simulation/move-gesture-module/index.json
    // AI-CORRECTION 2026-09-14: 上述自动归档路径按仿真目录生成；实际替代场景索引为 src/tests/fixtures/blueprints/collections-extra/app/input/move-gesture-module/index.json。
    // Risk: Low；断言与被测动作不变。
    // Human Review: Required
    // Original code:
    // const topEntity = entity("top-overlap-entity", { x: 2, y: 2 }, "pipe_straight_1x1");
    // AI-REMOVED 2026-09-14:
    // Reason: 场景构造已批量固化为带版本的蓝图文件。
    // Trigger: 用户要求测试通过蓝图文件装载场景，保留版本便于后续迁移。
    // Evidence: 原构造表达式已解析为完整实体集合，按正式迁移规则保存。
    // Replacement: src/tests/fixtures/blueprints/collections-extra/app/input/move-gesture-module/index.json
    // Risk: Low；断言与被测动作不变。
    // Human Review: Required
    // Original code:
    // [bottomEntity, topEntity]
    const { context, editor } = createContext({

      listedEntities: getBlueprintEntityArray(loadBlueprintFromFile("src/tests/fixtures/blueprints/collections-extra/app/input/move-gesture-module/scene-02-variant-1.schema7.json")),
    });
    const overlapEntityMenu = context.canvas.overlapEntityMenu;
    const module = createHypergryphMoveGestureModule();

    const result = module.handle(
      mouseDragStartEvent({
        originButton: 0,
        pointerEntity: null,
        startPosition: { x: 2, y: 2 },
        position: { x: 3, y: 2 },
      }),
      context,
    );

    expect(result).toEqual({ status: "handled" });
    expect(overlapEntityMenu.visible).toBe(true);
    expect(overlapEntityMenu.candidates.map((candidate) => candidate.entityId)).toEqual([
      "top-overlap-entity",
      "bottom-overlap-entity",
    ]);
    expect(editor.actions.createMoveOperationDraft).not.toHaveBeenCalled();
  });

  it("enters mouse move from select by selecting the pointer entity first", () => {
    // AI-REMOVED 2026-11-12: Reason: Canvas 迁移后旧解构未使用；Trigger: REQ-048；Evidence: ESLint；Replacement: context.canvas；Risk: Low；Human Review: Required
    // Original code: const { context, editor, appHost } = createContext();
    const { context, editor } = createContext();
    const module = createHypergryphMoveGestureModule();

    const result = module.handle(
      mouseLongPressReadyEvent({
        pointerEntity: entity("unselected-entity", { x: 4, y: 4 }),
        position: { x: 4, y: 4 },
      }),
      context,
    );

    expect(result).toEqual({ status: "handled" });
    expect(editor.actions.clearCollection).toHaveBeenCalledWith(
      EntityCollectionType.selection,
    );
    expect(editor.actions.addToCollection).toHaveBeenCalledWith({
      collectionType: EntityCollectionType.selection,
      entityId: "unselected-entity",
    });
    expect(editor.actions.createMoveOperationDraft).toHaveBeenCalledTimes(1);
    expect(context.canvas.state.activeTool).toBe("move");
    expect(context.canvas.state.runtime.moveAnchor).toBeNull();
    expect(editor.actions.moveCollectionCenterPointTo).toHaveBeenCalledWith(
      EntityCollectionType.preview,
      { x: 4, y: 4 }, context.canvas.view.state,
    );
    expect(context.canvas.state.runtime.moveEnterFrom).toBe("select");
    expect(context.canvas.state.moveKind).toBe("ordinary");
    expect(context.canvas.actions.hideCanvasFloatingToolbar).not.toHaveBeenCalled();

    expect(module.handle(onEnterActiveToolEvent("select", "move"), context)).toEqual({
      status: "handled",
    });
    expect(context.canvas.actions.hideCanvasFloatingToolbar).toHaveBeenCalled();
  });

  it("requires an existing selection when mouse move enters from marquee", () => {
    const missed = createContext({
      activeTool: "marquee",
    });
    const handled = createContext({
      activeTool: "marquee",
    });
    const module = createHypergryphMoveGestureModule();

    const missedResult = module.handle(
      mouseLongPressReadyEvent({
        pointerEntity: entity("unselected-entity", { x: 4, y: 4 }),
        position: { x: 4, y: 4 },
      }),
      missed.context,
    );

    const result = module.handle(
      mouseLongPressReadyEvent({
        pointerEntity: entity("selected-entity", { x: 2, y: 2 }),
      }),
      handled.context,
    );

    expect(missedResult).toEqual({ status: "ignored" });
    expect(missed.editor.actions.createMoveOperationDraft).not.toHaveBeenCalled();
    expect(missed.context.canvas.state.activeTool).toBe("marquee");
    expect(result).toEqual({ status: "handled" });
    expect(handled.editor.actions.createMoveOperationDraft).toHaveBeenCalledTimes(1);
    expect(handled.context.canvas.state.activeTool).toBe("move");
    expect(handled.context.canvas.state.runtime.moveAnchor).toBeNull();
    expect(handled.editor.actions.moveCollectionCenterPointTo).toHaveBeenCalledWith(
      EntityCollectionType.preview,
      { x: 2, y: 2 }, handled.context.canvas.view.state,
    );
    expect(handled.context.canvas.state.runtime.moveEnterFrom).toBe("marquee");
    expect(handled.context.canvas.state.moveKind).toBe("batch");
  });

  it("enters touch move from select by selecting the pointer entity first", () => {
    const marquee = createContext({
      activeTool: "marquee",
    });
    const select = createContext();
    const module = createHypergryphMoveGestureModule();

    const marqueeResult = module.handle(
      tapLongPressReadyEvent({
        pointerEntity: entity("selected-entity", { x: 2, y: 2 }),
      }),
      marquee.context,
    );
    const selectResult = module.handle(
      tapLongPressReadyEvent({
        pointerEntity: entity("unselected-entity", { x: 4, y: 4 }),
        position: { x: 4, y: 4 },
      }),
      select.context,
    );

    expect(marqueeResult).toEqual({ status: "ignored" });
    expect(marquee.editor.actions.createMoveOperationDraft).not.toHaveBeenCalled();
    expect(selectResult).toEqual({ status: "handled" });
    expect(select.editor.actions.clearCollection).toHaveBeenCalledWith(
      EntityCollectionType.selection,
    );
    expect(select.editor.actions.addToCollection).toHaveBeenCalledWith({
      collectionType: EntityCollectionType.selection,
      entityId: "unselected-entity",
    });
    expect(select.editor.actions.createMoveOperationDraft).toHaveBeenCalledTimes(1);
    expect(select.context.canvas.state.activeTool).toBe("move");
    expect(select.context.canvas.state.runtime.moveEnterFrom).toBe("select");
    expect(select.context.canvas.actions.showCanvasFloatingToolbarForCollection).not.toHaveBeenCalled();

    expect(
      module.handle(onEnterActiveToolEvent("select", "move"), select.context),
    ).toEqual({ status: "handled" });
    expect(select.context.canvas.actions.showCanvasFloatingToolbarForCollection).toHaveBeenCalledWith(
      MOVE_TOOLBAR_BUTTON_IDS_FOR_TEST,
      EntityCollectionType.preview,
    );
  });

  it("enters move from the marquee right dock button and initializes the touch move ui", () => {
    // AI-REMOVED 2026-11-12: Reason: Canvas 迁移后旧解构未使用；Trigger: REQ-048；Evidence: ESLint；Replacement: context.canvas；Risk: Low；Human Review: Required
    // Original code: const { context, editor, appHost } = createContext({
    const { context, editor } = createContext({
      activeTool: "marquee",
    });
    const module = createHypergryphMoveGestureModule();

    const result = module.handle(
      uiButtonTouchTapEvent("canvas-right-dock-toolbar-button-move"),
      context,
    );

    expect(result).toEqual({ status: "handled" });
    expect(editor.actions.createMoveOperationDraft).toHaveBeenCalledTimes(1);
    expect(context.canvas.state.activeTool).toBe("move");
    expect(context.canvas.state.runtime.moveAnchor).toBeNull();
    expect(context.canvas.state.runtime.moveEnterFrom).toBe("marquee");
    expect(context.canvas.actions.showCanvasFloatingToolbarForCollection).not.toHaveBeenCalled();

    expect(
      module.handle(onEnterActiveToolEvent("marquee", "move"), context),
    ).toEqual({ status: "handled" });
    expect(context.canvas.actions.showCanvasFloatingToolbarForCollection).toHaveBeenCalledWith(
      MOVE_TOOLBAR_BUTTON_IDS_FOR_TEST,
      EntityCollectionType.preview,
    );
  });

  it("enters move from marquee via M key shortcut when selection is non-empty", () => {
    // AI-REMOVED 2026-11-12: Reason: Canvas 迁移后旧解构未使用；Trigger: REQ-048；Evidence: ESLint；Replacement: context.canvas；Risk: Low；Human Review: Required
    // Original code: const { context, editor, appHost } = createContext({
    const { context, editor } = createContext({
      activeTool: "marquee",
    });
    const module = createHypergryphMoveGestureModule();

    const result = handleKeyboardShortcutThroughRouter({
      module,
      context,
      event: keyDownEvent({ code: "KeyM", key: "m" }),
    });

    expect(result).toEqual({ status: "handled" });
    expect(editor.actions.createMoveOperationDraft).toHaveBeenCalledTimes(1);
    expect(context.canvas.state.activeTool).toBe("move");
    expect(context.canvas.state.runtime.moveAnchor).toBeNull();
    expect(context.canvas.state.runtime.moveEnterFrom).toBe("marquee");
  });

  it("enters move from select via M key shortcut when selection is non-empty", () => {
    // AI-REMOVED 2026-11-12: Reason: Canvas 迁移后旧解构未使用；Trigger: REQ-048；Evidence: ESLint；Replacement: context.canvas；Risk: Low；Human Review: Required
    // Original code: const { context, editor, appHost } = createContext();
    const { context, editor } = createContext();
    const module = createHypergryphMoveGestureModule();

    const result = handleKeyboardShortcutThroughRouter({
      module,
      context,
      event: keyDownEvent({ code: "KeyM", key: "m" }),
    });

    expect(result).toEqual({ status: "handled" });
    expect(editor.actions.createMoveOperationDraft).toHaveBeenCalledTimes(1);
    expect(context.canvas.state.activeTool).toBe("move");
    expect(context.canvas.state.runtime.moveAnchor).toBeNull();
    expect(context.canvas.state.runtime.moveEnterFrom).toBe("select");
  });

  it("ignores M key shortcut when selection is empty", () => {
    // AI-REMOVED 2026-11-12: Reason: 集合清理由动作执行；Trigger: REQ-048；Evidence: ESLint；Replacement: EditorAction；Risk: Low；Human Review: Required
    // Original code: const { context, editor, selection } = createContext();
    const { context, editor } = createContext();
    const module = createHypergryphMoveGestureModule();

    // Clear selection
    // AI-REMOVED 2026-11-12: Reason: EntityCollection 已为只读投影；Trigger: REQ-048；Evidence: TS；Replacement: EditorAction；Risk: Low；Human Review: Required
    // Original code: selection.replace([]);
    editor.actions.clearCollection(EntityCollectionType.selection);

    const result = handleKeyboardShortcutThroughRouter({
      module,
      context,
      event: keyDownEvent({ code: "KeyM", key: "m" }),
    });

    expect(result).toEqual({ status: "ignored" });
    expect(editor.actions.createMoveOperationDraft).not.toHaveBeenCalled();
  });

  it("moves mouse-entered preview by collection center point", () => {
    // AI-REMOVED 2026-11-12: Reason: Canvas 迁移后旧解构未使用；Trigger: REQ-048；Evidence: ESLint；Replacement: context.canvas；Risk: Low；Human Review: Required
    // Original code: const { context, editor, appHost } = createContext({
    const { context, editor } = createContext({
      previewRect: {
        x: 9,
        y: 17,
        width: 4,
        height: 8,
      },
    });
    const module = createHypergryphMoveGestureModule();

    // AI-REMOVED 2026-11-12:
// Reason: 动作需调用真实实现，拒绝由会话策略产生、吸附由场景几何产生。
// Trigger: REQ-048 场景接口迁移。
// Evidence: 移动草稿、坐标换算和选择来自真实会话动作。
// Replacement: createCanvasTestSession 与版本化场景；原行为覆盖保留。
// Risk: 实际鼠标触控布局另由浏览器验收。
// Human Review: Required
// Original code:
// vi.mocked(editor.actions.moveCollectionCenterPointTo).mockImplementation((_, point) => {
//       previewRectRef.current = {
//         ...previewRectRef.current,
//         x: point.x,
//         y: point.y,
//       };
//     });


    expect(
      module.handle(uiButtonMouseTapEvent("canvas-floating-toolbar-button-move"), context),
    ).toEqual({ status: "handled" });
    expect(context.canvas.state.runtime.moveAnchor).toBeNull();

    expect(
      module.handle(mouseMoveEvent({ position: { x: 20, y: 30 } }), context),
    ).toEqual({ status: "handled" });
    expect(editor.actions.moveCollectionCenterPointTo).toHaveBeenNthCalledWith(
      1,
      EntityCollectionType.preview,
      { x: 20, y: 30 }, context.canvas.view.state,
    );
    expect(context.canvas.state.runtime.moveAnchor).toBeNull();

    expect(
      module.handle(mouseMoveEvent({ position: { x: 21, y: 31 } }), context),
    ).toEqual({ status: "handled" });
    expect(editor.actions.moveCollectionCenterPointTo).toHaveBeenNthCalledWith(
      2,
      EntityCollectionType.preview,
      { x: 21, y: 31 }, context.canvas.view.state,
    );
    expect(context.canvas.state.runtime.moveAnchor).toBeNull();
  });

  it("enters move from the select floating button with touch and initializes the touch move ui", () => {
    // AI-REMOVED 2026-11-12: Reason: Canvas 迁移后旧解构未使用；Trigger: REQ-048；Evidence: ESLint；Replacement: context.canvas；Risk: Low；Human Review: Required
    // Original code: const { context, editor, appHost } = createContext();
    const { context, editor } = createContext();
    const module = createHypergryphMoveGestureModule();

    const result = module.handle(
      uiButtonTouchTapEvent("canvas-floating-toolbar-button-move"),
      context,
    );

    expect(result).toEqual({ status: "handled" });
    expect(editor.actions.createMoveOperationDraft).toHaveBeenCalledTimes(1);
    expect(context.canvas.state.activeTool).toBe("move");
    expect(context.canvas.state.runtime.moveAnchor).toBeNull();
    expect(context.canvas.state.runtime.moveEnterFrom).toBe("select");
    expect(context.canvas.actions.showCanvasFloatingToolbarForCollection).not.toHaveBeenCalled();

    expect(module.handle(onEnterActiveToolEvent("select", "move"), context)).toEqual({
      status: "handled",
    });
    expect(context.canvas.actions.showCanvasFloatingToolbarForCollection).toHaveBeenCalledWith(
      MOVE_TOOLBAR_BUTTON_IDS_FOR_TEST,
      EntityCollectionType.preview,
    );
  });

  it("moves the mouse preview center from drag start after entering move from the right dock button", () => {
    // AI-REMOVED 2026-11-12: Reason: Canvas 迁移后旧解构未使用；Trigger: REQ-048；Evidence: ESLint；Replacement: context.canvas；Risk: Low；Human Review: Required
    // Original code: const { context, editor, appHost } = createContext({
    const { context, editor } = createContext({
      activeTool: "marquee",
    });
    const module = createHypergryphMoveGestureModule();

    expect(
      module.handle(
        uiButtonMouseTapEvent("canvas-right-dock-toolbar-button-move"),
        context,
      ),
    ).toEqual({ status: "handled" });
    expect(context.canvas.state.runtime.moveAnchor).toBeNull();

    const dragStartResult = module.handle(
      mouseDragStartEvent({
        originButton: 0,
        pointerEntity: null,
        position: { x: 5, y: 5 },
      }),
      context,
    );

    expect(dragStartResult).toEqual({ status: "handled" });
    expect(context.canvas.state.runtime.moveAnchor).toBeNull();
    expect(editor.actions.moveCollectionCenterPointTo).toHaveBeenCalledWith(
      EntityCollectionType.preview,
      { x: 5, y: 5 }, context.canvas.view.state,
    );
  });

  it("rolls back draft state and restores selection when entering move cannot create a preview", () => {
    // AI-REMOVED 2026-11-12: Reason: Canvas 迁移后旧解构未使用；Trigger: REQ-048；Evidence: ESLint；Replacement: context.canvas；Risk: Low；Human Review: Required
    // Original code: const { context, editor, appHost, selection, preview } = createContext({ invalidSelection: "selected" });
    const { context, editor, selection } = createContext({ invalidSelection: "selected" });
    const module = createHypergryphMoveGestureModule();

    // AI-REMOVED 2026-11-12:
// Reason: 动作需调用真实实现，拒绝由会话策略产生、吸附由场景几何产生。
// Trigger: REQ-048 场景接口迁移。
// Evidence: 移动草稿、坐标换算和选择来自真实会话动作。
// Replacement: createCanvasTestSession 与版本化场景；原行为覆盖保留。
// Risk: 实际鼠标触控布局另由浏览器验收。
// Human Review: Required
// Original code:
// vi.mocked(editor.actions.createMoveOperationDraft).mockImplementation(() => {
//       selection.replace([]);
//       preview.replace([]);
//     });


    const result = module.handle(
      mouseLongPressReadyEvent({
        pointerEntity: entity("selected-entity", { x: 2, y: 2 }),
      }),
      context,
    );

    expect(result).toEqual({ status: "ignored" });
    expect(editor.actions.cancelMoveOperationDraft).toHaveBeenCalledTimes(1);
    expect([...selection]).toEqual(["selected-entity"]);
    expect(context.canvas.state.activeTool).toBe("select");
    expect(context.canvas.state.runtime.moveAnchor).toBeNull();
    expect(context.canvas.state.runtime.moveEnterFrom).toBeNull();
  });

  it("restores the original selection when touch move enter fails after retargeting selection", () => {
    // AI-REMOVED 2026-11-12: Reason: Canvas 迁移后旧解构未使用；Trigger: REQ-048；Evidence: ESLint；Replacement: context.canvas；Risk: Low；Human Review: Required
    // Original code: const { context, editor, selection, preview } = createContext({ invalidSelection: "unselected" });
    const { context, editor, selection } = createContext({ invalidSelection: "unselected" });
    const module = createHypergryphMoveGestureModule();

    // AI-REMOVED 2026-11-12:
// Reason: 动作需调用真实实现，拒绝由会话策略产生、吸附由场景几何产生。
// Trigger: REQ-048 场景接口迁移。
// Evidence: 移动草稿、坐标换算和选择来自真实会话动作。
// Replacement: createCanvasTestSession 与版本化场景；原行为覆盖保留。
// Risk: 实际鼠标触控布局另由浏览器验收。
// Human Review: Required
// Original code:
// vi.mocked(editor.actions.createMoveOperationDraft).mockImplementation(() => {
//       selection.replace([]);
//       preview.replace([]);
//     });


    const result = module.handle(
      tapLongPressReadyEvent({
        pointerEntity: entity("unselected-entity", { x: 4, y: 4 }),
        position: { x: 4, y: 4 },
      }),
      context,
    );

    expect(result).toEqual({ status: "ignored" });
    expect(editor.actions.cancelMoveOperationDraft).toHaveBeenCalledTimes(1);
    expect([...selection]).toEqual(["selected-entity"]);
  });

  it("uses preview bounding box hit testing for touch drag start while already moving", () => {
    // AI-REMOVED 2026-11-12: Reason: Canvas 迁移后旧解构未使用；Trigger: REQ-048；Evidence: ESLint；Replacement: context.canvas；Risk: Low；Human Review: Required
    // Original code: const { context, appHost } = createContext({
    const { context } = createContext({
      activeTool: "move", pixelScale: 16,
      moveAnchor: { x: 5, y: 5 },
    });
    const module = createHypergryphMoveGestureModule();

    const originalEntityResult = module.handle(
      touchDragStartEvent({
        position: { x: 32, y: 32 },
        pointerEntity: entity("selected-entity", { x: 2, y: 2 }),
      }),
      context,
    );

    expect(originalEntityResult).toEqual({ status: "ignored" });
    expect(context.canvas.state.runtime.moveAnchor).toBeNull();

    const previewResult = module.handle(
      touchDragStartEvent({
        position: { x: 80, y: 80 },
        pointerEntity: null,
      }),
      context,
    );

    expect(previewResult).toEqual({ status: "handled" });
    expect(context.canvas.state.runtime.moveAnchor).toEqual({ x: 5, y: 5 });
  });

  it("starts touch moving from an empty cell inside the preview bounding box", () => {
    // AI-REMOVED 2026-11-12: Reason: Canvas 迁移后旧解构未使用；Trigger: REQ-048；Evidence: ESLint；Replacement: context.canvas；Risk: Low；Human Review: Required
    // Original code: const { context, appHost } = createContext({
    const { context } = createContext({
      activeTool: "move", hollowPreview: true,
      moveAnchor: { x: 5, y: 5 },
      previewRect: { x: 5, y: 5, width: 4, height: 4 },
    });
    const module = createHypergryphMoveGestureModule();

    const result = module.handle(
      touchDragStartEvent({
        position: { x: 8, y: 8 },
        pointerEntity: null,
      }),
      context,
    );

    expect(result).toEqual({ status: "handled" });
    expect(context.canvas.state.runtime.moveAnchor).toEqual({ x: 8, y: 8 });
  });

  it("starts touch moving from within the preview hit slop", () => {
    // AI-REMOVED 2026-11-12: Reason: Canvas 迁移后旧解构未使用；Trigger: REQ-048；Evidence: ESLint；Replacement: context.canvas；Risk: Low；Human Review: Required
    // Original code: const { context, appHost } = createContext({
    const { context } = createContext({
      activeTool: "move", pixelScale: 16,
      moveAnchor: { x: 5, y: 5 },
    });
    const module = createHypergryphMoveGestureModule();

    const result = module.handle(
      touchDragStartEvent({
        position: { x: 70, y: 80 },
        pointerEntity: null,
      }),
      context,
    );

    expect(result).toEqual({ status: "handled" });
// AI-REMOVED 2026-11-12:
// Reason: 真实相机下 70,80 像素位于预览左侧 10px 容差内，锚点为 4,5 格。
// Trigger: REQ-048 场景接口迁移。
// Evidence: 移动草稿、坐标换算和选择来自真实会话动作。
// Replacement: createCanvasTestSession 与版本化场景；原行为覆盖保留。
// Risk: 实际鼠标触控布局另由浏览器验收。
// Human Review: Required
// Original code:
//     expect(context.canvas.state.runtime.moveAnchor).toEqual({ x: 54, y: 55 });
    expect(context.canvas.state.runtime.moveAnchor).toEqual({ x: 4, y: 5 });
  });

  it("moves the preview by incremental grid vectors and follows it with the toolbar", () => {
    // AI-REMOVED 2026-11-12: Reason: Canvas 迁移后旧解构未使用；Trigger: REQ-048；Evidence: ESLint；Replacement: context.canvas；Risk: Low；Human Review: Required
    // Original code: const { context, editor, appHost } = createContext({
    const { context, editor } = createContext({
      activeTool: "move",
      moveAnchor: { x: 5, y: 5 },
      toolbarVisible: true,
    });
    const module = createHypergryphMoveGestureModule();

    // AI-REMOVED 2026-11-12:
// Reason: 动作需调用真实实现，拒绝由会话策略产生、吸附由场景几何产生。
// Trigger: REQ-048 场景接口迁移。
// Evidence: 移动草稿、坐标换算和选择来自真实会话动作。
// Replacement: createCanvasTestSession 与版本化场景；原行为覆盖保留。
// Risk: 实际鼠标触控布局另由浏览器验收。
// Human Review: Required
// Original code:
// vi.mocked(editor.actions.moveCollectionTo).mockImplementation(({
//       startGridPoint,
//       endGridPoint,
//     }) => {
//       previewRectRef.current = {
//         ...previewRectRef.current,
//         x: previewRectRef.current.x + endGridPoint.x - startGridPoint.x,
//         y: previewRectRef.current.y + endGridPoint.y - startGridPoint.y,
//       };
//     });


    const result = module.handle(
      touchDragMoveEvent({
        position: { x: 6, y: 4 },
      }),
      context,
    );

    expect(result).toEqual({ status: "handled" });
    expect(editor.actions.moveCollectionTo).toHaveBeenCalledWith({
      collectionType: EntityCollectionType.preview,
      startGridPoint: { x: 5, y: 5 },
      endGridPoint: { x: 6, y: 4 },
    });
    expect(context.canvas.state.runtime.moveAnchor).toEqual({ x: 6, y: 4 });
    expect(editor.actions.rotateCollectionToSnapOnBuilding).toHaveBeenCalledWith({
      collectionType: EntityCollectionType.preview,
      trigger: "after-move",
      pivotMode: "pivot-cell",
      clientPixelPoint: null, viewport: context.canvas.view.state,
    });
    expect(context.canvas.actions.alignCanvasFloatingToolbar).toHaveBeenCalledTimes(1);
  });

  it("updates touch move anchor per axis when snapping constrains one axis", () => {
    // AI-REMOVED 2026-11-12: Reason: Canvas 迁移后旧解构未使用；Trigger: REQ-048；Evidence: ESLint；Replacement: context.canvas；Risk: Low；Human Review: Required
    // Original code: const { context, editor, appHost } = createContext({
    const { context } = createContext({
      activeTool: "move",
      moveAnchor: { x: 20, y: -9 },
      movePointerMode: "touch",
      previewDefinitionId: "water_purifier_node_1",
      previewRect: { x: 10, y: -10, width: 27, height: 3 },
      toolbarVisible: true,
    });
    const module = createHypergryphMoveGestureModule();

    // AI-REMOVED 2026-11-12:
// Reason: 动作需调用真实实现，拒绝由会话策略产生、吸附由场景几何产生。
// Trigger: REQ-048 场景接口迁移。
// Evidence: 移动草稿、坐标换算和选择来自真实会话动作。
// Replacement: createCanvasTestSession 与版本化场景；原行为覆盖保留。
// Risk: 实际鼠标触控布局另由浏览器验收。
// Human Review: Required
// Original code:
// vi.mocked(editor.actions.moveCollectionTo).mockImplementation(({
//       startGridPoint,
//       endGridPoint,
//     }) => {
//       previewRectRef.current = {
//         ...previewRectRef.current,
//         x: previewRectRef.current.x + endGridPoint.x - startGridPoint.x,
//         y: previewRectRef.current.y,
//       };
//     });


    const result = module.handle(touchDragMoveEvent({ position: { x: 21, y: -8 } }), context);

    expect(result).toEqual({ status: "handled" });
    expect(context.canvas.state.runtime.moveAnchor).toEqual({ x: 21, y: -9 });
    expect(context.canvas.actions.alignCanvasFloatingToolbar).toHaveBeenCalledTimes(1);
  });

  it("rotates the preview with the R key while moving", () => {
    const { context, editor, appHost } = createContext({
      activeTool: "move",
      moveAnchor: { x: 5, y: 5 },
      toolbarVisible: true,
    });
    const module = createHypergryphMoveGestureModule();

    const result = handleKeyboardShortcutThroughRouter({
      module,
      context,
      event: keyDownEvent({ code: "KeyR", key: "r" }),
    });

    expect(result).toEqual({ status: "handled" });
    // AI-CORRECTION 2026-08-30: 快捷键匹配已由 GestureActionRouter 执行。
    expect(appHost.internalActions.isShortcutFor).not.toHaveBeenCalled();
    expect(editor.actions.rotateCollectionAroundPivotCell).toHaveBeenCalledWith(
      EntityCollectionType.preview,
      90,
    );
    expect(context.canvas.actions.alignCanvasFloatingToolbar).toHaveBeenCalledTimes(1);
  });

  it("rotates the mouse move preview around center and snaps it back to the current mouse", () => {
    // AI-REMOVED 2026-11-12: Reason: Canvas 迁移后旧解构未使用；Trigger: REQ-048；Evidence: ESLint；Replacement: context.canvas；Risk: Low；Human Review: Required
    // Original code: const { context, editor, appHost } = createContext({
    const { context, editor } = createContext({
      activeTool: "move",
      movePointerMode: "mouse",
      toolbarVisible: true,
    });
    const module = createHypergryphMoveGestureModule();

    expect(module.handle(mouseMoveEvent({ position: { x: 24, y: 32 } }), context)).toEqual({
      status: "handled",
    });
    vi.mocked(editor.actions.moveCollectionCenterPointTo).mockClear();
    vi.mocked(context.canvas.actions.alignCanvasFloatingToolbar).mockClear();

    const result = handleKeyboardShortcutThroughRouter({
      module,
      context,
      event: keyDownEvent({ code: "KeyR", key: "r" }),
    });

    expect(result).toEqual({ status: "handled" });
    expect(editor.actions.rotateCollectionAroundCenterPoint).toHaveBeenCalledWith(
      EntityCollectionType.preview,
      90,
    );
    expect(editor.actions.moveCollectionCenterPointTo).toHaveBeenCalledWith(
      EntityCollectionType.preview,
      { x: 24, y: 32 }, context.canvas.view.state,
    );
    expect(context.canvas.actions.alignCanvasFloatingToolbar).toHaveBeenCalledTimes(1);
  });

  it("rotates the preview from the rotate toolbar button while moving", () => {
    // AI-REMOVED 2026-11-12: Reason: Canvas 迁移后旧解构未使用；Trigger: REQ-048；Evidence: ESLint；Replacement: context.canvas；Risk: Low；Human Review: Required
    // Original code: const { context, editor, appHost } = createContext({
    const { context, editor } = createContext({
      activeTool: "move",
      moveAnchor: { x: 5, y: 5 },
      toolbarVisible: true,
    });
    const module = createHypergryphMoveGestureModule();

    const result = module.handle(uiButtonTouchTapEvent("canvas-floating-toolbar-button-rotate"), context);

    expect(result).toEqual({ status: "handled" });
    expect(editor.actions.rotateCollectionAroundPivotCell).toHaveBeenCalledWith(
      EntityCollectionType.preview,
      90,
    );
    expect(context.canvas.actions.alignCanvasFloatingToolbar).toHaveBeenCalledTimes(1);
  });

  it("uses building-snap rotation before the normal move-preview rotation", () => {
    const { context, editor } = createContext({
      activeTool: "move", previewDefinitionId: "loader_1",
      moveAnchor: { x: 5, y: 5 },
      movePointerMode: "touch",
    });
    const module = createHypergryphMoveGestureModule();
    // AI-REMOVED 2026-11-12:
// Reason: 动作需调用真实实现，拒绝由会话策略产生、吸附由场景几何产生。
// Trigger: REQ-048 场景接口迁移。
// Evidence: 移动草稿、坐标换算和选择来自真实会话动作。
// Replacement: createCanvasTestSession 与版本化场景；原行为覆盖保留。
// Risk: 实际鼠标触控布局另由浏览器验收。
// Human Review: Required
// Original code:
// vi.mocked(editor.actions.rotateCollectionToSnapOnBuilding).mockReturnValue(true);


    expect(handleKeyboardShortcutThroughRouter({
      module,
      context,
      event: keyDownEvent({ code: "KeyR", key: "r" }),
    })).toEqual({ status: "handled" });
    expect(editor.actions.rotateCollectionToSnapOnBuilding).toHaveBeenCalledWith({
      collectionType: EntityCollectionType.preview,
      trigger: "before-rotate",
      pivotMode: "pivot-cell",
      clientPixelPoint: null, viewport: context.canvas.view.state,
    });
    expect(editor.actions.rotateCollectionAroundPivotCell).not.toHaveBeenCalled();
    expect(editor.actions.rotateCollectionAroundCenterPoint).not.toHaveBeenCalled();
  });

  it("switches the move preview variant, keeps the anchor, then continues moving and applies", () => {
    // AI-REMOVED 2026-11-12: Reason: Canvas 迁移后旧解构未使用；Trigger: REQ-048；Evidence: ESLint；Replacement: context.canvas；Risk: Low；Human Review: Required
    // Original code: const { context, editor, appHost } = createContext({
    const { context, editor } = createContext({
      activeTool: "move",
      moveAnchor: { x: 12, y: 11 },
      previewDefinitionId: "filling_pd_mc_1",
      previewRect: { x: 10, y: 10, width: 6, height: 4 },
      toolbarVisible: true,
    });
    const module = createHypergryphMoveGestureModule();

    // AI-REMOVED 2026-11-12:
// Reason: 动作需调用真实实现，拒绝由会话策略产生、吸附由场景几何产生。
// Trigger: REQ-048 场景接口迁移。
// Evidence: 移动草稿、坐标换算和选择来自真实会话动作。
// Replacement: createCanvasTestSession 与版本化场景；原行为覆盖保留。
// Risk: 实际鼠标触控布局另由浏览器验收。
// Human Review: Required
// Original code:
// vi.mocked(editor.actions.moveCollectionTo).mockImplementation(({
//       startGridPoint,
//       endGridPoint,
//     }) => {
//       previewRectRef.current = {
//         ...previewRectRef.current,
//         x: previewRectRef.current.x + endGridPoint.x - startGridPoint.x,
//         y: previewRectRef.current.y + endGridPoint.y - startGridPoint.y,
//       };
//     });


    expect(handleKeyboardShortcutThroughRouter({
      module,
      context,
      event: keyDownEvent({ code: "Tab", key: "Tab" }),
    })).toEqual({ status: "handled" });
    expect(editor.actions.replaceEntityDefinition).toHaveBeenCalledWith(
      "move-draft:selected-entity",
      "filling_pd_mc_1_liquid",
    );
    expect(context.canvas.state.runtime.moveAnchor).toEqual({ x: 12, y: 11 });

    expect(module.handle(touchDragMoveEvent({ position: { x: 13, y: 12 } }), context)).toEqual({
      status: "handled",
    });
    expect(editor.actions.moveCollectionTo).toHaveBeenLastCalledWith({
      collectionType: EntityCollectionType.preview,
      startGridPoint: { x: 12, y: 11 },
      endGridPoint: { x: 13, y: 12 },
    });
    expect(context.canvas.state.runtime.moveAnchor).toEqual({ x: 13, y: 12 });

    expect(module.handle(uiButtonTouchTapEvent("canvas-floating-toolbar-button-ok"), context)).toEqual({
      status: "handled",
    });
    expect(editor.actions.applyMoveOerationDraft).toHaveBeenCalledTimes(1);
    expect(context.canvas.state.activeTool).toBe("select");
  });

  it("shows Tab only for switchable ordinary mouse move shortcuts", () => {
    const ordinary = createContext({
      activeTool: "move",
      moveEnterFrom: "select",
      movePointerMode: "mouse",
      previewDefinitionId: "filling_pd_mc_1",
    });
    const batch = createContext({
      activeTool: "move",
      moveEnterFrom: "marquee",
      movePointerMode: "mouse",
      previewDefinitionId: "filling_pd_mc_1",
    });
    const module = createHypergryphMoveGestureModule();

    expect(module.handle(
      onEnterActiveToolEvent("select", "move"),
      ordinary.context,
    )).toEqual({ status: "handled" });
    expect(ordinary.context.canvas.actions.showCanvasRightDockToolbar).toHaveBeenCalledWith(
      ORDINARY_MOVE_RIGHT_DOCK_TOOLBAR_ITEMS_WITH_VARIANT_FOR_TEST,
    );

    expect(module.handle(
      onEnterActiveToolEvent("marquee", "move"),
      batch.context,
    )).toEqual({ status: "handled" });
    expect(batch.context.canvas.actions.showCanvasRightDockToolbar).toHaveBeenCalledWith(
      BATCH_MOVE_RIGHT_DOCK_TOOLBAR_ITEMS_FOR_TEST,
    );

    expect(handleKeyboardShortcutThroughRouter({
      module,
      context: batch.context,
      event: keyDownEvent({ code: "Tab", key: "Tab" }),
    })).toEqual({ status: "ignored" });
    expect(batch.editor.actions.replaceEntityDefinition).not.toHaveBeenCalled();
  });

  it("hides and rejects variant switching during a single-device batch touch move", () => {
    // AI-REMOVED 2026-11-12: Reason: Canvas 迁移后旧解构未使用；Trigger: REQ-048；Evidence: ESLint；Replacement: context.canvas；Risk: Low；Human Review: Required
    // Original code: const { context, editor, appHost } = createContext({
    const { context, editor } = createContext({
      activeTool: "move",
      moveEnterFrom: "marquee",
      movePointerMode: "touch",
      previewDefinitionId: "filling_pd_mc_1",
    });
    const module = createHypergryphMoveGestureModule();

    expect(module.handle(onEnterActiveToolEvent("marquee", "move"), context)).toEqual({
      status: "handled",
    });
    expect(context.canvas.actions.showCanvasFloatingToolbarForCollection).toHaveBeenCalledWith(
      MOVE_TOOLBAR_BUTTON_IDS_FOR_TEST,
      EntityCollectionType.preview,
    );

    expect(module.handle(
      uiButtonTouchTapEvent("canvas-floating-toolbar-button-switch-mode"),
      context,
    )).toEqual({ status: "ignored" });
    expect(editor.actions.replaceEntityDefinition).not.toHaveBeenCalled();
  });

  it("cancels a switched move preview without applying it", () => {
    // AI-REMOVED 2026-11-12: Reason: Canvas 迁移后旧解构未使用；Trigger: REQ-048；Evidence: ESLint；Replacement: context.canvas；Risk: Low；Human Review: Required
    // Original code: const { context, editor, appHost } = createContext({
    const { context, editor } = createContext({
      activeTool: "move",
      moveAnchor: { x: 12, y: 11 },
      previewDefinitionId: "filling_pd_mc_1",
      previewRect: { x: 10, y: 10, width: 6, height: 4 },
      toolbarVisible: true,
    });
    const module = createHypergryphMoveGestureModule();

    expect(
      module.handle(uiButtonTouchTapEvent("canvas-floating-toolbar-button-switch-mode"), context),
    ).toEqual({ status: "handled" });
    expect(editor.actions.replaceEntityDefinition).toHaveBeenCalledTimes(1);

    expect(module.handle(uiButtonTouchTapEvent("canvas-floating-toolbar-button-cancel"), context)).toEqual({
      status: "handled",
    });
    expect(editor.actions.cancelMoveOperationDraft).toHaveBeenCalledTimes(1);
    expect(editor.actions.applyMoveOerationDraft).not.toHaveBeenCalled();
    expect(context.canvas.state.runtime.moveAnchor).toBeNull();
  });

  it("applies with a non-long-press left mouse tap and cancels with a right mouse tap", () => {
    const applyContext = createContext({
      activeTool: "move",
      moveAnchor: { x: 5, y: 5 },
    });
    const cancelContext = createContext({
      activeTool: "move",
      moveAnchor: { x: 5, y: 5 },
    });
    const module = createHypergryphMoveGestureModule();

    expect(
      module.handle(mouseTapEvent({ button: 0, longPress: false }), applyContext.context),
    ).toEqual({ status: "handled" });
    expect(applyContext.editor.actions.applyMoveOerationDraft).toHaveBeenCalledTimes(1);
    expect(applyContext.context.canvas.state.activeTool).toBe("select");
    expect(applyContext.context.canvas.state.runtime.moveAnchor).toBeNull();

    expect(
      module.handle(mouseTapEvent({ button: 2, longPress: false }), cancelContext.context),
    ).toEqual({ status: "handled" });
    expect(cancelContext.editor.actions.cancelMoveOperationDraft).toHaveBeenCalledTimes(1);
    expect(cancelContext.context.canvas.state.activeTool).toBe("select");
    expect(cancelContext.context.canvas.state.runtime.moveAnchor).toBeNull();
  });

  it("treats Ctrl+left-click as ordinary move apply when copy while moving is disabled", () => {
    // AI-REMOVED 2026-11-12: Reason: Canvas 迁移后旧解构未使用；Trigger: REQ-048；Evidence: ESLint；Replacement: context.canvas；Risk: Low；Human Review: Required
    // Original code: const { context, editor, appHost } = createContext({
    const { context, editor } = createContext({
      activeTool: "move",
      moveAnchor: { x: 5, y: 5 },
      copyWhileMoving: false,
    });
    const module = createHypergryphMoveGestureModule();

    expect(
      module.handle(mouseTapEvent({
        button: 0,
        longPress: false,
        modifiers: { ctrl: true },
      }), context),
    ).toEqual({ status: "handled" });

    expect(editor.actions.applyMoveOerationDraft).toHaveBeenCalledTimes(1);
    expect(editor.actions.cancelMoveOperationDraft).not.toHaveBeenCalled();
    expect(context.canvas.state.activeTool).toBe("select");
  });

  it("hides the touch copy button when copy while moving is disabled", () => {
    // AI-REMOVED 2026-11-12: Reason: Canvas 迁移后旧解构未使用；Trigger: REQ-048；Evidence: ESLint；Replacement: context.canvas；Risk: Low；Human Review: Required
    // Original code: const { context, appHost } = createContext({
    const { context } = createContext({
      activeTool: "move",
      movePointerMode: "touch",
      copyWhileMoving: false,
    });
    const module = createHypergryphMoveGestureModule();

    expect(module.handle(onEnterActiveToolEvent("select", "move"), context)).toEqual({
      status: "handled",
    });
    expect(context.canvas.actions.showCanvasFloatingToolbarForCollection).toHaveBeenCalledWith(
      [
        "canvas-floating-toolbar-button-cancel",
        "canvas-floating-toolbar-button-rotate",
        "canvas-floating-toolbar-button-ok",
      ],
      EntityCollectionType.preview,
    );
  });

  it("keeps mouse move active when applying is rejected", () => {
    // AI-REMOVED 2026-11-12: Reason: Canvas 迁移后旧解构未使用；Trigger: REQ-048；Evidence: ESLint；Replacement: context.canvas；Risk: Low；Human Review: Required
    // Original code: const { context, editor, appHost } = createContext({
    const { context, editor } = createContext({
      activeTool: "move", rejectApply: true,
      moveAnchor: { x: 5, y: 5 },
    });
    const module = createHypergryphMoveGestureModule();

    // AI-REMOVED 2026-11-12:
// Reason: 动作需调用真实实现，拒绝由会话策略产生、吸附由场景几何产生。
// Trigger: REQ-048 场景接口迁移。
// Evidence: 移动草稿、坐标换算和选择来自真实会话动作。
// Replacement: createCanvasTestSession 与版本化场景；原行为覆盖保留。
// Risk: 实际鼠标触控布局另由浏览器验收。
// Human Review: Required
// Original code:
// vi.mocked(editor.actions.applyMoveOerationDraft).mockReturnValue(false);


    expect(
      module.handle(mouseTapEvent({ button: 0, longPress: false }), context),
    ).toEqual({ status: "handled" });

    expect(editor.actions.applyMoveOerationDraft).toHaveBeenCalledTimes(1);
    expect(context.canvas.state.activeTool).toBe("move");
    expect(context.canvas.state.runtime.moveAnchor).toEqual({ x: 5, y: 5 });
    expect(context.canvas.actions.setActiveTool).not.toHaveBeenCalled();
  });

  it("keeps touch move active when applying is rejected", () => {
    // AI-REMOVED 2026-11-12: Reason: Canvas 迁移后旧解构未使用；Trigger: REQ-048；Evidence: ESLint；Replacement: context.canvas；Risk: Low；Human Review: Required
    // Original code: const { context, editor, appHost } = createContext({
    const { context, editor } = createContext({
      activeTool: "move", rejectApply: true,
      moveAnchor: { x: 5, y: 5 },
    });
    const module = createHypergryphMoveGestureModule();

    // AI-REMOVED 2026-11-12:
// Reason: 动作需调用真实实现，拒绝由会话策略产生、吸附由场景几何产生。
// Trigger: REQ-048 场景接口迁移。
// Evidence: 移动草稿、坐标换算和选择来自真实会话动作。
// Replacement: createCanvasTestSession 与版本化场景；原行为覆盖保留。
// Risk: 实际鼠标触控布局另由浏览器验收。
// Human Review: Required
// Original code:
// vi.mocked(editor.actions.applyMoveOerationDraft).mockReturnValue(false);


    expect(
      module.handle(uiButtonTouchTapEvent("canvas-floating-toolbar-button-ok"), context),
    ).toEqual({ status: "handled" });

    expect(editor.actions.applyMoveOerationDraft).toHaveBeenCalledTimes(1);
    expect(context.canvas.state.activeTool).toBe("move");
    expect(context.canvas.state.runtime.moveAnchor).toEqual({ x: 5, y: 5 });
    expect(context.canvas.actions.setActiveTool).not.toHaveBeenCalled();
  });

  it("returns to marquee through a mouse tool tap when mouse applying a marquee-entered move", () => {
    // AI-REMOVED 2026-11-12: Reason: Canvas 迁移后旧解构未使用；Trigger: REQ-048；Evidence: ESLint；Replacement: context.canvas；Risk: Low；Human Review: Required
    // Original code: const { context, editor, appHost } = createContext({
    const { context, editor } = createContext({
      activeTool: "move",
      moveAnchor: { x: 5, y: 5 },
      moveEnterFrom: "marquee",
    });
    const module = createHypergryphMoveGestureModule();

    expect(
      module.handle(mouseTapEvent({ button: 0, longPress: false }), context),
    ).toEqual({ status: "handled" });

    expect(editor.actions.applyMoveOerationDraft).toHaveBeenCalledTimes(1);
    expect(context.canvas.state.runtime.moveAnchor).toBeNull();
    expect(context.canvas.state.runtime.moveEnterFrom).toBeNull();
    expect(context.canvas.gestureAdapter.handleUiButtonMouseTap).toHaveBeenCalledWith({
      uiButtonId: "placement-tool-marquee",
      button: 0,
      altKey: false,
      ctrlKey: false,
      metaKey: false,
      shiftKey: false,
    });
    expect(context.canvas.gestureAdapter.handleUiButtonTouchTap).not.toHaveBeenCalled();
  });

  it("returns to marquee through a touch tool tap when touch cancelling a marquee-entered move", () => {
    // AI-REMOVED 2026-11-12: Reason: Canvas 迁移后旧解构未使用；Trigger: REQ-048；Evidence: ESLint；Replacement: context.canvas；Risk: Low；Human Review: Required
    // Original code: const { context, editor, appHost } = createContext({
    const { context, editor } = createContext({
      activeTool: "move",
      moveAnchor: { x: 5, y: 5 },
      moveEnterFrom: "marquee",
    });
    const module = createHypergryphMoveGestureModule();

    expect(
      module.handle(uiButtonTouchTapEvent("canvas-floating-toolbar-button-cancel"), context),
    ).toEqual({ status: "handled" });

    expect(editor.actions.cancelMoveOperationDraft).toHaveBeenCalledTimes(1);
    expect(context.canvas.state.runtime.moveAnchor).toBeNull();
    expect(context.canvas.state.runtime.moveEnterFrom).toBeNull();
    expect(context.canvas.gestureAdapter.handleUiButtonTouchTap).toHaveBeenCalledWith({
      uiButtonId: "placement-tool-marquee",
      altKey: false,
      ctrlKey: false,
      metaKey: false,
      shiftKey: false,
    });
    expect(context.canvas.gestureAdapter.handleUiButtonMouseTap).not.toHaveBeenCalled();
  });

  it("does not return to marquee after active exits from a select-entered move", () => {
    // AI-REMOVED 2026-11-12: Reason: Canvas 迁移后旧解构未使用；Trigger: REQ-048；Evidence: ESLint；Replacement: context.canvas；Risk: Low；Human Review: Required
    // Original code: const { context, appHost } = createContext({
    const { context } = createContext({
      activeTool: "move",
      moveAnchor: { x: 5, y: 5 },
      moveEnterFrom: "select",
    });
    const module = createHypergryphMoveGestureModule();

    expect(
      module.handle(mouseTapEvent({ button: 0, longPress: false }), context),
    ).toEqual({ status: "handled" });

    expect(context.canvas.gestureAdapter.handleUiButtonMouseTap).not.toHaveBeenCalled();
    expect(context.canvas.gestureAdapter.handleUiButtonTouchTap).not.toHaveBeenCalled();
  });

  it("preserves selection through the marquee → move → marquee round-trip", () => {
    // AI-REMOVED 2026-11-12: Reason: Canvas 迁移后旧解构未使用；Trigger: REQ-048；Evidence: ESLint；Replacement: context.canvas；Risk: Low；Human Review: Required
    // Original code: const { context, editor, appHost, selection, preview } = createContext({
    const { context, editor, selection } = createContext({
      activeTool: "marquee",
    });
    const module = createHypergryphMoveGestureModule();

    // The real createMoveOperationDraft reads from selection but does NOT clear it.
    // Override the mock to match the real implementation.
    // AI-REMOVED 2026-11-12:
// Reason: 动作需调用真实实现，拒绝由会话策略产生、吸附由场景几何产生。
// Trigger: REQ-048 场景接口迁移。
// Evidence: 移动草稿、坐标换算和选择来自真实会话动作。
// Replacement: createCanvasTestSession 与版本化场景；原行为覆盖保留。
// Risk: 实际鼠标触控布局另由浏览器验收。
// Human Review: Required
// Original code:
// vi.mocked(editor.actions.createMoveOperationDraft).mockImplementation(() => {
//       const sourceEntityIds = [...selection];
//       preview.replace(["preview-entity"]);
//       (editor.state.collections[EntityCollectionType.ghost] as MockCollection).replace(sourceEntityIds);
//     });


    // Push a second entity into selection so the round-trip preserves multiple entities.
    // AI-REMOVED 2026-11-12: Reason: EntityCollection 已为只读投影；Trigger: REQ-048；Evidence: TS；Replacement: EditorAction；Risk: Low；Human Review: Required
    // Original code: selection.push("another-selected");
    editor.actions.addToCollection({ collectionType: EntityCollectionType.selection, entityId: "another-selected" });

    // Enter move from marquee via mouse long-press.
    const enterResult = module.handle(
      mouseLongPressReadyEvent({
        pointerEntity: entity("selected-entity", { x: 2, y: 2 }),
      }),
      context,
    );

    expect(enterResult).toEqual({ status: "handled" });
    expect(context.canvas.state.activeTool).toBe("move");
    expect(context.canvas.state.runtime.moveEnterFrom).toBe("marquee");
    expect([...selection]).toEqual(["selected-entity", "another-selected"]);

    // Apply the move — the module should trigger a return to marquee
    // without clearing selection.
    const applyResult = module.handle(
      mouseTapEvent({ button: 0, longPress: false }),
      context,
    );

    expect(applyResult).toEqual({ status: "handled" });
    expect(editor.actions.applyMoveOerationDraft).toHaveBeenCalledTimes(1);
    expect(context.canvas.actions.setActiveTool).toHaveBeenCalledWith("select");
    expect([...selection]).toEqual(["selected-entity", "another-selected"]);

    // The marquee re-entry is delegated to the marquee gesture module via
    // handleUiButtonMouseTap — selection clearing (or preservation) at that
    // point is the marquee module's responsibility.
    expect(context.canvas.gestureAdapter.handleUiButtonMouseTap).toHaveBeenCalledWith({
      uiButtonId: "placement-tool-marquee",
      button: 0,
      altKey: false,
      ctrlKey: false,
      metaKey: false,
      shiftKey: false,
    });
  });
});

// AI-REMOVED 2026-11-12:
// Reason: 旧假 App、Editor、视口及集合已不适用于独立 Canvas。
// Trigger: REQ-048 场景接口迁移。
// Evidence: 移动草稿、坐标换算和选择来自真实会话动作。
// Replacement: createCanvasTestSession 与版本化场景；原行为覆盖保留。
// Risk: 实际鼠标触控布局另由浏览器验收。
// Human Review: Required
// Original code:
// function createContext(options: {
//   activeTool?: ActiveTool;
//   moveAnchor?: GridPoint | null;
//   moveEnterFrom?: ActiveTool | null;
//   movePointerMode?: "mouse" | "touch" | null;
//   toolbarVisible?: boolean;
//   previewRect?: GridRect;
//   previewDefinitionId?: string;
//   copyWhileMoving?: boolean;
//   overlapEntityMenu?: WorkbenchOverlapEntityMenuController;
//   listedEntities?: readonly WorldEntity[];
// } = {}): {
//   context: GestureActionContext<AppHost>;
//   editor: MockEditor;
//   appHost: AppHost;
//   selection: MockCollection;
//   preview: MockCollection;
//   previewRectRef: { current: GridRect };
// } {
//   const selection = createCollection(["selected-entity"]);
//   const marquee = createCollection([]);
//   const reverseMarquee = createCollection([]);
//   const preview = createCollection(["preview-entity"]);
//   const ghost = createCollection([]);
//   const previewRectRef = {
//     current: options.previewRect ?? {
//       x: 5,
//       y: 5,
//       width: 1,
//       height: 1,
//     },
//   };
//   const previewEntity = entity(
//     "preview-entity",
//     { x: previewRectRef.current.x, y: previewRectRef.current.y },
//     options.previewDefinitionId,
//   );
//   const selectedEntity = entity("selected-entity", { x: 2, y: 2 });
//   const unselectedEntity = entity("unselected-entity", { x: 4, y: 4 });
//   const listedEntityMap = new Map(
//     (options.listedEntities ?? []).map((listedEntity) => [listedEntity.id, listedEntity]),
//   );
//   const shortcuts: Record<string, string> = {
//     [SHORTCUT_KEY.ROTATE]: "R",
//     [SHORTCUT_KEY.SWITCH_DEVICE_MODE]: "Tab",
//     [SHORTCUT_KEY.MOVE_SELECTION]: "M",
//   };
//   const editor: MockEditor = {
//     // AI-CORRECTION 2026-10-12: 地图资格不再允许未知文档；旧路由布景显式提供已加载地图的完整快照。
//     document: { getSnapshot: () => createWorldDocument({ baseId: "wuling_protocol_core" }) },
//     state: {
//       viewport: {
//         center: { x: 0, y: 0 },
//         clientRect: { left: 0, top: 0, width: 100, height: 100 },
//         gridSize: 1,
//         gridCellPixelSize: 1,
//         displayRotation: 0,
//       },
//       collections: {
//         [EntityCollectionType.selection]: selection,
//         [EntityCollectionType.marquee]: marquee,
//         [EntityCollectionType.reverseMarquee]: reverseMarquee,
//         [EntityCollectionType.preview]: preview,
//         [EntityCollectionType.ghost]: ghost,
//         [EntityCollectionType.logisticsHead]: createCollection([]),
//         [EntityCollectionType.powered]: createCollection([]),
//         [EntityCollectionType.invalidPlacement]: createCollection([]),
//       },
//     },
//     queries: {
//       getEntityById: vi.fn((entityId: string) => {
//         const listedEntity = listedEntityMap.get(entityId);
//         if (listedEntity !== undefined) {
//           return listedEntity;
//         }
//
//         if (entityId === "preview-entity") {
//           return previewEntity;
//         }
//
//         if (entityId === "selected-entity") {
//           return selectedEntity;
//         }
//
//         if (entityId === "unselected-entity") {
//           return unselectedEntity;
//         }
//
//         return null;
//       }),
//       findEntityCollectionGridRect: vi.fn((collectionType) =>
//         collectionType === EntityCollectionType.preview && preview.length > 0
//           ? previewRectRef.current
//           : null,
//       ),
//       findGridCellForClientPixelPoint: vi.fn((point) => ({
//         x: Math.floor(point.x),
//         y: Math.floor(point.y),
//       })),
//       findClientRectForGridCell: vi.fn((cell) => ({
//         left: cell.x * 16,
//         top: cell.y * 16,
//         width: 16,
//         height: 16,
//       })),
//       ...(options.listedEntities !== undefined
//         ? { listEntities: vi.fn(() => options.listedEntities ?? []) }
//         : {}),
//     },
//     actions: {
//       createMoveOperationDraft: vi.fn(() => {
//         const sourceEntityIds = [...selection];
//         selection.replace([]);
//         preview.replace(["preview-entity"]);
//         ghost.replace(sourceEntityIds);
//       }),
//       cancelMoveOperationDraft: vi.fn(() => {
//         preview.replace([]);
//         ghost.replace([]);
//       }),
//       applyMoveOerationDraft: vi.fn(() => true),
//       moveCollectionTo: vi.fn(),
//       moveCollectionCenterPointTo: vi.fn(),
//       rotateCollection: vi.fn(),
//       rotateCollectionAroundCenterPoint: vi.fn(),
//       rotateCollectionAroundPivotCell: vi.fn(),
//       rotateCollectionToSnapOnBuilding: vi.fn(() => false),
//       replaceEntityDefinition: vi.fn((entityId: string, nextDefinitionId: string) => {
//         if (entityId !== previewEntity.id) {
//           return false;
//         }
//
//         previewEntity.definitionId = nextDefinitionId;
//         previewEntity.config = {};
//         return true;
//       }),
//       clearCollection: vi.fn((collectionType: EntityCollectionTypeValue) => {
//         (editor.state.collections[collectionType] as MockCollection).replace([]);
//       }),
//       addToCollection: vi.fn(({
//         collectionType,
//         entityId,
//       }: {
//         collectionType: EntityCollectionTypeValue;
//         entityId: string;
//       }) => {
//         const collection = editor.state.collections[collectionType] as MockCollection;
//         if (!collection.contains(entityId)) {
//           collection.push(entityId);
//         }
//       }),
//     },
//   };
//   const appHost = {
//     state: {
//       settings: {
//         // AI-REMOVED 2026-09-10:
//         // Reason: 操作模式总开关已废弃，不再保留关闭分支
//         // Trigger: 用户要求彻底移除 hypergryphOperationMode。
//         // Evidence: 总开关入口已隐藏；手势路由器无 when 时默认启用。
//         // Replacement: 测试状态不再需要模式字段
//         // Risk: 历史 false 设置统一使用当前操作行为。
//         // Human Review: Required
//         //
//         // Original code:
//         // hypergryphOperationMode: true,
//         hypergryphImmediateMove: true,
//         hypergryphCopyWhileMoving: options.copyWhileMoving ?? false,
//       },
//       get moveKind(): "ordinary" | "batch" | null {
//         if (appHost.internalState.activeTool !== "move") {
//           return null;
//         }
//
//         return appHost.internalState.runtime.moveEnterFrom === "marquee"
//           ? "batch"
//           : "ordinary";
//       },
//     },
//     internalState: {
//       activeTool: options.activeTool ?? "select",
//       runtime: {
//         moveAnchor: options.moveAnchor ?? null,
//         moveEnterFrom: options.moveEnterFrom ?? null,
//         movePointerMode: options.movePointerMode ?? null,
//         canvasFloatingToolbar: {
//           visible: options.toolbarVisible ?? false,
//           buttonIds: [],
//           anchor: null,
//           attachedCollection: null,
//           measuredSize: null,
//         },
//         canvasRightDockToolbar: {
//           visible: false,
//           items: [] as CanvasRightDockToolbarItemRequest[],
//         },
//       },
//     },
//     gestureAdapter: {
//       handleUiButtonMouseTap: vi.fn(),
//       handleUiButtonTouchTap: vi.fn(),
//     },
//     internalActions: {
//       setActiveTool: vi.fn((activeTool) => {
//         appHost.internalState.activeTool = activeTool;
//       }),
//       showCanvasFloatingToolbarForCollection: vi.fn((buttonIds, collectionType) => {
//         if (editor.queries.findEntityCollectionGridRect(collectionType) === null) {
//           return false;
//         }
//
//         appHost.internalState.runtime.canvasFloatingToolbar.visible = true;
//         appHost.internalState.runtime.canvasFloatingToolbar.buttonIds = [...buttonIds];
//         appHost.internalState.runtime.canvasFloatingToolbar.anchor = { x: 80, y: 72 };
//         appHost.internalState.runtime.canvasFloatingToolbar.attachedCollection = collectionType;
//         return true;
//       }),
//       alignCanvasFloatingToolbar: vi.fn(() => true),
//       setCanvasFloatingToolbarSize: vi.fn(),
//       hideCanvasFloatingToolbar: vi.fn(() => {
//         appHost.internalState.runtime.canvasFloatingToolbar.visible = false;
//         appHost.internalState.runtime.canvasFloatingToolbar.attachedCollection = null;
//       }),
//       showCanvasRightDockToolbar: vi.fn((items: readonly CanvasRightDockToolbarItemRequest[]) => {
//         appHost.internalState.runtime.canvasRightDockToolbar.visible = true;
//         appHost.internalState.runtime.canvasRightDockToolbar.items = [...items];
//       }),
//       hideCanvasRightDockToolbar: vi.fn(() => {
//         appHost.internalState.runtime.canvasRightDockToolbar.visible = false;
//         appHost.internalState.runtime.canvasRightDockToolbar.items = [];
//       }),
//       getKeyboardShortcutFor: vi.fn((key: string) => shortcuts[key] ?? ""),
//       isShortcutFor: vi.fn((key: string, code: string | null, eventKey?: string | null) => {
//         const shortcut = (shortcuts[key] ?? "")
//           .trim()
//           .toLowerCase();
//         if (shortcut === "") {
//           return false;
//         }
//
//         if ((eventKey ?? "").trim().toLowerCase() === shortcut) {
//           return true;
//         }
//
//         if (shortcut.length === 1 && shortcut >= "a" && shortcut <= "z") {
//           return code === `Key${shortcut.toUpperCase()}`;
//         }
//
//         if (shortcut.length === 1 && shortcut >= "0" && shortcut <= "9") {
//           return code === `Digit${shortcut}` || code === `Numpad${shortcut}`;
//         }
//
//         return (code ?? "").trim().toLowerCase() === shortcut;
//       }),
//     },
//     workspace: {
//       editor,
//       registry: createRegistryContract(),
//     },
//     ...(options.overlapEntityMenu !== undefined
//       ? { overlapEntityMenu: options.overlapEntityMenu }
//       : {}),
//   } as unknown as AppHost;
//
//   return {
//     context: {
//       workspace: {
//         registry: appHost.workspace.registry,
//         editor,
//       } as unknown as WorkspaceContract,
//       appHost,
//       keyboard: emptyKeyboardSnapshot(),
//     },
//     editor,
//     appHost,
//     selection,
//     preview,
//     previewRectRef,
//   };
// }
function createContext(options: {
  activeTool?: ActiveTool;
  moveAnchor?: GridPoint | null;
  moveEnterFrom?: ActiveTool | null;
  movePointerMode?: "mouse" | "touch" | null;
  toolbarVisible?: boolean;
  previewRect?: GridRect;
  previewDefinitionId?: string;
  copyWhileMoving?: boolean;
  listedEntities?: readonly WorldEntity[];
  rejectApply?: boolean;
  invalidSelection?: "selected" | "unselected";
  hollowPreview?: boolean;
  pixelScale?: number;
} = {}) {
  const edge = options.previewDefinitionId === "water_purifier_node_1";
  const snap = options.previewDefinitionId === "loader_1";
  const fixture = options.invalidSelection !== undefined ? `invalid-${options.invalidSelection}`
    : options.hollowPreview ? "hollow" : edge ? "edge" : snap ? "snap"
    : options.previewDefinitionId === "filling_pd_mc_1" ? "variant" : "default";
  const document = options.listedEntities === undefined ? createWorldDocumentFromBlueprint(loadBlueprintFromFile(
    `src/tests/fixtures/blueprints/collections/req048/move-${fixture}.schema7.json`)) : {
    ...createWorldDocument({ baseId: "wuling_protocol_core" }),
    entities: Object.fromEntries(options.listedEntities.map(entity => [entity.id, entity])),
    entityOrder: options.listedEntities.map(entity => entity.id),
  };
  const pixelScale = options.pixelScale ?? 1;
  const test = createCanvasTestSession({ document, activeTool: options.activeTool,
    viewport: { center: { x: 50 / pixelScale, y: 50 / pixelScale }, gridSize: pixelScale / 16, displayRotation: 0 },
    space: edge ? { areas: [{ id: "test-space", bounds: { minX: null, maxX: null, minY: 0, maxY: null },
      outerRing: { top: 10, right: 0, bottom: 0, left: 0 } }] } : undefined,
    policy: { getOperationAvailability: () => ({ supported: true, enabled: true, reason: null }),
      resolvePlacementAreaIds: (_entity, space) => space.areas.map(area => area.id),
      validateTransition: () => options.rejectApply ? ["test-policy-rejected"] : [] },
  });
  cleanups.push(test.dispose);
  test.view.actions.setViewportClientRect({ left: 0, top: 0, width: 100, height: 100 });
  test.app.internalState.settings.hypergryphImmediateMove = true;
  test.app.internalState.settings.hypergryphCopyWhileMoving = options.copyWhileMoving ?? false;
  test.editor.actions.addToCollection({ collectionType: EntityCollectionType.selection, entityId: "selected-entity" });
  if (options.hollowPreview) test.editor.actions.addToCollection({ collectionType: EntityCollectionType.selection, entityId: "another-selected" });
  if (options.activeTool === "move") {
    test.editor.actions.createMoveOperationDraft();
    const rect = test.editor.queries.findEntityCollectionGridRect(EntityCollectionType.preview);
    if (rect === null) throw new Error("Move fixture must produce a real preview");
    const target = snap ? { x: 3, y: 1 } : options.previewRect ?? { x: 5, y: 5 };
    test.editor.actions.moveCollectionTo({ collectionType: EntityCollectionType.preview,
      startGridPoint: { x: rect.x, y: rect.y }, endGridPoint: target });
  }
  Object.assign(test.canvas.state.runtime, { moveAnchor: options.moveAnchor ?? null,
    moveEnterFrom: options.moveEnterFrom ?? null, movePointerMode: options.movePointerMode ?? null });
  if (options.toolbarVisible) test.canvas.actions.showCanvasFloatingToolbarForCollection(MOVE_TOOLBAR_BUTTON_IDS_FOR_TEST, EntityCollectionType.preview);
  for (const action of ["createMoveOperationDraft", "cancelMoveOperationDraft", "applyMoveOerationDraft", "moveCollectionTo",
    "moveCollectionCenterPointTo", "rotateCollection", "rotateCollectionAroundCenterPoint", "rotateCollectionAroundPivotCell",
    "rotateCollectionToSnapOnBuilding", "replaceEntityDefinition", "clearCollection", "addToCollection"] as const) vi.spyOn(test.editor.actions, action);
  for (const action of ["setActiveTool", "showCanvasFloatingToolbarForCollection", "hideCanvasFloatingToolbar",
    "showCanvasRightDockToolbar", "hideCanvasRightDockToolbar", "alignCanvasFloatingToolbar"] as const) vi.spyOn(test.canvas.actions, action);
  vi.spyOn(test.app.internalActions, "isShortcutFor");
  vi.spyOn(test.adapter, "handleUiButtonMouseTap");
  vi.spyOn(test.adapter, "handleUiButtonTouchTap");
  return { context: test.context, editor: test.editor, appHost: test.app,
    selection: test.editor.state.collections.selection, preview: test.editor.state.collections.preview };
}


// AI-REMOVED 2026-11-12:
// Reason: 旧假 App、Editor、视口及集合已不适用于独立 Canvas。
// Trigger: REQ-048 场景接口迁移。
// Evidence: 移动草稿、坐标换算和选择来自真实会话动作。
// Replacement: createCanvasTestSession 与版本化场景；原行为覆盖保留。
// Risk: 实际鼠标触控布局另由浏览器验收。
// Human Review: Required
// Original code:
// type MockCollection = string[] & {
//   contains(entityId: string): boolean;
//   replace(entityIds: readonly string[]): void;
// };


// AI-REMOVED 2026-11-12:
// Reason: 旧假 App、Editor、视口及集合已不适用于独立 Canvas。
// Trigger: REQ-048 场景接口迁移。
// Evidence: 移动草稿、坐标换算和选择来自真实会话动作。
// Replacement: createCanvasTestSession 与版本化场景；原行为覆盖保留。
// Risk: 实际鼠标触控布局另由浏览器验收。
// Human Review: Required
// Original code:
// type MockEditor = {
//   document: Pick<EditorContract["document"], "getSnapshot">;
//   state: Pick<EditorContract["state"], "collections" | "viewport">;
//   actions: Pick<
//     EditorContract["actions"],
//     | "addToCollection"
//     | "applyMoveOerationDraft"
//     | "cancelMoveOperationDraft"
//     | "clearCollection"
//     | "createMoveOperationDraft"
//     | "moveCollectionCenterPointTo"
//     | "moveCollectionTo"
//     | "replaceEntityDefinition"
//     | "rotateCollection"
//     | "rotateCollectionAroundCenterPoint"
//     | "rotateCollectionAroundPivotCell"
//     | "rotateCollectionToSnapOnBuilding"
//   >;
//   queries: Pick<
//     EditorContract["queries"],
//     | "findClientRectForGridCell"
//     | "findEntityCollectionGridRect"
//     | "findGridCellForClientPixelPoint"
//     | "getEntityById"
//   > & {
//     listEntities?: () => readonly WorldEntity[];
//   };
// };


// AI-REMOVED 2026-11-12:
// Reason: 旧假 App、Editor、视口及集合已不适用于独立 Canvas。
// Trigger: REQ-048 场景接口迁移。
// Evidence: 移动草稿、坐标换算和选择来自真实会话动作。
// Replacement: createCanvasTestSession 与版本化场景；原行为覆盖保留。
// Risk: 实际鼠标触控布局另由浏览器验收。
// Human Review: Required
// Original code:
// function createCollection(entityIds: readonly string[]): MockCollection {
//   const collection = [...entityIds] as MockCollection;
//   collection.contains = (entityId: string) => collection.includes(entityId);
//   collection.replace = (nextEntityIds: readonly string[]) => {
//     collection.splice(0, collection.length, ...nextEntityIds);
//   };
//   return collection;
// }


function entity(
  id: string,
  position: GridPoint,
  definitionId = "belt_straight_1x1",
): WorldEntity {
  return {
    id,
    definitionId,
    position,
    rotation: 0,
    config: {},
    tags: [],
  };
}

function mouseLongPressReadyEvent(options: {
  pointerEntity: WorldEntity | null;
  position?: GridPoint;
}) {
  return {
    type: "mouse-long-press-ready" as const,
    gestureId: "mouse-ready-1",
    button: 0,
    buttons: 1,
    position: options.position ?? { x: 2, y: 2 },
    pointerEntity: options.pointerEntity,
    modifiers: emptyModifiers(),
    sourceEvent: null,
  };
}

const MOVE_TOOLBAR_BUTTON_IDS_FOR_TEST = [
  "canvas-floating-toolbar-button-cancel",
  "canvas-floating-toolbar-button-rotate",
  "canvas-floating-toolbar-button-ok",
] as const;

const ORDINARY_MOVE_RIGHT_DOCK_TOOLBAR_ITEMS_WITH_VARIANT_FOR_TEST = [
  { operationId: "pan-viewport", presentation: "shortcut" },
  { operationId: "zoom-viewport", presentation: "shortcut" },
  { operationId: "delete-device", presentation: "shortcut" },
  { operationId: "switch-device-variant", presentation: "shortcut" },
  { operationId: "rotate-placement", presentation: "shortcut" },
  { operationId: "confirm-placement", presentation: "shortcut" },
] as const satisfies readonly CanvasRightDockToolbarItemRequest[];

const BATCH_MOVE_RIGHT_DOCK_TOOLBAR_ITEMS_FOR_TEST = [
  { operationId: "pan-viewport", presentation: "shortcut" },
  { operationId: "zoom-viewport", presentation: "shortcut" },
  { operationId: "rotate-placement", presentation: "shortcut" },
  { operationId: "confirm-placement", presentation: "shortcut" },
  { operationId: "cancel-placement", presentation: "shortcut" },
] as const satisfies readonly CanvasRightDockToolbarItemRequest[];

function tapLongPressReadyEvent(options: {
  pointerEntity: WorldEntity | null;
  position?: GridPoint;
}) {
  return {
    type: "tap-long-press-ready" as const,
    gestureId: "tap-ready-1",
    primaryId: 1,
    position: options.position ?? { x: 2, y: 2 },
    activeTouchCount: 1,
    pointerEntity: options.pointerEntity,
    modifiers: emptyModifiers(),
    sourceEvent: null,
  };
}

function touchDragStartEvent(options: {
  position: GridPoint;
  pointerEntity: WorldEntity | null;
  startPosition?: GridPoint;
}) {
  return {
    type: "touch dragstart" as const,
    gestureId: "touch-drag-1",
    primaryId: 1,
    position: options.position,
    startPosition: options.startPosition ?? options.position,
    activeTouchCount: 1,
    longPress: true,
    pointerEntity: options.pointerEntity,
    modifiers: emptyModifiers(),
    sourceEvent: null,
  };
}

function touchDragMoveEvent(options: {
  position: GridPoint;
}) {
  return {
    type: "touch dragmove" as const,
    gestureId: "touch-drag-1",
    primaryId: 1,
    position: options.position,
    delta: { x: 1, y: -1 },
    activeTouchCount: 1,
    longPress: true,
    modifiers: emptyModifiers(),
    sourceEvent: null,
  };
}

function mouseTapEvent(options: {
  button: number;
  longPress: boolean;
  modifiers?: Partial<ReturnType<typeof emptyModifiers>>;
}) {
  return {
    type: "mouse tap" as const,
    gestureId: "mouse-tap-1",
    button: options.button,
    buttons: 0,
    position: { x: 6, y: 4 },
    longPress: options.longPress,
    pointerEntity: null,
    modifiers: {
      ...emptyModifiers(),
      ...options.modifiers,
    },
    sourceEvent: null,
  };
}

function mouseMoveEvent(options: {
  position: GridPoint;
}) {
  return {
    type: "mouse move" as const,
    gestureId: "mouse-move-1",
    buttons: 0,
    position: options.position,
    delta: { x: 1, y: 1 },
    modifiers: emptyModifiers(),
    sourceEvent: null,
  };
}

function keyDownEvent(options: {
  code: string | null;
  key: string | null;
}) {
  return {
    type: "key down" as const,
    gestureId: "key-down-1",
    code: options.code,
    key: options.key,
    keyCode: options.key === null ? null : options.key.toUpperCase().charCodeAt(0),
    modifiers: emptyModifiers(),
    sourceEvent: null,
  };
}

function uiButtonTouchTapEvent(uiButtonId: string) {
  return {
    type: "ui-button-touch-tap" as const,
    gestureId: "ui-touch-tap-1",
    uiButtonId,
    modifiers: emptyModifiers(),
    sourceEvent: null,
  };
}

function uiButtonMouseTapEvent(uiButtonId: string) {
  return {
    type: "ui-button-mouse-tap" as const,
    gestureId: "ui-mouse-tap-1",
    uiButtonId,
    button: 0,
    modifiers: emptyModifiers(),
    sourceEvent: null,
  };
}

function onEnterActiveToolEvent(from: ActiveTool, to: ActiveTool) {
  return {
    type: "on-enter-active-tool" as const,
    gestureId: "enter-active-tool-1",
    from,
    to,
    modifiers: emptyModifiers(),
    sourceEvent: null,
  };
}

function mouseDragStartEvent(options: {
  originButton: number;
  pointerEntity: WorldEntity | null;
  position: GridPoint;
  startPosition?: GridPoint;
}) {
  return {
    type: "mouse dragstart" as const,
    gestureId: "mouse-drag-1",
    originButton: options.originButton,
    button: options.originButton,
    buttons: 1,
    position: options.position,
    startPosition: options.startPosition ?? options.position,
    longPress: false,
    pointerEntity: options.pointerEntity,
    modifiers: emptyModifiers(),
    sourceEvent: null,
  };
}

// AI-REMOVED 2026-11-12:
// Reason: 旧假 App、Editor、视口及集合已不适用于独立 Canvas。
// Trigger: REQ-048 场景接口迁移。
// Evidence: 移动草稿、坐标换算和选择来自真实会话动作。
// Replacement: createCanvasTestSession 与版本化场景；原行为覆盖保留。
// Risk: 实际鼠标触控布局另由浏览器验收。
// Human Review: Required
// Original code:
// function emptyKeyboardSnapshot(): KeyboardSnapshot {
//   return {
//     pressedKeys: new Set(),
//     lastCode: null,
//     lastKey: null,
//     lastKeyCode: null,
//     modifiers: emptyModifiers(),
//   };
// }


function emptyModifiers() {
  return {
    alt: false,
    ctrl: false,
    meta: false,
    shift: false,
  };
}
