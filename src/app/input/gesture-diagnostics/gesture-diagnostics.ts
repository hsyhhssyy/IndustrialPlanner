import type { AppHost } from "@/app/app-host";
import type {
  GestureDelta,
  GestureEvent,
  GesturePosition,
  KeyboardSnapshot,
} from "@/app/input/gesture-adapter";
import type { GestureMappingModule } from "@/app/input/gesture-actions";

const MAX_DIAGNOSTIC_EVENTS = 8;

export interface GestureDiagnosticEventRecord {
  readonly sequence: number;
  readonly type: GestureEvent["type"];
  readonly gestureId: string;
  readonly position: GesturePosition | null;
  readonly delta: GestureDelta | null;
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

export function createGestureDiagnosticsModule(
  store: GestureDiagnosticsStore,
): GestureMappingModule<AppHost> {
  return {
    id: "app.gesture-diagnostics",
    priority: Number.MAX_SAFE_INTEGER,
    handle(event) {
      store.recordGesture(event);
      return {
        status: "handled",
        consume: false,
      };
    },
  };
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

function getEventDetail(event: GestureEvent): string {
  switch (event.type) {
    case "mouse dragstart":
      return `button ${event.originButton}, buttons ${event.buttons}`;
    case "mouse dragmove":
      return `buttons ${event.buttons}`;
    case "mouse dragend":
      return `${event.reason}, button ${event.releaseButton}`;
    case "mouse tap":
      return `button ${event.button}`;
    case "mouse move":
      return `buttons ${event.buttons}`;
    case "touch dragstart":
    case "touch dragmove":
      return `primary ${event.primaryId}, touches ${event.activeTouchCount}, ${event.longPress ? "long press" : "direct"}`;
    case "touch dragend":
      return `${event.reason}, primary ${event.primaryId}, ${event.longPress ? "long press" : "direct"}`;
    case "touch tap":
      return `primary ${event.primaryId}`;
    case "pinch in":
    case "pinch out":
      return `distance ${formatNumber(event.distanceDelta)}, scale ${formatNumber(event.scaleDelta)}`;
    case "two finger move":
      return `touches ${event.activeTouchCount}`;
    case "wheel up":
    case "wheel down":
      return `delta ${formatNumber(event.normalizedDelta)}`;
  }
}

function formatNumber(value: number): string {
  return Number.isInteger(value) ? `${value}` : value.toFixed(2);
}
