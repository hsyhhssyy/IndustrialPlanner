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
  | "mouse dragstart"
  | "mouse dragmove"
  | "mouse dragend"
  | "mouse tap"
  | "mouse move"
  | "touch dragstart"
  | "touch dragmove"
  | "touch dragend"
  | "touch tap"
  | "pinch in"
  | "pinch out"
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
}

export interface MouseDragStartGestureEvent extends GestureEventBase {
  readonly type: "mouse dragstart";
  readonly originButton: number;
  readonly button: number;
  readonly buttons: number;
  readonly position: GesturePosition;
  readonly startPosition: GesturePosition;
}

export interface MouseDragMoveGestureEvent extends GestureEventBase {
  readonly type: "mouse dragmove";
  readonly originButton: number;
  readonly buttons: number;
  readonly position: GesturePosition;
  readonly delta: GestureDelta;
}

export interface MouseDragEndGestureEvent extends GestureEventBase {
  readonly type: "mouse dragend";
  readonly originButton: number;
  readonly releaseButton: number;
  readonly button: number;
  readonly buttons: number;
  readonly position: GesturePosition;
  readonly reason: GestureEndReason;
}

export interface MouseTapGestureEvent extends GestureEventBase {
  readonly type: "mouse tap";
  readonly button: number;
  readonly buttons: number;
  readonly position: GesturePosition;
}

export interface MouseMoveGestureEvent extends GestureEventBase {
  readonly type: "mouse move";
  readonly buttons: number;
  readonly position: GesturePosition;
  readonly delta: GestureDelta;
}

export interface TouchDragStartGestureEvent extends GestureEventBase {
  readonly type: "touch dragstart";
  readonly primaryId: number;
  readonly position: GesturePosition;
  readonly startPosition: GesturePosition;
  readonly activeTouchCount: number;
  readonly longPress: boolean;
}

export interface TouchDragMoveGestureEvent extends GestureEventBase {
  readonly type: "touch dragmove";
  readonly primaryId: number;
  readonly position: GesturePosition;
  readonly delta: GestureDelta;
  readonly activeTouchCount: number;
  readonly longPress: boolean;
}

export interface TouchDragEndGestureEvent extends GestureEventBase {
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
}

export interface PinchGestureEvent extends GestureEventBase {
  readonly type: "pinch in" | "pinch out";
  readonly center: GesturePosition;
  readonly scaleDelta: number;
  readonly distanceDelta: number;
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
  | MouseDragStartGestureEvent
  | MouseDragMoveGestureEvent
  | MouseDragEndGestureEvent
  | MouseTapGestureEvent
  | MouseMoveGestureEvent
  | TouchDragStartGestureEvent
  | TouchDragMoveGestureEvent
  | TouchDragEndGestureEvent
  | TouchTapGestureEvent
  | PinchGestureEvent
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

export type GestureListener = (event: GestureEvent) => void;
export type KeyboardSnapshotListener = (snapshot: KeyboardSnapshot) => void;
export type LongPressStateListener = (state: LongPressState) => void;
