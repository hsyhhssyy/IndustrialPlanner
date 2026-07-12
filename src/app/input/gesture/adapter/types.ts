import type { WorldEntity } from "@/domain/document/world-document";
import type { ActiveTool } from "@/domain/app/types/app-types";

export interface GesturePosition {
  readonly x: number;
  readonly y: number;
}

export interface GestureDelta {
  readonly x: number;
  readonly y: number;
}

export interface GestureModifiers {
  readonly alt: boolean;
  readonly ctrl: boolean;
  readonly meta: boolean;
  readonly shift: boolean;
}

export interface KeyboardSnapshot {
  readonly pressedKeys: ReadonlySet<string>;
  readonly lastCode: string | null;
  readonly lastKey: string | null;
  readonly lastKeyCode: number | null;
  readonly modifiers: GestureModifiers;
}

export interface LongPressState {
  readonly visible: boolean;
  readonly position: GesturePosition | null;
  readonly startedAt: number | null;
  readonly durationMs: number;
  readonly progress: number;
}

export type GestureEndReason = "release" | "cancel";
export type GestureEventType =
  | "on-enter-active-tool"
  | "on-exit-active-tool"
  | "mouse dragstart"
  | "mouse dragmove"
  | "mouse dragend"
  | "mouse tap"
  | "mouse double tap"
  | "mouse-long-press-ready"
  | "mouse move"
  | "touch dragstart"
  | "touch dragmove"
  | "touch dragend"
  | "touch tap"
  | "touch double tap"
  | "tap-long-press-ready"
  | "pinch in"
  | "pinch out"
  | "rotate clockwise"
  | "rotate counterclockwise"
  | "two finger move"
  | "wheel up"
  | "wheel down"
  | "key down"
  | "key up"
  | "ui-button-touch-tap"
  | "ui-button-mouse-tap";

interface GestureEventBase {
  readonly type: GestureEventType;
  readonly gestureId: string;
  readonly modifiers: GestureModifiers;
  readonly sourceEvent: unknown;
  readonly mergedCount?: number;
}

interface ActiveToolGestureEventBase extends GestureEventBase {
  readonly from: ActiveTool;
  readonly to: ActiveTool;
}

export interface EnterActiveToolGestureEvent extends ActiveToolGestureEventBase {
  readonly type: "on-enter-active-tool";
}

export interface ExitActiveToolGestureEvent extends ActiveToolGestureEventBase {
  readonly type: "on-exit-active-tool";
}

interface GestureDragEventBase extends GestureEventBase {
  payload?: unknown | null;
}

export interface MouseDragStartGestureEvent extends GestureDragEventBase {
  readonly type: "mouse dragstart";
  readonly originButton: number;
  readonly button: number;
  readonly buttons: number;
  readonly position: GesturePosition;
  readonly startPosition: GesturePosition;
  readonly longPress: boolean;
  readonly pointerEntity: WorldEntity | null;
}

export interface MouseDragMoveGestureEvent extends GestureDragEventBase {
  readonly type: "mouse dragmove";
  readonly originButton: number;
  readonly buttons: number;
  readonly position: GesturePosition;
  readonly delta: GestureDelta;
  readonly longPress: boolean;
}

export interface MouseDragEndGestureEvent extends GestureDragEventBase {
  readonly type: "mouse dragend";
  readonly originButton: number;
  readonly releaseButton: number;
  readonly button: number;
  readonly buttons: number;
  readonly position: GesturePosition;
  readonly reason: GestureEndReason;
  readonly longPress: boolean;
}

export interface MouseTapGestureEvent extends GestureEventBase {
  readonly type: "mouse tap";
  readonly button: number;
  readonly buttons: number;
  readonly position: GesturePosition;
  readonly longPress: boolean;
  readonly pointerEntity: WorldEntity | null;
}

export interface MouseDoubleTapGestureEvent extends GestureEventBase {
  readonly type: "mouse double tap";
  readonly button: number;
  readonly buttons: number;
  readonly position: GesturePosition;
  readonly longPress: boolean;
  readonly pointerEntity: WorldEntity | null;
}

export interface MouseLongPressReadyGestureEvent extends GestureEventBase {
  readonly type: "mouse-long-press-ready";
  readonly button: number;
  readonly buttons: number;
  readonly position: GesturePosition;
  readonly pointerEntity: WorldEntity | null;
}

export interface MouseMoveGestureEvent extends GestureEventBase {
  readonly type: "mouse move";
  readonly buttons: number;
  readonly position: GesturePosition;
  readonly delta: GestureDelta;
}

export interface TouchDragStartGestureEvent extends GestureDragEventBase {
  readonly type: "touch dragstart";
  readonly primaryId: number;
  readonly position: GesturePosition;
  readonly startPosition: GesturePosition;
  readonly activeTouchCount: number;
  readonly longPress: boolean;
  readonly pointerEntity: WorldEntity | null;
}

export interface TouchDragMoveGestureEvent extends GestureDragEventBase {
  readonly type: "touch dragmove";
  readonly primaryId: number;
  readonly position: GesturePosition;
  readonly delta: GestureDelta;
  readonly activeTouchCount: number;
  readonly longPress: boolean;
}

export interface TouchDragEndGestureEvent extends GestureDragEventBase {
  readonly type: "touch dragend";
  readonly primaryId: number;
  readonly position: GesturePosition;
  readonly reason: GestureEndReason;
  readonly longPress: boolean;
}

export interface TouchTapGestureEvent extends GestureEventBase {
  readonly type: "touch tap";
  readonly primaryId: number;
  readonly position: GesturePosition;
  readonly longPress: boolean;
  readonly pointerEntity: WorldEntity | null;
}

export interface TouchDoubleTapGestureEvent extends GestureEventBase {
  readonly type: "touch double tap";
  readonly primaryId: number;
  readonly position: GesturePosition;
  readonly longPress: boolean;
  readonly pointerEntity: WorldEntity | null;
}

export interface TapLongPressReadyGestureEvent extends GestureEventBase {
  readonly type: "tap-long-press-ready";
  readonly primaryId: number;
  readonly position: GesturePosition;
  readonly activeTouchCount: number;
  readonly pointerEntity: WorldEntity | null;
}

export interface PinchGestureEvent extends GestureEventBase {
  readonly type: "pinch in" | "pinch out";
  readonly center: GesturePosition;
  readonly scaleDelta: number;
  readonly distanceDelta: number;
  readonly activeTouchCount: number;
}

export interface RotateGestureEvent extends GestureEventBase {
  readonly type: "rotate clockwise" | "rotate counterclockwise";
  readonly center: GesturePosition;
  readonly rotationDeltaDegrees: number;
  readonly activeTouchCount: number;
}

export interface TwoFingerMoveGestureEvent extends GestureEventBase {
  readonly type: "two finger move";
  readonly center: GesturePosition;
  readonly centerDelta: GestureDelta;
  readonly activeTouchCount: number;
}

export interface WheelGestureEvent extends GestureEventBase {
  readonly type: "wheel up" | "wheel down";
  readonly deltaY: number;
  readonly normalizedDelta: number;
  readonly position: GesturePosition;
}

export interface KeyDownGestureEvent extends GestureEventBase {
  readonly type: "key down";
  readonly code: string | null;
  readonly key: string | null;
  readonly keyCode: number | null;
}

export interface KeyUpGestureEvent extends GestureEventBase {
  readonly type: "key up";
  readonly code: string | null;
  readonly key: string | null;
  readonly keyCode: number | null;
}

export interface UiButtonTouchTapGestureEvent extends GestureEventBase {
  readonly type: "ui-button-touch-tap";
  readonly uiButtonId: string;
}

export interface UiButtonMouseTapGestureEvent extends GestureEventBase {
  readonly type: "ui-button-mouse-tap";
  readonly uiButtonId: string;
  readonly button: number;
}

export type GestureEvent =
  | EnterActiveToolGestureEvent
  | ExitActiveToolGestureEvent
  | MouseDragStartGestureEvent
  | MouseDragMoveGestureEvent
  | MouseDragEndGestureEvent
  | MouseTapGestureEvent
  | MouseDoubleTapGestureEvent
  | MouseLongPressReadyGestureEvent
  | MouseMoveGestureEvent
  | TouchDragStartGestureEvent
  | TouchDragMoveGestureEvent
  | TouchDragEndGestureEvent
  | TouchTapGestureEvent
  | TouchDoubleTapGestureEvent
  | TapLongPressReadyGestureEvent
  | PinchGestureEvent
  | RotateGestureEvent
  | TwoFingerMoveGestureEvent
  | WheelGestureEvent
  | KeyDownGestureEvent
  | KeyUpGestureEvent
  | UiButtonTouchTapGestureEvent
  | UiButtonMouseTapGestureEvent;

export interface GesturePointerEventLike {
  readonly pointerId: number;
  readonly pointerType: string;
  readonly clientX: number;
  readonly clientY: number;
  readonly button: number;
  readonly buttons: number;
  readonly altKey: boolean;
  readonly ctrlKey: boolean;
  readonly metaKey: boolean;
  readonly shiftKey: boolean;
  readonly currentTarget?: {
    setPointerCapture?: (pointerId: number) => void;
    releasePointerCapture?: (pointerId: number) => void;
    focus?: (options?: FocusOptions) => void;
  };
}

export interface GestureWheelEventLike {
  readonly clientX: number;
  readonly clientY: number;
  readonly deltaY: number;
  readonly deltaMode: number;
  readonly altKey: boolean;
  readonly ctrlKey: boolean;
  readonly metaKey: boolean;
  readonly shiftKey: boolean;
}

export interface GestureKeyboardEventLike {
  readonly code: string;
  readonly key: string;
  readonly keyCode: number;
  readonly altKey: boolean;
  readonly ctrlKey: boolean;
  readonly metaKey: boolean;
  readonly shiftKey: boolean;
}

interface GestureUiButtonEventLikeBase {
  readonly uiButtonId: string;
  readonly altKey: boolean;
  readonly ctrlKey: boolean;
  readonly metaKey: boolean;
  readonly shiftKey: boolean;
  readonly sourceEvent?: unknown;
}

export interface GestureUiButtonTouchTapEventLike extends GestureUiButtonEventLikeBase {
  readonly pointerId?: number;
}

export interface GestureUiButtonMouseTapEventLike extends GestureUiButtonEventLikeBase {
  readonly button: number;
}

export type GestureListener = (event: GestureEvent) => unknown;
export type KeyboardSnapshotListener = (snapshot: KeyboardSnapshot) => void;
export type LongPressStateListener = (state: LongPressState) => void;
