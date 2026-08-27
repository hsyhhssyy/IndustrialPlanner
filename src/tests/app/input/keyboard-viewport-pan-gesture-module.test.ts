import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { SHORTCUT_KEY } from "@/app/actions/keyboard-shortcut-manager";
import type { AppHost } from "@/app/host/app-host";
import type { KeyboardSnapshot } from "@/app/input/gesture/adapter";
import {
  createHypergryphKeyboardViewportPanModule,
  type GestureActionContext,
} from "@/app/input/gesture/actions";
import type { WorkspaceContract } from "@/domain/document/workspace-contract";

// ─── 可控 RAF mock ───
let rafCallbacks: Map<number, (now: number) => void>;
let rafIdCounter: number;

function setupRafMocks(): void {
  rafCallbacks = new Map();
  rafIdCounter = 0;
  vi.stubGlobal("requestAnimationFrame", (callback: (now: number) => void) => {
    rafCallbacks.set(++rafIdCounter, callback);
    return rafIdCounter;
  });
  vi.stubGlobal("cancelAnimationFrame", (id: number) => {
    rafCallbacks.delete(id);
  });
}

function advanceRafFrame(nowMs: number): void {
  const callbacks = [...rafCallbacks.values()];
  rafCallbacks.clear();
  for (const callback of callbacks) {
    callback(nowMs);
  }
}

// ─── 事件与上下文辅助 ───
function keyEvent(code: string, key: string): {
  type: "key down" | "key up";
  gestureId: string;
  code: string;
  key: string;
  keyCode: number;
  modifiers: { alt: boolean; ctrl: boolean; meta: boolean; shift: boolean };
  sourceEvent: null;
} {
  return {
    type: "key down",
    gestureId: "key-1",
    code,
    key,
    keyCode: key.toUpperCase().charCodeAt(0),
    modifiers: { alt: false, ctrl: false, meta: false, shift: false },
    sourceEvent: null,
  };
}

function keyDownEvent(code: string, key: string) {
  return { ...keyEvent(code, key), type: "key down" as const };
}

function keyUpEvent(code: string, key: string) {
  return { ...keyEvent(code, key), type: "key up" as const };
}

const PAN_SHORTCUT_CODE: Record<string, string> = {
  [SHORTCUT_KEY.PAN_VIEWPORT_UP]: "KeyW",
  [SHORTCUT_KEY.PAN_VIEWPORT_DOWN]: "KeyS",
  [SHORTCUT_KEY.PAN_VIEWPORT_LEFT]: "KeyA",
  [SHORTCUT_KEY.PAN_VIEWPORT_RIGHT]: "KeyD",
};

const PAN_SECONDARY_SHORTCUT_CODE: Record<string, string> = {
  [SHORTCUT_KEY.PAN_VIEWPORT_UP]: "ArrowUp",
  [SHORTCUT_KEY.PAN_VIEWPORT_DOWN]: "ArrowDown",
  [SHORTCUT_KEY.PAN_VIEWPORT_LEFT]: "ArrowLeft",
  [SHORTCUT_KEY.PAN_VIEWPORT_RIGHT]: "ArrowRight",
};

function createContext(options: {
  hypergryphOperationMode?: boolean;
  gridCellPixelSize?: number;
} = {}): {
  context: GestureActionContext<AppHost>;
  moveViewportByClientPixelVector: ReturnType<typeof vi.fn>;
  isShortcutFor: ReturnType<typeof vi.fn>;
} {
  const {
    hypergryphOperationMode = true,
    gridCellPixelSize = 32,
  } = options;
  const moveViewportByClientPixelVector = vi.fn();
  // AI-REMOVED 2026-08-03:
  // Reason: mock 不能再只识别 WASD 主槽位，否则无法验证方向键等效绑定。
  // Trigger: ST2-RQ-002 双槽位视口平移。
  // Evidence: 下方 mock 同时检查 PAN_SHORTCUT_CODE 与 PAN_SECONDARY_SHORTCUT_CODE。
  // Replacement: 下方 isShortcutFor mock。
  // Risk: Low
  // Human Review: Required
  //
  // Original code:
  // const isShortcutFor = vi.fn(
  //   (key: string, code: string | null) => PAN_SHORTCUT_CODE[key] === code,
  // );
  const isShortcutFor = vi.fn(
    (key: string, code: string | null) => (
      PAN_SHORTCUT_CODE[key] === code || PAN_SECONDARY_SHORTCUT_CODE[key] === code
    ),
  );

  const workspace = {
    editor: {
      state: {
        viewport: {
          gridCellPixelSize,
        },
      },
      actions: {
        moveViewportByClientPixelVector,
      },
    },
  } as unknown as WorkspaceContract;

  return {
    context: {
      workspace,
      appHost: {
        state: {
          settings: {
            hypergryphOperationMode,
          },
        },
        internalActions: {
          isShortcutFor,
        },
      } as unknown as AppHost,
      keyboard: emptyKeyboardSnapshot(),
    },
    moveViewportByClientPixelVector,
    isShortcutFor,
  };
}

function emptyKeyboardSnapshot(): KeyboardSnapshot {
  return {
    pressedKeys: new Set(),
    lastCode: null,
    lastKey: null,
    lastKeyCode: null,
    modifiers: { alt: false, ctrl: false, meta: false, shift: false },
  };
}

// ─── 测试 ───
describe("createHypergryphKeyboardViewportPanModule", () => {
  beforeEach(() => {
    setupRafMocks();
    // jsdom 中 document.hasFocus() 默认返回 false，会触发模块的失焦兜底停止逻辑；
    // 默认 stub 为 true 以模拟真实浏览器的页面聚焦状态。
    vi.spyOn(document, "hasFocus").mockReturnValue(true);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("pans the viewport upward at 1280 pixels per second while W is held", () => {
    const { context, moveViewportByClientPixelVector } = createContext();
    const module = createHypergryphKeyboardViewportPanModule();

    const downResult = module.handle(keyDownEvent("KeyW", "w"), context);
    expect(downResult).toEqual({ status: "handled" });

    // 首帧只记录基准时间
    advanceRafFrame(0);
    expect(moveViewportByClientPixelVector).not.toHaveBeenCalled();

    // 1 秒后：向上平移 10 格（每格 32px → 320px，内容向屏幕下方移动 dy 为正）
    // 订正（2026-08-25）：屏幕速度固定为 1280px/s，不再按网格像素尺寸换算。
    advanceRafFrame(1000);
    expect(moveViewportByClientPixelVector).toHaveBeenCalledTimes(1);
    expect(moveViewportByClientPixelVector).toHaveBeenCalledWith({
      startClientPixel: { x: 0, y: 0 },
      endClientPixel: { x: 0, y: 1280 },
    });
  });

  it("keeps the client pixel speed unchanged across zoom levels", () => {
    for (const gridCellPixelSize of [16, 64, 128]) {
      const { context, moveViewportByClientPixelVector } = createContext({ gridCellPixelSize });
      const module = createHypergryphKeyboardViewportPanModule();

      module.handle(keyDownEvent("KeyW", "w"), context);
      advanceRafFrame(0);
      advanceRafFrame(1000);

      expect(moveViewportByClientPixelVector).toHaveBeenCalledWith({
        startClientPixel: { x: 0, y: 0 },
        endClientPixel: { x: 0, y: 1280 },
      });

      module.handle(keyUpEvent("KeyW", "w"), context);
    }
  });

  it("pans in the correct direction for each WASD key", () => {
    const expectations: Array<[string, string, { x: number; y: number }]> = [
      ["KeyW", "w", { x: 0, y: 1280 }],
      ["KeyS", "s", { x: 0, y: -1280 }],
      ["KeyA", "a", { x: 1280, y: 0 }],
      ["KeyD", "d", { x: -1280, y: 0 }],
    ];

    for (const [code, key, expectedDelta] of expectations) {
      const { context, moveViewportByClientPixelVector } = createContext();
      const module = createHypergryphKeyboardViewportPanModule();

      module.handle(keyDownEvent(code, key), context);
      advanceRafFrame(0);
      advanceRafFrame(1000);

      expect(moveViewportByClientPixelVector).toHaveBeenCalledTimes(1);
      expect(moveViewportByClientPixelVector).toHaveBeenCalledWith({
        startClientPixel: { x: 0, y: 0 },
        endClientPixel: expectedDelta,
      });
    }
  });

  it("treats all four arrow keys as equivalent viewport pan bindings", () => {
    const expectations: Array<[string, { x: number; y: number }]> = [
      ["ArrowUp", { x: 0, y: 1280 }],
      ["ArrowDown", { x: 0, y: -1280 }],
      ["ArrowLeft", { x: 1280, y: 0 }],
      ["ArrowRight", { x: -1280, y: 0 }],
    ];

    for (const [code, expectedDelta] of expectations) {
      const { context, moveViewportByClientPixelVector } = createContext();
      const module = createHypergryphKeyboardViewportPanModule();

      module.handle(keyDownEvent(code, code), context);
      advanceRafFrame(0);
      advanceRafFrame(1000);

      expect(moveViewportByClientPixelVector).toHaveBeenCalledWith({
        startClientPixel: { x: 0, y: 0 },
        endClientPixel: expectedDelta,
      });
    }
  });

  it("pans diagonally with each axis at 1280 pixels per second", () => {
    const { context, moveViewportByClientPixelVector } = createContext();
    const module = createHypergryphKeyboardViewportPanModule();

    module.handle(keyDownEvent("KeyW", "w"), context);
    module.handle(keyDownEvent("KeyD", "d"), context);
    advanceRafFrame(0);
    advanceRafFrame(1000);

    expect(moveViewportByClientPixelVector).toHaveBeenCalledTimes(1);
    expect(moveViewportByClientPixelVector).toHaveBeenCalledWith({
      startClientPixel: { x: 0, y: 0 },
      endClientPixel: { x: -1280, y: 1280 },
    });
  });

  it("stops panning after all keys are released", () => {
    const { context, moveViewportByClientPixelVector } = createContext();
    const module = createHypergryphKeyboardViewportPanModule();

    module.handle(keyDownEvent("KeyW", "w"), context);
    module.handle(keyDownEvent("KeyD", "d"), context);

    const upResult = module.handle(keyUpEvent("KeyD", "d"), context);
    expect(upResult).toEqual({ status: "handled" });

    advanceRafFrame(0);
    advanceRafFrame(1000);
    // D 已释放，仅剩 W：只保留向上分量
    expect(moveViewportByClientPixelVector).toHaveBeenCalledTimes(1);
    expect(moveViewportByClientPixelVector).toHaveBeenCalledWith({
      startClientPixel: { x: 0, y: 0 },
      endClientPixel: { x: 0, y: 1280 },
    });

    module.handle(keyUpEvent("KeyW", "w"), context);
    // 全部松开后 RAF 被取消，后续帧不再移动
    expect(rafCallbacks.size).toBe(0);
    advanceRafFrame(2000);
    expect(moveViewportByClientPixelVector).toHaveBeenCalledTimes(1);
  });

  it("stops panning when the window loses focus", () => {
    const { context, moveViewportByClientPixelVector } = createContext();
    const module = createHypergryphKeyboardViewportPanModule();

    module.handle(keyDownEvent("KeyW", "w"), context);
    advanceRafFrame(0);
    advanceRafFrame(1000);
    expect(moveViewportByClientPixelVector).toHaveBeenCalledTimes(1);

    vi.spyOn(document, "hasFocus").mockReturnValue(false);
    advanceRafFrame(2000);

    expect(rafCallbacks.size).toBe(0);
    advanceRafFrame(3000);
    expect(moveViewportByClientPixelVector).toHaveBeenCalledTimes(1);
  });

  it("ignores keys that are not pan shortcuts", () => {
    const { context, moveViewportByClientPixelVector } = createContext();
    const module = createHypergryphKeyboardViewportPanModule();

    const result = module.handle(keyDownEvent("KeyP", "p"), context);
    expect(result).toEqual({ status: "ignored" });
    expect(rafCallbacks.size).toBe(0);
    expect(moveViewportByClientPixelVector).not.toHaveBeenCalled();
  });

  it("only enables the module while hypergryph operation mode is on", () => {
    const module = createHypergryphKeyboardViewportPanModule();

    expect(module.when?.(createContext().context)).toBe(true);
    expect(module.when?.(createContext({ hypergryphOperationMode: false }).context)).toBe(false);
  });
});
