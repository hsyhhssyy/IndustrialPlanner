import type { AppHost } from "@/app/host/app-host";
import type {
  GestureDelta,
  GestureEvent,
  GesturePosition,
  KeyboardSnapshot,
} from "@/app/input/gesture/adapter";

const MAX_DIAGNOSTIC_EVENTS = 8;

export interface GestureDiagnosticEventRecord {
  readonly sequence: number;
  readonly type: GestureEvent["type"];
  readonly gestureId: string;
  readonly position: GesturePosition | null;
  readonly delta: GestureDelta | null;
  readonly pointerEntityId: string | null;
  readonly detail: string;
}

export interface GestureDiagnosticsSnapshot {
  readonly latestEvent: GestureDiagnosticEventRecord | null;
  readonly events: readonly GestureDiagnosticEventRecord[];
  readonly keyboard: KeyboardSnapshot;
}

type GestureDiagnosticsListener = (snapshot: GestureDiagnosticsSnapshot) => void;

export class GestureDiagnosticsStore {
  private readonly listeners = new Set<GestureDiagnosticsListener>();
  private events: GestureDiagnosticEventRecord[] = [];
  private keyboard: KeyboardSnapshot = createEmptyKeyboardSnapshot();
  private sequence = 0;

  public getSnapshot(): GestureDiagnosticsSnapshot {
    return {
      latestEvent: this.events[0] ?? null,
      events: this.events,
      keyboard: this.keyboard,
    };
  }

  public subscribe(listener: GestureDiagnosticsListener): () => void {
    this.listeners.add(listener);
    listener(this.getSnapshot());
    return () => {
      this.listeners.delete(listener);
    };
  }

  public recordGesture(event: GestureEvent): void {
    this.sequence += 1;
    this.events = [
      {
        sequence: this.sequence,
        type: event.type,
        gestureId: event.gestureId,
        position: getEventPosition(event),
        delta: getEventDelta(event),
        pointerEntityId: getEventPointerEntityId(event),
        detail: getEventDetail(event),
      },
      ...this.events,
    ].slice(0, MAX_DIAGNOSTIC_EVENTS);
    this.notify();
  }

  public setKeyboardSnapshot(snapshot: KeyboardSnapshot): void {
    this.keyboard = snapshot;
    this.notify();
  }

  private notify(): void {
    const snapshot = this.getSnapshot();
    for (const listener of this.listeners) {
      listener(snapshot);
    }
  }
}

export function createGestureDiagnosticsStore(): GestureDiagnosticsStore {
  return new GestureDiagnosticsStore();
}

function createEmptyKeyboardSnapshot(): KeyboardSnapshot {
  return {
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
}

function getEventPosition(event: GestureEvent): GesturePosition | null {
  if ("position" in event) {
    return event.position;
  }

  if ("center" in event) {
    return event.center;
  }

  return null;
}

function getEventDelta(event: GestureEvent): GestureDelta | null {
  if ("delta" in event) {
    return event.delta;
  }

  if ("centerDelta" in event) {
    return event.centerDelta;
  }

  return null;
}

function getEventPointerEntityId(event: GestureEvent): string | null {
  if (!("pointerEntity" in event)) {
    return null;
  }

  return event.pointerEntity?.id ?? null;
}

function getEventDetail(event: GestureEvent): string {
  const pointerEntityDetail = "pointerEntity" in event && event.pointerEntity !== null
    ? `, entity ${event.pointerEntity.id}`
    : "";

  switch (event.type) {
    case "mouse dragstart":
      return `button ${event.originButton}, buttons ${event.buttons}, ${event.longPress ? "long press" : "direct"}${pointerEntityDetail}`;
    case "mouse dragmove":
      return `buttons ${event.buttons}, ${event.longPress ? "long press" : "direct"}`;
    case "mouse dragend":
      return `${event.reason}, button ${event.releaseButton}, ${event.longPress ? "long press" : "direct"}`;
    case "mouse tap":
      return `button ${event.button}, ${event.longPress ? "long press" : "direct"}${pointerEntityDetail}`;
    case "mouse-long-press-ready":
      return `button ${event.button}, buttons ${event.buttons}, ready${pointerEntityDetail}`;
    case "mouse move":
      return `buttons ${event.buttons}`;
    case "touch dragstart":
      return `primary ${event.primaryId}, touches ${event.activeTouchCount}, ${event.longPress ? "long press" : "direct"}${pointerEntityDetail}`;
    case "touch dragmove":
      return `primary ${event.primaryId}, touches ${event.activeTouchCount}, ${event.longPress ? "long press" : "direct"}`;
    case "touch dragend":
      return `${event.reason}, primary ${event.primaryId}, ${event.longPress ? "long press" : "direct"}`;
    case "touch tap":
      return `primary ${event.primaryId}, ${event.longPress ? "long press" : "direct"}${pointerEntityDetail}`;
    case "tap-long-press-ready":
      return `primary ${event.primaryId}, touches ${event.activeTouchCount}, ready${pointerEntityDetail}`;
    case "pinch in":
    case "pinch out":
      return `distance ${formatNumber(event.distanceDelta)}, scale ${formatNumber(event.scaleDelta)}`;
    case "two finger move":
      return `touches ${event.activeTouchCount}`;
    case "wheel up":
    case "wheel down":
      return `delta ${formatNumber(event.normalizedDelta)}`;
    case "key down":
    case "key up":
      return [
        event.code ? `code ${event.code}` : null,
        event.key ? `key ${event.key}` : null,
        event.keyCode !== null ? `keyCode ${event.keyCode}` : null,
      ].filter(Boolean).join(", ");
    case "ui-button-touch-tap":
      return `id ${event.uiButtonId}`;
    case "ui-button-mouse-tap":
      return `id ${event.uiButtonId}, button ${event.button}`;
  }
}

function formatNumber(value: number): string {
  return Number.isInteger(value) ? `${value}` : value.toFixed(2);
}
