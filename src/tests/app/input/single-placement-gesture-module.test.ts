import { createCanvasTestSession } from "@/tests/helpers/canvas-test-session";
import { loadBlueprintFromFile, createWorldDocumentFromBlueprint } from "@/tests/simulation/blueprint-test-helpers";
const cleanups: Array<() => void> = [];
afterEach(() => { for (const dispose of cleanups.splice(0).reverse()) dispose(); vi.restoreAllMocks(); });
// AI-REMOVED 2026-11-12:
// Reason: 旧假 App/Editor/集合/视口不再对应有效运行时接口。
// Trigger: REQ-048 Canvas/SceneSession 迁移。
// Evidence: module 通过真实 view 投影、会话策略和动作读取业务事实。
// Replacement: createCanvasTestSession 与真实放置/吸附/拒绝策略；原行为目标保留。
// Risk: 真正屏幕与触控仍需浏览器验证。
// Human Review: Required
// Original code:
// import type { SinglePlacementRequest } from "@/domain/editor/types/editor-session-types";

import { afterEach, describe, expect, it, vi } from "vitest";

// AI-REMOVED 2026-08-30:
// Reason: 测试不再直接断言模块调用 isShortcutFor，SHORTCUT_KEY import 无剩余引用。
// Trigger: ST2-RQ-020 测试迁移到 GestureActionRouter。
// Evidence: ESLint @typescript-eslint/no-unused-vars。
// Replacement: handleKeyboardShortcutThroughRouter in this test
// Risk: Low
// Human Review: Required
//
// Original code:
// import { SHORTCUT_KEY } from "@/app/actions/keyboard-shortcut-manager";
// AI-REMOVED 2026-11-12:
// Reason: 旧假 App/Editor/集合/视口不再对应有效运行时接口。
// Trigger: REQ-048 Canvas/SceneSession 迁移。
// Evidence: module 通过真实 view 投影、会话策略和动作读取业务事实。
// Replacement: createCanvasTestSession 与真实放置/吸附/拒绝策略；原行为目标保留。
// Risk: 真正屏幕与触控仍需浏览器验证。
// Human Review: Required
// Original code:
// import type { AppHost } from "@/app/host/app-host";

// AI-REMOVED 2026-11-12:
// Reason: 旧假 App/Editor/集合/视口不再对应有效运行时接口。
// Trigger: REQ-048 Canvas/SceneSession 迁移。
// Evidence: module 通过真实 view 投影、会话策略和动作读取业务事实。
// Replacement: createCanvasTestSession 与真实放置/吸附/拒绝策略；原行为目标保留。
// Risk: 真正屏幕与触控仍需浏览器验证。
// Human Review: Required
// Original code:
// import type { KeyboardSnapshot } from "@/app/input/gesture/adapter";

import type { CanvasRightDockToolbarItemRequest } from "@/app/state/state-impl";
import {
  createHypergryphSinglePlacementGestureModule,

} from "@/app/input/gesture/actions";
// AI-REMOVED 2026-11-12:
// Reason: 旧假 App/Editor/集合/视口不再对应有效运行时接口。
// Trigger: REQ-048 Canvas/SceneSession 迁移。
// Evidence: module 通过真实 view 投影、会话策略和动作读取业务事实。
// Replacement: createCanvasTestSession 与真实放置/吸附/拒绝策略；原行为目标保留。
// Risk: 真正屏幕与触控仍需浏览器验证。
// Human Review: Required
// Original code:
// import type { EditorContract } from "@/domain/editor/editor-contract";

// AI-REMOVED 2026-11-12:
// Reason: 旧假 App/Editor/集合/视口不再对应有效运行时接口。
// Trigger: REQ-048 Canvas/SceneSession 迁移。
// Evidence: module 通过真实 view 投影、会话策略和动作读取业务事实。
// Replacement: createCanvasTestSession 与真实放置/吸附/拒绝策略；原行为目标保留。
// Risk: 真正屏幕与触控仍需浏览器验证。
// Human Review: Required
// Original code:
// import type { WorkspaceContract } from "@/domain/document/workspace-contract";

// AI-REMOVED 2026-11-12:
// Reason: 旧假 App/Editor/集合/视口不再对应有效运行时接口。
// Trigger: REQ-048 Canvas/SceneSession 迁移。
// Evidence: module 通过真实 view 投影、会话策略和动作读取业务事实。
// Replacement: createCanvasTestSession 与真实放置/吸附/拒绝策略；原行为目标保留。
// Risk: 真正屏幕与触控仍需浏览器验证。
// Human Review: Required
// Original code:
// import { createWorldDocument, type WorldEntity } from "@/domain/document/world-document";

import {
  EntityCollectionType,
} from "@/domain/editor/types/editor-types";
// AI-REMOVED 2026-11-12:
// Reason: 旧假 App/Editor/集合/视口不再对应有效运行时接口。
// Trigger: REQ-048 Canvas/SceneSession 迁移。
// Evidence: module 通过真实 view 投影、会话策略和动作读取业务事实。
// Replacement: createCanvasTestSession 与真实放置/吸附/拒绝策略；原行为目标保留。
// Risk: 真正屏幕与触控仍需浏览器验证。
// Human Review: Required
// Original code:
// import type { ClientPixelRect } from "@/domain/shared/client-pixel";

import type { GridPoint, GridRect } from "@/domain/shared/grid";
// AI-REMOVED 2026-11-12:
// Reason: 旧假 App/Editor/集合/视口不再对应有效运行时接口。
// Trigger: REQ-048 Canvas/SceneSession 迁移。
// Evidence: module 通过真实 view 投影、会话策略和动作读取业务事实。
// Replacement: createCanvasTestSession 与真实放置/吸附/拒绝策略；原行为目标保留。
// Risk: 真正屏幕与触控仍需浏览器验证。
// Human Review: Required
// Original code:
// import { createRegistryContract } from "@/registry";

import { handleKeyboardShortcutThroughRouter } from "./shortcut-route-test-helper";

describe("createHypergryphSinglePlacementGestureModule", () => {
  it("enters mouse single-placement from a placement device button at the viewport center", () => {
    // AI-REMOVED 2026-11-12: Reason: 断言改读 Canvas，旧解构未使用；Trigger: REQ-048；Evidence: ESLint；Replacement: context.canvas；Risk: Low；Human Review: Required
    // Original code: const { context, editor, appHost } = createContext();
    const { context, editor } = createContext();
    const module = createHypergryphSinglePlacementGestureModule();

    const result = module.handle(placementMouseTapEvent("log_splitter"), context);

    expect(result).toEqual({ status: "handled" });
    expect(context.canvas.state.activeTool).toBe("single-placement");
    // 2026-05-19 订正：draft 创建已移至 on-enter-active-tool 统一处理，
    // 触发点只写桥接变量 + setActiveTool。
    expect(editor.actions.createSinglePlacementDraft).not.toHaveBeenCalled();

    expect(
      module.handle(onEnterActiveToolEvent("select", "single-placement"), context),
    ).toEqual({ status: "handled" });
    // 2026-06-23 订正：mouse 模式延迟创建 draft，鼠标不在 viewport 内时不创建
    expect(editor.actions.createSinglePlacementDraft).not.toHaveBeenCalled();
    expect(editor.actions.moveCollectionTo).not.toHaveBeenCalled();
    expect(editor.actions.moveCollectionCenterPointTo).not.toHaveBeenCalled();
    expect(context.canvas.state.runtime.placementAnchor).toBeNull();
    expect(context.canvas.state.runtime.singlePlacementDeviceId).toBe("log_splitter");
    expect(context.canvas.actions.hideCanvasFloatingToolbar).toHaveBeenCalledTimes(1);
    expect(context.canvas.actions.showCanvasRightDockToolbar).toHaveBeenCalledWith(
      PLACEMENT_RIGHT_DOCK_TOOLBAR_ITEMS_FOR_TEST,
    );
  });

  it("enters from a placement button even when the current tool is not select", () => {
    // AI-REMOVED 2026-11-12: Reason: 断言改读 Canvas，旧解构未使用；Trigger: REQ-048；Evidence: ESLint；Replacement: context.canvas；Risk: Low；Human Review: Required
    // Original code: const { context, editor, appHost } = createContext({
    const { context, editor } = createContext({
      activeTool: "marquee",
    });
    const module = createHypergryphSinglePlacementGestureModule();

    const result = module.handle(placementMouseTapEvent("log_splitter"), context);

    expect(result).toEqual({ status: "handled" });
    expect(context.canvas.state.activeTool).toBe("single-placement");
    // 2026-05-19 订正：draft 创建已移至 on-enter-active-tool 统一处理。
    expect(editor.actions.createSinglePlacementDraft).not.toHaveBeenCalled();

    expect(
      module.handle(onEnterActiveToolEvent("marquee", "single-placement"), context),
    ).toEqual({ status: "handled" });
    // 2026-06-23 订正：mouse 模式延迟创建 draft，鼠标不在 viewport 内时不创建
    expect(editor.actions.createSinglePlacementDraft).not.toHaveBeenCalled();
  });

  it("still only enters from select when using a number shortcut", () => {
    // AI-REMOVED 2026-11-12: Reason: 断言改读 Canvas，旧解构未使用；Trigger: REQ-048；Evidence: ESLint；Replacement: context.canvas；Risk: Low；Human Review: Required
    // Original code: const { context, editor, appHost } = createContext({
    const { context, editor } = createContext({
      activeTool: "marquee",
      selectingPlacementGroup: "warehouse",
    });
    const module = createHypergryphSinglePlacementGestureModule();

    const result = handleKeyboardShortcutThroughRouter({
      module,
      context,
      event: keyDownEvent({ code: "Digit3", key: "3" }),
    });

    expect(result).toEqual({ status: "ignored" });
    expect(editor.actions.createSinglePlacementDraft).not.toHaveBeenCalled();
    expect(context.canvas.state.activeTool).toBe("marquee");
  });

  it("enters touch single-placement and shows the floating toolbar for preview", () => {
    // AI-REMOVED 2026-11-12: Reason: 断言改读 Canvas，旧解构未使用；Trigger: REQ-048；Evidence: ESLint；Replacement: context.canvas；Risk: Low；Human Review: Required
    // Original code: const { context, appHost } = createContext();
    const { context } = createContext();
    const module = createHypergryphSinglePlacementGestureModule();

    const result = module.handle(placementTouchTapEvent("log_splitter"), context);

    expect(result).toEqual({ status: "handled" });
    expect(context.canvas.state.activeTool).toBe("single-placement");
    expect(context.canvas.actions.showCanvasFloatingToolbarForCollection).not.toHaveBeenCalled();

    expect(
      module.handle(onEnterActiveToolEvent("select", "single-placement"), context),
    ).toEqual({ status: "handled" });
    expect(context.canvas.actions.showCanvasTopLeftCornerToolbar).toHaveBeenCalledWith([
      CONTINUOUS_PLACEMENT_BUTTON_ID_FOR_TEST,
    ]);
    expect(context.canvas.actions.showCanvasFloatingToolbarForCollection).toHaveBeenCalledWith(
      PLACEMENT_TOOLBAR_BUTTON_IDS_FOR_TEST,
      EntityCollectionType.preview,
    );
    expect(context.canvas.actions.hideCanvasRightDockToolbar).toHaveBeenCalledTimes(1);
    expect(context.canvas.actions.showCanvasRightDockToolbar).not.toHaveBeenCalled();
  });

  it("toggles touch continuous placement from the top-left toolbar", () => {
    // AI-REMOVED 2026-11-12: Reason: 断言改读 Canvas，旧解构未使用；Trigger: REQ-048；Evidence: ESLint；Replacement: context.canvas；Risk: Low；Human Review: Required
    // Original code: const { context, appHost } = createContext({
    const { context } = createContext({
      activeTool: "single-placement",
      initialPreview: true,
      placementAnchor: { x: 5, y: 5 },
      singlePlacementDeviceId: "log_splitter",
      singlePlacementPointerMode: "touch",
    });
    const module = createHypergryphSinglePlacementGestureModule();

    expect(
      module.handle(
        uiButtonTouchTapEvent(`${CONTINUOUS_PLACEMENT_BUTTON_ID_FOR_TEST}-on`),
        context,
      ),
    ).toEqual({ status: "handled" });
    expect(context.canvas.state.runtime.singlePlacementContinuous).toBe(true);

    expect(
      module.handle(
        uiButtonTouchTapEvent(`${CONTINUOUS_PLACEMENT_BUTTON_ID_FOR_TEST}-off`),
        context,
      ),
    ).toEqual({ status: "handled" });
    expect(context.canvas.state.runtime.singlePlacementContinuous).toBe(false);
  });

  it("closes the left dock when entering single-placement on mobile and tablet", () => {
    for (const deviceClass of ["mobile", "tablet"] as const) {
      const { context, appHost } = createContext({
        deviceClass,
        leftDockOpen: true,
      });
      const module = createHypergryphSinglePlacementGestureModule();

      const result = module.handle(placementMouseTapEvent("log_splitter"), context);

      expect(result).toEqual({ status: "handled" });
      expect(appHost.internalActions.setLeftDockSuppressed).not.toHaveBeenCalled();

      expect(
        module.handle(onEnterActiveToolEvent("select", "single-placement"), context),
      ).toEqual({ status: "handled" });
      expect(appHost.internalActions.setLeftDockSuppressed).toHaveBeenCalledTimes(1);
      expect(appHost.internalActions.setLeftDockSuppressed).toHaveBeenCalledWith(true);
      expect(appHost.state.workbench.leftDockOpen).toBe(true);
      expect(appHost.internalState.workbench.leftDockSuppressed).toBe(true);
    }
  });

  it("selects a placement group from its configured shortcut while in select", () => {
    // AI-REMOVED 2026-11-12: Reason: 断言改读 Canvas，旧解构未使用；Trigger: REQ-048；Evidence: ESLint；Replacement: context.canvas；Risk: Low；Human Review: Required
    // Original code: const { context, editor, appHost } = createContext();
    const { context, editor } = createContext();
    const module = createHypergryphSinglePlacementGestureModule();

    const result = handleKeyboardShortcutThroughRouter({
      module,
      context,
      event: keyDownEvent({ code: "KeyG", key: "g" }),
    });

    expect(result).toEqual({ status: "handled" });
    expect(context.canvas.state.runtime.selectingPlacementGroup).toBe("resourcePower");
    expect(editor.actions.createSinglePlacementDraft).not.toHaveBeenCalled();
  });

  it("enters single-placement from the active placement group number shortcut", () => {
    // AI-REMOVED 2026-11-12: Reason: 断言改读 Canvas，旧解构未使用；Trigger: REQ-048；Evidence: ESLint；Replacement: context.canvas；Risk: Low；Human Review: Required
    // Original code: const { context, editor, appHost } = createContext({
    const { context, editor } = createContext({
      selectingPlacementGroup: "warehouse",
    });
    const module = createHypergryphSinglePlacementGestureModule();

    const result = handleKeyboardShortcutThroughRouter({
      module,
      context,
      // AI-REMOVED 2026-11-12:
// Reason: 真实 Registry 的 warehouse 分组中 unloader_1 位于第二项；旧假列表顺序不同。
// Trigger: REQ-048 真实场景接口迁移。
// Evidence: 真实 Editor/View/Router 的参数与运行状态。
// Replacement: 下方实际场景准备；原行为目标保持。
// Risk: Low；Human Review: Required
// Original code:
// event: keyDownEvent({ code: "Digit3", key: "3" }),
// AI-CORRECTION 2026-11-12：本内存会话允许全部设备，sp_hub_1 在 warehouse 排序首位，unloader_1 实际为第四项。
      event: keyDownEvent({ code: "Digit4", key: "4" }),
    });

    expect(result).toEqual({ status: "handled" });
    expect(context.canvas.state.activeTool).toBe("single-placement");
    // 2026-05-19 订正：draft 创建已移至 on-enter-active-tool 统一处理。
    expect(editor.actions.createSinglePlacementDraft).not.toHaveBeenCalled();

    expect(
      module.handle(onEnterActiveToolEvent("select", "single-placement"), context),
    ).toEqual({ status: "handled" });
    // 2026-06-23 订正：mouse 模式延迟创建 draft，鼠标不在 viewport 内时不创建
    expect(editor.actions.createSinglePlacementDraft).not.toHaveBeenCalled();
    expect(context.canvas.state.runtime.singlePlacementDeviceId).toBe("unloader_1");
  });

  it("uses the last mouse position when entering placement from a number shortcut", () => {
    // AI-REMOVED 2026-11-12: Reason: 断言改读 Canvas，旧解构未使用；Trigger: REQ-048；Evidence: ESLint；Replacement: context.canvas；Risk: Low；Human Review: Required
    // Original code: const { context, editor, appHost } = createContext({
    const { context, editor } = createContext({
      selectingPlacementGroup: "warehouse",
    });
    const module = createHypergryphSinglePlacementGestureModule();

    expect(module.handle(mouseMoveEvent({ position: { x: 7.8, y: 8.1 } }), context)).toEqual({
      status: "ignored",
    });

    const result = handleKeyboardShortcutThroughRouter({
      module,
      context,
      // AI-REMOVED 2026-11-12:
// Reason: 真实 Registry 的 warehouse 分组中 unloader_1 位于第二项；旧假列表顺序不同。
// Trigger: REQ-048 真实场景接口迁移。
// Evidence: 真实 Editor/View/Router 的参数与运行状态。
// Replacement: 下方实际场景准备；原行为目标保持。
// Risk: Low；Human Review: Required
// Original code:
// event: keyDownEvent({ code: "Digit3", key: "3" }),
// AI-CORRECTION 2026-11-12：本内存会话允许全部设备，sp_hub_1 在 warehouse 排序首位，unloader_1 实际为第四项。
      event: keyDownEvent({ code: "Digit4", key: "4" }),
    });

    expect(result).toEqual({ status: "handled" });
    expect(context.canvas.state.activeTool).toBe("single-placement");
    // 2026-05-19 订正：draft 创建已移至 on-enter-active-tool 统一处理。
// AI-REMOVED 2026-11-12:
// Reason: 真实路由在快捷键处理内同步发布 on-enter 并创建鼠标草稿。
// Trigger: REQ-048 Canvas/SceneSession 迁移。
// Evidence: module 通过真实 view 投影、会话策略和动作读取业务事实。
// Replacement: createCanvasTestSession 与真实放置/吸附/拒绝策略；原行为目标保留。
// Risk: 真正屏幕与触控仍需浏览器验证。
// Human Review: Required
// Original code:
//     expect(editor.actions.createSinglePlacementDraft).not.toHaveBeenCalled();


// AI-REMOVED 2026-11-12:
// Reason: 真实路由已完成进入，重复派发会重建草稿。
// Trigger: REQ-048 Canvas/SceneSession 迁移。
// Evidence: module 通过真实 view 投影、会话策略和动作读取业务事实。
// Replacement: createCanvasTestSession 与真实放置/吸附/拒绝策略；原行为目标保留。
// Risk: 真正屏幕与触控仍需浏览器验证。
// Human Review: Required
// Original code:
//     expect(
//       module.handle(onEnterActiveToolEvent("select", "single-placement"), context),
//     ).toEqual({ status: "handled" });

    expect(editor.actions.createSinglePlacementDraft).toHaveBeenCalledWith({ definitionId: "unloader_1", centerGridPoint: { x: 7, y: 8 } }
    );
    expect(context.canvas.state.runtime.placementAnchor).toEqual({ x: 7, y: 8 });
  });

  it("ignores number shortcuts when the active placement group has no target device for that slot", () => {
    // AI-REMOVED 2026-11-12: Reason: 断言改读 Canvas，旧解构未使用；Trigger: REQ-048；Evidence: ESLint；Replacement: context.canvas；Risk: Low；Human Review: Required
    // Original code: const { context, editor, appHost } = createContext({
    const { context, editor } = createContext({
      selectingPlacementGroup: "resourcePower",
    });
    const module = createHypergryphSinglePlacementGestureModule();

    const result = handleKeyboardShortcutThroughRouter({
      module,
      context,
      event: keyDownEvent({ code: "Digit0", key: "0" }),
    });

    expect(result).toEqual({ status: "ignored" });
    expect(editor.actions.createSinglePlacementDraft).not.toHaveBeenCalled();
    expect(context.canvas.state.activeTool).toBe("select");
  });

  it("ignores the same device while switching different devices without resetting activeTool", () => {
    const same = createContext({
      activeTool: "single-placement",
      placementAnchor: { x: 50, y: 40 },
      singlePlacementDeviceId: "log_splitter",
      initialPreview: true,
    });
    const different = createContext({
      activeTool: "single-placement",
      placementAnchor: { x: 50, y: 40 },
      singlePlacementDeviceId: "log_splitter",
      initialPreview: true,
    });
    const module = createHypergryphSinglePlacementGestureModule();

    expect(module.handle(placementMouseTapEvent("log_splitter"), same.context)).toEqual({
      status: "handled",
    });
    expect(same.editor.actions.cancelPlacementDraft).not.toHaveBeenCalled();
    expect(same.editor.actions.createSinglePlacementDraft).not.toHaveBeenCalled();

    expect(module.handle(placementMouseTapEvent("log_converger"), different.context)).toEqual({
      status: "handled",
    });
    expect(different.editor.actions.cancelPlacementDraft).toHaveBeenCalledTimes(1);
    // 2026-06-23 订正：mouse 模式延迟创建 draft，切换设备后鼠标不在 viewport 内时不创建
    expect(different.editor.actions.createSinglePlacementDraft).not.toHaveBeenCalled();
    expect(different.context.canvas.actions.setActiveTool).not.toHaveBeenCalled();
    expect(different.context.canvas.state.activeTool).toBe("single-placement");
    expect(different.context.canvas.state.runtime.singlePlacementDeviceId).toBe("log_converger");
  });

  it("moves the placement preview by incremental grid vectors and aligns toolbar", () => {
    // AI-REMOVED 2026-11-12: Reason: 断言改读 Canvas，旧解构未使用；Trigger: REQ-048；Evidence: ESLint；Replacement: context.canvas；Risk: Low；Human Review: Required
    // Original code: const { context, editor, appHost } = createContext({
    const { context, editor } = createContext({
      activeTool: "single-placement",
      placementAnchor: { x: 5, y: 5 },
      singlePlacementDeviceId: "log_splitter",
      initialPreview: true,
      previewRect: { x: 5, y: 5, width: 1, height: 1 },
    });
    const module = createHypergryphSinglePlacementGestureModule();

    // AI-REMOVED 2026-11-12:
// Reason: 几何、吸附和命中必须由真实会话计算，不能覆写业务动作。
// Trigger: REQ-048 Canvas/SceneSession 迁移。
// Evidence: module 通过真实 view 投影、会话策略和动作读取业务事实。
// Replacement: createCanvasTestSession 与真实放置/吸附/拒绝策略；原行为目标保留。
// Risk: 真正屏幕与触控仍需浏览器验证。
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


    const result = module.handle(touchDragMoveEvent({ position: { x: 6, y: 4 } }), context);

    expect(result).toEqual({ status: "handled" });
    expect(editor.actions.moveCollectionTo).toHaveBeenCalledWith({
      collectionType: EntityCollectionType.preview,
      startGridPoint: { x: 5, y: 5 },
      endGridPoint: { x: 6, y: 4 },
    });
    expect(context.canvas.state.runtime.placementAnchor).toEqual({ x: 6, y: 4 });
    expect(editor.actions.rotateCollectionToSnapOnBuilding).toHaveBeenCalledWith({
      collectionType: EntityCollectionType.preview,
      trigger: "after-move",
      pivotMode: "pivot-cell",
      clientPixelPoint: null, viewport: context.canvas.view.state,
    });
    expect(context.canvas.actions.alignCanvasFloatingToolbar).toHaveBeenCalledTimes(1);
  });

  it("updates touch placement anchor per axis when snapping constrains one axis", () => {
    // AI-REMOVED 2026-11-12: Reason: 断言改读 Canvas，旧解构未使用；Trigger: REQ-048；Evidence: ESLint；Replacement: context.canvas；Risk: Low；Human Review: Required
    // Original code: const { context, editor, appHost } = createContext({
    const { context } = createContext({
      activeTool: "single-placement",
      placementAnchor: { x: 20, y: -9 },
      singlePlacementDeviceId: "water_purifier_node_1",
      singlePlacementPointerMode: "touch",
      initialPreview: true,
      previewDefinitionId: "water_purifier_node_1",
      previewRect: { x: 10, y: -10, width: 27, height: 3 },
    });
    const module = createHypergryphSinglePlacementGestureModule();

    // AI-REMOVED 2026-11-12:
// Reason: 几何、吸附和命中必须由真实会话计算，不能覆写业务动作。
// Trigger: REQ-048 Canvas/SceneSession 迁移。
// Evidence: module 通过真实 view 投影、会话策略和动作读取业务事实。
// Replacement: createCanvasTestSession 与真实放置/吸附/拒绝策略；原行为目标保留。
// Risk: 真正屏幕与触控仍需浏览器验证。
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
    expect(context.canvas.state.runtime.placementAnchor).toEqual({ x: 21, y: -9 });
    expect(context.canvas.actions.alignCanvasFloatingToolbar).toHaveBeenCalledTimes(1);
  });

  it("moves the mouse placement preview by collection center point", () => {
    // AI-REMOVED 2026-11-12: Reason: 断言改读 Canvas，旧解构未使用；Trigger: REQ-048；Evidence: ESLint；Replacement: context.canvas；Risk: Low；Human Review: Required
    // Original code: const { context, editor, appHost } = createContext({
    const { context, editor } = createContext({
      activeTool: "single-placement",
      placementAnchor: { x: 5, y: 5 },
      singlePlacementDeviceId: "log_splitter",
      singlePlacementPointerMode: "mouse",
      initialPreview: true,
      previewRect: { x: 5, y: 5, width: 1, height: 1 },
    });
    const module = createHypergryphSinglePlacementGestureModule();

    const result = module.handle(mouseMoveEvent({ position: { x: 18, y: 23 } }), context);

    expect(result).toEqual({ status: "handled" });
    expect(editor.actions.moveCollectionCenterPointTo).toHaveBeenCalledWith(
      EntityCollectionType.preview,
      { x: 18, y: 23 }, context.canvas.view.state,
    );
    // AI-REMOVED 2026-09-23:
    // Reason: 鼠标预览移动后，放置锚点应同步到当前鼠标位置对应的网格。
    // Trigger: Ctrl 连续放置后新虚影偏离已放置建筑。
    // Evidence: moveCollectionCenterPointTo 使用当前鼠标位置，旧断言仍要求锚点保持初始值。
    // Replacement: 下方对当前网格锚点的断言。
    // Risk: Low
    // Human Review: Required
    //
    // Original code:
    // expect(appHost.internalState.runtime.placementAnchor).toEqual({ x: 5, y: 5 });
    expect(context.canvas.state.runtime.placementAnchor).toEqual({ x: 18, y: 23 });
    expect(context.canvas.actions.alignCanvasFloatingToolbar).toHaveBeenCalledTimes(1);
  });

  it("lets touch drag fall through when it does not start from the preview", () => {
    // AI-REMOVED 2026-11-12: Reason: 断言改读 Canvas，旧解构未使用；Trigger: REQ-048；Evidence: ESLint；Replacement: context.canvas；Risk: Low；Human Review: Required
    // Original code: const { context, appHost } = createContext({
    const { context } = createContext({
      activeTool: "single-placement",
      placementAnchor: { x: 5, y: 5 },
      singlePlacementDeviceId: "log_splitter",
      initialPreview: true,
      previewRect: { x: 5, y: 5, width: 1, height: 1 },
    });
    const module = createHypergryphSinglePlacementGestureModule();

    // AI-REMOVED 2026-11-12:
// Reason: 真实触控命中有 16px 边距；一格一像素的测试相机需选择边距以外的位置。
// Trigger: REQ-048 真实场景接口迁移。
// Evidence: 真实 Editor/View/Router 的参数与运行状态。
// Replacement: 下方实际场景准备；原行为目标保持。
// Risk: Low；Human Review: Required
// Original code:
// const missResult = module.handle(touchDragStartEvent({ position: { x: 2, y: 2 } }), context);
const missResult = module.handle(touchDragStartEvent({ position: { x: 32, y: 32 } }), context);

    expect(missResult).toEqual({ status: "ignored" });
    expect(context.canvas.state.runtime.placementAnchor).toBeNull();
  });

  it("starts touch dragging from the preview bounding box even when no entity is hit", () => {
    // AI-REMOVED 2026-11-12: Reason: 断言改读 Canvas，旧解构未使用；Trigger: REQ-048；Evidence: ESLint；Replacement: context.canvas；Risk: Low；Human Review: Required
    // Original code: const { context, editor, appHost } = createContext({
    const { context } = createContext({
      activeTool: "single-placement",
      placementAnchor: { x: 5, y: 5 },
      singlePlacementDeviceId: "filling_pd_mc_1",
      previewDefinitionId: "filling_pd_mc_1",
      initialPreview: true,
      previewRect: { x: 5, y: 5, width: 6, height: 4 },
    });
    const module = createHypergryphSinglePlacementGestureModule();

    // AI-REMOVED 2026-11-12:
// Reason: 几何、吸附和命中必须由真实会话计算，不能覆写业务动作。
// Trigger: REQ-048 Canvas/SceneSession 迁移。
// Evidence: module 通过真实 view 投影、会话策略和动作读取业务事实。
// Replacement: createCanvasTestSession 与真实放置/吸附/拒绝策略；原行为目标保留。
// Risk: 真正屏幕与触控仍需浏览器验证。
// Human Review: Required
// Original code:
// vi.mocked(editor.queries.findEntityAtClientPixelPoint).mockReturnValue(null);


    const result = module.handle(touchDragStartEvent({ position: { x: 8, y: 8 } }), context);

    expect(result).toEqual({ status: "handled" });
    expect(context.canvas.state.runtime.placementAnchor).toEqual({ x: 8, y: 8 });
  });

  it("keeps a preview drag when the first movement leaves its bounds", () => {
    // AI-REMOVED 2026-11-12: Reason: 断言改读 Canvas，旧解构未使用；Trigger: REQ-048；Evidence: ESLint；Replacement: context.canvas；Risk: Low；Human Review: Required
    // Original code: const { context, editor, appHost } = createContext({
    const { context, editor } = createContext({
      activeTool: "single-placement",
      placementAnchor: { x: 5, y: 5 },
      singlePlacementDeviceId: "log_splitter",
      initialPreview: true,
      previewRect: { x: 5, y: 5, width: 1, height: 1 },
    });
    const module = createHypergryphSinglePlacementGestureModule();

    const result = module.handle(touchDragStartEvent({
      startPosition: { x: 5, y: 5 },
      position: { x: 6, y: 5 },
    }), context);

    expect(result).toEqual({ status: "handled" });
    expect(context.canvas.state.runtime.placementAnchor).toEqual({ x: 5, y: 5 });

    expect(module.handle(touchDragMoveEvent({ position: { x: 7, y: 5 } }), context)).toEqual({
      status: "handled",
    });
    expect(editor.actions.moveCollectionTo).toHaveBeenCalledWith({
      collectionType: EntityCollectionType.preview,
      startGridPoint: { x: 5, y: 5 },
      endGridPoint: { x: 7, y: 5 },
    });
  });

  it("rotates from the R key and toolbar button while placing", () => {
    const keyboard = createContext({
      activeTool: "single-placement",
      placementAnchor: { x: 5, y: 5 },
      singlePlacementDeviceId: "log_splitter",
      singlePlacementPointerMode: "mouse",
      initialPreview: true,
    });
    const toolbar = createContext({
      activeTool: "single-placement",
      placementAnchor: { x: 5, y: 5 },
      singlePlacementDeviceId: "log_splitter",
      initialPreview: true,
    });
    const module = createHypergryphSinglePlacementGestureModule();

    expect(handleKeyboardShortcutThroughRouter({
      module,
      context: keyboard.context,
      event: keyDownEvent({ code: "KeyR", key: "r" }),
    })).toEqual({ status: "handled" });
    // AI-CORRECTION 2026-08-30: 快捷键匹配已由 GestureActionRouter 执行。
    expect(keyboard.appHost.internalActions.isShortcutFor).not.toHaveBeenCalled();
    expect(keyboard.editor.actions.rotateCollectionAroundCenterPoint).toHaveBeenCalledWith(
      EntityCollectionType.preview,
      90,
    );
    expect(keyboard.context.canvas.actions.alignCanvasFloatingToolbar).toHaveBeenCalledTimes(1);

    expect(
      module.handle(uiButtonTouchTapEvent("canvas-floating-toolbar-button-rotate"), toolbar.context),
    ).toEqual({ status: "handled" });
    expect(toolbar.editor.actions.rotateCollectionAroundPivotCell).toHaveBeenCalledWith(
      EntityCollectionType.preview,
      90,
    );
    expect(toolbar.context.canvas.actions.alignCanvasFloatingToolbar).toHaveBeenCalledTimes(1);
  });

  it("uses building-snap rotation before the normal placement-preview rotation", () => {
    const { context, editor } = createContext({
      activeTool: "single-placement",
      placementAnchor: { x: 5, y: 5 },
      singlePlacementDeviceId: "loader_1",
      singlePlacementPointerMode: "touch",
      initialPreview: true,
      previewDefinitionId: "loader_1",
    });
    const module = createHypergryphSinglePlacementGestureModule();
    // AI-REMOVED 2026-11-12:
// Reason: 几何、吸附和命中必须由真实会话计算，不能覆写业务动作。
// Trigger: REQ-048 Canvas/SceneSession 迁移。
// Evidence: module 通过真实 view 投影、会话策略和动作读取业务事实。
// Replacement: createCanvasTestSession 与真实放置/吸附/拒绝策略；原行为目标保留。
// Risk: 真正屏幕与触控仍需浏览器验证。
// Human Review: Required
// Original code:
// vi.mocked(editor.actions.rotateCollectionToSnapOnBuilding).mockReturnValue(true);


    expect(
      module.handle(uiButtonTouchTapEvent("canvas-floating-toolbar-button-rotate"), context),
    ).toEqual({ status: "handled" });
    expect(editor.actions.rotateCollectionToSnapOnBuilding).toHaveBeenCalledWith({
      collectionType: EntityCollectionType.preview,
      trigger: "before-rotate",
      pivotMode: "pivot-cell",
      clientPixelPoint: null, viewport: context.canvas.view.state,
    });
    expect(editor.actions.rotateCollectionAroundPivotCell).not.toHaveBeenCalled();
    expect(editor.actions.rotateCollectionAroundCenterPoint).not.toHaveBeenCalled();
  });

  it("switches the placement preview variant from Tab and updates the touch toolbar", () => {
    const { context, editor, appHost } = createContext({
      activeTool: "single-placement",
      initialPreview: true,
      placementAnchor: { x: 12, y: 11 },
      previewDefinitionId: "filling_pd_mc_1",
      previewRect: { x: 10, y: 10, width: 6, height: 4 },
      singlePlacementDeviceId: "filling_pd_mc_1",
      singlePlacementPointerMode: "touch",
    });
    const module = createHypergryphSinglePlacementGestureModule();

    const result = handleKeyboardShortcutThroughRouter({
      module,
      context,
      event: keyDownEvent({ code: "Tab", key: "Tab" }),
    });

    expect(result).toEqual({ status: "handled" });
    // AI-CORRECTION 2026-08-30: 快捷键匹配已由 GestureActionRouter 执行。
    expect(appHost.internalActions.isShortcutFor).not.toHaveBeenCalled();
    expect(editor.actions.replaceEntityDefinition).toHaveBeenCalledWith(
      "preview-entity",
      "filling_pd_mc_1_liquid",
    );
    expect(context.canvas.state.runtime.singlePlacementDeviceId).toBe(
      "filling_pd_mc_1_liquid",
    );
    expect(context.canvas.actions.showCanvasFloatingToolbarForCollection).toHaveBeenLastCalledWith(
      [
        "canvas-floating-toolbar-button-cancel",
        "canvas-floating-toolbar-button-switch-mode",
        "canvas-floating-toolbar-button-rotate",
        "canvas-floating-toolbar-button-ok",
      ],
      EntityCollectionType.preview,
    );
  });

  it("shows the Tab shortcut for a switchable device in mouse placement", () => {
    // AI-REMOVED 2026-11-12: Reason: 断言改读 Canvas，旧解构未使用；Trigger: REQ-048；Evidence: ESLint；Replacement: context.canvas；Risk: Low；Human Review: Required
    // Original code: const { context, appHost } = createContext({
    const { context } = createContext({
      activeTool: "single-placement",
      singlePlacementDeviceId: "filling_pd_mc_1",
      singlePlacementPointerMode: "mouse",
    });
    const module = createHypergryphSinglePlacementGestureModule();

    expect(module.handle(onEnterActiveToolEvent("select", "single-placement"), context)).toEqual({
      status: "handled",
    });
    expect(context.canvas.actions.showCanvasRightDockToolbar).toHaveBeenCalledWith(
      PLACEMENT_RIGHT_DOCK_TOOLBAR_ITEMS_WITH_VARIANT_FOR_TEST,
    );
  });

  it("keeps mouse placement active when apply uses ctrl", () => {
    // AI-REMOVED 2026-11-12: Reason: 断言改读 Canvas，旧解构未使用；Trigger: REQ-048；Evidence: ESLint；Replacement: context.canvas；Risk: Low；Human Review: Required
    // Original code: const { context, editor, appHost } = createContext({
    const { context, editor } = createContext({
      activeTool: "single-placement",
      initialPreview: true,
      placementAnchor: { x: 5, y: 5 },
      singlePlacementDeviceId: "log_splitter",
      singlePlacementPointerMode: "mouse",
    });
    const module = createHypergryphSinglePlacementGestureModule();

    expect(
      module.handle(
        mouseTapEvent({
          button: 0,
          longPress: false,
          modifiers: { ctrl: true },
        }),
        context,
      ),
    ).toEqual({ status: "handled" });

    expect(editor.actions.applyPlacementDraft).toHaveBeenCalledTimes(1);
    expect(editor.actions.createSinglePlacementDraft).toHaveBeenCalledWith({ definitionId: "log_splitter", centerGridPoint: {
      x: 5,
      y: 5,
    } });
    expect(context.canvas.actions.setActiveTool).not.toHaveBeenCalled();
    expect(context.canvas.state.activeTool).toBe("single-placement");
    expect(context.canvas.state.runtime.placementAnchor).toEqual({ x: 5, y: 5 });
    expect(context.canvas.state.runtime.singlePlacementDeviceId).toBe("log_splitter");
  });

  it("keeps touch placement active and preserves rotation when continuous placement is enabled", () => {
    // AI-REMOVED 2026-11-12: Reason: 断言改读 Canvas，旧解构未使用；Trigger: REQ-048；Evidence: ESLint；Replacement: context.canvas；Risk: Low；Human Review: Required
    // Original code: const { context, editor, appHost } = createContext({
    const { context, editor } = createContext({
      activeTool: "single-placement",
      initialPreview: true,
      placementAnchor: { x: 5, y: 5 },
      previewRotation: 180,
      singlePlacementContinuous: true,
      singlePlacementDeviceId: "log_splitter",
      singlePlacementPointerMode: "touch",
    });
    const module = createHypergryphSinglePlacementGestureModule();

    expect(
      module.handle(uiButtonTouchTapEvent("canvas-floating-toolbar-button-ok"), context),
    ).toEqual({ status: "handled" });

    expect(editor.actions.applyPlacementDraft).toHaveBeenCalledTimes(1);
    expect(editor.actions.createSinglePlacementDraft).toHaveBeenCalledWith({ definitionId: "log_splitter", centerGridPoint: {
      x: 5,
      y: 5,
    } });
    expect(editor.actions.rotateCollectionAroundPivotCell).toHaveBeenCalledTimes(2);
    expect(context.canvas.actions.showCanvasTopLeftCornerToolbar).toHaveBeenCalledWith([
      `${CONTINUOUS_PLACEMENT_BUTTON_ID_FOR_TEST}-off`,
    ]);
    expect(context.canvas.actions.setActiveTool).not.toHaveBeenCalled();
    expect(context.canvas.state.activeTool).toBe("single-placement");
    expect(context.canvas.state.runtime.singlePlacementContinuous).toBe(true);
  });

  it("keeps touch placement preview when the editor rejects apply", () => {
    // AI-REMOVED 2026-11-12: Reason: 断言改读 Canvas，旧解构未使用；Trigger: REQ-048；Evidence: ESLint；Replacement: context.canvas；Risk: Low；Human Review: Required
    // Original code: const { context, editor, appHost, preview } = createContext({
    const { context, editor, preview } = createContext({
      activeTool: "single-placement",
      applyPlacementDraftResult: false,
      initialPreview: true,
      placementAnchor: { x: -6, y: 5 },
      singlePlacementDeviceId: "log_splitter",
      singlePlacementPointerMode: "touch",
    });
    const module = createHypergryphSinglePlacementGestureModule();

    expect(
      module.handle(uiButtonTouchTapEvent("canvas-floating-toolbar-button-ok"), context),
    ).toEqual({ status: "handled" });

    expect(editor.actions.applyPlacementDraft).toHaveBeenCalledTimes(1);
    expect(editor.actions.createSinglePlacementDraft).not.toHaveBeenCalled();
    expect(editor.actions.cancelPlacementDraft).not.toHaveBeenCalled();
    expect([...preview]).toEqual(["preview-entity"]);
    expect(context.canvas.actions.setActiveTool).not.toHaveBeenCalled();
    expect(context.canvas.state.activeTool).toBe("single-placement");
    expect(context.canvas.state.runtime.placementAnchor).toEqual({ x: -6, y: 5 });
    expect(context.canvas.state.runtime.singlePlacementDeviceId).toBe("log_splitter");
  });

  it("does not continue touch placement when the editor rejects apply", () => {
    // AI-REMOVED 2026-11-12: Reason: 断言改读 Canvas，旧解构未使用；Trigger: REQ-048；Evidence: ESLint；Replacement: context.canvas；Risk: Low；Human Review: Required
    // Original code: const { context, editor, appHost, preview } = createContext({
    const { context, editor, preview } = createContext({
      activeTool: "single-placement",
      applyPlacementDraftResult: false,
      initialPreview: true,
      placementAnchor: { x: -6, y: 5 },
      singlePlacementContinuous: true,
      singlePlacementDeviceId: "log_splitter",
      singlePlacementPointerMode: "touch",
    });
    const module = createHypergryphSinglePlacementGestureModule();

    expect(
      module.handle(uiButtonTouchTapEvent("canvas-floating-toolbar-button-ok"), context),
    ).toEqual({ status: "handled" });

    expect(editor.actions.applyPlacementDraft).toHaveBeenCalledTimes(1);
    expect(editor.actions.createSinglePlacementDraft).not.toHaveBeenCalled();
    expect([...preview]).toEqual(["preview-entity"]);
    expect(context.canvas.actions.setActiveTool).not.toHaveBeenCalled();
    expect(context.canvas.state.activeTool).toBe("single-placement");
    expect(context.canvas.state.runtime.singlePlacementContinuous).toBe(true);
  });

  it("applies with mouse left tap and cancels from the toolbar", () => {
    const apply = createContext({
      activeTool: "single-placement",
      placementAnchor: { x: 5, y: 5 },
      singlePlacementDeviceId: "log_splitter",
      singlePlacementPointerMode: "mouse",
      initialPreview: true,
    });
    const cancel = createContext({
      activeTool: "single-placement",
      placementAnchor: { x: 5, y: 5 },
      singlePlacementContinuous: true,
      singlePlacementDeviceId: "log_splitter",
      singlePlacementPointerMode: "touch",
      initialPreview: true,
    });
    const module = createHypergryphSinglePlacementGestureModule();

    expect(module.handle(mouseTapEvent({ button: 0, longPress: false }), apply.context)).toEqual({
      status: "handled",
    });
    expect(apply.editor.actions.applyPlacementDraft).toHaveBeenCalledTimes(1);
    expect(apply.context.canvas.state.activeTool).toBe("select");
    expect(apply.context.canvas.state.runtime.placementAnchor).toBeNull();
    expect(apply.context.canvas.state.runtime.singlePlacementDeviceId).toBeNull();
    expect(apply.context.canvas.actions.hideCanvasRightDockToolbar).toHaveBeenCalledTimes(1);

    expect(
      module.handle(uiButtonTouchTapEvent("canvas-floating-toolbar-button-cancel"), cancel.context),
    ).toEqual({ status: "handled" });
    expect(cancel.editor.actions.cancelPlacementDraft).toHaveBeenCalledTimes(1);
    expect(cancel.context.canvas.actions.hideCanvasTopLeftCornerToolbar).toHaveBeenCalledTimes(1);
    expect(cancel.context.canvas.state.activeTool).toBe("select");
    expect(cancel.context.canvas.state.runtime.placementAnchor).toBeNull();
    expect(cancel.context.canvas.state.runtime.singlePlacementContinuous).toBe(false);
    expect(cancel.context.canvas.state.runtime.singlePlacementDeviceId).toBeNull();
    expect(cancel.context.canvas.actions.hideCanvasRightDockToolbar).toHaveBeenCalledTimes(1);
  });
});

// AI-REMOVED 2026-11-12:
// Reason: 旧假 App/Editor/集合/视口不再对应有效运行时接口。
// Trigger: REQ-048 Canvas/SceneSession 迁移。
// Evidence: module 通过真实 view 投影、会话策略和动作读取业务事实。
// Replacement: createCanvasTestSession 与真实放置/吸附/拒绝策略；原行为目标保留。
// Risk: 真正屏幕与触控仍需浏览器验证。
// Human Review: Required
// Original code:
// function createContext(options: {
//   activeTool?: "select" | "move" | "marquee" | "single-placement";
//   placementAnchor?: GridPoint | null;
//   previewRotation?: 0 | 90 | 180 | 270;
//   singlePlacementContinuous?: boolean;
//   singlePlacementDeviceId?: string | null;
//   singlePlacementPointerMode?: "mouse" | "touch" | null;
//   selectingPlacementGroup?: "beltLogistics" | "pipeLogistics" | "resourcePower" | "warehouse" | "basicProduction" | "advancedManufacturing" | null;
//   initialPreview?: boolean;
//   previewRect?: GridRect;
//   deviceClass?: "desktop" | "tablet" | "mobile";
//   leftDockOpen?: boolean;
//   applyPlacementDraftResult?: boolean;
//   previewDefinitionId?: string;
// } = {}): {
//   context: GestureActionContext<AppHost>;
//   editor: MockEditor;
//   appHost: AppHost;
//   preview: MockCollection;
//   previewRectRef: { current: GridRect };
// } {
//   const selection = createCollection([]);
//   const marquee = createCollection([]);
//   const reverseMarquee = createCollection([]);
//   const preview = createCollection(options.initialPreview ? ["preview-entity"] : []);
//   const ghost = createCollection([]);
//   const previewRectRef = {
//     current: options.previewRect ?? {
//       x: 0,
//       y: 0,
//       width: 1,
//       height: 1,
//     },
//   };
//   const previewEntity = entity(
//     "preview-entity",
//     {
//       x: previewRectRef.current.x,
//       y: previewRectRef.current.y,
//     },
//     options.previewRotation ?? 0,
//     options.previewDefinitionId,
//   );
//   const viewportClientRect: ClientPixelRect = {
//     left: 0,
//     top: 0,
//     width: 100,
//     height: 80,
//   };
//   const editor: MockEditor = {
//     // AI-CORRECTION 2026-10-12: 地图资格不再允许未知文档；旧路由布景显式提供已加载地图的完整快照。
//     document: { getSnapshot: () => createWorldDocument({ baseId: "wuling_protocol_core" }) },
//     state: {
//       viewport: {
//         center: { x: 0, y: 0 },
//         clientRect: viewportClientRect,
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
//       getEntityById: vi.fn((entityId) => (entityId === previewEntity.id ? previewEntity : null)),
//       findEntityAtClientPixelPoint: vi.fn((point) => {
//         const gridCell = {
//           x: Math.floor(point.x),
//           y: Math.floor(point.y),
//         };
//
//         if (
//           preview.contains(previewEntity.id)
//           && gridCell.x >= previewRectRef.current.x
//           && gridCell.x < previewRectRef.current.x + previewRectRef.current.width
//           && gridCell.y >= previewRectRef.current.y
//           && gridCell.y < previewRectRef.current.y + previewRectRef.current.height
//         ) {
//           return previewEntity;
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
//         left: cell.x,
//         top: cell.y,
//         width: 1,
//         height: 1,
//       })),
//     },
//     actions: {
//       createSinglePlacementDraft: vi.fn(
//         ({ definitionId: deviceDefinitionId, centerGridPoint }: SinglePlacementRequest) => {
//           previewEntity.definitionId = deviceDefinitionId;
//           previewEntity.position = { ...centerGridPoint };
//           previewEntity.rotation = 0;
//           previewRectRef.current = {
//             x: centerGridPoint.x,
//             y: centerGridPoint.y,
//             width: 1,
//             height: 1,
//           };
//           preview.replace(["preview-entity"]);
//         },
//       ),
//       cancelPlacementDraft: vi.fn(() => {
//         preview.replace([]);
//       }),
//       applyPlacementDraft: vi.fn(() => {
//         const applied = options.applyPlacementDraftResult ?? true;
//         if (applied) {
//           preview.replace([]);
//         }
//
//         return applied;
//       }),
//       moveCollectionTo: vi.fn(({
//         startGridPoint,
//         endGridPoint,
//       }) => {
//         const vector = {
//           x: endGridPoint.x - startGridPoint.x,
//           y: endGridPoint.y - startGridPoint.y,
//         };
//         previewRectRef.current = {
//           ...previewRectRef.current,
//           x: previewRectRef.current.x + vector.x,
//           y: previewRectRef.current.y + vector.y,
//         };
//         previewEntity.position = {
//           x: previewEntity.position.x + vector.x,
//           y: previewEntity.position.y + vector.y,
//         };
//       }),
//       moveCollectionCenterPointTo: vi.fn((_, point) => {
//         previewRectRef.current = {
//           ...previewRectRef.current,
//           x: point.x,
//           y: point.y,
//         };
//         previewEntity.position = {
//           x: point.x,
//           y: point.y,
//         };
//       }),
//       rotateCollection: vi.fn(() => {
//         previewEntity.rotation = rotateClockwise(previewEntity.rotation);
//       }),
//       rotateCollectionAroundCenterPoint: vi.fn(() => {
//         previewEntity.rotation = rotateClockwise(previewEntity.rotation);
//       }),
//       rotateCollectionAroundPivotCell: vi.fn(() => {
//         previewEntity.rotation = rotateClockwise(previewEntity.rotation);
//       }),
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
//     },
//   };
//   const shortcuts: Record<string, string> = {
//     "shortcut-place-conveyor": "E",
//     "shortcut-place-pipe": "Q",
//     "shortcut-resources-power": "G",
//     "shortcut-warehouse": "C",
//     "shortcut-basic-production": "V",
//     "shortcut-synthesis": "B",
//     "shortcut-rotate": "R",
//     "shortcut-switch-device-mode": "Tab",
//   };
//   const workbenchState = {
//     leftDockOpen: options.leftDockOpen ?? true,
//     leftDockSuppressed: false,
//   };
//
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
//       },
//       activeTool: options.activeTool ?? "select",
//       screenProfile: {
//         deviceClass: options.deviceClass ?? "desktop",
//       },
//       workbench: workbenchState,
//     },
//     internalState: {
//       activeTool: options.activeTool ?? "select",
//       workbench: workbenchState,
//       runtime: {
//         placementAnchor: options.placementAnchor ?? null,
//         singlePlacementContinuous: options.singlePlacementContinuous ?? false,
//         singlePlacementDeviceId: options.singlePlacementDeviceId ?? null,
//         singlePlacementPointerMode: options.singlePlacementPointerMode ?? null,
//         selectingPlacementGroup: options.selectingPlacementGroup ?? null,
//         canvasFloatingToolbar: {
//           visible: false,
//           buttonIds: [],
//           anchor: null,
//           attachedCollection: null,
//           measuredSize: null,
//         },
//         canvasTopLeftCornerToolbar: {
//           visible: false,
//           buttonIds: [],
//           initialOffButtonIds: [],
//         },
//         canvasRightDockToolbar: {
//           visible: false,
//           items: [] as CanvasRightDockToolbarItemRequest[],
//         },
//       },
//     },
//     internalActions: {
//       setActiveTool: vi.fn((activeTool) => {
//         appHost.internalState.activeTool = activeTool;
//       }),
//       setLeftDockSuppressed: vi.fn((suppressed) => {
//         appHost.internalState.workbench.leftDockSuppressed = suppressed;
//       }),
//       showCanvasFloatingToolbarForCollection: vi.fn((buttonIds, collectionType) => {
//         if (editor.queries.findEntityCollectionGridRect(collectionType) === null) {
//           return false;
//         }
//
//         appHost.internalState.runtime.canvasFloatingToolbar.visible = true;
//         appHost.internalState.runtime.canvasFloatingToolbar.buttonIds = [...buttonIds];
//         appHost.internalState.runtime.canvasFloatingToolbar.attachedCollection = collectionType;
//         return true;
//       }),
//       hideCanvasFloatingToolbar: vi.fn(() => {
//         appHost.internalState.runtime.canvasFloatingToolbar.visible = false;
//         appHost.internalState.runtime.canvasFloatingToolbar.buttonIds = [];
//         appHost.internalState.runtime.canvasFloatingToolbar.attachedCollection = null;
//       }),
//       showCanvasTopLeftCornerToolbar: vi.fn((buttonIds) => {
//         appHost.internalState.runtime.canvasTopLeftCornerToolbar.visible = true;
//         appHost.internalState.runtime.canvasTopLeftCornerToolbar.buttonIds = [...buttonIds];
//       }),
//       hideCanvasTopLeftCornerToolbar: vi.fn(() => {
//         appHost.internalState.runtime.canvasTopLeftCornerToolbar.visible = false;
//         appHost.internalState.runtime.canvasTopLeftCornerToolbar.buttonIds = [];
//         appHost.internalState.runtime.canvasTopLeftCornerToolbar.initialOffButtonIds = [];
//       }),
//       showCanvasRightDockToolbar: vi.fn((items: readonly CanvasRightDockToolbarItemRequest[]) => {
//         appHost.internalState.runtime.canvasRightDockToolbar.visible = true;
//         appHost.internalState.runtime.canvasRightDockToolbar.items = [...items];
//       }),
//       hideCanvasRightDockToolbar: vi.fn(() => {
//         appHost.internalState.runtime.canvasRightDockToolbar.visible = false;
//         appHost.internalState.runtime.canvasRightDockToolbar.items = [];
//       }),
//       alignCanvasFloatingToolbar: vi.fn(() => true),
//       getKeyboardShortcutFor: vi.fn((key: string) => shortcuts[key] ?? ""),
//       isShortcutFor: vi.fn((key: string, code: string | null, eventKey?: string | null) => {
//         const shortcut = (shortcuts[key] ?? "").trim().toLowerCase();
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
//   } as unknown as AppHost;
//
//   return {
//     context: {
//       workspace: {
//         editor,
//         registry: createRegistryContract(),
//       } as unknown as WorkspaceContract,
//       appHost,
//       keyboard: emptyKeyboardSnapshot(),
//     },
//     editor,
//     appHost,
//     preview,
//     previewRectRef,
//   };
// }
function createContext(options: {
  activeTool?: "select" | "move" | "marquee" | "single-placement";
  placementAnchor?: GridPoint | null;
  previewRotation?: 0 | 90 | 180 | 270;
  singlePlacementContinuous?: boolean;
  singlePlacementDeviceId?: string | null;
  singlePlacementPointerMode?: "mouse" | "touch" | null;
  selectingPlacementGroup?: "beltLogistics" | "pipeLogistics" | "resourcePower" | "warehouse" | "basicProduction" | "advancedManufacturing" | null;
  initialPreview?: boolean;
  previewRect?: GridRect;
  deviceClass?: "desktop" | "tablet" | "mobile";
  leftDockOpen?: boolean;
  applyPlacementDraftResult?: boolean;
  previewDefinitionId?: string;
} = {}) {
  const edgeSnapped = options.previewDefinitionId === "water_purifier_node_1";
  const buildingSnapped = options.previewDefinitionId === "loader_1";
  const test = createCanvasTestSession({ activeTool: options.activeTool,
    document: buildingSnapped ? createWorldDocumentFromBlueprint(loadBlueprintFromFile(
      "src/tests/fixtures/blueprints/collections/editor/editor-host/scene-12-variant-1.schema7.json")) : undefined,
    viewport: { center: { x: 50, y: 40 }, gridSize: 1 / 16, displayRotation: 0 },
    space: edgeSnapped ? { areas: [{ id: "test-space", bounds: { minX: null, maxX: null, minY: 0, maxY: null },
      outerRing: { top: 10, right: 0, bottom: 0, left: 0 } }] } : undefined,
    policy: { getOperationAvailability: () => ({ supported: true, enabled: true, reason: null }),
      resolvePlacementAreaIds: (_entity, space) => space.areas.map(area => area.id),
      validateTransition: () => options.applyPlacementDraftResult === false ? ["test-policy-rejected"] : [] },
  });
  cleanups.push(test.dispose);
  test.view.actions.setViewportClientRect({ left: 0, top: 0, width: 100, height: 80 });
  test.app.internalState.screenProfile = { ...test.app.state.screenProfile, deviceClass: options.deviceClass ?? "desktop" };
  test.app.internalState.workbench.leftDockOpen = options.leftDockOpen ?? true;
  Object.assign(test.canvas.state.runtime, {
    placementAnchor: options.placementAnchor ?? null, singlePlacementContinuous: options.singlePlacementContinuous ?? false,
    singlePlacementDeviceId: options.singlePlacementDeviceId ?? null,
    singlePlacementPointerMode: options.singlePlacementPointerMode ?? null, selectingPlacementGroup: options.selectingPlacementGroup ?? null,
  });
  if (options.initialPreview) {
    const definitionId = options.previewDefinitionId ?? options.singlePlacementDeviceId ?? "log_splitter";
    const definition = test.workspace.registry.queries.findEntityDefinition(definitionId)!;
    const center = buildingSnapped ? { x: 4, y: 1 } : options.previewRect === undefined ? options.placementAnchor ?? { x: 0, y: 0 } : {
      x: options.previewRect.x + Math.floor((definition.footprint.width - 1) / 2),
      y: options.previewRect.y + Math.floor((definition.footprint.height - 1) / 2),
    };
    test.editor.actions.createSinglePlacementDraft({ definitionId, centerGridPoint: center, entityId: "preview-entity" });
    for (let angle = 0; angle < (options.previewRotation ?? 0); angle += 90) test.editor.actions.rotateCollectionAroundPivotCell(EntityCollectionType.preview, 90);
  }
  for (const action of ["createSinglePlacementDraft", "cancelPlacementDraft", "applyPlacementDraft", "moveCollectionTo",
    "moveCollectionCenterPointTo", "rotateCollection", "rotateCollectionAroundCenterPoint", "rotateCollectionAroundPivotCell",
    "rotateCollectionToSnapOnBuilding", "replaceEntityDefinition"] as const) vi.spyOn(test.editor.actions, action);
  for (const action of ["setActiveTool", "showCanvasFloatingToolbarForCollection", "hideCanvasFloatingToolbar",
    "showCanvasTopLeftCornerToolbar", "hideCanvasTopLeftCornerToolbar", "showCanvasRightDockToolbar",
    "hideCanvasRightDockToolbar", "alignCanvasFloatingToolbar"] as const) vi.spyOn(test.canvas.actions, action);
  vi.spyOn(test.app.internalActions, "setLeftDockSuppressed");
  vi.spyOn(test.app.internalActions, "isShortcutFor");
  return { context: test.context, editor: test.editor, appHost: test.app,
    preview: test.editor.state.collections.preview };
}


const PLACEMENT_TOOLBAR_BUTTON_IDS_FOR_TEST = [
  "canvas-floating-toolbar-button-cancel",
  "canvas-floating-toolbar-button-rotate",
  "canvas-floating-toolbar-button-ok",
] as const;

const CONTINUOUS_PLACEMENT_BUTTON_ID_FOR_TEST =
  "canvas-top-left-corner-toolbar-button-toggle-continuous-placement";

const PLACEMENT_RIGHT_DOCK_TOOLBAR_ITEMS_FOR_TEST = [
  { operationId: "pan-viewport", presentation: "shortcut" },
  { operationId: "zoom-viewport", presentation: "shortcut" },
  { operationId: "rotate-placement", presentation: "shortcut" },
  { operationId: "confirm-placement", presentation: "shortcut" },
  { operationId: "continuous-placement", presentation: "shortcut" },
] as const satisfies readonly CanvasRightDockToolbarItemRequest[];

const PLACEMENT_RIGHT_DOCK_TOOLBAR_ITEMS_WITH_VARIANT_FOR_TEST = [
  { operationId: "pan-viewport", presentation: "shortcut" },
  { operationId: "zoom-viewport", presentation: "shortcut" },
  { operationId: "switch-device-variant", presentation: "shortcut" },
  { operationId: "rotate-placement", presentation: "shortcut" },
  { operationId: "confirm-placement", presentation: "shortcut" },
  { operationId: "continuous-placement", presentation: "shortcut" },
] as const satisfies readonly CanvasRightDockToolbarItemRequest[];

// AI-REMOVED 2026-11-12:
// Reason: 旧假 App/Editor/集合/视口不再对应有效运行时接口。
// Trigger: REQ-048 Canvas/SceneSession 迁移。
// Evidence: module 通过真实 view 投影、会话策略和动作读取业务事实。
// Replacement: createCanvasTestSession 与真实放置/吸附/拒绝策略；原行为目标保留。
// Risk: 真正屏幕与触控仍需浏览器验证。
// Human Review: Required
// Original code:
// type MockCollection = string[] & {
//   contains(entityId: string): boolean;
//   replace(entityIds: readonly string[]): void;
// };


// AI-REMOVED 2026-11-12:
// Reason: 旧假 App/Editor/集合/视口不再对应有效运行时接口。
// Trigger: REQ-048 Canvas/SceneSession 迁移。
// Evidence: module 通过真实 view 投影、会话策略和动作读取业务事实。
// Replacement: createCanvasTestSession 与真实放置/吸附/拒绝策略；原行为目标保留。
// Risk: 真正屏幕与触控仍需浏览器验证。
// Human Review: Required
// Original code:
// type MockEditor = {
//   document: Pick<EditorContract["document"], "getSnapshot">;
//   state: Pick<EditorContract["state"], "collections" | "viewport">;
//   actions: Pick<
//     EditorContract["actions"],
//     | "applyPlacementDraft"
//     | "cancelPlacementDraft"
//     | "createSinglePlacementDraft"
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
//     | "getEntityById"
//     | "findClientRectForGridCell"
//     | "findEntityAtClientPixelPoint"
//     | "findEntityCollectionGridRect"
//     | "findGridCellForClientPixelPoint"
//   >;
// };


// AI-REMOVED 2026-11-12:
// Reason: 旧假 App/Editor/集合/视口不再对应有效运行时接口。
// Trigger: REQ-048 Canvas/SceneSession 迁移。
// Evidence: module 通过真实 view 投影、会话策略和动作读取业务事实。
// Replacement: createCanvasTestSession 与真实放置/吸附/拒绝策略；原行为目标保留。
// Risk: 真正屏幕与触控仍需浏览器验证。
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


// AI-REMOVED 2026-11-12:
// Reason: 旧假 App/Editor/集合/视口不再对应有效运行时接口。
// Trigger: REQ-048 Canvas/SceneSession 迁移。
// Evidence: module 通过真实 view 投影、会话策略和动作读取业务事实。
// Replacement: createCanvasTestSession 与真实放置/吸附/拒绝策略；原行为目标保留。
// Risk: 真正屏幕与触控仍需浏览器验证。
// Human Review: Required
// Original code:
// function entity(
//   id: string,
//   position: GridPoint,
//   rotation: 0 | 90 | 180 | 270,
//   definitionId = "device-a",
// ): WorldEntity {
//   return {
//     id,
//     definitionId,
//     position,
//     rotation,
//     config: {},
//     tags: [],
//   };
// }


function placementMouseTapEvent(deviceId: string) {
  return {
    type: "ui-button-mouse-tap" as const,
    gestureId: "placement-mouse-tap-1",
    uiButtonId: `ui-left-dock-placement-mode-${deviceId}-mouse-tap`,
    button: 0,
    modifiers: emptyModifiers(),
    sourceEvent: null,
  };
}

function placementTouchTapEvent(deviceId: string) {
  return {
    type: "ui-button-touch-tap" as const,
    gestureId: "placement-touch-tap-1",
    uiButtonId: `ui-left-dock-placement-mode-${deviceId}-touch-tap`,
    modifiers: emptyModifiers(),
    sourceEvent: null,
  };
}

function touchDragStartEvent(options: {
  position: GridPoint;
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
    pointerEntity: null,
    modifiers: emptyModifiers(),
    sourceEvent: null,
  };
}

function touchDragMoveEvent(options: { position: GridPoint }) {
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

function mouseMoveEvent(options: { position: { x: number; y: number } }) {
  return {
    type: "mouse move" as const,
    gestureId: "mouse-move-1",
    buttons: 0,
    position: options.position,
    delta: { x: 0, y: 0 },
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

function onEnterActiveToolEvent(
  from: "select" | "move" | "marquee" | "single-placement" | "logistics-placement",
  to: "select" | "move" | "marquee" | "single-placement" | "logistics-placement",
) {
  return {
    type: "on-enter-active-tool" as const,
    gestureId: "enter-active-tool-1",
    from,
    to,
    modifiers: emptyModifiers(),
    sourceEvent: null,
  };
}

// AI-REMOVED 2026-11-12:
// Reason: 旧假 App/Editor/集合/视口不再对应有效运行时接口。
// Trigger: REQ-048 Canvas/SceneSession 迁移。
// Evidence: module 通过真实 view 投影、会话策略和动作读取业务事实。
// Replacement: createCanvasTestSession 与真实放置/吸附/拒绝策略；原行为目标保留。
// Risk: 真正屏幕与触控仍需浏览器验证。
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

// AI-REMOVED 2026-11-12:
// Reason: 旧假 App/Editor/集合/视口不再对应有效运行时接口。
// Trigger: REQ-048 Canvas/SceneSession 迁移。
// Evidence: module 通过真实 view 投影、会话策略和动作读取业务事实。
// Replacement: createCanvasTestSession 与真实放置/吸附/拒绝策略；原行为目标保留。
// Risk: 真正屏幕与触控仍需浏览器验证。
// Human Review: Required
// Original code:
// function rotateClockwise(rotation: 0 | 90 | 180 | 270): 0 | 90 | 180 | 270 {
//   switch (rotation) {
//     case 0:
//       return 90;
//     case 90:
//       return 180;
//     case 180:
//       return 270;
//     case 270:
//       return 0;
//   }
// }
