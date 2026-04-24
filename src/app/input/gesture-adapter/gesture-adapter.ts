import type {
  GestureDelta,
  GestureEndReason,
  GestureEvent,
  GestureKeyboardEventLike,
  GestureListener,
  GestureModifiers,
  GesturePointerEventLike,
  GesturePosition,
  GestureWheelEventLike,
  KeyboardSnapshot,
  KeyboardSnapshotListener,
  LongPressState,
  LongPressStateListener,
} from "./types";

const TOUCH_LONG_PRESS_MS = 1000;
const TOUCH_MOVE_SLOP_PX = 8;
const MOUSE_DRAG_SLOP_PX = 3;
const PINCH_DISTANCE_THRESHOLD_PX = 2;
const TWO_FINGER_MOVE_THRESHOLD_PX = 2;
const WHEEL_ACCUMULATE_THRESHOLD = 1;
const WHEEL_LINE_HEIGHT_PX = 16;
const WHEEL_PAGE_HEIGHT_PX = 800;

type TimerHandle = ReturnType<typeof setTimeout>;

interface GestureAdapterThresholds {
  readonly touchLongPressMs: number;
  readonly touchMoveSlopPx: number;
  readonly mouseDragSlopPx: number;
  readonly pinchDistanceThresholdPx: number;
  readonly twoFingerMoveThresholdPx: number;
  readonly wheelAccumulateThreshold: number;
}

export interface GestureAdapterOptions {
  readonly thresholds?: Partial<GestureAdapterThresholds>;
  readonly now?: () => number;
  readonly setTimeout?: (callback: () => void, delayMs: number) => TimerHandle;
  readonly clearTimeout?: (handle: TimerHandle) => void;
}

interface MouseSession {
  readonly gestureId: string;
  readonly pointerId: number;
  readonly originButton: number;
  readonly startPosition: GesturePosition;
  lastPosition: GesturePosition;
  state: "pressed" | "dragging";
}

interface TouchPoint {
  readonly id: number;
  readonly startPosition: GesturePosition;
  position: GesturePosition;
  lastPosition: GesturePosition;
}

interface TouchSession {
  readonly gestureId: string;
  primaryId: number;
  readonly startPosition: GesturePosition;
  lastPosition: GesturePosition;
  state: "pending-long-press" | "drag-ready" | "dragging" | "multi-touch";
  longPressTimer: TimerHandle | null;
  longPress: boolean;
}

interface MultiTouchSnapshot {
  readonly distance: number;
  readonly center: GesturePosition;
}

export class GestureAdapter {
  private readonly thresholds: GestureAdapterThresholds;
  private readonly now: () => number;
  private readonly scheduleTimeout: (callback: () => void, delayMs: number) => TimerHandle;
  private readonly cancelTimeout: (handle: TimerHandle) => void;
  private readonly gestureListeners = new Set<GestureListener>();
  private readonly keyboardListeners = new Set<KeyboardSnapshotListener>();
  private readonly longPressListeners = new Set<LongPressStateListener>();
  private readonly pressedKeys = new Set<string>();
  private mouseSession: MouseSession | null = null;
  private lastMousePosition: GesturePosition | null = null;
  private touchSession: TouchSession | null = null;
  private readonly activeTouches = new Map<number, TouchPoint>();
  private multiTouchSnapshot: MultiTouchSnapshot | null = null;
  private lastGestureIndex = 0;
  private wheelAccumulator = 0;
  private wheelDirection: 1 | -1 | 0 = 0;
  private keyboardSnapshot: KeyboardSnapshot = {
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
  };
  private longPressState: LongPressState = {
    visible: false,
    position: null,
    startedAt: null,
    durationMs: TOUCH_LONG_PRESS_MS,
    progress: 0,
  };

  public constructor(options: GestureAdapterOptions = {}) {
    this.thresholds = {
      touchLongPressMs: options.thresholds?.touchLongPressMs ?? TOUCH_LONG_PRESS_MS,
      touchMoveSlopPx: options.thresholds?.touchMoveSlopPx ?? TOUCH_MOVE_SLOP_PX,
      mouseDragSlopPx: options.thresholds?.mouseDragSlopPx ?? MOUSE_DRAG_SLOP_PX,
      pinchDistanceThresholdPx:
        options.thresholds?.pinchDistanceThresholdPx ?? PINCH_DISTANCE_THRESHOLD_PX,
      twoFingerMoveThresholdPx:
        options.thresholds?.twoFingerMoveThresholdPx ?? TWO_FINGER_MOVE_THRESHOLD_PX,
      wheelAccumulateThreshold:
        options.thresholds?.wheelAccumulateThreshold ?? WHEEL_ACCUMULATE_THRESHOLD,
    };
    this.now = options.now ?? (() => performance.now());
    this.scheduleTimeout = options.setTimeout ?? ((callback, delayMs) => setTimeout(callback, delayMs));
    this.cancelTimeout = options.clearTimeout ?? ((handle) => clearTimeout(handle));
    this.longPressState = {
      ...this.longPressState,
      durationMs: this.thresholds.touchLongPressMs,
    };
  }

  public subscribe(listener: GestureListener): () => void {
    this.gestureListeners.add(listener);
    return () => {
      this.gestureListeners.delete(listener);
    };
  }

  public subscribeKeyboardSnapshot(listener: KeyboardSnapshotListener): () => void {
    this.keyboardListeners.add(listener);
    listener(this.keyboardSnapshot);
    return () => {
      this.keyboardListeners.delete(listener);
    };
  }

  public subscribeLongPressState(listener: LongPressStateListener): () => void {
    this.longPressListeners.add(listener);
    listener(this.longPressState);
    return () => {
      this.longPressListeners.delete(listener);
    };
  }

  public getKeyboardSnapshot(): KeyboardSnapshot {
    return this.keyboardSnapshot;
  }

  public getLongPressState(): LongPressState {
    return this.longPressState;
  }

  public handlePointerDown(event: GesturePointerEventLike): void {
    const pointerKind = getPointerKind(event.pointerType);
    if (pointerKind === "unknown") {
      return;
    }

    event.currentTarget?.focus?.({ preventScroll: true });
    event.currentTarget?.setPointerCapture?.(event.pointerId);

    if (pointerKind === "mouse") {
      this.startMouseSession(event);
      return;
    }

    this.startOrJoinTouchSession(event);
  }

  public handlePointerMove(event: GesturePointerEventLike): void {
    const pointerKind = getPointerKind(event.pointerType);
    if (pointerKind === "unknown") {
      return;
    }

    if (pointerKind === "mouse") {
      this.handleMouseMove(event);
      return;
    }

    this.handleTouchMove(event);
  }

  public handlePointerUp(event: GesturePointerEventLike): void {
    const pointerKind = getPointerKind(event.pointerType);
    if (pointerKind === "unknown") {
      return;
    }

    event.currentTarget?.releasePointerCapture?.(event.pointerId);

    if (pointerKind === "mouse") {
      this.endMouseSession(event, "release");
      return;
    }

    this.endTouchPointer(event, "release");
  }

  public handlePointerCancel(event: GesturePointerEventLike): void {
    const pointerKind = getPointerKind(event.pointerType);
    if (pointerKind === "unknown") {
      return;
    }

    event.currentTarget?.releasePointerCapture?.(event.pointerId);

    if (pointerKind === "mouse") {
      this.endMouseSession(event, "cancel");
      return;
    }

    this.endTouchPointer(event, "cancel");
  }

  public handleLostPointerCapture(event: GesturePointerEventLike): void {
    const pointerKind = getPointerKind(event.pointerType);
    if (pointerKind === "mouse") {
      this.endMouseSession(event, "cancel");
      return;
    }

    if (pointerKind === "touch") {
      this.endTouchPointer(event, "cancel");
    }
  }

  public handleWheel(event: GestureWheelEventLike): void {
    if (event.deltaY === 0) {
      return;
    }

    const normalizedDelta = normalizeWheelDeltaY(event);
    const direction: 1 | -1 = normalizedDelta > 0 ? 1 : -1;
    if (this.wheelDirection !== direction) {
      this.wheelAccumulator = 0;
      this.wheelDirection = direction;
    }

    this.wheelAccumulator += normalizedDelta;
    if (Math.abs(this.wheelAccumulator) < this.thresholds.wheelAccumulateThreshold) {
      return;
    }

    const accumulatedDelta = this.wheelAccumulator;
    this.wheelAccumulator = 0;
    this.dispatchGesture({
      type: direction > 0 ? "wheel down" : "wheel up",
      gestureId: this.nextGestureId("wheel"),
      deltaY: event.deltaY,
      normalizedDelta: accumulatedDelta,
      position: getPosition(event),
      modifiers: getModifiers(event),
      sourceEvent: event,
    });
  }

  public handleKeyDown(event: GestureKeyboardEventLike): void {
    const code = getKeyboardCode(event);
    if (code !== null) {
      this.pressedKeys.add(code);
    }

    this.publishKeyboardSnapshot(event);
  }

  public handleKeyUp(event: GestureKeyboardEventLike): void {
    const code = getKeyboardCode(event);
    if (code !== null) {
      this.pressedKeys.delete(code);
    }

    this.publishKeyboardSnapshot(event);
  }

  public handleBlur(): void {
    this.cancelAllPointerSessions();
    this.clearPressedKeys();
  }

  public handleVisibilityChange(hidden: boolean): void {
    if (hidden) {
      this.handleBlur();
    }
  }

  public dispose(): void {
    this.cancelAllPointerSessions();
    this.clearPressedKeys();
    this.gestureListeners.clear();
    this.keyboardListeners.clear();
    this.longPressListeners.clear();
  }

  private startMouseSession(event: GesturePointerEventLike): void {
    const position = getPosition(event);
    this.mouseSession = {
      gestureId: this.nextGestureId("mouse"),
      pointerId: event.pointerId,
      originButton: event.button,
      startPosition: position,
      lastPosition: position,
      state: "pressed",
    };
    this.lastMousePosition = position;
  }

  private handleMouseMove(event: GesturePointerEventLike): void {
    const position = getPosition(event);
    const session = this.mouseSession;
    if (session === null || session.pointerId !== event.pointerId) {
      const delta = getDelta(this.lastMousePosition, position);
      this.lastMousePosition = position;
      this.dispatchGesture({
        type: "mouse move",
        gestureId: this.nextGestureId("mouse-move"),
        buttons: event.buttons,
        position,
        delta,
        modifiers: getModifiers(event),
        sourceEvent: event,
      });
      return;
    }

    if (session.state === "pressed") {
      if (distance(session.startPosition, position) < this.thresholds.mouseDragSlopPx) {
        session.lastPosition = position;
        return;
      }

      session.state = "dragging";
      session.lastPosition = position;
      this.dispatchGesture({
        type: "mouse dragstart",
        gestureId: session.gestureId,
        originButton: session.originButton,
        button: event.button,
        buttons: event.buttons,
        position,
        startPosition: session.startPosition,
        modifiers: getModifiers(event),
        sourceEvent: event,
      });
      return;
    }

    const delta = getDelta(session.lastPosition, position);
    session.lastPosition = position;
    this.dispatchGesture({
      type: "mouse dragmove",
      gestureId: session.gestureId,
      originButton: session.originButton,
      buttons: event.buttons,
      position,
      delta,
      modifiers: getModifiers(event),
      sourceEvent: event,
    });
  }

  private endMouseSession(event: GesturePointerEventLike, reason: GestureEndReason): void {
    const session = this.mouseSession;
    const position = getPosition(event);
    this.lastMousePosition = position;
    if (session === null || session.pointerId !== event.pointerId) {
      return;
    }

    if (session.state === "dragging") {
      this.dispatchGesture({
        type: "mouse dragend",
        gestureId: session.gestureId,
        originButton: session.originButton,
        releaseButton: event.button,
        button: event.button,
        buttons: event.buttons,
        position,
        reason,
        modifiers: getModifiers(event),
        sourceEvent: event,
      });
    } else if (reason === "release") {
      this.dispatchGesture({
        type: "mouse tap",
        gestureId: session.gestureId,
        button: event.button,
        buttons: event.buttons,
        position,
        modifiers: getModifiers(event),
        sourceEvent: event,
      });
    }

    this.mouseSession = null;
  }

  private startOrJoinTouchSession(event: GesturePointerEventLike): void {
    const position = getPosition(event);
    this.activeTouches.set(event.pointerId, {
      id: event.pointerId,
      startPosition: position,
      position,
      lastPosition: position,
    });

    if (this.touchSession === null) {
      const session: TouchSession = {
        gestureId: this.nextGestureId("touch"),
        primaryId: event.pointerId,
        startPosition: position,
        lastPosition: position,
        state: "pending-long-press",
        longPressTimer: null,
        longPress: false,
      };
      session.longPressTimer = this.scheduleTimeout(() => {
        if (this.touchSession !== session || session.state !== "pending-long-press") {
          return;
        }

        session.state = "drag-ready";
        session.longPress = true;
        session.longPressTimer = null;
        this.setLongPressState({
          visible: true,
          position,
          startedAt: this.longPressState.startedAt,
          durationMs: this.thresholds.touchLongPressMs,
          progress: 1,
        });
      }, this.thresholds.touchLongPressMs);
      this.touchSession = session;
      this.setLongPressState({
        visible: true,
        position,
        startedAt: this.now(),
        durationMs: this.thresholds.touchLongPressMs,
        progress: 0,
      });
    } else if (this.activeTouches.size > 1) {
      this.transitionTouchSessionToMultiTouch(this.touchSession, event);
    }

    this.resetMultiTouchSnapshot();
  }

  private handleTouchMove(event: GesturePointerEventLike): void {
    const touch = this.activeTouches.get(event.pointerId);
    if (touch === undefined) {
      return;
    }

    const position = getPosition(event);
    touch.lastPosition = touch.position;
    touch.position = position;

    const session = this.touchSession;
    if (session !== null && session.primaryId === event.pointerId) {
      this.handlePrimaryTouchMove(event, session, touch);
    }

    this.dispatchMultiTouchGestures(event);
  }

  private handlePrimaryTouchMove(
    event: GesturePointerEventLike,
    session: TouchSession,
    touch: TouchPoint,
  ): void {
    if (session.state === "multi-touch") {
      return;
    }

    const position = touch.position;
    if (session.state === "pending-long-press") {
      if (distance(session.startPosition, position) <= this.thresholds.touchMoveSlopPx) {
        session.lastPosition = position;
        this.setLongPressState({
          ...this.longPressState,
          position,
        });
        return;
      }

      this.clearLongPressTimer(session);
      this.hideLongPressState();
      session.state = "drag-ready";
      session.longPress = false;
    }

    if (session.state === "drag-ready") {
      const delta = getDelta(session.lastPosition, position);
      session.lastPosition = position;
      if (delta.x === 0 && delta.y === 0) {
        return;
      }

      if (!session.longPress && this.activeTouches.size !== 1) {
        return;
      }

      this.hideLongPressState();
      session.state = "dragging";
      this.dispatchGesture({
        type: "touch dragstart",
        gestureId: session.gestureId,
        primaryId: session.primaryId,
        position,
        startPosition: session.startPosition,
        activeTouchCount: this.activeTouches.size,
        longPress: session.longPress,
        modifiers: getModifiers(event),
        sourceEvent: event,
      });
      return;
    }

    const delta = getDelta(session.lastPosition, position);
    session.lastPosition = position;
    if (!session.longPress && this.activeTouches.size !== 1) {
      return;
    }

    this.dispatchGesture({
      type: "touch dragmove",
      gestureId: session.gestureId,
      primaryId: session.primaryId,
      position,
      delta,
      activeTouchCount: this.activeTouches.size,
      longPress: session.longPress,
      modifiers: getModifiers(event),
      sourceEvent: event,
    });
  }

  private endTouchPointer(event: GesturePointerEventLike, reason: GestureEndReason): void {
    const session = this.touchSession;
    const touch = this.activeTouches.get(event.pointerId);
    if (touch !== undefined) {
      touch.lastPosition = touch.position;
      touch.position = getPosition(event);
    }
    this.activeTouches.delete(event.pointerId);

    if (session === null) {
      this.resetMultiTouchSnapshot();
      return;
    }

    if (this.activeTouches.size > 0) {
      if (session.state !== "multi-touch" && session.primaryId === event.pointerId) {
        this.rebindPrimaryTouch(session);
      }
      this.resetMultiTouchSnapshot();
      return;
    }

    this.clearLongPressTimer(session);
    this.hideLongPressState();

    if (session.state === "pending-long-press" && reason === "release") {
      this.dispatchGesture({
        type: "touch tap",
        gestureId: session.gestureId,
        primaryId: session.primaryId,
        position: getPosition(event),
        modifiers: getModifiers(event),
        sourceEvent: event,
      });
    } else if (session.state === "dragging") {
      this.dispatchGesture({
        type: "touch dragend",
        gestureId: session.gestureId,
        primaryId: session.primaryId,
        position: getPosition(event),
        reason,
        longPress: session.longPress,
        modifiers: getModifiers(event),
        sourceEvent: event,
      });
    }

    this.touchSession = null;
    this.multiTouchSnapshot = null;
  }

  private rebindPrimaryTouch(session: TouchSession): void {
    const nextTouch = this.activeTouches.values().next().value as TouchPoint | undefined;
    if (nextTouch === undefined) {
      return;
    }

    session.primaryId = nextTouch.id;
    session.lastPosition = nextTouch.position;
  }

  private transitionTouchSessionToMultiTouch(
    session: TouchSession,
    event: GesturePointerEventLike,
  ): void {
    if (session.state === "multi-touch") {
      return;
    }

    this.clearLongPressTimer(session);
    this.hideLongPressState();

    if (session.state === "dragging") {
      this.dispatchGesture({
        type: "touch dragend",
        gestureId: session.gestureId,
        primaryId: session.primaryId,
        position: session.lastPosition,
        reason: "cancel",
        longPress: session.longPress,
        modifiers: getModifiers(event),
        sourceEvent: event,
      });
    }

    session.state = "multi-touch";
  }

  private dispatchMultiTouchGestures(event: GesturePointerEventLike): void {
    const snapshot = getMultiTouchSnapshot(this.activeTouches);
    if (snapshot === null) {
      this.multiTouchSnapshot = null;
      return;
    }

    const previousSnapshot = this.multiTouchSnapshot;
    this.multiTouchSnapshot = snapshot;
    if (previousSnapshot === null) {
      return;
    }

    const distanceDelta = snapshot.distance - previousSnapshot.distance;
    if (Math.abs(distanceDelta) >= this.thresholds.pinchDistanceThresholdPx) {
      this.dispatchGesture({
        type: distanceDelta > 0 ? "pinch out" : "pinch in",
        gestureId: this.nextGestureId("pinch"),
        center: snapshot.center,
        scaleDelta:
          previousSnapshot.distance === 0 ? 1 : snapshot.distance / previousSnapshot.distance,
        distanceDelta,
        activeTouchCount: this.activeTouches.size,
        modifiers: getModifiers(event),
        sourceEvent: event,
      });
    }

    const centerDelta = getDelta(previousSnapshot.center, snapshot.center);
    if (vectorLength(centerDelta) >= this.thresholds.twoFingerMoveThresholdPx) {
      this.dispatchGesture({
        type: "two finger move",
        gestureId: this.nextGestureId("two-finger"),
        center: snapshot.center,
        centerDelta,
        activeTouchCount: this.activeTouches.size,
        modifiers: getModifiers(event),
        sourceEvent: event,
      });
    }
  }

  private resetMultiTouchSnapshot(): void {
    this.multiTouchSnapshot = getMultiTouchSnapshot(this.activeTouches);
  }

  private cancelAllPointerSessions(): void {
    const mouseSession = this.mouseSession;
    if (mouseSession !== null && mouseSession.state === "dragging") {
      this.dispatchGesture({
        type: "mouse dragend",
        gestureId: mouseSession.gestureId,
        originButton: mouseSession.originButton,
        releaseButton: mouseSession.originButton,
        button: mouseSession.originButton,
        buttons: 0,
        position: mouseSession.lastPosition,
        reason: "cancel",
        modifiers: emptyModifiers(),
        sourceEvent: null,
      });
    }
    this.mouseSession = null;

    const touchSession = this.touchSession;
    if (touchSession !== null) {
      this.clearLongPressTimer(touchSession);
      if (touchSession.state === "dragging") {
        this.dispatchGesture({
          type: "touch dragend",
          gestureId: touchSession.gestureId,
          primaryId: touchSession.primaryId,
          position: touchSession.lastPosition,
          reason: "cancel",
          longPress: touchSession.longPress,
          modifiers: emptyModifiers(),
          sourceEvent: null,
        });
      }
    }
    this.touchSession = null;
    this.activeTouches.clear();
    this.multiTouchSnapshot = null;
    this.wheelAccumulator = 0;
    this.wheelDirection = 0;
    this.hideLongPressState();
  }

  private clearPressedKeys(): void {
    if (this.pressedKeys.size === 0 && this.keyboardSnapshot.lastCode === null) {
      return;
    }

    this.pressedKeys.clear();
    this.keyboardSnapshot = {
      pressedKeys: new Set<string>(),
      lastCode: null,
      lastKey: null,
      lastKeyCode: null,
      modifiers: emptyModifiers(),
    };
    this.publishKeyboardSnapshotToListeners();
  }

  private publishKeyboardSnapshot(event: GestureKeyboardEventLike): void {
    this.keyboardSnapshot = {
      pressedKeys: new Set(this.pressedKeys),
      lastCode: event.code || null,
      lastKey: event.key || null,
      lastKeyCode: Number.isFinite(event.keyCode) ? event.keyCode : null,
      modifiers: getModifiers(event),
    };
    this.publishKeyboardSnapshotToListeners();
  }

  private publishKeyboardSnapshotToListeners(): void {
    for (const listener of this.keyboardListeners) {
      listener(this.keyboardSnapshot);
    }
  }

  private clearLongPressTimer(session: TouchSession): void {
    if (session.longPressTimer !== null) {
      this.cancelTimeout(session.longPressTimer);
      session.longPressTimer = null;
    }
  }

  private setLongPressState(state: LongPressState): void {
    this.longPressState = state;
    for (const listener of this.longPressListeners) {
      listener(state);
    }
  }

  private hideLongPressState(): void {
    if (!this.longPressState.visible && this.longPressState.progress === 0) {
      return;
    }

    this.setLongPressState({
      visible: false,
      position: null,
      startedAt: null,
      durationMs: this.thresholds.touchLongPressMs,
      progress: 0,
    });
  }

  private dispatchGesture(event: GestureEvent): void {
    for (const listener of this.gestureListeners) {
      listener(event);
    }
  }

  private nextGestureId(prefix: string): string {
    this.lastGestureIndex += 1;
    return `${prefix}-${this.lastGestureIndex}`;
  }
}

export function createGestureAdapter(options?: GestureAdapterOptions): GestureAdapter {
  return new GestureAdapter(options);
}

function getPointerKind(pointerType: string): "mouse" | "touch" | "unknown" {
  if (pointerType === "mouse") {
    return "mouse";
  }

  if (pointerType === "touch" || pointerType === "pen") {
    return "touch";
  }

  return "unknown";
}

function getPosition(event: { readonly clientX: number; readonly clientY: number }): GesturePosition {
  return {
    x: event.clientX,
    y: event.clientY,
  };
}

function getDelta(previous: GesturePosition | null, next: GesturePosition): GestureDelta {
  if (previous === null) {
    return { x: 0, y: 0 };
  }

  return {
    x: next.x - previous.x,
    y: next.y - previous.y,
  };
}

function distance(a: GesturePosition, b: GesturePosition): number {
  return Math.hypot(b.x - a.x, b.y - a.y);
}

function vectorLength(delta: GestureDelta): number {
  return Math.hypot(delta.x, delta.y);
}

function getModifiers(event: {
  readonly altKey: boolean;
  readonly ctrlKey: boolean;
  readonly metaKey: boolean;
  readonly shiftKey: boolean;
}): GestureModifiers {
  return {
    alt: event.altKey,
    ctrl: event.ctrlKey,
    meta: event.metaKey,
    shift: event.shiftKey,
  };
}

function emptyModifiers(): GestureModifiers {
  return {
    alt: false,
    ctrl: false,
    meta: false,
    shift: false,
  };
}

function normalizeWheelDeltaY(event: GestureWheelEventLike): number {
  if (event.deltaMode === WheelEvent.DOM_DELTA_LINE) {
    return event.deltaY * WHEEL_LINE_HEIGHT_PX;
  }

  if (event.deltaMode === WheelEvent.DOM_DELTA_PAGE) {
    return event.deltaY * WHEEL_PAGE_HEIGHT_PX;
  }

  return event.deltaY;
}

function getKeyboardCode(event: GestureKeyboardEventLike): string | null {
  if (event.code !== "") {
    return event.code;
  }

  if (event.key !== "") {
    return event.key;
  }

  if (Number.isFinite(event.keyCode)) {
    return `keyCode:${event.keyCode}`;
  }

  return null;
}

function getMultiTouchSnapshot(touches: ReadonlyMap<number, TouchPoint>): MultiTouchSnapshot | null {
  if (touches.size < 2) {
    return null;
  }

  const iterator = touches.values();
  const first = iterator.next().value as TouchPoint | undefined;
  const second = iterator.next().value as TouchPoint | undefined;
  if (first === undefined || second === undefined) {
    return null;
  }

  const center = {
    x: (first.position.x + second.position.x) / 2,
    y: (first.position.y + second.position.y) / 2,
  };

  return {
    center,
    distance: distance(first.position, second.position),
  };
}
