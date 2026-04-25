import { describe, expect, it } from "vitest";

import { createHypergryphGestureDiagnosticsModule } from "@/app/input/gesture-actions";
import {
  createGestureDiagnosticsStore,
} from "@/app/input/gesture-diagnostics";
import type { GestureEvent } from "@/app/input/gesture-adapter";

function mouseTapEvent(gestureId = "tap-1"): GestureEvent {
  return {
    type: "mouse tap",
    gestureId,
    button: 0,
    buttons: 0,
    position: { x: 12, y: 24 },
    longPress: false,
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

describe("GestureDiagnosticsStore", () => {
  it("records gesture events without consuming router dispatch", () => {
    const store = createGestureDiagnosticsStore();
    const module = createHypergryphGestureDiagnosticsModule(store);
    const event = mouseTapEvent();

    const result = module.handle(event, {} as never);

    expect(result).toEqual({
      status: "handled",
      consume: false,
    });
    expect(store.getSnapshot().latestEvent).toMatchObject({
      type: "mouse tap",
      gestureId: "tap-1",
      position: { x: 12, y: 24 },
      detail: "button 0, direct",
    });
  });

  it("only enables the diagnostics module while hypergryph operation mode is on", () => {
    const store = createGestureDiagnosticsStore();
    const module = createHypergryphGestureDiagnosticsModule(store);

    expect(module.when?.({
      workspace: {} as never,
      appHost: {
        state: {
          settings: {
            hypergryphOperationMode: true,
          },
        },
      } as never,
      keyboard: {
        pressedKeys: new Set<string>(),
        lastCode: null,
        lastKey: null,
        lastKeyCode: null,
        modifiers: {
          alt: false,
          ctrl: false,
          meta: false,
          shift: false,
        },
      },
    })).toBe(true);
    expect(module.when?.({
      workspace: {} as never,
      appHost: {
        state: {
          settings: {
            hypergryphOperationMode: false,
          },
        },
      } as never,
      keyboard: {
        pressedKeys: new Set<string>(),
        lastCode: null,
        lastKey: null,
        lastKeyCode: null,
        modifiers: {
          alt: false,
          ctrl: false,
          meta: false,
          shift: false,
        },
      },
    })).toBe(false);
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
});
