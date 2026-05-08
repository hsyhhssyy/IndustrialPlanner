import type {
  GestureDelta,
  GestureEndReason,
  GestureEvent,
  GestureKeyboardEventLike,
  GestureListener,
  GestureModifiers,
  GesturePointerEventLike,
  GesturePosition,
  GestureUiButtonMouseTapEventLike,
  GestureUiButtonTouchTapEventLike,
  GestureWheelEventLike,
  KeyboardSnapshot,
  KeyboardSnapshotListener,
  LongPressState,
  LongPressStateListener,
} from "./types";
import { reaction, type IReactionDisposer } from "mobx";
import type { WorldEntity } from "@/domain/document/world-document";
import type { ActiveTool } from "@/domain/app/types/app-types";

const TOUCH_LONG_PRESS_MS = 500;
const TOUCH_LONG_PRESS_INDICATOR_DELAY_MS = 200;
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
}

export interface GestureAdapterAppHost {
  readonly workspace: {
    readonly editor: {
      readonly queries: {
        findEntityAtClientPixelPoint: (position: GesturePosition) => WorldEntity | null;
      };
    } | null;
  };
  readonly internalState: {
    activeTool: ActiveTool;
  };
}

interface MouseSession {
  readonly gestureId: string;
  readonly pointerId: number;
  readonly originButton: number;
  readonly pressButtons: number;
  readonly pressModifiers: GestureModifiers;
  readonly pressStartedAt: number;
  readonly startPosition: GesturePosition;
  lastPosition: GesturePosition;
  longPressIndicatorTimer: TimerHandle | null;
  longPressTimer: TimerHandle | null;
  longPress: boolean;
  state: "pressed" | "dragging";
  payload: unknown | null;
}

interface LongPressTrackingSession {
  readonly pressStartedAt: number;
  lastPosition: GesturePosition;
  longPressIndicatorTimer: TimerHandle | null;
  longPressTimer: TimerHandle | null;
  longPress: boolean;
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
  readonly pressModifiers: GestureModifiers;
  readonly pressStartedAt: number;
  readonly startPosition: GesturePosition;
  lastPosition: GesturePosition;
  state: "pending-long-press" | "drag-ready" | "dragging" | "multi-touch";
  longPressIndicatorTimer: TimerHandle | null;
  longPressTimer: TimerHandle | null;
  longPress: boolean;
  payload: unknown | null;
}

interface MultiTouchSnapshot {
  readonly distance: number;
  readonly center: GesturePosition;
}

export class GestureAdapter {
  private readonly appHost: GestureAdapterAppHost;
  private readonly thresholds: GestureAdapterThresholds;
  private readonly now = () => performance.now();
  private readonly scheduleTimeout = (callback: () => void, delayMs: number): TimerHandle =>
    setTimeout(callback, delayMs);
  private readonly cancelTimeout = (handle: TimerHandle): void => {
    clearTimeout(handle);
  };
  private readonly gestureListeners = new Set<GestureListener>();
  private readonly keyboardListeners = new Set<KeyboardSnapshotListener>();
  private readonly longPressListeners = new Set<LongPressStateListener>();
  private readonly unsubscribeActiveToolReaction: IReactionDisposer;
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

  public constructor(appHost: GestureAdapterAppHost, options: GestureAdapterOptions = {}) {
    this.appHost = appHost;
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
    this.longPressState = {
      ...this.longPressState,
      durationMs: this.thresholds.touchLongPressMs,
    };
    this.unsubscribeActiveToolReaction = reaction(
      () => this.appHost.internalState.activeTool,
      (activeTool, previousActiveTool) => {
        if (activeTool === previousActiveTool) {
          return;
        }

        this.dispatchActiveToolEvents(previousActiveTool, activeTool);
      },
    );
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

  public handleKeyDown(event: GestureKeyboardEventLike): boolean {
    const code = getKeyboardCode(event);
    if (code !== null) {
      this.pressedKeys.add(code);
    }

    this.publishKeyboardSnapshot(event);
    return this.dispatchGesture(
      createKeyboardGestureEvent("key down", event, this.nextGestureId("key")),
    );
  }

  public handleKeyUp(event: GestureKeyboardEventLike): boolean {
    const code = getKeyboardCode(event);
    if (code !== null) {
      this.pressedKeys.delete(code);
    }

    this.publishKeyboardSnapshot(event);
    return this.dispatchGesture(
      createKeyboardGestureEvent("key up", event, this.nextGestureId("key")),
    );
  }

  public handleUiButtonTouchTap(event: GestureUiButtonTouchTapEventLike): void {
    this.dispatchGesture({
      type: "ui-button-touch-tap",
      gestureId: this.nextGestureId("ui-button-touch"),
      uiButtonId: event.uiButtonId,
      modifiers: getModifiers(event),
      sourceEvent: event.sourceEvent ?? event,
    });
  }

  public handleUiButtonMouseTap(event: GestureUiButtonMouseTapEventLike): void {
    this.dispatchGesture({
      type: "ui-button-mouse-tap",
      gestureId: this.nextGestureId("ui-button-mouse"),
      uiButtonId: event.uiButtonId,
      button: event.button,
      modifiers: getModifiers(event),
      sourceEvent: event.sourceEvent ?? event,
    });
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
    this.unsubscribeActiveToolReaction();
    this.cancelAllPointerSessions();
    this.clearPressedKeys();
    this.gestureListeners.clear();
    this.keyboardListeners.clear();
    this.longPressListeners.clear();
  }

  private startMouseSession(event: GesturePointerEventLike): void {
    const position = getPosition(event);
    const pressStartedAt = this.now();
    const session: MouseSession = {
      gestureId: this.nextGestureId("mouse"),
      pointerId: event.pointerId,
      originButton: event.button,
      pressButtons: event.buttons,
      pressModifiers: getModifiers(event),
      pressStartedAt,
      startPosition: position,
      lastPosition: position,
      longPressIndicatorTimer: null,
      longPressTimer: null,
      longPress: false,
      state: "pressed",
      payload: null,
    };
    this.mouseSession = session;
    this.scheduleLongPressTimers(session, {
      isActive: () => this.mouseSession === session && session.state === "pressed",
      onLongPress: () => {
        this.dispatchGesture({
          type: "mouse-long-press-ready",
          gestureId: session.gestureId,
          button: session.originButton,
          buttons: session.pressButtons,
          position: session.lastPosition,
          pointerEntity: this.resolvePointerEntityAt(session.lastPosition),
          modifiers: session.pressModifiers,
          sourceEvent: null,
        });
      },
    });
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
        this.syncLongPressPosition(session);
        return;
      }

      this.clearLongPressTimers(session);
      this.hideLongPressState();
      session.state = "dragging";
      session.lastPosition = position;
      this.dispatchGesture({
        type: "mouse dragstart",
        gestureId: session.gestureId,
        payload: session.payload,
        originButton: session.originButton,
        button: event.button,
        buttons: event.buttons,
        position,
        startPosition: session.startPosition,
        longPress: session.longPress,
        pointerEntity: this.resolvePointerEntityAt(position),
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
      payload: session.payload,
      originButton: session.originButton,
      buttons: event.buttons,
      position,
      delta,
      longPress: session.longPress,
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

    this.clearLongPressTimers(session);
    this.hideLongPressState();

    if (session.state === "dragging") {
      this.dispatchGesture({
        type: "mouse dragend",
        gestureId: session.gestureId,
        payload: session.payload,
        originButton: session.originButton,
        releaseButton: event.button,
        button: event.button,
        buttons: event.buttons,
        position,
        reason,
        longPress: session.longPress,
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
        longPress: session.longPress,
        pointerEntity: this.resolvePointerEntityAt(position),
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
      const pressStartedAt = this.now();
      const session: TouchSession = {
        gestureId: this.nextGestureId("touch"),
        primaryId: event.pointerId,
        pressModifiers: getModifiers(event),
        pressStartedAt,
        startPosition: position,
        lastPosition: position,
        state: "pending-long-press",
        longPressIndicatorTimer: null,
        longPressTimer: null,
        longPress: false,
        payload: null,
      };
      this.touchSession = session;
      this.scheduleLongPressTimers(session, {
        isActive: () => this.touchSession === session && session.state === "pending-long-press",
        onLongPress: () => {
          session.state = "drag-ready";
          this.dispatchGesture({
            type: "tap-long-press-ready",
            gestureId: session.gestureId,
            primaryId: session.primaryId,
            position: session.lastPosition,
            activeTouchCount: this.activeTouches.size,
            pointerEntity: this.resolvePointerEntityAt(session.lastPosition),
            modifiers: session.pressModifiers,
            sourceEvent: null,
          });
        },
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
        this.syncLongPressPosition(session);
        return;
      }

      this.clearLongPressTimers(session);
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
        payload: session.payload,
        primaryId: session.primaryId,
        position,
        startPosition: session.startPosition,
        activeTouchCount: this.activeTouches.size,
        longPress: session.longPress,
        pointerEntity: this.resolvePointerEntityAt(position),
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
      payload: session.payload,
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

    this.clearLongPressTimers(session);
    this.hideLongPressState();

    if (
      reason === "release" &&
      (session.state === "pending-long-press" || (session.state === "drag-ready" && session.longPress))
    ) {
      const position = getPosition(event);
      this.dispatchGesture({
        type: "touch tap",
        gestureId: session.gestureId,
        primaryId: session.primaryId,
        position,
        longPress: session.longPress,
        pointerEntity: this.resolvePointerEntityAt(position),
        modifiers: getModifiers(event),
        sourceEvent: event,
      });
    } else if (session.state === "dragging") {
      this.dispatchGesture({
        type: "touch dragend",
        gestureId: session.gestureId,
        payload: session.payload,
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

    this.clearLongPressTimers(session);
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
    if (mouseSession !== null) {
      this.clearLongPressTimers(mouseSession);
      if (mouseSession.state === "dragging") {
        this.dispatchGesture({
          type: "mouse dragend",
          gestureId: mouseSession.gestureId,
          originButton: mouseSession.originButton,
          releaseButton: mouseSession.originButton,
          button: mouseSession.originButton,
          buttons: 0,
          position: mouseSession.lastPosition,
          reason: "cancel",
          longPress: mouseSession.longPress,
          modifiers: emptyModifiers(),
          sourceEvent: null,
        });
      }
    }
    this.mouseSession = null;

    const touchSession = this.touchSession;
    if (touchSession !== null) {
      this.clearLongPressTimers(touchSession);
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

  private scheduleLongPressTimers(
    session: LongPressTrackingSession,
    options: {
      readonly isActive: () => boolean;
      readonly onLongPress: () => void;
    },
  ): void {
    session.longPressIndicatorTimer = this.scheduleTimeout(() => {
      if (!options.isActive()) {
        return;
      }

      const elapsedMs = Math.min(
        this.thresholds.touchLongPressMs,
        Math.max(0, this.now() - session.pressStartedAt),
      );
      session.longPressIndicatorTimer = null;
      this.setLongPressState({
        visible: true,
        position: session.lastPosition,
        startedAt: session.pressStartedAt,
        durationMs: this.thresholds.touchLongPressMs,
        progress: elapsedMs / this.thresholds.touchLongPressMs,
      });
    }, TOUCH_LONG_PRESS_INDICATOR_DELAY_MS);

    session.longPressTimer = this.scheduleTimeout(() => {
      if (!options.isActive()) {
        return;
      }

      session.longPress = true;
      session.longPressTimer = null;
      this.setLongPressState({
        visible: true,
        position: session.lastPosition,
        startedAt: session.pressStartedAt,
        durationMs: this.thresholds.touchLongPressMs,
        progress: 1,
      });
      options.onLongPress();
    }, this.thresholds.touchLongPressMs);
  }

  private clearLongPressTimers(session: LongPressTrackingSession): void {
    if (session.longPressIndicatorTimer !== null) {
      this.cancelTimeout(session.longPressIndicatorTimer);
      session.longPressIndicatorTimer = null;
    }

    if (session.longPressTimer !== null) {
      this.cancelTimeout(session.longPressTimer);
      session.longPressTimer = null;
    }
  }

  private syncLongPressPosition(session: LongPressTrackingSession): void {
    if (!this.longPressState.visible || this.longPressState.startedAt !== session.pressStartedAt) {
      return;
    }

    this.setLongPressState({
      ...this.longPressState,
      position: session.lastPosition,
    });
  }

  private resolvePointerEntityAt(position: GesturePosition): WorldEntity | null {
    return this.appHost.workspace.editor?.queries.findEntityAtClientPixelPoint(position) ?? null;
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

  private dispatchGesture(event: GestureEvent): boolean {
    let consumed = false;

    for (const listener of this.gestureListeners) {
      const result = listener(event);
      if (isConsumedGestureDispatchResult(result)) {
        consumed = consumed || result.consumedBy !== null;
      }
    }

    this.persistDragPayload(event);
    return consumed;
  }

  private dispatchActiveToolEvents(from: ActiveTool, to: ActiveTool): void {
    const gestureId = this.nextGestureId("active-tool");
    const baseEvent = {
      gestureId,
      from,
      to,
      modifiers: emptyModifiers(),
      sourceEvent: null,
    };

    this.dispatchGesture({
      type: "on-exit-active-tool",
      ...baseEvent,
    });
    this.dispatchGesture({
      type: "on-enter-active-tool",
      ...baseEvent,
    });
  }

  private persistDragPayload(event: GestureEvent): void {
    if (isMouseDragGestureEvent(event)) {
      if (this.mouseSession?.gestureId === event.gestureId) {
        this.mouseSession.payload = event.payload ?? null;
      }
      return;
    }

    if (isTouchDragGestureEvent(event) && this.touchSession?.gestureId === event.gestureId) {
      this.touchSession.payload = event.payload ?? null;
    }
  }

  private nextGestureId(prefix: string): string {
    this.lastGestureIndex += 1;
    return `${prefix}-${this.lastGestureIndex}`;
  }
}

export function createGestureAdapter(
  appHost: GestureAdapterAppHost,
  options?: GestureAdapterOptions,
): GestureAdapter {
  return new GestureAdapter(appHost, options);
}

function isConsumedGestureDispatchResult(value: unknown): value is { consumedBy: string | null } {
  if (typeof value !== "object" || value === null || !("consumedBy" in value)) {
    return false;
  }

  const consumedBy = value.consumedBy;
  return consumedBy === null || typeof consumedBy === "string";
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

function isMouseDragGestureEvent(
  event: GestureEvent,
): event is Extract<GestureEvent, { type: "mouse dragstart" | "mouse dragmove" | "mouse dragend" }> {
  return (
    event.type === "mouse dragstart" ||
    event.type === "mouse dragmove" ||
    event.type === "mouse dragend"
  );
}

function isTouchDragGestureEvent(
  event: GestureEvent,
): event is Extract<GestureEvent, { type: "touch dragstart" | "touch dragmove" | "touch dragend" }> {
  return (
    event.type === "touch dragstart" ||
    event.type === "touch dragmove" ||
    event.type === "touch dragend"
  );
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
  readonly altKey?: boolean;
  readonly ctrlKey?: boolean;
  readonly metaKey?: boolean;
  readonly shiftKey?: boolean;
}): GestureModifiers {
  return {
    alt: event.altKey ?? false,
    ctrl: event.ctrlKey ?? false,
    meta: event.metaKey ?? false,
    shift: event.shiftKey ?? false,
  };
}

function createKeyboardGestureEvent(
  type: "key down" | "key up",
  event: GestureKeyboardEventLike,
  gestureId: string,
): GestureEvent {
  return {
    type,
    gestureId,
    code: event.code || null,
    key: event.key || null,
    keyCode: Number.isFinite(event.keyCode) ? event.keyCode : null,
    modifiers: getModifiers(event),
    sourceEvent: event,
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
