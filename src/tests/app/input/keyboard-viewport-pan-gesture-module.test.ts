// AI-REMOVED 2026-11-12:
// Reason: 相机已从 Editor 分离，手势模块不再创建 RAF。
// Trigger: REQ-048 显式帧与真实测试主机。
// Evidence: 旧测试模拟 RAF 和假的 Editor 平移方法，未验证相机结果。
// Replacement: 本文件真实 View + Router，显式 advanceFrame。
// Risk: 原生键盘焦点／失焦另由 E2E 验证；速度、修饰键及取消规则保持。
// Human Review: Required
// Original code:
// import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
//
// import { SHORTCUT_KEY } from "@/app/actions/keyboard-shortcut-manager";
// import type { AppHost } from "@/app/host/app-host";
// import type { KeyboardSnapshot } from "@/app/input/gesture/adapter";
// import {
//   createHypergryphKeyboardViewportPanModule,
//   type GestureActionContext,
//   type GestureMappingModule,
//   type KeyboardGestureEvent,
// } from "@/app/input/gesture/actions";
// import type { WorkspaceContract } from "@/domain/document/workspace-contract";
// import { handleKeyboardShortcutThroughRouter } from "./shortcut-route-test-helper";
//
// // ─── 可控 RAF mock ───
// let rafCallbacks: Map<number, (now: number) => void>;
// let rafIdCounter: number;
//
// function setupRafMocks(): void {
//   rafCallbacks = new Map();
//   rafIdCounter = 0;
//   vi.stubGlobal("requestAnimationFrame", (callback: (now: number) => void) => {
//     rafCallbacks.set(++rafIdCounter, callback);
//     return rafIdCounter;
//   });
//   vi.stubGlobal("cancelAnimationFrame", (id: number) => {
//     rafCallbacks.delete(id);
//   });
// }
//
// function advanceRafFrame(nowMs: number): void {
//   const callbacks = [...rafCallbacks.values()];
//   rafCallbacks.clear();
//   for (const callback of callbacks) {
//     callback(nowMs);
//   }
// }
//
// // ─── 事件与上下文辅助 ───
// function keyEvent(
//   code: string,
//   key: string,
//   modifiers: Partial<{ alt: boolean; ctrl: boolean; meta: boolean; shift: boolean }> = {},
// ): {
//   type: "key down" | "key up";
//   gestureId: string;
//   code: string;
//   key: string;
//   keyCode: number;
//   modifiers: { alt: boolean; ctrl: boolean; meta: boolean; shift: boolean };
//   sourceEvent: null;
// } {
//   return {
//     type: "key down",
//     gestureId: "key-1",
//     code,
//     key,
//     keyCode: key.toUpperCase().charCodeAt(0),
//     modifiers: { alt: false, ctrl: false, meta: false, shift: false, ...modifiers },
//     sourceEvent: null,
//   };
// }
//
// function keyDownEvent(
//   code: string,
//   key: string,
//   modifiers: Partial<{ alt: boolean; ctrl: boolean; meta: boolean; shift: boolean }> = {},
// ) {
//   return { ...keyEvent(code, key, modifiers), type: "key down" as const };
// }
//
// function keyUpEvent(
//   code: string,
//   key: string,
//   modifiers: Partial<{ alt: boolean; ctrl: boolean; meta: boolean; shift: boolean }> = {},
// ) {
//   return { ...keyEvent(code, key, modifiers), type: "key up" as const };
// }
//
// function handleShortcut(
//   module: GestureMappingModule<AppHost>,
//   context: GestureActionContext<AppHost>,
//   event: KeyboardGestureEvent,
// ) {
//   return handleKeyboardShortcutThroughRouter({ module, context, event });
// }
//
// const PAN_SHORTCUT_CODE: Record<string, string> = {
//   [SHORTCUT_KEY.PAN_VIEWPORT_UP]: "KeyW",
//   [SHORTCUT_KEY.PAN_VIEWPORT_DOWN]: "KeyS",
//   [SHORTCUT_KEY.PAN_VIEWPORT_LEFT]: "KeyA",
//   [SHORTCUT_KEY.PAN_VIEWPORT_RIGHT]: "KeyD",
// };
//
// const PAN_SECONDARY_SHORTCUT_CODE: Record<string, string> = {
//   [SHORTCUT_KEY.PAN_VIEWPORT_UP]: "ArrowUp",
//   [SHORTCUT_KEY.PAN_VIEWPORT_DOWN]: "ArrowDown",
//   [SHORTCUT_KEY.PAN_VIEWPORT_LEFT]: "ArrowLeft",
//   [SHORTCUT_KEY.PAN_VIEWPORT_RIGHT]: "ArrowRight",
// };
//
// function createContext(options: {
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
//   gridCellPixelSize?: number;
// } = {}): {
//   context: GestureActionContext<AppHost>;
//   moveViewportByClientPixelVector: ReturnType<typeof vi.fn>;
//   isShortcutFor: ReturnType<typeof vi.fn>;
// } {
//   const {
//     // AI-REMOVED 2026-09-10:
//     // Reason: 操作模式总开关已废弃，不再保留关闭分支
//     // Trigger: 用户要求彻底移除 hypergryphOperationMode。
//     // Evidence: 总开关入口已隐藏；手势路由器无 when 时默认启用。
//     // Replacement: 测试状态不再需要模式字段
//     // Risk: 历史 false 设置统一使用当前操作行为。
//     // Human Review: Required
//     //
//     // Original code:
//     // hypergryphOperationMode = true,
//     gridCellPixelSize = 32,
//   } = options;
//   const moveViewportByClientPixelVector = vi.fn();
//   // AI-REMOVED 2026-08-03:
//   // Reason: mock 不能再只识别 WASD 主槽位，否则无法验证方向键等效绑定。
//   // Trigger: ST2-RQ-002 双槽位视口平移。
//   // Evidence: 下方 mock 同时检查 PAN_SHORTCUT_CODE 与 PAN_SECONDARY_SHORTCUT_CODE。
//   // Replacement: 下方 isShortcutFor mock。
//   // Risk: Low
//   // Human Review: Required
//   //
//   // Original code:
//   // const isShortcutFor = vi.fn(
//   //   (key: string, code: string | null) => PAN_SHORTCUT_CODE[key] === code,
//   // );
//   const isShortcutFor = vi.fn(
//     (
//       key: string,
//       code: string | null,
//       _eventKey?: string | null,
//       modifiers: { alt?: boolean; ctrl?: boolean; meta?: boolean; shift?: boolean } = {},
//     ) => (
//       !modifiers.alt
//       && !modifiers.ctrl
//       && !modifiers.meta
//       && !modifiers.shift
//       && (PAN_SHORTCUT_CODE[key] === code || PAN_SECONDARY_SHORTCUT_CODE[key] === code)
//     ),
//   );
//
//   const workspace = {
//     editor: {
//       state: {
//         viewport: {
//           gridCellPixelSize,
//         },
//       },
//       actions: {
//         moveViewportByClientPixelVector,
//       },
//     },
//   } as unknown as WorkspaceContract;
//
//   return {
//     context: {
//       workspace,
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
//             // hypergryphOperationMode,
//           },
//         },
//         internalActions: {
//           isShortcutFor,
//         },
//       } as unknown as AppHost,
//       keyboard: emptyKeyboardSnapshot(),
//     },
//     moveViewportByClientPixelVector,
//     isShortcutFor,
//   };
// }
//
// function emptyKeyboardSnapshot(): KeyboardSnapshot {
//   return {
//     pressedKeys: new Set(),
//     lastCode: null,
//     lastKey: null,
//     lastKeyCode: null,
//     modifiers: { alt: false, ctrl: false, meta: false, shift: false },
//   };
// }
//
// function withKeyboardSnapshot(
//   context: GestureActionContext<AppHost>,
//   pressedKeys: readonly string[],
//   modifiers: Partial<KeyboardSnapshot["modifiers"]> = {},
// ): GestureActionContext<AppHost> {
//   return {
//     ...context,
//     keyboard: {
//       ...emptyKeyboardSnapshot(),
//       pressedKeys: new Set(pressedKeys),
//       modifiers: {
//         alt: false,
//         ctrl: false,
//         meta: false,
//         shift: false,
//         ...modifiers,
//       },
//     },
//   };
// }
//
// // ─── 测试 ───
// describe("createHypergryphKeyboardViewportPanModule", () => {
//   beforeEach(() => {
//     setupRafMocks();
//     // jsdom 中 document.hasFocus() 默认返回 false，会触发模块的失焦兜底停止逻辑；
//     // 默认 stub 为 true 以模拟真实浏览器的页面聚焦状态。
//     vi.spyOn(document, "hasFocus").mockReturnValue(true);
//   });
//
//   afterEach(() => {
//     vi.unstubAllGlobals();
//     vi.restoreAllMocks();
//   });
//
//   it("pans the viewport upward at 1280 pixels per second while W is held", () => {
//     const { context, moveViewportByClientPixelVector } = createContext();
//     const module = createHypergryphKeyboardViewportPanModule();
//
//     const downResult = handleShortcut(module, context, keyDownEvent("KeyW", "w"));
//     expect(downResult).toEqual({ status: "handled" });
//
//     // 首帧只记录基准时间
//     advanceRafFrame(0);
//     expect(moveViewportByClientPixelVector).not.toHaveBeenCalled();
//
//     // 1 秒后：向上平移 10 格（每格 32px → 320px，内容向屏幕下方移动 dy 为正）
//     // 订正（2026-08-25）：屏幕速度固定为 1280px/s，不再按网格像素尺寸换算。
//     advanceRafFrame(1000);
//     expect(moveViewportByClientPixelVector).toHaveBeenCalledTimes(1);
//     expect(moveViewportByClientPixelVector).toHaveBeenCalledWith({
//       startClientPixel: { x: 0, y: 0 },
//       endClientPixel: { x: 0, y: 1280 },
//     });
//   });
//
//   it("keeps the client pixel speed unchanged across zoom levels", () => {
//     for (const gridCellPixelSize of [16, 64, 128]) {
//       const { context, moveViewportByClientPixelVector } = createContext({ gridCellPixelSize });
//       const module = createHypergryphKeyboardViewportPanModule();
//
//       handleShortcut(module, context, keyDownEvent("KeyW", "w"));
//       advanceRafFrame(0);
//       advanceRafFrame(1000);
//
//       expect(moveViewportByClientPixelVector).toHaveBeenCalledWith({
//         startClientPixel: { x: 0, y: 0 },
//         endClientPixel: { x: 0, y: 1280 },
//       });
//
//       handleShortcut(module, context, keyUpEvent("KeyW", "w"));
//     }
//   });
//
//   it("pans in the correct direction for each WASD key", () => {
//     const expectations: Array<[string, string, { x: number; y: number }]> = [
//       ["KeyW", "w", { x: 0, y: 1280 }],
//       ["KeyS", "s", { x: 0, y: -1280 }],
//       ["KeyA", "a", { x: 1280, y: 0 }],
//       ["KeyD", "d", { x: -1280, y: 0 }],
//     ];
//
//     for (const [code, key, expectedDelta] of expectations) {
//       const { context, moveViewportByClientPixelVector } = createContext();
//       const module = createHypergryphKeyboardViewportPanModule();
//
//       handleShortcut(module, context, keyDownEvent(code, key));
//       advanceRafFrame(0);
//       advanceRafFrame(1000);
//
//       expect(moveViewportByClientPixelVector).toHaveBeenCalledTimes(1);
//       expect(moveViewportByClientPixelVector).toHaveBeenCalledWith({
//         startClientPixel: { x: 0, y: 0 },
//         endClientPixel: expectedDelta,
//       });
//     }
//   });
//
//   it("doubles WASD pan speed while Shift is already held", () => {
//     const { context, moveViewportByClientPixelVector } = createContext();
//     const module = createHypergryphKeyboardViewportPanModule();
//     const acceleratedContext = withKeyboardSnapshot(
//       context,
//       ["ShiftLeft", "KeyW"],
//       { shift: true },
//     );
//
//     expect(handleShortcut(
//       module,
//       acceleratedContext,
//       keyDownEvent("KeyW", "w", { shift: true }),
//     )).toEqual({ status: "handled" });
//     advanceRafFrame(0);
//     advanceRafFrame(1000);
//
//     expect(moveViewportByClientPixelVector).toHaveBeenCalledWith({
//       startClientPixel: { x: 0, y: 0 },
//       endClientPixel: { x: 0, y: 2560 },
//     });
//   });
//
//   it("switches between normal and accelerated speed without restarting WASD pan", () => {
//     const { context, moveViewportByClientPixelVector } = createContext();
//     const module = createHypergryphKeyboardViewportPanModule();
//
//     handleShortcut(
//       module,
//       withKeyboardSnapshot(context, ["KeyW"]),
//       keyDownEvent("KeyW", "w"),
//     );
//     advanceRafFrame(0);
//     advanceRafFrame(500);
//
//     expect(handleShortcut(
//       module,
//       withKeyboardSnapshot(context, ["KeyW", "ShiftLeft"], { shift: true }),
//       keyDownEvent("ShiftLeft", "Shift", { shift: true }),
//     )).toEqual({ status: "ignored" });
//     advanceRafFrame(1000);
//
//     expect(handleShortcut(
//       module,
//       withKeyboardSnapshot(context, ["KeyW"]),
//       keyUpEvent("ShiftLeft", "Shift"),
//     )).toEqual({ status: "ignored" });
//     advanceRafFrame(1500);
//
//     expect(moveViewportByClientPixelVector.mock.calls.map(([options]) => (
//       options.endClientPixel
//     ))).toEqual([
//       { x: 0, y: 640 },
//       { x: 0, y: 1280 },
//       { x: 0, y: 640 },
//     ]);
//   });
//
//   it("treats all four arrow keys as equivalent viewport pan bindings", () => {
//     const expectations: Array<[string, { x: number; y: number }]> = [
//       ["ArrowUp", { x: 0, y: 1280 }],
//       ["ArrowDown", { x: 0, y: -1280 }],
//       ["ArrowLeft", { x: 1280, y: 0 }],
//       ["ArrowRight", { x: -1280, y: 0 }],
//     ];
//
//     for (const [code, expectedDelta] of expectations) {
//       const { context, moveViewportByClientPixelVector } = createContext();
//       const module = createHypergryphKeyboardViewportPanModule();
//
//       handleShortcut(module, context, keyDownEvent(code, code));
//       advanceRafFrame(0);
//       advanceRafFrame(1000);
//
//       expect(moveViewportByClientPixelVector).toHaveBeenCalledWith({
//         startClientPixel: { x: 0, y: 0 },
//         endClientPixel: expectedDelta,
//       });
//     }
//   });
//
//   it("doubles arrow-key pan speed while Shift is held", () => {
//     const { context, moveViewportByClientPixelVector } = createContext();
//     const module = createHypergryphKeyboardViewportPanModule();
//
//     handleShortcut(
//       module,
//       withKeyboardSnapshot(context, ["ShiftRight", "ArrowRight"], { shift: true }),
//       keyDownEvent("ArrowRight", "ArrowRight", { shift: true }),
//     );
//     advanceRafFrame(0);
//     advanceRafFrame(1000);
//
//     expect(moveViewportByClientPixelVector).toHaveBeenCalledWith({
//       startClientPixel: { x: 0, y: 0 },
//       endClientPixel: { x: -2560, y: 0 },
//     });
//   });
//
//   it("pans diagonally with each axis at 1280 pixels per second", () => {
//     const { context, moveViewportByClientPixelVector } = createContext();
//     const module = createHypergryphKeyboardViewportPanModule();
//
//     handleShortcut(module, context, keyDownEvent("KeyW", "w"));
//     handleShortcut(module, context, keyDownEvent("KeyD", "d"));
//     advanceRafFrame(0);
//     advanceRafFrame(1000);
//
//     expect(moveViewportByClientPixelVector).toHaveBeenCalledTimes(1);
//     expect(moveViewportByClientPixelVector).toHaveBeenCalledWith({
//       startClientPixel: { x: 0, y: 0 },
//       endClientPixel: { x: -1280, y: 1280 },
//     });
//   });
//
//   it("stops panning after all keys are released", () => {
//     const { context, moveViewportByClientPixelVector } = createContext();
//     const module = createHypergryphKeyboardViewportPanModule();
//
//     handleShortcut(module, context, keyDownEvent("KeyW", "w"));
//     handleShortcut(module, context, keyDownEvent("KeyD", "d"));
//
//     const upResult = handleShortcut(module, context, keyUpEvent("KeyD", "d"));
//     expect(upResult).toEqual({ status: "handled" });
//
//     advanceRafFrame(0);
//     advanceRafFrame(1000);
//     // D 已释放，仅剩 W：只保留向上分量
//     expect(moveViewportByClientPixelVector).toHaveBeenCalledTimes(1);
//     expect(moveViewportByClientPixelVector).toHaveBeenCalledWith({
//       startClientPixel: { x: 0, y: 0 },
//       endClientPixel: { x: 0, y: 1280 },
//     });
//
//     handleShortcut(module, context, keyUpEvent("KeyW", "w"));
//     // 全部松开后 RAF 被取消，后续帧不再移动
//     expect(rafCallbacks.size).toBe(0);
//     advanceRafFrame(2000);
//     expect(moveViewportByClientPixelVector).toHaveBeenCalledTimes(1);
//   });
//
//   it("stops accelerated panning when the direction key is released before Shift", () => {
//     const { context, moveViewportByClientPixelVector } = createContext();
//     const module = createHypergryphKeyboardViewportPanModule();
//
//     handleShortcut(
//       module,
//       withKeyboardSnapshot(context, ["ShiftLeft", "KeyW"], { shift: true }),
//       keyDownEvent("KeyW", "w", { shift: true }),
//     );
//     advanceRafFrame(0);
//     advanceRafFrame(1000);
//     expect(moveViewportByClientPixelVector).toHaveBeenCalledTimes(1);
//
//     expect(handleShortcut(
//       module,
//       withKeyboardSnapshot(context, ["ShiftLeft"], { shift: true }),
//       keyUpEvent("KeyW", "w", { shift: true }),
//     )).toEqual({ status: "handled" });
//     expect(rafCallbacks.size).toBe(0);
//   });
//
//   it("stops panning when the window loses focus", () => {
//     const { context, moveViewportByClientPixelVector } = createContext();
//     const module = createHypergryphKeyboardViewportPanModule();
//
//     handleShortcut(module, context, keyDownEvent("KeyW", "w"));
//     advanceRafFrame(0);
//     advanceRafFrame(1000);
//     expect(moveViewportByClientPixelVector).toHaveBeenCalledTimes(1);
//
//     vi.spyOn(document, "hasFocus").mockReturnValue(false);
//     advanceRafFrame(2000);
//
//     expect(rafCallbacks.size).toBe(0);
//     advanceRafFrame(3000);
//     expect(moveViewportByClientPixelVector).toHaveBeenCalledTimes(1);
//   });
//
//   it("ignores keys that are not pan shortcuts", () => {
//     const { context, moveViewportByClientPixelVector } = createContext();
//     const module = createHypergryphKeyboardViewportPanModule();
//
//     const result = handleShortcut(module, context, keyDownEvent("KeyP", "p"));
//     expect(result).toEqual({ status: "ignored" });
//     expect(rafCallbacks.size).toBe(0);
//     expect(moveViewportByClientPixelVector).not.toHaveBeenCalled();
//   });
//
//   // AI-REMOVED 2026-09-10:
//   // Reason: 操作模式总开关已废弃，不再保留关闭分支
//   // Trigger: 用户要求彻底移除 hypergryphOperationMode。
//   // Evidence: 总开关入口已隐藏；手势路由器无 when 时默认启用。
//   // Replacement: 现有正常操作测试及旧设置加载回归
//   // Risk: 历史 false 设置统一使用当前操作行为。
//   // Human Review: Required
//   //
//   // Original code:
//   // it("only enables the module while hypergryph operation mode is on", () => {
//   //   const module = createHypergryphKeyboardViewportPanModule();
//   //
//   //   expect(module.when?.(createContext().context)).toBe(true);
//   //   expect(module.when?.(createContext({ hypergryphOperationMode: false }).context)).toBe(false);
//   // });
// });
import { afterEach, describe, expect, it } from "vitest";
import { createGestureActionRouter, createHypergryphKeyboardViewportPanModule } from "@/app/input/gesture/actions";
import { createCanvasTestSession } from "@/tests/helpers/canvas-test-session";
import { SHORTCUT_KEY } from "@/app/actions";

const cleanups: Array<() => void> = [];
afterEach(() => { for (const dispose of cleanups.splice(0).reverse()) dispose(); });

function setup(gridSize = 1) {
  // AI-REMOVED 2026-11-12: 单次赋值改为下方 const，闭包延后读取；Risk: Low；Human Review: Required
  // Original code: let cancelRouter: (() => void) | undefined;
  const test = createCanvasTestSession({ viewport: { center: { x: 0, y: 0 }, gridSize, displayRotation: 0 },
    adapterOptions: { onCancel: () => cancelRouter?.() } });
  test.view.actions.setViewportClientRect({ left: 0, top: 0, width: 800, height: 600 });
  const module = createHypergryphKeyboardViewportPanModule();
  const inputRouter = createGestureActionRouter({ gestureAdapter: test.adapter, workspace: test.workspace,
    getAppHost: () => test.app, getCanvas: () => test.canvas,
    getShortcutBinding: id => test.app.internalActions.getKeyboardShortcutFor(id),
    getShortcutInputLayer: () => "canvas", getActiveTool: () => test.canvas.state.activeTool, modules: [module] });
  const cancelRouter = () => inputRouter.cancel();
  cleanups.push(() => { inputRouter.dispose(); test.dispose(); });
  const key = (code: string, down = true, shift = false) => {
    const event = { code, key: code === "ShiftLeft" ? "Shift" : code.replace("Key", "").toLowerCase(),
      keyCode: 0, altKey: false, ctrlKey: false, metaKey: false, shiftKey: shift };
    return down ? test.adapter.handleKeyDown(event) : test.adapter.handleKeyUp(event);
  };
  return { ...test, module, router: inputRouter, key,
    pixels: () => ({ x: test.view.state.center.x * test.view.state.gridCellPixelSize,
      y: test.view.state.center.y * test.view.state.gridCellPixelSize }) };
}

describe("caller-driven keyboard viewport pan", () => {
  it.each([
    ["KeyW", 0, -1280], ["KeyS", 0, 1280], ["KeyA", -1280, 0], ["KeyD", 1280, 0],
    ["ArrowUp", 0, -1280], ["ArrowDown", 0, 1280], ["ArrowLeft", -1280, 0], ["ArrowRight", 1280, 0],
  ] as const)("%s keeps each screen axis at 1280 px/s without implicit frames", (code, x, y) => {
    const test = setup();
    test.key(code);
    expect(test.module.needsFrame?.()).toBe(true);
    expect(test.pixels()).toEqual({ x: 0, y: 0 });
    test.router.advanceFrame(0);
    expect(test.pixels()).toEqual({ x: 0, y: 0 });
    test.router.advanceFrame(1000);
    expect(test.pixels()).toEqual({ x, y });
  });

  it.each([1, 4, 8])("preserves screen speed at zoom %s", zoom => {
    const test = setup(zoom);
    test.key("KeyW"); test.router.advanceFrame(0); test.router.advanceFrame(1000);
    expect(test.pixels()).toEqual({ x: 0, y: -1280 });
  });

  it.each(["KeyW", "ArrowUp"])("uses Shift held before %s, then changes speed without restarting", code => {
    const test = setup();
    test.key("ShiftLeft", true, true); test.key(code, true, true);
    test.router.advanceFrame(0); test.router.advanceFrame(1000);
    expect(test.pixels().y).toBe(-2560);
    test.key("ShiftLeft", false, false); test.router.advanceFrame(2000);
    expect(test.pixels().y).toBe(-3840);
    test.key("ShiftLeft", true, true); test.router.advanceFrame(3000);
    expect(test.pixels().y).toBe(-6400);
    test.key(code, false, true);
    expect(test.module.needsFrame?.()).toBe(false);
    test.router.advanceFrame(4000);
    expect(test.pixels().y).toBe(-6400);
  });

  it("combines axes, deduplicates equivalent direction keys, and stops after release", () => {
    const test = setup();
    test.key("KeyW"); test.key("ArrowUp"); test.key("KeyD");
    test.router.advanceFrame(0); test.router.advanceFrame(1000);
    expect(test.pixels()).toEqual({ x: 1280, y: -1280 });
    test.key("KeyW", false); test.key("ArrowUp", false); test.key("KeyD", false);
    expect(test.module.needsFrame?.()).toBe(false);
    test.router.advanceFrame(2000);
    expect(test.pixels()).toEqual({ x: 1280, y: -1280 });
  });

  it("cancels on blur and rebases the next gesture without accumulating hidden time", () => {
    const test = setup();
    test.key("KeyW"); test.router.advanceFrame(0); test.router.advanceFrame(1000);
    test.adapter.handleBlur(); test.router.advanceFrame(10000);
    expect(test.module.needsFrame?.()).toBe(false);
    expect(test.pixels().y).toBe(-1280);
    test.key("KeyW"); test.router.advanceFrame(20000); test.router.advanceFrame(20100);
    expect(test.pixels().y).toBe(-1408);
  });

  it("reads customized bindings and ignores unrelated keys and repeated or backwards frame samples", () => {
    const test = setup();
    test.app.internalActions.setShortcutFor(SHORTCUT_KEY.PAN_VIEWPORT_UP, "I");
    test.key("KeyW"); test.router.advanceFrame(0); test.router.advanceFrame(1000);
    expect(test.module.needsFrame?.()).toBe(false);
    test.key("KeyI"); test.router.advanceFrame(1000); test.router.advanceFrame(1100);
    test.router.advanceFrame(1100); test.router.advanceFrame(1050); test.router.advanceFrame(NaN);
    expect(test.pixels().y).toBe(-128);
    test.router.advanceFrame(1200);
    expect(test.pixels().y).toBe(-256);
  });
});
