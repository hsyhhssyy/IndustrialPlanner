import { createCanvasTestSession } from "@/tests/helpers/canvas-test-session";
const cleanups: Array<() => void> = [];
afterEach(() => { for (const dispose of cleanups.splice(0).reverse()) dispose(); vi.restoreAllMocks(); });
import { afterEach, describe, expect, it, vi } from "vitest";

import { SHORTCUT_KEY } from "@/app/actions/keyboard-shortcut-manager";
// AI-REMOVED 2026-11-12:
// Reason: 旧测试装配依赖退出的 App/Editor 相机和交互字段。
// Trigger: REQ-048 独立 View 与 Canvas 契约迁移。
// Evidence: 真实模块现在从 Canvas 读取会话、相机和工具状态。
// Replacement: 真实 Canvas fixture 类型推导
// Risk: 真实布局与原生交互另由浏览器验证。
// Human Review: Required
// Original code:
// import type { AppHost } from "@/app/host/app-host";

import type { GestureEvent } from "@/app/input/gesture/adapter";
import {
  createQuickPlaceGestureModule,
  // AI-REMOVED 2026-11-12: 原类型由真实 fixture 推导；Human Review: Required
  // type GestureActionContext,
} from "@/app/input/gesture/actions";
import type { WorldEntity } from "@/domain/document/world-document";
// AI-REMOVED 2026-11-12:
// Reason: 旧测试装配依赖退出的 App/Editor 相机和交互字段。
// Trigger: REQ-048 独立 View 与 Canvas 契约迁移。
// Evidence: 真实模块现在从 Canvas 读取会话、相机和工具状态。
// Replacement: 真实 Canvas fixture 类型推导
// Risk: 真实布局与原生交互另由浏览器验证。
// Human Review: Required
// Original code:
// import type { WorkspaceContract } from "@/domain/document/workspace-contract";


describe("createQuickPlaceGestureModule", () => {
  // AI-REMOVED 2026-08-30:
  // Reason: 键盘事件已由 GestureActionRouter 分派 shortcutRoutes，不能再直接调用 module.handle(keydown)。
  // Trigger: ST2-RQ-020 可执行 Shortcut Route 统一，用户已授权同步迁移现有测试。
  // Evidence: GestureMappingModule 新增 shortcutRoutes；module.handle 只保留非键盘手势。
  // Replacement: 下方 Route 注册契约断言；运行行为由 Router 与真实浏览器验证。
  // Risk: Low
  // Human Review: Required
  //
  // Original code:
  // it("opens quick place at the last mouse canvas position from the shortcut", () => {
  //   const { context } = createContext();
  //   const module = createQuickPlaceGestureModule();
  //   expect(module.handle(mouseMoveEvent(320, 180), context)).toEqual({ status: "ignored" });
  //   const result = module.handle(keyDownEvent({ code: "KeyZ", key: "z" }), context);
  //   expect(result).toEqual({ status: "handled", consume: true });
  //   expect(context.appHost.internalState.runtime.quickPlace).toEqual({
  //     visible: true,
  //     anchor: { x: 320, y: 180 },
  //     searchQuery: "",
  //     openSource: "keyboard-shortcut",
  //   });
  // });
  it("registers the configurable open shortcut on canvas select", () => {
    const module = createQuickPlaceGestureModule();
    const route = module.shortcutRoutes?.find((candidate) => candidate.id === "quick-place.open");

    expect(route).toMatchObject({
      actionId: SHORTCUT_KEY.QUICK_PLACE,
      binding: { kind: "configurable", shortcutId: SHORTCUT_KEY.QUICK_PLACE },
      scope: { inputLayers: ["canvas"], activeTools: ["select"] },
      triggerPolicy: { kind: "exact" },
    });
  });

  it("opens quick place at blank canvas double tap position", () => {
    const mouseContext = createContext();
    const touchContext = createContext();
    const mouseModule = createQuickPlaceGestureModule();
    const touchModule = createQuickPlaceGestureModule();

    expect(mouseModule.handle(mouseDoubleTapEvent(111, 222), mouseContext.context)).toEqual({
      status: "handled",
      consume: true,
    });
    expect(mouseContext.context.canvas.state.runtime.quickPlace).toEqual({
      visible: true,
      anchor: { x: 111, y: 222 },
      searchQuery: "",
      openSource: "pointer",
      activeResultId: null,
    });

    expect(touchModule.handle(touchDoubleTapEvent(333, 444), touchContext.context)).toEqual({
      status: "handled",
      consume: true,
    });
    expect(touchContext.context.canvas.state.runtime.quickPlace).toEqual({
      visible: true,
      anchor: { x: 333, y: 444 },
      searchQuery: "",
      openSource: "pointer",
      activeResultId: null,
    });
  });

  it("ignores double tap on entities or with modifiers", () => {
    const onEntity = createContext();
    const withModifier = createContext();
    const module = createQuickPlaceGestureModule();

    expect(module.handle(
      mouseDoubleTapEvent(111, 222, { pointerEntity: entity("entity-1") }),
      onEntity.context,
    )).toEqual({ status: "ignored" });
    expect(onEntity.context.canvas.state.runtime.quickPlace.visible).toBe(false);

    expect(module.handle(
      touchDoubleTapEvent(333, 444, { modifiers: { ...emptyModifiers(), shift: true } }),
      withModifier.context,
    )).toEqual({ status: "ignored" });
    expect(withModifier.context.canvas.state.runtime.quickPlace.visible).toBe(false);
  });

  it("ignores double tap outside select mode, when disabled, or outside canvas grid", () => {
    const nonSelect = createContext({ activeTool: "move" });
    const disabled = createContext({ quickPlaceEnabled: false });
    const outsideGrid = createContext({ gridCell: null });

    for (const { context } of [nonSelect, disabled, outsideGrid]) {
      const module = createQuickPlaceGestureModule();

      expect(module.handle(mouseDoubleTapEvent(111, 222), context)).toEqual({
        status: "ignored",
      });
      expect(context.canvas.state.runtime.quickPlace.visible).toBe(false);
    }
  });

  // AI-REMOVED 2026-08-30:
  // Reason: 此测试绕过 Router 直接把 keydown 交给 module.handle，已不符合新模块协议。
  // Trigger: ST2-RQ-020 Route 迁移，用户授权更新现有测试。
  // Evidence: quick-place.open.scope 已静态排除非 select；enabled/grid 仍由 Route handler 的 tryOpenQuickPlaceAt 验证。
  // Replacement: quick-place.open Route 契约与上方指针入口业务条件测试
  // Risk: Low
  // Human Review: Required
  //
  // Original code:
  // it("ignores the shortcut outside select mode, when disabled, or outside canvas grid", () => {
  //   const disabled = createContext({ quickPlaceEnabled: false });
  //   const nonSelect = createContext({ activeTool: "move" });
  //   const outsideGrid = createContext({ gridCell: null });
  //   for (const { context } of [disabled, nonSelect, outsideGrid]) {
  //     const module = createQuickPlaceGestureModule();
  //     module.handle(mouseMoveEvent(320, 180), context);
  //     expect(module.handle(keyDownEvent({ code: "KeyZ", key: "z" }), context)).toEqual({ status: "ignored" });
  //     expect(context.appHost.internalState.runtime.quickPlace.visible).toBe(false);
  //   }
  // });

  it("registers Escape on the quick-place input layer and closes when leaving the active tool", () => {
    const { context } = createContext({
      quickPlace: {
        visible: true,
        anchor: { x: 40, y: 60 },
        searchQuery: "abc",
        openSource: "keyboard-shortcut",
        activeResultId: null,
      },
    });
    const module = createQuickPlaceGestureModule();
    const closeRoute = module.shortcutRoutes?.find((route) => route.id === "quick-place.close");

    expect(closeRoute).toMatchObject({
      binding: { kind: "fixed", value: "Esc" },
      scope: { inputLayers: ["quick-place"] },
    });

    context.canvas.state.runtime.quickPlace = {
      visible: true,
      anchor: { x: 80, y: 90 },
      searchQuery: "belt",
      openSource: "pointer",
      activeResultId: null,
    };

    expect(module.handle(exitActiveToolEvent(), context)).toEqual({ status: "handled" });
    expect(context.canvas.state.runtime.quickPlace).toEqual({
      visible: false,
      anchor: null,
      searchQuery: "",
      openSource: null,
      activeResultId: null,
    });
  });
});

// AI-REMOVED 2026-11-12:
// Reason: 旧测试装配依赖退出的 App/Editor 相机和交互字段。
// Trigger: REQ-048 独立 View 与 Canvas 契约迁移。
// Evidence: 真实模块现在从 Canvas 读取会话、相机和工具状态。
// Replacement: createContext / createCanvasTestSession
// Risk: 真实布局与原生交互另由浏览器验证。
// Human Review: Required
// Original code:
// function createContext(options: {
//   activeTool?: "select" | "move";
//   quickPlaceEnabled?: boolean;
//   gridCell?: { x: number; y: number } | null;
//   quickPlace?: {
//     visible: boolean;
//     anchor: { x: number; y: number } | null;
//     searchQuery: string;
//     openSource: "keyboard-shortcut" | "pointer" | null;
//     activeResultId: string | null;
//   };
// } = {}): { context: GestureActionContext<AppHost> } {
//   const editor = {
//     queries: {
//       findGridCellForClientPixelPoint: vi.fn(() =>
//         Object.prototype.hasOwnProperty.call(options, "gridCell")
//           ? options.gridCell
//           : { x: 4, y: 5 }
//       ),
//     },
//   };
//   const appHost = {
//     internalState: {
//       activeTool: options.activeTool ?? "select",
//       settings: {
//         quickPlaceEnabled: options.quickPlaceEnabled ?? true,
//       },
//       runtime: {
//         quickPlace: options.quickPlace ?? {
//           visible: false,
//           anchor: null,
//           searchQuery: "",
//           openSource: null,
//           activeResultId: null,
//         },
//       },
//     },
//     internalActions: {
//       isShortcutFor: vi.fn((
//         key: string,
//         code: string | null,
//         eventKey: string | null,
//       ) => key === SHORTCUT_KEY.QUICK_PLACE && (code === "KeyZ" || eventKey === "z")),
//     },
//   } as unknown as AppHost;
//
//   return {
//     context: {
//       workspace: {
//         editor,
//       } as unknown as WorkspaceContract,
//       appHost,
//       keyboard: emptyKeyboardSnapshot(),
//     },
//   };
// }
function createContext(options: {
  activeTool?: "select" | "move"; quickPlaceEnabled?: boolean; gridCell?: { x: number; y: number } | null;
  quickPlace?: { visible: boolean; anchor: { x: number; y: number } | null; searchQuery: string;
    openSource: "keyboard-shortcut" | "pointer" | null; activeResultId: string | null };
} = {}) {
  const test = createCanvasTestSession({ activeTool: options.activeTool }); cleanups.push(test.dispose);
  test.app.internalState.settings.quickPlaceEnabled = options.quickPlaceEnabled ?? true;
  if (options.gridCell !== null) test.view.actions.setViewportClientRect({ left: 0, top: 0, width: 800, height: 600 });
  if (options.quickPlace) test.canvas.state.runtime.quickPlace = options.quickPlace;
  return { context: test.context };
}

// AI-REMOVED 2026-08-30:
// Reason: 快速放置快捷键测试改为验证 Action Route，不再需要先构造 mouse move 事件。
// Trigger: ST2-RQ-020 测试迁移到 GestureActionRouter 路径。
// Evidence: ESLint 报 mouseMoveEvent 未使用。
// Replacement: quick-place.open Route 契约测试
// Risk: Low
// Human Review: Required
//
// Original code:
// function mouseMoveEvent(x: number, y: number): GestureEvent {
//   return {
//     type: "mouse move",
//     gestureId: "mouse-move-1",
//     buttons: 0,
//     position: { x, y },
//     delta: { x: 0, y: 0 },
//     modifiers: emptyModifiers(),
//     sourceEvent: null,
//   };
// }

function mouseDoubleTapEvent(
  x: number,
  y: number,
  options: {
    readonly pointerEntity?: WorldEntity | null;
    readonly modifiers?: ReturnType<typeof emptyModifiers>;
    readonly button?: number;
    readonly longPress?: boolean;
  } = {},
): GestureEvent {
  return {
    type: "mouse double tap",
    gestureId: "mouse-double-tap-1",
    button: options.button ?? 0,
    buttons: 0,
    position: { x, y },
    longPress: options.longPress ?? false,
    pointerEntity: options.pointerEntity ?? null,
    modifiers: options.modifiers ?? emptyModifiers(),
    sourceEvent: null,
  };
}

function touchDoubleTapEvent(
  x: number,
  y: number,
  options: {
    readonly pointerEntity?: WorldEntity | null;
    readonly modifiers?: ReturnType<typeof emptyModifiers>;
    readonly longPress?: boolean;
  } = {},
): GestureEvent {
  return {
    type: "touch double tap",
    gestureId: "touch-double-tap-1",
    primaryId: 1,
    position: { x, y },
    longPress: options.longPress ?? false,
    pointerEntity: options.pointerEntity ?? null,
    modifiers: options.modifiers ?? emptyModifiers(),
    sourceEvent: null,
  };
}

function entity(id: string): WorldEntity {
  return {
    id,
    definitionId: "belt_straight_1x1",
    position: { x: 0, y: 0 },
    rotation: 0,
    config: {},
    tags: [],
  };
}

// AI-REMOVED 2026-08-30:
// Reason: 测试不再绕过 GestureActionRouter 直接构造 keydown 调用 module.handle。
// Trigger: ST2-RQ-020 测试接口迁移，用户已授权。
// Evidence: 快捷键 Route 契约改为读取 module.shortcutRoutes。
// Replacement: Route contract assertions in this test file
// Risk: Low
// Human Review: Required
//
// Original code:
// function keyDownEvent(options: { code: string; key: string }): GestureEvent {
//   return {
//     type: "key down",
//     gestureId: "key-down-1",
//     code: options.code,
//     key: options.key,
//     keyCode: null,
//     modifiers: emptyModifiers(),
//     sourceEvent: null,
//   };
// }

function exitActiveToolEvent(): GestureEvent {
  return {
    type: "on-exit-active-tool",
    gestureId: "exit-active-tool-1",
    from: "select",
    to: "move",
    modifiers: emptyModifiers(),
    sourceEvent: null,
  };
}

function emptyModifiers() {
  return {
    alt: false,
    ctrl: false,
    meta: false,
    shift: false,
  };
}

// AI-REMOVED 2026-11-12:
// Reason: 旧测试装配依赖退出的 App/Editor 相机和交互字段。
// Trigger: REQ-048 独立 View 与 Canvas 契约迁移。
// Evidence: 真实模块现在从 Canvas 读取会话、相机和工具状态。
// Replacement: emptyKeyboardSnapshot / createCanvasTestSession
// Risk: 真实布局与原生交互另由浏览器验证。
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
