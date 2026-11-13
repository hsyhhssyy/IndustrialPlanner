import { createCanvasTestSession } from "@/tests/helpers/canvas-test-session";
const cleanups: Array<() => void> = [];
afterEach(() => { for (const dispose of cleanups.splice(0).reverse()) dispose(); vi.restoreAllMocks(); });
import { afterEach, describe, expect, it, vi } from "vitest";

// AI-REMOVED 2026-11-12:
// Reason: 旧测试装配依赖退出的 App/Editor 相机和交互字段。
// Trigger: REQ-048 独立 View 与 Canvas 契约迁移。
// Evidence: 真实模块现在从 Canvas 读取会话、相机和工具状态。
// Replacement: 真实 Canvas fixture 类型推导
// Risk: 真实布局与原生交互另由浏览器验证。
// Human Review: Required
// Original code:
// import { SHORTCUT_KEY } from "@/app/actions/keyboard-shortcut-manager";

// AI-REMOVED 2026-11-12:
// Reason: 旧测试装配依赖退出的 App/Editor 相机和交互字段。
// Trigger: REQ-048 独立 View 与 Canvas 契约迁移。
// Evidence: 真实模块现在从 Canvas 读取会话、相机和工具状态。
// Replacement: 真实 Canvas fixture 类型推导
// Risk: 真实布局与原生交互另由浏览器验证。
// Human Review: Required
// Original code:
// import type { AppHost } from "@/app/host/app-host";

// AI-REMOVED 2026-11-12:
// Reason: 旧测试装配依赖退出的 App/Editor 相机和交互字段。
// Trigger: REQ-048 独立 View 与 Canvas 契约迁移。
// Evidence: 真实模块现在从 Canvas 读取会话、相机和工具状态。
// Replacement: 真实 Canvas fixture 类型推导
// Risk: 真实布局与原生交互另由浏览器验证。
// Human Review: Required
// Original code:
// import type { KeyboardSnapshot } from "@/app/input/gesture/adapter";

import {
  createPanelToggleGestureModule,
  // AI-REMOVED 2026-11-12: 原类型由真实 fixture 推导；Human Review: Required
  // type GestureActionContext,
} from "@/app/input/gesture/actions";
// AI-REMOVED 2026-11-12:
// Reason: 旧测试装配依赖退出的 App/Editor 相机和交互字段。
// Trigger: REQ-048 独立 View 与 Canvas 契约迁移。
// Evidence: 真实模块现在从 Canvas 读取会话、相机和工具状态。
// Replacement: 真实 Canvas fixture 类型推导
// Risk: 真实布局与原生交互另由浏览器验证。
// Human Review: Required
// Original code:
// import type { WorkspaceContract } from "@/domain/document/workspace-contract";

import { handleKeyboardShortcutThroughRouter } from "./shortcut-route-test-helper";

// AI-REMOVED 2026-11-12:
// Reason: 旧测试装配依赖退出的 App/Editor 相机和交互字段。
// Trigger: REQ-048 独立 View 与 Canvas 契约迁移。
// Evidence: 真实模块现在从 Canvas 读取会话、相机和工具状态。
// Replacement: 真实工作台快捷键默认值
// Risk: 真实布局与原生交互另由浏览器验证。
// Human Review: Required
// Original code:
// const SHORTCUT_DEFAULTS: Record<string, string> = {
//   [SHORTCUT_KEY.TOGGLE_PLACEMENT_PANEL]: "P",
//   [SHORTCUT_KEY.TOGGLE_BLUEPRINT_PANEL]: "L",
//   [SHORTCUT_KEY.TOGGLE_HISTORY_PANEL]: "H",
//   [SHORTCUT_KEY.TOGGLE_BASE_PANEL]: "K",
// };


describe("createPanelToggleGestureModule", () => {
  it("opens and switches to the target panel when left dock is closed", () => {
    const { context, internalActions } = createContext({
      leftDockOpen: false,
      activePanel: "history",
    });
    const module = createPanelToggleGestureModule();

    const result = handleKeyboardShortcutThroughRouter({
      module,
      context,
      event: keyDownEvent({ code: "KeyL", key: "l" }),
    });

    expect(result).toEqual({ status: "handled", consume: true });
    expect(internalActions.setActivePanel).toHaveBeenCalledWith("blueprint");
    expect(internalActions.toggleLeftDock).not.toHaveBeenCalled();
  });

  it("switches panel without collapsing when left dock is open and target differs", () => {
    const { context, internalActions } = createContext({
      leftDockOpen: true,
      activePanel: "history",
    });
    const module = createPanelToggleGestureModule();

    const result = handleKeyboardShortcutThroughRouter({
      module,
      context,
      event: keyDownEvent({ code: "KeyK", key: "k" }),
    });

    expect(result).toEqual({ status: "handled", consume: true });
    expect(internalActions.setActivePanel).toHaveBeenCalledWith("base");
    expect(internalActions.toggleLeftDock).not.toHaveBeenCalled();
  });

  it("collapses left dock when target panel is already active", () => {
    const { context, internalActions } = createContext({
      leftDockOpen: true,
      activePanel: "base",
    });
    const module = createPanelToggleGestureModule();

    const result = handleKeyboardShortcutThroughRouter({
      module,
      context,
      event: keyDownEvent({ code: "KeyK", key: "k" }),
    });

    expect(result).toEqual({ status: "handled", consume: true });
    expect(internalActions.toggleLeftDock).toHaveBeenCalledTimes(1);
    expect(internalActions.setActivePanel).not.toHaveBeenCalled();
  });

  it("treats null activePanel as placement to match toolbar behavior", () => {
    const { context, internalActions } = createContext({
      leftDockOpen: true,
      activePanel: null,
    });
    const module = createPanelToggleGestureModule();

    const result = handleKeyboardShortcutThroughRouter({
      module,
      context,
      event: keyDownEvent({ code: "KeyP", key: "p" }),
    });

    expect(result).toEqual({ status: "handled", consume: true });
    expect(internalActions.toggleLeftDock).toHaveBeenCalledTimes(1);
    expect(internalActions.setActivePanel).not.toHaveBeenCalled();
  });

  it("supports key fallback when code is unavailable", () => {
    const { context, internalActions } = createContext({
      leftDockOpen: false,
      activePanel: "placement",
    });
    const module = createPanelToggleGestureModule();

    const result = handleKeyboardShortcutThroughRouter({
      module,
      context,
      event: keyDownEvent({ code: null, key: "H" }),
    });

    expect(result).toEqual({ status: "handled", consume: true });
    expect(internalActions.setActivePanel).toHaveBeenCalledWith("history");
  });

  it("ignores non-target keys, modifier keys, and non-keydown events", () => {
    const { context, internalActions } = createContext({
      leftDockOpen: true,
      activePanel: "placement",
    });
    const module = createPanelToggleGestureModule();

    expect(handleKeyboardShortcutThroughRouter({
      module,
      context,
      event: keyDownEvent({ code: "KeyM", key: "m" }),
    })).toEqual({ status: "ignored" });
    expect(
      handleKeyboardShortcutThroughRouter({
        module,
        context,
        event: keyDownEvent({
          code: "KeyP",
          key: "p",
          modifiers: { alt: false, ctrl: true, meta: false, shift: false },
        }),
      }),
    ).toEqual({ status: "ignored" });
    expect(handleKeyboardShortcutThroughRouter({
      module,
      context,
      event: keyUpEvent({ code: "KeyP", key: "p" }),
    })).toEqual({ status: "ignored" });

    expect(internalActions.setActivePanel).not.toHaveBeenCalled();
    expect(internalActions.toggleLeftDock).not.toHaveBeenCalled();
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
//   leftDockOpen: boolean;
//   activePanel: "placement" | "blueprint" | "history" | "base" | "simulation" | null;
// }): {
//   context: GestureActionContext<AppHost>;
//   internalActions: {
//     setActivePanel: ReturnType<typeof vi.fn>;
//     toggleLeftDock: ReturnType<typeof vi.fn>;
//     isShortcutFor: ReturnType<typeof vi.fn>;
//   };
// } {
//   const internalActions = {
//     setActivePanel: vi.fn(),
//     toggleLeftDock: vi.fn(),
//     isShortcutFor: vi.fn(
//       (
//         key: string,
//         code: string | null,
//         eventKey?: string | null,
//         modifiers?: { alt?: boolean; ctrl?: boolean; meta?: boolean; shift?: boolean },
//       ) => {
//         // 有修饰键则不匹配纯字母快捷键
//         if (modifiers?.alt || modifiers?.ctrl || modifiers?.meta || modifiers?.shift) {
//           return false;
//         }
//
//         const shortcut = (SHORTCUT_DEFAULTS[key] ?? "").trim().toLowerCase();
//         if (shortcut === "") return false;
//
//         const normalizedKey = (eventKey ?? "").trim().toLowerCase();
//         if (normalizedKey !== "" && normalizedKey === shortcut) return true;
//
//         if (shortcut.length === 1 && shortcut >= "a" && shortcut <= "z") {
//           return code === `Key${shortcut.toUpperCase()}`;
//         }
//
//         return (code ?? "").trim().toLowerCase() === shortcut;
//       },
//     ),
//   };
//
//   const appHost = {
//     state: {
//       workbench: {
//         leftDockOpen: options.leftDockOpen,
//       },
//     },
//     internalState: {
//       runtime: {
//         activePanel: options.activePanel,
//       },
//     },
//     internalActions,
//   } as unknown as AppHost;
//
//   return {
//     context: {
//       workspace: {} as WorkspaceContract,
//       appHost,
//       keyboard: emptyKeyboardSnapshot(),
//     },
//     internalActions,
//   };
// }
function createContext(options: { leftDockOpen: boolean; activePanel: "placement" | "blueprint" | "history" | "base" | "simulation" | null }) {
  const test = createCanvasTestSession(); cleanups.push(test.dispose);
  test.app.internalState.workbench.leftDockOpen = options.leftDockOpen;
  test.app.internalState.runtime.activePanel = options.activePanel;
  const internalActions = { setActivePanel: vi.spyOn(test.app.internalActions, "setActivePanel"),
    toggleLeftDock: vi.spyOn(test.app.internalActions, "toggleLeftDock"), isShortcutFor: vi.spyOn(test.app.internalActions, "isShortcutFor") };
  return { context: test.context, internalActions };
}

function keyDownEvent(options: {
  code: string | null;
  key: string | null;
  modifiers?: { alt: boolean; ctrl: boolean; meta: boolean; shift: boolean };
}) {
  return {
    type: "key down" as const,
    gestureId: "key-down-1",
    code: options.code,
    key: options.key,
    keyCode: null,
    modifiers: options.modifiers ?? emptyModifiers(),
    sourceEvent: null,
  };
}

function keyUpEvent(options: { code: string | null; key: string | null }) {
  return {
    type: "key up" as const,
    gestureId: "key-up-1",
    code: options.code,
    key: options.key,
    keyCode: null,
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
