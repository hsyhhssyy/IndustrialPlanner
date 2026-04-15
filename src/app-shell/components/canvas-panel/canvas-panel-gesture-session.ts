import {
  advanceCanvasPointerMoveGesture,
  beginCanvasPointerMoveGesture,
  cancelCanvasPointerMoveGesture,
  createIdleCanvasPanelPointerMoveGestureState,
  removePointerFromCanvasPointerMoveGesture,
  type CanvasPanelPointerMoveGestureState,
} from "./canvas-panel-pointer-move-gesture";
import {
  advanceCanvasPointerMarqueeGesture,
  beginCanvasPointerMarqueeGesture,
  cancelCanvasPointerMarqueeGesture,
  createIdleCanvasPanelPointerMarqueeGestureState,
  removePointerFromCanvasPointerMarqueeGesture,
  type CanvasPanelPointerMarqueeGestureState,
} from "./canvas-panel-pointer-marquee-gesture";
import {
  advanceCanvasPointerPanGesture,
  beginCanvasPointerPanGesture,
  cancelCanvasPanelPointerGesture,
  createIdleCanvasPanelPointerGestureState,
  type CanvasPanelPointerGestureState,
} from "./canvas-panel-pointer-gesture";
import {
  advanceCanvasPointerTapGesture,
  beginCanvasPointerTapGesture,
  createIdleCanvasPanelPointerTapGestureState,
  removePointerFromCanvasPointerTapGesture,
  shouldDispatchCanvasPointerTap,
  type CanvasPanelPointerTapGestureState,
} from "./canvas-panel-pointer-tap-gesture";
import {
  advanceCanvasTouchDragGesture,
  beginCanvasTouchDragGesture,
  cancelCanvasTouchDragGesture,
  createIdleCanvasPanelTouchDragGestureState,
  removePointerFromCanvasTouchDragGesture,
  type CanvasPanelTouchDragGestureState,
} from "./canvas-panel-touch-drag-gesture";
import {
  advanceCanvasTouchMarqueeGesture,
  beginCanvasTouchMarqueeGesture,
  cancelCanvasTouchMarqueeGesture,
  createIdleCanvasPanelTouchMarqueeGestureState,
  removePointerFromCanvasTouchMarqueeGesture,
  type CanvasPanelTouchMarqueeGestureState,
} from "./canvas-panel-touch-marquee-gesture";
import {
  advanceCanvasTouchPlacementGesture,
  beginCanvasTouchPlacementGesture,
  cancelCanvasTouchPlacementGesture,
  createIdleCanvasPanelTouchPlacementGestureState,
  removePointerFromCanvasTouchPlacementGesture,
  shouldDispatchCanvasTouchTap,
  type CanvasPanelTouchPlacementGestureState,
} from "./canvas-panel-touch-placement-gesture";
import {
  advanceCanvasTouchPanGesture,
  advanceCanvasTouchPinchGesture,
  beginCanvasTouchGesture,
  beginCanvasTouchPanGesture,
  beginCanvasTouchPinchGesture,
  cancelCanvasTouchGesture,
  createIdleCanvasPanelTouchGestureState,
  removePointerFromCanvasTouchGesture,
  type CanvasPanelTouchGestureState,
} from "./canvas-panel-touch-gesture";
import type { EditorSelectionUpdateMode } from "@/editor/contracts/selection";
import type { PlacementInteractionMode } from "@/editor/contracts/placement-preview";
import type { CanvasInteractionTarget } from "@/workbench/contracts/workbench-facade";
import type { CanvasPoint } from "@/workspace/workspace-state";

export type CanvasGestureDragRecognizer =
  | "pointer-move"
  | "pointer-marquee"
  | "touch-marquee"
  | "touch-move"
  | "touch-placement";

export type CanvasGestureEvent =
  | {
      kind: "tap";
      source: PlacementInteractionMode;
      pointerId: number;
      screenPoint: CanvasPoint;
      selectionModifierActive: boolean;
    }
  | {
      kind: "hover";
      source: "pointer";
      pointerId: number;
      screenPoint: CanvasPoint;
    }
  | {
      kind: "drag-start";
      source: PlacementInteractionMode;
      recognizer: CanvasGestureDragRecognizer;
      pointerId: number;
      origin: CanvasPoint;
      screenPoint: CanvasPoint;
      entityId?: string;
      selectionMode?: EditorSelectionUpdateMode;
    }
  | {
      kind: "drag";
      source: PlacementInteractionMode;
      recognizer: CanvasGestureDragRecognizer;
      pointerId: number;
      origin: CanvasPoint;
      screenPoint: CanvasPoint;
      entityId?: string;
      selectionMode?: EditorSelectionUpdateMode;
    }
  | {
      kind: "drag-end";
      source: PlacementInteractionMode;
      recognizer: CanvasGestureDragRecognizer;
      pointerId: number;
      didDrag: boolean;
      outcome: "release" | "cancel";
      entityId?: string;
      selectionMode?: EditorSelectionUpdateMode;
    }
  | {
      kind: "pan-start";
      source: PlacementInteractionMode;
      pointerId: number;
      screenDelta: CanvasPoint;
    }
  | {
      kind: "pan";
      source: PlacementInteractionMode;
      pointerId: number;
      screenDelta: CanvasPoint;
    }
  | {
      kind: "pan-end";
      source: PlacementInteractionMode;
      pointerId: number;
      outcome: "release" | "cancel";
    }
  | {
      kind: "pinch";
      source: "touch";
      midpointDelta: CanvasPoint | null;
      scaleFactor: number | null;
      zoomAnchor: CanvasPoint | null;
    }
  | {
      kind: "secondary-action";
      source: "pointer";
      pointerId: number;
      screenPoint: CanvasPoint;
    }
  | {
      kind: "clear-preview";
      source: PlacementInteractionMode;
      reason:
        | "touch-down"
        | "pointer-pan"
        | "pointer-reset"
        | "touch-reset"
        | "all-reset";
    };

export type CanvasPointerDownRoute =
  | {
      kind: "primary";
      moveEntityId: string | null;
      marqueeSelectionMode?: EditorSelectionUpdateMode | null;
    }
  | {
      kind: "secondary";
    }
  | {
      kind: "pan";
    }
  | {
      kind: "ignore";
    };

export type CanvasTouchDownRoute =
  | {
      kind: "move";
    }
  | {
      kind: "placement-or-pan";
      anchoredPlacementHit: boolean;
    }
  | {
      kind: "gesture";
      interactionTarget: CanvasInteractionTarget;
      longPressMarqueeSelectionMode?: EditorSelectionUpdateMode | null;
    };

export type CanvasGesturePointerCaptureCommand =
  | {
      kind: "capture";
      pointerId: number;
    }
  | {
      kind: "release";
      pointerId: number;
    };

export interface CanvasGestureSessionResult {
  events: readonly CanvasGestureEvent[];
  pointerCaptureCommands: readonly CanvasGesturePointerCaptureCommand[];
  pointerGestureState: CanvasPanelPointerGestureState;
  touchGestureState: CanvasPanelTouchGestureState;
}

export interface CanvasGestureSessionSnapshot {
  pointerGestureState: CanvasPanelPointerGestureState;
  touchGestureState: CanvasPanelTouchGestureState;
}

export interface CanvasGestureSessionPointerDownInput {
  button: number;
  selectionModifierActive?: boolean;
  point: CanvasPoint;
  pointerId: number;
  pointerType: string;
  route: CanvasPointerDownRoute | CanvasTouchDownRoute;
}

export interface CanvasGestureSessionPointerMoveInput {
  buttons: number;
  point: CanvasPoint;
  pointerId: number;
  pointerType: string;
}

export interface CanvasGestureSessionPointerEnterInput {
  buttons: number;
  point: CanvasPoint;
  pointerId: number;
  pointerType: string;
}

export interface CanvasGestureSessionPointerLeaveInput {
  buttons: number;
  pointerId: number;
  pointerType: string;
}

export interface CanvasGestureSessionPointerUpInput {
  anchoredPlacementActive: boolean;
  button: number;
  selectionModifierActive?: boolean;
  point: CanvasPoint;
  pointerId: number;
  pointerType: string;
}

export interface CanvasGestureSessionLostPointerCaptureInput {
  pointerId: number;
  pointerType: string;
}

export interface CanvasGestureSession {
  getSnapshot: () => CanvasGestureSessionSnapshot;
  getPointerCapturePointerIds: () => readonly number[];
  getTouchCapturePointerIds: () => readonly number[];
  handlePointerDown: (
    input: CanvasGestureSessionPointerDownInput,
  ) => CanvasGestureSessionResult;
  handlePointerMove: (
    input: CanvasGestureSessionPointerMoveInput,
  ) => CanvasGestureSessionResult;
  handleTouchLongPress: (input: { pointerId: number }) => CanvasGestureSessionResult;
  handlePointerEnter: (
    input: CanvasGestureSessionPointerEnterInput,
  ) => CanvasGestureSessionResult;
  handlePointerLeave: (
    input: CanvasGestureSessionPointerLeaveInput,
  ) => CanvasGestureSessionResult;
  handlePointerUp: (
    input: CanvasGestureSessionPointerUpInput,
  ) => CanvasGestureSessionResult;
  handleLostPointerCapture: (
    input: CanvasGestureSessionLostPointerCaptureInput,
  ) => CanvasGestureSessionResult;
  resetPointer: () => CanvasGestureSessionResult;
  resetTouch: () => CanvasGestureSessionResult;
  resetAll: () => CanvasGestureSessionResult;
}

function createResult(
  state: {
    pointerGestureState: CanvasPanelPointerGestureState;
    touchGestureState: CanvasPanelTouchGestureState;
  },
  events: readonly CanvasGestureEvent[] = [],
  pointerCaptureCommands: readonly CanvasGesturePointerCaptureCommand[] = [],
): CanvasGestureSessionResult {
  return {
    events,
    pointerCaptureCommands,
    pointerGestureState: state.pointerGestureState,
    touchGestureState: state.touchGestureState,
  };
}

export function createCanvasGestureSession(): CanvasGestureSession {
  let touchPoints = new Map<number, CanvasPoint>();
  let touchMoveGestureState: CanvasPanelTouchDragGestureState =
    createIdleCanvasPanelTouchDragGestureState();
  let touchMarqueeGestureState: CanvasPanelTouchMarqueeGestureState =
    createIdleCanvasPanelTouchMarqueeGestureState();
  let touchPlacementGestureState: CanvasPanelTouchPlacementGestureState =
    createIdleCanvasPanelTouchPlacementGestureState();
  let touchTapSuppressed = false;
  let pointerTapGestureState: CanvasPanelPointerTapGestureState =
    createIdleCanvasPanelPointerTapGestureState();
  let pointerMoveGestureState: CanvasPanelPointerMoveGestureState =
    createIdleCanvasPanelPointerMoveGestureState();
  let pointerMarqueeGestureState: CanvasPanelPointerMarqueeGestureState =
    createIdleCanvasPanelPointerMarqueeGestureState();
  let pointerGestureState: CanvasPanelPointerGestureState =
    createIdleCanvasPanelPointerGestureState();
  let touchGestureState: CanvasPanelTouchGestureState =
    createIdleCanvasPanelTouchGestureState();

  const getSnapshot = (): CanvasGestureSessionSnapshot => ({
    pointerGestureState,
    touchGestureState,
  });

  const getPointerCapturePointerIds = (): readonly number[] => {
    const pointerIds = new Set<number>();

    if (pointerGestureState.phase !== "idle") {
      pointerIds.add(pointerGestureState.pointerId);
    }

    if (pointerMoveGestureState.phase !== "idle") {
      pointerIds.add(pointerMoveGestureState.pointerId);
    }

    if (pointerMarqueeGestureState.phase !== "idle") {
      pointerIds.add(pointerMarqueeGestureState.pointerId);
    }

    return Array.from(pointerIds);
  };

  const getTouchCapturePointerIds = (): readonly number[] =>
    Array.from(touchPoints.keys());

  const beginTouchPinchFromTrackedPoints = (): readonly CanvasGestureEvent[] => {
    const [firstPointer, secondPointer] = Array.from(touchPoints.entries());
    const events: CanvasGestureEvent[] = [];

    touchTapSuppressed = true;
    touchMoveGestureState = cancelCanvasTouchDragGesture();
    if (touchMarqueeGestureState.phase === "touch-marquee-selecting") {
      events.push({
        kind: "drag-end",
        source: "touch",
        recognizer: "touch-marquee",
        pointerId: touchMarqueeGestureState.pointerId,
        didDrag: true,
        outcome: "cancel",
        selectionMode: touchMarqueeGestureState.selectionMode,
      });
    }
    touchMarqueeGestureState = cancelCanvasTouchMarqueeGesture();
    touchPlacementGestureState = cancelCanvasTouchPlacementGesture();

    if (!firstPointer || !secondPointer) {
      touchGestureState = createIdleCanvasPanelTouchGestureState();
      return events;
    }

    touchGestureState = beginCanvasTouchPinchGesture(
      firstPointer[0],
      firstPointer[1],
      secondPointer[0],
      secondPointer[1],
    );
    return events;
  };

  const handlePointerDown = (
    input: CanvasGestureSessionPointerDownInput,
  ): CanvasGestureSessionResult => {
    if (input.pointerType === "touch") {
      touchPoints.set(input.pointerId, input.point);

      if (touchPoints.size >= 2) {
        const events = beginTouchPinchFromTrackedPoints();

        return createResult(
          {
            pointerGestureState,
            touchGestureState,
          },
          events,
          [{ kind: "capture", pointerId: input.pointerId }],
        );
      }

      const route = input.route as CanvasTouchDownRoute;
      const events: CanvasGestureEvent[] = [];

      switch (route.kind) {
        case "move":
          touchMoveGestureState = beginCanvasTouchDragGesture(
            input.pointerId,
            input.point,
          );
          touchGestureState = createIdleCanvasPanelTouchGestureState();
          events.push({
            kind: "clear-preview",
            source: "touch",
            reason: "touch-down",
          });
          break;
        case "placement-or-pan":
          if (route.anchoredPlacementHit) {
            touchPlacementGestureState = beginCanvasTouchPlacementGesture(
              input.pointerId,
              input.point,
            );
            touchGestureState = createIdleCanvasPanelTouchGestureState();
          } else {
            touchPlacementGestureState = cancelCanvasTouchPlacementGesture();
            touchGestureState = beginCanvasTouchPanGesture(
              input.pointerId,
              input.point,
            );
          }
          break;
        case "gesture":
          touchGestureState = beginCanvasTouchGesture(
            input.pointerId,
            input.point,
            route.interactionTarget,
            route.longPressMarqueeSelectionMode ?? null,
          );
          events.push({
            kind: "clear-preview",
            source: "touch",
            reason: "touch-down",
          });
          break;
      }

      return createResult(
        {
          pointerGestureState,
          touchGestureState,
        },
        events,
        [{ kind: "capture", pointerId: input.pointerId }],
      );
    }

    const route = input.route as CanvasPointerDownRoute;

    switch (route.kind) {
      case "primary":
        pointerTapGestureState = beginCanvasPointerTapGesture(
          input.pointerId,
          input.point,
        );

        if (route.moveEntityId) {
          pointerMoveGestureState = beginCanvasPointerMoveGesture(
            input.pointerId,
            route.moveEntityId,
            input.point,
          );

          return createResult(
            {
              pointerGestureState,
              touchGestureState,
            },
            [],
            [{ kind: "capture", pointerId: input.pointerId }],
          );
        }

        if (route.marqueeSelectionMode) {
          pointerMarqueeGestureState = beginCanvasPointerMarqueeGesture(
            input.pointerId,
            input.point,
            route.marqueeSelectionMode,
          );

          return createResult(
            {
              pointerGestureState,
              touchGestureState,
            },
            [],
            [{ kind: "capture", pointerId: input.pointerId }],
          );
        }

        pointerMoveGestureState = cancelCanvasPointerMoveGesture();
        pointerMarqueeGestureState = cancelCanvasPointerMarqueeGesture();
        return createResult({
          pointerGestureState,
          touchGestureState,
        });
      case "secondary":
        return createResult(
          {
            pointerGestureState,
            touchGestureState,
          },
          [
            {
              kind: "secondary-action",
              source: "pointer",
              pointerId: input.pointerId,
              screenPoint: input.point,
            },
          ],
        );
      case "pan":
        pointerGestureState = beginCanvasPointerPanGesture(
          input.pointerId,
          input.point,
        );
        return createResult(
          {
            pointerGestureState,
            touchGestureState,
          },
          [
            {
              kind: "clear-preview",
              source: "pointer",
              reason: "pointer-pan",
            },
          ],
          [{ kind: "capture", pointerId: input.pointerId }],
        );
      case "ignore":
        return createResult({
          pointerGestureState,
          touchGestureState,
        });
    }
  };

  const handlePointerMove = (
    input: CanvasGestureSessionPointerMoveInput,
  ): CanvasGestureSessionResult => {
    if (input.pointerType === "touch") {
      touchPoints.set(input.pointerId, input.point);

      if (touchMoveGestureState.phase !== "idle") {
        if (touchPoints.size !== 1) {
          return createResult({
            pointerGestureState,
            touchGestureState,
          });
        }

        const previousState = touchMoveGestureState;
        const result = advanceCanvasTouchDragGesture(
          previousState,
          input.pointerId,
          input.point,
        );

        touchMoveGestureState = result.nextState;

        if (!result.dragPoint) {
          return createResult({
            pointerGestureState,
            touchGestureState,
          });
        }

        touchTapSuppressed = true;
        return createResult(
          {
            pointerGestureState,
            touchGestureState,
          },
          [
            result.didStartDragging
              ? {
                  kind: "drag-start",
                  source: "touch",
                  recognizer: "touch-move",
                  pointerId: input.pointerId,
                  origin: previousState.origin,
                  screenPoint: result.dragPoint,
                }
              : {
                  kind: "drag",
                  source: "touch",
                  recognizer: "touch-move",
                  pointerId: input.pointerId,
                  origin: previousState.origin,
                  screenPoint: result.dragPoint,
                },
          ],
        );
      }

      if (touchMarqueeGestureState.phase !== "idle") {
        if (touchPoints.size !== 1) {
          return createResult({
            pointerGestureState,
            touchGestureState,
          });
        }

        const previousState = touchMarqueeGestureState;
        const result = advanceCanvasTouchMarqueeGesture(
          previousState,
          input.pointerId,
          input.point,
        );

        touchMarqueeGestureState = result.nextState;

        if (!result.dragPoint) {
          return createResult({
            pointerGestureState,
            touchGestureState,
          });
        }

        return createResult(
          {
            pointerGestureState,
            touchGestureState,
          },
          [
            {
              kind: "drag",
              source: "touch",
              recognizer: "touch-marquee",
              pointerId: input.pointerId,
              origin: previousState.origin,
              screenPoint: result.dragPoint,
              selectionMode: previousState.selectionMode,
            },
          ],
        );
      }

      if (touchPlacementGestureState.phase !== "idle") {
        if (touchPoints.size !== 1) {
          return createResult({
            pointerGestureState,
            touchGestureState,
          });
        }

        const previousState = touchPlacementGestureState;
        const result = advanceCanvasTouchPlacementGesture(
          previousState,
          input.pointerId,
          input.point,
        );

        touchPlacementGestureState = result.nextState;

        if (!result.previewPoint) {
          return createResult({
            pointerGestureState,
            touchGestureState,
          });
        }

        touchTapSuppressed = true;
        return createResult(
          {
            pointerGestureState,
            touchGestureState,
          },
          [
            previousState.phase === "touch-placement-pressed"
              ? {
                  kind: "drag-start",
                  source: "touch",
                  recognizer: "touch-placement",
                  pointerId: input.pointerId,
                  origin: previousState.origin,
                  screenPoint: result.previewPoint,
                }
              : {
                  kind: "drag",
                  source: "touch",
                  recognizer: "touch-placement",
                  pointerId: input.pointerId,
                  origin: previousState.origin,
                  screenPoint: result.previewPoint,
                },
          ],
        );
      }

      if (touchGestureState.phase === "touch-pinching") {
        const result = advanceCanvasTouchPinchGesture(
          touchGestureState,
          input.pointerId,
          input.point,
        );

        touchGestureState = result.nextState;

        if (result.scaleFactor || result.midpointDelta) {
          touchTapSuppressed = true;
        }

        return createResult(
          {
            pointerGestureState,
            touchGestureState,
          },
          [
            {
              kind: "pinch",
              source: "touch",
              midpointDelta: result.midpointDelta,
              scaleFactor: result.scaleFactor,
              zoomAnchor: result.zoomAnchor,
            },
          ],
        );
      }

      const previousState = touchGestureState;
      const result = advanceCanvasTouchPanGesture(
        previousState,
        input.pointerId,
        input.point,
      );

      touchGestureState = result.nextState;

      if (!result.screenDelta) {
        return createResult({
          pointerGestureState,
          touchGestureState,
        });
      }

      touchTapSuppressed = true;
      return createResult(
        {
          pointerGestureState,
          touchGestureState,
        },
        [
          previousState.phase === "touch-pan-pressed"
            ? {
                kind: "pan-start",
                source: "touch",
                pointerId: input.pointerId,
                screenDelta: result.screenDelta,
              }
            : {
                kind: "pan",
                source: "touch",
                pointerId: input.pointerId,
                screenDelta: result.screenDelta,
              },
        ],
      );
    }

    pointerTapGestureState = advanceCanvasPointerTapGesture(
      pointerTapGestureState,
      input.pointerId,
      input.point,
    );

    if (pointerMoveGestureState.phase !== "idle") {
      const previousState = pointerMoveGestureState;
      const result = advanceCanvasPointerMoveGesture(
        previousState,
        input.pointerId,
        input.point,
      );

      pointerMoveGestureState = result.nextState;

      if (!result.dragPoint) {
        return createResult({
          pointerGestureState,
          touchGestureState,
        });
      }

      return createResult(
        {
          pointerGestureState,
          touchGestureState,
        },
        [
          result.didStartDragging
            ? {
                kind: "drag-start",
                source: "pointer",
                recognizer: "pointer-move",
                pointerId: input.pointerId,
                origin: previousState.origin,
                screenPoint: result.dragPoint,
                entityId: previousState.entityId,
              }
            : {
                kind: "drag",
                source: "pointer",
                recognizer: "pointer-move",
                pointerId: input.pointerId,
                origin: previousState.origin,
                screenPoint: result.dragPoint,
                entityId: previousState.entityId,
              },
        ],
      );
    }

    if (pointerMarqueeGestureState.phase !== "idle") {
      const previousState = pointerMarqueeGestureState;
      const result = advanceCanvasPointerMarqueeGesture(
        previousState,
        input.pointerId,
        input.point,
      );

      pointerMarqueeGestureState = result.nextState;

      if (!result.dragPoint) {
        return createResult({
          pointerGestureState,
          touchGestureState,
        });
      }

      return createResult(
        {
          pointerGestureState,
          touchGestureState,
        },
        [
          result.didStartDragging
            ? {
                kind: "drag-start",
                source: "pointer",
                recognizer: "pointer-marquee",
                pointerId: input.pointerId,
                origin: previousState.origin,
                screenPoint: result.dragPoint,
                selectionMode: previousState.selectionMode,
              }
            : {
                kind: "drag",
                source: "pointer",
                recognizer: "pointer-marquee",
                pointerId: input.pointerId,
                origin: previousState.origin,
                screenPoint: result.dragPoint,
                selectionMode: previousState.selectionMode,
              },
        ],
      );
    }

    if (pointerGestureState.phase === "idle" && input.buttons === 0) {
      return createResult(
        {
          pointerGestureState,
          touchGestureState,
        },
        [
          {
            kind: "hover",
            source: "pointer",
            pointerId: input.pointerId,
            screenPoint: input.point,
          },
        ],
      );
    }

    const previousState = pointerGestureState;
    const result = advanceCanvasPointerPanGesture(
      previousState,
      input.pointerId,
      input.point,
    );

    pointerGestureState = result.nextState;

    if (!result.screenDelta) {
      return createResult({
        pointerGestureState,
        touchGestureState,
      });
    }

    return createResult(
      {
        pointerGestureState,
        touchGestureState,
      },
      [
        previousState.phase === "pan-pressed"
          ? {
              kind: "pan-start",
              source: "pointer",
              pointerId: input.pointerId,
              screenDelta: result.screenDelta,
            }
          : {
              kind: "pan",
              source: "pointer",
              pointerId: input.pointerId,
              screenDelta: result.screenDelta,
            },
      ],
    );
  };

  const handlePointerEnter = (
    input: CanvasGestureSessionPointerEnterInput,
  ): CanvasGestureSessionResult => {
    if (
      input.pointerType === "touch" ||
      pointerGestureState.phase !== "idle" ||
      input.buttons !== 0
    ) {
      return createResult({
        pointerGestureState,
        touchGestureState,
      });
    }

    return createResult(
      {
        pointerGestureState,
        touchGestureState,
      },
      [
        {
          kind: "hover",
          source: "pointer",
          pointerId: input.pointerId,
          screenPoint: input.point,
        },
      ],
    );
  };

  const handleTouchLongPress = (
    input: { pointerId: number },
  ): CanvasGestureSessionResult => {
    if (
      touchPoints.size !== 1 ||
      touchGestureState.phase !== "touch-pan-pressed" ||
      touchGestureState.pointerId !== input.pointerId ||
      touchGestureState.longPressMarqueeSelectionMode === null
    ) {
      return createResult({
        pointerGestureState,
        touchGestureState,
      });
    }

    const pendingHoldState = touchGestureState;
    const selectionMode = pendingHoldState.longPressMarqueeSelectionMode;

    if (selectionMode === null) {
      return createResult({
        pointerGestureState,
        touchGestureState,
      });
    }

    touchTapSuppressed = true;
    const activeTouchMarquee = beginCanvasTouchMarqueeGesture(
      input.pointerId,
      pendingHoldState.origin,
      selectionMode,
    );
    touchMarqueeGestureState = activeTouchMarquee;
    touchGestureState = createIdleCanvasPanelTouchGestureState();

    return createResult(
      {
        pointerGestureState,
        touchGestureState,
      },
      [
        {
          kind: "drag-start",
          source: "touch",
          recognizer: "touch-marquee",
          pointerId: input.pointerId,
          origin: activeTouchMarquee.origin,
          screenPoint: activeTouchMarquee.origin,
          selectionMode: activeTouchMarquee.selectionMode,
        },
      ],
    );
  };

  const handlePointerLeave = (
    input: CanvasGestureSessionPointerLeaveInput,
  ): CanvasGestureSessionResult => {
    if (input.pointerType !== "touch" && input.buttons !== 0) {
      pointerTapGestureState = removePointerFromCanvasPointerTapGesture(
        pointerTapGestureState,
        input.pointerId,
      );
    }

    return createResult({
      pointerGestureState,
      touchGestureState,
    });
  };

  const handlePointerUp = (
    input: CanvasGestureSessionPointerUpInput,
  ): CanvasGestureSessionResult => {
    if (input.pointerType === "touch") {
      const events: CanvasGestureEvent[] = [];
      const touchMoveState = touchMoveGestureState;
      const touchPlacementState = touchPlacementGestureState;
      const touchViewportState = touchGestureState;
      const shouldHandleTap = shouldDispatchCanvasTouchTap({
        activeTouchCount: touchPoints.size,
        anchoredPlacementActive: input.anchoredPlacementActive,
        placementGestureState: touchPlacementState,
        tapSuppressed: touchTapSuppressed,
        touchGestureState,
      });

      if (
        touchMarqueeGestureState.phase === "touch-marquee-selecting" &&
        touchMarqueeGestureState.pointerId === input.pointerId
      ) {
        events.push({
          kind: "drag-end",
          source: "touch",
          recognizer: "touch-marquee",
          pointerId: input.pointerId,
          didDrag: true,
          outcome: "release",
          selectionMode: touchMarqueeGestureState.selectionMode,
        });
      }

      if (
        touchMoveState.phase === "touch-dragging" &&
        touchMoveState.pointerId === input.pointerId
      ) {
        events.push({
          kind: "drag-end",
          source: "touch",
          recognizer: "touch-move",
          pointerId: input.pointerId,
          didDrag: true,
          outcome: "release",
        });
      }

      if (
        touchPlacementState.phase === "touch-placement-dragging" &&
        touchPlacementState.pointerId === input.pointerId
      ) {
        events.push({
          kind: "drag-end",
          source: "touch",
          recognizer: "touch-placement",
          pointerId: input.pointerId,
          didDrag: true,
          outcome: "release",
        });
      }

      if (
        touchViewportState.phase !== "idle" &&
        touchViewportState.phase !== "touch-pinching" &&
        touchViewportState.pointerId === input.pointerId
      ) {
        events.push({
          kind: "pan-end",
          source: "touch",
          pointerId: input.pointerId,
          outcome: "release",
        });
      }

      if (shouldHandleTap) {
        events.push({
          kind: "tap",
          source: "touch",
          pointerId: input.pointerId,
          screenPoint: input.point,
          selectionModifierActive: false,
        });
      }

      touchPoints.delete(input.pointerId);
      touchMoveGestureState = removePointerFromCanvasTouchDragGesture(
        touchMoveGestureState,
        input.pointerId,
      );
      touchMarqueeGestureState = removePointerFromCanvasTouchMarqueeGesture(
        touchMarqueeGestureState,
        input.pointerId,
      );
      touchPlacementGestureState = removePointerFromCanvasTouchPlacementGesture(
        touchPlacementGestureState,
        input.pointerId,
      );

      if (touchPoints.size === 0) {
        touchTapSuppressed = false;
      }

      touchGestureState = removePointerFromCanvasTouchGesture(
        touchGestureState,
        input.pointerId,
      );

      return createResult({
        pointerGestureState,
        touchGestureState,
      }, events);
    }

    const events: CanvasGestureEvent[] = [];
    const pointerCaptureCommands: CanvasGesturePointerCaptureCommand[] = [];

    if (input.button === 0) {
      const pointerMoveState = pointerMoveGestureState;
      const pointerMarqueeState = pointerMarqueeGestureState;
      const didDragMove =
        pointerMoveState.phase === "move-dragging" &&
        pointerMoveState.pointerId === input.pointerId;
      const didDragMarquee =
        pointerMarqueeState.phase === "marquee-dragging" &&
        pointerMarqueeState.pointerId === input.pointerId;

      if (
        pointerMoveState.phase !== "idle" &&
        pointerMoveState.pointerId === input.pointerId
      ) {
        pointerCaptureCommands.push({
          kind: "release",
          pointerId: input.pointerId,
        });
      } else if (
        pointerMarqueeState.phase !== "idle" &&
        pointerMarqueeState.pointerId === input.pointerId
      ) {
        pointerCaptureCommands.push({
          kind: "release",
          pointerId: input.pointerId,
        });
      }

      pointerMoveGestureState = removePointerFromCanvasPointerMoveGesture(
        pointerMoveState,
        input.pointerId,
      );
      pointerMarqueeGestureState = removePointerFromCanvasPointerMarqueeGesture(
        pointerMarqueeState,
        input.pointerId,
      );

      if (didDragMove) {
        events.push({
          kind: "drag-end",
          source: "pointer",
          recognizer: "pointer-move",
          pointerId: input.pointerId,
          didDrag: true,
          outcome: "release",
          entityId: pointerMoveState.entityId,
        });
      } else if (didDragMarquee) {
        events.push({
          kind: "drag-end",
          source: "pointer",
          recognizer: "pointer-marquee",
          pointerId: input.pointerId,
          didDrag: true,
          outcome: "release",
          selectionMode: pointerMarqueeState.selectionMode,
        });
      } else if (
        shouldDispatchCanvasPointerTap(pointerTapGestureState, input.pointerId)
      ) {
        events.push({
          kind: "tap",
          source: "pointer",
          pointerId: input.pointerId,
          screenPoint: input.point,
          selectionModifierActive: input.selectionModifierActive ?? false,
        });
      }

      pointerTapGestureState = removePointerFromCanvasPointerTapGesture(
        pointerTapGestureState,
        input.pointerId,
      );

      return createResult(
        {
          pointerGestureState,
          touchGestureState,
        },
        events,
        pointerCaptureCommands,
      );
    }

    if (
      pointerGestureState.phase !== "idle" &&
      pointerGestureState.pointerId === input.pointerId
    ) {
      events.push({
        kind: "pan-end",
        source: "pointer",
        pointerId: input.pointerId,
        outcome: "release",
      });
      pointerCaptureCommands.push({
        kind: "release",
        pointerId: input.pointerId,
      });
      pointerGestureState = cancelCanvasPanelPointerGesture();
    }

    return createResult(
      {
        pointerGestureState,
        touchGestureState,
      },
      events,
      pointerCaptureCommands,
    );
  };

  const handleLostPointerCapture = (
    input: CanvasGestureSessionLostPointerCaptureInput,
  ): CanvasGestureSessionResult => {
    if (input.pointerType === "touch") {
      const touchMarqueeState = touchMarqueeGestureState;
      const events: CanvasGestureEvent[] = [];

      touchPoints.delete(input.pointerId);
      touchMoveGestureState = removePointerFromCanvasTouchDragGesture(
        touchMoveGestureState,
        input.pointerId,
      );
      if (
        touchMarqueeState.phase === "touch-marquee-selecting" &&
        touchMarqueeState.pointerId === input.pointerId
      ) {
        events.push({
          kind: "drag-end",
          source: "touch",
          recognizer: "touch-marquee",
          pointerId: input.pointerId,
          didDrag: true,
          outcome: "cancel",
          selectionMode: touchMarqueeState.selectionMode,
        });
      }
      touchMarqueeGestureState = removePointerFromCanvasTouchMarqueeGesture(
        touchMarqueeGestureState,
        input.pointerId,
      );
      touchPlacementGestureState = removePointerFromCanvasTouchPlacementGesture(
        touchPlacementGestureState,
        input.pointerId,
      );

      if (touchPoints.size === 0) {
        touchTapSuppressed = false;
      }

      touchGestureState = removePointerFromCanvasTouchGesture(
        touchGestureState,
        input.pointerId,
      );

      return createResult(
        {
          pointerGestureState,
          touchGestureState,
        },
        events,
      );
    }

    const hadPointerPan =
      pointerGestureState.phase !== "idle" &&
      pointerGestureState.pointerId === input.pointerId;
    const pointerMoveState = pointerMoveGestureState;
    const pointerMarqueeState = pointerMarqueeGestureState;
    const hadPointerMove =
      pointerMoveState.phase !== "idle" &&
      pointerMoveState.pointerId === input.pointerId;
    const hadPointerMarquee =
      pointerMarqueeState.phase !== "idle" &&
      pointerMarqueeState.pointerId === input.pointerId;
    const events: CanvasGestureEvent[] = [];

    pointerTapGestureState = removePointerFromCanvasPointerTapGesture(
      pointerTapGestureState,
      input.pointerId,
    );

    if (
      pointerMoveState.phase !== "idle" &&
      pointerMoveState.pointerId === input.pointerId
    ) {
      pointerMoveGestureState = removePointerFromCanvasPointerMoveGesture(
        pointerMoveState,
        input.pointerId,
      );
    }

    if (
      pointerMarqueeState.phase !== "idle" &&
      pointerMarqueeState.pointerId === input.pointerId
    ) {
      pointerMarqueeGestureState = removePointerFromCanvasPointerMarqueeGesture(
        pointerMarqueeState,
        input.pointerId,
      );
    }

    if (hadPointerMove && pointerMoveState.phase === "move-dragging") {
      events.push({
        kind: "drag-end",
        source: "pointer",
        recognizer: "pointer-move",
        pointerId: input.pointerId,
        didDrag: true,
        outcome: "cancel",
        entityId: pointerMoveState.entityId,
      });
    }

    if (hadPointerMarquee && pointerMarqueeState.phase === "marquee-dragging") {
      events.push({
        kind: "drag-end",
        source: "pointer",
        recognizer: "pointer-marquee",
        pointerId: input.pointerId,
        didDrag: true,
        outcome: "cancel",
        selectionMode: pointerMarqueeState.selectionMode,
      });
    }

    if (hadPointerPan || hadPointerMove || hadPointerMarquee) {
      if (hadPointerPan) {
        events.push({
          kind: "pan-end",
          source: "pointer",
          pointerId: input.pointerId,
          outcome: "cancel",
        });
      }

      pointerGestureState = cancelCanvasPanelPointerGesture();
      events.push({
        kind: "clear-preview",
        source: "pointer",
        reason: "pointer-reset",
      });
    }

    return createResult({
      pointerGestureState,
      touchGestureState,
    }, events);
  };

  const resetPointer = (): CanvasGestureSessionResult => {
    const pointerCaptureCommands = getPointerCapturePointerIds().map((pointerId) => ({
      kind: "release" as const,
      pointerId,
    }));

    pointerGestureState = cancelCanvasPanelPointerGesture();
    pointerMoveGestureState = cancelCanvasPointerMoveGesture();
    pointerMarqueeGestureState = cancelCanvasPointerMarqueeGesture();
    pointerTapGestureState = createIdleCanvasPanelPointerTapGestureState();

    return createResult(
      {
        pointerGestureState,
        touchGestureState,
      },
      [
        {
          kind: "clear-preview",
          source: "pointer",
          reason: "pointer-reset",
        },
      ],
      pointerCaptureCommands,
    );
  };

  const resetTouch = (): CanvasGestureSessionResult => {
    const pointerCaptureCommands = getTouchCapturePointerIds().map((pointerId) => ({
      kind: "release" as const,
      pointerId,
    }));

    touchPoints = new Map();
    touchMoveGestureState = cancelCanvasTouchDragGesture();
    touchMarqueeGestureState = cancelCanvasTouchMarqueeGesture();
    touchPlacementGestureState = cancelCanvasTouchPlacementGesture();
    touchTapSuppressed = false;
    touchGestureState = cancelCanvasTouchGesture();

    return createResult(
      {
        pointerGestureState,
        touchGestureState,
      },
      [
        {
          kind: "clear-preview",
          source: "touch",
          reason: "touch-reset",
        },
      ],
      pointerCaptureCommands,
    );
  };

  const resetAll = (): CanvasGestureSessionResult => {
    const pointerCaptureCommands = [
      ...getPointerCapturePointerIds(),
      ...getTouchCapturePointerIds(),
    ].map((pointerId) => ({
      kind: "release" as const,
      pointerId,
    }));

    pointerGestureState = cancelCanvasPanelPointerGesture();
    pointerMoveGestureState = cancelCanvasPointerMoveGesture();
    pointerMarqueeGestureState = cancelCanvasPointerMarqueeGesture();
    pointerTapGestureState = createIdleCanvasPanelPointerTapGestureState();
    touchPoints = new Map();
    touchMoveGestureState = cancelCanvasTouchDragGesture();
    touchPlacementGestureState = cancelCanvasTouchPlacementGesture();
    touchTapSuppressed = false;
    touchGestureState = cancelCanvasTouchGesture();

    return createResult(
      {
        pointerGestureState,
        touchGestureState,
      },
      [
        {
          kind: "clear-preview",
          source: "pointer",
          reason: "all-reset",
        },
      ],
      pointerCaptureCommands,
    );
  };

  return {
    getSnapshot,
    getPointerCapturePointerIds,
    getTouchCapturePointerIds,
    handlePointerDown,
    handlePointerMove,
    handleTouchLongPress,
    handlePointerEnter,
    handlePointerLeave,
    handlePointerUp,
    handleLostPointerCapture,
    resetPointer,
    resetTouch,
    resetAll,
  };
}
