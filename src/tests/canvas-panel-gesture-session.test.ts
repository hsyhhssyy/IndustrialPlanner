import { describe, expect, it } from "vitest";
import { createCanvasGestureSession } from "@/app-shell/components/canvas-panel/canvas-panel-gesture-session";

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
      },
    });

    expect(down.events).toEqual([]);

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
});
