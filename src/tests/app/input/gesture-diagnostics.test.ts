import { describe, expect, it } from "vitest";

import {
  createGestureDiagnosticsModule,
  createGestureDiagnosticsStore,
} from "@/app/input/gesture/diagnostics";
import type { GestureEvent } from "@/app/input/gesture/adapter";
import type { WorldEntity } from "@/domain/entity/world-document";

type MouseTapGestureEvent = Extract<GestureEvent, { type: "mouse tap" }>;
type MouseLongPressReadyGestureEvent = Extract<GestureEvent, { type: "mouse-long-press-ready" }>;

function mouseTapEvent(gestureId = "tap-1"): MouseTapGestureEvent {
  return {
    type: "mouse tap",
    gestureId,
    button: 0,
    buttons: 0,
    position: { x: 12, y: 24 },
    longPress: false,
    pointerEntity: null,
    modifiers: {
      alt: false,
      ctrl: false,
      meta: false,
      shift: false,
    },
    sourceEvent: null,
  };
}

function keyDownEvent(gestureId = "key-1"): GestureEvent {
  return {
    type: "key down",
    gestureId,
    code: "KeyA",
    key: "a",
    keyCode: 65,
    modifiers: {
      alt: false,
      ctrl: false,
      meta: false,
      shift: false,
    },
    sourceEvent: null,
  };
}

function mouseLongPressReadyEvent(gestureId = "ready-1"): MouseLongPressReadyGestureEvent {
  return {
    type: "mouse-long-press-ready",
    gestureId,
    button: 0,
    buttons: 1,
    position: { x: 18, y: 28 },
    pointerEntity: entity("entity-ready"),
    modifiers: {
      alt: false,
      ctrl: false,
      meta: false,
      shift: false,
    },
    sourceEvent: null,
  };
}

function uiButtonMouseTapEvent(gestureId = "ui-button-1"): GestureEvent {
  return {
    type: "ui-button-mouse-tap",
    gestureId,
    uiButtonId: "utility-settings",
    button: 0,
    modifiers: {
      alt: false,
      ctrl: false,
      meta: false,
      shift: false,
    },
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

describe("GestureDiagnosticsStore", () => {
  it("records gesture events without consuming router dispatch", () => {
    const store = createGestureDiagnosticsStore();
    const module = createGestureDiagnosticsModule(store);
    const event = {
      ...mouseTapEvent(),
      pointerEntity: entity("entity-7"),
    } satisfies GestureEvent;

    const result = module.handle(event, {} as never);

    expect(result).toEqual({
      status: "handled",
      consume: false,
    });
    expect(store.getSnapshot().latestEvent).toMatchObject({
      type: "mouse tap",
      gestureId: "tap-1",
      position: { x: 12, y: 24 },
      pointerEntityId: "entity-7",
      detail: "button 0, direct, entity entity-7",
    });
  });

  it("exposes the diagnostics module as a global router observer", () => {
    const store = createGestureDiagnosticsStore();
    const module = createGestureDiagnosticsModule(store);

    expect(module.when).toBeUndefined();
    expect(module.id).toBe("gesture-diagnostics");
  });

  it("keeps a bounded event history and publishes keyboard snapshots", () => {
    const store = createGestureDiagnosticsStore();
    const snapshots: number[] = [];
    store.subscribe((snapshot) => {
      snapshots.push(snapshot.events.length);
    });

    for (let index = 0; index < 10; index += 1) {
      store.recordGesture(mouseTapEvent(`tap-${index}`));
    }
    store.setKeyboardSnapshot({
      pressedKeys: new Set(["KeyA"]),
      lastCode: "KeyA",
      lastKey: "a",
      lastKeyCode: 65,
      modifiers: {
        alt: false,
        ctrl: false,
        meta: false,
        shift: false,
      },
    });

    expect(store.getSnapshot().events).toHaveLength(8);
    expect(store.getSnapshot().latestEvent?.gestureId).toBe("tap-9");
    expect(store.getSnapshot().keyboard.pressedKeys.has("KeyA")).toBe(true);
    expect(snapshots.at(-1)).toBe(8);
  });

  it("formats key and semantic ui button events", () => {
    const store = createGestureDiagnosticsStore();

    store.recordGesture(keyDownEvent());
    store.recordGesture(uiButtonMouseTapEvent());

    expect(store.getSnapshot().events).toMatchObject([
      {
        type: "ui-button-mouse-tap",
        gestureId: "ui-button-1",
        position: null,
        delta: null,
        detail: "id utility-settings, button 0",
      },
      {
        type: "key down",
        gestureId: "key-1",
        position: null,
        delta: null,
        detail: "code KeyA, key a, keyCode 65",
      },
    ]);
  });

  it("formats long press ready events with pointer entity details", () => {
    const store = createGestureDiagnosticsStore();

    store.recordGesture(mouseLongPressReadyEvent());

    expect(store.getSnapshot().latestEvent).toMatchObject({
      type: "mouse-long-press-ready",
      gestureId: "ready-1",
      position: { x: 18, y: 28 },
      pointerEntityId: "entity-ready",
      detail: "button 0, buttons 1, ready, entity entity-ready",
    });
  });
});
