// @vitest-environment jsdom

import { observable, runInAction } from "mobx";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  createGestureAdapter,
  type GestureEvent,
  type GestureAdapterOptions,
  type GestureKeyboardEventLike,
  type GesturePointerEventLike,
  type GesturePosition,
  type GestureWheelEventLike,
} from "@/app/input/gesture/adapter";
import type { ActiveTool } from "@/domain/app/types/app-types";
import type { WorldEntity } from "@/domain/document/world-document";

function createAdapterHarness(options: {
  readonly activeTool?: ActiveTool;
  readonly resolvePointerEntity?: (position: GesturePosition) => WorldEntity | null;
  readonly adapterOptions?: GestureAdapterOptions;
} = {}) {
  const appHost = {
    workspace: {
      editor: options.resolvePointerEntity === undefined
        ? null
        : {
            queries: {
              findEntityAtClientPixelPoint: options.resolvePointerEntity,
            },
          },
    },
    internalState: observable({
      activeTool: options.activeTool ?? "select",
    }),
  };

  return {
    appHost,
    adapter: createGestureAdapter(appHost, options.adapterOptions),
  };
}

function pointerEvent(
  overrides: Partial<GesturePointerEventLike> = {},
): GesturePointerEventLike {
  return {
    pointerId: 1,
    pointerType: "mouse",
    clientX: 0,
    clientY: 0,
    button: 0,
    buttons: 0,
    altKey: false,
    ctrlKey: false,
    metaKey: false,
    shiftKey: false,
    ...overrides,
  };
}

function touchEvent(
  pointerId: number,
  clientX: number,
  clientY: number,
): GesturePointerEventLike {
  return pointerEvent({
    pointerId,
    pointerType: "touch",
    clientX,
    clientY,
    button: 0,
    buttons: 1,
  });
}

function wheelEvent(overrides: Partial<GestureWheelEventLike>): GestureWheelEventLike {
  return {
    clientX: 20,
    clientY: 40,
    deltaY: 0,
    deltaMode: WheelEvent.DOM_DELTA_PIXEL,
    altKey: false,
    ctrlKey: false,
    metaKey: false,
    shiftKey: false,
    ...overrides,
  };
}

function keyEvent(overrides: Partial<GestureKeyboardEventLike>): GestureKeyboardEventLike {
  return {
    code: "",
    key: "",
    keyCode: 0,
    altKey: false,
    ctrlKey: false,
    metaKey: false,
    shiftKey: false,
    ...overrides,
  };
}

describe("GestureAdapter", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("normalizes mouse move, tap and drag without emitting move during drag", () => {
    const { adapter } = createAdapterHarness();
    const events: GestureEvent[] = [];
    adapter.subscribe((event) => events.push(event));

    adapter.handlePointerMove(pointerEvent({ clientX: 8, clientY: 9 }));
    adapter.handlePointerDown(pointerEvent({ pointerId: 7, clientX: 10, clientY: 10, buttons: 1 }));
    adapter.handlePointerMove(
      pointerEvent({ pointerId: 7, clientX: 11, clientY: 10, buttons: 1 }),
    );
    adapter.handlePointerUp(pointerEvent({ pointerId: 7, clientX: 11, clientY: 10, buttons: 0 }));

    adapter.handlePointerDown(pointerEvent({ pointerId: 8, clientX: 20, clientY: 20, buttons: 1 }));
    adapter.handlePointerMove(
      pointerEvent({ pointerId: 8, clientX: 28, clientY: 20, buttons: 1 }),
    );
    adapter.handlePointerMove(
      pointerEvent({ pointerId: 8, clientX: 31, clientY: 25, buttons: 1 }),
    );
    adapter.handlePointerUp(pointerEvent({ pointerId: 8, clientX: 31, clientY: 25, buttons: 0 }));

    expect(events.map((event) => event.type)).toEqual([
      "mouse move",
      "mouse tap",
      "mouse dragstart",
      "mouse dragmove",
      "mouse dragend",
    ]);
    expect(events[3]).toMatchObject({
      type: "mouse dragmove",
      delta: { x: 3, y: 5 },
      longPress: false,
    });
    expect(events[4]).toMatchObject({
      type: "mouse dragend",
      reason: "release",
      longPress: false,
    });
    expect(events[1]).toMatchObject({
      type: "mouse tap",
      longPress: false,
    });
  });

  it("attaches resolved pointerEntity to mouse and touch tap or dragstart events", () => {
    const { adapter } = createAdapterHarness({
      resolvePointerEntity: (position) => createPointerEntity(`entity-${position.x}-${position.y}`),
    });
    const events: GestureEvent[] = [];
    adapter.subscribe((event) => events.push(event));

    adapter.handlePointerDown(pointerEvent({ pointerId: 11, clientX: 6, clientY: 7, buttons: 1 }));
    adapter.handlePointerUp(pointerEvent({ pointerId: 11, clientX: 6, clientY: 7, buttons: 0 }));

    adapter.handlePointerDown(pointerEvent({ pointerId: 12, clientX: 20, clientY: 20, buttons: 1 }));
    adapter.handlePointerMove(pointerEvent({ pointerId: 12, clientX: 28, clientY: 20, buttons: 1 }));

    adapter.handlePointerDown(touchEvent(21, 30, 30));
    adapter.handlePointerUp(touchEvent(21, 30, 30));

    adapter.handlePointerDown(touchEvent(22, 40, 40));
    adapter.handlePointerMove(touchEvent(22, 52, 40));

    expect(events).toMatchObject([
      {
        type: "mouse tap",
        pointerEntity: { id: "entity-6-7" },
      },
      {
        type: "mouse dragstart",
        pointerEntity: { id: "entity-28-20" },
      },
      {
        type: "touch tap",
        pointerEntity: { id: "entity-30-30" },
      },
      {
        type: "touch dragstart",
        pointerEntity: { id: "entity-52-40" },
      },
    ]);
  });

  it("persists mouse drag payload across drag events and drops it after dragend", () => {
    const { adapter } = createAdapterHarness();
    const startPayloads: Array<unknown | null | undefined> = [];
    const movePayloads: Array<unknown | null | undefined> = [];
    const endPayloads: Array<unknown | null | undefined> = [];

    adapter.subscribe((event) => {
      if (event.type === "mouse dragstart") {
        startPayloads.push(event.payload);
        if (startPayloads.length === 1) {
          event.payload = { tag: "mouse-payload" };
        }
        return;
      }

      if (event.type === "mouse dragmove") {
        movePayloads.push(event.payload);
        event.payload = null;
        return;
      }

      if (event.type === "mouse dragend") {
        endPayloads.push(event.payload);
        event.payload = { tag: "drop-after-end" };
      }
    });

    adapter.handlePointerDown(pointerEvent({ pointerId: 31, clientX: 10, clientY: 10, buttons: 1 }));
    adapter.handlePointerMove(pointerEvent({ pointerId: 31, clientX: 18, clientY: 10, buttons: 1 }));
    adapter.handlePointerMove(pointerEvent({ pointerId: 31, clientX: 22, clientY: 10, buttons: 1 }));
    adapter.handlePointerUp(pointerEvent({ pointerId: 31, clientX: 22, clientY: 10, buttons: 0 }));

    adapter.handlePointerDown(pointerEvent({ pointerId: 32, clientX: 30, clientY: 30, buttons: 1 }));
    adapter.handlePointerMove(pointerEvent({ pointerId: 32, clientX: 38, clientY: 30, buttons: 1 }));

    expect(startPayloads).toEqual([null, null]);
    expect(movePayloads).toEqual([{ tag: "mouse-payload" }]);
    expect(endPayloads).toEqual([null]);
  });

  it("persists touch drag payload across drag events and drops it after dragend", () => {
    const { adapter } = createAdapterHarness();
    const startPayloads: Array<unknown | null | undefined> = [];
    const movePayloads: Array<unknown | null | undefined> = [];
    const endPayloads: Array<unknown | null | undefined> = [];

    adapter.subscribe((event) => {
      if (event.type === "touch dragstart") {
        startPayloads.push(event.payload);
        if (startPayloads.length === 1) {
          event.payload = { tag: "touch-payload" };
        }
        return;
      }

      if (event.type === "touch dragmove") {
        movePayloads.push(event.payload);
        event.payload = null;
        return;
      }

      if (event.type === "touch dragend") {
        endPayloads.push(event.payload);
        event.payload = { tag: "drop-after-end" };
      }
    });

    adapter.handlePointerDown(touchEvent(41, 10, 10));
    adapter.handlePointerMove(touchEvent(41, 22, 10));
    adapter.handlePointerMove(touchEvent(41, 28, 10));
    adapter.handlePointerUp(touchEvent(41, 28, 10));

    adapter.handlePointerDown(touchEvent(42, 30, 30));
    adapter.handlePointerMove(touchEvent(42, 42, 30));

    expect(startPayloads).toEqual([null, null]);
    expect(movePayloads).toEqual([{ tag: "touch-payload" }]);
    expect(endPayloads).toEqual([null]);
  });

  it("marks mouse tap and drag with longPress after a held press and exposes the indicator state", () => {
    const { adapter } = createAdapterHarness();
    const events: GestureEvent[] = [];
    adapter.subscribe((event) => events.push(event));

    adapter.handlePointerDown(pointerEvent({ pointerId: 7, clientX: 10, clientY: 10, buttons: 1 }));
    expect(adapter.getLongPressState().visible).toBe(false);

    vi.advanceTimersByTime(200);
    expect(adapter.getLongPressState()).toMatchObject({
      visible: true,
      position: { x: 10, y: 10 },
    });
    expect(adapter.getLongPressState().progress).toBeCloseTo(0.4);

    adapter.handlePointerMove(pointerEvent({ pointerId: 7, clientX: 11, clientY: 10, buttons: 1 }));
    expect(adapter.getLongPressState().position).toEqual({ x: 11, y: 10 });

    vi.advanceTimersByTime(300);
    expect(adapter.getLongPressState()).toMatchObject({
      visible: true,
      progress: 1,
    });
    expect(events).toMatchObject([
      {
        type: "mouse-long-press-ready",
        position: { x: 11, y: 10 },
      },
    ]);

    adapter.handlePointerUp(pointerEvent({ pointerId: 7, clientX: 11, clientY: 10, buttons: 0 }));

    expect(events).toMatchObject([
      {
        type: "mouse-long-press-ready",
      },
      {
        type: "mouse tap",
        longPress: true,
      },
    ]);
    expect(adapter.getLongPressState().visible).toBe(false);

    adapter.handlePointerDown(pointerEvent({ pointerId: 8, clientX: 20, clientY: 20, buttons: 1 }));
    vi.advanceTimersByTime(500);
    adapter.handlePointerMove(pointerEvent({ pointerId: 8, clientX: 28, clientY: 20, buttons: 1 }));
    adapter.handlePointerMove(pointerEvent({ pointerId: 8, clientX: 31, clientY: 25, buttons: 1 }));
    adapter.handlePointerUp(pointerEvent({ pointerId: 8, clientX: 31, clientY: 25, buttons: 0 }));

    expect(events.slice(2).map((event) => event.type)).toEqual([
      "mouse-long-press-ready",
      "mouse dragstart",
      "mouse dragmove",
      "mouse dragend",
    ]);
    expect(events[2]).toMatchObject({
      type: "mouse-long-press-ready",
      position: { x: 20, y: 20 },
    });
    expect(events[3]).toMatchObject({
      type: "mouse dragstart",
      longPress: true,
    });
    expect(events[4]).toMatchObject({
      type: "mouse dragmove",
      longPress: true,
    });
    expect(events[5]).toMatchObject({
      type: "mouse dragend",
      longPress: true,
    });
  });

  it("uses long press to unlock touch drag and emits a longPress tap on release with no drag move", () => {
    const { adapter } = createAdapterHarness();
    const events: GestureEvent[] = [];
    adapter.subscribe((event) => events.push(event));

    adapter.handlePointerDown(touchEvent(1, 10, 10));
    expect(adapter.getLongPressState().visible).toBe(false);

    vi.advanceTimersByTime(199);
    expect(adapter.getLongPressState().visible).toBe(false);

    vi.advanceTimersByTime(1);
    expect(adapter.getLongPressState()).toMatchObject({
      visible: true,
      position: { x: 10, y: 10 },
    });
    expect(adapter.getLongPressState().progress).toBeCloseTo(0.4);

    vi.advanceTimersByTime(300);
    expect(adapter.getLongPressState()).toMatchObject({
      visible: true,
      progress: 1,
    });
    expect(events).toMatchObject([
      {
        type: "tap-long-press-ready",
        position: { x: 10, y: 10 },
      },
    ]);

    adapter.handlePointerUp(touchEvent(1, 10, 10));
    expect(events).toMatchObject([
      {
        type: "tap-long-press-ready",
      },
      {
        type: "touch tap",
        longPress: true,
      },
    ]);

    adapter.handlePointerDown(touchEvent(2, 30, 30));
    vi.advanceTimersByTime(500);
    adapter.handlePointerMove(touchEvent(2, 33, 30));
    adapter.handlePointerMove(touchEvent(2, 36, 34));
    adapter.handlePointerUp(touchEvent(2, 36, 34));

    expect(events.map((event) => event.type)).toEqual([
      "tap-long-press-ready",
      "touch tap",
      "tap-long-press-ready",
      "touch dragstart",
      "touch dragmove",
      "touch dragend",
    ]);
    expect(events[2]).toMatchObject({
      type: "tap-long-press-ready",
      position: { x: 30, y: 30 },
    });
    expect(events[3]).toMatchObject({
      type: "touch dragstart",
      longPress: true,
    });
    expect(events[5]).toMatchObject({
      type: "touch dragend",
      reason: "release",
      longPress: true,
    });
  });

  it("turns early touch movement into non-long-press touch drag and cancels the long press indicator", () => {
    const { adapter } = createAdapterHarness();
    const events: GestureEvent[] = [];
    adapter.subscribe((event) => events.push(event));

    adapter.handlePointerDown(touchEvent(1, 0, 0));
    adapter.handlePointerMove(touchEvent(1, 12, 0));
    vi.advanceTimersByTime(500);
    adapter.handlePointerMove(touchEvent(1, 14, 4));
    adapter.handlePointerUp(touchEvent(1, 14, 4));

    expect(adapter.getLongPressState().visible).toBe(false);
    expect(events.map((event) => event.type)).toEqual([
      "touch dragstart",
      "touch dragmove",
      "touch dragend",
    ]);
    expect(events[0]).toMatchObject({
      type: "touch dragstart",
      longPress: false,
    });
    expect(events[1]).toMatchObject({
      type: "touch dragmove",
      delta: { x: 2, y: 4 },
      longPress: false,
    });
    expect(events[2]).toMatchObject({
      type: "touch dragend",
      reason: "release",
      longPress: false,
    });
  });

  it("cancels non-long-press touch drag once the gesture becomes multi-touch", () => {
    const { adapter } = createAdapterHarness();
    const events: GestureEvent[] = [];
    adapter.subscribe((event) => events.push(event));

    adapter.handlePointerDown(touchEvent(1, 0, 0));
    adapter.handlePointerMove(touchEvent(1, 12, 0));

    expect(events.filter((event) => event.type === "touch dragstart")).toHaveLength(1);
    expect(events.filter((event) => event.type === "touch dragmove")).toHaveLength(0);

    adapter.handlePointerDown(touchEvent(2, 0, 10));
    adapter.handlePointerMove(touchEvent(2, 4, 16));
    adapter.handlePointerUp(touchEvent(2, 0, 10));
    adapter.handlePointerMove(touchEvent(1, 20, 0));
    adapter.handlePointerUp(touchEvent(1, 20, 0));

    expect(events.map((event) => event.type)).toEqual([
      "touch dragstart",
      "touch dragend",
      "pinch out",
      "rotate counterclockwise",
      "two finger move",
    ]);
    expect(events[1]).toMatchObject({
      type: "touch dragend",
      reason: "cancel",
      longPress: false,
    });
  });

  it("does not turn a pinch sequence back into touch drag after one finger lifts", () => {
    const { adapter } = createAdapterHarness();
    const events: GestureEvent[] = [];
    adapter.subscribe((event) => events.push(event));

    adapter.handlePointerDown(touchEvent(1, 0, 0));
    adapter.handlePointerDown(touchEvent(2, 0, 10));
    adapter.handlePointerMove(touchEvent(2, 4, 16));
    adapter.handlePointerUp(touchEvent(1, 0, 0));
    adapter.handlePointerMove(touchEvent(2, 7, 20));
    adapter.handlePointerUp(touchEvent(2, 7, 20));

    expect(events.map((event) => event.type)).toEqual([
      "pinch out",
      "two finger move",
    ]);
  });

  it("emits rotate gestures for two-finger rotation", () => {
    const { adapter } = createAdapterHarness();
    const events: GestureEvent[] = [];
    adapter.subscribe((event) => events.push(event));

    adapter.handlePointerDown(touchEvent(1, 0, 0));
    adapter.handlePointerDown(touchEvent(2, 10, 0));
    adapter.handlePointerMove(touchEvent(2, 0, 10));

    expect(events).toContainEqual(expect.objectContaining({
      type: "rotate clockwise",
      rotationDeltaDegrees: 90,
      activeTouchCount: 2,
    }));
  });

  it("does not show the long press indicator for a quick tap", () => {
    const { adapter } = createAdapterHarness();
    const events: GestureEvent[] = [];
    adapter.subscribe((event) => events.push(event));

    adapter.handlePointerDown(touchEvent(1, 8, 8));
    vi.advanceTimersByTime(150);
    adapter.handlePointerUp(touchEvent(1, 8, 8));
    vi.advanceTimersByTime(500);

    expect(adapter.getLongPressState().visible).toBe(false);
    expect(events).toMatchObject([
      {
        type: "touch tap",
        longPress: false,
      },
    ]);
  });

  it("normalizes wheel direction with accumulation", () => {
    const { adapter } = createAdapterHarness({
      adapterOptions: {
        thresholds: {
          wheelAccumulateThreshold: 1,
        },
      },
    });
    const events: GestureEvent[] = [];
    adapter.subscribe((event) => events.push(event));

    adapter.handleWheel(wheelEvent({ deltaY: -0.4 }));
    adapter.handleWheel(wheelEvent({ deltaY: -0.7 }));
    adapter.handleWheel(wheelEvent({ deltaY: 2 }));

    expect(events.map((event) => event.type)).toEqual(["wheel up", "wheel down"]);
    expect(events[0]).toMatchObject({
      type: "wheel up",
      normalizedDelta: -1.1,
      position: { x: 20, y: 40 },
    });
  });

  it("maintains pressedKeys and clears keyboard state on blur", () => {
    const { adapter } = createAdapterHarness();
    const events: GestureEvent[] = [];
    const snapshots = [adapter.getKeyboardSnapshot()];
    adapter.subscribe((event) => events.push(event));
    adapter.subscribeKeyboardSnapshot((snapshot) => snapshots.push(snapshot));

    adapter.handleKeyDown(keyEvent({ code: "KeyA", key: "a", keyCode: 65 }));
    adapter.handleKeyDown(
      keyEvent({ code: "ShiftLeft", key: "Shift", keyCode: 16, shiftKey: true }),
    );
    adapter.handleKeyUp(keyEvent({ code: "KeyA", key: "a", keyCode: 65 }));

    expect(adapter.getKeyboardSnapshot().pressedKeys.has("KeyA")).toBe(false);
    expect(adapter.getKeyboardSnapshot().pressedKeys.has("ShiftLeft")).toBe(true);
    expect(events).toMatchObject([
      {
        type: "key down",
        code: "KeyA",
        key: "a",
        keyCode: 65,
      },
      {
        type: "key down",
        code: "ShiftLeft",
        key: "Shift",
        keyCode: 16,
      },
      {
        type: "key up",
        code: "KeyA",
        key: "a",
        keyCode: 65,
      },
    ]);

    adapter.handleBlur();

    expect(adapter.getKeyboardSnapshot()).toMatchObject({
      lastCode: null,
      lastKey: null,
      lastKeyCode: null,
    });
    expect(adapter.getKeyboardSnapshot().pressedKeys.size).toBe(0);
    expect(snapshots.at(-1)?.pressedKeys.size).toBe(0);
  });

  it("emits semantic ui button tap gestures", () => {
    const { adapter } = createAdapterHarness();
    const events: GestureEvent[] = [];
    adapter.subscribe((event) => events.push(event));

    adapter.handleUiButtonMouseTap({
      uiButtonId: "utility-settings",
      button: 0,
      altKey: false,
      ctrlKey: false,
      metaKey: false,
      shiftKey: false,
    });
    adapter.handleUiButtonTouchTap({
      uiButtonId: "utility-settings",
      altKey: false,
      ctrlKey: false,
      metaKey: false,
      shiftKey: false,
    });

    expect(events).toMatchObject([
      {
        type: "ui-button-mouse-tap",
        uiButtonId: "utility-settings",
        button: 0,
      },
      {
        type: "ui-button-touch-tap",
        uiButtonId: "utility-settings",
      },
    ]);
  });

  it("emits active tool exit before enter and carries from/to tool keys", () => {
    const { adapter, appHost } = createAdapterHarness({ activeTool: "select" });
    const events: GestureEvent[] = [];
    adapter.subscribe((event) => {
      if (event.type === "on-exit-active-tool" || event.type === "on-enter-active-tool") {
        events.push(event);
      }
    });

    runInAction(() => {
      appHost.internalState.activeTool = "move";
    });

    expect(events.map((event) => event.type)).toEqual([
      "on-exit-active-tool",
      "on-enter-active-tool",
    ]);
    expect(events).toMatchObject([
      {
        type: "on-exit-active-tool",
        from: "select",
        to: "move",
      },
      {
        type: "on-enter-active-tool",
        from: "select",
        to: "move",
      },
    ]);
  });
});

function createPointerEntity(id: string): WorldEntity {
  return {
    id,
    definitionId: "belt_straight_1x1",
    position: { x: 0, y: 0 },
    rotation: 0,
    config: {},
    tags: [],
  };
}
