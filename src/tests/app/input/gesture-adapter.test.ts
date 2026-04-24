// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  createGestureAdapter,
  type GestureEvent,
  type GestureKeyboardEventLike,
  type GesturePointerEventLike,
  type GestureWheelEventLike,
} from "@/app/input/gesture-adapter";

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
    const adapter = createGestureAdapter();
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
      pointerEvent({ pointerId: 8, clientX: 24, clientY: 20, buttons: 1 }),
    );
    adapter.handlePointerMove(
      pointerEvent({ pointerId: 8, clientX: 27, clientY: 25, buttons: 1 }),
    );
    adapter.handlePointerUp(pointerEvent({ pointerId: 8, clientX: 27, clientY: 25, buttons: 0 }));

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
    });
    expect(events[4]).toMatchObject({
      type: "mouse dragend",
      reason: "release",
    });
  });

  it("uses long press to unlock touch drag and ignores release with no drag move", () => {
    const adapter = createGestureAdapter();
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

    adapter.handlePointerUp(touchEvent(1, 10, 10));
    expect(events).toEqual([]);

    adapter.handlePointerDown(touchEvent(2, 30, 30));
    vi.advanceTimersByTime(500);
    adapter.handlePointerMove(touchEvent(2, 33, 30));
    adapter.handlePointerMove(touchEvent(2, 36, 34));
    adapter.handlePointerUp(touchEvent(2, 36, 34));

    expect(events.map((event) => event.type)).toEqual([
      "touch dragstart",
      "touch dragmove",
      "touch dragend",
    ]);
    expect(events[0]).toMatchObject({
      type: "touch dragstart",
      longPress: true,
    });
    expect(events[2]).toMatchObject({
      type: "touch dragend",
      reason: "release",
      longPress: true,
    });
  });

  it("turns early touch movement into non-long-press touch drag and cancels the long press indicator", () => {
    const adapter = createGestureAdapter();
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
    const adapter = createGestureAdapter();
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
      "two finger move",
    ]);
    expect(events[1]).toMatchObject({
      type: "touch dragend",
      reason: "cancel",
      longPress: false,
    });
  });

  it("does not turn a pinch sequence back into touch drag after one finger lifts", () => {
    const adapter = createGestureAdapter();
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

  it("does not show the long press indicator for a quick tap", () => {
    const adapter = createGestureAdapter();

    adapter.handlePointerDown(touchEvent(1, 8, 8));
    vi.advanceTimersByTime(150);
    adapter.handlePointerUp(touchEvent(1, 8, 8));
    vi.advanceTimersByTime(500);

    expect(adapter.getLongPressState().visible).toBe(false);
  });

  it("normalizes wheel direction with accumulation", () => {
    const adapter = createGestureAdapter({
      thresholds: {
        wheelAccumulateThreshold: 1,
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
    const adapter = createGestureAdapter();
    const snapshots = [adapter.getKeyboardSnapshot()];
    adapter.subscribeKeyboardSnapshot((snapshot) => snapshots.push(snapshot));

    adapter.handleKeyDown(keyEvent({ code: "KeyA", key: "a", keyCode: 65 }));
    adapter.handleKeyDown(
      keyEvent({ code: "ShiftLeft", key: "Shift", keyCode: 16, shiftKey: true }),
    );
    adapter.handleKeyUp(keyEvent({ code: "KeyA", key: "a", keyCode: 65 }));

    expect(adapter.getKeyboardSnapshot().pressedKeys.has("KeyA")).toBe(false);
    expect(adapter.getKeyboardSnapshot().pressedKeys.has("ShiftLeft")).toBe(true);

    adapter.handleBlur();

    expect(adapter.getKeyboardSnapshot()).toMatchObject({
      lastCode: null,
      lastKey: null,
      lastKeyCode: null,
    });
    expect(adapter.getKeyboardSnapshot().pressedKeys.size).toBe(0);
    expect(snapshots.at(-1)?.pressedKeys.size).toBe(0);
  });
});
