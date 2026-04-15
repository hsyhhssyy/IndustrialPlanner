import { describe, expect, it } from "vitest";
import { createCanvasGestureSession } from "@/app/app-shell/components/canvas-panel/canvas-panel-gesture-session";

describe("canvas panel gesture session", () => {
  it("emits pointer tap events without leaking drag state", () => {
    const session = createCanvasGestureSession();

    const down = session.handlePointerDown({
      button: 0,
      point: { x: 20, y: 24 },
      pointerId: 7,
      pointerType: "mouse",
      route: {
        kind: "primary",
        moveEntityId: null,
        marqueeSelectionMode: "replace",
      },
    });

    expect(down.events).toEqual([]);
    expect(down.pointerCaptureCommands).toEqual([
      {
        kind: "capture",
        pointerId: 7,
      },
    ]);

    const up = session.handlePointerUp({
      anchoredPlacementActive: false,
      button: 0,
      point: { x: 20, y: 24 },
      pointerId: 7,
      pointerType: "mouse",
    });

    expect(up.events).toEqual([
      {
        kind: "tap",
        source: "pointer",
        pointerId: 7,
        screenPoint: { x: 20, y: 24 },
        selectionModifierActive: false,
      },
    ]);
    expect(up.pointerCaptureCommands).toEqual([
      {
        kind: "release",
        pointerId: 7,
      },
    ]);
  });

  it("emits the pointer move drag lifecycle from the existing move recognizer", () => {
    const session = createCanvasGestureSession();

    const down = session.handlePointerDown({
      button: 0,
      point: { x: 10, y: 10 },
      pointerId: 11,
      pointerType: "mouse",
      route: {
        kind: "primary",
        moveEntityId: "filler-1",
        marqueeSelectionMode: null,
      },
    });

    expect(down.pointerCaptureCommands).toEqual([
      {
        kind: "capture",
        pointerId: 11,
      },
    ]);

    const beforeThreshold = session.handlePointerMove({
      buttons: 1,
      point: { x: 12, y: 12 },
      pointerId: 11,
      pointerType: "mouse",
    });

    expect(beforeThreshold.events).toEqual([]);

    const startDrag = session.handlePointerMove({
      buttons: 1,
      point: { x: 18, y: 15 },
      pointerId: 11,
      pointerType: "mouse",
    });

    expect(startDrag.events).toEqual([
      {
        kind: "drag-start",
        source: "pointer",
        recognizer: "pointer-move",
        pointerId: 11,
        origin: { x: 10, y: 10 },
        screenPoint: { x: 18, y: 15 },
        entityId: "filler-1",
      },
    ]);

    const continueDrag = session.handlePointerMove({
      buttons: 1,
      point: { x: 24, y: 20 },
      pointerId: 11,
      pointerType: "mouse",
    });

    expect(continueDrag.events).toEqual([
      {
        kind: "drag",
        source: "pointer",
        recognizer: "pointer-move",
        pointerId: 11,
        origin: { x: 10, y: 10 },
        screenPoint: { x: 24, y: 20 },
        entityId: "filler-1",
      },
    ]);

    const up = session.handlePointerUp({
      anchoredPlacementActive: false,
      button: 0,
      point: { x: 24, y: 20 },
      pointerId: 11,
      pointerType: "mouse",
    });

    expect(up.events).toEqual([
      {
        kind: "drag-end",
        source: "pointer",
        recognizer: "pointer-move",
        pointerId: 11,
        didDrag: true,
        outcome: "release",
        entityId: "filler-1",
      },
    ]);
    expect(up.pointerCaptureCommands).toEqual([
      {
        kind: "release",
        pointerId: 11,
      },
    ]);
  });

  it("emits the pointer marquee drag lifecycle from the marquee recognizer", () => {
    const session = createCanvasGestureSession();

    const down = session.handlePointerDown({
      button: 0,
      point: { x: 10, y: 10 },
      pointerId: 12,
      pointerType: "mouse",
      route: {
        kind: "primary",
        moveEntityId: null,
        marqueeSelectionMode: "toggle",
      },
    });

    expect(down.pointerCaptureCommands).toEqual([
      {
        kind: "capture",
        pointerId: 12,
      },
    ]);

    const beforeThreshold = session.handlePointerMove({
      buttons: 1,
      point: { x: 12, y: 12 },
      pointerId: 12,
      pointerType: "mouse",
    });

    expect(beforeThreshold.events).toEqual([]);

    const startDrag = session.handlePointerMove({
      buttons: 1,
      point: { x: 18, y: 15 },
      pointerId: 12,
      pointerType: "mouse",
    });

    expect(startDrag.events).toEqual([
      {
        kind: "drag-start",
        source: "pointer",
        recognizer: "pointer-marquee",
        pointerId: 12,
        origin: { x: 10, y: 10 },
        screenPoint: { x: 18, y: 15 },
        selectionMode: "toggle",
      },
    ]);

    const continueDrag = session.handlePointerMove({
      buttons: 1,
      point: { x: 24, y: 20 },
      pointerId: 12,
      pointerType: "mouse",
    });

    expect(continueDrag.events).toEqual([
      {
        kind: "drag",
        source: "pointer",
        recognizer: "pointer-marquee",
        pointerId: 12,
        origin: { x: 10, y: 10 },
        screenPoint: { x: 24, y: 20 },
        selectionMode: "toggle",
      },
    ]);

    const up = session.handlePointerUp({
      anchoredPlacementActive: false,
      button: 0,
      point: { x: 24, y: 20 },
      pointerId: 12,
      pointerType: "mouse",
    });

    expect(up.events).toEqual([
      {
        kind: "drag-end",
        source: "pointer",
        recognizer: "pointer-marquee",
        pointerId: 12,
        didDrag: true,
        outcome: "release",
        selectionMode: "toggle",
      },
    ]);
    expect(up.pointerCaptureCommands).toEqual([
      {
        kind: "release",
        pointerId: 12,
      },
    ]);
  });

  it("emits touch placement drag lifecycle and suppresses tap after dragging", () => {
    const session = createCanvasGestureSession();

    session.handlePointerDown({
      button: 0,
      point: { x: 30, y: 40 },
      pointerId: 21,
      pointerType: "touch",
      route: {
        kind: "placement-or-pan",
        anchoredPlacementHit: true,
      },
    });

    const startDrag = session.handlePointerMove({
      buttons: 0,
      point: { x: 38, y: 48 },
      pointerId: 21,
      pointerType: "touch",
    });

    expect(startDrag.events).toEqual([
      {
        kind: "drag-start",
        source: "touch",
        recognizer: "touch-placement",
        pointerId: 21,
        origin: { x: 30, y: 40 },
        screenPoint: { x: 38, y: 48 },
      },
    ]);

    const up = session.handlePointerUp({
      anchoredPlacementActive: true,
      button: 0,
      point: { x: 38, y: 48 },
      pointerId: 21,
      pointerType: "touch",
    });

    expect(up.events).toEqual([
      {
        kind: "drag-end",
        source: "touch",
        recognizer: "touch-placement",
        pointerId: 21,
        didDrag: true,
        outcome: "release",
      },
    ]);
  });

  it("switches two tracked touches into pinch events", () => {
    const session = createCanvasGestureSession();

    session.handlePointerDown({
      button: 0,
      point: { x: 10, y: 10 },
      pointerId: 1,
      pointerType: "touch",
      route: {
        kind: "gesture",
        interactionTarget: { kind: "blank" },
      },
    });
    session.handlePointerDown({
      button: 0,
      point: { x: 30, y: 10 },
      pointerId: 2,
      pointerType: "touch",
      route: {
        kind: "gesture",
        interactionTarget: { kind: "blank" },
      },
    });

    const pinch = session.handlePointerMove({
      buttons: 0,
      point: { x: 36, y: 16 },
      pointerId: 2,
      pointerType: "touch",
    });

    expect(pinch.events).toEqual([
      {
        kind: "pinch",
        source: "touch",
        midpointDelta: { x: 3, y: 3 },
        scaleFactor: Math.hypot(26, 6) / 20,
        zoomAnchor: { x: 20, y: 10 },
      },
    ]);
  });

  it("emits the touch marquee lifecycle once a blank hold is promoted into marquee mode", () => {
    const session = createCanvasGestureSession();

    session.handlePointerDown({
      button: 0,
      point: { x: 12, y: 14 },
      pointerId: 41,
      pointerType: "touch",
      route: {
        kind: "gesture",
        interactionTarget: { kind: "blank" },
        longPressMarqueeSelectionMode: "replace",
      },
    });

    const activated = session.handleTouchLongPress({ pointerId: 41 });

    expect(activated.events).toEqual([
      {
        kind: "drag-start",
        source: "touch",
        recognizer: "touch-marquee",
        pointerId: 41,
        origin: { x: 12, y: 14 },
        screenPoint: { x: 12, y: 14 },
        selectionMode: "replace",
      },
    ]);

    const drag = session.handlePointerMove({
      buttons: 0,
      point: { x: 32, y: 30 },
      pointerId: 41,
      pointerType: "touch",
    });

    expect(drag.events).toEqual([
      {
        kind: "drag",
        source: "touch",
        recognizer: "touch-marquee",
        pointerId: 41,
        origin: { x: 12, y: 14 },
        screenPoint: { x: 32, y: 30 },
        selectionMode: "replace",
      },
    ]);

    const up = session.handlePointerUp({
      anchoredPlacementActive: false,
      button: 0,
      point: { x: 32, y: 30 },
      pointerId: 41,
      pointerType: "touch",
    });

    expect(up.events).toEqual([
      {
        kind: "drag-end",
        source: "touch",
        recognizer: "touch-marquee",
        pointerId: 41,
        didDrag: true,
        outcome: "release",
        selectionMode: "replace",
      },
    ]);
  });

  it("cancels an active touch marquee when a second touch turns into pinch", () => {
    const session = createCanvasGestureSession();

    session.handlePointerDown({
      button: 0,
      point: { x: 12, y: 14 },
      pointerId: 51,
      pointerType: "touch",
      route: {
        kind: "gesture",
        interactionTarget: { kind: "blank" },
        longPressMarqueeSelectionMode: "replace",
      },
    });
    session.handleTouchLongPress({ pointerId: 51 });

    const secondTouch = session.handlePointerDown({
      button: 0,
      point: { x: 24, y: 14 },
      pointerId: 52,
      pointerType: "touch",
      route: {
        kind: "gesture",
        interactionTarget: { kind: "blank" },
      },
    });

    expect(secondTouch.events).toEqual([
      {
        kind: "drag-end",
        source: "touch",
        recognizer: "touch-marquee",
        pointerId: 51,
        didDrag: true,
        outcome: "cancel",
        selectionMode: "replace",
      },
    ]);
    expect(secondTouch.touchGestureState.phase).toBe("touch-pinching");
  });
});
