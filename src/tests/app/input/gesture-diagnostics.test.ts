import { describe, expect, it } from "vitest";

import {
  createGestureDiagnosticsModule,
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
    const module = createGestureDiagnosticsModule(store);
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
      detail: "button 0",
    });
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
});
