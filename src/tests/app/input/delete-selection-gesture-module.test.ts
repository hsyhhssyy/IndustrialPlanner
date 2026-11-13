import { createWorldDocumentFromBlueprint } from "@/tests/simulation/blueprint-test-helpers";
import { createCanvasTestSession } from "@/tests/helpers/canvas-test-session";
import { loadBlueprintFromFile } from "@/tests/simulation/blueprint-test-helpers";
// AI-REMOVED 2026-11-12:
// Reason: 空文档工厂不会导入蓝图实体。
// Trigger: REQ-048 测试装配迁移；Evidence: createWorldDocument 只接受 baseId。
// Replacement: createWorldDocumentFromBlueprint
// Risk: Low；Human Review: Required
// Original code:
// import { createWorldDocument } from "@/domain/document/world-document";
const cleanups: Array<() => void> = [];
afterEach(() => { for (const dispose of cleanups.splice(0).reverse()) dispose(); vi.restoreAllMocks(); });
import { afterEach, describe, expect, it, vi } from "vitest";

// AI-REMOVED 2026-11-12:
// Reason: 旧业务桩不再符合独立 Canvas/View 契约。
// Trigger: REQ-048 接口迁移。
// Evidence: 手势模块现在读取 context.canvas，Renderer 读取 SceneViewInput。
// Replacement: 真实 fixture 类型推导
// Risk: 保留原行为断言；原生交互另由浏览器验证。
// Human Review: Required
// Original code:
// import { SHORTCUT_KEY } from "@/app/actions/keyboard-shortcut-manager";

// AI-REMOVED 2026-11-12:
// Reason: 旧业务桩不再符合独立 Canvas/View 契约。
// Trigger: REQ-048 接口迁移。
// Evidence: 手势模块现在读取 context.canvas，Renderer 读取 SceneViewInput。
// Replacement: 真实 fixture 类型推导
// Risk: 保留原行为断言；原生交互另由浏览器验证。
// Human Review: Required
// Original code:
// import type { AppHost } from "@/app/host/app-host";

// AI-REMOVED 2026-11-12:
// Reason: 旧业务桩不再符合独立 Canvas/View 契约。
// Trigger: REQ-048 接口迁移。
// Evidence: 手势模块现在读取 context.canvas，Renderer 读取 SceneViewInput。
// Replacement: 真实 fixture 类型推导
// Risk: 保留原行为断言；原生交互另由浏览器验证。
// Human Review: Required
// Original code:
// import type { KeyboardSnapshot } from "@/app/input/gesture/adapter";

// AI-REMOVED 2026-11-12:
// Reason: 旧业务桩不再符合独立 Canvas/View 契约。
// Trigger: REQ-048 接口迁移。
// Evidence: 手势模块现在读取 context.canvas，Renderer 读取 SceneViewInput。
// Replacement: 真实 fixture 类型推导
// Risk: 保留原行为断言；原生交互另由浏览器验证。
// Human Review: Required
// Original code:
// import {
//   createHypergryphDeleteSelectionGestureModule,
//   type GestureActionContext,
// } from "@/app/input/gesture/actions";
import { createHypergryphDeleteSelectionGestureModule } from "@/app/input/gesture/actions";
// AI-REMOVED 2026-11-12:
// Reason: 旧业务桩不再符合独立 Canvas/View 契约。
// Trigger: REQ-048 接口迁移。
// Evidence: 手势模块现在读取 context.canvas，Renderer 读取 SceneViewInput。
// Replacement: 真实 fixture 类型推导
// Risk: 保留原行为断言；原生交互另由浏览器验证。
// Human Review: Required
// Original code:
// import type { WorkspaceContract } from "@/domain/document/workspace-contract";

import type { ActiveTool } from "@/domain/app/types/app-types";
// AI-REMOVED 2026-11-12:
// Reason: 旧业务桩不再符合独立 Canvas/View 契约。
// Trigger: REQ-048 接口迁移。
// Evidence: 手势模块现在读取 context.canvas，Renderer 读取 SceneViewInput。
// Replacement: 真实 fixture 类型推导
// Risk: 保留原行为断言；原生交互另由浏览器验证。
// Human Review: Required
// Original code:
// import type { EntityCollection } from "@/domain/editor/types/editor-types";

import { EntityCollectionType } from "@/domain/editor/types/editor-types";
import { handleKeyboardShortcutThroughRouter } from "./shortcut-route-test-helper";

describe("createHypergryphDeleteSelectionGestureModule", () => {
  it("deletes the current selection from the delete-device shortcut and hides selection toolbars", () => {
    const {
      context,
      deleteCollection,
      hideCanvasFloatingToolbar,
      hideCanvasRightDockToolbar,
      isShortcutFor,
    } = createContext();
    const module = createHypergryphDeleteSelectionGestureModule();

    const result = handleKeyboardShortcutThroughRouter({
      module,
      context,
      event: keyDownEvent({ code: "KeyF", key: "f" }),
    });

    expect(result).toEqual({ status: "handled" });
    // AI-CORRECTION 2026-08-30: 快捷键匹配已由 GestureActionRouter 完成，模块不再调用 isShortcutFor。
    expect(isShortcutFor).not.toHaveBeenCalled();
    expect(deleteCollection).toHaveBeenCalledWith(EntityCollectionType.selection);
    expect(hideCanvasFloatingToolbar).toHaveBeenCalledTimes(1);
    expect(hideCanvasRightDockToolbar).toHaveBeenCalledTimes(1);
  });

  it("deletes the current selection from the floating delete button", () => {
    const {
      context,
      deleteCollection,
    } = createContext();
    const module = createHypergryphDeleteSelectionGestureModule();

    const result = module.handle(
      uiButtonTouchTapEvent("canvas-floating-toolbar-button-delete"),
      context,
    );

    expect(result).toEqual({ status: "handled" });
    expect(deleteCollection).toHaveBeenCalledWith(EntityCollectionType.selection);
  });

  it("deletes the current selection from the right dock delete button", () => {
    const {
      context,
      deleteCollection,
    } = createContext();
    const module = createHypergryphDeleteSelectionGestureModule();

    const result = module.handle(
      uiButtonMouseTapEvent("canvas-right-dock-toolbar-button-delete"),
      context,
    );

    expect(result).toEqual({ status: "handled" });
    expect(deleteCollection).toHaveBeenCalledWith(EntityCollectionType.selection);
  });

  it("deletes the current selection from the marquee right dock delete button without hiding marquee controls", () => {
    const {
      context,
      deleteCollection,
      hideCanvasFloatingToolbar,
      hideCanvasRightDockToolbar,
      showCanvasRightDockToolbar,
    } = createContext({ activeTool: "marquee" });
    const module = createHypergryphDeleteSelectionGestureModule();

    const result = module.handle(
      uiButtonTouchTapEvent("canvas-right-dock-toolbar-button-delete"),
      context,
    );

    expect(result).toEqual({ status: "handled" });
    expect(deleteCollection).toHaveBeenCalledWith(EntityCollectionType.selection);
    expect(hideCanvasFloatingToolbar).not.toHaveBeenCalled();
    expect(hideCanvasRightDockToolbar).not.toHaveBeenCalled();
    expect(showCanvasRightDockToolbar).toHaveBeenCalledWith(
      [
        { operationId: "toggle-marquee-selection", presentation: "button" },
        { operationId: "marquee-select", presentation: "button" },
        { operationId: "marquee-deselect", presentation: "button" },
        { operationId: "exit-marquee", presentation: "button" },
      ],
    );
  });

  it("handles batch delete from the floating toolbar via removeTransportComponent", () => {
    const {
      context,
      removeTransportComponent,
      hideCanvasFloatingToolbar,
      hideCanvasRightDockToolbar,
    } = createContext();
    const module = createHypergryphDeleteSelectionGestureModule();

    const result = module.handle(
      uiButtonTouchTapEvent("canvas-floating-toolbar-button-delete-many"),
      context,
    );

    expect(result).toEqual({ status: "handled" });
    expect(removeTransportComponent).toHaveBeenCalledTimes(1);
    expect(removeTransportComponent).toHaveBeenCalledWith("entity-1");
    expect(hideCanvasFloatingToolbar).toHaveBeenCalledTimes(1);
    expect(hideCanvasRightDockToolbar).toHaveBeenCalledTimes(1);
  });

  it("handles batch delete from the floating toolbar for multiple selections", () => {
    const {
      context,
      removeTransportComponent,
    } = createContext({ selectedEntityIds: ["entity-a", "entity-b", "entity-c"] });
    const module = createHypergryphDeleteSelectionGestureModule();

    const result = module.handle(
      uiButtonTouchTapEvent("canvas-floating-toolbar-button-delete-many"),
      context,
    );

    expect(result).toEqual({ status: "handled" });
    expect(removeTransportComponent).toHaveBeenCalledTimes(3);
    expect(removeTransportComponent).toHaveBeenCalledWith("entity-a");
    expect(removeTransportComponent).toHaveBeenCalledWith("entity-b");
    expect(removeTransportComponent).toHaveBeenCalledWith("entity-c");
  });

  it("ignores batch delete when selection is empty", () => {
    const {
      context,
      removeTransportComponent,
    } = createContext({ selectedEntityIds: [] });
    const module = createHypergryphDeleteSelectionGestureModule();

    const result = module.handle(
      uiButtonTouchTapEvent("canvas-floating-toolbar-button-delete-many"),
      context,
    );

    expect(result).toEqual({ status: "ignored" });
    expect(removeTransportComponent).not.toHaveBeenCalled();
  });

  it("only responds while select or marquee mode and selection exists", () => {
    const module = createHypergryphDeleteSelectionGestureModule();
    // AI-REMOVED 2026-09-10:
    // Reason: 操作模式总开关已废弃，不再保留关闭分支
    // Trigger: 用户要求彻底移除 hypergryphOperationMode。
    // Evidence: 总开关入口已隐藏；手势路由器无 when 时默认启用。
    // Replacement: 本测试保留的工具与选择条件
    // Risk: 历史 false 设置统一使用当前操作行为。
    // Human Review: Required
    //
    // Original code:
    // const disabledContext = createContext({ hypergryphOperationMode: false }).context;
    const moveContext = createContext({ activeTool: "move" }).context;
    const emptySelectionContext = createContext({ selectedEntityIds: [] }).context;

    // AI-REMOVED 2026-09-10:
    // Reason: 操作模式总开关已废弃，不再保留关闭分支
    // Trigger: 用户要求彻底移除 hypergryphOperationMode。
    // Evidence: 总开关入口已隐藏；手势路由器无 when 时默认启用。
    // Replacement: 本测试保留的工具与选择条件
    // Risk: 历史 false 设置统一使用当前操作行为。
    // Human Review: Required
    //
    // Original code:
    // expect(module.when?.(disabledContext)).toBe(false);
    expect(handleKeyboardShortcutThroughRouter({
      module,
      context: moveContext,
      event: keyDownEvent({ code: "KeyF", key: "f" }),
    })).toEqual({ status: "ignored" });
    expect(
      handleKeyboardShortcutThroughRouter({
        module,
        context: emptySelectionContext,
        event: keyDownEvent({ code: "KeyF", key: "f" }),
      }),
    ).toEqual({ status: "ignored" });
  });
});

// AI-REMOVED 2026-11-12:
// Reason: 旧业务桩不再符合独立 Canvas/View 契约。
// Trigger: REQ-048 接口迁移。
// Evidence: 手势模块现在读取 context.canvas，Renderer 读取 SceneViewInput。
// Replacement: createContext / 真实会话装配
// Risk: 保留原行为断言；原生交互另由浏览器验证。
// Human Review: Required
// Original code:
// function createContext(options: {
//   activeTool?: ActiveTool;
//   // AI-REMOVED 2026-09-10:
//   // Reason: 操作模式总开关已废弃，不再保留关闭分支
//   // Trigger: 用户要求彻底移除 hypergryphOperationMode。
//   // Evidence: 总开关入口已隐藏；手势路由器无 when 时默认启用。
//   // Replacement: 测试状态不再需要模式字段
//   // Risk: 历史 false 设置统一使用当前操作行为。
//   // Human Review: Required
//   //
//   // Original code:
//   // hypergryphOperationMode?: boolean;
//   selectedEntityIds?: readonly string[];
// } = {}): {
//   context: GestureActionContext<AppHost>;
//   deleteCollection: ReturnType<typeof vi.fn>;
//   removeTransportComponent: ReturnType<typeof vi.fn>;
//   hideCanvasFloatingToolbar: ReturnType<typeof vi.fn>;
//   hideCanvasRightDockToolbar: ReturnType<typeof vi.fn>;
//   showCanvasRightDockToolbar: ReturnType<typeof vi.fn>;
//   isShortcutFor: ReturnType<typeof vi.fn>;
// } {
//   const removeTransportComponent = vi.fn();
//   const hideCanvasFloatingToolbar = vi.fn();
//   const hideCanvasRightDockToolbar = vi.fn();
//   const showCanvasRightDockToolbar = vi.fn();
//   const isShortcutFor = vi.fn((shortcutKeyId: string, code: string | null, key: string | null) => (
//     shortcutKeyId === SHORTCUT_KEY.DELETE_DEVICE
//     && code === "KeyF"
//     && key === "f"
//   ));
//   const selection = createSelectionCollection(options.selectedEntityIds ?? ["entity-1"]);
//   const mutableSelection = selection as unknown as string[];
//   const deleteCollection = vi.fn((collectionType) => {
//     if (collectionType === EntityCollectionType.selection) {
//       mutableSelection.splice(0, mutableSelection.length);
//     }
//   });
//
//   return {
//     context: {
//       workspace: {
//         editor: {
//           state: {
//             collections: {
//               selection,
//             },
//           },
//           actions: {
//             deleteCollection,
//             removeTransportComponent,
//           },
//         },
//       } as unknown as WorkspaceContract,
//       appHost: {
//         state: {
//           settings: {
//             // AI-REMOVED 2026-09-10:
//             // Reason: 操作模式总开关已废弃，不再保留关闭分支
//             // Trigger: 用户要求彻底移除 hypergryphOperationMode。
//             // Evidence: 总开关入口已隐藏；手势路由器无 when 时默认启用。
//             // Replacement: 测试状态不再需要模式字段
//             // Risk: 历史 false 设置统一使用当前操作行为。
//             // Human Review: Required
//             //
//             // Original code:
//             // hypergryphOperationMode: options.hypergryphOperationMode ?? true,
//           },
//         },
//         internalState: {
//           activeTool: options.activeTool ?? "select",
//           runtime: {
//             canvasRightDockToolbar: {
//               items: [{ operationId: "exit-marquee", presentation: "button" }],
//             },
//           },
//         },
//         internalActions: {
//           isShortcutFor,
//           hideCanvasFloatingToolbar,
//           hideCanvasRightDockToolbar,
//           showCanvasRightDockToolbar,
//         },
//       } as unknown as AppHost,
//       keyboard: emptyKeyboardSnapshot(),
//     },
//     deleteCollection,
//     removeTransportComponent,
//     hideCanvasFloatingToolbar,
//     hideCanvasRightDockToolbar,
//     showCanvasRightDockToolbar,
//     isShortcutFor,
//   };
// }
function createContext(options: { activeTool?: ActiveTool; selectedEntityIds?: readonly string[] } = {}) {
  const blueprint = loadBlueprintFromFile("src/tests/fixtures/blueprints/collections/req048/selection-belt.schema7.json");
  const test = createCanvasTestSession({ document: createWorldDocumentFromBlueprint(blueprint), activeTool: options.activeTool }); cleanups.push(test.dispose);
  for (const entityId of options.selectedEntityIds ?? ["entity-1"]) test.editor.actions.addToCollection({ collectionType: EntityCollectionType.selection, entityId });
  test.canvas.state.runtime.canvasRightDockToolbar.items = [{ operationId: "exit-marquee", presentation: "button" }];
  return { context: test.context,
    deleteCollection: vi.spyOn(test.editor.actions, "deleteCollection"), removeTransportComponent: vi.spyOn(test.editor.actions, "removeTransportComponent"),
    hideCanvasFloatingToolbar: vi.spyOn(test.canvas.actions, "hideCanvasFloatingToolbar"), hideCanvasRightDockToolbar: vi.spyOn(test.canvas.actions, "hideCanvasRightDockToolbar"),
    showCanvasRightDockToolbar: vi.spyOn(test.canvas.actions, "showCanvasRightDockToolbar"), isShortcutFor: vi.spyOn(test.app.internalActions, "isShortcutFor") };
}

// AI-REMOVED 2026-08-22:
// Reason: 删除选区测试桩改为保存逐项展示请求，不再提供工具列级 icon mode。
// Trigger: showMarqueeRightDockToolbar 从退出功能请求继承 presentation。
// Evidence: marquee 删除后仍以 button presentation 呼起退出功能。
// Replacement: canvasRightDockToolbar.items 与新的调用断言。
// Risk: Low
// Human Review: Required
//
// Original code:
// canvasRightDockToolbar: {
//   mode: "icon",
// },
// expect(showCanvasRightDockToolbar).toHaveBeenCalledWith(
//   ["canvas-right-dock-toolbar-button-exit"],
//   "icon",
// );

// AI-REMOVED 2026-11-12:
// Reason: 旧业务桩不再符合独立 Canvas/View 契约。
// Trigger: REQ-048 接口迁移。
// Evidence: 手势模块现在读取 context.canvas，Renderer 读取 SceneViewInput。
// Replacement: createSelectionCollection / 真实会话装配
// Risk: 保留原行为断言；原生交互另由浏览器验证。
// Human Review: Required
// Original code:
// function createSelectionCollection(entityIds: readonly string[]): EntityCollection {
//   const selection = [...entityIds] as string[] & EntityCollection;
//
//   selection.contains = (entityId: string) => selection.includes(entityId);
//
//   return selection;
// }


function keyDownEvent(options: {
  code: string;
  key: string;
}) {
  return {
    type: "key down" as const,
    gestureId: "key-delete-selection-1",
    code: options.code,
    key: options.key,
    keyCode: 0,
    modifiers: emptyModifiers(),
    sourceEvent: null,
  };
}

function uiButtonTouchTapEvent(uiButtonId: string) {
  return {
    type: "ui-button-touch-tap" as const,
    gestureId: `ui-button-touch-${uiButtonId}`,
    uiButtonId,
    modifiers: emptyModifiers(),
    sourceEvent: null,
  };
}

function uiButtonMouseTapEvent(uiButtonId: string) {
  return {
    type: "ui-button-mouse-tap" as const,
    gestureId: `ui-button-mouse-${uiButtonId}`,
    uiButtonId,
    button: 0,
    modifiers: emptyModifiers(),
    sourceEvent: null,
  };
}

// AI-REMOVED 2026-11-12:
// Reason: 旧业务桩不再符合独立 Canvas/View 契约。
// Trigger: REQ-048 接口迁移。
// Evidence: 手势模块现在读取 context.canvas，Renderer 读取 SceneViewInput。
// Replacement: emptyKeyboardSnapshot / 真实会话装配
// Risk: 保留原行为断言；原生交互另由浏览器验证。
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
